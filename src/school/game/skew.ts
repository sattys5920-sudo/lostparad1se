// 기기 시계 보정 — 서버 시각과 이 폰의 시각이 얼마나 어긋나는가.
//
// 폰 시계가 10분 빠르면 페이즈 타이머가 10분 먼저 「끝」을 찍고,
// 10분 느리면 끝난 뒤에도 움직일 수 있는 것처럼 보인다. 판정은 늘
// 서버가 하니 실제로 어긋나는 것은 화면뿐이지만, 화면이 틀리면 사람이
// 틀린 대로 움직인다. 그래서 들어올 때와 화면이 다시 켜질 때 서버에
// 시각을 한 번 묻고, 그 차이를 모든 시계 계산에 더한다.
//
//   skew = 서버의 실제 시각 − 이 기기의 실제 시각
//
// 서버는 게임 속 시각(nowMs)을 주므로, 개발용 시계가 걸려 있으면 그
// 시계로 실제 시각으로 되돌려 잰다(realTimeOf). 요청이 오가는 시간은
// 절반씩 나눠 가운데 시각으로 친다.
import { realTimeOf, type DevClock } from '../../../shared/rules/clock'

let skewMs = 0
let measuredAt = 0
const listeners = new Set<() => void>()

/** 지금 알고 있는 어긋남(ms). 잰 적이 없으면 0 */
export const getSkewMs = (): number => skewMs

/** 이 기기의 시각을 서버 시각으로 맞춘 값 */
export const correctedNow = (): number => Date.now() + skewMs

/** 다시 재면 알려 달라 — 화면이 바로 고쳐 그린다 */
export function onSkew(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 잰 값을 받아 적는다. 왕복 시간이 너무 길면(느린 망) 믿지 않는다 */
export function applyProbe(serverGameMs: number, clock: DevClock | undefined, sentAtMs: number, gotAtMs: number): number | null {
  const trip = gotAtMs - sentAtMs
  if (trip > 5000) return null
  const serverRealMs = realTimeOf(serverGameMs, clock) + trip / 2
  const next = Math.round(serverRealMs - gotAtMs)
  // 1초 미만은 잡음이다 — 초마다 다시 그리는 것들을 흔들지 않는다
  if (Math.abs(next - skewMs) >= 1000 || measuredAt === 0) {
    skewMs = next
    measuredAt = gotAtMs
    for (const fn of listeners) fn()
  } else {
    measuredAt = gotAtMs
  }
  return skewMs
}

/** 마지막으로 잰 뒤 이만큼 지났으면 다시 잰다 */
export const STALE_MS = 10 * 60_000

export const isStale = (nowMs = Date.now()): boolean => measuredAt === 0 || nowMs - measuredAt > STALE_MS

/** 시험용 — 잰 값을 지운다 */
export function resetSkew(): void {
  skewMs = 0
  measuredAt = 0
}
