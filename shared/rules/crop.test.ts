// 작물 — 뽑기와 단계.
import { describe, expect, it } from 'vitest'

import { CROPS, CROP_BY_ID, HARVEST_LIMIT, POT_CELLS, growHoursOf, nameShows, pickCrop, stageOf } from './crop'

describe('작물 목록', () => {
  it('스무 가지다', () => {
    expect(CROPS).toHaveLength(20)
    expect(Object.keys(CROP_BY_ID)).toHaveLength(20)
  })

  it('이름과 아이디가 겹치지 않는다', () => {
    expect(new Set(CROPS.map((c) => c.id)).size).toBe(CROPS.length)
    expect(new Set(CROPS.map((c) => c.name)).size).toBe(CROPS.length)
  })

  it('자라는 범위가 뒤집혀 있지 않다', () => {
    for (const c of CROPS) {
      expect(c.growMin, c.name).toBeGreaterThan(0)
      expect(c.growMax, c.name).toBeGreaterThanOrEqual(c.growMin)
      expect(c.witherHours, c.name).toBeGreaterThan(0)
      expect(c.price, c.name).toBeGreaterThan(0)
    }
  })

  it('뒤 다섯만 무게가 낮다 — 비싼 것이 흔하면 정원이 은행이 된다', () => {
    const light = CROPS.filter((c) => c.weight === 1).map((c) => c.name)
    expect(light).toEqual(['밤에 피는 나팔꽃', '종이꽃', '이름 없는 풀', '유리 열매', '그 애가 심은 것'])
    for (const c of CROPS) expect(c.weight === 1 || c.weight === 6, c.name).toBe(true)
  })

  it('화분은 여덟 자리고 겹치지 않는다', () => {
    expect(POT_CELLS).toHaveLength(8)
    expect(new Set(POT_CELLS.map((c) => `${c.x},${c.y}`)).size).toBe(8)
  })
})

describe('뽑기', () => {
  it('같은 눈이면 같은 것이 나온다', () => {
    expect(pickCrop(0.42).id).toBe(pickCrop(0.42).id)
  })

  it('맨 앞과 맨 뒤가 나온다 — 어느 쪽도 못 나오는 눈은 없다', () => {
    expect(pickCrop(0).id).toBe(CROPS[0].id)
    expect(pickCrop(0.999999).id).toBe(CROPS[CROPS.length - 1].id)
  })

  /** **「그 애가 심은 것」은 판 전체에서 두 번뿐이다.** */
  it('두 번 나온 뒤에는 안 나온다', () => {
    expect(pickCrop(0.999999, { hers: 2 }).id).not.toBe('hers')
    // 한 번 나온 뒤에는 아직 나온다
    expect(pickCrop(0.999999, { hers: 1 }).id).toBe('hers')
  })

  it('자라는 시간은 범위 안에서 뽑힌다', () => {
    for (const c of CROPS) {
      for (const roll of [0, 0.5, 0.999999]) {
        const h = growHoursOf(c, roll)
        expect(h, `${c.name} ${roll}`).toBeGreaterThanOrEqual(c.growMin)
        expect(h, `${c.name} ${roll}`).toBeLessThanOrEqual(c.growMax)
      }
    }
  })
})

describe('단계', () => {
  const H = 3_600_000
  const grow = 6 * H
  const wither = 2 * H

  it('셋으로 나눠 넘어간다', () => {
    expect(stageOf(0, grow, 0, wither)).toBe('soil')
    expect(stageOf(1.9 * H, grow, 0, wither)).toBe('soil')
    expect(stageOf(2 * H, grow, 0, wither)).toBe('sprout')
    expect(stageOf(3.9 * H, grow, 0, wither)).toBe('sprout')
    expect(stageOf(4 * H, grow, 0, wither)).toBe('leaf')
    expect(stageOf(6 * H, grow, 0, wither)).toBe('fruit')
  })

  it('열매가 된 뒤 시간이 지나면 시든다', () => {
    expect(stageOf(grow, grow, 1.9 * H, wither)).toBe('fruit')
    expect(stageOf(grow, grow, 2 * H, wither)).toBe('withered')
  })

  /** **싹이 나야 이름이 보인다.** 흙만 있을 때는 심은 사람도 모른다 */
  it('흙일 때는 이름이 안 보인다', () => {
    expect(nameShows('empty')).toBe(false)
    expect(nameShows('soil')).toBe(false)
    expect(nameShows('sprout')).toBe(true)
    expect(nameShows('leaf')).toBe(true)
    expect(nameShows('fruit')).toBe(true)
  })
})

describe('소지 한도', () => {
  it('다섯이다', () => {
    expect(HARVEST_LIMIT).toBe(5)
  })
})
