// 투표함과 접히는 종이의 도트 그림.
//
// 둘 다 **캔버스에 한 번 굽고 데이터 URL 로 들고 있는다.** 파일을 따로
// 싣지 않으므로 이미지 요청이 늘지 않는다 — 접히는 장면은 프레임이
// 넷이라 파일로 두면 요청이 넷 는다.
//
// 종이가 접히는 것을 CSS 회전으로 하면 도트가 뭉갠다. 45도로 돌린
// 한 화소는 어느 화소에도 딱 안 맞아서 가장자리가 흐려진다. 그래서
// **접힌 모양을 미리 그려 두고 갈아 끼운다** — 스프라이트 시트 한 장에
// 네 장을 나란히 굽고, 배경 위치만 옮긴다.
//
// 1 배로 굽고 화면에서 정확히 2 배로 늘린다. 종이 아홉 조각과 같은
// 방식이다.

import { PAPER, stampSlice } from './paperArt'

/** 투표함 색. 어두운 금속. */
export const BOX = {
  metal: '#2C3348',
  edge: '#3E4762',
  lip: '#4A5573',
  slot: '#0C0F18',
  dark: '#232939',
  lock: '#8A8371',
  lockLit: '#B7AE96',
} as const

/**
 * 투표함 높이(1 배). 가로는 **접힌 종이에 맞춰 그때그때 정한다** —
 * 통이 들어갈 종이보다 좁으면 종이가 통을 뚫고 들어가는 그림이 된다.
 */
export const BOX_H = 72

/** 투입구 한가운데의 세로 자리(1 배). 종이가 여기로 들어간다. */
export const SLOT_Y = 6

/** 접힌 종이 가로가 w 일 때 투표함 가로. 양옆으로 13 화소씩 남긴다. */
export const boxWidthFor = (slipW: number): number => slipW + 26

/** 스프라이트 시트에 든 접힘 프레임 수. 앞의 두 장은 진짜 종이가 맡는다. */
export const FOLD_FRAMES = 4

function mk(w: number, h: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas.getContext('2d')
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0 || h <= 0) return
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

// ── 투표함 ───────────────────────────────────────────────────

function drawBox(ctx: CanvasRenderingContext2D, kind: 'open' | 'shut' | 'lock', w: number): void {
  const h = BOX_H

  // 뚜껑. **몸통보다 넓다** — 좁으면 통에 얹은 판이 아니라 파인 홈이 된다
  box(ctx, 0, 0, w, 13, BOX.lip)
  box(ctx, 0, 0, w, 1, BOX.edge)
  box(ctx, 0, 12, w, 1, BOX.edge)

  // 투입구. 열려 있으면 검은 틈, 닫혀 있으면 메운 자국 한 줄
  const sx = 8
  const sw = w - 16
  if (kind === 'open') {
    box(ctx, sx, SLOT_Y - 2, sw, 1, BOX.dark)
    box(ctx, sx, SLOT_Y - 1, sw, 4, BOX.slot)
  } else {
    box(ctx, sx, SLOT_Y, sw, 2, BOX.dark)
  }

  // 몸통
  box(ctx, 3, 13, w - 6, h - 15, BOX.metal)
  box(ctx, 3, 13, w - 6, 1, BOX.edge)
  box(ctx, 3, h - 3, w - 6, 1, BOX.edge)
  box(ctx, 3, 13, 1, h - 15, BOX.edge)
  box(ctx, w - 4, 13, 1, h - 15, BOX.edge)
  // 왼쪽에 빛 한 줄. 이게 없으면 그냥 검은 네모다
  box(ctx, 4, 14, 1, h - 17, BOX.lip)

  // 이어 붙인 자국 둘 + 못. 띠를 두껍게 하면 서랍장이 된다
  for (const y of [30, 50]) {
    box(ctx, 4, y, w - 8, 1, BOX.dark)
    box(ctx, 7, y - 1, 1, 1, BOX.lip)
    box(ctx, w - 8, y - 1, 1, 1, BOX.lip)
  }

  // 발 둘
  box(ctx, 8, h - 2, 7, 2, BOX.dark)
  box(ctx, w - 15, h - 2, 7, 2, BOX.dark)

  if (kind !== 'lock') return

  // 자물쇠. 몸통 한가운데에 건다
  const lx = Math.round(w / 2) - 5
  box(ctx, lx, 38, 10, 9, BOX.lock)
  box(ctx, lx, 38, 10, 1, BOX.lockLit)
  box(ctx, lx + 4, 41, 2, 4, BOX.dark)
  box(ctx, lx + 2, 33, 1, 5, BOX.lock)
  box(ctx, lx + 7, 33, 1, 5, BOX.lock)
  box(ctx, lx + 3, 32, 4, 1, BOX.lock)
}

const boxes = new Map<string, string>()

/** 투표함 한 장. 열린 것 · 닫힌 것 · 잠긴 것. */
export function boxSprite(kind: 'open' | 'shut' | 'lock', w: number): string {
  const key = `${kind}:${w}`
  const has = boxes.get(key)
  if (has) return has
  const ctx = mk(w, BOX_H)
  if (!ctx) return ''
  drawBox(ctx, kind, w)
  const url = ctx.canvas.toDataURL()
  boxes.set(key, url)
  return url
}

// ── 접히는 종이 ──────────────────────────────────────────────

/**
 * 종이 한 겹. 위와 왼쪽은 빛을 받고 아래와 오른쪽은 그늘이다.
 *
 * 접힌 면(crease)에는 자국을 두 줄 긋는다 — 한 줄은 꺾인 선이고,
 * 한 줄은 그 아래로 비치는 두 번째 겹이다. 한 줄만 그으면 종이가
 * 접힌 것이 아니라 잘린 것처럼 보인다.
 */
function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  crease: { right?: boolean; bottom?: boolean },
): void {
  box(ctx, x, y, w, h, PAPER.base)
  box(ctx, x, y, w, 1, PAPER.light)
  box(ctx, x, y, 1, h, PAPER.light)
  box(ctx, x, y + h - 1, w, 1, PAPER.dark)
  box(ctx, x + w - 1, y, 1, h, PAPER.dark)
  // 원래 종이의 모서리는 접혀도 그대로 남는다. 왼쪽 위는 언제나,
  // 왼쪽 아래는 아직 접히지 않았을 때만
  stampSlice(ctx, 'TL', x, y)
  if (!crease.bottom) stampSlice(ctx, 'BL', x, y + h - 28)
  if (crease.right) {
    box(ctx, x + w - 2, y, 2, h, PAPER.fold)
    box(ctx, x + w - 3, y, 1, h, PAPER.dark)
  }
  if (crease.bottom) {
    box(ctx, x, y + h - 2, w, 2, PAPER.fold)
    box(ctx, x, y + h - 3, w, 1, PAPER.dark)
  }
}

const sheets = new Map<string, string>()

/**
 * 접히는 네 장을 한 줄로 굽는다. 칸 하나는 종이를 다 편 크기다.
 *
 * 접힌 종이는 늘 **칸의 왼쪽 위**에 붙어 있다. 오른쪽 절반이 왼쪽으로
 * 넘어오고, 아래 절반이 위로 넘어오기 때문이다. 화면에서 날아가는
 * 조각을 오려낼 때 이 약속을 그대로 쓴다.
 *
 * @param w 편 종이의 가로(1 배 화소)
 * @param h 편 종이의 세로(1 배 화소)
 */
export function foldSheet(w: number, h: number): string {
  const key = `${w}x${h}`
  const has = sheets.get(key)
  if (has) return has
  const ctx = mk(w * FOLD_FRAMES, h)
  if (!ctx) return ''

  const hw = Math.ceil(w / 2)
  const hh = Math.ceil(h / 2)
  const midH = Math.round(h * 0.78)

  // 0 · 세로로 한 번 접혔다. 오른쪽 끝이 접힌 자국이다
  leaf(ctx, 0, 0, hw, h, { right: true })

  // 1 · 아래 절반이 들렸다. 들린 면은 뒷장이라 밝다
  leaf(ctx, w, 0, hw, hh, { right: true })
  box(ctx, w, hh, hw, midH - hh, PAPER.light)
  box(ctx, w, midH - 1, hw, 1, PAPER.dark)
  box(ctx, w + hw - 1, hh, 1, midH - hh, PAPER.dark)
  box(ctx, w, hh - 1, hw, 1, PAPER.fold)

  // 2 · 다 접혔다. 아래 끝이 두 번째 접힌 자국이다
  leaf(ctx, w * 2, 0, hw, hh, { right: true, bottom: true })

  // 3 · 자리를 잡았다. 겹친 면이 한 겹 더 비친다
  leaf(ctx, w * 3, 0, hw, hh, { right: true, bottom: true })
  box(ctx, w * 3 + 1, 1, hw - 4, 1, PAPER.dark)
  box(ctx, w * 3 + 1, 2, 1, hh - 5, PAPER.dark)

  const url = ctx.canvas.toDataURL()
  sheets.set(key, url)
  return url
}
