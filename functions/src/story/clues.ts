// 추리 지도. **서버 전용 · 운영자 대시보드에만.**
//
// 어떤 단서가 어떤 역할을 가리키는지 정리한 표다. 날카로운 플레이어가
// 닷새 안에 도달할 수 있는 결론의 한계를 운영자가 알고 있어야 한다.
//
// 운영자는 이걸 알고 있되 **절대 먼저 말하지 않는다.**
// 출처: scenario_reveal.md 4장.
import type { RoleId } from '../../../shared/missions/roles'

/** 엔딩 전에 이 역할이 드러날 수 있는가. */
export type Exposure = 'byDeduction' | 'possible' | 'onlyByOwnReveal'

export const EXPOSURE_LABEL: Record<Exposure, string> = {
  byDeduction: '추리로 가능',
  possible: '가능',
  onlyByOwnReveal: '본인 고백으로만',
}

export interface ClueRow {
  role: RoleId
  /** 기록 속 단서. 없으면 null. */
  inRecord: string | null
  /** 다른 사람의 고백으로 드러나는 것. */
  byOthers: string | null
  exposure: Exposure
  /** 덧붙는 말. 본인 고백이 미션이라거나, 끝까지 숨겨야 한다거나. */
  note?: string
}

export const CLUE_MAP: readonly ClueRow[] = [
  { role: 'librarian', inRecord: 'DAY 1 창가 자리', byOthers: null, exposure: 'byDeduction' },
  { role: 'buddy', inRecord: 'DAY 1 너무 잘 아는 글씨', byOthers: null, exposure: 'byDeduction' },
  { role: 'shadow', inRecord: 'DAY 2 금요일 봉투', byOthers: '수첩: 누가 가져갔는지 안다', exposure: 'possible' },
  { role: 'witness', inRecord: 'DAY 2 복도 끝의 눈', byOthers: null, exposure: 'possible', note: '본인 고백이 미션' },
  { role: 'accuser', inRecord: 'DAY 3 읽음 표시와 캡처', byOthers: null, exposure: 'possible' },
  { role: 'leaver', inRecord: 'DAY 3 선생님께 가 주겠다던 약속', byOthers: null, exposure: 'possible' },
  { role: 'vanguard', inRecord: 'DAY 4 휴대폰', byOthers: '목격자: 두 사람', exposure: 'possible' },
  { role: 'liar', inRecord: 'DAY 4 먼저 나간 사람', byOthers: '목격자: 두 사람', exposure: 'possible', note: '본인은 끝까지 숨겨야 한다' },
  { role: 'bystander', inRecord: 'DAY 5 멀어진 발소리', byOthers: null, exposure: 'possible', note: '본인 고백이 미션' },
  { role: 'letter', inRecord: 'DAY 5 편지, 다섯 시', byOthers: '고발자: "누굴 기다리는 중"', exposure: 'possible' },
  { role: 'guard', inRecord: 'DAY 5 철컥 (누구인지는 없음)', byOthers: null, exposure: 'onlyByOwnReveal' },
  { role: 'mediator', inRecord: null, byOthers: null, exposure: 'onlyByOwnReveal' },
  { role: 'notebook', inRecord: null, byOthers: null, exposure: 'onlyByOwnReveal' },
  { role: 'transfer', inRecord: null, byOthers: null, exposure: 'onlyByOwnReveal' },
]

/**
 * 단서가 서로 이어지는 지점 넷. 두 조각이 **모두** 공개됐을 때만
 * 「연결 가능」이 된다. 대시보드가 그 상태를 보여 준다.
 */
export interface Link {
  id: string
  /** 두 조각. 각각 무엇이 열려야 하는지. */
  left: LinkPiece
  right: LinkPiece
  /** 이어지면 무엇을 알게 되는가. */
  conclusion: string
}

export type LinkPiece =
  | { kind: 'fragment'; day: number; label: string }
  | { kind: 'reveal'; role: RoleId; scope: 'class' | 'any'; label: string }

export const LINKS: readonly Link[] = [
  {
    id: 'calledByAnother',
    left: { kind: 'reveal', role: 'accuser', scope: 'class', label: '고발자의 고백 "창고에서 누굴 기다리는 중"' },
    right: { kind: 'fragment', day: 5, label: 'DAY 5 편지' },
    conclusion: 'A를 부른 사람이 따로 있다.',
  },
  {
    id: 'twoPeople',
    left: { kind: 'reveal', role: 'witness', scope: 'any', label: '목격자의 "두 사람"' },
    right: { kind: 'fragment', day: 4, label: 'DAY 4' },
    conclusion: '선봉과 거짓말쟁이.',
  },
  {
    id: 'lockedByAnother',
    left: { kind: 'fragment', day: 4, label: 'DAY 4 "문을 닫았다"' },
    right: { kind: 'fragment', day: 5, label: 'DAY 5 "한참 뒤 철컥"' },
    conclusion: '잠근 사람이 따로 있다.',
  },
  {
    id: 'whoTookThePage',
    left: { kind: 'reveal', role: 'notebook', scope: 'any', label: '수첩의 "누가 가져갔는지 안다"' },
    right: { kind: 'fragment', day: 2, label: 'DAY 2 봉투' },
    conclusion: '그림자.',
  },
]

/** 운영자 대시보드 맨 위에 고정으로 뜨는 말. scenario_reveal.md 7장. */
export const HOST_RULES: readonly string[] = [
  '운영자는 진상을 설명하지 않는다. 질문이 오면 "기록을 다시 읽어 보세요"까지만 답한다.',
  '채팅 속 실명 지목은 규칙상 자유다. 다만 게임 밖 인신공격으로 번지면 개입한다.',
  '엔딩 이후 회고 시간을 둔다. 역할은 연기였다는 걸 모두가 확인하는 자리다.',
]
