// 게시판과 화분 자리가 진짜 거기 있는가. **눈이 아니라 지도에 물어본다.**
//
//   npx vite-node scripts/spot-check.ts
import { BOARDS } from '../shared/rules/errand'
import { GARDEN_TILE, POT_CELLS, SEED_BOX_CELL } from '../shared/rules/crop'
import { HALLS, TILE_BY_ID, roomOfCell } from '../shared/rules/board'

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

console.log('\n── 화분은 정원 안에 있다 ──')
for (const c of POT_CELLS) say(roomOfCell(c.x, c.y) === GARDEN_TILE, `화분 ${c.x},${c.y}`)
say(roomOfCell(SEED_BOX_CELL.x, SEED_BOX_CELL.y) === GARDEN_TILE, `씨앗 상자 ${SEED_BOX_CELL.x},${SEED_BOX_CELL.y}`)
console.log(`  정원은 ${TILE_BY_ID[GARDEN_TILE]?.name ?? '?'}`)

console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}자리가 틀렸다.`)
process.exit(bad === 0 ? 0 : 1)
