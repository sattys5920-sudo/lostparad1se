// 캐릭터 크기 시안.
//
// 지금 스프라이트는 32×32이고 바닥 한 칸은 16×16이다 — **사람이 두 칸
// 키다.** 방 안에 서 있으면 방보다 사람이 먼저 보인다.
//
// 두 가지를 따로 보여 준다. 섞으면 무엇 때문에 작아 보이는지 모른다.
//
//   가. 사람만 줄인다 — 방은 그대로, 사람이 방에서 차지하는 몫이 준다
//   나. 보이는 넓이를 늘린다 — 사람도 방도 같이 작아진다
//
// 32→16은 정확히 절반이라 도트가 안 뭉갠다. 24·20은 나누어떨어지지
// 않아서 어떤 줄은 굵고 어떤 줄은 가늘어진다. 그 차이도 같이 보인다.
import {
  doorIsHorizontal,
  drawPiece,
  MAP_H,
  MAP_W,
  markAt,
  propAt,
  ROOMS,
  signAt,
  TILE,
  tileAt,
} from '../school/map/world'
import { signSheet } from '../school/map/signs'
import { PAL, buildSprites } from '../school/map/sprites'
import { pixelFrame } from '../school/char/pixel'
import { TILE_BY_ID } from '../../shared/rules/board'
import type { AvatarLook, TileId } from '../school/types'
import '../school/theme.css'
import './size.css'

/** 시안에 세울 사람. 게임에서 만드는 것과 같은 조합이다. */
const LOOK: AvatarLook = {
  styleSet: 'F',
  hairStyle: 'F03',
  hairColor: 2,
  expression: 3,
  outfit: 2,
  wearStyle: 1,
  bottom: 1,
  neckwear: 1,
}

/** 어디를 보여 줄까. 가구와 벽이 같이 보이는 자리라야 크기가 가늠된다. */
const AT = { x: 6, y: 44 }

const sprites = buildSprites()

/** 폰 한 대. 방 화면 자리가 이만큼이다(375×463). */
const SCREEN_W = 375
const SCREEN_H = 463

/**
 * 한 장. **진짜 폰 화면 크기 그대로 그린다.**
 *
 * 크기가 제각각이면 무엇이 큰지 작은지 가늠이 안 된다. 폰은 늘 같은
 * 크기니까 시안도 같은 크기라야 고를 수 있다.
 *
 * @param scale  도트 배율. 화면은 정수 배율만 쓴다 — 3배는 바짝,
 *               1배는 멀찍이. 지금은 2배다
 * @param charPx 사람을 몇 화소로 그릴까. 32가 지금이다
 */
function panel(scale: number, charPx: number): HTMLCanvasElement {
  const view = Math.floor(SCREEN_W / scale)
  const viewH = Math.floor(SCREEN_H / scale)
  const c = document.createElement('canvas')
  c.width = view
  c.height = viewH
  c.style.width = `${SCREEN_W}px`
  c.style.height = `${SCREEN_H}px`
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingEnabled = false

  const w = c.width
  const h = c.height
  const px = AT.x * TILE + TILE / 2
  const py = AT.y * TILE + TILE / 2
  const camX = Math.round(Math.max(0, Math.min(MAP_W * TILE - w, px - w / 2)))
  const camY = Math.round(Math.max(0, Math.min(MAP_H * TILE - h, py - h / 2)))

  ctx.fillStyle = PAL.ink
  ctx.fillRect(0, 0, w, h)

  const x0 = Math.max(0, Math.floor(camX / TILE))
  const y0 = Math.max(0, Math.floor(camY / TILE))
  const x1 = Math.min(MAP_W - 1, Math.ceil((camX + w) / TILE))
  const y1 = Math.min(MAP_H - 1, Math.ceil((camY + h) / TILE))

  const plates = signSheet()
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const kind = tileAt(x, y)
      let img: CanvasImageSource | null
      if (kind === 'wall') {
        img = tileAt(x, y - 1) === 'wall' ? sprites.tiles.wallBody : sprites.tiles.wall
      } else if (kind === 'door') {
        img = doorIsHorizontal(x, y) ? sprites.tiles.doorH : sprites.tiles.doorV
      } else {
        img = sprites.tiles.floorRoom
      }
      if (img) ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
      const mark = markAt(x, y)
      if (mark) ctx.drawImage(sprites.marks[mark], x * TILE - camX, y * TILE - camY)
      const prop = propAt(x, y)
      if (prop) drawPiece(ctx, sprites.props[prop.kind], prop.ox, prop.oy, x * TILE - camX, y * TILE - camY)
      const sign = signAt(x, y)
      if (sign) drawPiece(ctx, plates[sign.id], sign.ox, 0, x * TILE - camX, y * TILE - camY)
    }
  }

  ctx.font = '7px "Gothic A1", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const r of ROOMS) {
    const rect = r.rects[0]
    ctx.fillStyle = PAL.mid
    ctx.fillText(
      TILE_BY_ID[r.id as TileId].name,
      Math.round((rect.x + rect.w / 2) * TILE - camX),
      Math.round((rect.y + 0.3) * TILE - camY),
    )
  }

  // 사람. 발끝을 칸 바닥에 맞춘다 — 크기가 달라져도 서 있는 자리는 같다
  const img = pixelFrame(LOOK, 'D', 'down', 0)
  const k = charPx / img.width
  const dw = Math.round(img.width * k)
  const dh = Math.round(img.height * k)
  ctx.drawImage(img, Math.round(px - camX - dw / 2), Math.round(py - camY - dh + Math.round(6 * k)), dw, dh)
  return c
}

function strip(title: string, note: string, items: { label: string; c: HTMLCanvasElement }[]): HTMLElement {
  const box = document.createElement('section')
  box.className = 'sz__strip'
  const h = document.createElement('h2')
  h.textContent = title
  const p = document.createElement('p')
  p.textContent = note
  const row = document.createElement('div')
  row.className = 'sz__row'
  for (const it of items) {
    const cell = document.createElement('figure')
    cell.className = 'sz__cell'
    cell.append(it.c)
    const cap = document.createElement('figcaption')
    cap.textContent = it.label
    cell.append(cap)
    row.append(cell)
  }
  box.append(h, p, row)
  return box
}

const root = document.getElementById('root') as HTMLElement
const head = document.createElement('header')
head.className = 'sz__head'
head.innerHTML =
  '<h1>캐릭터 크기 시안</h1>' +
  '<p>바닥 한 칸은 16화소다. 지금 사람은 32화소 — <b>두 칸 키</b>다.</p>'
root.append(head)

root.append(
  strip(
    '가. 사람만 줄인다',
    '배율은 지금 그대로(2배). 방이 보이는 넓이도 그대로고, 사람만 작아진다.',
    [
      { label: '32 · 두 칸 (지금)', c: panel(2, 32) },
      { label: '24 · 한 칸 반', c: panel(2, 24) },
      { label: '20 · 도트 뭉갬', c: panel(2, 20) },
      { label: '16 · 한 칸 (정확히 절반)', c: panel(2, 16) },
    ],
  ),
)

root.append(
  strip(
    '나. 배율을 바꾼다',
    '사람은 32화소 그대로. 화면은 정수 배율만 쓰므로 폰에서 고를 수 있는 것은 사실상 이 셋뿐이다. 멀리 볼수록 사람도 방도 같이 작아진다.',
    [
      { label: '3배 · 바짝', c: panel(3, 32) },
      { label: '2배 (지금)', c: panel(2, 32) },
      { label: '1배 · 멀찍이', c: panel(1, 32) },
    ],
  ),
)

root.append(
  strip(
    '다. 섞어 본 것',
    '왼쪽이 지금. 오른쪽으로 갈수록 사람이 방에서 차지하는 몫이 준다.',
    [
      { label: '2배 · 32 (지금)', c: panel(2, 32) },
      { label: '2배 · 24', c: panel(2, 24) },
      { label: '2배 · 16', c: panel(2, 16) },
      { label: '1배 · 24', c: panel(1, 24) },
    ],
  ),
)
