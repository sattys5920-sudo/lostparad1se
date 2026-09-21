// 심부름 물건이 놓이는 자리가 **닿는 자리인가.**
//
// 자리는 방 사각형 안에서 아이디로 정한다(shared/rules/errand). 방
// 사각형은 벽을 뺀 안쪽이지만 가구까지는 모른다 — 규칙 쪽에서는 지도의
// 가구를 못 본다. 그래서 여기서 확인한다: 책상 위에 놓이는 것은 괜찮고
// (옆에 서서 집는다), **둘레가 다 막혀 못 집는 자리는 안 된다.**
import { describe, expect, it } from 'vitest'

import { TILES } from '../../../shared/rules/board'
import { thingCellOf } from '../../../shared/rules/errand'
import { isWalkable } from './world'

/** 여러 아이디를 넣어 본다. 운영자가 새 심부름을 만들면 아이디도 새것이다 */
const IDS = ['beaker', 'broom', 'tray', 'box', 'chair', 'x1', '주번일지', 'a', 'zzzzzz']

describe('심부름 물건 자리', () => {
  it('어느 방 어느 아이디든 둘레 한 칸 안에 설 자리가 있다', () => {
    const stuck: string[] = []
    for (const t of TILES) {
      for (const id of IDS) {
        const c = thingCellOf(id, t.id)
        let near = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (isWalkable(c.x + dx, c.y + dy)) near++
        }
        if (near === 0) stuck.push(`${t.name}/${id} ${c.x},${c.y}`)
      }
    }
    expect(stuck).toEqual([])
  })

  it('그 방 안에 놓인다', () => {
    for (const t of TILES) {
      for (const id of IDS) {
        const c = thingCellOf(id, t.id)
        expect(c.x).toBeGreaterThanOrEqual(t.plan.x)
        expect(c.x).toBeLessThan(t.plan.x + t.plan.w)
        expect(c.y).toBeGreaterThanOrEqual(t.plan.y)
        expect(c.y).toBeLessThan(t.plan.y + t.plan.h)
      }
    }
  })

  it('같은 심부름은 늘 같은 자리다', () => {
    const a = thingCellOf('beaker', 'labRoom')
    const b = thingCellOf('beaker', 'labRoom')
    expect(a).toEqual(b)
  })
})
