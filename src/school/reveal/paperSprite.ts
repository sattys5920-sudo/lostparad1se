// 종이 세 장을 그린다.
//
// 고정 크기 스프라이트로 만들지 않는다. A의 기록은 날마다 줄 수가 달라서
// 종이가 늘어나야 하고, 380px 화면에서는 줄이 접혀 더 길어진다. 그래서
// 칸 수를 받아 그 자리에서 그린다.
//
// 그림체는 캐릭터와 같다. 1픽셀로 그린 뒤 정수배로 확대하고, 색은
// 바탕·그늘·빛·테두리 네 칸만 쓴다. 겨울이라 종이도 차갑다 —
// 흰색이 아니라 푸른 기가 도는 회백색이다.
import { tone, type Tone } from '../char/palette'
import type { PaperKind } from '../../../shared/reveal/paper'

/** 겨울 팔레트. 눈 내리는 교실의 종이다. */
export const PAPER_TONES: Record<PaperKind, Tone> = {
  // 일기장 — 결이 고운 흰 종이. 아주 살짝 푸르다
  diary: tone('#e6e8ee'),
  // 메모 — 손에 쥐고 구긴 갱지. 누렇지 않고 바랬다
  note: tone('#dcdbd6'),
  // 찢긴 한 장 — 오래 사물함에 있었다. 가장 바랜 색
  torn: tone('#d8d6cd'),
}

/** 줄 노트의 괘선. 잉크가 아니라 인쇄된 선이라 연하다. */
const RULE_LINE = '#b9c2d4'
/** 일기장 왼쪽의 붉은 여백선. */
const MARGIN_LINE = '#c98f92'
/** 구멍 안쪽. 종이 뒤의 어둠이다. */
const HOLE = '#8f95a3'

export interface PaperGeom {
  /** 종이의 가로 픽셀 수(확대 전). */
  w: number
  /** 세로 픽셀 수(확대 전). */
  h: number
  /** 글이 들어갈 자리. 확대 전 픽셀. */
  pad: { top: number; right: number; bottom: number; left: number }
  /** 괘선 간격. 일기장만 쓴다. */
  ruleStep: number
}

/** 종류마다 여백이 다르다. 일기장은 왼쪽에 구멍과 여백선이 있어 넓다. */
export function geomOf(kind: PaperKind, w: number, h: number): PaperGeom {
  if (kind === 'diary') {
    return { w, h, pad: { top: 9, right: 6, bottom: 7, left: 14 }, ruleStep: 9 }
  }
  if (kind === 'torn') {
    // 오른쪽이 찢겨 있다. 그쪽 여백을 더 준다
    return { w, h, pad: { top: 7, right: 11, bottom: 7, left: 7 }, ruleStep: 0 }
  }
  return { w, h, pad: { top: 7, right: 7, bottom: 7, left: 7 }, ruleStep: 0 }
}

/** 씨앗을 받는 난수. 같은 종이는 늘 같은 모양이어야 한다. */
function rand(seed: number, i: number): number {
  const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return Math.abs(n % 1)
}

/**
 * 찢긴 가장자리.
 *
 * 줄마다 따로 뽑으면 빗살처럼 보인다. 종이는 그렇게 찢어지지 않는다 —
 * 결을 따라 이어지다가 가끔 크게 물러난다. 그래서 한 줄씩 걸어가며
 * 대개 ±1, 드물게 ±2만 움직인다.
 */
export function tornEdge(seed: number, h: number, depth: number): number[] {
  const out: number[] = []
  let at = Math.floor(depth / 2)
  for (let y = 0; y < h; y++) {
    const r = rand(seed, y)
    // 60%는 그대로 간다. 결을 따라 이어지는 부분이다.
    // 분기는 서로 배타적이어야 한다 — 겹치면 한 줄에 세 칸씩 튀고,
    // 그게 쌓이면 찢긴 결이 아니라 빗살이 된다
    if (r > 0.97) at += 2
    else if (r > 0.8) at += 1
    else if (r < 0.2) at -= 1
    at = Math.max(0, Math.min(depth, at))
    out.push(at)
  }
  return out
}

export interface DrawOptions {
  kind: PaperKind
  /** 확대 전 크기. */
  w: number
  /** 확대 전 크기. */
  h: number
  /** 정수배로만 확대한다. 소수배로 늘리면 픽셀이 뭉갠다. */
  scale: number
  /** 찢긴 모양의 씨앗. 같은 종이는 늘 같은 모양이어야 한다. */
  seed?: number
}

/**
 * 종이 한 장을 캔버스에 그린다. 글씨는 그리지 않는다 —
 * 타자 연출이 그 위에 얹는다.
 */
export function drawPaper(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const t = PAPER_TONES[o.kind]
  const { w, h } = o
  const seed = o.seed ?? 1

  ctx.imageSmoothingEnabled = false
  ctx.save()
  ctx.scale(o.scale, o.scale)
  ctx.clearRect(0, 0, w, h)

  /** 찢긴 종이는 오른쪽 가장자리가 줄마다 조금씩 들어간다. */
  const edge = o.kind === 'torn' ? tornEdge(seed, h, 4) : null
  const rightAt = (y: number): number => (edge ? w - 1 - edge[y] : w - 1)

  // 바탕
  ctx.fillStyle = t.base
  for (let y = 0; y < h; y++) {
    const right = rightAt(y)
    ctx.fillRect(0, y, right + 1, 1)
  }

  // 아래쪽과 오른쪽에 그늘 한 줄 — 종이가 바닥에서 살짝 뜬 느낌
  ctx.fillStyle = t.shade
  ctx.fillRect(0, h - 2, w, 1)
  if (!edge) for (let y = 0; y < h - 1; y++) ctx.fillRect(w - 2, y, 1, 1)

  // 위쪽에 빛 한 줄
  ctx.fillStyle = t.light
  ctx.fillRect(0, 0, w - 1, 1)

  // 테두리. 찢긴 쪽은 테두리를 그리지 않는다 — 찢어진 면에는 선이 없다
  ctx.fillStyle = t.line
  ctx.fillRect(0, 0, 1, h)
  ctx.fillRect(0, 0, w, 1)
  ctx.fillRect(0, h - 1, w, 1)
  if (o.kind !== 'torn') ctx.fillRect(w - 1, 0, 1, h)

  if (o.kind === 'diary') {
    const g = geomOf('diary', w, h)
    // 괘선
    ctx.fillStyle = RULE_LINE
    for (let y = g.pad.top + g.ruleStep - 1; y < h - g.pad.bottom; y += g.ruleStep) {
      ctx.fillRect(g.pad.left - 2, y, w - g.pad.left - g.pad.right + 4, 1)
    }
    // 붉은 여백선
    ctx.fillStyle = MARGIN_LINE
    ctx.fillRect(g.pad.left - 4, 2, 1, h - 4)
    // 왼쪽 구멍 두 개. 작으면 때처럼 보여서 넉넉히 뚫는다
    for (const cy of [Math.round(h * 0.28), Math.round(h * 0.72)]) {
      ctx.fillStyle = HOLE
      ctx.fillRect(3, cy - 2, 5, 5)
      ctx.fillRect(2, cy - 1, 7, 3)
      // 구멍 아래쪽에 빛 — 뚫린 자리에 두께가 보인다
      ctx.fillStyle = t.light
      ctx.fillRect(3, cy + 3, 5, 1)
    }
  }

  if (o.kind === 'note') {
    // 구긴 자국. 점선으로 흩뿌리면 때처럼 보인다 — 이어진 선으로 긋고,
    // 위에 빛 아래에 그늘을 붙여야 접힌 것으로 읽힌다.
    for (const at of [0.34, 0.66]) {
      const fold = Math.round(h * at)
      let y = fold
      for (let x = 1; x < w - 1; x++) {
        const r = rand(seed + at, x)
        if (r > 0.86) y += 1
        else if (r < 0.14) y -= 1
        y = Math.max(fold - 2, Math.min(fold + 2, y))
        ctx.fillStyle = t.light
        ctx.fillRect(x, y - 1, 1, 1)
        ctx.fillStyle = t.shade
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }

  ctx.restore()
}
