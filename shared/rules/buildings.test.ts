// 건물·자원 — 슬롯과 배율.
import { describe, expect, it } from 'vitest'
import {
  build,
  buildCost,
  canPay,
  dailyProduction,
  defenseOf,
  downgradeOnCapture,
  gain,
  maintenanceFactor,
  pay,
  slotsOf,
  teamHasBuilding,
  upgrade,
  type TileState,
} from './buildings'
import { BUILDING_BY_KIND, STARTING_RESOURCES, TREASURER_BUILD_DISCOUNT, type Resource } from './v2'

const res = (over: Partial<Record<Resource, number>> = {}): Record<Resource, number> => ({
  ...STARTING_RESOURCES,
  ...over,
})

const tile = (over: Partial<TileState> & Pick<TileState, 'tileId'>): TileState => ({
  ownerTeam: 'A',
  buildings: [],
  ...over,
})

describe('자원 셈', () => {
  it('모자라면 내지 않는다', () => {
    expect(canPay(res({ money: 1 }), { money: 2 })).toBe(false)
    expect(pay(res({ money: 1 }), { money: 2 })).toBe(null)
  })

  it('낸 만큼 빠진다', () => {
    expect(pay(res({ money: 5 }), { money: 2 })?.money).toBe(3)
  })

  it('영향력은 0 아래로 내려가지 않는다', () => {
    expect(gain(res({ influence: 1 }), { influence: -5 }).influence).toBe(0)
  })
})

describe('짓기', () => {
  it('우리 칸에만 짓는다', () => {
    const out = build({ tile: tile({ tileId: 'classroom', ownerTeam: 'B' }), team: 'A', kind: 'shop', resources: res() })
    expect(out.reason).toBe('notOurTile')
  })

  it('기지에는 못 짓는다', () => {
    const out = build({ tile: tile({ tileId: 'baseA' }), team: 'A', kind: 'shop', resources: res() })
    expect(out.reason).toBe('baseTile')
  })

  it('가치 5 이상인 칸은 두 개, 나머지는 한 개다', () => {
    expect(slotsOf('classroom')).toBe(1)
    expect(slotsOf('mainBuilding')).toBe(2)
    expect(slotsOf('centralPlaza')).toBe(2)
  })

  it('슬롯이 차면 막는다', () => {
    const full = tile({ tileId: 'classroom', buildings: [{ kind: 'shop', level: 1 }] })
    expect(build({ tile: full, team: 'A', kind: 'archive', resources: res() }).reason).toBe('noSlot')
  })

  it('같은 칸에 같은 건물을 두 개 짓지 못한다', () => {
    const has = tile({ tileId: 'mainBuilding', buildings: [{ kind: 'shop', level: 1 }] })
    expect(build({ tile: has, team: 'A', kind: 'shop', resources: res() }).reason).toBe('alreadyHere')
  })

  it('돈이 모자라면 막는다', () => {
    const out = build({ tile: tile({ tileId: 'classroom' }), team: 'A', kind: 'store', resources: res({ money: 1 }) })
    expect(out.reason).toBe('cannotAfford')
    expect(out.resources.money).toBe(1)
  })

  it('지으면 값이 빠진다', () => {
    const out = build({ tile: tile({ tileId: 'classroom' }), team: 'A', kind: 'store', resources: res() })
    expect(out.ok).toBe(true)
    expect(out.resources.money).toBe(STARTING_RESOURCES.money - 4)
  })

  it('회계는 돈을 1 깎아 준다', () => {
    expect(buildCost('store', { treasurer: true }).money).toBe(4 - TREASURER_BUILD_DISCOUNT)
    // 지식만 드는 건물은 그대로다
    expect(buildCost('lab', { treasurer: true })).toEqual({ knowledge: 3 })
  })

  it('급조는 절반으로 버린다', () => {
    expect(buildCost('barricade', { quickBuild: true })).toEqual({ money: 1, knowledge: 0 })
  })

  it('급조를 먼저 접고 회계 할인을 뺀다', () => {
    // 돈 3을 먼저 1로 접고 1을 빼 0. 반대 순서라면 (3-1)/2 = 1이다
    expect(buildCost('barricade', { quickBuild: true, treasurer: true }).money).toBe(0)
  })
})

describe('개조', () => {
  const built = tile({ tileId: 'mainBuilding', buildings: [{ kind: 'shop', level: 1 }] })

  it('없는 건물은 못 올린다', () => {
    expect(upgrade({ tile: built, team: 'A', kind: 'lab', resources: res() }).reason).toBe('notBuilt')
  })

  it('2단계가 끝이다', () => {
    const maxed = tile({ tileId: 'mainBuilding', buildings: [{ kind: 'shop', level: 2 }] })
    expect(upgrade({ tile: maxed, team: 'A', kind: 'shop', resources: res() }).reason).toBe('maxLevel')
  })

  it('같은 값을 한 번 더 낸다', () => {
    const out = upgrade({ tile: built, team: 'A', kind: 'shop', resources: res() })
    expect(out.ok).toBe(true)
    expect(out.cost).toEqual(BUILDING_BY_KIND.shop.cost)
  })
})

describe('뺏긴 칸', () => {
  it('한 단계 내려가고 1단계는 무너진다', () => {
    const out = downgradeOnCapture([
      { kind: 'shop', level: 1 },
      { kind: 'store', level: 2 },
    ])
    expect(out).toEqual([{ kind: 'store', level: 1 }])
  })
})

describe('방어', () => {
  it('건물 방어를 더한다', () => {
    const t = tile({
      tileId: 'mainBuilding',
      buildings: [{ kind: 'security', level: 1 }, { kind: 'barricade', level: 1 }],
    })
    expect(defenseOf(t)).toBe(3)
  })

  it('개조하면 두 배다', () => {
    expect(defenseOf(tile({ tileId: 'classroom', buildings: [{ kind: 'controlRoom', level: 2 }] }))).toBe(6)
  })

  it('보강 카드는 그대로 더한다', () => {
    const t = tile({ tileId: 'classroom', buildings: [{ kind: 'security', level: 1 }], reinforced: 2 })
    expect(defenseOf(t)).toBe(3)
  })

  it('비밀기지도 방어 1이다', () => {
    expect(defenseOf(tile({ tileId: 'classroom', buildings: [{ kind: 'hideout', level: 1 }] }))).toBe(1)
  })

  it('그 팀이 그 건물을 가졌는지 본다', () => {
    const tiles = [tile({ tileId: 'classroom', buildings: [{ kind: 'broadcast', level: 1 }] })]
    expect(teamHasBuilding(tiles, 'A', 'broadcast')).toBe(true)
    expect(teamHasBuilding(tiles, 'B', 'broadcast')).toBe(false)
    expect(teamHasBuilding(tiles, 'A', 'hideout')).toBe(false)
  })
})

describe('생산', () => {
  it('넓을수록 덜 거둔다', () => {
    expect(maintenanceFactor(0)).toBe(1)
    expect(maintenanceFactor(5)).toBe(1)
    expect(maintenanceFactor(6)).toBe(0.8)
    expect(maintenanceFactor(10)).toBe(0.8)
    expect(maintenanceFactor(11)).toBe(0.6)
  })

  it('건물이 내는 것을 더한다', () => {
    const tiles = [
      tile({ tileId: 'classroom', buildings: [{ kind: 'shop', level: 1 }] }),
      tile({ tileId: 'garden', buildings: [{ kind: 'archive', level: 1 }] }),
    ]
    expect(dailyProduction({ tiles, team: 'A' })).toEqual({ money: 2, knowledge: 2, influence: 0 })
  })

  it('개조하면 두 배다', () => {
    const tiles = [tile({ tileId: 'classroom', buildings: [{ kind: 'shop', level: 2 }] })]
    expect(dailyProduction({ tiles, team: 'A' }).money).toBe(4)
  })

  it('기지는 칸 수에 세지 않는다', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      tile({ tileId: ['classroom', 'garden', 'storage', 'hallway', 'artRoom'][i] as string, buildings: [{ kind: 'shop', level: 1 }] }),
    )
    const withBase = [...many, tile({ tileId: 'baseA' })]
    // 다섯 칸이라 배율 1이다. 기지를 셌다면 여섯 칸이 되어 0.8로 떨어진다
    expect(dailyProduction({ tiles: withBase, team: 'A' }).money).toBe(10)
  })

  it('배율은 마지막에 버린다', () => {
    // 세 칸에 매점 셋이면 6, ×0.8은 4.8 → 4. 칸마다 버렸다면 3이다
    const ids = ['classroom', 'garden', 'storage', 'hallway', 'artRoom', 'musicRoom']
    const tiles = ids.map((id) => tile({ tileId: id, buildings: [{ kind: 'shop', level: 1 }] }))
    expect(dailyProduction({ tiles, team: 'A' }).money).toBe(Math.floor(12 * 0.8))
  })

  it('생산 감소 견제는 절반이다', () => {
    const tiles = [tile({ tileId: 'classroom', buildings: [{ kind: 'store', level: 1 }] })]
    expect(dailyProduction({ tiles, team: 'A', productionDown: true }).money).toBe(1)
  })

  it('남의 칸은 세지 않는다', () => {
    const tiles = [tile({ tileId: 'classroom', ownerTeam: 'B', buildings: [{ kind: 'shop', level: 1 }] })]
    expect(dailyProduction({ tiles, team: 'A' }).money).toBe(0)
  })
})
