// 카드 열두 장.
//
// 연구할 때마다 무작위로 한 장. 손패는 네 장까지. 카드 내용은 우리 팀만
// 알고, 몇 장 쥐었는지만 모두에게 보인다 — 그래서 손패는 secret/에 두고
// 팀 문서에는 장수만 적는다(model.ts의 TeamDoc.handCount).
//
// 카드를 쓰는 데는 토큰이 들지 않는다. 그 대신 한 장은 한 번이다.
import {
  CARDS,
  CARD_ACCORD_MONEY,
  CARD_BLOCKADE_GAME_HOURS,
  CARD_CRAMMING_KNOWLEDGE,
  CARD_FALSE_RUMOR_INFLUENCE,
  CARD_FORCED_MARCH_TILES,
  CARD_HIDE_GAME_HOURS,
  CARD_REINFORCE_DEFENSE,
  CARD_REINFORCE_REAL_HOURS,
  CARD_SECRET_LETTER_REAL_HOURS,
  CARD_WINDFALL_MONEY,
  CARD_BY_KIND,
  HAND_LIMIT,
  type CardKind,
  type TeamId,
} from './v2'
import { addActiveSeconds } from './clock'
import type { TileId } from './board'
import type { Bag } from './buildings'

const HOUR_MS = 3_600_000

// ── 뽑기 ────────────────────────────────────────────────────────

export interface DrawResult {
  hand: CardKind[]
  drawn: CardKind
  /** 손패가 차 있어 그대로 버렸는가. */
  discarded: boolean
}

/**
 * 연구가 주는 한 장. 씨앗을 받아 서버가 정한다.
 *
 * 손패가 네 장이면 뽑은 카드가 그대로 사라진다 — 무엇을 버릴지 고르게
 * 하지 않는다. 손패를 비워 두지 않으면 손해라는 게 규칙의 압력이다.
 */
export function drawCard(hand: readonly CardKind[], roll: number): DrawResult {
  const i = Math.floor(Math.max(0, Math.min(0.999999, roll)) * CARDS.length)
  const drawn = CARDS[i].kind
  if (hand.length >= HAND_LIMIT) return { hand: [...hand], drawn, discarded: true }
  return { hand: [...hand, drawn], drawn, discarded: false }
}

/** 손패에서 한 장을 뺀다. 같은 카드가 여러 장이면 하나만. */
export function playCard(hand: readonly CardKind[], kind: CardKind): CardKind[] | null {
  const i = hand.indexOf(kind)
  if (i < 0) return null
  return [...hand.slice(0, i), ...hand.slice(i + 1)]
}

// ── 카드가 하는 일 ──────────────────────────────────────────────

/** 카드 하나를 쓰면 무엇이 바뀌는가. 서버가 이 값을 보고 문서를 고친다. */
export interface CardEffect {
  kind: CardKind
  /** 자원이 바로 들어온다. */
  gain?: Bag
  /** 대상 팀 영향력이 깎인다. */
  influenceHit?: { team: TeamId; amount: number }
  /** 칸에 붙는 것. */
  tile?: { tileId: TileId; reinforce?: number; blockedUntilMs?: number; untilRealMs?: number }
  /** 말에 붙는 것. */
  pawn?: { playerId: string; hiddenUntilMs?: number; jumpTiles?: number }
  /** 다음 한 번만 걸리는 표시. */
  pending?: 'ambush' | 'quickBuild' | 'accord'
  /** 비밀 대화방이 열리는 시각(실제 시계). */
  roomUntilRealMs?: number
  /** 가짜 깃발인가. 이 사실은 secret/에만 적는다. */
  fakeFlag?: boolean
}

export interface PlayInput {
  kind: CardKind
  team: TeamId
  nowMs: number
  /** 실제 시계. 견제·보강처럼 소등을 세는 것들이 쓴다. */
  realNowMs: number
  targetTeam?: TeamId
  targetTile?: TileId
  targetPawn?: string
}

/**
 * 카드 한 장의 결과.
 *
 * 지속 시간의 기준이 카드마다 다르다. 보강(24시간)·밀서(1시간)는 실제
 * 시계, 봉쇄(6시간)·잠복(6시간)은 게임 시계다 — 소등 동안 깃발이 멈춰
 * 있으니 봉쇄도 같이 멈춰야 앞뒤가 맞는다.
 */
export function cardEffect(input: PlayInput): CardEffect {
  const k = input.kind
  switch (k) {
    case 'windfall':
      return { kind: k, gain: { money: CARD_WINDFALL_MONEY } }
    case 'cramming':
      return { kind: k, gain: { knowledge: CARD_CRAMMING_KNOWLEDGE } }
    case 'falseRumor':
      return {
        kind: k,
        influenceHit: input.targetTeam
          ? { team: input.targetTeam, amount: CARD_FALSE_RUMOR_INFLUENCE }
          : undefined,
      }
    case 'reinforce':
      return {
        kind: k,
        tile: input.targetTile
          ? {
              tileId: input.targetTile,
              reinforce: CARD_REINFORCE_DEFENSE,
              untilRealMs: input.realNowMs + CARD_REINFORCE_REAL_HOURS * HOUR_MS,
            }
          : undefined,
      }
    case 'blockade':
      return {
        kind: k,
        tile: input.targetTile
          ? {
              tileId: input.targetTile,
              blockedUntilMs: addActiveSeconds(input.nowMs, CARD_BLOCKADE_GAME_HOURS * 3600),
            }
          : undefined,
      }
    case 'ambushHide':
      return {
        kind: k,
        pawn: input.targetPawn
          ? {
              playerId: input.targetPawn,
              hiddenUntilMs: addActiveSeconds(input.nowMs, CARD_HIDE_GAME_HOURS * 3600),
            }
          : undefined,
      }
    case 'forcedMarch':
      return {
        kind: k,
        pawn: input.targetPawn
          ? { playerId: input.targetPawn, jumpTiles: CARD_FORCED_MARCH_TILES }
          : undefined,
      }
    case 'secretLetter':
      return { kind: k, roomUntilRealMs: input.realNowMs + CARD_SECRET_LETTER_REAL_HOURS * HOUR_MS }
    case 'fakeFlag':
      return { kind: k, fakeFlag: true, tile: input.targetTile ? { tileId: input.targetTile } : undefined }
    case 'ambush':
      return { kind: k, pending: 'ambush' }
    case 'quickBuild':
      return { kind: k, pending: 'quickBuild' }
    case 'accord':
      return { kind: k, pending: 'accord' }
  }
}

/** 협정서가 붙은 교역이 성립하면 양쪽이 받는 돈. */
export const ACCORD_GAIN: Bag = { money: CARD_ACCORD_MONEY }

export type PlayRefusal = 'notInHand' | 'needsTeam' | 'needsTile' | 'needsPawn' | 'ownTeam'

/** 고를 것을 다 골랐는가. */
export function checkPlay(hand: readonly CardKind[], input: PlayInput): { ok: boolean; reason: PlayRefusal | null } {
  if (!hand.includes(input.kind)) return { ok: false, reason: 'notInHand' }
  const spec = CARD_BY_KIND[input.kind]
  if (spec.needsTeam && !input.targetTeam) return { ok: false, reason: 'needsTeam' }
  if (spec.needsTeam && input.targetTeam === input.team) return { ok: false, reason: 'ownTeam' }
  if (spec.needsTile && !input.targetTile) return { ok: false, reason: 'needsTile' }
  if (spec.needsPawn && !input.targetPawn) return { ok: false, reason: 'needsPawn' }
  return { ok: true, reason: null }
}
