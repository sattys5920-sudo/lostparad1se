// 행동 여섯 가지 — 서 있어야 할 곳과 내는 것.
//
// 토큰은 여기서 빼지 않는다(tokens.ts). 이 파일은 「지금 이 행동을 걸 수
// 있는가」와 「무엇이 나가고 무엇이 들어오는가」만 답한다. 서버가 둘을
// 한 트랜잭션으로 묶는다.
//
// 어느 행동이든 발이 묶인 말은 아무것도 못 한다. 판정에는 세지만
// 움직이지도 행동하지도 못한다.
import {
  PRODUCE_MONEY,
  STUDY_KNOWLEDGE,
  type TeamId,
} from './v2'
import { type TileId } from './board'
import { type Bag, type TileState } from './resources'

export type ActionKind = 'produce' | 'study'

/** 어디에 서 있어야 하는가. */
export type Stand = 'thatTile' | 'ourTile' | 'ourZone' | 'notOurTile' | 'enemyTile'

export const ACTION_STAND: Record<ActionKind, Stand> = {
  produce: 'ourZone',
  study: 'ourZone',
}

/** 토큰 한 개가 드는 행동. 이동·표·교역·카드에는 들지 않는다. */
/**
 * 생산·공부에 드는 **시간**. 게임 속 분이다.
 *
 * **하는 동안 그 자리에 묶인다.** 값만 물리고 시간을 안 물리면,
 * 토큰이 남아 있는 한 한 방에 서서 연달아 찍어 낼 수 있다 — 그러면
 * 페이즈가 「토큰이 몇 개인가」로만 갈리고 몸이 어디 있었는지는
 * 아무 뜻이 없어진다.
 */
export const ACTION_MINUTES: Record<ActionKind, number> = {
  produce: 10,
  study: 10,
}

export const ACTION_TOKEN_COST: Record<ActionKind, number> = {
  produce: 1,
  study: 1,
}

export interface StandInput {
  kind: ActionKind
  /** 행동을 거는 사람이 선 칸. 걷는 중이면 null. */
  standingOn: TileId | null
  /** 행동의 대상 칸. */
  targetTile: TileId
  team: TeamId
  ownerOf: (tileId: TileId) => TeamId | null
}

export type StandRefusal = 'walking' | 'notThere' | 'notOurTile' | 'notOurZone' | 'ourTile' | 'notEnemyTile'

/**
 * 서 있는 자리가 맞는가.
 *
 * 「우리 영역 안」은 우리 칸 위이거나 우리 칸에 맞닿은 곳이 아니라,
 * 우리 칸 위를 말한다 — 생산과 공부는 우리 땅에서만 한다.
 *
 * **연구는 여기 없다.** 연구는 페이즈에만, 연구실에서만 한다
 * (shared/rules/occupy.ts). 자유 시간에 제 땅 아무 데서나 되던
 * 시절에는 연구실이 있으나 마나였다.
 */
export function checkStand(input: StandInput): { ok: boolean; reason: StandRefusal | null } {
  if (input.standingOn === null) return { ok: false, reason: 'walking' }
  const stand = ACTION_STAND[input.kind]
  const here = input.ownerOf(input.standingOn)

  if (stand === 'thatTile') {
    return input.standingOn === input.targetTile ? { ok: true, reason: null } : { ok: false, reason: 'notThere' }
  }
  if (stand === 'ourTile') {
    if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
    return here === input.team ? { ok: true, reason: null } : { ok: false, reason: 'notOurTile' }
  }
  if (stand === 'ourZone') {
    return here === input.team ? { ok: true, reason: null } : { ok: false, reason: 'notOurZone' }
  }
  if (stand === 'notOurTile') {
    if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
    return here === input.team ? { ok: false, reason: 'ourTile' } : { ok: true, reason: null }
  }
  // enemyTile
  if (input.standingOn !== input.targetTile) return { ok: false, reason: 'notThere' }
  return here !== null && here !== input.team
    ? { ok: true, reason: null }
    : { ok: false, reason: 'notEnemyTile' }
}

// ── 생산 ────────────────────────────────────────────────────────

export const PRODUCE_YIELD: Bag = { money: PRODUCE_MONEY }

/** 공부 한 번에 버는 것. 생산이 돈이면 이쪽은 지식이다. */
export const STUDY_YIELD: Bag = { knowledge: STUDY_KNOWLEDGE }

// ── 한데 묶어 보기 ──────────────────────────────────────────────

export interface ActionGate {
  /** 발이 묶여 있는가. */
  bound: boolean
  /** 잠들어 있어도 행동은 못 한다 — 앱이 닫혀 있다는 뜻이다. */
  asleep: boolean
}

export type GateRefusal = 'bound' | 'asleep'

export function checkGate(gate: ActionGate): { ok: boolean; reason: GateRefusal | null } {
  if (gate.bound) return { ok: false, reason: 'bound' }
  if (gate.asleep) return { ok: false, reason: 'asleep' }
  return { ok: true, reason: null }
}

/** 그 칸이 우리 것인지 보는 짧은 도우미. 시험과 서버가 같이 쓴다. */
export function ownerLookup(tiles: readonly TileState[]): (tileId: TileId) => TeamId | null {
  const map = new Map(tiles.map((t) => [t.tileId, t.ownerTeam]))
  return (tileId) => map.get(tileId) ?? null
}
