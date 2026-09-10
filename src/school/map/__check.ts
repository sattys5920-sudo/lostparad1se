import { DOORS, isWalkable, markAt, propAt, ROOMS, TILE } from './world'

void TILE
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
        if (p) {
          props++
          tally.set(p, (tally.get(p) ?? 0) + 1)
        }
        if (m) {
          marks++
          tally.set(`·${m}`, (tally.get(`·${m}`) ?? 0) + 1)
        }
      }
    }
  }
  perRoom.set(room.name, tally)
}
console.log(`가구 ${props}개 · 흔적 ${marks}개 · 막힌 문 ${DOORS.filter((d) => !isWalkable(d.x, d.y)).length}`)
for (const [name, tally] of perRoom) {
  const parts = [...tally.entries()].map(([k, v]) => `${k}×${v}`).join(' ')
  console.log(`  ${name.padEnd(6)} ${parts || '(빈방)'}`)
}
