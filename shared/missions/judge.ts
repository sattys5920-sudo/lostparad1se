// 개인 미션 판정.
//
// 순수 함수다. 기록을 받아 조항마다 「얼마나 찼는가」를 낸다. 서버가
// 이걸 돌리고, 그 결과를 disclosure에 따라 걸러서 본인에게만 내려보낸다.
// 거르는 일은 discloseFor()가 한다 — 판정과 공개를 한 함수에 두면
// 언젠가 남의 진행도가 섞여 나간다.
//
// 개인 점수는 팀 점수에 아무 영향도 주지 않는다. 이 파일은 팀 점수를
// 읽기만 하고(순위 조항), 어디에도 쓰지 않는다.
import {
  ENDING_BANDS,
  MAX_PERSONAL_SCORE,
  ROLE_BY_ID,
  SCORE,
  endingBandOf,
  type Clause,
  type ClauseKind,
  type Disclosure,
  type EndingBandSpec,
  type MissionSpec,
} from './roles'
import type { Assignment } from './assign'
import { coStaySeconds, stayedSeconds, tilesStayedOver, visitedTiles, type Interval } from '../rules/presence'
import { dayNumber } from '../rules/clock'
import type { TileId } from '../rules/board'
import type { FlagTarget, RevealScope, TeamId, VoteKind } from '../rules/v2'

// ── 기록 ────────────────────────────────────────────────────────

export interface JudgeVote {
  voterId: string
  targetId: string
  kind: VoteKind
  day: number
  /** 그날 A의 기록이 가리킨 역할을 정확히 짚었는가. */
  exactHit?: boolean
  atMs: number
}

export interface RevealRecord {
  speakerId: string
  scope: RevealScope
  listenerIds: readonly string[]
  day: number
  atMs: number
}

export interface LeverageUseRecord {
  holderId: string
  aboutId: string
  use: 'bind' | 'extort'
  atMs: number
}

export interface FlagRecord {
  tileId: TileId
  team: TeamId
  planterId: string
  target: FlagTarget
  success: boolean
  /** 그 칸이 누구 것이었는가. 빈 칸이면 null. */
  ownerBefore: TeamId | null
  /** 판정 순간 그 칸에 서 있던 사람 전부. */
  standing: readonly string[]
  atMs: number
}

export interface TradeRecord {
  fromTeam: TeamId
  toTeam: TeamId
  atMs: number
}

export interface ScoutRecord {
  playerId: string
  tileId: TileId
  atMs: number
}

/** 판정에 필요한 기록 전부. 서버만 이 모양을 쥔다. */
export interface GameLog {
  startedAtMs: number
  nowMs: number
  /** 종례가 끝났는가. 끝나야 endOnly·hidden 조항이 열린다. */
  over: boolean
  teamOf: (playerId: string) => TeamId
  intervals: readonly Interval[]
  votes: readonly JudgeVote[]
  reveals: readonly RevealRecord[]
  leverageUses: readonly LeverageUseRecord[]
  flags: readonly FlagRecord[]
  trades: readonly TradeRecord[]
  scouts: readonly ScoutRecord[]
  /** A의 기록이 지목한 칸. */
  fragmentTiles: readonly TileId[]
  /** 끝날 때 칸 주인. */
  ownerAtEnd: (tileId: TileId) => TeamId | null
  /** 팀 순위. 1이 1위다. */
  teamRank: Record<TeamId, number>
  allianceAtEnd: Record<TeamId, TeamId | null>
  /** 끝날 때 살아 있는 약점. */
  leverageAtEnd: readonly { holderId: string; aboutId: string }[]
  teamLostTile: Record<TeamId, boolean>
  /** DAY 3에 고른 중요한 사람. */
  chosenBy: Record<string, string | null>
  /** DAY 4 선택이 맞아떨어졌는가. */
  choiceMet: Record<string, boolean>
  /** 종례 순간 중요한 사람과 같은 칸에 있었는가. */
  closingTogether: Record<string, boolean>
  /** 서로를 중요한 사람으로 골랐는가. */
  closingMutual: Record<string, boolean>
}

// ── 조항 하나의 진행도 ──────────────────────────────────────────

export type Unit = 'count' | 'hours' | 'days' | 'flag'
export type Mode = 'atLeast' | 'atMost'

export interface ClauseProgress {
  kind: ClauseKind
  text: string
  disclosure: Disclosure
  unit: Unit
  mode: Mode
  /** 지금까지 센 값. */
  have: number
  /** 넘어야 할(또는 넘지 말아야 할) 값. */
  bar: number
  met: boolean
  /** 되돌릴 수 없이 깨졌는가. failsOnBreak가 붙은 조항만 true가 된다. */
  broken: boolean
  sufficient: boolean
}

const HOUR = 3600

// ── 세는 법 ─────────────────────────────────────────────────────

export interface Ctx {
  me: Assignment
  log: GameLog
  /** 인연 대상이 같은 팀인가. 고리 규칙상 없어야 하지만 대비해 둔다. */
  bondSameTeam: boolean
}

const myTeam = (c: Ctx) => c.me.team
const bondTeam = (c: Ctx) => c.log.teamOf(c.me.bondId)

/** 내가 판정 자리에 서 있던 깃발들. */
const standingIn = (c: Ctx) => c.log.flags.filter((f) => f.standing.includes(c.me.playerId))

function votesFromMe(c: Ctx, kind?: VoteKind) {
  return c.log.votes.filter((v) => v.voterId === c.me.playerId && (!kind || v.kind === kind))
}
function votesToMe(c: Ctx, kind?: VoteKind) {
  return c.log.votes.filter((v) => v.targetId === c.me.playerId && (!kind || v.kind === kind))
}

function myFirstRevealMs(c: Ctx): number | null {
  const mine = c.log.reveals.filter((r) => r.speakerId === c.me.playerId)
  return mine.length === 0 ? null : Math.min(...mine.map((r) => r.atMs))
}

/** 지금까지 지난 날. 아직 판이 돌고 있으면 오늘까지다. */
const today = (c: Ctx) => dayNumber(c.log.startedAtMs, c.log.nowMs)

/** 하루씩 끊어 세야 하는 조항이 쓰는 그날의 08:00~24:00. */
function dayWindow(c: Ctx, day: number): [number, number] {
  const DAY_MS = 86_400_000
  const base = c.log.startedAtMs + (day - 1) * DAY_MS
  return [base, base + DAY_MS]
}

/** 조항 하나가 지금 몇인가. 단위까지 함께 돌려준다. */
function measure(clause: Clause, c: Ctx): { have: number; unit: Unit } {
  const me = c.me.playerId
  const bond = c.me.bondId
  const log = c.log

  switch (clause.kind) {
    // ── 깃발 ──
    case 'defenseJoined':
      return {
        unit: 'count',
        have: standingIn(c).filter((f) => f.team !== myTeam(c) && f.ownerBefore === myTeam(c) && !f.success)
          .length,
      }
    case 'attackJoined':
      return {
        unit: 'count',
        have: standingIn(c).filter((f) => f.team === myTeam(c) && f.success && f.target !== 'empty').length,
      }
    case 'bondFlagFailedHere':
      return {
        unit: 'count',
        have: standingIn(c).filter((f) => f.planterId === bond && !f.success).length,
      }
    case 'capturedWhereBondStood':
      return {
        unit: 'count',
        have: log.flags.filter((f) => f.planterId === me && f.success && f.standing.includes(bond)).length,
      }
    case 'teamNeverLostTile':
      return { unit: 'flag', have: log.teamLostTile[myTeam(c)] ? 0 : 1 }

    // ── 소유·순위·동맹 ──
    case 'ownFragmentTilesAtEnd':
      return {
        unit: 'count',
        have: log.fragmentTiles.filter((t) => log.ownerAtEnd(t) === myTeam(c)).length,
      }
    case 'teamRankNotFirst':
      return { unit: 'flag', have: log.teamRank[myTeam(c)] !== 1 ? 1 : 0 }
    case 'bondTeamRankHigher':
      return { unit: 'flag', have: log.teamRank[bondTeam(c)] < log.teamRank[myTeam(c)] ? 1 : 0 }
    case 'alliedWithBondAtEnd':
      return { unit: 'flag', have: log.allianceAtEnd[myTeam(c)] === bondTeam(c) ? 1 : 0 }

    // ── 약점 ──
    case 'leverageSpent':
      return { unit: 'count', have: log.leverageUses.filter((l) => l.holderId === me).length }
    case 'leverageSpentExtort':
      return {
        unit: 'count',
        have: log.leverageUses.filter((l) => l.holderId === me && l.use === 'extort').length,
      }
    case 'neverSpentLeverage':
      return { unit: 'flag', have: log.leverageUses.some((l) => l.holderId === me) ? 0 : 1 }
    case 'holdLeverageOnBondAtEnd':
      return {
        unit: 'flag',
        have: log.leverageAtEnd.some((l) => l.holderId === me && l.aboutId === bond) ? 1 : 0,
      }

    // ── 체류·방문 ──
    case 'fragmentTileStayDays': {
      const need = (clause.hours ?? 1) * HOUR
      let days = 0
      for (let d = 1; d <= today(c); d++) {
        const [from, to] = dayWindow(c, d)
        const any = log.fragmentTiles.some((t) => stayedSeconds(log.intervals, me, t, from, to) >= need)
        if (any) days++
      }
      return { unit: 'days', have: days }
    }
    case 'stayInRivalTeamTiles': {
      const need = (clause.hours ?? 1) * HOUR
      const tiles = tilesStayedOver(log.intervals, me, need, log.startedAtMs, log.nowMs, (t) => {
        const owner = log.ownerAtEnd(t)
        return owner !== null && owner !== myTeam(c)
      })
      const teams = new Set<TeamId>()
      for (const t of tiles) {
        const owner = log.ownerAtEnd(t)
        if (owner) teams.add(owner)
      }
      return { unit: 'count', have: teams.size }
    }
    case 'tilesVisited':
      return { unit: 'count', have: visitedTiles(log.intervals, me).size }
    case 'coStayWithBond':
      return {
        unit: 'hours',
        have: coStaySeconds(log.intervals, me, bond, log.startedAtMs, log.nowMs) / HOUR,
      }
    case 'coStayWithChosen': {
      const chosen = log.chosenBy[me]
      if (!chosen) return { unit: 'hours', have: 0 }
      return {
        unit: 'hours',
        have: coStaySeconds(log.intervals, me, chosen, log.startedAtMs, log.nowMs) / HOUR,
      }
    }

    // ── 받은 표 ──
    case 'trustReceived':
      return { unit: 'count', have: votesToMe(c, 'trust').length }
    case 'suspicionReceivedAtMost':
      return { unit: 'count', have: votesToMe(c, 'suspicion').length }
    case 'suspicionAfterRevealAtMost': {
      const at = myFirstRevealMs(c)
      if (at === null) return { unit: 'count', have: 0 }
      return { unit: 'count', have: votesToMe(c, 'suspicion').filter((v) => v.atMs >= at).length }
    }
    case 'voteReceivedFromBond':
      return { unit: 'count', have: votesToMe(c).filter((v) => v.voterId === bond).length }
    case 'trustReceivedFromBond':
      return { unit: 'count', have: votesToMe(c, 'trust').filter((v) => v.voterId === bond).length }
    case 'bondSuspicionReceivedAtMost':
      return {
        unit: 'count',
        have: log.votes.filter((v) => v.targetId === bond && v.kind === 'suspicion').length,
      }

    // ── 준 표 ──
    case 'trustGivenToBond':
      return { unit: 'count', have: votesFromMe(c, 'trust').filter((v) => v.targetId === bond).length }
    case 'trustLikingGivenToBond':
      return {
        unit: 'count',
        have: votesFromMe(c).filter((v) => v.targetId === bond && v.kind !== 'suspicion').length,
      }
    case 'trustGivenToBondOnDays': {
      const days = new Set(clause.days ?? [])
      return {
        unit: 'count',
        have: new Set(
          votesFromMe(c, 'trust')
            .filter((v) => v.targetId === bond && days.has(v.day))
            .map((v) => v.day),
        ).size,
      }
    }
    case 'trustGivenToChosen': {
      const chosen = log.chosenBy[me]
      if (!chosen) return { unit: 'count', have: 0 }
      return { unit: 'count', have: votesFromMe(c, 'trust').filter((v) => v.targetId === chosen).length }
    }
    case 'noSuspicionCast':
      return { unit: 'flag', have: votesFromMe(c, 'suspicion').length === 0 ? 1 : 0 }
    case 'hitSuspicion':
      return { unit: 'count', have: votesFromMe(c, 'suspicion').filter((v) => v.exactHit).length }
    case 'missSuspicionAtMost':
      return { unit: 'count', have: votesFromMe(c, 'suspicion').filter((v) => !v.exactHit).length }

    // ── 털어놓기 ──
    case 'classRevealAfterDay':
      return {
        unit: 'flag',
        have: log.reveals.some((r) => r.speakerId === me && r.scope === 'class' && r.day >= (clause.day ?? 1))
          ? 1
          : 0,
      }
    case 'classRevealOnDay':
      return {
        unit: 'flag',
        have: log.reveals.some((r) => r.speakerId === me && r.scope === 'class' && r.day === clause.day)
          ? 1
          : 0,
      }
    case 'neverRevealed':
      return { unit: 'flag', have: myFirstRevealMs(c) === null ? 1 : 0 }
    case 'noRevealUntilDay':
      return {
        unit: 'flag',
        have: log.reveals.some((r) => r.speakerId === me && r.day < (clause.day ?? 99)) ? 0 : 1,
      }
    case 'heardPrivateRevealFrom':
      return {
        unit: 'count',
        have: new Set(
          log.reveals
            .filter((r) => r.scope === 'private' && r.listenerIds.includes(me))
            .map((r) => r.speakerId),
        ).size,
      }
    case 'bondPrivateRevealToMe':
      return {
        unit: 'flag',
        have: log.reveals.some(
          (r) => r.speakerId === bond && r.scope === 'private' && r.listenerIds.includes(me),
        )
          ? 1
          : 0,
      }
    case 'privateRevealToBond':
      return {
        unit: 'flag',
        have: log.reveals.some(
          (r) => r.speakerId === me && r.scope === 'private' && r.listenerIds.includes(bond),
        )
          ? 1
          : 0,
      }

    // ── 그 밖 ──
    case 'tradeWithEachRivalTeam': {
      const partners = new Set<TeamId>()
      for (const t of log.trades) {
        if (t.fromTeam === myTeam(c)) partners.add(t.toTeam)
        if (t.toTeam === myTeam(c)) partners.add(t.fromTeam)
      }
      return { unit: 'count', have: partners.size }
    }
    case 'bondTradeWithUs':
      return {
        unit: 'count',
        have: log.trades.filter(
          (t) =>
            (t.fromTeam === myTeam(c) && t.toTeam === bondTeam(c)) ||
            (t.toTeam === myTeam(c) && t.fromTeam === bondTeam(c)),
        ).length,
      }
    case 'scoutCount':
      return { unit: 'count', have: log.scouts.filter((s) => s.playerId === me).length }
  }
}

/**
 * 조항 하나를 판정한다.
 *
 * 같은 팀이라 표를 줄 수 없는 조항에는 altHours가 붙어 있다. 인연 고리가
 * 팀을 갈라 두므로 원래는 걸릴 일이 없지만, 걸리면 동석 시간으로 바꿔 센다.
 */
export function judgeClause(clause: Clause, c: Ctx): ClauseProgress {
  const useAlt = c.bondSameTeam && clause.altHours !== undefined
  const measured = useAlt
    ? { have: coStaySeconds(c.log.intervals, c.me.playerId, c.me.bondId, c.log.startedAtMs, c.log.nowMs) / HOUR, unit: 'hours' as Unit }
    : measure(clause, c)

  const mode: Mode = clause.limit !== undefined ? 'atMost' : 'atLeast'
  const bar = useAlt
    ? (clause.altHours as number)
    : clause.limit ?? clause.dayCount ?? clause.need ?? clause.hours ?? 1

  const met = mode === 'atMost' ? measured.have <= bar : measured.have >= bar
  return {
    kind: clause.kind,
    text: clause.text,
    disclosure: clause.disclosure,
    unit: measured.unit,
    mode,
    have: measured.have,
    bar,
    met,
    broken: clause.failsOnBreak === true && !met,
    sufficient: clause.sufficient === true,
  }
}

export interface MissionProgress {
  text: string
  clauses: ClauseProgress[]
  met: boolean
  /** 되돌릴 수 없이 깨졌는가. */
  broken: boolean
}

function judgeMission(spec: MissionSpec, c: Ctx): MissionProgress {
  const clauses = spec.clauses.map((cl) => judgeClause(cl, c))
  const enough = clauses.some((p) => p.sufficient && p.met)
  return {
    text: spec.text,
    clauses,
    met: enough || clauses.every((p) => p.met),
    broken: !enough && clauses.some((p) => p.broken),
  }
}

// ── 한 사람의 결과 ──────────────────────────────────────────────

export interface PersonalResult {
  playerId: string
  roleId: Assignment['roleId']
  main: MissionProgress
  bond: MissionProgress
  choiceMet: boolean
  closingTogether: boolean
  closingMutual: boolean
  score: number
  band: EndingBandSpec
}

/**
 * 한 사람의 미션 판정. 남의 결과는 들어 있지 않다.
 *
 * 점수는 주 미션 3 · 인연 2 · DAY 4 선택 2 · 종례 동석 1 · 상호 선택 1
 * 로 최대 9다. 팀 점수와는 한 줄도 섞이지 않는다.
 */
export function judge(me: Assignment, log: GameLog): PersonalResult {
  const c: Ctx = { me, log, bondSameTeam: log.teamOf(me.bondId) === me.team }
  const role = ROLE_BY_ID[me.roleId]
  const main = judgeMission(role.main, c)
  const bond = judgeMission(role.bond, c)
  const choiceMet = log.choiceMet[me.playerId] === true
  const together = log.closingTogether[me.playerId] === true
  const mutual = log.closingMutual[me.playerId] === true

  const score =
    (main.met ? SCORE.main : 0) +
    (bond.met ? SCORE.bond : 0) +
    (choiceMet ? SCORE.choice : 0) +
    (together ? SCORE.closingTogether : 0) +
    (mutual ? SCORE.closingMutual : 0)

  return {
    playerId: me.playerId,
    roleId: me.roleId,
    main,
    bond,
    choiceMet,
    closingTogether: together,
    closingMutual: mutual,
    score: Math.min(score, MAX_PERSONAL_SCORE),
    band: endingBandOf(score),
  }
}

// ── 어디까지 보여 줄까 ──────────────────────────────────────────

export type Phase = 'live' | 'settlement' | 'end'

/** 진행도 한 줄을 화면에 어떻게 내보낼까. */
export interface ClauseView {
  text: string
  /** 숫자를 보여 주는가. */
  shown: boolean
  unit: Unit
  mode: Mode
  have: number | null
  bar: number
  met: boolean | null
  /** 숫자를 안 보여 줄 때 대신 뜨는 말. */
  note: string | null
}

const NOTE: Record<Disclosure, string | null> = {
  realtime: null,
  settlement: '정산 때 갱신',
  endOnly: '끝날 때 판정',
  hidden: null,
}

function visibleAt(d: Disclosure, phase: Phase): boolean {
  if (phase === 'end') return true
  if (d === 'realtime') return true
  if (d === 'settlement') return phase === 'settlement'
  return false
}

/**
 * 본인에게 내려보낼 모양으로 깎는다.
 *
 * 숫자를 감추는 게 아니라 **빼고 만든다**. have가 null이면 그 값은 문서에
 * 아예 들어가지 않는다 — 받은 뒤 가리는 방식이면 개발자도구로 다 보인다.
 */
export function discloseClause(p: ClauseProgress, phase: Phase): ClauseView {
  const shown = visibleAt(p.disclosure, phase)
  return {
    text: p.text,
    shown,
    unit: p.unit,
    mode: p.mode,
    have: shown ? p.have : null,
    bar: p.bar,
    met: shown ? p.met : null,
    note: shown ? null : NOTE[p.disclosure],
  }
}

export interface MissionView {
  text: string
  clauses: ClauseView[]
  /** 끝나기 전에는 달성 여부를 알려 주지 않는다 — 조항이 하나라도 가려져 있으면. */
  met: boolean | null
  broken: boolean
}

function discloseMission(m: MissionProgress, phase: Phase): MissionView {
  const clauses = m.clauses.map((p) => discloseClause(p, phase))
  const allShown = clauses.every((v) => v.shown)
  return { text: m.text, clauses, met: allShown ? m.met : null, broken: m.broken }
}

export interface PersonalView {
  playerId: string
  roleId: Assignment['roleId']
  main: MissionView
  bond: MissionView
  /** 끝나기 전에는 점수도 엔딩도 내려보내지 않는다. */
  score: number | null
  bandId: EndingBandSpec['id'] | null
}

/** 본인에게 내려보낼 전부. 남의 역할도 남의 진행도도 들어 있지 않다. */
export function discloseFor(result: PersonalResult, phase: Phase): PersonalView {
  return {
    playerId: result.playerId,
    roleId: result.roleId,
    main: discloseMission(result.main, phase),
    bond: discloseMission(result.bond, phase),
    score: phase === 'end' ? result.score : null,
    bandId: phase === 'end' ? result.band.id : null,
  }
}

export { ENDING_BANDS }
