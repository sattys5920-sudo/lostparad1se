// A의 마지막 쪽지 — 연출 시간표만 여기 있다.
//
// **문장은 없다.** 화면 코드에 A의 문장을 적으면 번들 누출 검사에
// 걸린다(scripts/check-bundle.ts) — 서버(functions/src/story/finalNote.ts)
// 에서 종례가 끝난 뒤에만 받아 온다. 여기 있는 것은 「몇 번째 줄이 언제
// 타이핑을 시작하는가」 같은, 내용과 상관없는 숫자뿐이다.

/** 줄마다 타이핑이 시작되는 시각(ms, 재생 시작을 0으로). 문장 다섯 줄에 맞춰 뒀다. */
export const FINAL_NOTE_STARTS: readonly number[] = [300, 2100, 4100, 5300, 6900]
/** 줄마다 타이핑에 걸리는 시간(ms). */
export const FINAL_NOTE_TYPE_MS: readonly number[] = [1500, 1700, 900, 1400, 1400]
/** 다 쓴 뒤, 찢기 시작까지 멈추는 시각(ms). */
export const FINAL_NOTE_TEAR_START = 9200
/** 찢겨 사라지기까지 걸리는 시간(ms) — TEAR_START 뒤로 얼마나 더 도는가. */
export const FINAL_NOTE_TEAR_MS = 2500
/** 한 번 다 도는 데 걸리는 총 시간(ms). onDone 이 이 시각 근처에 불린다. */
export const FINAL_NOTE_TOTAL_MS = FINAL_NOTE_TEAR_START + FINAL_NOTE_TEAR_MS
