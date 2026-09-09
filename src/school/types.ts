// ── 게임 전체를 관통하는 타입. 화면(screens)·엔진(engine)·동기화(sync)가 모두 이 타입을 공유한다. ──

export type RoleId =
  | 'classPresident' // 반장
  | 'topStudent' // 성적 1등
  | 'popular' // 반에서 가장 인기 있는 학생
  | 'transferStudent' // 전학생
  | 'exPartner' // A의 짝
  | 'gossip' // 소문을 잘 아는 학생
  | 'secretAdmirer' // A를 좋아했던 학생
  | 'athlete' // 운동부
  | 'snsAddict' // SNS에 민감한 학생
  | 'counselee' // 상담을 자주 받는 학생
  | 'troublemaker' // 문제아
  | 'goodStudent' // 모범생
  | 'exLover' // 전 애인
  | 'stranger' // 거의 모르는 학생

export interface RoleMission {
  /** 자기 눈에만 보이는 체크리스트. 시스템이 자동으로 판정하지 않고 본인이 직접 체크한다. */
  checklist: string[]
  /** 게임 중 언젠가 마주하게 되는, 정답이 없는 선택 하나. */
  hiddenGoal: string
}

export interface RoleSpec {
  id: RoleId
  name: string
  /** 다른 사람 눈에 비치는 모습. */
  publicPersona: string
  /** 다른 사람들도 대략 알고 있는, A와의 관계. */
  knownRelationToA: string
  /** 아무에게도 말하지 않은 사실. 본인만 본다. */
  privateFact: string
  mission: RoleMission
  /**
   * 인원이 8~13명일 때 역할을 몇 명까지 쓸지 정하는 우선순위(1이 가장 먼저 포함, 14가 가장 나중에 포함).
   * 참가자 수만큼 앞에서부터 잘라 쓴다 — data/roles.ts의 ROLE_INCLUDE_ORDER 참고.
   */
}

export type ActionKind =
  | 'talk' // 누군가와 대화하기
  | 'visit' // 누군가를 찾아가기
  | 'groupPost' // 단체 채팅방에 글 쓰기
  | 'dm' // 개인 메시지 보내기
  | 'grantFavor' // 부탁 들어주기
  | 'rejectFavor' // 부탁 거절하기
  | 'spreadRumor' // 소문 퍼뜨리기
  | 'checkRumor' // 소문 확인하기
  | 'lie' // 거짓말하기
  | 'tellTruth' // 진실 말하기
  | 'beAlone' // 혼자 있기
  | 'spendTime' // 특정 플레이어와 시간을 보내기
  | 'publicSupport' // 누군가를 공개적으로 지지하기
  | 'ignore' // 누군가를 무시하기

export interface ActionSpec {
  kind: ActionKind
  label: string
  description: string
  /** 대상(다른 플레이어)을 반드시 지정해야 하는 행동인지. */
  needsTarget: boolean
  /** 글/메시지 등 직접 쓰는 텍스트가 필요한지. */
  needsText: boolean
  /** 단체 채팅에 노출되는지, 대상에게만 보이는지, 아무에게도 보이지 않는지(혼자 있기). */
  visibility: 'public' | 'private' | 'none'
}

export interface DaySpec {
  day: number
  title: string
  subtitle: string
  description: string
  /** 오늘 하루의 초점이 되는 질문. 진행자가 그대로 공지해도 되는 문구. */
  focusPrompt: string
  /** 진행자가 오늘의 사건으로 고를 수 있는 예시 카드. 자유롭게 대체 가능. */
  eventCards: string[]
}

export type EndingKey =
  | 'stayed' // 「남았다」
  | 'left' // 「떠났다」
  | 'apologized' // 「사과했다」
  | 'nothingHappened' // 「아무 일도 없었다」
  | 'alone' // 「혼자가 되었다」
  | 'newFriend' // 「새로운 친구」
  | 'shouldHaveSaid' // 「그때 말할 걸」
  | 'wereWeFriends' // 「우리는 친구였나」

export interface EndingSpec {
  key: EndingKey
  title: string
  description: string
}

export type RumorDistortion = 'truth' | 'partial' | 'misunderstanding' | 'false' | 'exaggeration'

export interface RumorEntry {
  id: string
  /** 지금 퍼지고 있는 형태의 문장. */
  text: string
  /** 이 소문을 다시 퍼뜨린 사람. 최초 발화자는 originId가 자기 자신. */
  tellerId: string
  /** 이 갈래 소문의 뿌리(최초 발화자). */
  originId: string
  /** 바로 앞에서 들은 소문. 최초 발화면 null. */
  parentRumorId: string | null
  /** 실제 왜곡 정도 — 진행자 화면에만 노출한다. 플레이어에게는 절대 보여주지 않는다. */
  distortion: RumorDistortion
  createdAtMs: number
}

export interface ActionLogEntry {
  id: string
  day: number
  kind: ActionKind
  actorId: string
  targetId: string | null
  text: string | null
  visibility: 'public' | 'private' | 'none'
  /** private 행동일 때, actor/target 외에는 볼 수 없다. */
  createdAtMs: number
}

/** 무엇을 공개했는지. 공개는 되돌릴 수 없고, 받은 사람의 화면에 그대로 남는다. */
export type RevealKind = 'role' | 'privateFact' | 'hiddenGoal' | 'custom'

export interface ChatMessage {
  id: string
  authorId: string
  text: string
  day: number
  createdAtMs: number
  /** 'reveal'이면 공개로 표시된다. 없으면 일반 대화. */
  kind?: 'text' | 'reveal'
  revealKind?: RevealKind
}

/** 두 사람만 보는 1:1 대화방. 문서 id는 threadKey(두 id를 정렬해 이은 값). */
export interface DmThread {
  key: string
  participants: string[]
  messages: ChatMessage[]
  updatedAtMs: number
}

/** 진행자가 판의 속도를 가늠하기 위해 보는 공개 기록. 내용까지는 남기지 않는다. */
export interface RevealLogEntry {
  id: string
  actorId: string
  revealKind: RevealKind
  scope: 'class' | 'person'
  targetId: string | null
  day: number
  createdAtMs: number
}

/** -5(관계 단절) ~ +5(특별한 관계). 플레이어 화면에는 절대 숫자로 노출하지 않는다. */
export type RelationshipValue = -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5

export interface PlayerProfile {
  id: string
  nickname: string
  joinedAtMs: number
  roleId: RoleId | null
  isHost: boolean
  /** 본인이 스스로 체크한 미션 진행 상황. checklist와 같은 길이. */
  missionChecks: boolean[]
  /** 숨겨진 목표까지 마주해 결단을 내렸는지(선택 내용은 자유 텍스트로 남긴다). */
  hiddenGoalResolution: string | null
  endingKey: EndingKey | null
  /** 진행자가 참고용으로 남기는 엔딩 메모(선택). */
  endingNote: string | null
}

export type GamePhase = 'lobby' | 'roleReveal' | 'day' | 'ended'

export interface SchoolSessionState {
  phase: GamePhase
  day: number
  rolesAssigned: boolean
  groupChat: ChatMessage[]
  actionLog: ActionLogEntry[]
  rumors: RumorEntry[]
  revealLog: RevealLogEntry[]
  /** 진행자가 오늘 공지한 사건. */
  activeEventCard: string | null
  createdAtMs: number
}
