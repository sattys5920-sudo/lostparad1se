// 심부름 — 게시판과 시간.
import { describe, expect, it } from 'vitest'

import {
  BOARDS,
  BOARD_BY_ID,
  ERRANDS,
  ERRANDS_PER_BOARD,
  ERRANDS_PER_PERSON,
  THING_ICONS,
  atBoard,
  isExpired,
  minutesLeft,
} from './errand'
import { TILE_BY_ID } from './board'

describe('게시판', () => {
  it('층마다 둘씩 여섯이다', () => {
    expect(BOARDS).toHaveLength(6)
    expect(Object.keys(BOARD_BY_ID)).toHaveLength(6)
    for (const f of ['b1', 'f1', 'f2'] as const) {
      expect(BOARDS.filter((b) => b.floor === f), f).toHaveLength(2)
    }
    // 옥상에는 없다 — 복도가 없는 층이다
    expect(BOARDS.some((b) => b.floor === 'roof')).toBe(false)
  })

  it('한 장씩만 붙는 게시판이 아니다 — 둘까지', () => {
    expect(ERRANDS_PER_BOARD).toBe(2)
    expect(ERRANDS_PER_PERSON).toBe(1)
  })

  /** **둘레 한 칸까지 친다.** 딱 그 칸만 치면 벽에 붙은 게시판 앞에 설 자리가 없다 */
  it('앞에 서면 된다 — 둘레 한 칸까지', () => {
    const b = BOARDS[0]
    expect(atBoard(b.cell, b)).toBe(true)
    expect(atBoard({ x: b.cell.x + 1, y: b.cell.y - 1 }, b)).toBe(true)
    expect(atBoard({ x: b.cell.x + 2, y: b.cell.y }, b)).toBe(false)
    expect(atBoard(null, b)).toBe(false)
  })
})

describe('제한 시간', () => {
  const M = 60_000

  it('지나면 끝이다', () => {
    expect(isExpired(0, 40, 39 * M)).toBe(false)
    expect(isExpired(0, 40, 40 * M)).toBe(true)
  })

  it('남은 시간은 0 아래로 안 내려간다', () => {
    expect(minutesLeft(0, 40, 10 * M)).toBe(30)
    expect(minutesLeft(0, 40, 99 * M)).toBe(0)
  })
})

describe('심부름 열 가지', () => {
  it('가져올 방과 놓을 방이 판에 있고, 서로 다르다', () => {
    for (const e of ERRANDS) {
      expect(TILE_BY_ID[e.from], e.thing).toBeDefined()
      expect(TILE_BY_ID[e.to], e.thing).toBeDefined()
      expect(e.from, e.thing).not.toBe(e.to)
      expect(e.coins, e.thing).toBeGreaterThan(0)
      expect(e.limitMin, e.thing).toBeGreaterThan(0)
    }
  })

  it('아이디가 겹치지 않는다', () => {
    expect(new Set(ERRANDS.map((e) => e.id)).size).toBe(ERRANDS.length)
  })

  /*
   * **물건마다 그림이 하나씩이다.** 목록을 닫은 이유가 이것이라,
   * 그림 없는 심부름이 끼면 닫아 둔 보람이 없다. 그림 자체가 12줄
   * 12칸인지는 thingArt 가 켜질 때 스스로 터뜨린다.
   */
  it('심부름마다 아는 그림이 붙어 있다', () => {
    for (const e of ERRANDS) {
      expect(e.icon, e.thing).toBeDefined()
      expect(THING_ICONS, e.thing).toContain(e.icon)
    }
  })

  it('그림이 겹치지 않는다 — 두 물건이 같아 보이면 고른 뜻이 없다', () => {
    const icons = ERRANDS.map((e) => e.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  /** 게시판 여섯에 두 장씩 — 열두 자리. 열 가지면 다 채우고도 남는다 */
  it('게시판을 다 채울 만큼 있다', () => {
    expect(ERRANDS.length).toBeGreaterThanOrEqual(BOARDS.length)
  })
})
