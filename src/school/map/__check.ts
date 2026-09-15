// 방마다 무엇이 몇 개 놓였는지 세어 본다. 눈으로 훑는 용도다.
//
//   npx vite-node src/school/map/__check.ts
import { DOORS, isWalkable, markAt, propAt, ROOMS, signAt } from './world'
import { propTiles } from './props'
import { signTiles } from './signs'

let props = 0
let marks = 0
const perRoom = new Map<string, Map<string, number>>()
for (const room of ROOMS) {
  const tally = new Map<string, number>()
  for (const r of room.rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = propAt(x, y)
        const m = markAt(x, y)
        // 두 칸짜리는 왼쪽 위 조각에서만 센다 — 한 개는 한 개다
        if (p && p.ox === 0 && p.oy === 0) {
          props++
          const size = propTiles(p.kind)
          const label = size.w * size.h > 1 ? `${p.kind}(${size.w}×${size.h})` : p.kind
          tally.set(label, (tally.get(label) ?? 0) + 1)
        }
        if (m) {
          marks++
          tally.set(`·${m}`, (tally.get(`·${m}`) ?? 0) + 1)
        }
      }
    }
  }
  tally.set(`[팻말 ${signTiles(room.name)}칸]`, 1)
  perRoom.set(room.name, tally)
}
const signCells = ROOMS.reduce((n, r) => {
  let c = 0
  for (const rect of r.rects) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) if (signAt(x, y)) c++
    }
  }
  return n + c
}, 0)
console.log(
  `가구 ${props}개 · 흔적 ${marks}개 · 팻말 ${signCells}칸 · 막힌 문 ${DOORS.filter((d) => !isWalkable(d.x, d.y)).length}`,
)
for (const [name, tally] of perRoom) {
  const parts = [...tally.entries()].map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ')
  console.log(`  ${name.padEnd(7)} ${parts}`)
}
