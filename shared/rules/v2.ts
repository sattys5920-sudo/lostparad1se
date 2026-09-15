// 영역전 v2 — 모든 수치는 여기 한 곳에만 있다.
//
// 로직 코드에 숫자를 직접 쓰지 않는다. 플레이테스트로 값을 돌려 보려면
// 이 파일만 고치면 되고, 어떤 값이 게임을 어떻게 움직이는지도 여기서만
// 읽으면 된다. 규칙 원문은 docs/team_rules_v2.md다.
//
// 시간 단위에 두 종류가 있다는 점을 헷갈리지 않게 이름으로 갈라 둔다.
//   ...GameMin / ...GameSec  게임 시계
//   ...RealHours             실제 시계
//
// **지금은 둘이 같다.** 예전에는 게임 시계가 소등(24:00~08:00) 동안
// 멈춰서 둘이 달랐다. 이름은 남겨 둔다 — 멈추는 시간을 다시 두게 되면
// 갈라지는 자리가 여기라는 표시다

/** 모든 시각은 한국 시간이다. */
export const TIMEZONE = 'Asia/Seoul'

// ── 판 ──────────────────────────────────────────────────────────

export const GRID = 5
export const TOTAL_DAYS = 5

export type TeamId = 'A' | 'B' | 'C' | 'D'
export const TEAM_IDS: readonly TeamId[] = ['A', 'B', 'C', 'D']

/**
 * **판을 시작할 때** 14명을 4/4/3/3으로 나눈다.
 *
 * 이것은 자리 배정표지 현재 인원이 아니다. 이적이 생기면 C팀이 넷이
 * 되고 A팀이 셋이 된다 — 그러니 「지금 저 팀이 몇 명인가」를 여기서
 * 읽으면 안 된다. 그때는 명단을 세야 한다(teamSizesOf).
 *
 * 전에는 SHORT_HANDED_TEAMS = ['C','D'] 라는 것이 있었다. 이름 자체가
 * 「C와 D는 영원히 세 명」이라는 틀린 전제를 담고 있어서 걷어냈다.
 */
export const STARTING_TEAM_SIZES: Record<TeamId, number> = { A: 4, B: 4, C: 3, D: 3 }

/** 주장을 두는 팀의 인원. 이보다 적은 팀이 주장을 둔다. */
export const FULL_TEAM_SIZE = 4

/** 주장은 점령 판정에서 이만큼으로 센다. */
export const CAPTAIN_HEAD_COUNT = 2

/** 지금 팀마다 몇 명인가. **명단을 센다** — 상수를 읽지 않는다. */
export function teamSizesOf(roster: readonly { team: TeamId }[]): Record<TeamId, number> {
  const out = Object.fromEntries(TEAM_IDS.map((t) => [t, 0])) as Record<TeamId, number>
  for (const r of roster) out[r.team] += 1
  return out
}

/**
 * 방의 등급.
 *
 * stair 는 계단이다. **아무도 못 가진다** — 깃발도 못 꽂고 점수에도
 * 안 들어간다(기지와 같다). 다만 좁아서 둘까지만 선다.
 */
export type Tier = 'base' | 'zone1' | 'gate' | 'cross' | 'lab' | 'core' | 'plaza' | 'stair'

// ── 시간표 ──────────────────────────────────────────────────────

/**
 * 하루가 열리는 시각. **자정이다.**
 *
 * 예전에는 08:00 이었고 24:00~08:00 은 소등이라 게임 시계가 아예
 * 멈춰 있었다. 날짜가 아침에 넘어가니 새벽에 들어온 사람은 어제에
 * 서 있었고, 밤에 걷던 말은 문 앞에서 여덟 시간을 섰다.
 *
 * 이제 하루는 자정부터 자정까지 스물네 시간이고 멈추는 구간이 없다.
 * **이 값 하나로 갈린다** — 다시 0 이 아닌 값으로 두면 그 시각까지가
 * 소등으로 되살아난다(clock.ts 가 전부 여기서 읽는다).
 */
export const DAY_START_HOUR = 0
/** 하루가 닫히는 시각. */
export const LIGHTS_OUT_HOUR = 24
/** 방과후 정산. */
export const SETTLEMENT_HOUR = 21
/** 마지막 여섯 시간이 시작되는 시각(DAY 5). */
export const LAST_HOURS_START_HOUR = 15
/** 종례 — 게임이 끝난다(DAY 5). */
export const CLOSING_HOUR = SETTLEMENT_HOUR

/** 하루 중 실제로 시간이 흐르는 길이(초). 지금은 하루 통째다. */
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

/**
 * 팀 금고에 쌓이는 것. **둘뿐이다.**
 *
 * 영향력이 있었다. 평판을 숫자로 들고 다니는 값이었는데, 표를 받으면
 * 오르고 소문이 돌면 내리는 식이라 「무엇에 쓰는가」가 끝내 생기지
 * 않았다. 쓸 데가 없는 숫자는 금고에 있을 이유가 없다.
 *
 * 남은 둘은 쓸 데가 분명하다 — 지식은 연구로 로봇이 되고, 돈은
 * 상점에서 물건이 된다. 둘 다 팀 공용이고 둘 다 거래할 수 있다.
 */
export type Resource = 'money' | 'knowledge'
export const RESOURCES: readonly Resource[] = ['money', 'knowledge']

export const RESOURCE_LABEL: Record<Resource, string> = {
  money: '돈',
  knowledge: '지식',
}

export const STARTING_RESOURCES: Record<Resource, number> = {
  money: 8,
  knowledge: 4,
}

// ── 표 ──────────────────────────────────────────────────────────

/**
 * 표는 호의뿐이다. **의심표는 없앴다.**
 *
 * 배제는 투명인간 투표가 맡는다(invisible.ts) — 만나지 않고 하는
 * 별개의 투표다. 「좋아한다」와 「지워라」가 같은 저울에 오르면
 * 둘 다 뜻이 흐려진다.
 */
export type VoteKind = 'trust' | 'liking'

export const VOTE_LABEL: Record<VoteKind, string> = {
  trust: '신뢰',
  liking: '호감',
}

/**
 * 표는 이제 **금고를 움직이지 않는다.**
 *
 * 영향력이 있을 때는 신뢰 +2 의심 −2 하는 식으로 값이 붙었다. 영향력을
 * 걷어내면서 그 값도 같이 없앴다 — 받은 표 수는 그대로 세고, 그 수가
 * 「모두의 신뢰」 같은 목표를 판정한다. 표는 점수로 가지 금고로 가지 않는다.
 */

/** 표를 줄 수 있는 시간. */
export const VOTE_OPEN_HOUR = DAY_START_HOUR
export const VOTE_CLOSE_HOUR = SETTLEMENT_HOUR
/** 하루에 한 사람이 줄 수 있는 표. */
export const VOTE_PER_PLAYER_DAILY = 1
/** 정보부장이 보낸 사람을 볼 수 있는 횟수(하루). */
export const INTEL_VOTE_PEEK_DAILY = 1

// ── 털어놓기와 약점 ─────────────────────────────────────────────

/**
 * 털어놓기는 **얻는 것이 없다.** 잃는 것만 있다.
 *
 * 영향력이 있을 때는 처음 한 번 +3을 받았다. 그 보상이 없어진 지금,
 * 털어놓기는 순수하게 「듣는 사람마다 나에 대한 약점이 하나 생기는」
 * 행동이다 — 그런데도 하는 이유는 상대가 나를 믿게 만들기 위해서다.
 * 값을 치르지 않는 신뢰는 신뢰가 아니다.
 */

/** 털어놓는 방식. */
export type RevealScope = 'private' | 'class'

/** 발 묶기 — 말이 움직이지도 행동하지도 못한다(게임 시계). */
export const LEVERAGE_BIND_GAME_HOURS = 6
/** 갈취로 뜯어 오는 돈. 영향력이 없어진 자리를 돈이 받았다. */
export const LEVERAGE_EXTORT_MONEY = 3

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

// ── 그 밖의 행동 ────────────────────────────────────────────────

/** 생산 한 번에 얻는 돈. */
export const PRODUCE_MONEY = 3
/** 공부 한 번에 버는 팀 금고의 지식. 생산의 짝이다. */
export const STUDY_KNOWLEDGE = 2
// ── 교역과 동맹 ─────────────────────────────────────────────────

// 답 없는 제안이라는 것이 없어졌다. 거래는 마주 선 자리에서 끝난다 —
// 수락하면 성립하고, 거절하거나 자리를 뜨거나 페이즈가 닫히면 사라진다.
// 그래서 「몇 개까지 보낼 수 있는가」를 셀 일이 없다.
/** 한 팀이 동시에 맺을 수 있는 동맹 수. */
export const ALLIANCE_LIMIT = 1
/** 먼저 깬 팀이 새 동맹을 못 맺는 시간(실제 시계). */
export const ALLIANCE_BREAK_LOCK_REAL_HOURS = 12
/** 이날 08:00에 모든 동맹이 풀린다. */
export const ALLIANCE_CLEAR_DAY = 4

// ── 카드 ────────────────────────────────────────────────────────

export type CardKind =
  | 'forcedMarch' | 'ambush'
  | 'windfall' | 'cramming'
  | 'falseRumor' | 'blockade'
  | 'secretLetter' | 'accord'
  | 'ambushHide'

export interface CardSpec {
  kind: CardKind
  name: string
  group: '확장' | '방어' | '생산' | '견제' | '외교' | '특수'
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
  { kind: 'windfall', name: '특별 매출', group: '생산', text: '돈 +4.' },
  { kind: 'cramming', name: '벼락치기', group: '생산', text: '지식 +4.' },
  { kind: 'falseRumor', name: '헛소문', group: '견제', text: '대상 팀 돈 −2.', needsTeam: true },
  { kind: 'blockade', name: '봉쇄', group: '견제', text: '칸 하나에 여섯 시간 동안 새 깃발을 못 꽂고, 꽂힌 깃발은 멈춘다.', needsTile: true },
  { kind: 'secretLetter', name: '밀서', group: '외교', text: '다른 팀 한 명과 한 시간짜리 비밀 대화방을 연다.' },
  { kind: 'accord', name: '협정서', group: '외교', text: '다음 교역이 성립하면 양쪽 팀 모두 돈 +2.' },
  { kind: 'ambushHide', name: '잠복', group: '특수', text: '우리 말 하나가 여섯 시간 동안 누구에게도 보이지 않는다. 판정에서는 센다.', needsPawn: true },
]

export const CARD_BY_KIND: Record<CardKind, CardSpec> = Object.fromEntries(
  CARDS.map((c) => [c.kind, c]),
) as Record<CardKind, CardSpec>

/** 팀 손패 한도. */
export const HAND_LIMIT = 4

export const CARD_FORCED_MARCH_TILES = 2
export const CARD_WINDFALL_MONEY = 4
export const CARD_CRAMMING_KNOWLEDGE = 4
export const CARD_FALSE_RUMOR_MONEY = 2
export const CARD_BLOCKADE_GAME_HOURS = 6
export const CARD_SECRET_LETTER_REAL_HOURS = 1
export const CARD_ACCORD_MONEY = 2
export const CARD_HIDE_GAME_HOURS = 6

// ── 비밀 목표 ───────────────────────────────────────────────────

export type GoalKind =
  | 'gateGuard' | 'theMiddle' | 'twoHearts' | 'crossroadLord' | 'unbrokenPath'
  | 'fortress' | 'raider' | 'distantFriend' | 'noBetrayal' | 'everyonesTrust'
  | 'tightLipped' | 'scholars' | 'moneyed' | 'rival'

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
  { kind: 'theMiddle', name: '한가운데', text: '2-3 교실을 가지고 있다', points: 7 },
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

/** 마지막 여섯 시간이 시작되는 날. */
export const LAST_HOURS_DAY = 5

// ── 개인 일정 ───────────────────────────────────────────────────
//
// 날짜는 시간표의 사실이라 여기 둔다. 역할 데이터(roles.ts)에 두면
// 화면이 날짜 하나 때문에 숨긴 사실 열넷을 통째로 불러오게 된다.

/** 중요한 사람을 고르는 날. */
export const CHOSEN_ONE_DAY = 3
/** 무엇을 지킬지 고르는 날. */
export const DAY4_CHOICE_DAY = 4

// ── 투명인간 (눈이 그치지 않는 학교 ①) ─────────────────────────

/**
 * 이만큼 받아야 투명인간이 된다.
 *
 * 한 장이면 된다 — 대신 **동률이면 아무도 안 된다.** 누군가를 지우려면
 * 여러 사람이 같은 이름을 적어야 한다는 것은 그쪽 규칙이 맡는다.
 */
export const INVISIBLE_MIN_VOTES = 1

/**
 * 투명인간이 나온 팀이 그날 팀 전체로 더 받는 토큰.
 *
 * 세 명짜리 팀에서 한 명이 빠지면 판정 머릿수가 넷(주장 둘 + 하나)에서
 * 둘로 반토막 난다. 지워진 것은 한 사람인데 팀이 무너지면, 투표가
 * 사람을 겨누는 것이 아니라 팀을 겨누는 것이 된다.
 *
 * **이때만 보유 한도를 넘는다.** 넘긴 것은 그다음 지급에서 깎인다.
 */
export const INVISIBLE_TEAM_TOKEN_BONUS = 4
/**
 * 같은 사람이 이틀 연속으로 투명인간이 되지는 않는다.
 * A는 몇 주째였다. 우리는 하루면 된다.
 */
export const INVISIBLE_NO_REPEAT = true
/** 투명인간인 날에는 그 자리 체류가 이만큼 빨리 쌓인다. */
export const INVISIBLE_STAY_MULTIPLIER = 2
/** 투명인간이 전체 채팅에 쓴 말은 남에게 이렇게 보인다. */
export const INVISIBLE_CHAT_MASK = '…'
/** 한 줄에 칠 수 있는 글자 수. 서버와 화면이 같은 값을 본다. */
export const CHAT_MAX_LEN = 300

// ── 운영자 코드 ────────────────────────────────────────────────
//
// 짧은 코드는 두들겨 볼 수 있다. 틀린 횟수를 판 전체로 세서 잠근다 —
// 사람별로 세면 계정을 새로 만들어 피해 갈 수 있으니 의미가 없다.

/** 이보다 짧은 코드는 서버가 아예 거절한다. */
export const HOST_GATE_MIN_CODE = 6
/** 한 창 안에서 이만큼 틀리면 잠근다. */
export const HOST_GATE_MAX_MISSES = 8
/** 잠기는 시간이자 횟수를 세는 창의 길이. */
export const HOST_GATE_LOCK_MS = 15 * 60 * 1000

// ── A의 기억 (②) ───────────────────────────────────────────────

/** 기억이 묻힌 칸의 층위. 다툼이 벌어지는 곳에만 있다. */
export const MEMORY_TIERS: readonly Tier[] = ['gate', 'cross', 'core', 'plaza']

// ── 그 자리와 깨달음 (③) ───────────────────────────────────────

/** 그 자리에 이만큼 머물면 A의 시선이 열린다(활동 시간). */
export const AWAKENING_STAY_GAME_HOURS = 3

// ── 눈이 그친 아침 (④) ─────────────────────────────────────────

/** 눈이 그치려면 깨달음에 이른 사람이 이만큼 필요하다. */
export const SNOW_AWAKENED_NEEDED = 9
/** 그리고 어떤 형태로든 털어놓은 사람이 이만큼. */
export const SNOW_REVEALED_NEEDED = 7
/** 눈발 단계. 0이 그친 것이고 5가 가장 굵다. 수치 대신 이 값만 내려보낸다. */
export const SNOW_LEVEL_MAX = 5
/** 눈이 그치면 전원이 받는 개인 점수. */
export const SNOW_STOPPED_SCORE = 1

// ── 다섯 시의 창고 (⑤) ─────────────────────────────────────────

export const STORAGE_TILE = 'storage'
export const STORAGE_LOCK_DAY = 5
export const STORAGE_LOCK_HOUR = 17
export const STORAGE_UNLOCK_HOUR = 19
