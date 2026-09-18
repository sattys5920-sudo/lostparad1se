// 수첩의 도트 조각 둘 — 스프링과 뜯는 자리.
//
// 줄과 마진선은 CSS 로 긋는다. 1px 선은 어느 화면에서도 1px 이라
// 도트로 구울 이유가 없다. **도트가 필요한 것은 모양이 있는 것뿐이다** —
// 종이 가장자리를 물고 있는 금속 스프링과, 뜯어낸 자리의 우툴두툴한
// 아랫단.
//
// 둘 다 이어 붙이는 조각이다. 스프링은 세로로, 뜯는 자리는 가로로
// 되풀이한다 — 수첩이 길어지거나 넓어져도 늘어나는 것은 되풀이 횟수뿐이라
// 배율은 언제나 정확히 2 배다.

/**
 * 수첩 색. CSS 에서도 쓴다.
 *
 * **종이는 거의 흰색이다.** 투표용지는 오래된 갱지(#D5CEBC)지만 수첩은
 * 지금 쓰는 공책이라 색이 달라야 한다 — 같은 누런색으로 두었더니 둘이
 * 같은 물건처럼 보였다.
 *
 * 흰 바탕에서는 흐린 글자가 금방 안 읽힌다. 읽어야 하는 회색은
 * #686E76(4.7:1)까지 내린다. 줄과 밑줄은 읽는 것이 아니라 결이라
 * 그보다 훨씬 옅다.
 */
export const NOTE = {
  paper: '#F6F5F2',
  rule: '#DFE3E8',
  under: '#BCC3CB',
  margin: '#C2564E',
  ink: '#262A31',
  pencil: '#3F444C',
  faint: '#686E76',
  wireLit: '#B9BFCC',
  wire: '#8A8F9C',
  wireDark: '#565C6B',
  hole: '#1F2430',
} as const

/** 스프링 한 칸의 크기(1 배). 화면에서 38×34 로 이어 붙인다. */
const RING_W = 19
const RING_H = 17
/** 이 왼쪽은 종이 바깥이다. 종이가 여기서 시작한다. */
const PAGE_X = 13

/**
 * 스프링 한 칸을 그린다.
 *
 * 철사는 **비스듬하다.** 앞에서 본 스프링 제본이 그렇다 — 종이 뒤에서
 * 올라와 구멍을 지나 왼쪽 아래로 내려간다. 가로 막대로 그렸더니
 * 철사가 아니라 회색 덩어리가 되었다.
 *
 * 오른쪽 위가 빛을 받고 왼쪽 아래가 그늘이다. 오른쪽 끝의 어두운
 * 자국이 철사가 꿴 구멍이다 — 그것이 없으면 얹어 둔 것으로 보인다.
 */
function drawRing(ctx: CanvasRenderingContext2D): void {
  // 꿴 구멍. 종이 쪽에 있다
  ctx.fillStyle = NOTE.hole
  ctx.fillRect(PAGE_X + 3, 1, 3, 3)

  // 비스듬한 철사. 한 줄에 세 화소, 한 칸 내려갈 때마다 한 칸 왼쪽으로
  for (let i = 0; i < 12; i += 1) {
    const x = PAGE_X + 3 - i
    const y = 3 + i
    if (x < 0) break
    ctx.fillStyle = NOTE.wireLit
    ctx.fillRect(x + 2, y, 1, 1)
    ctx.fillStyle = NOTE.wire
    ctx.fillRect(x + 1, y, 1, 1)
    ctx.fillStyle = NOTE.wireDark
    ctx.fillRect(x, y, 1, 1)
  }
}

/** 뜯어낸 아랫단(10×6). 종이가 톱니처럼 물려 뜯긴다. */
const TEAR = [
  'pppppppppp',
  'pppppppppp',
  'ppp    ppp',
  'pp      pp',
  'p        p',
  '          ',
]

const CH: Record<string, string | null> = {
  ' ': null,
  l: NOTE.wireLit,
  m: NOTE.wire,
  d: NOTE.wireDark,
  h: NOTE.hole,
  p: NOTE.paper,
}

const baked = new Map<string, string>()

function canvasOf(w: number, h: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas.getContext('2d')
}

function bake(key: string, rows: readonly string[]): string {
  const has = baked.get(key)
  if (has) return has
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

/** 세로로 되풀이한다. 화면에서 38×34. */
export function ringTile(): string {
  const has = baked.get('ring')
  if (has) return has
  const ctx = canvasOf(RING_W, RING_H)
  if (!ctx) return ''
  drawRing(ctx)
  const url = ctx.canvas.toDataURL()
  baked.set('ring', url)
  return url
}

/** 가로로 되풀이한다. 화면에서 20×12. */
export const tearTile = (): string => bake('tear', TEAR)
