import type { FragmentSpec } from '../types'

/**
 * A는 게임에 직접 나타나지 않는다. 대신 하루에 한 조각씩, A가 남긴 기록이 반 전체에 열린다.
 * 조각은 늘 세 가지를 동시에 한다.
 *   1. 구역 하나를 지목한다 → 그 구역의 가치가 오르고, 모두가 거기로 몰린다.
 *   2. 핵심 지역을 연다 → 지도의 판이 바뀐다.
 *   3. 역할 한둘을 은근히 가리킨다 → 그게 누구인지는 아무도 모른다.
 *      그 사람을 정확히 짚어 의심하면 효과가 두 배가 된다.
 *
 * 조각은 누구도 지목해서 벌하지 않는다. 다만 읽고 나면, 서로를 다르게 보게 된다.
 */
export const FRAGMENTS: FragmentSpec[] = [
  {
    day: 1,
    title: '첫 번째 조각 · 교실',
    text: '교실에 늦게까지 남아 있었다. 누가 문을 닫고 나가는 소리를 들었는데, 나를 못 본 척한 것 같았다. 아마 아니겠지. 아마.',
    tileId: 'classroom',
    unlocks: [],
    implicatedRoles: ['classPresident', 'goodStudent'],
  },
  {
    day: 2,
    title: '두 번째 조각 · 도서관',
    text: '도서관에서 그 애가 웃는 걸 봤다. 내 얘기였다는 건 나중에 알았다. 웃은 사람보다, 같이 웃어 준 사람들이 더 오래 남는다.',
    tileId: 'library',
    unlocks: [],
    implicatedRoles: ['popular', 'gossip'],
  },
  {
    day: 3,
    title: '세 번째 조각 · 방송실',
    text: '방송실 문은 늘 열려 있었다. 아무도 안 오는 곳이라서 좋았다. 여기서 쓴 건 아무도 못 읽을 줄 알았는데, 누군가 읽은 것 같다.',
    tileId: 'broadcastRoom',
    unlocks: ['broadcastRoom', 'studentCouncil'],
    implicatedRoles: ['snsAddict', 'counselee'],
  },
  {
    day: 4,
    title: '네 번째 조각 · 강당',
    text: '강당에서 다들 줄을 서 있을 때, 내 옆자리만 비어 있었다. 그게 우연이 아니라는 걸 세 번째쯤 알았다. 그날 한 사람은 내 쪽으로 오려다 말았다.',
    tileId: 'auditorium',
    unlocks: ['auditorium', 'playground'],
    implicatedRoles: ['athlete', 'exPartner', 'transferStudent'],
  },
  {
    day: 5,
    title: '마지막 조각 · 중앙광장',
    text: '중앙광장에 서 있으면 학교 전체가 보인다. 다들 각자 갈 데가 있어 보였다. 나는 누가 나를 붙잡아 주기를 기다렸던 것 같다. 아무도 잘못하지 않았다. 그냥 아무도 오지 않았을 뿐이다.',
    tileId: 'centralPlaza',
    unlocks: ['centralPlaza'],
    implicatedRoles: ['secretAdmirer', 'exLover', 'stranger'],
  },
]

export const fragmentByDay: Record<number, FragmentSpec | undefined> = Object.fromEntries(
  FRAGMENTS.map((f) => [f.day, f]),
)
