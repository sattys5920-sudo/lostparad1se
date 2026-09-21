// 복도에 붙박인 것 — 게시판과 자판기.
//
// **기물이다. 밟고 지나갈 수 없다.**
//
// 처음에는 복도 칸 위에 그림만 얹어 두었다. 그러면 사람이 기계를
// 뚫고 지나가고, 두 칸 사이에 낀 기계는 있으나 마나인 장식이 된다.
// 벽처럼 막아야 복도가 「지나가는 길」이 아니라 **지나가다 걸리는
// 자리**가 된다 — 게시판 앞에서 한 번 멈추는 그 걸음이 이 물건들이
// 하는 일의 절반이다.
//
// 막는 자리와 여는 자리가 **같은 한 칸**이다: 그 칸을 밟을 수는
// 없고, 둘레 한 칸에 서서 눌러야 열린다(atBoard · atVending).
import type { Cell } from './board'
import { BOARDS } from './errand'
import { VENDINGS } from './shop'

const keyOf = (x: number, y: number): string => `${x},${y}`

/**
 * 기물이 선 칸 전부. **한 번만 만든다** — 걷기 판정이 걸음마다
 * 이걸 물어보므로, 매번 목록을 훑으면 십자키가 무거워진다.
 */
export const FIXTURE_CELLS: ReadonlySet<string> = new Set([
  ...BOARDS.map((b) => keyOf(b.cell.x, b.cell.y)),
  ...VENDINGS.map((v) => keyOf(v.cell.x, v.cell.y)),
])

/** 그 칸에 기물이 서 있는가. 서 있으면 못 밟는다. */
export const isFixture = (x: number, y: number): boolean => FIXTURE_CELLS.has(keyOf(x, y))

/** 사람이 짚은 칸에 선 기물. 없으면 null — 화면이 무엇을 열지 이걸로 가른다. */
export function fixtureAt(x: number, y: number): { kind: 'board' | 'vending'; name: string; cell: Cell } | null {
  const b = BOARDS.find((s) => s.cell.x === x && s.cell.y === y)
  if (b) return { kind: 'board', name: b.name, cell: b.cell }
  const v = VENDINGS.find((s) => s.cell.x === x && s.cell.y === y)
  if (v) return { kind: 'vending', name: v.name, cell: v.cell }
  return null
}

/** 그 기물 앞에 서 있는가. **둘레 한 칸까지** — 대각선도 앞이다. */
export const facing = (me: Cell | null | undefined, at: Cell): boolean =>
  me !== null && me !== undefined && Math.abs(me.x - at.x) <= 1 && Math.abs(me.y - at.y) <= 1
