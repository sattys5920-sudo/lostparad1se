// 덫 — 기술실 제조기에서 만들어 복도에 놓는다.
//
// **만드는 것은 페이즈의 일이고, 놓는 것은 걸음의 일이다.**
//
//   맡기기    페이즈 중에만. 팀 토큰 1 로 1개 — 기술실을 쥔 팀은 2개.
//             20분 걸린다. 제조기 하나에 한 건씩이다.
//   찾기      맡긴 사람만. 그 페이즈 안에 안 찾으면 페이즈가 닫힐 때
//             사라진다 — 다음 페이즈로 넘어가지 않는다.
//   놓기      복도 칸에만. 놓으면 아무에게도 안 보인다.
//   걸림      다른 팀이 밟으면 10분 동안 못 움직인다. 우리 팀은 밟아도
//             아무 일도 없다. 걸린 덫은 사라진다.
//
// 제조기는 기물이다(rules/fixtures) — 그 칸은 못 밟고 옆에 서서 연다.
// 연구실의 연구 기계도 같다. 연구 규칙은 그대로고, 서는 자리만 생겼다.
import type { Cell, TileId } from './board'

/** 덫을 만드는 방. 옛 기지 C — 지하라 남이 잘 안 내려온다. */
export const TECH_TILE: TileId = 'baseC'
/** 연구 기계가 선 방. */
export const LAB_TILE: TileId = 'labRoom'

/** 맡기고 나서 찾을 수 있기까지. 게임 시계로. */
export const TRAP_MAKE_MINUTES = 20
/** 걸린 사람이 못 움직이는 시간. 게임 시계로. */
export const SNARE_MINUTES = 10
/** 한 건에 드는 팀 토큰. */
export const TRAP_TOKEN_COST = 1
/** 토큰 하나로 나오는 덫. 기술실을 쥐면 곱절이다. */
export const TRAPS_PER_TOKEN = 1
export const TRAPS_PER_TOKEN_OWNER = 2
export const trapsPerToken = (ownsTech: boolean): number => (ownsTech ? TRAPS_PER_TOKEN_OWNER : TRAPS_PER_TOKEN)

export interface MakerSpot {
  i: number
  cell: Cell
}

/**
 * 제조기 셋. 기술실 왼쪽 벽을 따라 한 칸씩 띄워 선다.
 *
 * 띄우는 까닭: 셋을 붙여 세우면 벽이 되어 왼쪽 줄이 막힌다. 한 칸씩
 * 띄우면 사이로 지나가고, 어느 제조기든 둘레 여덟 칸이 비어 있다.
 */
export const MAKERS: readonly MakerSpot[] = [
  { i: 0, cell: { x: 25, y: 114 } },
  { i: 1, cell: { x: 25, y: 116 } },
  { i: 2, cell: { x: 25, y: 118 } },
]

/** 연구 기계. 연구실 오른쪽, 문에서 오는 길 밖이다. */
export const LAB_MACHINE: Cell = { x: 63, y: 99 }

/** 옆인가. 둘레 한 칸 — 게시판·자판기와 같은 자다. */
export const beside = (me: Cell | null | undefined, at: Cell): boolean =>
  me != null && Math.abs(me.x - at.x) <= 1 && Math.abs(me.y - at.y) <= 1

/** 내가 옆에 선 제조기. 없으면 null. 둘 사이에 서면 앞 번호다 */
export const makerBeside = (me: Cell | null | undefined): MakerSpot | null =>
  MAKERS.find((m) => beside(me, m.cell)) ?? null

export const atLabMachine = (me: Cell | null | undefined): boolean => beside(me, LAB_MACHINE)
