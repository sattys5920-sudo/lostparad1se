// myPaper 가 오가는 모양. **서버와 화면이 같은 이 파일을 본다.**
//
// 전에는 두 군데에 따로 적혀 있었다. 서버가 인연 미션을 쪽지 미션으로
// 바꿨을 때 화면 쪽 타입은 그대로 bond 를 들고 있었고, 콜러블 응답이
// any 로 넘어오는 탓에 컴파일도 시험도 조용히 지나갔다. 「나」 탭을
// 여는 순간 undefined.text 로 터졌다.
//
// **타입과 말 한 줄뿐인 파일이다.** judge·roles 는 import type 으로만
// 부르므로 화면이 이 파일을 불러도 그 알맹이는 번들에 안 실린다
// (verbatimModuleSyntax) — scripts/check-bundle.ts 가 그걸 본다.
import type { MissionView } from './judge'

/**
 * 배정 전이라 명단에 내 줄이 아직 없을 때 서버가 돌려주는 말.
 *
 * **고장이 아니다.** 화면은 이 말이 오면 「못 받아왔다 —」를 붙이지
 * 않고 다시 시도 단추도 안 단다 — 운영자가 배정을 누를 때까지 몇 번을
 * 눌러도 같다. 서버와 화면이 같은 글자를 봐야 해서 여기 둔다.
 */
export const NOT_DEALT = '아직 배정되지 않았다.'

/**
 * 「나」 탭 한 장.
 *
 * **여기 있는 것은 전부 본인 몫이다.** 남의 역할도, 남이 무엇을 숨기고
 * 있는지도, 누가 나에게 표를 줬는지도 들어 있지 않다.
 */
export interface MyPaperDoc {
  roleId: string
  roleName: string
  /** 역할 카드 맨 위 한 줄. */
  flavor: string
  /** 조건 표 아래 단서(문서 원문). 없으면 null */
  footnote: string | null
  /** 학생증 뒷면 「그해 겨울, 나는」 문단들. 내 것만 온다 */
  situation: readonly string[]
  /** 미션 한 줄 — 「이번에는 …」 */
  line: string
  /** 짝사랑만 채워진다. **이름뿐이고** 어디 있는지 · 어느 팀인지는 안 온다 */
  targetName: string | null
  /**
   * 진행도를 세고 있는가. 로비에서는 false 다 — 칸도 지갑도 아직
   * 안 놓여서 셀 것이 없다. 미션 **문장**은 그때도 온다.
   */
  counting: boolean
  main: MissionView
  /** 종류별 합계다. **누가 줬는지는** 끝까지 안 온다. */
  votesReceived: { trust: number; liking: number }
  /** 표를 어디까지 셌는가. 화면이 「어제까지」라고 적는다. */
  votesThroughDay: number
}
