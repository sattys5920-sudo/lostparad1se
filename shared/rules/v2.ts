// 영역전 v2 — 모든 수치는 여기 한 곳에만 있다.
//
// 로직 코드에 숫자를 직접 쓰지 않는다. 플레이테스트로 값을 돌려 보려면
// 이 파일만 고치면 되고, 어떤 값이 게임을 어떻게 움직이는지도 여기서만
// 읽으면 된다. 규칙 원문은 docs/team_rules_v2.md다.
//
// 시간 단위에 두 종류가 있다는 점을 헷갈리지 않게 이름으로 갈라 둔다.
//   ...GameMin / ...GameSec  게임 시계 — 소등(24:00~08:00)을 건너뛴다
//   ...RealHours             실제 시계 — 소등도 그냥 흐른다

/** 모든 시각은 한국 시간이다. */
export const TIMEZONE = 'Asia/Seoul'

// ── 판 ──────────────────────────────────────────────────────────

export const GRID = 5
export const TOTAL_DAYS = 5

export type TeamId = 'A' | 'B' | 'C' | 'D'
export const TEAM_IDS: readonly TeamId[] = ['A', 'B', 'C', 'D']

/** 14명을 4/4/3/3으로 나눈다. */
export const TEAM_SIZES: Record<TeamId, number> = { A: 4, B: 4, C: 3, D: 3 }
/** 주장을 두는 팀 — 머릿수가 모자란 쪽이다. */
export const SHORT_HANDED_TEAMS: readonly TeamId[] = ['C', 'D']
/** 주장은 깃발 판정에서 이만큼으로 센다. */
export const CAPTAIN_HEAD_COUNT = 2

export type Tier = 'base' | 'zone1' | 'gate' | 'cross' | 'core' | 'plaza'

/** 층위별 건물 슬롯. 가치 5 이상인 칸만 둘이다. */
export const SLOTS_BY_TIER: Record<Tier, number> = {
  base: 0,
  zone1: 1,
  gate: 1,
  cross: 2,
  core: 2,
  plaza: 2,
}

// ── 시간표 ──────────────────────────────────────────────────────

/** 등교 — 하루가 열린다. */
export const DAY_START_HOUR = 8
/** 소등 — 말도 깃발도 토큰도 멈춘다. */
export const LIGHTS_OUT_HOUR = 24
/** 방과후 정산. */
export const SETTLEMENT_HOUR = 21
/** 마지막 여섯 시간이 시작되는 시각(DAY 5). */
export const LAST_HOURS_START_HOUR = 15
/** 종례 — 게임이 끝난다(DAY 5). */
export const CLOSING_HOUR = SETTLEMENT_HOUR

/** 하루 중 실제로 시간이 흐르는 길이(초). 08:00~24:00. */
export const ACTIVE_SECONDS_PER_DAY = (LIGHTS_OUT_HOUR - DAY_START_HOUR) * 3600

/** 개발용 시계가 허용하는 배속 범위. */
export const DEV_CLOCK_SPEED_MIN = 1
export const DEV_CLOCK_SPEED_MAX = 120

// ── 말과 이동 ───────────────────────────────────────────────────

/** 이웃 칸 하나를 걷는 데 드는 게임 시간. */
export const MOVE_GAME_MIN_PER_TILE = 15
/** 체육부장은 절반 — 칸당 7분 30초. */
export const ATHLETIC_MOVE_FACTOR = 0.5
/** 등교 예약으로 찍을 수 있는 최대 칸 수. */
export const COMMUTE_MAX_TILES = 2

/** 안개 — 내가 선 칸에서 이만큼 떨어진 칸까지 보인다(우리 칸은 항상 보인다). */
export const VISION_RANGE = 1
/** 정보부장은 한 겹 더 본다. */
export const INTEL_VISION_BONUS = 1
/** 관측소가 걷어 주는 안개 범위. 개조하면 두 배. */
export const OBSERVATORY_RANGE = 2

// ── 행동 토큰 ───────────────────────────────────────────────────

/** 08:00에 받는 몫. */
export const TOKEN_DAWN_GRANT = 2
/** 짝수 시각마다 받는 몫. */
export const TOKEN_HOURLY_GRANT = 1
/** 충전이 일어나는 시각 — 10·12·14·16·18·20시. */
export const TOKEN_GRANT_HOURS: readonly number[] = [10, 12, 14, 16, 18, 20]
/** 쌓아 둘 수 있는 한도. 넘치면 사라진다. */
export const TOKEN_CAP = 4
/** 한 사람이 하루에 쓸 수 있는 수. 08:00에 초기화된다. */
export const TOKEN_PER_PLAYER_DAILY = 3
/** 만회 팀이 다음 08:00에 더 받는 몫. 이때만 보관 한도를 넘길 수 있다. */
export const TOKEN_COMEBACK_BONUS = 2

// ── 자원 ────────────────────────────────────────────────────────

export type Resource = 'money' | 'knowledge' | 'influence'
export const RESOURCES: readonly Resource[] = ['money', 'knowledge', 'influence']

export const RESOURCE_LABEL: Record<Resource, string> = {
  money: '돈',
  knowledge: '지식',
  influence: '영향력',
}

export const STARTING_RESOURCES: Record<Resource, number> = {
  money: 8,
  knowledge: 4,
  influence: 0,
}

/**
 * 넓을수록 덜 거둔다. 기지를 뺀 보유 칸 수로 건물 생산에 곱한다.
 * 위에서부터 처음 맞는 칸을 쓴다.
 */
export const MAINTENANCE_TIERS: readonly { upTo: number; factor: number }[] = [
  { upTo: 5, factor: 1 },
  { upTo: 10, factor: 0.8 },
  { upTo: Infinity, factor: 0.6 },
]

// ── 깃발 ────────────────────────────────────────────────────────

export type FlagTarget = 'empty' | 'enemy' | 'core' | 'plaza'

/** 보정 전 기본 시간(게임 분). */
export const FLAG_BASE_GAME_MIN: Record<FlagTarget, number> = {
  empty: 30,
  enemy: 60,
  core: 120,
  plaza: 180,
}

/** 방어 1당 늘어나는 시간. */
export const FLAG_DEFENSE_GAME_MIN = 30
/** 주목받는 팀의 칸은 기본 시간이 이것으로 내려간다. */
export const FLAG_SPOTLIGHT_BASE_GAME_MIN = 30

/**
 * 시간 보정은 반드시 이 순서로 곱한다.
 *   기본(+방어) → 반장 → 기습 → 마지막 여섯 시간
 */
export const FLAG_CLASS_PRESIDENT_FACTOR = 0.75
export const FLAG_AMBUSH_FACTOR = 0.5
export const FLAG_LAST_HOURS_FACTOR = 0.5

/** 성공할 때 내는 돈. 가진 칸 세 개마다 1씩 붙는다. */
export const FLAG_COST_MONEY: Record<FlagTarget, number> = {
  empty: 2,
  enemy: 4,
  core: 4,
  plaza: 4,
}
/** 가진 칸 몇 개마다 돈이 1 비싸지는가. */
export const FLAG_COST_TILES_PER_STEP = 3
/** 핵심·중앙광장에 추가로 드는 영향력. */
export const FLAG_COST_INFLUENCE: Record<FlagTarget, number> = {
  empty: 0,
  enemy: 0,
  core: 4,
  plaza: 6,
}
/** 핵심·중앙광장은 깃발 팀 실제 인원이 이만큼 서 있어야 한다(주장도 1명). */
export const FLAG_CORE_MIN_PRESENCE = 2
/** 깃발 하나에 드는 토큰. */
export const FLAG_TOKEN_COST = 1

/** 소유가 바뀌면 건물이 내려가는 단계. 1단계는 무너진다. */
export const CAPTURE_BUILDING_DOWNGRADE = 1

// ── 표 ──────────────────────────────────────────────────────────

export type VoteKind = 'trust' | 'liking' | 'suspicion'

export const VOTE_LABEL: Record<VoteKind, string> = {
  trust: '신뢰',
  liking: '호감',
  suspicion: '의심',
}

/** 대상 팀 영향력에 주는 값. */
export const VOTE_INFLUENCE: Record<VoteKind, number> = {
  trust: 2,
  liking: 1,
  suspicion: -2,
}

/** 방송국이 있으면 받는 신뢰·호감 한 표마다 더 얻는 영향력. */
export const BROADCAST_VOTE_BONUS = 1
/** 비밀기지가 있으면 받는 의심표 타격이 이만큼 줄어든다. */
export const HIDEOUT_SUSPICION_RELIEF = 1
/** 의심표를 던진 팀도 잃는 영향력. */
export const SUSPICION_SELF_COST = 1
/** A의 기록이 가리킨 역할을 정확히 짚었을 때의 배수. */
export const FRAGMENT_HIT_MULTIPLIER = 2
/** 주목받는 팀이 더 크게 맞는 의심 타격. */
export const SPOTLIGHT_SUSPICION_EXTRA = 1

/** 표를 줄 수 있는 시간. */
export const VOTE_OPEN_HOUR = DAY_START_HOUR
export const VOTE_CLOSE_HOUR = SETTLEMENT_HOUR
/** 하루에 한 사람이 줄 수 있는 표. */
export const VOTE_PER_PLAYER_DAILY = 1
/** 정보부장이 보낸 사람을 볼 수 있는 횟수(하루). */
export const INTEL_VOTE_PEEK_DAILY = 1

/** 소문이 한 번 옮겨질 때마다 깎이는 영향력. */
export const RUMOR_DECAY = 1
/** DAY 2에는 두 배. */
export const RUMOR_DECAY_DAY = 2
export const RUMOR_DECAY_MULTIPLIER = 2

// ── 털어놓기와 약점 ─────────────────────────────────────────────

/**
 * 털어놓기로 얻는 영향력.
 *
 * 한 사람이 게임 전체에서 받을 수 있는 총량이 정해져 있다. 같은 이야기를
 * 스무 명에게 떠들어 영향력을 긁어모을 수 없다 — 두 번째부터의 1:1은
 * 영향력이 오르지 않고 나를 쥔 사람만 는다. 약점은 총량과 상관없이
 * 듣는 사람마다 하나씩 생긴다.
 *
 * 계산은 revealInfluenceGain()에 있다.
 */
export const REVEAL_INFLUENCE_CAP = 6
/** 첫 1:1 털어놓기로 얻는 몫. */
export const REVEAL_INFLUENCE_FIRST_PRIVATE = 3

/** 털어놓는 방식. */
export type RevealScope = 'private' | 'class'

/** 발 묶기 — 말이 움직이지도 행동하지도 못한다(게임 시계). */
export const LEVERAGE_BIND_GAME_HOURS = 6
/** 갈취로 옮기는 영향력. */
export const LEVERAGE_EXTORT_INFLUENCE = 3

// ── 팀 직책 ─────────────────────────────────────────────────────

export type RoleTitle = 'classPresident' | 'treasurer' | 'intelOfficer' | 'athleticDirector'

export const ROLE_TITLES: readonly RoleTitle[] = [
  'classPresident',
  'treasurer',
  'intelOfficer',
  'athleticDirector',
]

export const ROLE_TITLE_LABEL: Record<RoleTitle, string> = {
  classPresident: '반장',
  treasurer: '총무',
  intelOfficer: '정보부장',
  athleticDirector: '체육부장',
}

/** 총무가 건설·개조에서 깎아 주는 돈. */
export const TREASURER_BUILD_DISCOUNT = 1

// ── 그 밖의 행동 ────────────────────────────────────────────────

/** 생산 한 번에 얻는 돈. */
export const PRODUCE_MONEY = 3
/** 탐색 한 번에 얻는 양. 돈과 지식 중 무작위로 하나. */
export const SCOUT_GAIN = 2
export const SCOUT_RESOURCES: readonly Resource[] = ['money', 'knowledge']
/** 같은 칸 탐색은 팀당 하루 한 번. */
export const SCOUT_PER_TILE_DAILY = 1
/** 연구 비용 = 이 값 + 지금 연구 단계. */
export const RESEARCH_BASE_KNOWLEDGE = 2
/** 견제에 드는 영향력. */
export const SABOTAGE_INFLUENCE = 2

// ── 견제 ────────────────────────────────────────────────────────

export type SabotageKind = 'expandCostUp' | 'productionDown' | 'tradeBlocked'

export const SABOTAGE_LABEL: Record<SabotageKind, string> = {
  expandCostUp: '확장 비용 증가',
  productionDown: '생산 감소',
  tradeBlocked: '교역 차단',
}

/** 상대 깃발 성공 비용에 더 붙는 돈. */
export const SABOTAGE_EXTRA_FLAG_MONEY = 2
/** 생산 감소가 곱하는 값. */
export const SABOTAGE_PRODUCTION_FACTOR = 0.5

/**
 * 지속. 실제 시계 기준이다. productionDown만 시간이 아니라
 * "다음 정산 한 번"이라 따로 표시한다.
 */
export const SABOTAGE_REAL_HOURS: Record<SabotageKind, number | 'nextSettlement'> = {
  expandCostUp: 24,
  productionDown: 'nextSettlement',
  tradeBlocked: 12,
}

// ── 교역과 동맹 ─────────────────────────────────────────────────

/** 답을 못 받은 제안이 이보다 많으면 더 보낼 수 없다. */
export const TRADE_PENDING_LIMIT = 3
/** 한 팀이 동시에 맺을 수 있는 동맹 수. */
export const ALLIANCE_LIMIT = 1
/** 먼저 깬 팀이 잃는 영향력. */
export const ALLIANCE_BREAK_INFLUENCE_PENALTY = 2
/** 먼저 깬 팀이 새 동맹을 못 맺는 시간(실제 시계). */
export const ALLIANCE_BREAK_LOCK_REAL_HOURS = 12
/** 이날 08:00에 모든 동맹이 풀린다. */
export const ALLIANCE_CLEAR_DAY = 4

// ── 건물 ────────────────────────────────────────────────────────

export type BuildingKind =
  | 'shop' | 'store' | 'archive' | 'lab'
  | 'security' | 'barricade' | 'controlRoom'
  | 'observatory' | 'broadcast' | 'hideout'

export interface BuildingSpec {
  kind: BuildingKind
  name: string
  cost: Partial<Record<Resource, number>>
  /** 칸 가치에 더해지는 값. 개조해도 늘지 않는다. */
  value: number
  /** 21:00 정산 때 나오는 자원. 개조하면 두 배. */
  produces: Partial<Record<Resource, number>>
  /** 방어 1당 이 칸을 뺏는 깃발이 30분 길어진다. 개조하면 두 배. */
  defense: number
}

export const BUILDINGS: readonly BuildingSpec[] = [
  { kind: 'shop', name: '매점', cost: { money: 2 }, value: 1, produces: { money: 2 }, defense: 0 },
  { kind: 'store', name: '상점', cost: { money: 4 }, value: 2, produces: { money: 3 }, defense: 0 },
  { kind: 'archive', name: '서고', cost: { money: 2 }, value: 1, produces: { knowledge: 2 }, defense: 0 },
  { kind: 'lab', name: '연구실', cost: { knowledge: 3 }, value: 2, produces: { knowledge: 3 }, defense: 0 },
  { kind: 'security', name: '경비실', cost: { money: 2 }, value: 1, produces: {}, defense: 1 },
  { kind: 'barricade', name: '바리케이드', cost: { money: 3, knowledge: 1 }, value: 1, produces: {}, defense: 2 },
  { kind: 'controlRoom', name: '통제실', cost: { knowledge: 2, influence: 1 }, value: 2, produces: {}, defense: 3 },
  { kind: 'observatory', name: '관측소', cost: { money: 2, knowledge: 1 }, value: 1, produces: {}, defense: 0 },
  { kind: 'broadcast', name: '방송국', cost: { money: 3, knowledge: 2 }, value: 3, produces: {}, defense: 0 },
  { kind: 'hideout', name: '비밀기지', cost: { money: 3, knowledge: 1 }, value: 2, produces: {}, defense: 1 },
]

export const BUILDING_BY_KIND: Record<BuildingKind, BuildingSpec> = Object.fromEntries(
  BUILDINGS.map((b) => [b.kind, b]),
) as Record<BuildingKind, BuildingSpec>

/** 건물은 1·2단계가 전부다. */
export const BUILDING_MAX_LEVEL = 2

// ── 카드 ────────────────────────────────────────────────────────

export type CardKind =
  | 'forcedMarch' | 'ambush'
  | 'quickBuild' | 'reinforce'
  | 'windfall' | 'cramming'
  | 'falseRumor' | 'blockade'
  | 'secretLetter' | 'accord'
  | 'fakeFlag' | 'ambushHide'

export interface CardSpec {
  kind: CardKind
  name: string
  group: '확장' | '건설' | '생산' | '견제' | '외교' | '특수'
  text: string
  /** 대상 팀을 골라야 하는가. */
  needsTeam?: boolean
  /** 대상 칸을 골라야 하는가. */
  needsTile?: boolean
  /** 우리 말 하나를 골라야 하는가. */
  needsPawn?: boolean
}

export const CARDS: readonly CardSpec[] = [
  { kind: 'forcedMarch', name: '강행군', group: '확장', text: '우리 말 하나의 다음 이동이 즉시 끝난다(최대 두 칸).', needsPawn: true },
  { kind: 'ambush', name: '기습', group: '확장', text: '다음에 꽂는 깃발 하나의 시간이 절반.' },
  { kind: 'quickBuild', name: '급조', group: '건설', text: '건물 하나를 토큰 없이 비용 절반(버림)으로 짓는다.', needsTile: true },
  { kind: 'reinforce', name: '보강', group: '건설', text: '우리 칸 하나의 방어 +2, 24시간.', needsTile: true },
  { kind: 'windfall', name: '특별 매출', group: '생산', text: '돈 +4.' },
  { kind: 'cramming', name: '벼락치기', group: '생산', text: '지식 +4.' },
  { kind: 'falseRumor', name: '헛소문', group: '견제', text: '대상 팀 영향력 −2.', needsTeam: true },
  { kind: 'blockade', name: '봉쇄', group: '견제', text: '칸 하나에 여섯 시간 동안 새 깃발을 못 꽂고, 꽂힌 깃발은 멈춘다.', needsTile: true },
  { kind: 'secretLetter', name: '밀서', group: '외교', text: '다른 팀 한 명과 한 시간짜리 비밀 대화방을 연다.' },
  { kind: 'accord', name: '협정서', group: '외교', text: '다음 교역이 성립하면 양쪽 팀 모두 돈 +2.' },
  { kind: 'fakeFlag', name: '가짜 깃발', group: '특수', text: '토큰 없이 깃발을 꽂는다. 진짜처럼 보이지만 아무 일도 없다.', needsTile: true },
  { kind: 'ambushHide', name: '잠복', group: '특수', text: '우리 말 하나가 여섯 시간 동안 누구에게도 보이지 않는다. 판정에서는 센다.', needsPawn: true },
]

export const CARD_BY_KIND: Record<CardKind, CardSpec> = Object.fromEntries(
  CARDS.map((c) => [c.kind, c]),
) as Record<CardKind, CardSpec>

/** 팀 손패 한도. */
export const HAND_LIMIT = 4

export const CARD_FORCED_MARCH_TILES = 2
export const CARD_REINFORCE_DEFENSE = 2
export const CARD_REINFORCE_REAL_HOURS = 24
export const CARD_WINDFALL_MONEY = 4
export const CARD_CRAMMING_KNOWLEDGE = 4
export const CARD_FALSE_RUMOR_INFLUENCE = 2
export const CARD_BLOCKADE_GAME_HOURS = 6
export const CARD_SECRET_LETTER_REAL_HOURS = 1
export const CARD_ACCORD_MONEY = 2
export const CARD_HIDE_GAME_HOURS = 6
export const CARD_QUICK_BUILD_COST_FACTOR = 0.5

// ── 비밀 목표 ───────────────────────────────────────────────────

export type GoalKind =
  | 'gateGuard' | 'theMiddle' | 'twoHearts' | 'crossroadLord' | 'unbrokenPath'
  | 'fortress' | 'raider' | 'distantFriend' | 'noBetrayal' | 'everyonesTrust'
  | 'tightLipped' | 'scholars' | 'architect' | 'broadcastClub' | 'moneyed' | 'rival'

export interface GoalSpec {
  kind: GoalKind
  name: string
  text: string
  points: number
  /** 받을 때 대상 팀을 무작위로 지정한다(자기 팀 제외). */
  needsRivalTeam?: boolean
}

export const GOALS: readonly GoalSpec[] = [
  { kind: 'gateGuard', name: '관문 수비대', text: '관문 두 칸을 가지고 있다', points: 6 },
  { kind: 'theMiddle', name: '한가운데', text: '중앙광장을 가지고 있다', points: 7 },
  { kind: 'twoHearts', name: '두 개의 심장', text: '핵심 두 칸을 가지고 있다', points: 6 },
  { kind: 'crossroadLord', name: '교차로의 주인', text: '교차로 두 칸을 가지고 있다', points: 5 },
  { kind: 'unbrokenPath', name: '끊기지 않는 길', text: '연결 점수가 9 이상이다', points: 5 },
  { kind: 'fortress', name: '철옹성', text: '닷새 동안 한 번도 칸을 뺏기지 않았다', points: 6 },
  { kind: 'raider', name: '약탈자', text: '남의 칸 깃발을 세 번 이상 성공했다', points: 5 },
  { kind: 'distantFriend', name: '먼 친구', text: '이웃하지 않는 팀과 동맹인 채로 끝난다', points: 5 },
  { kind: 'noBetrayal', name: '배신 없는 반', text: '동맹을 먼저 깬 적이 없고, 끝날 때 동맹이 있다', points: 5 },
  { kind: 'everyonesTrust', name: '모두의 신뢰', text: '다른 세 팀 모두에게서 신뢰표를 받았다', points: 5 },
  { kind: 'tightLipped', name: '입 무거운 반', text: '우리 팀 누구도 비밀을 털어놓지 않았다', points: 4 },
  { kind: 'scholars', name: '학구파', text: '연구 4단계 이상이다', points: 5 },
  { kind: 'architect', name: '건축가', text: '2단계 건물이 세 개 이상이다', points: 5 },
  { kind: 'broadcastClub', name: '방송부', text: '방송국과 비밀기지를 둘 다 가지고 있다', points: 4 },
  { kind: 'moneyed', name: '알부자', text: '돈이 15 이상 남아 있다', points: 4 },
  { kind: 'rival', name: '라이벌', text: '적힌 팀보다 영역 점수가 높다', points: 6, needsRivalTeam: true },
]

export const GOAL_BY_KIND: Record<GoalKind, GoalSpec> = Object.fromEntries(
  GOALS.map((g) => [g.kind, g]),
) as Record<GoalKind, GoalSpec>

/** 팀마다 받는 비밀 목표 수. 열여섯 장 중 겹치지 않게 나눈다. */
export const GOALS_PER_TEAM = 3
/** 이날 08:00에 한 장을 골라 공개해야 한다. */
export const GOAL_REVEAL_DAY = 3

/** 목표 판정에 쓰는 문턱값. */
export const GOAL_THRESHOLD = {
  gateTiles: 2,
  coreTiles: 2,
  crossTiles: 2,
  connection: 9,
  raidSuccesses: 3,
  researchTier: 4,
  level2Buildings: 3,
  money: 15,
} as const

// ── 점수 ────────────────────────────────────────────────────────

/** 핵심 한 칸당. */
export const SCORE_PER_CORE = 3
/** 중앙광장. */
export const SCORE_PLAZA = 5
/** 남은 자원을 이 수로 나눈다(버림). */
export const SCORE_RESOURCE_DIVISOR = 5
/** 연구 단계에 곱하는 값. */
export const SCORE_RESEARCH_MULTIPLIER = 2

// ── A의 기록과 날짜별 사건 ──────────────────────────────────────

/** 기록이 지목한 칸의 가치가 끝까지 오르는 값. */
export const FRAGMENT_TILE_BONUS = 2

/** 날짜마다 열리는 핵심. DAY 1·2는 마주 보는 두 칸씩. */
export const CORE_OPENING: Record<number, readonly string[]> = {
  1: ['playground', 'broadcastRoom'],
  2: ['auditorium', 'studentCouncil'],
  5: ['centralPlaza'],
}

// ── 주목과 만회 ─────────────────────────────────────────────────
// 값은 위쪽 해당 항목에 있다(FLAG_SPOTLIGHT_BASE_GAME_MIN,
// SPOTLIGHT_SUSPICION_EXTRA, TOKEN_COMEBACK_BONUS).

/** 마지막 여섯 시간이 시작되는 날. */
export const LAST_HOURS_DAY = 5
