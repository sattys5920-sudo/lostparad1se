import type { BuildingKind, BuildingSpec, ResourceBundle } from '../types'

const ZERO: ResourceBundle = { money: 0, food: 0, knowledge: 0, culture: 0, influence: 0, actionPoints: 0 }

function cost(partial: Partial<ResourceBundle>): ResourceBundle {
  return { ...ZERO, ...partial }
}

export const BUILDINGS: BuildingSpec[] = [
  // 상업시설 — 돈 생산
  {
    kind: 'shop',
    category: 'commerce',
    name: '매점',
    description: '작은 매점을 연다.',
    cost: cost({ money: 2, actionPoints: 1 }),
    valueBonus: 1,
    produces: { money: 2 },
    defenseBonus: 0,
  },
  {
    kind: 'store',
    category: 'commerce',
    name: '상점',
    description: '규모를 갖춘 상점을 세운다.',
    cost: cost({ money: 4, actionPoints: 1 }),
    valueBonus: 2,
    produces: { money: 3 },
    defenseBonus: 0,
  },
  {
    kind: 'cafe',
    category: 'commerce',
    name: '카페',
    description: '분위기 있는 카페를 연다.',
    cost: cost({ money: 3, food: 1, actionPoints: 1 }),
    valueBonus: 2,
    produces: { money: 2, culture: 1 },
    defenseBonus: 0,
  },

  // 연구시설 — 지식 생산
  {
    kind: 'lab',
    category: 'research',
    name: '연구실',
    description: '실험과 연구를 진행한다.',
    cost: cost({ knowledge: 3, actionPoints: 1 }),
    valueBonus: 2,
    produces: { knowledge: 3 },
    defenseBonus: 0,
  },
  {
    kind: 'archive',
    category: 'research',
    name: '서고',
    description: '자료를 모아 둔다.',
    cost: cost({ knowledge: 2, money: 1, actionPoints: 1 }),
    valueBonus: 1,
    produces: { knowledge: 2 },
    defenseBonus: 0,
  },

  // 문화시설 — 문화 생산
  {
    kind: 'musicClub',
    category: 'culture',
    name: '음악반',
    description: '음악 동아리 활동 공간.',
    cost: cost({ culture: 2, actionPoints: 1 }),
    valueBonus: 1,
    produces: { culture: 2 },
    defenseBonus: 0,
  },
  {
    kind: 'artClub',
    category: 'culture',
    name: '미술반',
    description: '미술 동아리 활동 공간.',
    cost: cost({ culture: 2, actionPoints: 1 }),
    valueBonus: 1,
    produces: { culture: 2 },
    defenseBonus: 0,
  },
  {
    kind: 'stage',
    category: 'culture',
    name: '공연무대',
    description: '공연을 열 수 있는 무대.',
    cost: cost({ culture: 4, money: 1, actionPoints: 1 }),
    valueBonus: 3,
    produces: { culture: 3, knowledge: 1 },
    defenseBonus: 0,
  },

  // 군사/방어시설 — 방어력 증가
  {
    kind: 'security',
    category: 'defense',
    name: '경비실',
    description: '기본적인 경계를 선다.',
    cost: cost({ money: 2, actionPoints: 1 }),
    valueBonus: 1,
    produces: {},
    defenseBonus: 2,
  },
  {
    kind: 'watchtower',
    category: 'defense',
    name: '방어탑',
    description: '높은 곳에서 주변을 살핀다.',
    cost: cost({ money: 3, knowledge: 1, actionPoints: 1 }),
    valueBonus: 1,
    produces: {},
    defenseBonus: 3,
  },
  {
    kind: 'controlRoom',
    category: 'defense',
    name: '통제실',
    description: '구역 전체를 통제한다.',
    cost: cost({ knowledge: 2, influence: 1, actionPoints: 1 }),
    valueBonus: 2,
    produces: {},
    defenseBonus: 4,
  },

  // 특수시설 — 특수 효과
  {
    kind: 'broadcastStation',
    category: 'special',
    name: '방송국',
    description: '우리 팀이 받는 신뢰·호감 한 표마다 영향력을 1 더 얻는다.',
    cost: cost({ money: 3, culture: 2, actionPoints: 1 }),
    valueBonus: 3,
    produces: {},
    defenseBonus: 0,
  },
  {
    kind: 'hideout',
    category: 'special',
    name: '비밀기지',
    description: '우리 팀이 받는 의심 한 표의 타격을 1 줄인다.',
    cost: cost({ money: 3, knowledge: 1, actionPoints: 1 }),
    valueBonus: 2,
    produces: {},
    defenseBonus: 1,
  },
  {
    kind: 'basement',
    category: 'special',
    name: '지하실',
    description: '비상 식량을 보관한다.',
    cost: cost({ money: 2, food: 2, actionPoints: 1 }),
    valueBonus: 1,
    produces: { food: 2 },
    defenseBonus: 1,
  },
]

export const buildingByKind: Record<BuildingKind, BuildingSpec> = Object.fromEntries(
  BUILDINGS.map((b) => [b.kind, b]),
) as Record<BuildingKind, BuildingSpec>

export const BUILDING_CATEGORY_LABEL: Record<BuildingSpec['category'], string> = {
  commerce: '상업시설',
  research: '연구시설',
  culture: '문화시설',
  defense: '군사/방어시설',
  special: '특수시설',
}
