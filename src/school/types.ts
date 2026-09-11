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

/**
 * 하루에 한 번, 한 사람에게만 줄 수 있다. 같은 팀에는 줄 수 없다 —
 * 표를 받으려면 반드시 다른 팀 사람과 관계를 만들어야 한다.
 * 받은 표는 그 사람이 속한 팀의 영향력이 된다(신뢰 +2, 호감 +1, 의심 -2).
 */
export type VoteCategory = 'trust' | 'liking' | 'suspicion'

export const VOTE_LABEL: Record<VoteCategory, string> = {
  trust: '신뢰',
  liking: '호감',
  suspicion: '의심',
}

/** 표 한 장이 대상 팀 영향력에 주는 값. */
export const VOTE_INFLUENCE: Record<VoteCategory, number> = {
  trust: 2,
  liking: 1,
  suspicion: -2,
}

/**
 * 미션 하나를 무엇으로 판정하는지. 전부 실제 기록(행동 로그·공개 로그·소문·투표·1:1 대화 상대 수)에서
 * 계산되는 값이라 진행자나 본인의 주관적 판단이 끼어들 여지가 없다.
 */
export type MissionMetric =
  /** 내가 한(by) 또는 나를 대상으로 한(to) 행동의 횟수. distinct면 서로 다른 상대 수를 센다. */
  | { kind: 'action'; action: ActionKind; direction: 'by' | 'to'; distinct?: boolean }
  /** 나에게 해당 항목으로 투표한 서로 다른 사람 수. */
  | { kind: 'vote'; category: VoteCategory }
  /** 내가 공개한 횟수. revealKind를 지정하면 그 종류만 센다. */
  | { kind: 'reveal'; revealKind?: RevealKind }
  /** 1:1 대화를 나눈 서로 다른 상대 수. */
  | { kind: 'dmPartners' }
  /** 소문 관련: origin이면 내가 처음 퍼뜨린 소문 수, 아니면 내가 옮긴(재유포) 소문 수. */
  | { kind: 'rumor'; origin: boolean }
  /** 내가 쥐고 있는 남의 약점 수. */
  | { kind: 'leverageHeld' }
  /** 내가 실제로 써먹은 약점 수. */
  | { kind: 'leverageUsed' }
  /** 내가 직접 한 영역 행동(확장·건설 등)의 횟수 — 팀 게임과 개인 미션을 잇는 지점. */
  | { kind: 'territoryAction'; action: TerritoryActionKind }
  // ── 지도 위에서만 잴 수 있는 것들 ──
  /** 방에 나 혼자였던 총 시간(초). */
  | { kind: 'aloneSeconds' }
  /** 지정한 구역들에 머문 총 시간(초). */
  | { kind: 'roomSeconds'; rooms: string[] }
  /** 한 번이라도 같은 방에 있었던 서로 다른 사람 수. */
  | { kind: 'metDistinct' }
  /** 들어가 본 서로 다른 구역 수. */
  | { kind: 'roomsVisited' }
  /** 정확히 둘만 있던 적이 있는 서로 다른 사람 수. */
  | { kind: 'pairAloneDistinct'; minSeconds: number }
  /** 지정된 대상과 단둘이 있던 시간(초). */
  | { kind: 'pairAloneWithTargetSeconds' }
  /** 지정된 대상과 같은 방에 있던 총 시간(초) — 피하는 미션에 쓴다. */
  | { kind: 'withTargetSeconds' }
  /** 특정 시간 이상 함께 있었던 서로 다른 사람 수. */
  | { kind: 'togetherDistinct'; minSeconds: number }
  /** 내가 있던 방에 남이 나중에 들어온 횟수. */
  | { kind: 'visitedByOthers' }
  /** 내가 한 공간 행동. unseenOnly면 아무도 못 본 것만 센다. */
  | { kind: 'spatial'; action?: SpatialActionKind; unseenOnly?: boolean }
  /** 내가 목격한 남의 공간 행동 횟수. */
  | { kind: 'witnessedOthers'; action?: SpatialActionKind }
  /** 내 공간 행동을 본 서로 다른 사람 수 — 0으로 버티는 미션에 쓴다. */
  | { kind: 'witnessedMe'; action?: SpatialActionKind }
  /** 조각이 나타난 방에 그 순간 있었던 횟수. */
  | { kind: 'atFragmentSpawn' }

/** 신뢰도 · 호감도 투표 한 건. 하루에 카테고리당 한 명에게만 줄 수 있다. */
export interface VoteEntry {
  id: string
  day: number
  category: VoteCategory
  voterId: string
  targetId: string
  createdAtMs: number
}

export interface MissionItem {
  /** 화면에 보여줄 문구. */
  text: string
  /** 판정 기준. */
  metric: MissionMetric
  /** 이 수치에 도달하면(atMost면 이 수치 이하로 버티면) 완료. */
  threshold: number
  /** 기본은 atLeast. atMost면 "이 이상 쌓이지 않게 버티는" 미션이다. */
  comparison?: 'atLeast' | 'atMost'
}

export interface RoleMission {
  /** 전부 수치로 자동 판정되는 개인 미션 4개. */
  checklist: MissionItem[]
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
  /** 이 사람이 지도에서 무엇을 하는 사람인지 한 마디로. 「보는 사람」, 「들키지 않는 사람」처럼. */
  axis: string
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
  /** 이 소문이 누구에 대한 것인지. 서로 다른 두 사람 이상이 옮기면 그 사람 팀의 영향력이 깎인다. */
  aboutId: string | null
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

/**
 * 아바타. 그림이 아니라 고른 값만 저장한다 — 지도든 채팅이든 이 값으로
 * 스프라이트를 다시 그린다. 팀(완장)은 본인이 고르지 않으므로 여기 없다.
 */
export interface AvatarLook {
  /** 머리 모양 0..14 */
  hairStyle: number
  /** 머리색 0..8 */
  hairColor: number
  /** 표정 0..5 */
  expression: number
  /** 상의 0..5 */
  outfit: number
  /** 하의 — 0 바지, 1 치마 */
  bottom: number
}

/** 예전 저장값. 필드 이름이 바뀌기 전 값도 계속 읽혀야 한다. */
export interface LegacyAvatarLook {
  hair?: number
  face?: number
  color?: number
  uniform?: number
}

export interface PlayerProfile {
  id: string
  nickname: string
  /** 본인이 고른 아바타. 안 고르면 id에서 뽑아 준다. */
  avatar?: AvatarLook
  joinedAtMs: number
  roleId: RoleId | null
  /** 어느 팀 소속인지. 팀은 영역 점령 게임의 단위이고, 역할은 그 안에서 개인이 겪는 서사다. */
  teamId: TeamId | null
  isHost: boolean
  /** 사람이 모자랄 때 진행자가 채워 넣은 테스트용 참가자. 언제든 한 번에 뺄 수 있다. */
  isBot?: boolean
  /**
   * 「지정된 한 사람」이 필요한 미션(피해야 할 상대, 몰래 만나야 할 상대)의 대상.
   * 역할을 나눠줄 때 함께 뽑고, 본인에게만 보인다.
   */
  assignedTargetId?: string | null
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
  votes: VoteEntry[]
  /** 진행자가 오늘 공지한 사건. */
  activeEventCard: string | null
  territory: TerritoryState
  /** 바닥에 놓였거나 누군가 쥐고 있는 A의 조각들. */
  mapFragments: MapFragment[]
  createdAtMs: number
}

// ── 영역 점령 게임(팀 단위). 위의 역할·미션 시스템은 이 안에서 각 팀원이 겪는 개인 서사다. ──

export type TeamId = 'A' | 'B' | 'C' | 'D'

export interface TeamSpec {
  id: TeamId
  name: string
  /** 지도·팀 화면에서 팀을 구분하는 데 쓰는 색. */
  color: string
  baseTileId: TileId
}

export type TileId =
  | 'baseA'
  | 'baseB'
  | 'baseC'
  | 'baseD'
  | 'classroom' // 교실
  | 'hallway' // 복도
  | 'library' // 도서관
  | 'gym' // 체육관
  | 'scienceRoom' // 과학실
  | 'artRoom' // 미술실
  | 'musicRoom' // 음악실
  | 'cafeteria' // 급식실
  | 'rooftop' // 옥상
  | 'clubRoom' // 동아리실
  | 'garden' // 정원
  | 'storage' // 창고
  | 'oldBuilding' // 구관
  | 'playground' // 운동장 — 핵심 지역
  | 'auditorium' // 강당 — 핵심 지역
  | 'broadcastRoom' // 방송실 — 핵심 지역
  | 'studentCouncil' // 학생회실 — 핵심 지역
  | 'centralPlaza' // 중앙광장 — 핵심 지역

export interface TileSpec {
  id: TileId
  name: string
  /** 건물을 얹기 전 기본 영역 가치. 기지는 0(빼앗을 수 없어 점수 경쟁에 넣지 않는다). */
  baseValue: number
  /** 이 타일이 어느 팀의 기지인지. 기지는 게임 중 절대 빼앗기지 않는다. */
  homeOf: TeamId | null
  /** 핵심 지역이면 A의 기록이 열어 주기 전까지 아무도 점령할 수 없고, 확장에 영향력이 든다. */
  isCore: boolean
  /** 세울 수 있는 건물 슬롯 수. */
  buildingSlots: number
}

export type BuildingCategory = 'commerce' | 'research' | 'culture' | 'defense' | 'special'

export type BuildingKind =
  | 'shop' // 매점
  | 'store' // 상점
  | 'cafe' // 카페
  | 'lab' // 연구실
  | 'archive' // 서고
  | 'musicClub' // 음악반
  | 'artClub' // 미술반
  | 'stage' // 공연무대
  | 'security' // 경비실
  | 'watchtower' // 방어탑
  | 'controlRoom' // 통제실
  | 'broadcastStation' // 방송국
  | 'hideout' // 비밀기지
  | 'basement' // 지하실

/** 팀이 공유하는 자원. 개인 자원은 없다. */
export interface ResourceBundle {
  money: number
  food: number
  knowledge: number
  culture: number
  influence: number
  actionPoints: number
}

export interface BuildingSpec {
  kind: BuildingKind
  category: BuildingCategory
  name: string
  description: string
  cost: ResourceBundle
  /** 타일 가치에 더해지는 값(레벨만큼 곱해진다). */
  valueBonus: number
  /** 매일 정산 때 팀 자원에 더해지는 생산량(레벨만큼 곱해진다). */
  produces: Partial<ResourceBundle>
  /** 방어력에 더해지는 값(레벨만큼 곱해진다). 견제를 버티는 데 쓴다. */
  defenseBonus: number
}

/** 지어진 건물 한 채. 업그레이드하면 레벨이 오르고 효과가 두 배가 된다. */
export interface BuildingInstance {
  kind: BuildingKind
  level: 1 | 2
}

export interface TileState {
  id: TileId
  ownerTeam: TeamId | null
  buildings: BuildingInstance[]
}

export type TerritoryActionKind =
  | 'expand'
  | 'build'
  | 'upgrade'
  | 'explore'
  | 'produce'
  | 'research'
  | 'sabotage'
  | 'trade'

export type SabotageEffectKind =
  | 'expandCostUp' // 상대 확장 비용 증가
  | 'productionDown' // 상대 생산 감소
  | 'tradeBlocked' // 상대 교역 차단

export const SABOTAGE_LABEL: Record<SabotageEffectKind, string> = {
  expandCostUp: '확장 비용 증가',
  productionDown: '생산 감소',
  tradeBlocked: '교역 차단',
}

/** 진행 중인 견제 효과. expiresAfterDay가 지나 다음 날이 시작되면 사라진다. */
export interface SabotageEffect {
  id: string
  kind: SabotageEffectKind
  fromTeam: TeamId
  targetTeam: TeamId
  expiresAfterDay: number
  createdAtMs: number
}

export interface TerritoryActionLogEntry {
  id: string
  day: number
  kind: TerritoryActionKind
  team: TeamId
  playerId: string
  tileId: TileId | null
  buildingKind: BuildingKind | null
  detail: string | null
  createdAtMs: number
}

export type TradeProposalStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn'

export interface TradeProposal {
  id: string
  fromTeam: TeamId
  toTeam: TeamId
  offer: Partial<ResourceBundle>
  request: Partial<ResourceBundle>
  status: TradeProposalStatus
  message: string | null
  day: number
  createdAtMs: number
}

export type AllianceStatus = 'proposed' | 'active' | 'broken'

/** 강제력 없는 임시 동맹. 언제든 깨질 수 있다. */
export interface AllianceEntry {
  id: string
  teams: [TeamId, TeamId]
  status: AllianceStatus
  day: number
  createdAtMs: number
}

export type CardCategory = 'expand' | 'build' | 'produce' | 'sabotage' | 'diplomacy' | 'special'

export type CardKind =
  | 'fastExpand' // 빠른 확장
  | 'chainOccupy' // 연속 점령
  | 'pioneer' // 개척
  | 'detour' // 우회 확장
  | 'buildDiscount' // 건설 할인
  | 'instantBuild' // 즉시 건설
  | 'buildingBoost' // 건물 강화
  | 'bonusProduction' // 추가 자원 생산
  | 'doubleResource' // 특정 자원 2배
  | 'raiseExpandCost' // 상대 확장 비용 증가
  | 'cutProduction' // 상대 생산 감소
  | 'blockTrade' // 교역 차단
  | 'temporaryPact' // 일시적 협정
  | 'tradeBonus' // 교역 보너스
  | 'jointDevelopment' // 공동 개발
  | 'hiddenPassage' // 숨겨진 통로
  | 'secretSpace' // 비밀 공간 발견
  | 'emergencyMobilization' // 긴급 동원
  | 'majorProject' // 대규모 프로젝트

export interface CardSpec {
  kind: CardKind
  category: CardCategory
  name: string
  description: string
}

/** 팀이 뽑아 들고 있는 카드 한 장. */
export interface TeamCard {
  id: string
  kind: CardKind
  drawnDay: number
}

export interface TeamState {
  id: TeamId
  resources: ResourceBundle
  hand: TeamCard[]
  /** 연구로 쌓은 개발 단계. 최종 개발 점수에 반영된다. */
  researchTier: number
}

export interface TerritoryState {
  tiles: Record<TileId, TileState>
  teams: Record<TeamId, TeamState>
  actionLog: TerritoryActionLogEntry[]
  sabotageEffects: SabotageEffect[]
  tradeProposals: TradeProposal[]
  alliances: AllianceEntry[]
  /** A의 기록이 열어 준 구역. 핵심 지역은 여기 들어오기 전까지 아무도 점령할 수 없다. */
  unlockedTiles: TileId[]
  /** 이미 공개된 A의 기록(일차). */
  releasedFragments: number[]
  /** 누가 누구의 약점을 쥐고 있는지. */
  leverage: LeverageToken[]
  /** 약점에 눌려 오늘 영역 행동을 못 하게 된 사람들. 날이 바뀌면 비워진다. */
  blockedPlayerIds: string[]
}

/**
 * A가 남긴 기록 한 조각. A는 직접 개입하지 않는다 — 다만 매일 한 조각씩 드러나면서
 * 판을 흔든다. 조각은 (1) 구역 하나를 지목해 가치를 올리고, (2) 핵심 지역을 열고,
 * (3) 역할 한둘을 은근히 가리킨다. 지목된 역할이 누구인지는 아무도 모른다.
 */
export interface FragmentSpec {
  day: number
  title: string
  /** A가 남긴 문장 그대로. 반 전체가 같이 읽는다. */
  text: string
  /** A가 무언가를 남겨 둔 구역. 공개되는 순간 가치가 오른다. */
  tileId: TileId
  /** 이 조각으로 열리는 구역. */
  unlocks: TileId[]
  /** 이 조각이 가리키는 역할. 그 역할을 가진 사람을 의심하면 효과가 두 배가 된다. */
  implicatedRoles: RoleId[]
}

/** A의 기록이 지목한 구역이 얻는 영구 가치 보너스. */
export const FRAGMENT_TILE_BONUS = 2

/**
 * 남의 숨긴 사실을 알게 되면 손에 쥐는 약점. 공개(reveal)를 받거나
 * A의 기록으로 알게 된다. 한 번 쓰면 사라진다.
 */
export interface LeverageToken {
  id: string
  /** 쥐고 있는 사람. */
  holderId: string
  /** 누구의 약점인지. */
  aboutId: string
  source: 'reveal' | 'fragment'
  spentAs: 'block' | 'extort' | null
  day: number
  createdAtMs: number
}

// ── 지도 위의 기록 ──────────────────────────────────────────────
// 좌표는 저장하지 않는다. 남는 것은 "언제부터 언제까지 어느 방에 있었나"(구간)와
// "무엇을 했고 누가 봤나"(사건)뿐이다. 하루치가 수백 줄을 넘지 않는다.

export interface PresenceInterval {
  id: string
  playerId: string
  roomId: string
  day: number
  enteredAtMs: number
  /** 아직 그 방에 있으면 null. */
  leftAtMs: number | null
}

export type FragmentState = 'onFloor' | 'held' | 'burned'

/** 바닥에 놓이는 A의 조각. 줍는 것도 태우는 것도 그 방에 있는 사람에게 보인다. */
export interface MapFragment {
  id: string
  text: string
  roomId: string
  state: FragmentState
  holderId: string | null
  day: number
  createdAtMs: number
}

/** 익명으로 남기는 쪽지. 남기는 장면을 본 사람만 누가 썼는지 안다. */
export interface MapNote {
  id: string
  roomId: string
  text: string
  authorId: string
  witnessIds: string[]
  readerIds: string[]
  day: number
  createdAtMs: number
}

export type SpatialActionKind =
  | 'pickFragment'
  | 'burnFragment'
  | 'giveFragment'
  | 'dropFragment'
  | 'leaveNote'
  | 'readNote'

export const SPATIAL_LABEL: Record<SpatialActionKind, string> = {
  pickFragment: '조각을 주웠다',
  burnFragment: '조각을 태웠다',
  giveFragment: '조각을 건넸다',
  dropFragment: '조각을 내려놓았다',
  leaveNote: '쪽지를 남겼다',
  readNote: '쪽지를 읽었다',
}

export interface SpatialEvent {
  id: string
  kind: SpatialActionKind
  actorId: string
  roomId: string
  /** 조각을 건넨 상대. */
  targetId: string | null
  /** 그 순간 같은 방에 있던 사람들. 비어 있으면 아무도 못 봤다는 뜻이다. */
  witnessIds: string[]
  day: number
  createdAtMs: number
}

export interface PlayerScoreBreakdown {
  /** 달성한 개인 미션. */
  missions: number
  trust: number
  liking: number
  /** 받은 의심 — 음수로 들어간다. */
  suspicion: number
  /** 쥐거나 써먹은 약점. */
  secrets: number
  /** 내가 직접 한 영역 행동 — 팀에 실제로 기여한 몫. */
  contribution: number
  total: number
}

export interface TeamScoreBreakdown {
  territory: number
  connection: number
  core: number
  resource: number
  development: number
  total: number
}
