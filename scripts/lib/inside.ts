// 방 안 빈 칸 — **시험 준비용.**
//
// 종이 치면 모두 문 앞 복도에서 시작한다. 시험이 방 안에서 할 일이 있으면
// 자유 시간에 그 방 안 빈 칸으로 다시 서야 한다(standAt). 여기서는 칸만 고른다.
import { roomOfCell, type Cell, type TileId } from '../../shared/rules/board'
import { dropCellsIn } from '../../shared/rules/quiz'
import { canSeatAt } from '../../shared/rules/seat'

/** 그 칸이 그 방 안인가 — 문 앞 복도면 아니다 */
export const isInside = (tile: string | null | undefined, at: Cell | null | undefined): boolean =>
  !!tile && !!at && roomOfCell(at.x, at.y) === tile

/** 방 안에서 아무도 안 선 칸 하나. taken 은 "x,y" */
export function insideCell(tile: string, taken: ReadonlySet<string>): Cell | null {
  return dropCellsIn(tile as TileId).find((c) => canSeatAt(c.x, c.y) && !taken.has(`${c.x},${c.y}`)) ?? null
}

/** 말 문서들에서 찬 칸("x,y") — 방이나 복도에 서 있는 사람 */
export function takenOf(pawns: Record<string, { tileId?: unknown; at?: unknown }>): Set<string> {
  const out = new Set<string>()
  for (const p of Object.values(pawns)) {
    const at = p.at as Cell | null | undefined
    if (p.tileId != null && at) out.add(`${at.x},${at.y}`)
  }
  return out
}

/**
 * 여럿을 그 방 안 빈 칸에 **바로** 세운다 — 서버를 거치지 않는 시험 준비다.
 * 교시가 열리면 모두 복도로 나오는데, 시험이 볼 것이 입장(토큰·5 분)이 아니라
 * 방 안에서 하는 일일 때 쓴다. fs 는 문서 REST 주소(…/documents), headers 는 운영자 권한.
 */
export async function placeInside(fs: string, headers: Record<string, string>, game: string, uids: readonly string[], tile: string): Promise<void> {
  const res = (await (await fetch(`${fs}/games/${game}/pawns?pageSize=300`, { headers })).json()) as {
    documents?: { name: string; fields?: { tileId?: { stringValue?: string }; at?: { mapValue?: { fields?: { x?: { integerValue?: string }; y?: { integerValue?: string } } } } } }[]
  }
  const taken = new Set<string>()
  for (const d of res.documents ?? []) {
    const id = d.name.split('/').pop() as string
    if (uids.includes(id)) continue
    const a = d.fields?.at?.mapValue?.fields
    if (d.fields?.tileId?.stringValue && a?.x && a?.y) taken.add(`${a.x.integerValue},${a.y.integerValue}`)
  }
  for (const uid of uids) {
    const c = insideCell(tile, taken)
    if (!c) throw new Error(`${tile} 안에 빈 칸이 없다`)
    taken.add(`${c.x},${c.y}`)
    const r = await fetch(`${fs}/games/${game}/pawns/${uid}?updateMask.fieldPaths=at&updateMask.fieldPaths=tileId`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ fields: { tileId: { stringValue: tile }, at: { mapValue: { fields: { x: { integerValue: String(c.x) }, y: { integerValue: String(c.y) } } } } } }),
    })
    if (!r.ok) throw new Error(`placeInside ${uid}: ${r.status}`)
  }
}
