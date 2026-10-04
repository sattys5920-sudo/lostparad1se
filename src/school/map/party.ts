// 기념사진 잔치 그림 — 현수막 천, 바닥 장식(색종이 · 가랜드 · 풍선 · 케이크 상 ·
// 선물), 마스코트 로봇 오투모. 플레이 화면(Walk)과 감독관 캡처 화면(PhotoShot)이
// 같은 그림을 쓴다.
import { PHOTO_GIFTS, PHOTO_TABLE } from '../../../shared/rules/photo'
import { TILE } from './world'

/** 잔치 색 — 현수막 · 가랜드 · 풍선 · 색종이가 같은 다섯 색을 돌려 쓴다 */
const PARTY = ['#ff8fab', '#ffd166', '#7fd8b2', '#8ec5ff', '#c3a6ff'] as const
const PARTY_LINE = '#5a3f4a'

/** 글자 그림 한 장(줄마다 문자열, 'x' 가 칠할 칸)을 찍는다 */
function stamp(g: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, color: string): void {
  g.fillStyle = color
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'x') g.fillRect(x + i, y + j, 1, 1)
  })
}
const HEART = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...']
const STAR = ['..x..', '.xxx.', 'xxxxx', '.xxx.', '.x.x.']

/**
 * 현수막 천 — 분홍 테에 땡땡이, 아래는 레이스, 양 끝에 리본 · 하트 · 별.
 * 폭은 칸 수로. **글자는 안 굽는다** — 논리 화소로 구운 글자는 키우면
 * 뭉개진다. 이름표처럼 위에 겹으로 얹는다
 */
const BANNER_BAKE = new Map<string, HTMLCanvasElement>()
export const BANNER_H = 24
export function bakeBanner(cells: number): HTMLCanvasElement {
  const key = String(cells)
  const hit = BANNER_BAKE.get(key)
  if (hit) return hit
  const w = cells * TILE
  const c = document.createElement('canvas')
  c.width = w
  c.height = BANNER_H
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const top = 3
  const h = 16
  // 매단 끈
  g.fillStyle = '#8a6a55'
  g.fillRect(4, 0, 1, top)
  g.fillRect(w - 5, 0, 1, top)
  // 아래 레이스 — 테 밑으로 반달이 줄지어 달린다
  for (let x = 1; x + 5 < w; x += 6) {
    g.fillStyle = '#e86a92'
    g.fillRect(x + 1, top + h, 4, 2)
    g.fillRect(x + 2, top + h + 2, 2, 1)
    g.fillStyle = '#ffd3e0'
    g.fillRect(x + 2, top + h, 2, 2)
  }
  // 천 · 테
  g.fillStyle = '#e86a92'
  g.fillRect(0, top, w, h)
  g.fillStyle = '#fff6f9'
  g.fillRect(1, top + 1, w - 2, h - 2)
  // 땡땡이
  g.fillStyle = '#ffe1ea'
  for (let y = top + 3, r = 0; y < top + h - 2; y += 4, r++) {
    for (let x = 4 + (r % 2) * 3; x < w - 3; x += 6) g.fillRect(x, y, 1, 1)
  }
  // 바느질 점선
  g.fillStyle = '#ffb0c6'
  for (let x = 3; x < w - 3; x += 2) {
    g.fillRect(x, top + 2, 1, 1)
    g.fillRect(x, top + h - 3, 1, 1)
  }
  // 양 끝 — 하트와 별
  for (const [hx, sx] of [[8, 18], [w - 15, w - 23]] as const) {
    stamp(g, HEART, hx, top + 5, '#ff5f8a')
    g.fillStyle = '#ffffff'
    g.fillRect(hx + 1, top + 6, 1, 1)
    stamp(g, STAR, sx, top + 6, '#f4b400')
  }
  // 끈 매듭 자리의 리본
  for (const bx of [4, w - 5]) {
    g.fillStyle = '#ff5f8a'
    g.fillRect(bx - 3, top - 1, 3, 3)
    g.fillRect(bx + 1, top - 1, 3, 3)
    g.fillRect(bx - 1, top + 2, 1, 2)
    g.fillRect(bx + 1, top + 2, 1, 2)
    g.fillStyle = '#c93a66'
    g.fillRect(bx, top, 1, 1)
  }
  BANNER_BAKE.set(key, c)
  return c
}

/** 같은 씨앗이면 같은 수열 — 색종이가 그릴 때마다 뛰지 않는다 */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 풍선 하나. (cx, top) 이 풍선 꼭대기 가운데, 줄은 floorY 까지 */
function balloon(g: CanvasRenderingContext2D, cx: number, top: number, floorY: number, color: string): void {
  const rows = [3, 5, 7, 7, 7, 5, 3]
  g.fillStyle = PARTY_LINE
  rows.forEach((n, j) => g.fillRect(cx - (n >> 1) - 1, top + j, n + 2, 1))
  g.fillRect(cx - 1, top - 1, 3, 1)
  g.fillRect(cx - 1, top + rows.length, 3, 1)
  g.fillStyle = color
  rows.forEach((n, j) => g.fillRect(cx - (n >> 1), top + j, n, 1))
  g.fillStyle = '#ffffff'
  g.fillRect(cx - 2, top + 2, 1, 2)
  // 매듭과 구불한 줄
  g.fillStyle = color
  g.fillRect(cx, top + rows.length, 1, 1)
  g.fillStyle = '#8a7a80'
  for (let y = top + rows.length + 1, i = 0; y < floorY; y++, i++) g.fillRect(cx + (i % 4 < 2 ? 0 : 1), y, 1, 1)
}

/**
 * 잔치 바닥 한 장 — 색종이 · 가랜드 · 네 구석 풍선 · 케이크 상 · 선물.
 * 방 둘레 한 칸까지 덮는다(풍선이 벽 위로 올라간다). 오투모는 사람과
 * 같이 앞뒤를 가려 그려야 해서 따로다
 */
const PARTY_BAKE = new Map<string, HTMLCanvasElement>()
export function bakeParty(room: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const key = `${room.x},${room.y},${room.w},${room.h}`
  const hit = PARTY_BAKE.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = (room.w + 2) * TILE
  c.height = (room.h + 2) * TILE
  const g = c.getContext('2d') as CanvasRenderingContext2D
  // 방 왼쪽 위 바닥 칸이 (TILE, TILE)
  const X = (cx: number) => (cx - room.x + 1) * TILE
  const Y = (cy: number) => (cy - room.y + 1) * TILE
  const fx0 = X(room.x)
  const fy0 = Y(room.y)
  const fw = room.w * TILE
  const fh = room.h * TILE

  // 색종이
  const rnd = seeded(23)
  for (let i = 0; i < room.w * room.h * 1.3; i++) {
    const x = fx0 + 1 + Math.floor(rnd() * (fw - 2))
    const y = fy0 + 6 + Math.floor(rnd() * (fh - 8))
    g.fillStyle = PARTY[Math.floor(rnd() * PARTY.length)]
    const r = rnd()
    g.fillRect(x, y, r < 0.4 ? 2 : 1, r > 0.7 ? 2 : 1)
  }

  // 가랜드 — 방 윗줄을 세 번 늘어진다
  const swags = 3
  const y0 = fy0 + 4
  for (let s = 0; s < swags; s++) {
    const ax = fx0 + Math.round((fw * s) / swags)
    const bx = fx0 + Math.round((fw * (s + 1)) / swags)
    g.fillStyle = '#8a6a55'
    for (let x = ax; x < bx; x++) g.fillRect(x, y0 + Math.round(5 * Math.sin((Math.PI * (x - ax)) / (bx - ax))), 1, 1)
    let n = 0
    for (let x = ax + 4; x + 4 < bx; x += 8, n++) {
      const sy = y0 + Math.round(5 * Math.sin((Math.PI * (x + 2 - ax)) / (bx - ax))) + 1
      g.fillStyle = PARTY[(s * 3 + n) % PARTY.length]
      ;[5, 5, 3, 3, 1].forEach((wd, j) => g.fillRect(x + ((5 - wd) >> 1), sy + j, wd, 1))
    }
  }

  // 네 구석 풍선 — 셋씩. 위 둘은 한 줄 내려 단다 — 맨 윗줄이면 현수막 뒤로 숨는다.
  // 셋이 한 칸 안에 들어간다 — 넘치면 화면 가장자리에서 잘린다
  const corners: [number, number][] = [
    [room.x, room.y + 1],
    [room.x + room.w - 2, room.y + 1],
    [room.x, room.y + room.h - 1],
    [room.x + room.w - 2, room.y + room.h - 1],
  ]
  corners.forEach(([cx, cy], k) => {
    const ax = X(cx) + TILE / 2
    const floorY = Y(cy) + TILE - 2
    const tops = [floorY - 30, floorY - 25, floorY - 34]
    ;[-4, 3, 0].forEach((dx, j) => balloon(g, ax + dx, tops[j], floorY, PARTY[(k * 2 + j) % PARTY.length]))
    g.fillStyle = PARTY_LINE
    g.fillRect(ax - 1, floorY - 1, 3, 2)
  })

  // 케이크 상 — 두 칸
  {
    const t0 = PHOTO_TABLE[0]
    const x0 = X(t0.x)
    const yy = Y(t0.y)
    const w = PHOTO_TABLE.length * TILE
    g.fillStyle = 'rgba(0,0,0,0.18)'
    g.fillRect(x0 + 2, yy + 14, w - 4, 2)
    g.fillStyle = PARTY_LINE
    g.fillRect(x0 + 1, yy + 2, w - 2, 13)
    g.fillStyle = '#fffaf2'
    g.fillRect(x0 + 2, yy + 3, w - 4, 4)
    // 치마 — 분홍 주름
    g.fillStyle = '#ffc2d1'
    g.fillRect(x0 + 2, yy + 7, w - 4, 7)
    g.fillStyle = '#ff9fb9'
    for (let x = x0 + 3; x < x0 + w - 2; x += 3) g.fillRect(x, yy + 8, 1, 6)
    // 케이크 두 층
    const kx = x0 + 4
    g.fillStyle = PARTY_LINE
    g.fillRect(kx - 1, yy - 7, 14, 11)
    g.fillStyle = '#fff1e2'
    g.fillRect(kx, yy - 2, 12, 5)
    g.fillStyle = '#ff8fab'
    g.fillRect(kx, yy - 2, 12, 1)
    for (let x = kx; x < kx + 12; x += 3) g.fillRect(x, yy - 1, 1, 1)
    g.fillStyle = PARTY_LINE
    g.fillRect(kx + 1, yy - 7, 10, 5)
    g.fillStyle = '#fff1e2'
    g.fillRect(kx + 2, yy - 6, 8, 4)
    g.fillStyle = '#ff8fab'
    g.fillRect(kx + 2, yy - 6, 8, 1)
    g.fillStyle = '#e8364f'
    g.fillRect(kx + 3, yy - 4, 1, 1)
    g.fillRect(kx + 8, yy - 4, 1, 1)
    // 초 셋
    ;[3, 6, 9].forEach((dx, j) => {
      g.fillStyle = PARTY[j + 2]
      g.fillRect(kx + dx - 1 + 1, yy - 10, 1, 3)
      g.fillStyle = '#ffb02e'
      g.fillRect(kx + dx, yy - 12, 1, 2)
    })
    // 컵 둘
    ;[x0 + w - 11, x0 + w - 6].forEach((cx, j) => {
      g.fillStyle = PARTY_LINE
      g.fillRect(cx - 1, yy - 3, 5, 7)
      g.fillStyle = j === 0 ? '#ffd166' : '#8ec5ff'
      g.fillRect(cx, yy - 2, 3, 5)
      g.fillStyle = '#ffffff'
      g.fillRect(cx, yy - 2, 3, 1)
    })
  }

  // 선물 상자 — 큰 것 위에 작은 것
  {
    const x0 = X(PHOTO_GIFTS.x) + 2
    const yy = Y(PHOTO_GIFTS.y)
    g.fillStyle = 'rgba(0,0,0,0.18)'
    g.fillRect(x0, yy + 14, 12, 2)
    g.fillStyle = PARTY_LINE
    g.fillRect(x0, yy + 4, 12, 11)
    g.fillStyle = '#7fd8b2'
    g.fillRect(x0 + 1, yy + 5, 10, 9)
    g.fillStyle = '#ff5f8a'
    g.fillRect(x0 + 5, yy + 5, 2, 9)
    g.fillRect(x0 + 1, yy + 8, 10, 2)
    g.fillStyle = PARTY_LINE
    g.fillRect(x0 + 2, yy - 2, 8, 7)
    g.fillStyle = '#ffd166'
    g.fillRect(x0 + 3, yy - 1, 6, 5)
    g.fillStyle = '#8ec5ff'
    g.fillRect(x0 + 5, yy - 1, 2, 5)
    // 나비 리본
    g.fillStyle = '#8ec5ff'
    g.fillRect(x0 + 3, yy - 4, 2, 2)
    g.fillRect(x0 + 7, yy - 4, 2, 2)
    g.fillStyle = '#4f7fc4'
    g.fillRect(x0 + 5, yy - 3, 2, 1)
  }

  PARTY_BAKE.set(key, c)
  return c
}

/**
 * 오투모 — 2-3 교실 잔치의 마스코트 로봇. 고깔모자를 쓰고, 화면 얼굴에
 * 웃는 눈, 한 손을 흔든다. (cx, cy) 는 선 칸의 한가운데 — 사람과 같은 자리 잡기
 */
export function drawOtumo(g: CanvasRenderingContext2D, cx: number, cy: number, now: number): void {
  const L = Math.round(cx - 8)
  const T = Math.round(cy + 4 - 24)
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c
    g.fillRect(L + x, T + y, w, h)
  }
  const O = '#2b2f3a'
  // 그림자
  r(3, 23, 10, 1, 'rgba(0,0,0,0.25)')
  // 고깔모자 — 위로 갈수록 좁고, 줄무늬에 꼭대기 방울
  ;[2, 2, 4, 4, 6].forEach((w, j) => {
    r(8 - w / 2 - 1, 1 + j, w + 2, 1, O)
    r(8 - w / 2, 1 + j, w, 1, j === 2 || j === 4 ? '#ffd166' : '#ff5f8a')
  })
  r(7, 0, 2, 1, '#fff3b0')
  // 머리
  r(1, 6, 14, 10, O)
  r(2, 7, 12, 8, '#eef2f7')
  r(2, 14, 12, 1, '#cdd6e2')
  r(0, 9, 1, 3, '#9aa6b8')
  r(15, 9, 1, 3, '#9aa6b8')
  // 화면 얼굴 — ^ ^ 눈, 볼, 웃는 입
  r(3, 8, 10, 6, '#2d3550')
  const E = '#7ff0ff'
  r(5, 9, 1, 1, E)
  r(4, 10, 1, 1, E)
  r(6, 10, 1, 1, E)
  r(10, 9, 1, 1, E)
  r(9, 10, 1, 1, E)
  r(11, 10, 1, 1, E)
  r(3, 11, 2, 1, '#ff8fab')
  r(11, 11, 2, 1, '#ff8fab')
  r(6, 12, 1, 1, E)
  r(9, 12, 1, 1, E)
  r(7, 13, 2, 1, E)
  // 몸
  r(3, 16, 10, 6, O)
  r(4, 17, 8, 4, '#eef2f7')
  r(6, 18, 4, 2, '#2d3550')
  r(6, 18, 1, 1, '#ff8fab')
  r(7, 18, 1, 1, '#ffd166')
  r(8, 19, 1, 1, '#7fd8b2')
  r(9, 19, 1, 1, '#8ec5ff')
  // 팔 — 왼팔은 내리고, 오른팔은 흔든다
  r(1, 17, 2, 3, O)
  r(1, 17, 1, 2, '#cdd6e2')
  const up = Math.floor(now / 400) % 2 === 0
  if (up) {
    r(13, 12, 3, 5, O)
    r(14, 12, 1, 4, '#cdd6e2')
    r(13, 11, 3, 2, '#9aa6b8')
  } else {
    r(13, 14, 3, 4, O)
    r(14, 14, 1, 3, '#cdd6e2')
    r(14, 13, 2, 2, '#9aa6b8')
  }
  // 바퀴 발
  r(4, 22, 3, 2, O)
  r(9, 22, 3, 2, O)
}
