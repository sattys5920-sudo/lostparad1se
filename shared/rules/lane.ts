// 문 앞 길 — 문에서 방 한가운데까지 ㄱ 자로 그은 길(세 칸 폭).
//
// 두 군데가 쓴다. 가구를 깔 때(map/world) 이 길 위에는 아무것도 안 놓고,
// 방에 들어온 사람을 세울 때(rules/seat) 이 길 위에는 **먼저 안 세운다** —
// 들어온 사람들이 문 앞에 뭉쳐 서면 방 안 사람이 못 나간다(문은 한 칸이다).
// 화면과 서버가 같은 길을 보도록 여기 한 벌만 둔다.

/** 문 하나의 길 칸들("x,y"). r 은 그 문이 난 방의 네모 */
export function laneCells(door: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): string[] {
  const out: string[] = []
  const cx = r.x + Math.floor(r.w / 2)
  const cy = r.y + Math.floor(r.h / 2)
  // 문에서 방 안으로 한 칸 들어온 자리
  let x = Math.min(Math.max(door.x, r.x), r.x + r.w - 1)
  let y = Math.min(Math.max(door.y, r.y), r.y + r.h - 1)
  const mark = (px: number, py: number) => {
    for (let ox = -1; ox <= 1; ox++) out.push(`${px + ox},${py}`)
    for (let oy = -1; oy <= 1; oy++) out.push(`${px},${py + oy}`)
  }
  mark(door.x, door.y)
  while (y !== cy) {
    y += y < cy ? 1 : -1
    mark(x, y)
  }
  while (x !== cx) {
    x += x < cx ? 1 : -1
    mark(x, y)
  }
  return out
}
