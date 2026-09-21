// 화분 — 자리와 뽑기.
import { describe, expect, it } from 'vitest'

import {
  CROPS,
  CROP_BY_ID,
  GARDEN_TILE,
  HARVEST_LIMIT,
  POT_CELLS,
  SEED_BOX_CELL,
  SEED_LIMIT,
  growHoursOf,
  nameShows,
  pickCrop,
  stageOf,
} from './crop'
import { roomOfCell } from './board'

describe('작물 표', () => {
  it('아이디가 겹치지 않는다', () => {
    expect(new Set(CROPS.map((c) => c.id)).size).toBe(CROPS.length)
  })

  it('자라는 시간의 범위가 뒤집히지 않았다', () => {
    for (const c of CROPS) {
      expect(c.growMin, c.name).toBeGreaterThan(0)
      expect(c.growMax, c.name).toBeGreaterThanOrEqual(c.growMin)
      expect(c.witherHours, c.name).toBeGreaterThan(0)
      expect(c.price, c.name).toBeGreaterThan(0)
    }
  })

  it('「그 애가 심은 것」만 판에 두 번뿐이다', () => {
    const capped = CROPS.filter((c) => c.maxPerGame !== undefined)
    expect(capped.map((c) => c.id)).toEqual(['hers'])
    expect(CROP_BY_ID.hers.maxPerGame).toBe(2)
  })
})

describe('자리', () => {
  it('화분 여덟과 씨앗 상자가 정원 안에 있다', () => {
    expect(POT_CELLS).toHaveLength(8)
    for (const c of [...POT_CELLS, SEED_BOX_CELL]) {
      expect(roomOfCell(c.x, c.y), `${c.x},${c.y}`).toBe(GARDEN_TILE)
    }
  })

  it('**씨앗 상자는 어느 화분에서도 두 칸 넘게 떨어져 있다**', () => {
    // 붙어 있으면 한 자리에 서서 집고 심을 수 있다 — 오가는 걸음이
    // 없어지고, 그러면 정원에 사람이 스치는 일도 없다
    for (const c of POT_CELLS) {
      const d = Math.max(Math.abs(c.x - SEED_BOX_CELL.x), Math.abs(c.y - SEED_BOX_CELL.y))
      expect(d, `${c.x},${c.y}`).toBeGreaterThan(1)
    }
  })

  it('두 화분이 같은 칸에 놓이지 않는다', () => {
    const keys = POT_CELLS.map((c) => `${c.x},${c.y}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(`${SEED_BOX_CELL.x},${SEED_BOX_CELL.y}`)
  })
})

describe('뽑기', () => {
  it('굴린 값이 0이면 첫 작물이다', () => {
    expect(pickCrop(0).id).toBe(CROPS[0].id)
  })

  it('다 나간 것은 안 뽑는다', () => {
    // 「그 애가 심은 것」을 두 번 다 쓰면 남은 것 중에서만 나온다
    const used = { hers: 2 }
    for (let i = 0; i < 50; i++) expect(pickCrop(i / 50, used).id).not.toBe('hers')
  })

  it('자라는 시간은 범위 안이다', () => {
    for (const c of CROPS) {
      for (const roll of [0, 0.5, 0.999]) {
        const h = growHoursOf(c, roll)
        expect(h, `${c.name} ${roll}`).toBeGreaterThanOrEqual(c.growMin)
        expect(h, `${c.name} ${roll}`).toBeLessThanOrEqual(c.growMax)
      }
    }
  })
})

describe('단계', () => {
  const H = 3_600_000

  it('흙 → 싹 → 잎 → 열매로 간다', () => {
    const grow = 6 * H
    expect(stageOf(0, grow, 0, H)).toBe('soil')
    expect(stageOf(1 * H, grow, 0, H)).toBe('soil')
    expect(stageOf(2 * H, grow, 0, H)).toBe('sprout')
    expect(stageOf(4 * H, grow, 0, H)).toBe('leaf')
    expect(stageOf(6 * H, grow, 0, H)).toBe('fruit')
  })

  it('열매가 되고 시간이 지나면 시든다', () => {
    expect(stageOf(6 * H, 6 * H, 2 * H, 3 * H)).toBe('fruit')
    expect(stageOf(6 * H, 6 * H, 3 * H, 3 * H)).toBe('withered')
  })

  it('**흙만 있을 때는 이름이 안 보인다**', () => {
    expect(nameShows('empty')).toBe(false)
    expect(nameShows('soil')).toBe(false)
    expect(nameShows('sprout')).toBe(true)
    expect(nameShows('fruit')).toBe(true)
  })
})

describe('한도', () => {
  it('들고 다니는 수확물과 씨앗에 한도가 있다', () => {
    expect(HARVEST_LIMIT).toBeGreaterThan(0)
    expect(SEED_LIMIT).toBeGreaterThan(0)
    expect(SEED_LIMIT).toBeLessThan(POT_CELLS.length)
  })
})
