// 그날의 전말. **서버 전용 · 종례 뒤에만.**
//
// 엔딩 4번 장면. 역할 이름이 실제 참가자 이름으로 바뀌어 한 줄씩 열린다.
// 한 줄이 나타날 때마다 그 사람의 도트 캐릭터가 눈 속에 선다.
//
// 출처: personal_missions_v3.md 5장. 시간순은 scenario_reveal.md 2장의
// 뼈대와 같다.
import type { RoleId } from '../../../shared/missions/roles'

export interface AftermathLine {
  /** 때. 화면 왼쪽에 작게 붙는다. */
  when: string
  /** 일어난 일. */
  what: string
  /** 누가. 두 사람이면 둘 다 선다. */
  who: readonly RoleId[]
}

export const AFTERMATH: readonly AftermathLine[] = [
  { when: '학기 초', what: "싸움을 줄이자며 익명 투표 '투명인간'을 만든다", who: ['mediator'] },
  { when: '학기 초', what: '전학 오자마자 A의 옛 소문을 먼저 퍼뜨린다', who: ['transfer'] },
  {
    when: '가을',
    what: '도서관 자리 다툼 끝에 처음으로 A의 이름을 적는다. 그 뒤 A는 몇 주째 뽑힌다',
    who: ['librarian'],
  },
  { when: '가을', what: 'A가 털어놓은 비밀을 수첩에 적는다. 페이지가 사라져도 입을 다문다', who: ['notebook'] },
  { when: '가을', what: '그 페이지로 매주 A에게서 돈을 받는다', who: ['shadow'] },
  { when: '겨울', what: 'A의 마지막 부탁을 추천서 때문에 거절한다', who: ['leaver'] },
  { when: '마지막 금요일', what: '다음이 자기가 될까 봐 A의 이름을 적는다', who: ['buddy'] },
  { when: '마지막 금요일', what: 'A가 돈을 못 주자 비밀을 단톡방에 올린다', who: ['shadow'] },
  {
    when: '방학식 전날',
    what: '다섯 시 창고 앞에서 기다린다는 편지를 쓰고, 가지 않는다',
    who: ['letter'],
  },
  { when: '17:10', what: '무섭다는 A의 메시지를 캡처해 단톡방에 올린다', who: ['accuser'] },
  {
    when: '17:30',
    what: '메시지를 보고 창고로 가서 A를 밀어 넣고 휴대폰을 뺏는다',
    who: ['vanguard', 'liar'],
  },
  { when: '17:30', what: '복도 끝에서 그 장면을 보고 고개를 돌린다', who: ['witness'] },
  { when: '18:00', what: '먼저 나오면서 창고 문을 닫는다', who: ['liar'] },
  { when: '19:00', what: '안에서 소리가 났지만 자물쇠를 채운다', who: ['guard'] },
  { when: '21:00', what: '문 두드리는 소리를 듣고 이어폰 볼륨을 올린다', who: ['bystander'] },
  { when: '다음 날 아침', what: '자물쇠를 연다. A가 발견된다', who: ['guard'] },
  { when: '그 뒤', what: 'A의 기록을 모으고, 자기 이름이 적힌 한 장을 숨긴다', who: ['librarian'] },
]

/** 전말이 끝나면 열넷이 모두 화면에 선다. */
export const AFTERMATH_CLOSING = '열네 명 중 누구 하나만 달랐어도, A는 그 밤을 넘겼을지 모른다.'
