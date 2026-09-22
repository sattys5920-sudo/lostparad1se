// 마주 보고 하는 거래.
//
// **주문서가 아니라 탁자다.** 예전에는 한 사람이 「이걸 주고 저걸
// 받겠다」를 혼자 다 적어 보냈다. 상대가 무엇을 내놓을지 고를 수가
// 없으니 흥정이 아니라 통보였다. 이제 둘이 각자 제 물건을 탁자에
// 올리고, 둘 다 준비를 눌러야 성립한다.
//
// 이 파일은 **순수 함수**다. 문서도 시계도 데이터베이스도 모른다.
// 서버가 재료를 모아 주고 결과를 적는다.
import { EMPTY_SATCHEL, countOf, type ItemKind, type Satchel } from './items'
import type { TeamId } from './v2'

/** 요청이 살아 있는 시간. 답이 없으면 그냥 사라진다 — 값도 안 든다. */
export const DEAL_ASK_MS = 15_000

/**
 * 둘 다 준비한 뒤 성립까지 세는 시간.
 *
 * 누구든 이 사이에 무를 수 있다. 「눌렀더니 이미 끝나 있었다」가
 * 없어야 무르는 것이 실제로 가능한 선택이 된다.
 */
export const DEAL_COUNTDOWN_MS = 3_000

export type DealStatus = 'asking' | 'open' | 'settling' | 'done' | 'gone'

/**
 * 한쪽이 탁자에 올려놓은 것.
 *
 * **쪽지는 장수만 적는다.** 무엇인지도 누구 것인지도 성립해야 보인다 —
 * 접힌 채로 건네는 것이 쪽지다. 어느 쪽지인지는 서버만 안다.
 */
export interface Stake {
  /** 팀 금고에서 나간다. 팀원에게 알림이 간다. */
  money: number
  knowledge: number
  /** 내 주머니의 물건. */
  items: Satchel
  /** 접힌 쪽지 장수. */
  slips: number
  /** 데리고 있는 짝만. 방에 세워 둔 것은 못 건넨다. */
  robots: number
}

export const EMPTY_STAKE: Stake = { money: 0, knowledge: 0, items: {}, slips: 0, robots: 0 }

/** 내가 실제로 내놓을 수 있는 양. 올릴 때도 성립 직전에도 이걸로 잰다. */
export interface Holdings {
  money: number
  knowledge: number
  items: Satchel
  slips: number
  robots: number
}

export interface DealSide {
  playerId: string
  team: TeamId
  ready: boolean
  stake: Stake
}

export interface DealState {
  status: DealStatus
  /** 말을 건 쪽. **값은 이 사람이 낸다** — 성립할 때만. */
  askedBy: string
  a: DealSide
  b: DealSide
  /** 둘이 마주 선 방. 한 명이라도 떠나면 거래는 사라진다. */
  tileId: string
  askedAtMs: number
  /** 둘 다 준비한 순간 + 카운트다운. 아니면 null. */
  settleAtMs: number | null
}

const itemKinds = (bag: Satchel): ItemKind[] => Object.keys(bag) as ItemKind[]

/** 아무것도 안 올렸는가. */
export function stakeIsEmpty(s: Stake): boolean {
  return (
    s.money === 0 &&
    s.knowledge === 0 &&
    s.slips === 0 &&
    s.robots === 0 &&
    itemKinds(s.items).every((k) => countOf(s.items, k) === 0)
  )
}

/**
 * 탁자에 무엇이든 올라와 있는가.
 *
 * **한쪽만 올려도 된다.** 일방적으로 주는 것도 거래다 — 값을 안 받고
 * 건네는 일이 이 게임에서는 흔하고, 그것도 흥정의 한 수다.
 */
export const dealHasAnything = (d: DealState): boolean =>
  !stakeIsEmpty(d.a.stake) || !stakeIsEmpty(d.b.stake)

export const sideOf = (d: DealState, playerId: string): DealSide | null =>
  d.a.playerId === playerId ? d.a : d.b.playerId === playerId ? d.b : null

const other = (d: DealState, playerId: string): DealSide => (d.a.playerId === playerId ? d.b : d.a)

/** 어느 쪽이 a 인가. 서버가 쓰기 자리를 고를 때 본다. */
export const isSideA = (d: DealState, playerId: string): boolean => d.a.playerId === playerId

export type StakeRefusal =
  | 'notYours'
  | 'notOpen'
  | 'shortMoney'
  | 'shortKnowledge'
  | 'shortItems'
  | 'shortSlips'
  | 'shortRobots'

/** 그만큼 가지고 있는가. 모자란 것이 있으면 무엇이 모자란지 말한다. */
export function shortOf(stake: Stake, have: Holdings): StakeRefusal | null {
  if (stake.money > have.money) return 'shortMoney'
  if (stake.knowledge > have.knowledge) return 'shortKnowledge'
  if (stake.slips > have.slips) return 'shortSlips'
  if (stake.robots > have.robots) return 'shortRobots'
  for (const k of itemKinds(stake.items)) {
    if (countOf(stake.items, k) > countOf(have.items, k)) return 'shortItems'
  }
  return null
}

export const SHORT_MESSAGE: Record<StakeRefusal, string> = {
  notYours: '이 거래의 사람이 아니다.',
  notOpen: '이미 끝난 거래다.',
  shortMoney: '돈이 모자라다.',
  shortKnowledge: '지식이 모자라다.',
  shortItems: '그 물건이 모자라다.',
  shortSlips: '쪽지가 모자라다.',
  shortRobots: '데리고 있는 짝이 모자라다.',
}

/**
 * 물건을 올리거나 내린다.
 *
 * **둘의 준비가 함께 풀린다.** 준비해 놓고 몰래 물건을 빼는 것을
 * 막으려면, 탁자가 바뀐 순간 둘 다 다시 눌러야 한다. 내 것만 풀면
 * 상대가 준비한 채로 내 물건만 줄어든 판이 성립해 버린다.
 */
export function afterStake(d: DealState, playerId: string, stake: Stake): DealState {
  const mineIsA = isSideA(d, playerId)
  const put = (side: DealSide): DealSide => ({ ...side, ready: false })
  return {
    ...d,
    // 세던 중이었으면 세던 것도 없어진다. 탁자가 바뀌었으니 처음부터다
    status: d.status === 'settling' ? 'open' : d.status,
    settleAtMs: null,
    a: mineIsA ? { ...put(d.a), stake } : put(d.a),
    b: mineIsA ? put(d.b) : { ...put(d.b), stake },
  }
}

/**
 * 준비를 누르거나 무른다. 둘 다 눌리면 카운트다운이 시작된다.
 *
 * **여기서 성립시키지 않는다.** 세는 동안 누구든 무를 수 있어야 해서,
 * 성립은 시각이 지난 뒤에 따로 확인한다(readyToSettle).
 */
export function afterReady(d: DealState, playerId: string, ready: boolean, nowMs: number): DealState {
  const mineIsA = isSideA(d, playerId)
  const a = mineIsA ? { ...d.a, ready } : d.a
  const b = mineIsA ? d.b : { ...d.b, ready }
  const both = a.ready && b.ready
  return {
    ...d,
    a,
    b,
    status: both ? 'settling' : 'open',
    settleAtMs: both ? nowMs + DEAL_COUNTDOWN_MS : null,
  }
}

/** 준비를 누를 수 있는가. 빈 탁자로는 못 누른다. */
export function canReady(d: DealState, playerId: string): boolean {
  if (d.status !== 'open' && d.status !== 'settling') return false
  if (!sideOf(d, playerId)) return false
  return dealHasAnything(d)
}

/** 요청이 시들었는가. 답이 없으면 그냥 사라진다. */
export const askExpired = (d: DealState, nowMs: number): boolean =>
  d.status === 'asking' && nowMs >= d.askedAtMs + DEAL_ASK_MS

/** 이제 성립시켜도 되는가. 세던 시각이 지났고 둘 다 아직 준비다. */
export const readyToSettle = (d: DealState, nowMs: number): boolean =>
  d.status === 'settling' &&
  d.a.ready &&
  d.b.ready &&
  d.settleAtMs !== null &&
  nowMs >= d.settleAtMs &&
  dealHasAnything(d)

/** 그 사람이 거래에서 무엇을 내놓는가. */
export const stakeOf = (d: DealState, playerId: string): Stake =>
  sideOf(d, playerId)?.stake ?? EMPTY_STAKE

/** 그 사람이 거래에서 무엇을 받는가. */
export const gainOf = (d: DealState, playerId: string): Stake => other(d, playerId).stake

/** 빈 판 하나. 서버가 요청을 만들 때 쓴다. */
export function newDeal(input: {
  askedBy: string
  a: { playerId: string; team: TeamId }
  b: { playerId: string; team: TeamId }
  tileId: string
  nowMs: number
}): DealState {
  const side = (p: { playerId: string; team: TeamId }): DealSide => ({
    ...p,
    ready: false,
    stake: { ...EMPTY_STAKE, items: { ...EMPTY_SATCHEL } },
  })
  return {
    status: 'asking',
    askedBy: input.askedBy,
    a: side(input.a),
    b: side(input.b),
    tileId: input.tileId,
    askedAtMs: input.nowMs,
    settleAtMs: null,
  }
}
