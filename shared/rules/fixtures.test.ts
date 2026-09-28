// 복도의 기물 — 못 밟고, 앞에 서야 열린다.
import { describe, expect, it } from 'vitest'
import { ARCADE_MACHINES } from './arcade'

import { FIXTURE_CELLS, facing, fixtureAt, isFixture } from './fixtures'
import { BOARDS } from './errand'
import { VENDINGS } from './shop'
import { GARDEN_TILE, POT_CELLS } from './crop'
import { isHallCell, roomOfCell } from './board'
import { LAB_MACHINES, MAKERS, atLabMachine, pickLabMachine } from './trap'
import { isWalkable } from '../../src/school/map/world'

describe('기물', () => {
  it('게시판 여섯 · 자판기 셋 · 화분 여덟 · 제조기 셋 · 연구 기계 셋 · 오락기 열이 전부다', () => {
    expect(FIXTURE_CELLS.size).toBe(BOARDS.length + VENDINGS.length + POT_CELLS.length + MAKERS.length + LAB_MACHINES.length + ARCADE_MACHINES.length)
    expect(FIXTURE_CELLS.size).toBe(33)
  })

  /* 연구 기계 셋 — 연구실 안에 서고, 셋 다 옆에 설 자리가 있다 */
  it('연구 기계 셋은 연구실 안이고 어느 것이든 옆에 서면 연구한다', () => {
    expect(LAB_MACHINES.length).toBe(3)
    for (const [i, c] of LAB_MACHINES.entries()) {
      expect(roomOfCell(c.x, c.y), `연구 기계 ${i + 1}`).toBe('labRoom')
      expect(fixtureAt(c.x, c.y)?.kind).toBe('lab')
      const beside = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }))
      const stand = beside.filter((b) => isWalkable(b.x, b.y))
      expect(stand.length, `연구 기계 ${i + 1} 옆에 설 자리`).toBeGreaterThan(0)
      for (const b of stand) expect(atLabMachine(b)).toBe(true)
    }
  })

  /*
   * **막는 자리와 여는 자리가 같은 한 칸이다.** 그림만 얹혀 있으면
   * 사람이 기계를 뚫고 지나가고, 그러면 복도에 세워 둔 뜻이 없다.
   */
  it('기물이 선 칸은 못 밟는다', () => {
    for (const b of BOARDS) expect(isFixture(b.cell.x, b.cell.y), b.name).toBe(true)
    for (const v of VENDINGS) expect(isFixture(v.cell.x, v.cell.y), v.name).toBe(true)
    for (const [i, c] of POT_CELLS.entries()) expect(isFixture(c.x, c.y), `화분 ${i + 1}`).toBe(true)
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
    expect(fixtureAt(POT_CELLS[0].x, POT_CELLS[0].y)?.kind).toBe('pot')
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

  /** 게시판·자판기는 복도에만 선다. 방 안에 서면 그 방 주인이 길목을 쥔다 */
  it('게시판과 자판기 아홉 칸은 모두 복도다', () => {
    for (const c of [...BOARDS.map((b) => b.cell), ...VENDINGS.map((v) => v.cell)]) {
      expect(roomOfCell(c.x, c.y), `${c.x},${c.y}`).toBeNull()
      expect(isHallCell(c.x, c.y), `${c.x},${c.y}`).toBe(true)
    }
  })

  /** 화분은 반대다 — 정원 안이다. 복도에 화분이 서면 아무 팀의 정원도 아니다 */
  it('화분 여덟 칸은 모두 정원 안이다', () => {
    for (const c of POT_CELLS) expect(roomOfCell(c.x, c.y), `${c.x},${c.y}`).toBe(GARDEN_TILE)
  })
})

describe('연구 기계 한 대에 한 건', () => {
  const [m0, m1] = LAB_MACHINES
  const between = { x: (m0.x + m1.x) / 2, y: m0.y }
  it('옆에 선 빈 기계를 고른다 — 사이에 서면 앞 번호', () => {
    expect(pickLabMachine(between, new Set())).toBe(0)
    expect(pickLabMachine(between, new Set([0]))).toBe(1)
  })
  it('옆 기계가 다 찼으면 못 건다', () => {
    expect(pickLabMachine(between, new Set([0, 1]))).toBe('busy')
  })
  it('짚은 기계만 본다 — 찼으면 옆 기계로 넘어가지 않는다', () => {
    expect(pickLabMachine(between, new Set([1]), 1)).toBe('busy')
    expect(pickLabMachine(between, new Set(), 1)).toBe(1)
    expect(pickLabMachine(between, new Set(), 2)).toBe('far')
  })
  it('기계 옆이 아니면 못 건다', () => {
    expect(pickLabMachine({ x: 0, y: 0 }, new Set())).toBe('far')
  })
})
