// 맵 검사 — **빌드 때 돈다**(npm run build · check:map).
//
//   1. 서 있을 수 없는 칸이 서버에서도 막혀 있는가
//      화면(src/school/map/world.ts isWalkable)은 벽 · 가구 · 팻말 · 기물을 막는다.
//      서버(standAt)는 가구와 팻말을 모른다 — 그래서 가구 칸을 데이터 파일
//      (shared/rules/blocked.ts)로 뽑아 서버가 같이 본다. 둘이 어긋나면 실패.
//      문 칸은 지나가는 자리라 서버가 「설 곳」으로 안 받는다 — 어긋나도 된다.
//   2. 방 안의 고립된 칸 — 걸을 수 있는데 문에서 걸어서 닿지 못하는 칸
//   3. 시작 자리 열넷이 서로 다르고 걸을 수 있는가
//
//   npx vite-node scripts/check-map.ts          검사
//   npx vite-node scripts/check-map.ts --write  blocked.ts 를 다시 뽑는다(가구를 옮긴 뒤)
import { writeFileSync } from 'node:fs'

import { DOORS, ROOMS, isWalkable, lobbyCellFor, roomAt } from '../src/school/map/world'
import { PLAN_H, PLAN_W, canStandAt } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'
import { START_CELLS, STATIC_BLOCKED, isBlockedCell } from '../shared/rules/blocked'

const errors: string[] = []
const write = process.argv.includes('--write')

/** 서버 기준으로 설 수 있는 칸(가구 제외 전) */
const serverSpot = (x: number, y: number) => canStandAt(x, y) && !isFixture(x, y)

// ── 1. 가구 칸 — 화면은 막는데 서버가 받으면 안 된다 ──
const want: number[] = []
for (let y = 0; y < PLAN_H; y++) {
  for (let x = 0; x < PLAN_W; x++) {
    if (serverSpot(x, y) && !isWalkable(x, y)) want.push(y * PLAN_W + x)
  }
}
if (write) {
  const lines: string[] = []
  for (let i = 0; i < want.length; i += 16) lines.push(`  ${want.slice(i, i + 16).join(', ')},`)
  writeFileSync(
    new URL('../shared/rules/blocked.ts', import.meta.url),
    `// 서 있을 수 없는 칸 — 가구 · 팻말. **서버가 standAt 에서 본다.**
//
// 화면은 src/school/map/world.ts 가 가구 배치(furniture.ts)로 막는데, 서버는
// 그 그림 파일을 못 부른다. 그래서 막힌 칸만 뽑아 여기 적는다.
// scripts/check-map.ts --write 가 만든다. 빌드 때 check-map 이 화면과 같은지 본다 —
// 가구를 옮겼으면 다시 뽑는다. 벽 · 게시판 · 자판기 · 화분 같은 기물은
// 원래 서버가 알므로(board · fixtures) 여기 없다.
//
// 값은 칸 번호(y × PLAN_W + x).
import { PLAN_W } from './board'

export const STATIC_BLOCKED: ReadonlySet<number> = new Set([
${lines.join('\n')}
])

/**
 * 시작 자리 열넷 — 2-3 교실 안에 한 칸씩 띄운 칸. 자리 순서(seats)대로 준다.
 * 화면의 lobbyCellFor 와 같은 값이다(check-map 이 본다). 서버가 판을 시작할 때
 * 이 칸에 세운다 — 열넷이 한 칸에 겹치지 않게.
 */
export const START_CELLS: readonly { x: number; y: number }[] = [
${Array.from({ length: 14 }, (_, i) => lobbyCellFor(i)).map((c) => `  { x: ${c.x}, y: ${c.y} },`).join('\n')}
]

/** 가구 · 팻말이 선 칸인가 */
export const isBlockedCell = (x: number, y: number): boolean => STATIC_BLOCKED.has(y * PLAN_W + x)
`,
  )
  console.log(`막힌 칸 ${want.length}개를 shared/rules/blocked.ts 에 적었다.`)
  process.exit(0)
}

for (let y = 0; y < PLAN_H; y++) {
  for (let x = 0; x < PLAN_W; x++) {
    const onDoor = DOORS.some((d) => d.x === x && d.y === y)
    const server = serverSpot(x, y) && !isBlockedCell(x, y)
    const client = isWalkable(x, y)
    if (client && !server && !onDoor && canStandAt(x, y)) errors.push(`${x},${y}: 화면은 걷는데 서버가 막는다`)
    if (!client && server) errors.push(`${x},${y}: 서 있을 수 없는데 서버가 안 막는다(${roomAt(x, y)?.id ?? '복도'})`)
  }
}
if (STATIC_BLOCKED.size !== want.length) errors.push(`blocked.ts 가 낡았다 — ${STATIC_BLOCKED.size}칸, 지금 가구로는 ${want.length}칸`)

// ── 2. 방 안의 고립된 칸 ──
let isolated = 0
for (const room of ROOMS) {
  const inRoom = (x: number, y: number) => roomAt(x, y)?.id === room.id && isWalkable(x, y)
  const cells: string[] = []
  for (let y = 0; y < PLAN_H; y++) for (let x = 0; x < PLAN_W; x++) if (inRoom(x, y)) cells.push(`${x},${y}`)
  // 들어서는 자리: 문에 닿은 방 안 칸들. 문이 없으면(계단참 · 옥상) 첫 칸
  const starts: [number, number][] = []
  for (const d of DOORS) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inRoom(d.x + dx, d.y + dy)) starts.push([d.x + dx, d.y + dy])
    }
  }
  if (starts.length === 0 && cells[0]) starts.push(cells[0].split(',').map(Number) as [number, number])
  const seen = new Set(starts.map(([x, y]) => `${x},${y}`))
  let edge = [...starts]
  while (edge.length > 0) {
    const next: [number, number][] = []
    for (const [x, y] of edge) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`
        if (seen.has(k) || !inRoom(x + dx, y + dy)) continue
        seen.add(k)
        next.push([x + dx, y + dy])
      }
    }
    edge = next
  }
  const lost = cells.filter((k) => !seen.has(k))
  if (lost.length > 0) {
    isolated += lost.length
    errors.push(`${room.id}(${room.name}): 걸어서 못 닿는 칸 ${lost.length}개 — ${lost.slice(0, 6).join(' ')}`)
  }
}

// ── 3. 시작 자리 ──
const spots = Array.from({ length: 14 }, (_, i) => lobbyCellFor(i))
const keys = new Set(spots.map((c) => `${c.x},${c.y}`))
if (keys.size !== spots.length) errors.push(`시작 자리가 겹친다 — ${spots.length}명에 ${keys.size}칸`)
for (const c of spots) if (!isWalkable(c.x, c.y) || isBlockedCell(c.x, c.y)) errors.push(`시작 자리 ${c.x},${c.y} 에 설 수 없다`)
if (JSON.stringify(spots) !== JSON.stringify(START_CELLS)) errors.push('blocked.ts 의 시작 자리가 화면(lobbyCellFor)과 다르다 — --write 로 다시 뽑는다')

if (errors.length > 0) {
  for (const e of errors.slice(0, 60)) console.log(`  ✗ ${e}`)
  console.log(`\n맵 검사 ${errors.length}건 실패.`)
  process.exit(1)
}
console.log(`맵 — 막힌 칸 ${STATIC_BLOCKED.size}개가 화면과 서버에서 같다 · 방 ${ROOMS.length}개에 고립된 칸 ${isolated}개 · 시작 자리 ${keys.size}칸.`)
