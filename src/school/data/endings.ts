import type { EndingSpec } from '../types'

export const ENDINGS: EndingSpec[] = [
  {
    key: 'stayed',
    title: '남았다',
    description: '많은 관계를 유지했지만, 자신의 감정은 거의 말하지 못한 사람.',
  },
  {
    key: 'left',
    title: '떠났다',
    description: '모든 관계를 정리하고 새로운 학교생활을 선택한 사람.',
  },
  {
    key: 'apologized',
    title: '사과했다',
    description: '자신의 잘못을 인정하고 누군가에게 사과한 사람.',
  },
  {
    key: 'nothingHappened',
    title: '아무 일도 없었다',
    description: 'A의 죽음 이후에도 평소처럼 살아가기로 한 사람.',
  },
  {
    key: 'alone',
    title: '혼자가 되었다',
    description: '모든 관계가 무너진 사람.',
  },
  {
    key: 'newFriend',
    title: '새로운 친구',
    description: 'A와 관련 없던 사람과 새로운 관계를 만든 사람.',
  },
  {
    key: 'shouldHaveSaid',
    title: '그때 말할 걸',
    description: '게임 내내 숨겼던 감정을 끝까지 말하지 못한 사람.',
  },
  {
    key: 'wereWeFriends',
    title: '우리는 친구였나',
    description: '많은 사람과 가까워졌지만, 정작 자신이 누구를 진짜 좋아했는지 모르는 사람.',
  },
]

export const endingByKey: Record<string, EndingSpec> = Object.fromEntries(ENDINGS.map((e) => [e.key, e]))
