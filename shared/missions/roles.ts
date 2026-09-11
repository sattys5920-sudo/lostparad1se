// 개인 역할 14종.
//
// 기준 문서는 docs/personal_missions_v2.md다. 판정 로직에는 숫자를 쓰지
// 않는다 — 조건은 전부 여기 데이터로 있고, 판정 엔진은 조항 종류마다
// 계산법 하나씩만 안다.
//
// 미션 하나는 여러 조항으로 쪼갠다. 조항마다 진행도를 어디까지 보여 줄지가
// 다르기 때문이다. 예를 들어 떠날 아이의 "세 팀 칸에 체류"는 실시간으로
// 보여 줘도 되지만 "우리 팀이 1위가 아님"은 끝나야 안다. 한 덩어리로
// 다루면 둘 다 감추거나 둘 다 새게 된다.
import type { TeamId } from '../rules/v2'

// ── 갈래와 역할 ─────────────────────────────────────────────────

/** 팀의 길 · 사람의 길 · 밖의 길. 팀마다 팀의 길 하나와 밖의 길 하나를 받는다. */
// 이름과 갈래는 공개다. roleNames.ts에 따로 두고 여기서 다시 내보낸다 —
// 화면은 그쪽만 불러야 한다. 이 파일에는 숨긴 사실 열넷이 들어 있어서,
// 화면이 이름 하나 때문에 이걸 부르면 전부 번들에 실린다.
export type { RoleId, RolePath } from './roleNames'
export { ROLE_NAMES, ROLE_PATH_LABEL, roleName } from './roleNames'
import type { RoleId, RolePath } from './roleNames'



/** 팀마다 팀의 길에서 하나, 밖의 길에서 하나를 반드시 받는다. */
export const REQUIRED_PATHS: readonly RolePath[] = ['team', 'outside']
/** 남은 자리는 여기서 채운다. */
export const FILLER_PATH: RolePath = 'people'

// ── 진행도를 어디까지 보여 줄까 ─────────────────────────────────

/**
 * 진행도가 익명 표와 남의 역할을 새어 나가게 하면 안 된다.
 *
 *   realtime    바로 보여 준다. 내 행동으로만 정해지는 것
 *   settlement  21:00 정산 때만 갱신. 받은 표 수에 걸린 것 —
 *               실시간이면 누가 방금 나에게 표를 줬는지 역추적된다
 *   endOnly     진행도를 아예 보여 주지 않는다. 보낸 사람이 특정되거나
 *               남의 표·순위·소유가 걸린 것. 화면에는 「끝날 때 판정」
 *   hidden      끝까지 숨긴다. 고발자의 적중 여부 —
 *               알려 주면 그날 힌트 역할을 역산할 수 있다
 */
export type Disclosure = 'realtime' | 'settlement' | 'endOnly' | 'hidden'

/**
 * 조항 하나가 무엇을 세는가. 판정 엔진이 종류마다 계산법을 하나씩 갖는다.
 * 여기서는 종류와 기준치만 적고, 세는 방법은 엔진이 안다.
 */
export type ClauseKind =
  // 깃발
  | 'defenseJoined' | 'attackJoined'
  | 'bondFlagFailedHere' | 'capturedWhereBondStood'
  | 'teamNeverLostTile'
  // 소유·순위·동맹
  | 'ownFragmentTilesAtEnd' | 'teamRankNotFirst' | 'bondTeamRankHigher'
  | 'alliedWithBondAtEnd'
  // 약점
  | 'leverageSpent' | 'leverageSpentExtort' | 'neverSpentLeverage'
  | 'holdLeverageOnBondAtEnd'
  // 체류·방문
  | 'fragmentTileStayDays' | 'stayInRivalTeamTiles' | 'tilesVisited'
  | 'coStayWithBond' | 'coStayWithChosen'
  // 표 — 받은 것
  | 'trustReceived' | 'suspicionReceivedAtMost' | 'suspicionAfterRevealAtMost'
  | 'voteReceivedFromBond' | 'trustReceivedFromBond' | 'bondSuspicionReceivedAtMost'
  // 표 — 준 것
  | 'trustGivenToBond' | 'trustLikingGivenToBond' | 'trustGivenToBondOnDays'
  | 'trustGivenToChosen' | 'noSuspicionCast'
  | 'hitSuspicion' | 'missSuspicionAtMost'
  // 털어놓기
  | 'classRevealAfterDay' | 'classRevealOnDay' | 'neverRevealed'
  | 'noRevealUntilDay' | 'heardPrivateRevealFrom'
  | 'bondPrivateRevealToMe' | 'privateRevealToBond'
  // 그 밖
  | 'tradeWithEachRivalTeam' | 'bondTradeWithUs' | 'scoutCount'

export interface Clause {
  kind: ClauseKind
  /** 사람이 읽는 말. 진행도 화면에 그대로 뜬다. */
  text: string
  /** 이만큼 이상이어야 한다. */
  need?: number
  /** 이만큼 이하여야 한다. */
  limit?: number
  /** 시간 조건(게임 시계 기준 시간). */
  hours?: number
  /** 같은 팀이라 표를 줄 수 없을 때 대신 쓰는 시간. */
  altHours?: number
  /** 날짜 조건. */
  day?: number
  days?: number[]
  /** 며칠 이상 채워야 하는가. */
  dayCount?: number
  disclosure: Disclosure
  /**
   * 이 조항이 깨지면 그 자리에서 실패가 확정된다.
   * 뒤집힐 수 있는 조건에는 붙이지 않는다 — 목격자의 "털어놓은 뒤 의심표
   * 1장 이하"는 마지막 순간까지 뒤집힐 수 있으므로 확정하지 않는다.
   */
  failsOnBreak?: boolean
  /** 이 조항 하나만 채워도 미션 전체가 달성된다(지킴이의 무실점). */
  sufficient?: boolean
}

export interface MissionSpec {
  /** 미션 전체를 한 줄로. */
  text: string
  clauses: Clause[]
}

export interface RoleSpec {
  id: RoleId
  name: string
  path: RolePath
  /** 역할 카드 맨 위에 붙는 한 줄. */
  flavor: string
  /** 털어놓기는 이 문장을 밝히는 일이다. 글자 그대로 상대에게 보인다. */
  secret: string
  main: MissionSpec
  bond: MissionSpec
  /** A의 기록이 이 역할을 가리키는 날. 없으면 null. */
  hintDay: number | null
}

// ── 역할 ────────────────────────────────────────────────────────

export const ROLES: readonly RoleSpec[] = [
  // ── 팀의 길 ──
  {
    id: 'guard',
    name: '지킴이',
    path: 'team',
    flavor: '늘 교문 앞을 지키던 당번.',
    secret: '그날 저녁 문단속 당번이었다. 안을 확인하지 않고 문을 잠근 채 먼저 집에 갔다.',
    main: {
      text: '방어 참여 2회 이상. 닷새 동안 우리 팀이 칸을 한 번도 뺏기지 않았다면 자동 달성.',
      clauses: [
        { kind: 'defenseJoined', text: '방어 참여', need: 2, disclosure: 'realtime' },
        {
          kind: 'teamNeverLostTile',
          text: '우리 팀이 칸을 한 번도 뺏기지 않음',
          disclosure: 'realtime',
          sufficient: true,
        },
      ],
    },
    bond: {
      text: '인연 대상이 꽂은 깃발이 실패한 순간, 그 칸에 서 있었던 적이 1회 이상.',
      clauses: [
        { kind: 'bondFlagFailedHere', text: '인연 대상의 깃발을 막아섬', need: 1, disclosure: 'realtime' },
      ],
    },
    hintDay: null,
  },
  {
    id: 'vanguard',
    name: '선봉',
    path: 'team',
    flavor: '무슨 일이든 앞장서던 아이.',
    secret: 'A가 아끼던 물건을 망가뜨리고, 끝내 사과하지 않았다.',
    main: {
      text: '공격 참여 2회 이상.',
      clauses: [{ kind: 'attackJoined', text: '공격 참여', need: 2, disclosure: 'realtime' }],
    },
    bond: {
      text: '인연 대상이 판정 순간 서 있던 칸을 우리 팀 깃발로 가져간 적이 1회 이상.',
      clauses: [
        { kind: 'capturedWhereBondStood', text: '인연 대상이 선 칸을 가져감', need: 1, disclosure: 'realtime' },
      ],
    },
    hintDay: 4,
  },
  {
    id: 'librarian',
    name: '도서부',
    path: 'team',
    flavor: 'A의 기록을 처음 발견한 도서부원.',
    secret: '기록 한 장을 아무에게도 보여 주지 않고 아직 가지고 있다.',
    main: {
      text: '게임이 끝날 때, A의 기록이 닷새 동안 지목한 칸 중 2칸 이상을 우리 팀이 가지고 있다.',
      clauses: [
        { kind: 'ownFragmentTilesAtEnd', text: '기록이 지목한 칸 보유', need: 2, disclosure: 'endOnly' },
      ],
    },
    bond: {
      text: '인연 대상이 제안했거나 수락한 교역이 우리 팀과 1회 이상 성립한다.',
      clauses: [{ kind: 'bondTradeWithUs', text: '인연 대상과의 교역 성립', need: 1, disclosure: 'realtime' }],
    },
    hintDay: 1,
  },
  {
    id: 'shadow',
    name: '그림자',
    path: 'team',
    flavor: '남의 약점을 누구보다 먼저 알아채는 아이.',
    secret: 'A에게 빌린 돈을 끝내 갚지 않았다.',
    main: {
      text: '약점을 2번 이상 쓰고, 그중 1번 이상은 갈취.',
      clauses: [
        { kind: 'leverageSpent', text: '약점 사용', need: 2, disclosure: 'realtime' },
        { kind: 'leverageSpentExtort', text: '그중 갈취', need: 1, disclosure: 'realtime' },
      ],
    },
    bond: {
      text: '인연 대상에 대한 약점을 쥔 채로 게임이 끝난다.',
      clauses: [
        { kind: 'holdLeverageOnBondAtEnd', text: '인연 대상의 약점을 쥔 채 종료', disclosure: 'endOnly' },
      ],
    },
    hintDay: 2,
  },

  // ── 사람의 길 ──
  {
    id: 'buddy',
    name: '단짝',
    path: 'people',
    flavor: '아무도 A를 모를 때 A를 알던 아이.',
    secret: 'A가 사라지기 전날 둘은 크게 싸웠고, 끝내 화해하지 못했다.',
    main: {
      text: '그날 A의 기록이 지목한 칸에 그날 2시간 이상 체류한다. 닷새 중 4일 이상.',
      clauses: [
        {
          kind: 'fragmentTileStayDays',
          text: '지목 칸에 2시간 이상 머문 날',
          hours: 2,
          dayCount: 4,
          disclosure: 'realtime',
        },
      ],
    },
    bond: {
      text: '인연 대상에게 신뢰표를 2장 이상 주고, 인연 대상에게서 신뢰나 호감을 1장 이상 받는다.',
      clauses: [
        { kind: 'trustGivenToBond', text: '인연 대상에게 신뢰표', need: 2, disclosure: 'realtime' },
        // 누가 줬는지가 드러나면 익명 표가 무너진다. 끝에만 판정한다
        { kind: 'voteReceivedFromBond', text: '인연 대상에게서 신뢰·호감', need: 1, disclosure: 'endOnly' },
      ],
    },
    hintDay: 1,
  },
  {
    id: 'witness',
    name: '목격자',
    path: 'people',
    flavor: '그날 저녁 A를 마지막으로 본 아이.',
    secret: 'A가 누군가와 함께 구관 쪽으로 걸어가는 걸 봤다. 그게 누구였는지는 아직 말하지 않았다.',
    main: {
      text: 'DAY 3 이후에 전체 털어놓기를 하고, 털어놓은 뒤 받은 의심표가 1장 이하. DAY 2까지 어떤 형태로든 털어놓으면 실패.',
      clauses: [
        { kind: 'noRevealUntilDay', text: 'DAY 2까지 털어놓지 않음', day: 2, disclosure: 'realtime', failsOnBreak: true },
        { kind: 'classRevealAfterDay', text: 'DAY 3 이후 전체 털어놓기', day: 3, disclosure: 'realtime' },
        // 마지막 순간까지 뒤집힐 수 있다. 실패로 확정하지 않는다
        { kind: 'suspicionAfterRevealAtMost', text: '털어놓은 뒤 받은 의심표', limit: 1, disclosure: 'settlement' },
      ],
    },
    bond: {
      text: '인연 대상과 동석 3시간 이상.',
      clauses: [{ kind: 'coStayWithBond', text: '인연 대상과 동석', hours: 3, disclosure: 'realtime' }],
    },
    hintDay: 2,
  },
  {
    id: 'liar',
    name: '거짓말쟁이',
    path: 'people',
    flavor: '그날 어디 있었냐는 질문에 거짓말을 한 아이.',
    secret: '그날 일찍 집에 갔다고 했지만, 사실은 해가 질 때까지 학교에 남아 있었다.',
    main: {
      text: '신뢰표를 3장 이상 받고, 의심표는 2장 이하로 받고, 끝까지 털어놓지 않는다.',
      clauses: [
        { kind: 'trustReceived', text: '받은 신뢰표', need: 3, disclosure: 'settlement' },
        { kind: 'suspicionReceivedAtMost', text: '받은 의심표', limit: 2, disclosure: 'settlement' },
        { kind: 'neverRevealed', text: '끝까지 털어놓지 않음', disclosure: 'realtime', failsOnBreak: true },
      ],
    },
    bond: {
      text: '인연 대상에게 신뢰와 호감을 합쳐 3장 이상 준다.',
      clauses: [
        { kind: 'trustLikingGivenToBond', text: '인연 대상에게 신뢰·호감', need: 3, disclosure: 'realtime' },
      ],
    },
    hintDay: 4,
  },
  {
    id: 'accuser',
    name: '고발자',
    path: 'people',
    flavor: 'A의 일에 누군가 책임이 있다고 믿는 아이.',
    secret: 'A는 요즘 누가 무섭다고 털어놓은 적이 있다. 그 말을 듣고도 흘려들었다.',
    main: {
      text: '적중 의심 1회 이상, 헛짚은 의심 2회 이하.',
      clauses: [
        // 적중 여부를 알려 주면 그날 힌트 역할을 역산할 수 있다. 끝까지 숨긴다
        { kind: 'hitSuspicion', text: '적중 의심', need: 1, disclosure: 'hidden' },
        { kind: 'missSuspicionAtMost', text: '헛짚은 의심', limit: 2, disclosure: 'hidden' },
      ],
    },
    bond: {
      text: '인연 대상이 닷새 동안 받은 의심표가 2장 이하.',
      clauses: [
        { kind: 'bondSuspicionReceivedAtMost', text: '인연 대상이 받은 의심표', limit: 2, disclosure: 'endOnly' },
      ],
    },
    hintDay: 3,
  },
  {
    id: 'notebook',
    name: '수첩',
    path: 'people',
    flavor: '들은 이야기를 전부 적어 두는 아이.',
    secret: 'A의 이야기도 적어 두었다. 그 수첩 한 권이 사라졌다.',
    main: {
      text: '서로 다른 2명에게서 1:1 털어놓기를 듣고, 끝까지 약점을 한 번도 쓰지 않는다.',
      clauses: [
        { kind: 'heardPrivateRevealFrom', text: '1:1 털어놓기를 들은 사람', need: 2, disclosure: 'realtime' },
        { kind: 'neverSpentLeverage', text: '약점을 한 번도 쓰지 않음', disclosure: 'realtime', failsOnBreak: true },
      ],
    },
    bond: {
      text: '인연 대상이 나에게 1:1 털어놓기를 한다.',
      clauses: [
        { kind: 'bondPrivateRevealToMe', text: '인연 대상이 나에게 털어놓음', disclosure: 'realtime' },
      ],
    },
    hintDay: null,
  },
  {
    id: 'letter',
    name: '편지',
    path: 'people',
    flavor: 'A에게 편지를 쓰고도 끝내 건네지 못한 아이.',
    secret: '그 편지를 아직 가방에 넣고 다닌다.',
    main: {
      text: 'DAY 3에 고른 중요한 사람과 DAY 3~5 동안 동석 6시간 이상, 그리고 그 사람에게 신뢰표 1장 이상. 같은 팀이라 표를 줄 수 없으면 동석 9시간 이상으로 대신한다.',
      clauses: [
        {
          kind: 'coStayWithChosen',
          text: '중요한 사람과 동석',
          hours: 6,
          altHours: 9,
          day: 3,
          disclosure: 'realtime',
        },
        { kind: 'trustGivenToChosen', text: '중요한 사람에게 신뢰표', need: 1, disclosure: 'realtime' },
      ],
    },
    bond: {
      text: '인연 대상에게 1:1 털어놓기를 한다.',
      clauses: [{ kind: 'privateRevealToBond', text: '인연 대상에게 털어놓음', disclosure: 'realtime' }],
    },
    hintDay: 5,
  },

  // ── 밖의 길 ──
  {
    id: 'leaver',
    name: '떠날 아이',
    path: 'outside',
    flavor: '이 학교를 떠날 날만 기다리던 아이.',
    secret: '전학 서류를 이미 냈다. 그걸 아는 사람은 A뿐이었다.',
    main: {
      text: '우리 팀이 1위로 끝나지 않고, 서로 다른 세 팀의 칸에 각각 1시간 이상 체류한다.',
      clauses: [
        // 공동 1위도 1위로 본다
        { kind: 'teamRankNotFirst', text: '우리 팀이 1위가 아님', disclosure: 'endOnly' },
        {
          kind: 'stayInRivalTeamTiles',
          text: '다른 팀 칸에 1시간 이상 머문 팀',
          need: 3,
          hours: 1,
          disclosure: 'realtime',
        },
      ],
    },
    bond: {
      text: '인연 대상의 팀이 우리 팀보다 높은 순위로 끝난다.',
      clauses: [
        // 순위가 같으면 실패
        { kind: 'bondTeamRankHigher', text: '인연 대상 팀이 더 높은 순위', disclosure: 'endOnly' },
      ],
    },
    hintDay: 3,
  },
  {
    id: 'mediator',
    name: '중재자',
    path: 'outside',
    flavor: '싸움이 나면 늘 가운데 서던 아이.',
    secret: 'A가 누군가와 다투던 날, 말리지 않고 조용히 자리를 떠났다.',
    main: {
      text: '다른 세 팀 모두와 각각 교역 참여 1회 이상.',
      clauses: [
        { kind: 'tradeWithEachRivalTeam', text: '교역한 다른 팀', need: 3, disclosure: 'realtime' },
      ],
    },
    bond: {
      text: '게임이 끝날 때 우리 팀과 인연 대상의 팀이 동맹 상태다.',
      clauses: [{ kind: 'alliedWithBondAtEnd', text: '인연 대상 팀과 동맹인 채 종료', disclosure: 'endOnly' }],
    },
    hintDay: null,
  },
  {
    id: 'transfer',
    name: '전학생',
    path: 'outside',
    flavor: '이번 학기에 전학 온, 아직 학교가 낯선 아이.',
    secret: '전학 오기 전 학교에서 A를 알았다. 여기서 다시 만났을 때 둘 다 모르는 척했다.',
    main: {
      text: '서로 다른 칸 15곳 이상 방문하고, 탐색 3회 이상.',
      clauses: [
        { kind: 'tilesVisited', text: '방문한 칸', need: 15, disclosure: 'realtime' },
        { kind: 'scoutCount', text: '탐색', need: 3, disclosure: 'realtime' },
      ],
    },
    bond: {
      text: '인연 대상에게서 신뢰표를 1장 이상 받는다.',
      clauses: [
        // 누가 줬는지가 드러나면 익명 표가 무너진다
        { kind: 'trustReceivedFromBond', text: '인연 대상에게서 신뢰표', need: 1, disclosure: 'endOnly' },
      ],
    },
    hintDay: null,
  },
  {
    id: 'bystander',
    name: '방관자',
    path: 'outside',
    flavor: '모든 걸 보고도 아무 말도 하지 않은 아이.',
    secret: 'A가 혼자 남겨지는 걸 여러 번 봤지만, 한 번도 말을 걸지 않았다.',
    main: {
      text: '의심표를 한 장도 던지지 않고, DAY 4까지 누구에게도 털어놓지 않다가, DAY 5에 전체 털어놓기를 한다. 받은 의심표는 2장 이하.',
      clauses: [
        { kind: 'noSuspicionCast', text: '의심표를 던지지 않음', disclosure: 'realtime', failsOnBreak: true },
        { kind: 'noRevealUntilDay', text: 'DAY 4까지 털어놓지 않음', day: 4, disclosure: 'realtime', failsOnBreak: true },
        { kind: 'classRevealOnDay', text: 'DAY 5에 전체 털어놓기', day: 5, disclosure: 'realtime' },
        { kind: 'suspicionReceivedAtMost', text: '받은 의심표', limit: 2, disclosure: 'settlement' },
      ],
    },
    bond: {
      text: '인연 대상에게 DAY 4와 DAY 5에 연속으로 신뢰표를 준다.',
      clauses: [
        { kind: 'trustGivenToBondOnDays', text: 'DAY 4·5 연속 신뢰표', days: [4, 5], disclosure: 'realtime' },
      ],
    },
    hintDay: 5,
  },
]

export const ROLE_BY_ID: Record<RoleId, RoleSpec> = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<RoleId, RoleSpec>

export const ROLE_IDS: readonly RoleId[] = ROLES.map((r) => r.id)

export const ROLES_BY_PATH: Record<RolePath, readonly RoleId[]> = {
  team: ROLES.filter((r) => r.path === 'team').map((r) => r.id),
  people: ROLES.filter((r) => r.path === 'people').map((r) => r.id),
  outside: ROLES.filter((r) => r.path === 'outside').map((r) => r.id),
}

// ── A의 기록이 가리키는 역할 ────────────────────────────────────

/**
 * 조각은 역할 이름을 말하지 않는다. 숨긴 사실과 겹치는 장면을 비출 뿐이다.
 * 가리켜진 역할을 정확히 짚어 의심하면 그 팀 영향력이 두 배로 깎인다.
 */
export const HINT_SCHEDULE: Record<number, readonly RoleId[]> = {
  1: ['buddy', 'librarian'],
  2: ['witness', 'shadow'],
  3: ['accuser', 'leaver'],
  4: ['liar', 'vanguard'],
  5: ['bystander', 'letter'],
}

/** 닷새 내내 가리켜지지 않는 역할. 눈에 띄지 않는 대신 고발자의 표적도 아니다. */
export const NEVER_HINTED: readonly RoleId[] = ROLE_IDS.filter(
  (id) => !Object.values(HINT_SCHEDULE).some((ids) => ids.includes(id)),
)

// ── 점수 ────────────────────────────────────────────────────────

/** 개인 점수는 팀 점수에 아무 영향도 주지 않는다. */
export const SCORE = {
  main: 3,
  bond: 2,
  /** DAY 4에 고른 것이 맞아떨어졌을 때. */
  choice: 2,
  /** 종례 순간 중요한 사람과 같은 칸에 서 있었다. */
  closingTogether: 1,
  /** 서로를 중요한 사람으로 골랐다. */
  closingMutual: 1,
  /** 그 자리에 서 보고 A의 시선이 열렸다. */
  awakening: 1,
  /** 눈이 그친 아침. 열넷 모두가 함께 받는다. */
  snowStopped: 1,
} as const

export const MAX_PERSONAL_SCORE =
  SCORE.main +
  SCORE.bond +
  SCORE.choice +
  SCORE.closingTogether +
  SCORE.closingMutual +
  SCORE.awakening +
  SCORE.snowStopped

// ── DAY 3·4의 선택 ──────────────────────────────────────────────

// 날짜는 v2.ts의 시간표에 있다. 여기서 다시 내보내기만 한다
export { CHOSEN_ONE_DAY, DAY4_CHOICE_DAY } from '../rules/v2'

export type Day4Choice = 'team' | 'self' | 'bond'

export interface Day4ChoiceSpec {
  id: Day4Choice
  label: string
  text: string
}

export const DAY4_CHOICES: readonly Day4ChoiceSpec[] = [
  { id: 'team', label: '팀을 지킨다', text: '우리 팀이 최종 2위 이내' },
  { id: 'self', label: '나를 지킨다', text: '내 주 미션 달성' },
  { id: 'bond', label: '그 사람을 지킨다', text: '내 인연 미션 달성' },
]

/** 「팀을 지킨다」가 성립하는 순위. 공동 2위도 성공이다. */
export const DAY4_TEAM_RANK_WITHIN = 2

// ── 엔딩 ────────────────────────────────────────────────────────

export type EndingBand = 'stayed' | 'passed' | 'left'

export interface EndingBandSpec {
  id: EndingBand
  min: number
  max: number
  name: string
  line: string
}

export const ENDING_BANDS: readonly EndingBandSpec[] = [
  { id: 'stayed', min: 8, max: 11, name: '곁에 남은 아이', line: 'A가 사라진 뒤에도 누군가의 곁에 남았다' },
  { id: 'passed', min: 4, max: 7, name: '지나간 아이', line: '무언가는 지켰고, 무언가는 흘려보냈다' },
  { id: 'left', min: 0, max: 3, name: '남겨진 아이', line: '닷새가 끝났고, 여전히 혼자다' },
]

export function endingBandOf(score: number): EndingBandSpec {
  const band = ENDING_BANDS.find((b) => score >= b.min && score <= b.max)
  return band ?? ENDING_BANDS[ENDING_BANDS.length - 1]
}

/** 아직 쓰지 않은 자리. 문장은 사람이 직접 쓴다. */
export const ENDING_PLACEHOLDER = '[작성 예정]'

/**
 * 역할 14 × 구간 3 = 42개 자리.
 *
 * 비워 두지 않고 자리만 만들어 둔다 — 구조가 먼저 있어야 빠진 것이
 * 눈에 보이고, 판정 코드가 문장을 기다리지 않고 돌아간다.
 */
export const ENDING_TEXT: Record<RoleId, Record<EndingBand, string>> = Object.fromEntries(
  ROLE_IDS.map((id) => [
    id,
    Object.fromEntries(ENDING_BANDS.map((b) => [b.id, ENDING_PLACEHOLDER])) as Record<EndingBand, string>,
  ]),
) as Record<RoleId, Record<EndingBand, string>>

/**
 * 서로를 중요한 사람으로 고른 두 사람에게 덧붙는 문장.
 * {name} 자리에 상대 이름이 들어간다.
 */
export const MUTUAL_ENDING_TEMPLATE = ENDING_PLACEHOLDER
export const MUTUAL_ENDING_NAME_SLOT = '{name}'

// ── 인연 고리 ───────────────────────────────────────────────────

/**
 * 열네 명을 하나의 고리로 잇는다. 모든 사람은 누군가의 인연 대상이 되고,
 * 딱 한 번만 된다. 고리에서 이웃한 두 사람은 반드시 다른 팀이다.
 */
export const BOND_RING_SIZE = 14

export interface BondAssignment {
  playerId: string
  bondId: string
}

/** 인연 고리가 규칙을 지키는지. 배정 코드와 시험이 같이 쓴다. */
export function validateBondRing(
  ring: readonly BondAssignment[],
  teamOf: (playerId: string) => TeamId,
): { ok: true } | { ok: false; reason: string } {
  const n = ring.length
  if (n !== BOND_RING_SIZE) return { ok: false, reason: `열네 명이어야 한다 (${n}명)` }

  const next = new Map(ring.map((b) => [b.playerId, b.bondId]))
  if (next.size !== n) return { ok: false, reason: '같은 사람이 두 번 들어 있다' }

  const targets = new Set(ring.map((b) => b.bondId))
  if (targets.size !== n) return { ok: false, reason: '누군가는 두 번 지목되고 누군가는 아예 빠졌다' }

  for (const b of ring) {
    if (b.playerId === b.bondId) return { ok: false, reason: '자기 자신을 받은 사람이 있다' }
    if (teamOf(b.playerId) === teamOf(b.bondId)) {
      return { ok: false, reason: '같은 팀끼리 이어졌다' }
    }
  }

  // 작은 고리 여러 개가 아니라 하나로 이어져야 한다
  let cursor = ring[0].playerId
  for (let i = 0; i < n; i++) cursor = next.get(cursor) as string
  if (cursor !== ring[0].playerId) return { ok: false, reason: '한 고리로 이어지지 않는다' }
  let seen = 1
  let walk = next.get(ring[0].playerId) as string
  while (walk !== ring[0].playerId) {
    walk = next.get(walk) as string
    seen++
  }
  if (seen !== n) return { ok: false, reason: `고리가 갈라져 있다 (${seen}명짜리)` }

  return { ok: true }
}
