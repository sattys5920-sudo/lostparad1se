// 덫 — 기술실 제조기에서 만들어 복도에 놓는다.
//
// **만드는 것은 페이즈의 일이고, 놓는 것은 걸음의 일이다.**
//
//   맡기기    페이즈 중에만. 내 돈 3코인으로 1개 — 기술실을 쥔 팀은 2개.
//             20분 걸린다. 제조기 하나에 한 건씩이다.
//   찾기      **그 페이즈 동안에는 맡긴 사람만.** 페이즈가 끝나도록 안
//             찾아갔으면 그다음부터는 누구든 — 남의 팀도 — 찾아간다.
//             찾아간 사람의 덫이 된다(놓으면 그 사람 팀 덫이다).
//   놓기      복도 칸에만. 놓으면 아무에게도 안 보인다.
//   걸림      다른 팀이 밟으면 10분 동안 못 움직인다. 우리 팀은 밟아도
//             아무 일도 없다. 걸린 덫은 사라진다.
//
// 제조기는 기물이다(rules/fixtures) — 그 칸은 못 밟고 옆에 서서 연다.
// 연구실의 연구 기계 셋도 같다.
import type { Cell, TileId } from './board'
import { onlyMakerNow } from './made'

/** 덫을 만드는 방. 옛 기지 C — 지하라 남이 잘 안 내려온다. */
export const TECH_TILE: TileId = 'baseC'
/** 연구 기계가 선 방. */
export const LAB_TILE: TileId = 'labRoom'

/** 맡기고 나서 찾을 수 있기까지. 게임 시계로. */
export const TRAP_MAKE_MINUTES = 20
/** 걸린 사람이 못 움직이는 시간. 게임 시계로. */
export const SNARE_MINUTES = 10
/** 한 건에 드는 돈. **맡기는 사람 지갑에서** 나가고, 나간 돈은 사라진다. */
export const TRAP_COIN_COST = 3
/** 한 건에 나오는 덫. 기술실을 쥐면 곱절이다. */
export const TRAPS_PER_BATCH = 1
export const TRAPS_PER_BATCH_OWNER = 2
export const trapsPerBatch = (ownsTech: boolean): number => (ownsTech ? TRAPS_PER_BATCH_OWNER : TRAPS_PER_BATCH)

export type TrapTakeNo = 'notReady' | 'notYours'

export const TRAP_TAKE_NO: Record<TrapTakeNo, string> = {
  notReady: '아직 만드는 중이다',
  notYours: '페이즈 동안에는 맡긴 사람만 찾아간다',
}

/**
 * 제조기에 걸린 것을 찾아갈 수 있는가. **없으면 null 이다.**
 *
 * 맡긴 그 페이즈가 열려 있는 동안에는 맡긴 사람 것이다. 그 페이즈가
 * 닫히면 누구든 — 자유 시간에도, 다음 페이즈에도.
 */
export function whyNotTakeTrap(a: {
  nowMs: number
  readyAtMs: number
  /** 지금 열린 페이즈 번호. 닫혀 있으면 null */
  openPhaseNo: number | null
  /** 맡긴 페이즈 번호 */
  jobPhaseNo: number
  mine: boolean
}): TrapTakeNo | null {
  if (!a.mine && onlyMakerNow(a.openPhaseNo, a.jobPhaseNo)) return 'notYours'
  if (a.nowMs < a.readyAtMs) return 'notReady'
  return null
}

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

/**
 * 연구 기계 셋. 연구실 한가운데 아래 줄에, 한 칸씩 띄워 선다.
 *
 * 제조기처럼 사이를 비워 둔다 — 붙여 세우면 벽이 되어 아래로 못 간다.
 * 셋 다 둘레 여덟 칸이 비어 있다.
 */
export const LAB_MACHINES: readonly Cell[] = [
  // 방 한가운데(59,99)는 비운다 — 방으로 옮겨 세울 때 서는 자리다
  { x: 59, y: 101 },
  { x: 61, y: 101 },
  { x: 63, y: 101 },
]

/** 옆인가. 둘레 한 칸 — 게시판·자판기와 같은 자다. */
export const beside = (me: Cell | null | undefined, at: Cell): boolean =>
  me != null && Math.abs(me.x - at.x) <= 1 && Math.abs(me.y - at.y) <= 1

/** 내가 옆에 선 제조기. 없으면 null. 둘 사이에 서면 앞 번호다 */
export const makerBeside = (me: Cell | null | undefined): MakerSpot | null =>
  MAKERS.find((m) => beside(me, m.cell)) ?? null

export type LabPickNo = 'far' | 'busy'

export const LAB_PICK_NO: Record<LabPickNo, string> = {
  far: '연구 기계 옆에 서야 한다',
  busy: '이 연구 기계는 돌고 있다 — 한 대에 연구 하나다',
}

/**
 * 연구를 어느 기계에 거는가. **한 대에 한 건이다.**
 *
 * 연구가 돌고 있거나, 다 돼서 완성품이 아직 안 치워진 기계는 찼다
 * (제조기와 같은 자). 짚은 기계(want)가 있으면 그것만 보고, 없으면
 * 옆에 선 것 중 빈 첫 기계를 고른다 — 두 기계 사이에 서면 둘 다 옆이다.
 */
export function pickLabMachine(
  me: Cell | null | undefined,
  busy: ReadonlySet<number>,
  want?: number | null,
): number | LabPickNo {
  const near = LAB_MACHINES.map((c, i) => (beside(me, c) ? i : -1)).filter((i) => i >= 0)
  if (want !== undefined && want !== null) {
    if (!near.includes(want)) return 'far'
    return busy.has(want) ? 'busy' : want
  }
  if (near.length === 0) return 'far'
  const free = near.find((i) => !busy.has(i))
  return free === undefined ? 'busy' : free
}

/** 연구 기계 셋 중 하나 옆인가 */
export const atLabMachine = (me: Cell | null | undefined): boolean => LAB_MACHINES.some((m) => beside(me, m))
