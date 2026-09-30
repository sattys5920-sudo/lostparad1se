// 아바타 부품 목록. 게임에서 쓰지 않는 개발용 한 장이다 — 고를 수 있는 것을 전부 편다.
import { HAIR_COLORS } from '../school/char/palette'
import {
  EXPRESSIONS,
  HAIR_BY_ID,
  HAIR_IDS_F,
  HAIR_IDS_M,
  NECKWEAR_NAMES,
  OUTFITS,
  WEAR_STYLE_NAMES,
  pixelFrame,
  type Dir,
} from '../school/char/pixel'
import type { AvatarLook } from '../../shared/look'

const out = document.getElementById('out') as HTMLDivElement
const base = (o: Partial<AvatarLook> = {}): AvatarLook => ({
  styleSet: 'F', hairStyle: 'F20', hairColor: 1, expression: 0, outfit: 1, wearStyle: 1, bottom: 0, neckwear: 0, ...o,
})

function sprite(look: AvatarLook, dir: Dir, Z = 3): HTMLCanvasElement {
  const src = pixelFrame(look, null, dir, 0)
  const c = document.createElement('canvas')
  c.width = src.width * Z
  c.height = src.height * Z
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

function section(id: string, title: string, note: string, cards: { look: AvatarLook; cap: string; sub?: string; swatch?: string; dirs?: Dir[] }[], zoom = 3) {
  const s = document.createElement('section')
  s.id = id
  s.innerHTML = `<h2>${title}<span>${note}</span></h2>`
  const row = document.createElement('div')
  row.className = 'row'
  for (const c of cards) {
    const card = document.createElement('div')
    card.className = 'card'
    const pair = document.createElement('div')
    pair.className = 'pair'
    for (const d of c.dirs ?? ['down']) pair.appendChild(sprite(c.look, d, zoom))
    card.appendChild(pair)
    if (c.swatch) {
      const sw = document.createElement('div')
      sw.className = 'swatch'
      sw.style.background = c.swatch
      card.appendChild(sw)
    }
    card.insertAdjacentHTML('beforeend', `<div class="cap">${c.cap}</div>${c.sub ? `<div class="id">${c.sub}</div>` : ''}`)
    row.appendChild(card)
  }
  s.appendChild(row)
  out.appendChild(s)
}

const hairCards = (ids: string[], set: 'F' | 'M') =>
  ids.map((id) => ({
    look: base({ styleSet: set, hairStyle: id, bottom: set === 'F' ? 1 : 0 }),
    cap: HAIR_BY_ID[id].name,
    sub: id,
    dirs: ['down', 'up'] as Dir[],
  }))

out.insertAdjacentHTML('beforeend', '<h1>아바타 부품 목록</h1>')
section('hairF', '머리 모양 — 여자 목록', `${HAIR_IDS_F.length}종 · 앞/뒤`, hairCards(HAIR_IDS_F, 'F'))
section('hairM', '머리 모양 — 남자 목록', `${HAIR_IDS_M.length}종 · 앞/뒤`, hairCards(HAIR_IDS_M, 'M'))
section('color', '머리색', `${HAIR_COLORS.length}종`, HAIR_COLORS.map((c, i) => ({ look: base({ hairColor: i, hairStyle: 'F24' }), cap: c.name, swatch: c.tone.base })))
section('face', '표정', `${EXPRESSIONS.length}종`, EXPRESSIONS.map((e, i) => ({ look: base({ expression: i }), cap: e.name })), 5)
section('outfit', '복장', `${OUTFITS.length}종`, OUTFITS.map((o, i) => ({ look: base({ outfit: i }), cap: o.name, sub: o.note, dirs: ['down', 'left'] as Dir[] })))
section('wear', '착용 스타일', `${WEAR_STYLE_NAMES.length}종 · 동복 기준`, WEAR_STYLE_NAMES.map((n, i) => ({ look: base({ outfit: 2, wearStyle: i }), cap: n })))
section('bottom', '하의', '2종', ['바지', '치마'].map((n, i) => ({ look: base({ bottom: i }), cap: n })))
section('neck', '목 장식', `${NECKWEAR_NAMES.length}종`, NECKWEAR_NAMES.map((n, i) => ({ look: base({ neckwear: i }), cap: n })))
document.body.dataset.ready = '1'
