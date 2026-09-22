// 개인 역할 14종. **서버 전용.**
//
// 기준 문서는 docs/personal_missions_occupy_v3.md다. 판정 로직에는 숫자를
// 한 개도 쓰지 않는다 — 조건 수치와 설명 문구는 전부 이 파일에 있고,
// 판정 엔진은 조항 종류마다 세는 법 하나씩만 안다. 난이도를 조정할 때
// 고치는 파일은 여기 하나다.
//
// 미션 하나를 여러 조항으로 쪼갠다. 조항마다 진행도를 어디까지 보여 줄지가
// 다르기 때문이다. 전학생의 「다른 세 팀 방에 서 있기」는 실시간으로 보여
// 줘도 되지만 「우리 팀이 1위가 아님」은 끝나야 안다. 한 덩어리로 다루면
// 둘 다 감추거나 둘 다 새게 된다.
//
// **점수는 없다.** 미션마다 달성이냐 아니냐만 남긴다.
export type { RoleId, MissionBranch } from './roleNames'
export {
  ASTRAY_BRANCH,
  BRANCHES,
  BRANCH_LABEL,
  ROLES_BY_BRANCH,
  ROLE_BRANCH,
  ROLE_IDS,
  ROLE_NAMES,
  roleName,
} from './roleNames'
import { ROLE_BRANCH, type MissionBranch, type RoleId } from './roleNames'

/** 판에 들어가는 사람 수. */
export const ROSTER_SIZE = 14

// ── 진행도를 어디까지 보여 줄까 ─────────────────────────────────

/**
 * 진행도는 **본인에게만** 간다. 그 안에서도 보여 주는 때가 다르다.
 *
 *   realtime     바로 갱신한다. 내 행동으로만 정해지는 것
 *   daily        하루가 바뀔 때만 갱신. 받은 표에 걸린 것 —
 *                실시간이면 누가 방금 나에게 표를 줬는지 역추적된다
 *   afterBallot  투명인간 발표 직후에만 갱신. 그 전에 알려 주면
 *                누가 누구를 적었는지가 발표 전에 새어 나간다
 *   endOnly      진행도를 아예 보여 주지 않는다. 남의 순위·소유가
 *                걸린 것. 화면에는 「끝날 때 판정」이라고만 뜬다
 */
export type Disclosure = 'realtime' | 'daily' | 'afterBallot' | 'endOnly'

/** 진행도 한 줄에 뜨는 네 가지 상태. */
export type MissionStatus = 'running' | 'met' | 'failed' | 'endOnly'

export const STATUS_LABEL: Record<MissionStatus, string> = {
  running: '진행 중',
  met: '달성',
  failed: '실패',
  endOnly: '끝날 때 판정',
}

// ── 조항 ────────────────────────────────────────────────────────

/**
 * 조항 하나가 무엇을 세는가. 판정 엔진이 종류마다 계산법을 하나씩 갖는다.
 * 여기서는 종류와 기준치만 적고, 세는 방법은 엔진이 안다.
 */
export type ClauseKind =
  // 사람
  | 'sameRoomPeople'
  | 'trustReceived' | 'trustTeams'
  | 'vendBuys' | 'dealsWithOtherTeam'
  // 쪽지
  | 'slipsRead' | 'slipsGiven' | 'slipsTorn'
  // 손
  | 'errandsDone' | 'harvests' | 'robotsMade' | 'robotsSmashedOfOthers' | 'quizzesSolved'
  // 어긋남 ★
  | 'targetSlipRead' | 'coStayWithTarget'
  | 'teamNotFirstAtEnd' | 'otherTeamRoomsStood'
  | 'invisibleHits' | 'invisibleHitsSameTeam'

export interface Clause {
  kind: ClauseKind
  /**
   * 사람이 읽는 말. 진행도 화면에 그대로 뜬다.
   *
   * **수치를 문장에 적지 않는다.** 화면은 need·minutes를 따로 받아
   * 「3 / 9」처럼 찍는다. 문장에도 숫자를 적으면 난이도를 고칠 때
   * 두 군데를 고쳐야 하고, 한쪽을 빠뜨리면 화면이 거짓말을 한다.
   */
  text: string
  /** 이만큼 이상이어야 한다. */
  need?: number
  /** 이만큼 이하여야 한다. */
  limit?: number
  /** 시간 조건. 분 단위다. */
  minutes?: number
  disclosure: Disclosure
}

export interface MissionSpec {
  /** 미션 전체를 한 줄로. **문서 원문 그대로다.** */
  text: string
  clauses: Clause[]
}

export interface RoleSpec {
  id: RoleId
  name: string
  branch: MissionBranch
  /** 역할 카드 맨 위에 붙는 한 줄. **문서 원문 그대로다.** */
  flavor: string
  main: MissionSpec
  /** 미션 아래 작은 글씨로 붙는 단서. 없으면 null. */
  footnote: string | null
}

// ── 역할 ────────────────────────────────────────────────────────

export const ROLES: readonly RoleSpec[] = [
  // ── 사람 쪽 — 만나고 주고받는다 ──
  {
    id: 'classlead',
    name: '반장',
    branch: 'people',
    flavor: '이름을 못 외우는 애가 없다.',
    main: {
      text: '서로 다른 사람 9명 이상과 같은 방에 1분 이상 함께 있는다.',
      clauses: [
        { kind: 'sameRoomPeople', text: '같은 방에 함께 있어 본 사람', need: 9, minutes: 1, disclosure: 'realtime' },
      ],
    },
    footnote: null,
  },
  {
    id: 'model',
    name: '모범생',
    branch: 'people',
    flavor: '이 애 말은 다들 믿는다.',
    main: {
      text: '신뢰표를 3장 이상 받는다. 서로 다른 두 팀 이상에서.',
      clauses: [
        // 실시간으로 갱신하면 방금 표를 준 사람이 누구인지 역추적된다
        { kind: 'trustReceived', text: '받은 신뢰표', need: 3, disclosure: 'daily' },
        { kind: 'trustTeams', text: '신뢰표를 보낸 팀', need: 2, disclosure: 'daily' },
      ],
    },
    footnote: null,
  },
  {
    id: 'snacker',
    name: '매점 단골',
    branch: 'people',
    flavor: '뭐든 사고, 뭐든 바꾼다.',
    main: {
      text: '자판기에서 아이템을 3번 이상 산다. 그리고 다른 팀 사람과 거래를 2번 이상 성립시킨다.',
      clauses: [
        // 매입(파는 것)은 세지 않는다. 사는 것만이다
        { kind: 'vendBuys', text: '자판기 구매', need: 3, disclosure: 'realtime' },
        { kind: 'dealsWithOtherTeam', text: '다른 팀과 성립시킨 거래', need: 2, disclosure: 'realtime' },
      ],
    },
    footnote: null,
  },

  // ── 쪽지 쪽 — 남의 비밀을 다룬다 ──
  {
    id: 'locker',
    name: '사물함',
    branch: 'slip',
    flavor: '떨어진 건 일단 주워 둔다.',
    main: {
      text: '쪽지 4장을 읽는다.',
      clauses: [{ kind: 'slipsRead', text: '읽은 쪽지', need: 4, disclosure: 'realtime' }],
    },
    footnote: null,
  },
  {
    id: 'bookclub',
    name: '도서부',
    branch: 'slip',
    flavor: '읽고, 분류하고, 필요한 사람에게 건넨다.',
    main: {
      text: '쪽지 4장을 읽고, 그중 2장을 다른 사람에게 건넨다.',
      clauses: [
        { kind: 'slipsRead', text: '읽은 쪽지', need: 4, disclosure: 'realtime' },
        // 직접 건넨 것과 거래로 넘긴 것을 둘 다 센다
        { kind: 'slipsGiven', text: '남에게 건넨 쪽지', need: 2, disclosure: 'realtime' },
      ],
    },
    footnote: null,
  },
  {
    id: 'cleanup',
    name: '미화부',
    branch: 'slip',
    flavor: '남는 종이는 두지 않는다.',
    main: {
      text: '쪽지 3장을 찢는다.',
      // 서로 다른 쪽지 셋이면 된다. 내 쪽지를 찢어도 한 장으로 센다
      clauses: [{ kind: 'slipsTorn', text: '찢은 쪽지', need: 3, disclosure: 'realtime' }],
    },
    footnote: null,
  },

  // ── 손 쪽 — 벌고, 만들고, 부순다 ──
  {
    id: 'duty',
    name: '주번',
    branch: 'hand',
    flavor: '시키는 일은 제일 먼저 끝낸다.',
    main: {
      text: '심부름을 4번 이상 완료한다.',
      // 포기·시간초과·남이 먼저 끝낸 것은 안 센다. 수입 상한에
      // 걸려 돈을 못 받은 것은 완료로 센다 — 일은 끝냈다
      clauses: [{ kind: 'errandsDone', text: '완료한 심부름', need: 4, disclosure: 'realtime' }],
    },
    footnote: null,
  },
  {
    id: 'gardener',
    name: '원예부',
    branch: 'hand',
    flavor: '정원 화분은 전부 이 애 것 같다.',
    main: {
      text: '화분에서 5번 이상 수확한다.',
      // 시든 것은 수확이 아니다
      clauses: [{ kind: 'harvests', text: '수확', need: 5, disclosure: 'realtime' }],
    },
    footnote: null,
  },
  {
    id: 'science',
    name: '과학부',
    branch: 'hand',
    flavor: '미술준비실 불이 꺼지지 않는다.',
    main: {
      text: '짝을 3기 이상 만든다.',
      // 환불된 것은 안 센다
      clauses: [{ kind: 'robotsMade', text: '만든 짝', need: 3, disclosure: 'realtime' }],
    },
    footnote: null,
  },
  {
    id: 'tech',
    name: '기술부',
    branch: 'hand',
    flavor: '조립보다 분해가 빠르다.',
    main: {
      text: '남의 팀 짝을 3기 이상 무너뜨린다.',
      // 이적으로 한도가 넘쳐 저절로 사라진 짝은 안 센다
      clauses: [
        { kind: 'robotsSmashedOfOthers', text: '무너뜨린 남의 팀 짝', need: 3, disclosure: 'realtime' },
      ],
    },
    footnote: null,
  },
  {
    id: 'topstudent',
    name: '전교 1등',
    branch: 'hand',
    flavor: '시험지를 받으면 손이 먼저 움직인다.',
    main: {
      text: '시험지를 6개 이상 맞힌다.',
      clauses: [{ kind: 'quizzesSolved', text: '맞힌 시험지', need: 6, disclosure: 'realtime' }],
    },
    footnote: null,
  },

  // ── 어긋난 쪽 ★ ──
  {
    id: 'crush',
    name: '짝사랑',
    branch: 'astray',
    flavor: '하루에 몇 번씩 그 애가 어디 있는지 확인하게 된다.',
    main: {
      text: '지정된 한 사람의 쪽지를 찾아 읽는다. 그리고 그 사람과 같은 방에서 누적 30분 이상 함께 있는다.',
      clauses: [
        { kind: 'targetSlipRead', text: '그 사람의 쪽지 읽기', need: 1, disclosure: 'realtime' },
        { kind: 'coStayWithTarget', text: '같은 방에서 함께 있은 시간', minutes: 30, disclosure: 'realtime' },
      ],
    },
    // 이름만 알려 준다. 어디 있는지는 보여 주지 않는다
    footnote: '대상은 다른 팀 사람 중 무작위. 대상은 모른다.',
  },
  {
    id: 'newcomer',
    name: '전학생',
    branch: 'astray',
    flavor: '여기는 잠깐 머무는 곳이다.',
    main: {
      text: '게임이 끝날 때 우리 팀이 1위가 아니다. 그리고 다른 세 팀의 방에 각각 10분 이상 서 있어 본다.',
      clauses: [
        // 공동 1위도 1위다 — 이 조항만 종료 시점의 팀으로 본다
        { kind: 'teamNotFirstAtEnd', text: '우리 팀이 1위가 아님', disclosure: 'endOnly' },
        // 서 있던 그 시점에 그 팀 것이었으면 센다
        { kind: 'otherTeamRoomsStood', text: '서 있어 본 다른 팀 방', need: 3, minutes: 10, disclosure: 'realtime' },
      ],
    },
    footnote: null,
  },
  {
    id: 'backseat',
    name: '뒷자리',
    branch: 'astray',
    flavor: '금요일마다 누구 이름을 적었는지, 아무도 몰랐다.',
    main: {
      text: '내가 적은 이름이 투명인간이 된 날이 2번 이상이다. 그중 1번은 우리 팀 사람이어야 한다.',
      // 동률로 아무도 안 된 날은 빼고 센다. 판정은 서버에서만 한다
      clauses: [
        { kind: 'invisibleHits', text: '내가 적은 이름이 투명인간이 된 날', need: 2, disclosure: 'afterBallot' },
        // 적은 그 순간 같은 팀이었으면 된다
        { kind: 'invisibleHitsSameTeam', text: '그중 우리 팀 사람', need: 1, disclosure: 'afterBallot' },
      ],
    },
    footnote: null,
  },
]

export const ROLE_BY_ID: Record<RoleId, RoleSpec> = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<RoleId, RoleSpec>

// ── 쪽지 미션 ───────────────────────────────────────────────────

/**
 * 쪽지를 주우면서 따라붙는다. 주 미션과 따로 판정한다.
 *
 * 셋은 **서로 다른 쪽지를 기준으로** 본다. 한 장으로 셋을 다 채울 수는 없다.
 */
export type SlipMissionId = 'keepOthers' | 'fewReadMine' | 'twiceSamePerson'

export interface SlipMissionSpec {
  id: SlipMissionId
  /** **문서 원문 그대로다.** */
  text: string
  need?: number
  limit?: number
  disclosure: Disclosure
}

export const SLIP_MISSIONS: readonly SlipMissionSpec[] = [
  {
    id: 'keepOthers',
    text: '남의 쪽지를 읽고 끝까지 가지고 있는다',
    need: 1,
    // 끝까지 쥐고 있었는지는 끝나야 안다
    disclosure: 'endOnly',
  },
  {
    id: 'fewReadMine',
    text: '나에 대한 쪽지를 읽은 사람이 2명 이하로 끝난다',
    limit: 2,
    // 남이 읽은 수를 실시간으로 보여 주면 누가 읽었는지 좁혀진다
    disclosure: 'endOnly',
  },
  {
    id: 'twiceSamePerson',
    text: '같은 사람의 쪽지를 두 번 손에 넣는다',
    need: 2,
    disclosure: 'realtime',
  },
]

export const SLIP_MISSION_IDS: readonly SlipMissionId[] = SLIP_MISSIONS.map((m) => m.id)

// ── 배정 규칙 ───────────────────────────────────────────────────

/**
 * 네 갈래를 열네 자리에 어떻게 흩을까.
 *
 * 수치는 전부 여기 있다. 배정 코드는 이 값을 읽기만 한다.
 */
export const ASSIGN_RULES = {
  /** 모든 팀은 손 갈래를 최소 이만큼 받는다. 팀에 보탬이 되는 사람이 있어야 한다. */
  handPerTeamAtLeast: 1,
  /** 한 팀에 같은 갈래가 이만큼 들어가면 안 된다. */
  sameBranchPerTeamAtMost: 2,
  /** ★ 셋은 서로 다른 팀에. */
  astrayOnePerTeam: true,
  /** ★ 중 이만큼은 4인 팀에 먼저 넣는다. */
  astrayInBigTeams: 2,
  /** 조건을 만족할 때까지 무작위 재시도. 이 횟수 안에 끝난다. */
  maxTries: 500,
} as const

/** 갈래별 인원. 문서의 배정 표와 같아야 한다. */
export const BRANCH_COUNT: Record<MissionBranch, number> = {
  people: 3,
  slip: 3,
  hand: 5,
  astray: 3,
}

export const branchOf = (id: RoleId): MissionBranch => ROLE_BRANCH[id]

// ── DAY 3·4의 선택 ──────────────────────────────────────────────

// 날짜는 v2.ts의 시간표에 있다. 여기서 다시 내보내기만 한다
export { CHOSEN_ONE_DAY, DAY4_CHOICE_DAY } from '../rules/v2'

// 선택지는 shared/rules/choices.ts에 있다. 화면이 라벨 세 줄 때문에
// 미션 조건 열넷을 불러오지 않도록 갈라 두었다
export {
  DAY4_CHOICES,
  DAY4_CHOICE_IDS,
  DAY4_TEAM_RANK_WITHIN,
  type Day4Choice,
  type Day4ChoiceSpec,
} from '../rules/choices'
