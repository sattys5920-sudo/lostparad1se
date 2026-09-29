// 개인 미션 판정이 본인에게 닿는 모양. **서버와 화면이 같은 이 파일을 본다.**
//
// 운영자가 「보내기」를 누르면 서버가 games/{판}/inbox/{사람} 에 적는다.
// 그 문서는 본인만 읽는다(firestore.rules). 보내기 전에는 아무 데도 없다 —
// 자정 판정은 secret 아래에만 있다(functions/src/missionDays.ts).
//
// **타입뿐인 파일이다.** 화면이 불러도 역할 데이터는 번들에 안 실린다.
import type { DayClauseView, DayStatus } from './daily'
import type { NoteItem, NotifySettings } from '../notify/notifyData'

/** 그날 판정 한 장 — 본인 몫 */
export interface MissionMail {
  day: number
  /** 마지막 날 — 마지막 선택까지 정해진 최종 판정 */
  final: boolean
  /** 그날의 결과. 운영자가 뒤집었으면 뒤집은 값 */
  status: DayStatus
  clauses: DayClauseView[]
  choice: DayStatus
  /** 내 역할 이름과 미션 한 줄(「이번에는 …」) */
  roleName: string
  line: string
  sentAtMs: number
}

/** games/{판}/inbox/{사람} */
export interface InboxDoc {
  /** 날짜별 판정. 키는 d1 · d2 … */
  missions?: Record<string, MissionMail>
  /** 팝업을 닫은 날. 키는 d1 · d2 … */
  seen?: Record<string, boolean>
  /** 알림 보관함 — 최근 것부터 ARCHIVE_MAX 줄(shared/notify/notifyData.ts) */
  notes?: NoteItem[]
  /** 보관함을 여기까지 읽었다. 이보다 새 줄에 점이 찍힌다 */
  notesReadAtMs?: number
  /** 알림 설정. 없으면 기본값(settingsOf) */
  settings?: Partial<NotifySettings>
}

/**
 * 그날 미션 결과를 **모두에게** 알린 한 장. games/{판} 문서의 missionBoards 에 든다.
 *
 * **이름과 해냈는지만.** 역할도 조건도 숫자도 없다 — 「민수 성공 · 예지
 * 실패」까지다. 운영자가 「전체 공개」를 눌러야 생긴다(hostMissionBoard).
 * 사람 이름은 싣지 않는다 — 화면이 seats 에서 찾는다.
 */
export interface MissionBoard {
  day: number
  final: boolean
  /** 공개한 시각. 다시 공개하면 바뀐다 — 화면이 새 종이로 띄운다 */
  atMs: number
  /** 자리 순서 그대로. 해냈으면 true */
  rows: { playerId: string; met: boolean }[]
}
