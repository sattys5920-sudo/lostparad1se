// 닷새.
//
// **날에 이름도, 「오늘 일어나는 일」 카드도 없다.** 한때는 아침마다
// 「DAY 2 · 소문」과 그날의 예고를 띄웠다. 그러면 아침이 안내판이 되고,
// 그날 무엇을 느낄지를 화면이 먼저 말해 버린다 — 느끼는 것은 겪는
// 사람의 몫이다. 아침에 남는 것은 A의 기록 한 장뿐이다.
//
// 방이 날마다 열리는 규칙(CORE_OPENING)은 그대로다. 열린 것은 지도를
// 보면 안다. 열린다고 미리 적어 두지 않을 뿐이다.
import { TOTAL_DAYS } from '../rules/v2'

export const DAYS: readonly number[] = Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1)
