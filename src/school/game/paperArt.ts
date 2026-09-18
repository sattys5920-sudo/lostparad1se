// 구겨진 투표용지의 도트 그림.
//
// 종이 한 장을 통째로 그려 두면 화면 크기마다 배율이 안 맞는다 —
// 375 와 412 사이에서 1.1 배 같은 수가 나오고, 그 순간 도트가 뭉갠다.
// 그래서 **아홉 조각**으로 쓴다. 모서리 넷은 크기가 고정이고,
// 가장자리 넷은 이어 붙이고, 가운데는 아무것도 없는 평평한 색이다.
// 종이가 커져도 늘어나는 것은 「이어 붙이는 횟수」뿐이라 어떤 폭에서도
// 배율은 정확히 2 배다.
//
// 구김은 네 모서리에만 둔다. 가운데를 평평하게 비워 두어야 글자가
// 접힌 면을 밟지 않는다.
//
// 색은 넷이다. p 바탕, l 빛을 받는 들린 면, d 그 너머의 그늘,
// f 접힌 선. 빈칸은 뜯겨 나간 자리다 — 투명하다.

/** 종이 색. 다른 데서도 쓰라고 내보낸다(가운데 평면과 CSS 변수). */
export const PAPER = {
  base: '#D5CEBC',
  light: '#E6E0CF',
  dark: '#C9C1AD',
  fold: '#C2BAA7',
} as const

const TL = [
  ' ddd        dddd        pppp',
  ' ddddf      dddppppp    pppp',
  ' dddfllllfddddpppppppppppppp',
  '  dfllllfddddpppppppfdpppppp',
  '  fllllfddddppppppppfdpppppp',
  '  llllfddddpppppppppfdpppppp',
  '  lllfddddppppppppppfdpppppp',
  'llllfddddpppppppppppfdpppppp',
  'lllfddddppppppppppppfdpppppp',
  'llfddddpppppppppppppfdpppppp',
  'lfddddppppppppppppppfdpppppp',
  'fddddppppppppppppppppppppppp',
  'ddddpppppppppppppppppppppppp',
  'dddppppppppppppppppppppppppp',
  ' dpppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' pppfffffffffppppppppppppppp',
  ' pppdddddddddppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
]

const TR = [
  '                            ',
  '   ppppppppddd        fddd  ',
  'pppppfdpppppddddfllllllfddd ',
  'pppppfdppppppddddfllllllfdd ',
  'pppppfdpppppppddddfllllllfd ',
  'pppppfdppppppppddddfllllll  ',
  'pppppfdpppppppppddddflllll  ',
  'pppppfdppppppppppddddfllll  ',
  'pppppfdpppppppppppddddflll  ',
  'pppppppppppppppppppddddflll ',
  'ppppppppppppppppppppddddfll ',
  'pppppppppppppppppppppddddfl ',
  'ppppppppppppppppppppppddddf ',
  'pppppppppppppppppppppppddd  ',
  'ppppppppppppppppppppppppdd  ',
  'pppppppppppppppppppppppppd  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppffffffffp  ',
  'pppppppppppppppppddddddddp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'ppppppppppppppppppppppppppp ',
  'ppppppppppppppppppppppppppp ',
  'ppppppppppppppppppppppppppp ',
]

const BL = [
  '  pppppppppppppppppppppppppp',
  '  pppppppppppppppppppppppppp',
  '  pppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppppp',
  'pppppffffffffppppppppppppppp',
  ' ppppddddddddppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' ppppppppppppppppppppppppppp',
  ' dpppppppppppppppppppppppppp',
  '  dppppppppppppppppppppppppp',
  '  ddpppppppppppppppppppppppp',
  '  dddppppppppppppppppppppppp',
  ' fddddpppppppppppppppppppppp',
  ' lfddddppppppppppppppppppppp',
  'lllfddddpppppppppppppfdppppp',
  'llllfddddppppppppppppfdppppp',
  'lllllfddddpppppppppppfdppppp',
  ' lllllfddddppppppppppfdppppp',
  ' llllllfddddpppppppppfdppppp',
  ' fllllllfddddppppppppfdppppp',
  ' dfllllllfddddpppppppfdppppp',
  ' ddfllllllfddddppppppppppppp',
  ' dddfllllllfddddpppppppppppp',
  '  d    lll  fd     ppppppppp',
  '       lll  lf         ppppp',
]

const BR = [
  'ppppppppppppppppppppppppppp ',
  'ppppppppppppppppppppppppppp ',
  'ppppppppppppppppppppppppppp ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppfffffffpppp',
  'pppppppppppppppppdddddddpppp',
  'pppppppppppppppppppppppppppp',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppp  ',
  'pppppppppppppppppppppppppdd ',
  'ppppppppppppppppppppppppddd ',
  'pppppppppppppppppppppppddd  ',
  'ppppppppppppppppppppppdddd  ',
  'ppppppppfdpppppppppppddddfll',
  'ppppppppfdppppppppppddddflll',
  'ppppppppfdpppppppppddddfllll',
  'ppppppppfdppppppppddddflllll',
  'ppppppppfdpppppppddddflllll ',
  'ppppppppfdppppppddddfllllll ',
  'ppppppppfdpppppddddfllllllfd',
  'ppppppppfdppppddddfllllllfdd',
  'ppppppppfdpppddddfllllllfddd',
  'ppppppppppppddddfllllllfdddd',
  'pppppppp    dddf       dddd ',
  '                       dddd ',
]

const ET = [
  'ppppppppppp     ',
  'pppppppppppppp  ',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
]

const EB = [
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'ppppppppppppppp ',
  '           pppp ',
]

const EL = [
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
  '  pppppppppppp',
]

const ER = [
  'pppppppppppppp',
  'pppppppppppppp',
  'pppppppppppppp',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
  'ppppppppppppp ',
]
/** 조각 이름 → 그림. 모서리는 28×28, 가장자리는 16×14(또는 14×16). */
const ART: Record<string, string[]> = { TL, TR, BL, BR, ET, EB, EL, ER }

const CH: Record<string, string | null> = {
  ' ': null,
  p: PAPER.base,
  l: PAPER.light,
  d: PAPER.dark,
  f: PAPER.fold,
}

const baked = new Map<string, string>()

/**
 * 조각 하나를 한 번 굽고 다시 쓴다.
 *
 * 1 배로 굽고 화면에서 정수 배(2 배)로만 늘린다 — 지도·아이콘과 같은
 * 방식이다. 화면 쪽에서 background-size 를 정확히 두 배로 적어 둔다.
 */
export function paperSlice(key: string): string {
  const has = baked.get(key)
  if (has) return has
  const rows = ART[key]
  if (!rows) return ''
  const canvas = document.createElement('canvas')
  canvas.width = rows[0]?.length ?? 0
  canvas.height = rows.length
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  for (const [y, row] of rows.entries()) {
    for (const [x, c] of [...row].entries()) {
      const color = CH[c]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
  const url = canvas.toDataURL()
  baked.set(key, url)
  return url
}

/** 조각 여덟을 CSS 변수로 묶어 준다. 종이 div 하나에 통째로 얹는다. */
export function paperVars(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(ART)) out[`--pa-${k.toLowerCase()}`] = `url(${paperSlice(k)})`
  return out
}

/**
 * 조각 하나를 다른 캔버스에 직접 찍는다. **뜯긴 자리는 뚫는다.**
 *
 * 접힌 종이에 모서리 구김을 옮겨 붙일 때 쓴다. 접혔다고 종이가 갑자기
 * 반듯한 네모가 되면, 접힌 것이 아니라 다른 물건으로 바뀐 것처럼 보인다.
 */
export function stampSlice(ctx: CanvasRenderingContext2D, key: string, x: number, y: number): void {
  const rows = ART[key]
  if (!rows) return
  for (const [dy, row] of rows.entries()) {
    for (const [dx, c] of [...row].entries()) {
      const color = CH[c]
      if (!color) {
        ctx.clearRect(x + dx, y + dy, 1, 1)
        continue
      }
      ctx.fillStyle = color
      ctx.fillRect(x + dx, y + dy, 1, 1)
    }
  }
}
