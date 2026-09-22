// 마주침 차림표가 어디에 뜨나.
//
// 여기서 지키려는 것은 하나다 — **짚은 손가락 밑에 뜨지 않는다.**
// 말 한 칸은 32px 인데 손끝이 닿는 자리는 45px 쯤이다. 창이 그
// 안에 걸치면 뜬 것을 못 본다.
import { describe, expect, it } from 'vitest'

import { placeMenu } from './Meet'

/** 아이폰 SE. 여기서 안 되면 어디서도 안 된다 */
const SCREEN = { w: 375, h: 667 }
/** 네 줄짜리 차림표. 머리 31 + 48×4 */
const SIZE = { w: 148, h: 223 }

/** 말 한 칸(16px 타일 × 배율 2). 머리끝과 발끝이 이만큼 떨어져 있다 */
const CHAR = 48

const standing = (x: number, foot: number) => ({ x, foot, head: foot - CHAR })

describe('차림표 자리', () => {
  it('머리 위가 넉넉하면 머리 위에 뜬다', () => {
    const box = placeMenu(standing(188, 600), SIZE, SCREEN)
    expect(box.below).toBe(false)
    expect(box.top + SIZE.h).toBeLessThanOrEqual(600 - CHAR)
  })

  it('손끝이 닿는 자리(45px)에 걸치지 않는다', () => {
    // 머리 위에 떴을 때 — 차림표 아랫변과 머리끝 사이
    const up = placeMenu(standing(188, 600), SIZE, SCREEN)
    expect(600 - CHAR - (up.top + SIZE.h)).toBeGreaterThanOrEqual(45 / 2)
    // 발밑으로 뒤집혔을 때 — 발끝과 차림표 윗변 사이
    const down = placeMenu(standing(188, 120), SIZE, SCREEN)
    expect(down.below).toBe(true)
    expect(down.top - 120).toBeGreaterThanOrEqual(45 / 2)
  })

  it('머리 위가 모자라면 발밑으로 뒤집는다', () => {
    const box = placeMenu(standing(188, 90), SIZE, SCREEN)
    expect(box.below).toBe(true)
    expect(box.top).toBeGreaterThan(90)
  })

  it('위아래 어디도 모자라면 화면 안으로 민다', () => {
    // 화면 한가운데 선 사람에 화면을 거의 채우는 차림표. 뒤집어도 안 들어간다
    const tall = { w: 148, h: 640 }
    const box = placeMenu(standing(188, 340), tall, SCREEN)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.top + tall.h).toBeLessThanOrEqual(SCREEN.h)
  })

  it('가장자리 말도 창이 화면 밖으로 안 나간다', () => {
    for (const x of [0, 6, 188, 370, 375]) {
      const box = placeMenu(standing(x, 600), SIZE, SCREEN)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.left + SIZE.w).toBeLessThanOrEqual(SCREEN.w)
    }
  })

  it('꼬리는 짚은 말을 가리킨다', () => {
    const box = placeMenu(standing(188, 600), SIZE, SCREEN)
    expect(box.left + box.tail).toBe(188)
  })

  it('가장자리에서는 꼬리가 모서리를 넘지 않는다', () => {
    const box = placeMenu(standing(2, 600), SIZE, SCREEN)
    expect(box.tail).toBeGreaterThanOrEqual(0)
    expect(box.tail).toBeLessThanOrEqual(SIZE.w)
  })
})
