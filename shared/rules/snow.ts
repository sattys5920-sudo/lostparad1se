// 눈이 그친 아침.
//
// 팀 승패와 상관없이 열넷 모두에게 걸린 목표가 하나 있다. 깨달음에 이른
// 사람이 아홉, 털어놓은 사람이 일곱이면 눈이 그친다.
//
// **조건 숫자는 공개하지 않는다.** 대신 눈발이 알려 준다. 그래서 화면에는
// 정확한 수치 대신 단계 값(0~5)만 내려보낸다 — 「여덟 명」이라고 알려 주면
// 남은 하나를 찾아 몰아붙이게 된다.
import { SNOW_AWAKENED_NEEDED, SNOW_LEVEL_MAX, SNOW_REVEALED_NEEDED } from './v2'

export interface Progress {
  /** 깨달음에 이른 사람 수. */
  awakened: number
  /** 어떤 형태로든 털어놓은 사람 수. */
  revealed: number
}

/** 두 조건을 모두 채웠는가. */
export function snowStopped(p: Progress): boolean {
  return p.awakened >= SNOW_AWAKENED_NEEDED && p.revealed >= SNOW_REVEALED_NEEDED
}

/**
 * 지금 눈발의 세기. 5가 가장 굵고 0이 그친 것이다.
 *
 * 두 조건의 진행률 중 **덜 찬 쪽**을 따른다. 한쪽만 채우면 눈은 거의
 * 그대로다 — 깨닫기만 해서도, 털어놓기만 해서도 안 된다.
 */
export function snowLevel(p: Progress): number {
  if (snowStopped(p)) return 0
  const a = Math.min(1, Math.max(0, p.awakened) / SNOW_AWAKENED_NEEDED)
  const r = Math.min(1, Math.max(0, p.revealed) / SNOW_REVEALED_NEEDED)
  const done = Math.min(a, r)
  // 진행이 0이면 5, 다 차면 1(그치기 직전). 0은 오직 두 조건을 다 채웠을 때다
  return Math.max(1, Math.ceil(SNOW_LEVEL_MAX * (1 - done)))
}

/** 화면에 내려보낼 전부. 사람 수는 들어 있지 않다. */
export interface SnowView {
  level: number
  stopped: boolean
}

export function snowView(p: Progress): SnowView {
  return { level: snowLevel(p), stopped: snowStopped(p) }
}

export type CommonEnding = 'snowStopped' | 'snowKept'

export function commonEndingOf(p: Progress): CommonEnding {
  return snowStopped(p) ? 'snowStopped' : 'snowKept'
}
