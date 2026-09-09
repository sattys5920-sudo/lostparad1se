import type { DaySpec } from '../types'

export const DAYS: DaySpec[] = [
  {
    day: 1,
    title: '평범했던 우리',
    subtitle: 'DAY 1',
    description:
      'A가 죽었다는 사실이 알려진다. 하지만 오늘은 그 이유를 캐묻는 날이 아니다. 다들 평소처럼 학교생활을 이어간다.',
    focusPrompt: '새로운 관계를 만들고, 기존 관계를 확인한다.',
    eventCards: ['평범한 하루', '수행평가', '급식 시간', '동아리 활동', '단체 채팅방'],
  },
  {
    day: 2,
    title: '소문',
    subtitle: 'DAY 2',
    description:
      'A에 대한 이야기가 조금씩 퍼진다. 누군가는 좋은 사람이라고 하고, 누군가는 별로였다고 하고, 누군가는 관심도 없었다고 한다. 같은 사람을 두고 서로 다른 이야기가 나온다.',
    focusPrompt: '누구의 말을 믿을 것인가.',
    eventCards: ['SNS 소문', '선생님의 상담', '학부모 연락', '친구 사이의 싸움', '축제 준비'],
  },
  {
    day: 3,
    title: '균열',
    subtitle: 'DAY 3',
    description:
      '기존 관계가 흔들리기 시작한다. 숨겨왔던 말이나 행동이 일부 공개된다. 친했던 두 사람이 싸울 수도, 전혀 친하지 않았던 두 사람이 가까워질 수도 있다.',
    focusPrompt: '자신에게 중요한 사람을 선택한다.',
    eventCards: ['시험', '연애 문제', '결석', 'A의 빈자리', '성적 발표'],
  },
  {
    day: 4,
    title: '선택',
    subtitle: 'DAY 4',
    description:
      '각자의 개인 미션이 본격적으로 충돌한다. 누군가를 도우면 다른 사람의 미션을 실패시킬 수도 있다. 누군가에게 진실을 말하면 다른 사람과의 관계가 깨질 수 있다.',
    focusPrompt: '무엇을 지키고, 무엇을 버릴 것인가.',
    eventCards: ['전학', '단체 채팅방', 'SNS 소문', '선생님의 상담', 'A의 빈자리'],
  },
  {
    day: 5,
    title: '마지막 날',
    subtitle: 'DAY 5',
    description:
      '모든 플레이어가 최종 선택을 한다. 누구와 계속 연락할 것인가, 누구와 관계를 끊을 것인가, 누구에게 사과할 것인가, 누구에게 진실을 말할 것인가, A에 대해 어떤 기억을 남길 것인가.',
    focusPrompt: 'A가 사라지고 난 뒤, 우리는 서로에게 어떤 사람이 되었는가.',
    eventCards: ['졸업 앨범', '마지막 단체 채팅방', 'A의 빈자리'],
  },
]

export const dayByNumber = (day: number): DaySpec => DAYS[Math.min(Math.max(day, 1), DAYS.length) - 1]
