// 복도의 기물 — 못 밟고, 앞에 서야 열린다.
import { describe, expect, it } from 'vitest'

import { FIXTURE_CELLS, facing, fixtureAt, isFixture } from './fixtures'
import { BOARDS } from './errand'
import { VENDINGS } from './shop'
import { isHallCell, roomOfCell } from './board'

describe('기물', () => {
  it('게시판 여섯과 자판기 셋이 전부다', () => {
    expect(FIXTURE_CELLS.size).toBe(BOARDS.length + VENDINGS.length)
    expect(FIXTURE_CELLS.size).toBe(9)
  })

  /*
   * **막는 자리와 여는 자리가 같은 한 칸이다.** 그림만 얹혀 있으면
   * 사람이 기계를 뚫고 지나가고, 그러면 복도에 세워 둔 뜻이 없다.
   */
  it('기물이 선 칸은 못 밟는다', () => {
    for (const b of BOARDS) expect(isFixture(b.cell.x, b.cell.y), b.name).toBe(true)
    for (const v of VENDINGS) expect(isFixture(v.cell.x, v.cell.y), v.name).toBe(true)
  })

  it('옆 칸은 멀쩡히 밟는다 — 앞에 서야 하니까', () => {
    for (const v of VENDINGS) {
      expect(isFixture(v.cell.x + 1, v.cell.y), v.name).toBe(false)
      expect(isFixture(v.cell.x - 1, v.cell.y), v.name).toBe(false)
    }
  })

  it('무엇이 선 칸인지 가려 준다', () => {
    const b = BOARDS[0]
    const v = VENDINGS[0]
    expect(fixtureAt(b.cell.x, b.cell.y)?.kind).toBe('board')
    expect(fixtureAt(v.cell.x, v.cell.y)?.kind).toBe('vending')
    expect(fixtureAt(b.cell.x + 5, b.cell.y)).toBeNull()
  })

  /** 둘레 한 칸까지가 「앞」이다. 대각선도 앞이다 */
  it('앞에 서야 열린다', () => {
    const at = VENDINGS[0].cell
    expect(facing(at, at)).toBe(true)
    expect(facing({ x: at.x + 1, y: at.y - 1 }, at)).toBe(true)
    expect(facing({ x: at.x + 2, y: at.y }, at)).toBe(false)
    expect(facing(null, at)).toBe(false)
  })

  /** 기물은 복도에만 선다. 방 안에 서면 그 방 주인이 길목을 쥔다 */
  it('아홉 칸 모두 복도다', () => {
    for (const k of FIXTURE_CELLS) {
      const [x, y] = k.split(',').map(Number)
      expect(roomOfCell(x, y), k).toBeNull()
      expect(isHallCell(x, y), k).toBe(true)
    }
  })
})
