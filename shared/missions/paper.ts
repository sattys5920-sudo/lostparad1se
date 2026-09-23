// myPaper 가 오가는 모양. **서버와 화면이 같은 이 파일을 본다.**
//
// 전에는 두 군데에 따로 적혀 있었다. 서버가 인연 미션을 쪽지 미션으로
// 바꿨을 때 화면 쪽 타입은 그대로 bond 를 들고 있었고, 콜러블 응답이
// any 로 넘어오는 탓에 컴파일도 시험도 조용히 지나갔다. 「나」 탭을
// 여는 순간 undefined.text 로 터졌다.
//
// **타입만 있는 파일이다.** 화면이 import type 으로 부르면 한 줄도
// 번들에 안 실린다(verbatimModuleSyntax). judge·roles 의 알맹이는
// 여기로 새지 않는다 — scripts/check-bundle.ts 가 그걸 본다.
import type { MissionView, SlipMissionView } from './judge'
import type { MissionStatus } from './roleNames'

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
  /** 짝사랑만 채워진다. 이름뿐이고 어디 있는지는 안 온다. */
  footnote: string | null
  /**
   * 진행도를 세고 있는가. 로비에서는 false 다 — 칸도 지갑도 아직
   * 안 놓여서 셀 것이 없다. 미션 **문장**은 그때도 온다.
   */
  counting: boolean
  main: MissionView
  /** 쪽지를 주우면서 따라붙는다. 안 주웠으면 빈 목록이다. */
  slips: SlipMissionView[]
  /** 마지막 선택. 끝나야 판정한다. */
  choice: MissionStatus
  /** 합계뿐이다. 신뢰인지 호감인지도, 누가 줬는지도 안 온다. */
  votesReceived: number
  /** 표를 어디까지 셌는가. 화면이 「어제까지」라고 적는다. */
  votesThroughDay: number
}
