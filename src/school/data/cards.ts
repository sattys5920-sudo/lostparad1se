import type { CardKind, CardSpec } from '../types'

export const CARDS: CardSpec[] = [
  { kind: 'fastExpand', category: 'expand', name: '빠른 확장', description: '행동력을 보충해 바로 다음 확장에 쓴다.' },
  { kind: 'chainOccupy', category: 'expand', name: '연속 점령', description: '행동력과 영향력을 함께 얻는다.' },
  { kind: 'pioneer', category: 'expand', name: '개척', description: '앞서 조사해 지식을 얻는다.' },
  { kind: 'detour', category: 'expand', name: '우회 확장', description: '막힌 길을 돌아갈 행동력을 얻는다.' },

  { kind: 'buildDiscount', category: 'build', name: '건설 할인', description: '자재를 아껴 돈을 돌려받는다.' },
  { kind: 'instantBuild', category: 'build', name: '즉시 건설', description: '행동력을 크게 보충한다.' },
  { kind: 'buildingBoost', category: 'build', name: '건물 강화', description: '지식과 문화를 함께 얻는다.' },

  { kind: 'bonusProduction', category: 'produce', name: '추가 자원 생산', description: '모든 자원을 조금씩 더 얻는다.' },
  { kind: 'doubleResource', category: 'produce', name: '특정 자원 2배', description: '이번 생산에서 돈을 크게 얻는다.' },

  {
    kind: 'raiseExpandCost',
    category: 'sabotage',
    name: '상대 확장 비용 증가',
    description: '지정한 팀의 확장 비용을 이틀간 올린다.',
  },
  {
    kind: 'cutProduction',
    category: 'sabotage',
    name: '상대 생산 감소',
    description: '지정한 팀의 생산량을 이틀간 줄인다.',
  },
  {
    kind: 'blockTrade',
    category: 'sabotage',
    name: '교역 차단',
    description: '지정한 팀이 하루 동안 교역을 제안할 수 없게 한다.',
  },

  {
    kind: 'temporaryPact',
    category: 'diplomacy',
    name: '일시적 협정',
    description: '지정한 팀에 동맹을 제안한다. 강제력은 없다.',
  },
  { kind: 'tradeBonus', category: 'diplomacy', name: '교역 보너스', description: '영향력을 얻는다.' },
  { kind: 'jointDevelopment', category: 'diplomacy', name: '공동 개발', description: '지식과 문화를 함께 얻는다.' },

  { kind: 'hiddenPassage', category: 'special', name: '숨겨진 통로', description: '행동력과 영향력을 함께 얻는다.' },
  { kind: 'secretSpace', category: 'special', name: '비밀 공간 발견', description: '돈·지식·문화를 조금씩 얻는다.' },
  { kind: 'emergencyMobilization', category: 'special', name: '긴급 동원', description: '행동력을 크게 얻는다.' },
  {
    kind: 'majorProject',
    category: 'special',
    name: '대규모 프로젝트',
    description: '모든 자원을 골고루 얻는다.',
  },
]

export const cardByKind: Record<CardKind, CardSpec> = Object.fromEntries(CARDS.map((c) => [c.kind, c])) as Record<
  CardKind,
  CardSpec
>

/** 대상 팀을 지정해야 하는 카드 — 견제·협정 카드. */
export const TARGETED_CARDS: CardKind[] = ['raiseExpandCost', 'cutProduction', 'blockTrade', 'temporaryPact']
