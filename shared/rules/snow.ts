// 눈이 그친 아침.
//
// **딛고 서 있던 두 축이 없어졌다.** 원래는 깨달음에 이른 사람이 아홉,
// 털어놓은 사람이 일곱이면 눈이 그쳤다. 추리 층을 걷어내면서 둘 다
// 나갔다 — 숨긴 사실이 없으니 털어놓을 것이 없고, 목격담 자리가
// 없으니 깨달을 자리도 없다.
//
// 지금은 A의 기록이 열린 날 수로 돈다. 닷새에 걸쳐 다섯 장이 열리고,
// 마지막 장이 열린 아침에 눈이 그친다. **자리를 지키는 임시 배선이다**
// — 「열넷이 함께 채운다」는 뜻은 여기 없다. 무엇으로 되돌릴지는
// 아직 안 정했다.
//
// 조건 숫자는 공개하지 않는다. 화면에는 단계 값(0~5)만 내려보낸다.
import { SNOW_LEVEL_MAX, TOTAL_DAYS } from './v2'

export interface Progress {
  /** A의 기록이 열린 날 수. */
  released: number
}

/** 다섯 장이 다 열렸는가. */
export function snowStopped(p: Progress): boolean {
  return p.released >= TOTAL_DAYS
}

/** 지금 눈발의 세기. 5가 가장 굵고 0이 그친 것이다. */
export function snowLevel(p: Progress): number {
  if (snowStopped(p)) return 0
  const done = Math.min(1, Math.max(0, p.released) / TOTAL_DAYS)
  // 진행이 0이면 5, 다 차면 1(그치기 직전). 0은 오직 다 열렸을 때다
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
