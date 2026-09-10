import type { RoleId, RoleSpec } from '../types'

/**
 * 개인 미션은 넷 다 실제 기록에서 자동으로 판정된다. 지도가 생기면서 새로 잴 수 있게 된 것은
 * "누가 보는 앞에서 했는가"다. 같은 행동도 빈 방에서 했는지 사람들 앞에서 했는지가 다른 일이 된다.
 *
 * 역할마다 축이 하나씩 있고, 축끼리 부딪히도록 짰다. 각자 자기 것만 챙겨도 남의 미션이 깨진다.
 *  · 반장은 조각을 태워야 하고, A를 좋아했던 학생은 그 조각을 모아야 한다.
 *  · 인기 있는 학생은 혼자 있으면 안 되어 빈 방까지 따라 들어가고, 거기가 A의 짝이 혼자 있어야 할 방이다.
 *  · 소문통은 남을 봐야 하고, 전 애인은 들키면 안 된다.
 *  · A의 짝은 조각을 누군가에게 건네야 하고, 모범생은 절대 받으면 안 된다. 둘 다 서로의 사정을 모른다.
 */
export const ROLES: RoleSpec[] = [
  {
    id: 'classPresident',
    name: '반장',
    publicPersona: '성실하고 책임감이 강하다. 반에서 가장 믿음직한 학생처럼 보인다.',
    knownRelationToA: 'A가 힘들어 보였다는 사실을 알고 있었지만 깊게 관여하지 않았다.',
    privateFact: '사실 A가 마지막으로 도움을 요청했을 때, 귀찮다는 이유로 거절했다.',
    axis: '없애는 사람',
    mission: {
      checklist: [
        { text: '조각 2개를 태워 없애기', metric: { kind: 'spatial', action: 'burnFragment' }, threshold: 2 },
        { text: '그중 한 번은 아무도 없는 방에서', metric: { kind: 'spatial', action: 'burnFragment', unseenOnly: true }, threshold: 1 },
        { text: '서로 다른 6개 구역 돌기', metric: { kind: 'roomsVisited' }, threshold: 6 },
        { text: '다른 팀 4명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 4 },
      ],
      hiddenGoal: 'A에게 도움을 주지 않았다는 사실을 다른 플레이어가 알게 되지 않도록 한다.',
    },
  },
  {
    id: 'topStudent',
    name: '성적 1등',
    publicPersona: '차갑고 공부만 하는 학생.',
    knownRelationToA: 'A와 성적 경쟁을 했었다.',
    privateFact: 'A가 자신보다 높은 점수를 받았던 날, 다른 친구들에게 A에 대한 험담을 했다.',
    axis: '거리를 두는 사람',
    mission: {
      checklist: [
        { text: '도서관·과학실에 합쳐 8분 이상', metric: { kind: 'roomSeconds', rooms: ['library', 'scienceRoom'] }, threshold: 480 },
        { text: '지정된 경쟁자와 3분 이하로만 마주치기', metric: { kind: 'withTargetSeconds' }, threshold: 180, comparison: 'atMost' },
        { text: '약한 모습을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        { text: '다른 팀 4명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 4 },
      ],
      hiddenGoal: '누군가에게 처음으로 자신의 열등감을 털어놓는다.',
    },
  },
  {
    id: 'popular',
    name: '반에서 가장 인기 있는 학생',
    publicPersona: '친구가 많고 분위기를 잘 이끈다.',
    knownRelationToA: 'A를 친구라고 생각했지만, 사실은 자신의 무리에 맞춰 행동하게 했다.',
    privateFact: 'A가 무리에서 자연스럽게 제외되도록 만든 적이 있다.',
    axis: '무리를 몰고 다니는 사람',
    mission: {
      checklist: [
        { text: '서로 다른 8명과 같은 방에 있기', metric: { kind: 'metDistinct' }, threshold: 8 },
        { text: '혼자 있는 시간 1분 이하로 버티기', metric: { kind: 'aloneSeconds' }, threshold: 60, comparison: 'atMost' },
        { text: '남이 조각 줍는 것을 2번 목격하기', metric: { kind: 'witnessedOthers', action: 'pickFragment' }, threshold: 2 },
        { text: '다른 팀 5명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 5 },
      ],
      hiddenGoal: '자신 때문에 누군가가 상처받았다는 사실을 인정하지 않는다.',
    },
  },
  {
    id: 'transferStudent',
    name: '전학생',
    publicPersona: '조용하고 무난하다.',
    knownRelationToA: 'A가 학교생활에 적응하는 데 도움을 줬던 유일한 사람.',
    privateFact: 'A와 친했던 것 때문에 다른 학생들에게 자신도 이상한 사람으로 취급받을까 봐 일부러 거리를 뒀다.',
    axis: '끼어드는 사람',
    mission: {
      checklist: [
        { text: '서로 다른 6명과 같은 방에 있기', metric: { kind: 'metDistinct' }, threshold: 6 },
        { text: '남이 내 방으로 2번 찾아오게 하기', metric: { kind: 'visitedByOthers' }, threshold: 2 },
        { text: '조각 1개 줍기', metric: { kind: 'spatial', action: 'pickFragment' }, threshold: 1 },
        { text: '다른 팀 3명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 3 },
      ],
      hiddenGoal: '"사실 나는 A를 좋아하지 않았다"는 말을 누군가에게 한다.',
    },
  },
  {
    id: 'exPartner',
    name: 'A의 짝',
    publicPersona: 'A와 가장 가까웠던 학생 중 하나.',
    knownRelationToA: '한동안 매일 붙어 다녔다.',
    privateFact: 'A가 지나치게 의존한다고 느껴 관계를 끊었다.',
    axis: '피하는 사람',
    mission: {
      checklist: [
        { text: '조각 1개를 다른 사람에게 건네기', metric: { kind: 'spatial', action: 'giveFragment' }, threshold: 1 },
        { text: '아무도 없는 방에서 3분 이상 머물기', metric: { kind: 'aloneSeconds' }, threshold: 180 },
        { text: '지정된 한 사람을 끝까지 피하기', metric: { kind: 'withTargetSeconds' }, threshold: 30, comparison: 'atMost' },
        { text: '다른 팀 4명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 4 },
      ],
      hiddenGoal: 'A에 대해 자신이 나쁘게 생각했던 부분을 인정한다.',
    },
  },
  {
    id: 'gossip',
    name: '소문을 잘 아는 학생',
    publicPersona: '친구가 많고 학교에서 무슨 일이 일어나는지 빠르게 안다.',
    knownRelationToA: 'A에 대한 여러 소문을 알고 있었다.',
    privateFact: 'A에 대한 소문 중 하나를 자신이 처음 퍼뜨렸다.',
    axis: '보는 사람',
    mission: {
      checklist: [
        { text: '남의 행동을 5번 목격하기', metric: { kind: 'witnessedOthers' }, threshold: 5 },
        { text: '쪽지 3장 읽기', metric: { kind: 'spatial', action: 'readNote' }, threshold: 3 },
        { text: '아무도 못 보게 쪽지 1장 남기기', metric: { kind: 'spatial', action: 'leaveNote', unseenOnly: true }, threshold: 1 },
        { text: '서로 다른 6명과 같은 방에 있기', metric: { kind: 'metDistinct' }, threshold: 6 },
      ],
      hiddenGoal: '자신이 퍼뜨린 소문이 A와 관련되어 있었다는 사실을 숨긴다.',
    },
  },
  {
    id: 'secretAdmirer',
    name: 'A를 좋아했던 학생',
    publicPersona: 'A와 별로 친하지 않았던 것처럼 행동한다.',
    knownRelationToA: 'A를 좋아했지만 고백하지 않았다.',
    privateFact: 'A가 다른 사람을 좋아한다고 생각해 포기했다.',
    axis: '모으는 사람',
    mission: {
      checklist: [
        { text: '조각 3개 줍기', metric: { kind: 'spatial', action: 'pickFragment' }, threshold: 3 },
        { text: '조각이 나타난 방에 그 순간 있기 2회', metric: { kind: 'atFragmentSpawn' }, threshold: 2 },
        { text: '한 사람과 5분 이상 같이 있기', metric: { kind: 'togetherDistinct', minSeconds: 300 }, threshold: 1 },
        { text: '직접 쓴 글로 마음을 공개하기', metric: { kind: 'reveal', revealKind: 'custom' }, threshold: 1 },
      ],
      hiddenGoal: '게임 종료 전 단 한 번은 솔직한 고백을 한다.',
    },
  },
  {
    id: 'athlete',
    name: '운동부',
    publicPersona: '활발하고 친구들과 잘 어울린다.',
    knownRelationToA: 'A와 크게 친하지 않았다.',
    privateFact: 'A가 괴롭힘을 당하는 것을 한 번 봤지만 그냥 지나쳤다.',
    axis: '지나치는 사람',
    mission: {
      checklist: [
        { text: '조각을 주웠다가 다시 내려놓기', metric: { kind: 'spatial', action: 'dropFragment' }, threshold: 1 },
        { text: '서로 다른 3명과 각각 2분 이상 같이 있기', metric: { kind: 'togetherDistinct', minSeconds: 120 }, threshold: 3 },
        { text: '체육관에 5분 이상 머물기', metric: { kind: 'roomSeconds', rooms: ['gym'] }, threshold: 300 },
        { text: '자신의 약점을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
      ],
      hiddenGoal: '자신이 봤던 일을 말할지 끝까지 고민한다.',
    },
  },
  {
    id: 'snsAddict',
    name: 'SNS에 민감한 학생',
    publicPersona: '사진과 SNS를 좋아하고 유행에 민감하다.',
    knownRelationToA: 'A의 SNS를 자주 봤지만 실제로는 별로 친하지 않았다.',
    privateFact: 'A가 마지막으로 올린 게시물을 가장 먼저 봤지만 아무에게도 말하지 않았다.',
    axis: '퍼뜨리는 사람',
    mission: {
      checklist: [
        { text: '남이 조각 줍는 것을 3번 목격하기', metric: { kind: 'witnessedOthers', action: 'pickFragment' }, threshold: 3 },
        { text: '쪽지 2장 남기기', metric: { kind: 'spatial', action: 'leaveNote' }, threshold: 2 },
        { text: '조각 1개를 읽기', metric: { kind: 'spatial', action: 'pickFragment' }, threshold: 1 },
        { text: '다른 팀 4명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 4 },
      ],
      hiddenGoal: 'A의 마지막 게시물을 공개할지 결정한다.',
    },
  },
  {
    id: 'counselee',
    name: '상담을 자주 받는 학생',
    publicPersona: '조용하고 감정적으로 예민하다.',
    knownRelationToA: 'A와 서로 고민을 이야기하던 사이.',
    privateFact: 'A가 자신에게 했던 말을 다른 사람에게 전달한 적이 있다.',
    axis: '단둘이 있는 사람',
    mission: {
      checklist: [
        { text: '서로 다른 3명과 각각 단둘이 있기', metric: { kind: 'pairAloneDistinct', minSeconds: 60 }, threshold: 3 },
        { text: '쪽지 2장 읽기', metric: { kind: 'spatial', action: 'readNote' }, threshold: 2 },
        { text: '자기 고민을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        { text: '다른 팀 3명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 3 },
      ],
      hiddenGoal: '자신이 배신했던 사람에게 사과할지 결정한다.',
    },
  },
  {
    id: 'troublemaker',
    name: '문제아',
    publicPersona: '선생님에게 자주 혼나고 반에서 평판이 좋지 않다.',
    knownRelationToA: 'A와 의외로 자주 대화했다.',
    privateFact: 'A가 자신을 믿어준 유일한 사람이라고 생각한다. 하지만 실제로 A는 그렇게까지 생각하지 않았다.',
    axis: '기다리는 사람',
    mission: {
      checklist: [
        { text: '남이 내 방으로 3번 찾아오게 하기', metric: { kind: 'visitedByOthers' }, threshold: 3 },
        { text: '방송실·학생회실 같은 구석에 5분 이상', metric: { kind: 'roomSeconds', rooms: ['broadcastRoom', 'studentCouncil'] }, threshold: 300 },
        { text: '조각 1개 줍기', metric: { kind: 'spatial', action: 'pickFragment' }, threshold: 1 },
        { text: '다른 팀 2명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 2 },
      ],
      hiddenGoal: 'A가 자신을 특별하게 생각하지 않았다는 사실을 받아들인다.',
    },
  },
  {
    id: 'goodStudent',
    name: '모범생',
    publicPersona: '착하고 예의 바르며 누구에게나 친절하다.',
    knownRelationToA: 'A에게도 친절했다.',
    privateFact: '사실 A에게 특별한 관심이 없었고, 누구에게나 똑같이 행동했을 뿐이다.',
    axis: '관여하지 않는 사람',
    mission: {
      checklist: [
        { text: '6개 이상 구역을 두루 밟기', metric: { kind: 'roomsVisited' }, threshold: 6 },
        { text: '서로 다른 5명과 같은 방에 있기', metric: { kind: 'metDistinct' }, threshold: 5 },
        { text: '조각을 한 번도 줍지 않기', metric: { kind: 'spatial', action: 'pickFragment' }, threshold: 0, comparison: 'atMost' },
        { text: '의심 2표 이하로 버티기', metric: { kind: 'vote', category: 'suspicion' }, threshold: 2, comparison: 'atMost' },
      ],
      hiddenGoal: '모든 사람에게 좋은 사람이 될 수 없다는 사실을 받아들인다.',
    },
  },
  {
    id: 'exLover',
    name: '전 애인',
    publicPersona: 'A와 사귀었다는 사실을 아무도 모른다.',
    knownRelationToA: '짧게 연애했지만 헤어졌다.',
    privateFact: '헤어진 이유를 서로에게 제대로 말하지 않았다.',
    axis: '숨어서 만나는 사람',
    mission: {
      checklist: [
        { text: '지정된 한 사람과 빈 방에서 단둘이 2분 이상', metric: { kind: 'pairAloneWithTargetSeconds' }, threshold: 120 },
        { text: '그 만남을 아무에게도 들키지 않기', metric: { kind: 'witnessedMe' }, threshold: 0, comparison: 'atMost' },
        { text: '쪽지 1장 남기기', metric: { kind: 'spatial', action: 'leaveNote' }, threshold: 1 },
        { text: '의심 3표 이하로 버티기', metric: { kind: 'vote', category: 'suspicion' }, threshold: 3, comparison: 'atMost' },
      ],
      hiddenGoal: 'A와 헤어진 진짜 이유를 한 사람에게만 이야기한다.',
    },
  },
  {
    id: 'stranger',
    name: '거의 모르는 학생',
    publicPersona: 'A와 별로 접점이 없었던 학생.',
    knownRelationToA: '같은 반이었지만 거의 대화하지 않았다.',
    privateFact: 'A가 죽기 직전 자신에게 아주 사소한 부탁을 했었다. 하지만 별것 아니라고 생각해 잊어버렸다.',
    axis: '들키지 않는 사람',
    mission: {
      checklist: [
        { text: '서로 다른 7개 구역 밟기', metric: { kind: 'roomsVisited' }, threshold: 7 },
        { text: '아무도 없는 방에서 조각 1개 줍기', metric: { kind: 'spatial', action: 'pickFragment', unseenOnly: true }, threshold: 1 },
        { text: '목격되지 않은 행동 3회', metric: { kind: 'spatial', unseenOnly: true }, threshold: 3 },
        { text: '서로 다른 5명과 같은 방에 있기', metric: { kind: 'metDistinct' }, threshold: 5 },
      ],
      hiddenGoal: 'A의 마지막 부탁을 기억해내고 어떻게 처리할지 결정한다.',
    },
  },
]

export const roleById: Record<RoleId, RoleSpec> = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<
  RoleId,
  RoleSpec
>

/**
 * 14명을 기준으로 짠 판이고, 당일 한두 명이 못 오는 경우까지만 받는다.
 * N명이면 앞에서부터 N개를 쓰므로, 뒤의 두 자리가 먼저 비는 자리다.
 * 그래서 꼬리에는 "털어놓을 것이 가장 약한" 역할을 둔다 — 이 게임의 중심이
 * 공개(무엇을 털어놓는가)라서, 빠져도 판에서 사라지는 카드가 가장 적은 쪽이다.
 */
export const ROLE_INCLUDE_ORDER: RoleId[] = [
  'classPresident', // 1 — 관계 허브 + 거절했다는 죄책감
  'popular', // 2 — 관계 허브 + 배제의 가해
  'gossip', // 3 — 소문 시스템의 심장
  'secretAdmirer', // 4 — 감정선의 축(짝사랑 → 고백 여부)
  'exPartner', // 5 — A 서사의 핵심 증인
  'counselee', // 6 — 비밀을 맡고 옮긴 배신
  'troublemaker', // 7 — 혼자만 특별하다고 믿었던 오해
  'stranger', // 8 — 엔딩 훅(A의 마지막 부탁)
  'snsAddict', // 9 — A의 마지막 게시물
  'athlete', // 10 — 괴롭힘을 보고 지나친 방관
  'topStudent', // 11 — 경쟁과 험담
  'exLover', // 12 — 아무도 모르는 연애
  'transferStudent', // 13 — 먼저 빠지는 자리
  'goodStudent', // 14 — 먼저 빠지는 자리
]

/** 14명이 기준. 당일 두 명까지 빠져도 판이 굴러가도록 12명부터 받는다. */
export const MIN_PLAYERS = 12
export const MAX_PLAYERS = ROLE_INCLUDE_ORDER.length // 14
