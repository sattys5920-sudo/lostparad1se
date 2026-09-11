// 그 자리와 깨달음.
//
// 모든 역할에는 **그 자리**가 있다. 내가 A에게 그 일을 했던 곳이다.
// 거기 누적 세 시간을 서 있으면 A의 시선이 열리고, 깨달음 +1이 붙는다.
//
// **역할과 그 자리의 짝은 이 파일에 없다.** 그 짝을 알면 누가 어디에
// 오래 서 있는지만 보고 역할을 역산할 수 있다 — 창고에 세 시간 서 있는
// 사람은 지킴이 아니면 거짓말쟁이다. 짝은 서버 전용 데이터에 둔다.
//
// 여기 있는 것은 「얼마나 서면 열리는가」뿐이다.
import { AWAKENING_STAY_GAME_HOURS, INVISIBLE_STAY_MULTIPLIER } from '../rules/v2'
import { activeSecondsBetween } from '../rules/clock'
import type { Interval } from '../rules/presence'
import type { TileId } from '../rules/board'

export const AWAKENING_NEED_SEC = AWAKENING_STAY_GAME_HOURS * 3600

/** 그 사람이 투명인간이었던 구간. 그동안은 체류가 두 배로 쌓인다. */
export interface InvisibleSpan {
  playerId: string
  startMs: number
  endMs: number
}

/** 판정에 세는 상태. 걷는 중은 빼고, 잠든 말은 넣는다. */
const COUNTS = new Set(['standing', 'asleep'])

function overlap(a: [number, number], b: [number, number]): number {
  const start = Math.max(a[0], b[0])
  const end = Math.min(a[1], b[1])
  return end > start ? activeSecondsBetween(start, end) : 0
}

/**
 * 그 자리에 쌓인 시간(활동 초). 투명인간이었던 구간은 두 번 센다.
 *
 * 지워져 본 사람이 가장 빨리 이해한다.
 */
export function placeSeconds(
  intervals: readonly Interval[],
  playerId: string,
  placeTile: TileId,
  invisibleSpans: readonly InvisibleSpan[],
  fromMs: number,
  toMs: number,
): number {
  let total = 0
  for (const iv of intervals) {
    if (iv.playerId !== playerId || iv.tileId !== placeTile) continue
    if (!COUNTS.has(iv.state)) continue
    const start = Math.max(iv.startMs, fromMs)
    const end = Math.min(iv.endMs ?? toMs, toMs)
    if (end <= start) continue

    total += activeSecondsBetween(start, end)
    // 투명인간이었던 만큼 한 번 더
    for (const span of invisibleSpans) {
      if (span.playerId !== playerId) continue
      total += overlap([start, end], [span.startMs, span.endMs]) * (INVISIBLE_STAY_MULTIPLIER - 1)
    }
  }
  return total
}

export interface AwakeningProgress {
  /** 쌓인 초. */
  have: number
  /** 필요한 초. */
  need: number
  /** A의 시선이 열렸는가. */
  open: boolean
}

export function awakeningOf(
  intervals: readonly Interval[],
  playerId: string,
  placeTile: TileId,
  invisibleSpans: readonly InvisibleSpan[],
  fromMs: number,
  toMs: number,
): AwakeningProgress {
  const have = placeSeconds(intervals, playerId, placeTile, invisibleSpans, fromMs, toMs)
  return { have, need: AWAKENING_NEED_SEC, open: have >= AWAKENING_NEED_SEC }
}

/** 깨달음에 이른 사람 수. 눈이 그치는 조건이 이걸 쓴다. */
export function awakenedCount(progress: readonly AwakeningProgress[]): number {
  return progress.filter((p) => p.open).length
}
