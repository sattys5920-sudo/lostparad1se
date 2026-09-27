// 탑 쌓기 — 돌아가며 흔들리는 블록을 떨어뜨려 다 같이 쌓는다.
//
// 블록은 좌우로 오간다. 제 차례에 누르면 그 자리에서 떨어져
// 아래 블록과 겹친 만큼만 남고 삐져나간 부분은 잘려 나간다. 하나도 안
// 겹치면 탑이 무너진다. **거의 딱 맞으면(TOWER_SNAP) 안 잘린다.**
//
// 어디에 떨어졌는지는 서버가 정한다. 화면은 「차례가 열리고 몇 ms 뒤에
// 눌렀다」만 보낸다 — 흔들림은 높이와 시각의 함수라, 서버가 같은 식으로
// 자리를 낸다. 높이가 오를수록 빨리 오간다.
//
// 다 같이 한편이다. TOWER_GOAL 층을 넘기면 다 같이 깬다.
import type { ArcadeOutcome } from './arcade'

export const TOWER_BASE_W = 60
/** 좌우로 오가는 폭(가운데에서 한쪽 끝까지). */
export const TOWER_SWING = 70
/**
 * 한쪽 끝에서 반대쪽 끝까지 가는 시간. 한 층 오를 때마다 줄어든다.
 *
 * **일정한 빠르기로 오간다(사인파가 아니다).** 사인파로 흔들면 가운데를
 * 지날 때 제일 빠르다 — 맞춰야 할 자리에서 제일 빠르니, 사람 손이 흔히
 * 내는 50ms 어긋남에 한 번에 열 칸씩 잘려 서너 층에서 무너졌다. 실제로
 * 그랬다. 일정하게 오가면 어디서든 같은 빠르기라 눈으로 맞출 수 있다.
 */
export const TOWER_CROSS_MS = 2000
export const TOWER_CROSS_MIN_MS = 600
/** 쉽게 시작해 어려워진다 — 열다섯 층쯤이면 바닥(0.6초)에 닿는다 */
export const TOWER_SPEEDUP_MS = 95
/** 이 안으로 떨어지면 딱 맞은 것으로 치고 안 자른다. 첫 층 빠르기로 ±70ms 쯤이다. */
export const TOWER_SNAP = 5
/** 제 차례에 이만큼 안 누르면 그 자리에서 저절로 떨어진다. */
export const TOWER_TURN_MS = 7000
/** 떨어지고 다음 사람 차례까지. 떨어지는 것을 보여 주는 시간 */
export const TOWER_NEXT_MS = 700
export const TOWER_GOAL = 10
/** 여기까지 쌓으면 더 안 쌓고 끝낸다. */
export const TOWER_MAX = 40

export interface Block {
  x: number
  w: number
}

export interface TowerState {
  /** [0] 은 바닥 블록이다. 높이는 length−1. */
  blocks: Block[]
  /** 차례. 방에 든 순서. 누가 나가면 빠진다. */
  order: string[]
  turn: number
  /** 지금 차례가 열린 시각(벽시계). 흔들림은 여기서부터 잰다. */
  turnAtMs: number
  fell: boolean
  /** 마지막으로 떨어뜨린 것. 화면이 번쩍 보여 준다. */
  last: { by: string; perfect: boolean; cut: number } | null
}

export const towerHeight = (s: Pick<TowerState, 'blocks'>): number => s.blocks.length - 1

export const towerCross = (height: number): number => Math.max(TOWER_CROSS_MIN_MS, TOWER_CROSS_MS - height * TOWER_SPEEDUP_MS)

/**
 * 그 높이에서 차례가 열리고 t ms 뒤 블록의 가운데. 짝수 층은 왼쪽 끝,
 * 홀수 층은 오른쪽 끝에서 출발해 일정한 빠르기로 오간다.
 */
export function swingX(height: number, t: number): number {
  const u = (Math.max(0, t) / towerCross(height)) % 2
  const along = u < 1 ? u : 2 - u
  const dir = height % 2 === 0 ? 1 : -1
  return dir * (-TOWER_SWING + 2 * TOWER_SWING * along)
}

/** 처음으로 x 에 닿는 때. 봇과 시험이 「딱 맞게」 떨어뜨릴 때 쓴다. */
export function towerHitT(height: number, x: number): number {
  const dir = height % 2 === 0 ? 1 : -1
  return (towerCross(height) * (dir * x + TOWER_SWING)) / (2 * TOWER_SWING)
}

export function towerNew(order: readonly string[], startAtMs: number): TowerState {
  return { blocks: [{ x: 0, w: TOWER_BASE_W }], order: [...order], turn: 0, turnAtMs: startAtMs, fell: false, last: null }
}

export const whoseTurn = (s: TowerState): string | null => (s.fell || s.order.length === 0 ? null : s.order[s.turn % s.order.length])

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * 떨어뜨린다. t 는 차례가 열리고 몇 ms 뒤인가(화면이 잰다). 서버가
 * 흔들림 식으로 자리를 내고 아래 블록과 겹친 만큼만 남긴다.
 */
export function towerDrop(s: TowerState, by: string, tRaw: number, nowMs: number): TowerState {
  const t = Math.max(0, Math.min(TOWER_TURN_MS, Number.isFinite(tRaw) ? tRaw : TOWER_TURN_MS))
  const h = towerHeight(s)
  const top = s.blocks[h]
  const x = swingX(h, t)
  const next = { ...s, turn: s.turn + 1, turnAtMs: nowMs + TOWER_NEXT_MS }
  if (Math.abs(x - top.x) <= TOWER_SNAP) {
    return { ...next, blocks: [...s.blocks, { ...top }], last: { by, perfect: true, cut: 0 } }
  }
  const left = Math.max(x - top.w / 2, top.x - top.w / 2)
  const right = Math.min(x + top.w / 2, top.x + top.w / 2)
  if (right - left <= 0) return { ...next, fell: true, last: { by, perfect: false, cut: top.w } }
  const w = round2(right - left)
  return {
    ...next,
    blocks: [...s.blocks, { x: round2((left + right) / 2), w }],
    last: { by, perfect: false, cut: round2(top.w - w) },
  }
}

/** 판이 끝났는가. 무너졌거나 끝 높이에 닿았거나. */
export const towerOver = (s: TowerState): boolean => s.fell || towerHeight(s) >= TOWER_MAX || s.order.length === 0

export const towerOutcome = (s: TowerState): ArcadeOutcome => (towerHeight(s) >= TOWER_GOAL ? 'win' : 'lose')

/** 누가 나갔다. 차례에서 빼고, 그 사람 차례였으면 다음 사람에게 새로 연다. */
export function towerLeave(s: TowerState, id: string, nowMs: number): TowerState {
  const at = s.order.indexOf(id)
  if (at < 0) return s
  const wasTurn = whoseTurn(s) === id
  const order = s.order.filter((o) => o !== id)
  const cur = s.turn % Math.max(1, s.order.length)
  const turn = order.length === 0 ? 0 : (at < cur ? cur - 1 : cur) % order.length
  return { ...s, order, turn, turnAtMs: wasTurn ? nowMs : s.turnAtMs }
}
