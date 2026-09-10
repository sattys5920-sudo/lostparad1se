import type { RoleId, RoleSpec } from '../types'

/**
 * 개인 미션은 넷 다 실제 기록에서 자동으로 판정된다. 설계 원칙은 넷이다.
 *  1. 표 미션 — 같은 팀에는 투표할 수 없으므로, 표를 받으려면 반드시 적진과 관계를 만들어야 한다.
 *  2. 버티기 미션(atMost) — 의심을 덜 받아야 달성된다. 방어가 필요해진다.
 *  3. 서사 미션 — 그 역할이 A에게 저지른 일과 맞물린다. 대개 공개나 진실을 요구한다.
 *  4. 기여 미션(territoryAction) — 팀의 하루 행동을 내 몫으로 써야 한다. 팀원과 자리를 다투게 된다.
 */
export const ROLES: RoleSpec[] = [
  {
    id: 'classPresident',
    name: '반장',
    publicPersona: '성실하고 책임감이 강하다. 반에서 가장 믿음직한 학생처럼 보인다.',
    knownRelationToA: 'A가 힘들어 보였다는 사실을 알고 있었지만 깊게 관여하지 않았다.',
    privateFact: '사실 A가 마지막으로 도움을 요청했을 때, 귀찮다는 이유로 거절했다.',
    mission: {
      checklist: [
        { text: '다른 팀 5명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 5 },
        { text: '의심 3표 이하로 버티기', metric: { kind: 'vote', category: 'suspicion' }, threshold: 3, comparison: 'atMost' },
        { text: '부탁을 들어준 적 3회', metric: { kind: 'action', action: 'grantFavor', direction: 'by' }, threshold: 3 },
        { text: '우리 영역을 직접 2번 넓히기', metric: { kind: 'territoryAction', action: 'expand' }, threshold: 2 },
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
    mission: {
      checklist: [
        { text: '다른 팀 4명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 4 },
        { text: '연구를 직접 2번 하기', metric: { kind: 'territoryAction', action: 'research' }, threshold: 2 },
        { text: '약한 모습을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        {
          text: '서로 다른 4명과 대화하기',
          metric: { kind: 'action', action: 'talk', direction: 'by', distinct: true },
          threshold: 4,
        },
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
    mission: {
      checklist: [
        { text: '다른 팀 6명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 6 },
        { text: '의심 3표 이하로 버티기', metric: { kind: 'vote', category: 'suspicion' }, threshold: 3, comparison: 'atMost' },
        { text: '단체 채팅에 글 쓰기 3회', metric: { kind: 'action', action: 'groupPost', direction: 'by' }, threshold: 3 },
        { text: '누군가를 무시하기 1회', metric: { kind: 'action', action: 'ignore', direction: 'by' }, threshold: 1 },
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
    mission: {
      checklist: [
        { text: '서로 다른 3명과 1:1 대화 나누기', metric: { kind: 'dmPartners' }, threshold: 3 },
        { text: '다른 팀 3명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 3 },
        { text: '누군가 먼저 나를 찾아오게 하기', metric: { kind: 'action', action: 'talk', direction: 'to' }, threshold: 1 },
        { text: '생산을 직접 2번 맡기', metric: { kind: 'territoryAction', action: 'produce' }, threshold: 2 },
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
    mission: {
      checklist: [
        { text: 'A에 대한 내 기억을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        { text: 'A에 대한 소문 확인하기 3회', metric: { kind: 'action', action: 'checkRumor', direction: 'by' }, threshold: 3 },
        { text: 'A 이야기를 피해 혼자 있기 2회', metric: { kind: 'action', action: 'beAlone', direction: 'by' }, threshold: 2 },
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
    mission: {
      checklist: [
        { text: '소문을 새로 퍼뜨리기 1회', metric: { kind: 'rumor', origin: true }, threshold: 1 },
        { text: '떠도는 소문을 옮기기 2회', metric: { kind: 'rumor', origin: false }, threshold: 2 },
        { text: '남의 약점 2개 쥐기', metric: { kind: 'leverageHeld' }, threshold: 2 },
        { text: '의심 3표 이하로 버티기', metric: { kind: 'vote', category: 'suspicion' }, threshold: 3, comparison: 'atMost' },
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
    mission: {
      checklist: [
        { text: '1:1 메시지 5회 보내기', metric: { kind: 'action', action: 'dm', direction: 'by' }, threshold: 5 },
        { text: '직접 쓴 글로 마음을 공개하기', metric: { kind: 'reveal', revealKind: 'custom' }, threshold: 1 },
        { text: '다른 팀 3명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 3 },
        { text: '진실을 말하기 1회', metric: { kind: 'action', action: 'tellTruth', direction: 'by' }, threshold: 1 },
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
    mission: {
      checklist: [
        {
          text: '서로 다른 2명과 시간 보내기',
          metric: { kind: 'action', action: 'spendTime', direction: 'by', distinct: true },
          threshold: 2,
        },
        { text: '자신의 약점을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        { text: '부탁을 한 번 거절하기', metric: { kind: 'action', action: 'rejectFavor', direction: 'by' }, threshold: 1 },
        { text: '우리 영역을 직접 2번 넓히기', metric: { kind: 'territoryAction', action: 'expand' }, threshold: 2 },
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
    mission: {
      checklist: [
        { text: '소문 확인하기 3회', metric: { kind: 'action', action: 'checkRumor', direction: 'by' }, threshold: 3 },
        { text: '단체 채팅에 글 쓰기 2회', metric: { kind: 'action', action: 'groupPost', direction: 'by' }, threshold: 2 },
        { text: '다른 팀 4명에게 호감 받기', metric: { kind: 'vote', category: 'liking' }, threshold: 4 },
        { text: '남의 약점 1개 쥐기', metric: { kind: 'leverageHeld' }, threshold: 1 },
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
    mission: {
      checklist: [
        { text: '다른 사람이 나에게 1:1 메시지 보내기 2회', metric: { kind: 'action', action: 'dm', direction: 'to' }, threshold: 2 },
        { text: '내 고민을 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'privateFact' }, threshold: 1 },
        { text: '다른 팀 3명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 3 },
        { text: '진실을 말하기 1회', metric: { kind: 'action', action: 'tellTruth', direction: 'by' }, threshold: 1 },
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
    mission: {
      checklist: [
        { text: '다른 사람이 먼저 다가와 대화하기 3회', metric: { kind: 'action', action: 'talk', direction: 'to' }, threshold: 3 },
        { text: '다른 팀 2명에게 신뢰 받기', metric: { kind: 'vote', category: 'trust' }, threshold: 2 },
        { text: '누군가를 도와주기 2회', metric: { kind: 'action', action: 'grantFavor', direction: 'by' }, threshold: 2 },
        { text: '건물을 직접 1채 짓기', metric: { kind: 'territoryAction', action: 'build' }, threshold: 1 },
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
    mission: {
      checklist: [
        {
          text: '서로 다른 5명에게 도움 주기',
          metric: { kind: 'action', action: 'grantFavor', direction: 'by', distinct: true },
          threshold: 5,
        },
        { text: '누군가의 편을 공개적으로 들기', metric: { kind: 'action', action: 'publicSupport', direction: 'by' }, threshold: 1 },
        { text: '처음으로 누군가에게 거절당하기', metric: { kind: 'action', action: 'rejectFavor', direction: 'to' }, threshold: 1 },
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
    mission: {
      checklist: [
        { text: '1:1 메시지 3회 보내기', metric: { kind: 'action', action: 'dm', direction: 'by' }, threshold: 3 },
        { text: '직접 쓴 글로 과거를 공개하기', metric: { kind: 'reveal', revealKind: 'custom' }, threshold: 1 },
        { text: '서로 다른 2명과 1:1 대화 나누기', metric: { kind: 'dmPartners' }, threshold: 2 },
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
    mission: {
      checklist: [
        { text: '서로 다른 5명과 1:1 대화 나누기', metric: { kind: 'dmPartners' }, threshold: 5 },
        { text: '내 이야기를 한 번 공개하기', metric: { kind: 'reveal', revealKind: 'custom' }, threshold: 1 },
        { text: '혼자 있기 2회', metric: { kind: 'action', action: 'beAlone', direction: 'by' }, threshold: 2 },
        { text: '쥐고 있던 약점을 한 번 써먹기', metric: { kind: 'leverageUsed' }, threshold: 1 },
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
