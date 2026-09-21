// 게시판·자판기·화분 자리가 진짜 거기 있는가. **눈이 아니라 지도에 물어본다.**
//
//   npx vite-node scripts/spot-check.ts
import { BOARDS } from '../shared/rules/errand'
import { GARDEN_TILE, POT_CELLS } from '../shared/rules/crop'
import { VENDINGS } from '../shared/rules/shop'
import { HALLS, TILE_BY_ID, TILES, roomOfCell, type TileId } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'
import { isWalkable, stairHere } from '../src/school/map/world'

let bad = 0
const say = (ok: boolean, line: string) => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${line}`)
}

/** 그 칸이 복도인가. 복도 띠 안에 들면 복도다. */
const inHall = (x: number, y: number): boolean =>
  HALLS.some((h) => x >= h.rect.x && x < h.rect.x + h.rect.w && y >= h.rect.y && y < h.rect.y + h.rect.h)

console.log('── 게시판은 복도에 있다 ──')
for (const b of BOARDS) {
  const room = roomOfCell(b.cell.x, b.cell.y)
  say(room === null && inHall(b.cell.x, b.cell.y), `${b.name} (${b.cell.x},${b.cell.y}) — 방=${room ?? '없음'}`)
}

console.log('\n── 자판기도 복도에 있다 ──')
for (const v of VENDINGS) {
  const room = roomOfCell(v.cell.x, v.cell.y)
  say(room === null && inHall(v.cell.x, v.cell.y), `${v.name} (${v.cell.x},${v.cell.y}) — 방=${room ?? '없음'}`)
}
/*
 * **게시판과 겹치면 안 된다.** 한 칸 옆까지가 「앞」이라, 둘이 가까우면
 * 한자리에 서서 둘 다 열리고 행동 칸이 두 개로 불어난다.
 */
for (const v of VENDINGS) {
  const near = BOARDS.find((b) => Math.abs(b.cell.x - v.cell.x) <= 2 && Math.abs(b.cell.y - v.cell.y) <= 2)
  say(near === undefined, `${v.name} 는 게시판과 떨어져 있다${near ? ` — ${near.name} 옆이다` : ''}`)
}

console.log('\n── 화분은 정원 안에 있다 ──')
for (const c of POT_CELLS) say(roomOfCell(c.x, c.y) === GARDEN_TILE, `화분 ${c.x},${c.y}`)
console.log(`  정원은 ${TILE_BY_ID[GARDEN_TILE]?.name ?? '?'}`)

/*
 * ── 기물이 길을 끊지 않았는가 ──────────────────────────────
 *
 * 게시판과 자판기를 밟을 수 없게 막았다. 복도가 세 칸 폭이라
 * 한 칸쯤 막혀도 지나갈 수 있어야 하는데, **한 칸 폭인 데가 하나라도
 * 있으면 그 자리에서 학교가 두 동강 난다.** 눈으로는 못 본다 —
 * 시작 칸에서 걸어서 스물다섯 방에 다 닿는지 세어 본다.
 */
console.log('\n── 기물을 막아도 스물다섯 방에 다 닿는다 ──')
{
  const start = TILES.find((t) => t.id === 'centralPlaza')!.plan
  const from = { x: start.x + Math.floor(start.w / 2), y: start.y + Math.floor(start.h / 2) }
  const seen = new Set<string>([`${from.x},${from.y}`])
  let edge = [from]
  while (edge.length > 0) {
    const next: { x: number; y: number }[] = []
    for (const c of edge) {
      // 계단은 칸이 아니라 문이다. 밟으면 짝 계단으로 건너뛴다
      const st = stairHere(c.x, c.y)
      const hops = st ? [{ x: st.toX, y: st.toY }] : []
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) hops.push({ x: c.x + dx, y: c.y + dy })
      for (const n of hops) {
        const k = `${n.x},${n.y}`
        if (seen.has(k) || !isWalkable(n.x, n.y)) continue
        seen.add(k)
        next.push(n)
      }
    }
    edge = next
  }
  const missed: TileId[] = []
  for (const t of TILES) {
    const r = t.plan
    let ok = false
    for (let y = r.y; y < r.y + r.h && !ok; y++) {
      for (let x = r.x; x < r.x + r.w && !ok; x++) if (seen.has(`${x},${y}`)) ok = true
    }
    if (!ok) missed.push(t.id)
  }
  say(missed.length === 0, `닿은 방 ${TILES.length - missed.length}/${TILES.length}${missed.length ? ` — 못 닿음: ${missed.map((m) => TILE_BY_ID[m].name).join(', ')}` : ''}`)
  // 기물 칸 자체는 못 밟아야 한다. 막았다고 적어 놓고 안 막히면 헛일이다
  for (const b of BOARDS) say(!isWalkable(b.cell.x, b.cell.y) && isFixture(b.cell.x, b.cell.y), `${b.name} 게시판은 못 밟는다`)
  for (const v of VENDINGS) say(!isWalkable(v.cell.x, v.cell.y) && isFixture(v.cell.x, v.cell.y), `${v.name} 자판기는 못 밟는다`)
  for (const [i, c] of POT_CELLS.entries()) say(!isWalkable(c.x, c.y) && isFixture(c.x, c.y), `화분 ${i + 1} 은 못 밟는다`)

  /*
   * **정원 안이 두 동강 나지 않았는가.** 10×8 에 화분 여덟과 가구
   * 여섯이 서면 밟을 칸이 절반이다. 문에서 들어가 정원의 밟을 수
   * 있는 칸에 다 닿는지, 화분마다 옆에 설 자리가 있는지 센다 — 설
   * 자리가 없는 화분은 아무도 못 딴다.
   */
  const g = TILES.find((t) => t.id === GARDEN_TILE)!.plan
  const inside = (x: number, y: number) => x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h
  const floor = new Set<string>()
  for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) if (isWalkable(x, y)) floor.add(`${x},${y}`)
  const reached = [...seen].filter((k) => floor.has(k))
  say(reached.length === floor.size, `정원의 밟을 칸 ${floor.size} 중 ${reached.length} 에 닿는다`)
  for (const [i, c] of POT_CELLS.entries()) {
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
      .map(([dx, dy]) => [c.x + dx, c.y + dy] as const)
      .filter(([x, y]) => inside(x, y) && floor.has(`${x},${y}`))
    say(spots.length > 0, `화분 ${i + 1} 옆에 설 자리 ${spots.length}`)
  }
}

console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}자리가 틀렸다.`)
process.exit(bad === 0 ? 0 : 1)
