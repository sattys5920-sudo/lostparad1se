// 방 안에서 **설 칸과 종이를 놓을 칸**을 찾는다. 시험 스크립트들이 같이 쓴다.
//
// 문제 종이와 비밀 쪽지는 칸에 놓이고, 옆 칸에 서야 줍는다. 시험은
// 그 둘을 짝으로 찾는다 — 설 칸과 바로 오른쪽 칸. 이미 쓴 칸은 건너뛴다.
//
// **plan 이 칸 좌표다.** rect 는 미니맵 쪽 네모라 쓰면 다른 층이 나온다.
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { canDropQuizAt } from '../../shared/rules/quiz'

export interface Cell {
  x: number
  y: number
}

export function standAndSpot(tileId: TileId, skip: readonly Cell[] = []): { stand: Cell; spot: Cell } {
  const used = (x: number, y: number) => skip.some((c) => c.x === x && c.y === y)
  const r = TILE_BY_ID[tileId].plan
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!canDropQuizAt(x, y) || !canDropQuizAt(x + 1, y) || used(x + 1, y)) continue
      return { stand: { x, y }, spot: { x: x + 1, y } }
    }
  }
  throw new Error(`${tileId} 안에 설 칸과 놓을 칸이 없다`)
}
