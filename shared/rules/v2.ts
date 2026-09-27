// 영역전 v2 — 모든 수치는 여기 한 곳에만 있다.
//
// 로직 코드에 숫자를 직접 쓰지 않는다. 플레이테스트로 값을 돌려 보려면
// 이 파일만 고치면 되고, 어떤 값이 게임을 어떻게 움직이는지도 여기서만
// 읽으면 된다.
//
// **규칙 원문은 없다.** docs/team_rules_v2.md 를 가리키고 있었는데, 그
// 문서는 건물과 21:00 정산이 있던 시절의 것이라 지웠다. 지금은 이
// 파일과 occupy.ts 가 원문이다.
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

/** 지금 팀마다 몇 명인가. **명단을 센다** — 상수를 읽지 않는다. */
export function teamSizesOf(roster: readonly { team: TeamId }[]): Record<TeamId, number> {
  const out = Object.fromEntries(TEAM_IDS.map((t) => [t, 0])) as Record<TeamId, number>
  for (const r of roster) out[r.team] += 1
  return out
}

/**
 * 방의 등급.
 *
 * 계단은 여기 없다. **계단은 방이 아니라 문이다** — 지나가는 자리라
 * 이름도 정원도 주인도 없고, 거기 서 있는 사람도 없다.
 *
 * **기지(base)는 없앴다.** 팀마다 제 방을 하나씩 못 박아 두던 등급인데,
 * 이제 열넷이 2-3 교실에서 같이 시작하고 팀 이야기는 무전으로 한다 —
 * 아무도 안 가는 제 방이 하나씩 있을 이유가 없어졌다.
 */
export type Tier = 'zone1' | 'gate' | 'cross' | 'lab' | 'core' | 'plaza'

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

/**
 * 봇 시뮬레이터의 한 틱. **더는 걸음 값이 아니다.**
 *
 * 본래는 「이웃 칸 하나를 걷는 데 드는 게임 시간」이었다. 복도가
 * 생기고 계단이 문이 된 뒤로 어느 방이든 한 걸음이라 여러 칸을
 * 걷는 일이 없어졌고, 걷기와 등교 예약을 같이 들어냈다.
 * 페이즈의 걸음 값은 occupy.ts 의 MOVE_MINUTES(10분)다.
 */
export const MOVE_GAME_MIN_PER_TILE = 15

/*
 * 안개의 시야(VISION_RANGE)와 정보부장의 한 겹(INTEL_VISION_BONUS)은
 * 없앴다. **방 안의 머릿수는 들어가야만 안다** — 이웃 방이 보이는
 * 거리라는 것이 없어졌다(fog.ts 의 visibleTiles).
 */

/**
 * 복도에서 **보이고 들리는 거리**. 칸 수다.
 *
 * 복도는 방처럼 문으로 끊기지 않아서 어디까지를 「같이 있다」로 볼지
 * 정해야 한다. 화면이 답이다 — 지도는 한 번에 열 칸 남짓을 보여
 * 주므로(MIN_VIEW_PX 160 ÷ TILE 16), 그 절반쯤이 눈에 들어오는 범위다.
 *
 * 한 줄로 쓴다. 보이는 사람에게 들리고, 안 보이는 사람에게는 안
 * 들린다 — 두 숫자로 두면 「보이는데 말은 안 걸리는」 자리가 생긴다.
 */
export const HALL_SIGHT = 6

// ── 행동 토큰 ───────────────────────────────────────────────────
//
// **여기 있는 것은 전부 봇 시뮬레이터 몫이다**(shared/sim 만 읽는다).
// 판의 토큰은 페이즈가 열릴 때 팀 상자에 들어오는 것 하나뿐이고,
// 그 값은 occupy.ts 의 TOKENS_PER_PHASE·TOKEN_CAP 이다.
//
// **이름이 겹친다.** 아래 TOKEN_CAP 은 4이고 occupy.ts 의 TOKEN_CAP 은
// 12다 — 어느 쪽을 들여다보는지 보고 읽어야 한다. 시뮬레이터를 페이즈
// 모형으로 옮기면 이 묶음은 tokens.ts 와 같이 걷어낸다.

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

/**
 * 사람 하나가 들고 시작하는 것. **빈손이다.**
 *
 * 전에는 돈 2 · 지식 1 을 들려 보냈다. 첫날 아침에 빈 종이 한 장은
 * 살 수 있게 하려던 것이다. 이제는 아무것도 없이 시작한다 — 첫
 * 페이즈에 할 수 있는 일은 걸어가서 방에 서는 것뿐이고, 살 것이
 * 있으려면 먼저 심부름이든 화분이든 손을 놀려야 한다.
 */
export const STARTING_RESOURCES: Record<Resource, number> = {
  money: 0,
  knowledge: 0,
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

// ── 팀 직책 ─────────────────────────────────────────────────────

export type RoleTitle = 'classPresident' | 'treasurer' | 'intelOfficer' | 'athleticDirector'

export const ROLE_TITLES: readonly RoleTitle[] = [
  'classPresident',
  'treasurer',
  'intelOfficer',
  'athleticDirector',
]

export const ROLE_TITLE_LABEL: Record<RoleTitle, string> = {
  classPresident: '학급회장',
  treasurer: '총무',
  intelOfficer: '정보부장',
  athleticDirector: '체육부장',
}

/*
 * **생산·공부는 없앴다.** 여기 있던 PRODUCE_MONEY·STUDY_KNOWLEDGE 도
 * 같이 뺐다 — 페이즈에 토큰을 쓰는 길은 점령(이동)과 연구뿐이다.
 * 돈은 심부름·화분에서, 지식은 문제 종이에서 난다.
 */
// ── 교역과 동맹 ─────────────────────────────────────────────────

// 답 없는 제안이라는 것이 없어졌다. 거래는 마주 선 자리에서 끝난다 —
// 수락하면 성립하고, 거절하거나 자리를 뜨거나 페이즈가 닫히면 사라진다.
// 그래서 「몇 개까지 보낼 수 있는가」를 셀 일이 없다.

// ── 카드 ────────────────────────────────────────────────────────
//
// **없앴다.** 열두 종(강행군·기습·특별 매출·벼락치기·헛소문·봉쇄·밀서·
// 협정서·잠복…)이 여기 있었다. 로봇이 태어날 때만 한 장 뽑혔는데,
// 로봇은 연구, 연구는 지식, 지식은 문제 종이뿐이라 — 종이를 안 놓으면
// 카드 전체가 한 장도 안 돌았다. 만들어 놓고 입구가 바늘구멍이었다.

export const CARD_FORCED_MARCH_TILES = 2
export const CARD_WINDFALL_MONEY = 4
export const CARD_CRAMMING_KNOWLEDGE = 4
export const CARD_FALSE_RUMOR_MONEY = 2
export const CARD_BLOCKADE_GAME_HOURS = 6
export const CARD_SECRET_LETTER_REAL_HOURS = 1
export const CARD_ACCORD_MONEY = 2
export const CARD_HIDE_GAME_HOURS = 6

// ── 점수 ────────────────────────────────────────────────────────

/** 핵심 한 칸당. */
export const SCORE_PER_CORE = 3
/** 남은 자원을 이 수로 나눈다(버림). */
export const SCORE_RESOURCE_DIVISOR = 5
/** 연구 단계에 곱하는 값. */
export const SCORE_RESEARCH_MULTIPLIER = 2

// ── A의 기록과 날짜별 사건 ──────────────────────────────────────

// **방은 처음부터 다 열려 있다.**
//
// 전에는 A의 기록이 날마다 핵심을 두 칸씩 열어 줬고(CORE_OPENING),
// 열리기 전에는 그 방을 가질 수 없었다. 그런데 열넷이 시작하는 방이
// DAY 5에나 열리는 자리여서, 첫 페이즈에 다 같이 서 있는 곳이 아무도
// 못 가지는 자리였다. 이제 스물다섯 방 전부 첫날부터 다툰다 — 다만
// 시작하는 2-3 교실만은 **아무도 못 가진다**(occupy.settle 의 plaza).

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
/** 한 줄에 칠 수 있는 글자 수. 서버와 화면이 같은 값을 본다. */
export const CHAT_MAX_LEN = 300

/**
 * 방 안에서 한 번에 칠 수 있는 글자 수.
 *
 * 무전(CHAT_MAX_LEN)보다 훨씬 짧다. 무전은 적어 두고 읽는 것이지만
 * **방 안의 말은 머리 위에 떠 있다가 사라지는 것**이라, 한 번에
 * 긴 글이 오면 풍선이 지도를 덮고 그나마도 다 못 읽는다. 두 줄에
 * 들어갈 만큼이 상한이다.
 */
export const ROOM_SAY_MAX = 60

/**
 * 도배 막이. 이 시간 안에 이만큼 치면 잠깐 잠근다.
 *
 * 서버가 거절하는 것이 아니라 **화면이 먼저 손을 붙든다** — 방 안의
 * 말은 판정에 안 쓰이므로 서버가 막을 이유가 없고, 막아야 할 것은
 * 옆 사람의 화면이 한 사람 글로 채워지는 일이다.
 */
export const ROOM_SAY_BURST = 3
export const ROOM_SAY_BURST_MS = 3000
/** 붙들려 있는 시간. */
export const ROOM_SAY_COOL_MS = 4000

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
/** 눈발 단계. 0이 그친 것이고 5가 가장 굵다. 수치 대신 이 값만 내려보낸다. */
export const SNOW_LEVEL_MAX = 5
// ── 다섯 시의 창고 (⑤) ─────────────────────────────────────────

export const STORAGE_TILE = 'storage'
export const STORAGE_LOCK_DAY = 5
export const STORAGE_LOCK_HOUR = 17
export const STORAGE_UNLOCK_HOUR = 19
