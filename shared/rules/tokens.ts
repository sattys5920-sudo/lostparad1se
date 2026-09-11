// 행동 토큰 — 시간이 흘러야 찬다.
//
// 서버가 늘 켜져 있다고 가정하지 않는다. 아무도 들어오지 않은 채 이틀이
// 지났어도, 다음 사람이 들어온 순간 그 사이의 충전을 전부 따라잡아야
// 한다. 그래서 "지금 몇 개 더 줄까"가 아니라 "마지막으로 처리한 시각
// 이후의 충전 시각을 전부 훑는다"로 짠다.
//
// 같은 계산을 두 번 돌려도 결과가 같다 — lastGrantMs를 넘긴 충전만
// 세기 때문이다. 이어받기 도중에 끊겨도 토큰이 두 배로 들어가지 않는다.
import {
  TOKEN_CAP,
  TOKEN_COMEBACK_BONUS,
  TOKEN_DAWN_GRANT,
  TOKEN_GRANT_HOURS,
  TOKEN_HOURLY_GRANT,
  TOKEN_PER_PLAYER_DAILY,
  DAY_START_HOUR,
} from './v2'
import { seoulMidnight, seoulTimeOn } from './clock'

const DAY_MS = 86_400_000

/** 한 팀의 토큰 상자. */
export interface TokenState {
  /** 지금 쥐고 있는 수. 만회 보너스를 받은 직후에는 한도를 넘을 수 있다. */
  tokens: number
  /** 마지막으로 처리한 충전 시각. 이 시각 이후 것만 새로 준다. */
  lastGrantMs: number
  /** 오늘 사람마다 쓴 수. 08:00에 비운다. */
  usedToday: Readonly<Record<string, number>>
  /** 다음 08:00에 더 받을 몫. 꼴찌였으면 2, 받고 나면 0. */
  pendingComeback: number
}

/** 충전 한 번. 기록으로 남겨 나중에 따져 볼 수 있게 한다. */
export interface TokenGrant {
  atMs: number
  kind: 'dawn' | 'hourly'
  /** 실제로 상자에 들어간 수. */
  gained: number
  /** 한도에 걸려 사라진 수. */
  wasted: number
  /** 그중 만회 보너스 몫. 이것만 한도를 넘길 수 있다. */
  comeback: number
}

/** 충전이 일어나는 시각 하나. */
interface Instant {
  atMs: number
  kind: 'dawn' | 'hourly'
}

/**
 * (fromMs, toMs] 사이의 충전 시각을 이른 것부터. 시작 시각은 빼고 끝 시각은
 * 넣는다 — 같은 순간을 두 번 세지 않으려면 한쪽만 닫혀 있어야 한다.
 */
export function grantInstantsBetween(fromMs: number, toMs: number): Instant[] {
  const out: Instant[] = []
  if (toMs <= fromMs) return out
  // 며칠이 비어 있어도 하루씩 훑는다. 닷새짜리 판이라 길어야 몇 바퀴다.
  for (let day = seoulMidnight(fromMs); day <= toMs; day += DAY_MS) {
    const dawn = seoulTimeOn(day, DAY_START_HOUR)
    if (dawn > fromMs && dawn <= toMs) out.push({ atMs: dawn, kind: 'dawn' })
    for (const h of TOKEN_GRANT_HOURS) {
      const at = seoulTimeOn(day, h)
      if (at > fromMs && at <= toMs) out.push({ atMs: at, kind: 'hourly' })
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs)
}

export interface AccrueResult {
  state: TokenState
  grants: TokenGrant[]
}

/**
 * 마지막 처리 시각부터 지금까지의 충전을 전부 적용한다.
 *
 * 08:00에는 2개를 받고, 사람마다 쓴 수가 0으로 돌아가고, 밀려 있던 만회
 * 보너스가 얹힌다. 10·12·14·16·18·20시에는 1개씩. 넘치는 건 사라지되,
 * 만회 보너스만은 한도를 넘겨서 들어간다.
 */
export function accrueTokens(state: TokenState, nowMs: number): AccrueResult {
  const grants: TokenGrant[] = []
  let tokens = state.tokens
  let usedToday = state.usedToday
  let pendingComeback = state.pendingComeback
  let lastGrantMs = state.lastGrantMs

  for (const inst of grantInstantsBetween(state.lastGrantMs, nowMs)) {
    const before = tokens
    if (inst.kind === 'dawn') {
      // 한도는 기본 몫에만 걸린다. 만회 보너스는 그 위에 얹힌다.
      tokens = Math.min(before + TOKEN_DAWN_GRANT, TOKEN_CAP) + pendingComeback
      grants.push({
        atMs: inst.atMs,
        kind: 'dawn',
        gained: tokens - before,
        wasted: Math.max(0, before + TOKEN_DAWN_GRANT - TOKEN_CAP),
        comeback: pendingComeback,
      })
      pendingComeback = 0
      usedToday = {}
    } else {
      tokens = Math.min(before + TOKEN_HOURLY_GRANT, TOKEN_CAP)
      // 이미 한도를 넘겨 쥐고 있으면 줄이지는 않는다
      if (tokens < before) tokens = before
      grants.push({
        atMs: inst.atMs,
        kind: 'hourly',
        gained: tokens - before,
        wasted: TOKEN_HOURLY_GRANT - (tokens - before),
        comeback: 0,
      })
    }
    lastGrantMs = inst.atMs
  }

  return { state: { tokens, lastGrantMs, usedToday, pendingComeback }, grants }
}

/** 21:00 정산에서 꼴찌였다. 다음 08:00에 얹어 준다. */
export function markComeback(state: TokenState): TokenState {
  return { ...state, pendingComeback: TOKEN_COMEBACK_BONUS }
}

export type SpendRefusal = 'notEnoughTokens' | 'playerDailyLimit'

export interface SpendResult {
  ok: boolean
  state: TokenState
  reason: SpendRefusal | null
}

/** 그 사람이 오늘 몇 개 썼는가. */
export function usedBy(state: TokenState, playerId: string): number {
  return state.usedToday[playerId] ?? 0
}

/** 그 사람이 오늘 앞으로 몇 개 더 쓸 수 있는가. 팀 상자는 따로 본다. */
export function personalLeft(state: TokenState, playerId: string): number {
  return Math.max(0, TOKEN_PER_PLAYER_DAILY - usedBy(state, playerId))
}

/**
 * 토큰을 쓴다. 팀 상자와 그 사람의 하루 몫을 둘 다 본다 — 둘 중 하나라도
 * 모자라면 아무것도 빠지지 않는다.
 */
export function spendToken(state: TokenState, playerId: string, count = 1): SpendResult {
  if (count <= 0) return { ok: true, state, reason: null }
  if (state.tokens < count) return { ok: false, state, reason: 'notEnoughTokens' }
  if (usedBy(state, playerId) + count > TOKEN_PER_PLAYER_DAILY) {
    return { ok: false, state, reason: 'playerDailyLimit' }
  }
  return {
    ok: true,
    reason: null,
    state: {
      ...state,
      tokens: state.tokens - count,
      usedToday: { ...state.usedToday, [playerId]: usedBy(state, playerId) + count },
    },
  }
}

/** 다음 충전까지 몇 밀리초인가. 화면의 「다음 충전까지」가 이걸 쓴다. */
export function msUntilNextGrant(nowMs: number): number {
  const next = grantInstantsBetween(nowMs, nowMs + 2 * DAY_MS)[0]
  return next ? next.atMs - nowMs : 0
}

/** 판을 시작할 때의 상자. 시작 시각 이전 충전은 없던 것으로 한다. */
export function initialTokenState(startedAtMs: number): TokenState {
  return { tokens: TOKEN_DAWN_GRANT, lastGrantMs: startedAtMs, usedToday: {}, pendingComeback: 0 }
}
