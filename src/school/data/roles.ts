import type { RoleId, RoleSpec } from '../types'

export const ROLES: RoleSpec[] = [
  {
    id: 'classPresident',
    name: '반장',
    publicPersona: '성실하고 책임감이 강하다. 반에서 가장 믿음직한 학생처럼 보인다.',
    knownRelationToA: 'A가 힘들어 보였다는 사실을 알고 있었지만 깊게 관여하지 않았다.',
    privateFact: '사실 A가 마지막으로 도움을 요청했을 때, 귀찮다는 이유로 거절했다.',
    mission: {
      checklist: [
        '최소 5명의 플레이어에게 신뢰받기',
        '누구와도 공개적인 싸움을 하지 않기',
        '다른 사람의 문제를 2번 이상 해결해주기',
        '마지막 날까지 반장다운 모습을 유지하기',
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
        '시험/과제 관련 목표 달성하기',
        '최소 3명에게 도움 요청받기',
        '자신이 약한 모습을 한 번 보여주기',
        '특정 플레이어 한 명과 경쟁 관계 유지하기',
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
        '최소 6명의 플레이어와 대화하기',
        '최소 3명의 플레이어에게 호감 얻기',
        '단체 행동을 한 번 주도하기',
        '자신의 영향력으로 누군가의 선택을 바꾸기',
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
        '새로운 친구 2명 만들기',
        '자신을 먼저 찾아오는 사람 만들기',
        '특정 플레이어와 비밀 약속 만들기',
        '마지막까지 그룹에서 완전히 배제되지 않기',
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
        '최소 3명에게 A에 대한 이야기를 듣기',
        'A에 대한 자신의 기억을 한 번 공개하기',
        '특정 플레이어와 새로운 관계 만들기',
        'A 이야기를 피하는 선택 2회 하기',
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
        '서로 다른 3개의 소문을 수집하기',
        '소문 하나를 퍼뜨리기',
        '소문 하나를 막기',
        '누군가가 자신의 말을 믿게 만들기',
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
        '자신이 좋아하는 사람을 한 명 정하기',
        '그 사람과 단둘이 대화하기',
        '누군가에게 자신의 감정을 털어놓기',
        '마지막까지 자신의 진짜 마음을 숨길지 선택하기',
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
        '다른 플레이어 2명과 함께 행동하기',
        '누군가를 한 번 도와주기',
        '자신의 약점을 한 번 공개하기',
        '다른 사람의 부탁을 한 번 거절하기',
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
        '최소 3개의 정보를 SNS를 통해 얻기',
        '누군가에게 정보를 공유하기',
        '정보 하나를 숨기기',
        '자신의 SNS 관련 비밀을 지키기',
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
        '다른 사람의 고민 2개 듣기',
        '자신의 고민 1개 털어놓기',
        '누군가에게 비밀을 맡기기',
        '받은 비밀을 지킬지 선택하기',
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
        '최소 3번 도움을 요청받기',
        '누군가를 도와주기',
        '한 번은 싸움을 피하기',
        '한 번은 자신의 감정을 솔직하게 표현하기',
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
        '최소 5명에게 도움 주기',
        '갈등 중재 1회 하기',
        '누군가의 편을 공개적으로 들기',
        '처음으로 누군가에게 거절당하기',
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
        '관계를 숨기기',
        '누군가에게 연애 상담하기',
        '과거 관계를 한 번 언급하기',
        '마지막 날까지 자신의 선택을 결정하기',
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
        '최소 5명의 플레이어와 새로운 관계 만들기',
        '자신의 이야기를 한 번 공개하기',
        '다른 사람의 이야기를 한 번 비판하기',
        '마지막 날까지 자신의 비밀 유지하기',
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
 * 모범생은 숨긴 사실이 "사실 관심이 없었다"라 공개해도 파장이 가장 작고,
 * 전학생은 "일부러 거리를 뒀다"로 인기 학생 쪽과 결이 겹친다.
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
