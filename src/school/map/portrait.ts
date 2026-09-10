// 32×32 얼굴 초상화 — 지도 위를 걷는 12×18 인형과는 다른 캔버스다.
//
// 완전한 원으로 그렸더니 굴곡이 없어 달걀귀신 같았다. 레퍼런스(RPG 만들기식
// 얼굴 시트, 도트 이모티콘 시트)의 얼굴은 원이 아니다 —
//   · 정수리는 넓고 둥글다
//   · 눈높이에서 볼이 가장 넓다
//   · 턱으로 갈수록 좁아져 바닥이 납작하다
//   · 눈은 아래쪽에 낮게 앉고 이마가 넓다
//   · 귀가 옆으로 살짝 튀어나온다
// 그 형태를 베지어 곡선 넷으로 잡는다.
//
// 머리카락은 얼굴과 따로 "실루엣"으로만 그린다(남자 15 · 여자 15). 그 실루엣을
// 픽셀 단위로 얼굴 위에 얹으면서 색을 정한다 — 바깥 테두리는 늘 먹, 얼굴과
// 닿는 안쪽 테두리는 머리색의 테두리 톤, 속은 머리색, 정수리 왼쪽엔 빛. 흑백
// 네 톤뿐이라 머리색은 톤으로 낸다: 흑발(먹) · 적발(중간) · 금발(밝음) ·
// 백발(종이) · 브릿지(먹에 밝은 줄).
//
// 곡선은 안티앨리어싱이 걸리므로 다 그린 뒤 팔레트 두 색(먹·살)으로
// 양자화해서 도트로 만든다. 중간 톤(눈물·볼 홍조)은 그 뒤에 사각형으로만
// 얹는다 — 사각형은 번지지 않는다.
import type { AvatarLook } from '../types'

export const PORTRAIT_SIZE = 32

const PAPER = '#eef0f2'
const LIGHT = '#c9ced2'
const MID = '#5c646b'
const INK = '#0b0d0f'

type Ctx = CanvasRenderingContext2D

const CX = 16
/** 정수리 · 턱 바닥 · 볼 반폭 · 볼이 가장 넓은 높이 */
const TOP = 3
const BOTTOM = 27.5
const HW = 12.5
const CHEEK_Y = 14

/** 머리 윤곽. 정수리는 넓게, 볼에서 가장 넓고, 턱으로 좁아진다. */
function headPath(ctx: Ctx): void {
  ctx.beginPath()
  ctx.moveTo(CX, TOP)
  ctx.bezierCurveTo(CX + 7.5, TOP, CX + HW, 7.5, CX + HW, CHEEK_Y)
  ctx.bezierCurveTo(CX + HW, 21, CX + 6.5, BOTTOM, CX, BOTTOM)
  ctx.bezierCurveTo(CX - 6.5, BOTTOM, CX - HW, 21, CX - HW, CHEEK_Y)
  ctx.bezierCurveTo(CX - HW, 7.5, CX - 7.5, TOP, CX, TOP)
  ctx.closePath()
}

function circle(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2)
  ctx.fill()
}

function poly(ctx: Ctx, pts: [number, number][]): void {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.fill()
}

const EAR_Y = 15
const EAR_L = CX - HW - 1
const EAR_R = CX + HW + 1

function drawEars(ctx: Ctx): void {
  for (const x of [EAR_L, EAR_R]) {
    ctx.fillStyle = INK
    circle(ctx, x, EAR_Y, 2.6)
    ctx.fillStyle = LIGHT
    circle(ctx, x, EAR_Y, 1.4)
  }
}

function drawHead(ctx: Ctx): void {
  headPath(ctx)
  ctx.fillStyle = LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.stroke()
}

// ── 머리카락 실루엣 ─────────────────────────────────────────────
// 여기서는 색을 정하지 않는다. 머리카락이 "있는 자리"만 먹으로 칠한 마스크다.
// 얼굴 윤곽 안에만 그리고 싶으면 clipped(), 지우고 싶으면 erase()로 감싼다.

function clipped(ctx: Ctx, draw: () => void): void {
  ctx.save()
  headPath(ctx)
  ctx.clip()
  draw()
  ctx.restore()
}

function erase(ctx: Ctx, draw: () => void): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  draw()
  ctx.restore()
}

/** 정수리부터 toY까지 이마를 덮는 캡. */
function cap(ctx: Ctx, toY: number): void {
  clipped(ctx, () => ctx.fillRect(0, 0, PORTRAIT_SIZE, toY))
}

/** 한쪽으로 빗어 넘긴 캡 — 아랫선이 왼쪽 leftY에서 오른쪽 rightY로 기운다. */
function capSlant(ctx: Ctx, leftY: number, rightY: number): void {
  clipped(ctx, () => poly(ctx, [[0, 0], [PORTRAIT_SIZE, 0], [PORTRAIT_SIZE, rightY], [0, leftY]]))
}

/** 얼굴 양옆을 따라 내려오는 머리 — 레퍼런스의 「( )」 괄호. */
function sideLocks(ctx: Ctx, fromY: number, toY: number, width: number): void {
  clipped(ctx, () => {
    ctx.fillRect(0, fromY, CX - HW + width, toY - fromY)
    ctx.fillRect(CX + HW - width, fromY, PORTRAIT_SIZE, toY - fromY)
  })
}

/** 짧게 깎은 밑동 — 점묘. 점은 낱낱이 테두리 취급이라 어느 색이든 테두리 톤이 된다. */
function stipple(ctx: Ctx, fromY: number, toY: number): void {
  clipped(ctx, () => {
    for (let y = fromY; y < toY; y++) {
      for (let x = y % 2 === 0 ? 0 : 1; x < PORTRAIT_SIZE; x += 2) ctx.fillRect(x, y, 1, 1)
    }
  })
}

/**
 * 머리 실루엣을 얼굴 윤곽 밖까지 크게 그린 뒤 얼굴 자리를 파낸다.
 * 긴 머리·단발처럼 얼굴을 감싸는 여자 머리는 이 방식이 깔끔하다.
 * 위 모서리는 둥글게 파여 관자놀이에 머리가 남는다.
 */
function faceWindow(ctx: Ctx, topY: number, halfW: number): void {
  const r = halfW * 0.8
  erase(ctx, () => {
    ctx.beginPath()
    ctx.roundRect(CX - halfW, topY, halfW * 2, PORTRAIT_SIZE, [r, r, 0, 0])
    ctx.fill()
  })
}

/** 뾰족뾰족한 앞머리 끝 — y0에서 y1까지 n개의 삼각형이 매달린다. */
function zigzag(ctx: Ctx, y0: number, y1: number, n: number, x0 = CX - HW, x1 = CX + HW): void {
  clipped(ctx, () => {
    const w = (x1 - x0) / n
    for (let i = 0; i < n; i++) {
      const a = x0 + i * w
      const dip = i % 2 === 0 ? y1 : y1 - 1
      poly(ctx, [[a, y0 - 0.5], [a + w, y0 - 0.5], [a + w / 2, dip]])
    }
  })
}

/** 위로 솟는 삐침. 밑동은 캡 안(y=9)에, 끝은 머리 위로. lean은 옆으로 기울기. */
function spike(ctx: Ctx, x: number, apexY: number, lean: number, half = 3): void {
  poly(ctx, [[x - half, 9.5], [x + half, 9.5], [x + lean, apexY]])
}

function curlyTop(ctx: Ctx): void {
  const bumps: [number, number][] = [
    [7, 9], [11, 5], [16, 4], [21, 5], [25, 9],
    [4.5, 13], [27.5, 13], [4, 17], [28, 17],
  ]
  clipped(ctx, () => bumps.forEach(([x, y]) => circle(ctx, x, y, 3.6)))
  // 정수리 쪽은 윤곽 밖으로도 살짝 부풀어 곱슬임이 실루엣에서 보인다
  for (const [x, y] of bumps.slice(0, 5)) circle(ctx, x, y, 3.2)
}

/** 긴 실루엣 — 정수리에서 어깨 아래까지 내려오는 머리 덩어리. */
function longMass(ctx: Ctx, halfW: number): void {
  ctx.beginPath()
  ctx.roundRect(CX - halfW, 5, halfW * 2, PORTRAIT_SIZE + 4, [halfW * 0.8, halfW * 0.8, 0, 0])
  ctx.fill()
}

interface HairStyle {
  name: string
  draw: (ctx: Ctx) => void
}

const MALE: HairStyle[] = [
  { name: '짧은 머리', draw: (c) => cap(c, 10) },
  {
    name: '스포츠머리',
    draw: (c) => {
      cap(c, 6)
      stipple(c, 6, 10)
    },
  },
  {
    name: '가르마',
    draw: (c) => {
      cap(c, 10)
      sideLocks(c, 8, 13, 2)
      erase(c, () => poly(c, [[CX - 2, TOP - 1], [CX + 1, TOP - 1], [CX - 3, 10.5], [CX - 5, 10.5]]))
    },
  },
  {
    name: '삐침 머리',
    draw: (c) => {
      cap(c, 9)
      spike(c, 8, 2, -2)
      spike(c, 12, 0, -1)
      spike(c, 16, -1, 0)
      spike(c, 20, 0, 1)
      spike(c, 24, 2, 2)
    },
  },
  {
    name: '앞머리 내린',
    draw: (c) => {
      cap(c, 13)
      sideLocks(c, 8, 20, 3)
    },
  },
  {
    name: '옆으로 넘긴',
    draw: (c) => {
      capSlant(c, 8, 13)
      // 넘긴 쪽 끝이 얼굴 밖으로 살짝 삐친다
      poly(c, [[CX + HW - 3, 9.5], [CX + HW + 2.5, 8.5], [CX + HW + 1.5, 13.5], [CX + HW - 1, 13]])
    },
  },
  {
    name: '더벅머리',
    draw: (c) => {
      cap(c, 11)
      zigzag(c, 11, 14.5, 6)
      sideLocks(c, 8, 20, 3)
      for (const [x, y] of [[8, 7], [12, 4.5], [16, 3.5], [20, 4.5], [24, 7]] as [number, number][]) circle(c, x, y, 3)
    },
  },
  { name: '곱슬', draw: curlyTop },
  {
    name: '아프로',
    draw: (c) => {
      // 매끈한 원은 헬멧이 된다. 작은 원을 고리로 둘러 보송보송한 실루엣을 만든다.
      ellipse(c, CX, 11, 9.5, 7.5)
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI * (0.92 + (i / 6) * 1.16)
        circle(c, CX + Math.cos(a) * 11, 11 + Math.sin(a) * 8.5, 3.6)
      }
      // 얼굴 자리는 되돌린다 — 이마선 아래, 윤곽 안쪽만
      erase(c, () => clipped(c, () => c.fillRect(0, 10, PORTRAIT_SIZE, PORTRAIT_SIZE)))
    },
  },
  {
    name: '투블럭',
    draw: (c) => {
      stipple(c, 3, 10)
      clipped(c, () => c.fillRect(9, 0, 14, 9.5))
    },
  },
  {
    name: '올백',
    draw: (c) => {
      // 이마를 넓게 드러내고 가운데만 뾰족하게 내려온 헤어라인. 정수리는 살짝 부푼다.
      cap(c, 7)
      clipped(c, () => poly(c, [[CX - 5, 6.5], [CX + 5, 6.5], [CX, 10]]))
      ellipse(c, CX, TOP + 1, 6, 2.5)
    },
  },
  {
    name: '장발',
    draw: (c) => {
      cap(c, 11)
      zigzag(c, 11, 14, 5)
      sideLocks(c, 8, BOTTOM, 4)
      c.fillRect(3, 18, 4, 12)
      c.fillRect(25, 18, 4, 12)
    },
  },
  {
    name: '포니테일',
    draw: (c) => {
      cap(c, 9)
      ellipse(c, CX + HW + 1.5, 19, 2.8, 8, 0.15)
    },
  },
  {
    name: '헝클어진',
    draw: (c) => {
      cap(c, 10)
      zigzag(c, 10, 13, 7)
      sideLocks(c, 8, 16, 2)
      spike(c, 7, 6, -3, 2.5)
      spike(c, 11, 2, -1, 2.5)
      spike(c, 17, 0.5, 1, 2.5)
      spike(c, 22, 2, 2, 2.5)
      spike(c, 26, 6, 3, 2.5)
    },
  },
  {
    name: '커튼 앞머리',
    draw: (c) => {
      cap(c, 9)
      clipped(c, () => {
        poly(c, [[CX - 12, 8], [CX - 1, 8], [CX - 7, 16], [CX - 12, 16]])
        poly(c, [[CX + 12, 8], [CX + 1, 8], [CX + 7, 16], [CX + 12, 16]])
      })
    },
  },
]

const FEMALE: HairStyle[] = [
  {
    name: '단발',
    draw: (c) => {
      cap(c, 10)
      c.beginPath()
      c.roundRect(2, 5, 28, 21, 9)
      c.fill()
      faceWindow(c, 10, 9)
    },
  },
  {
    name: '긴 생머리',
    draw: (c) => {
      cap(c, 10)
      longMass(c, 13)
      faceWindow(c, 10, 9)
    },
  },
  {
    name: '웨이브',
    draw: (c) => {
      cap(c, 10)
      longMass(c, 13)
      faceWindow(c, 10, 9)
      // 바깥선을 물결로 파낸다
      erase(c, () => {
        for (const y of [14, 21, 28]) {
          circle(c, 1.5, y, 3)
          circle(c, 30.5, y, 3)
        }
      })
      // 안쪽으로도 한 굽이씩 볼에 걸친다
      circle(c, 8, 21, 2.4)
      circle(c, 24, 21, 2.4)
      circle(c, 8, 27, 2.4)
      circle(c, 24, 27, 2.4)
    },
  },
  {
    name: '양갈래',
    draw: (c) => {
      cap(c, 10)
      sideLocks(c, 8, 14, 2)
      ellipse(c, EAR_L - 0.5, 22, 3.4, 7.5, 0.12)
      ellipse(c, EAR_R + 0.5, 22, 3.4, 7.5, -0.12)
    },
  },
  {
    name: '하나로 묶음',
    draw: (c) => {
      cap(c, 10)
      // 뒤통수 위에서 묶어 옆으로 늘어진 꼬리
      circle(c, CX + HW - 1, 7, 2.2)
      ellipse(c, CX + HW + 1.5, 15, 3, 8.5, 0.12)
    },
  },
  {
    name: '쪽머리',
    draw: (c) => {
      cap(c, 10)
      circle(c, CX, TOP + 0.5, 3.4)
      sideLocks(c, 8, 15, 2)
    },
  },
  {
    name: '앞머리 단발',
    draw: (c) => {
      cap(c, 13)
      c.beginPath()
      c.roundRect(2, 5, 28, 21, 9)
      c.fill()
      faceWindow(c, 13, 9)
    },
  },
  {
    name: '히메컷',
    draw: (c) => {
      cap(c, 13)
      sideLocks(c, 8, 21, 3)
      // 옆머리는 볼 높이에서 일자로 잘리고, 뒷머리만 아래로 길게
      c.fillRect(2, 13, 5, 8)
      c.fillRect(25, 13, 5, 8)
      c.fillRect(3, 21, 3, 11)
      c.fillRect(26, 21, 3, 11)
    },
  },
  {
    name: '땋은 머리',
    draw: (c) => {
      cap(c, 10)
      sideLocks(c, 8, 14, 2)
      for (let i = 0; i < 6; i++) circle(c, EAR_R + 1 + (i % 2 ? 0.8 : -0.8), 15 + i * 3, 2.7)
    },
  },
  {
    name: '똥머리 둘',
    draw: (c) => {
      cap(c, 10)
      circle(c, CX - 9, TOP + 1.5, 3.8)
      circle(c, CX + 9, TOP + 1.5, 3.8)
    },
  },
  {
    name: '숏컷',
    draw: (c) => {
      capSlant(c, 9, 12)
      sideLocks(c, 8, 15, 2.5)
      poly(c, [[CX - HW + 1, 9], [CX - HW - 3, 7], [CX - HW - 2, 12], [CX - HW, 13]])
    },
  },
  {
    name: '옆머리 흘린',
    draw: (c) => {
      cap(c, 10)
      clipped(c, () => {
        poly(c, [[CX - 12, 8], [CX - 1, 8], [CX - 2, 21], [CX - 12, 21]])
        c.fillRect(CX + HW - 3, 8, PORTRAIT_SIZE, 12)
      })
    },
  },
  {
    name: '반묶음',
    draw: (c) => {
      cap(c, 10)
      circle(c, CX, TOP - 0.5, 3)
      longMass(c, 13)
      faceWindow(c, 10, 9)
    },
  },
  {
    name: '긴 곱슬',
    draw: (c) => {
      curlyTop(c)
      for (let y = 13; y <= 31; y += 4.5) {
        circle(c, 4.5, y, 3.8)
        circle(c, 27.5, y, 3.8)
      }
    },
  },
  {
    name: '옆으로 묶음',
    draw: (c) => {
      cap(c, 10)
      sideLocks(c, 8, 15, 2)
      ellipse(c, CX - HW - 0.5, 22, 3.4, 9.5, -0.1)
    },
  },
]

const STYLES = [...MALE, ...FEMALE]

export const HAIR_NAMES = STYLES.map((s) => s.name)
export const HAIR_GROUPS = [
  { label: '남자 머리', from: 0, to: MALE.length },
  { label: '여자 머리', from: MALE.length, to: STYLES.length },
]

// ── 머리색 ──────────────────────────────────────────────────────
// 흑백이라 진짜 색은 없다. 속·안쪽 테두리·빛 세 톤으로 색을 낸다.
// 바깥 테두리는 어느 색이든 먹이라 실루엣이 한 선으로 이어진다.

interface HairTone {
  fill: string
  rim: string
  hi: string
  /** 브릿지 — 속에 비스듬한 밝은 줄 */
  streak?: (x: number, y: number) => boolean
}

const TONES: HairTone[] = [
  { fill: INK, rim: INK, hi: MID }, // 흑발
  { fill: MID, rim: INK, hi: LIGHT }, // 적발
  { fill: LIGHT, rim: MID, hi: PAPER }, // 금발
  { fill: PAPER, rim: MID, hi: PAPER }, // 백발
  { fill: INK, rim: INK, hi: INK, streak: (x, y) => (x + y) % 5 < 2 }, // 브릿지
]

export const HAIR_COLORS = ['흑발', '적발', '금발', '백발', '브릿지']

/** 정수리 왼쪽 위의 빛. 머리가 두툼한 자리에서만 나온다. */
function isHighlight(x: number, y: number): boolean {
  return x >= 10 && x <= 14 && y >= 5 && y <= 7 && !((x === 10 || x === 14) && (y === 5 || y === 7))
}

function hairMask(hair: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = PORTRAIT_SIZE
  c.height = PORTRAIT_SIZE
  const ctx = c.getContext('2d') as Ctx
  ctx.fillStyle = INK
  STYLES[hair % STYLES.length].draw(ctx)
  const d = ctx.getImageData(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE).data
  const mask = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE)
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0
  return mask
}

const maskCache = new Map<number, Uint8Array>()

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function hex(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
}

/**
 * 얼굴 위에 머리 마스크를 얹는다. 픽셀마다:
 *   · 이웃이 그림 밖(투명)이면 → 먹 (바깥 실루엣)
 *   · 이웃이 얼굴이면 → 머리색의 테두리 톤 (헤어라인)
 *   · 빛 자리면 → 빛
 *   · 그 밖엔 → 속 톤
 */
function compositeHair(ctx: Ctx, hair: number, color: number): void {
  let mask = maskCache.get(hair)
  if (!mask) {
    mask = hairMask(hair)
    maskCache.set(hair, mask)
  }
  const tone = TONES[color % TONES.length]
  const img = ctx.getImageData(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE)
  const d = img.data
  const S = PORTRAIT_SIZE
  const at = (x: number, y: number) => mask![y * S + x]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!at(x, y)) continue
      let outer = false
      let inner = false
      for (const [dx, dy] of N4) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) {
          outer = true
          continue
        }
        if (at(nx, ny)) continue
        if (d[(ny * S + nx) * 4 + 3] === 0) outer = true
        else inner = true
      }
      let color = tone.fill
      if (outer) color = INK
      else if (inner) color = tone.rim
      else if (tone.streak?.(x, y)) color = LIGHT
      else if (isHighlight(x, y)) color = tone.hi
      const [r, g, b] = hex(color)
      const i = (y * S + x) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

// ── 표정 ────────────────────────────────────────────────────────
// 눈은 낮게, 이마는 넓게. 레퍼런스의 눈은 세로로 길고 안에 빛이 있다.

type EyeStyle = 'dot' | 'happy' | 'sad' | 'wide' | 'closed' | 'side'
type MouthStyle = 'neutral' | 'smile' | 'grin' | 'open' | 'frown' | 'flat' | 'small' | 'smirk'

interface Expr {
  eye: EyeStyle
  eyeR?: EyeStyle
  brow?: 'down' | 'up' | 'raise'
  mouth: MouthStyle
  tear?: boolean
  blush?: boolean
}

const EYE_L = CX - 6
const EYE_R = CX + 6
const EYE_Y = 16
const BROW_Y = EYE_Y - 4
const MOUTH_Y = 23

function drawEye(ctx: Ctx, x: number, y: number, style: EyeStyle): void {
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  switch (style) {
    case 'dot':
      ctx.fillRect(x - 1, y - 1, 2, 3)
      break
    case 'side':
      ctx.fillRect(x + 1, y - 1, 2, 3)
      break
    case 'wide':
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, 2.6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillRect(x - 1, y - 1, 2, 2)
      break
    case 'happy':
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y + 1, 2.6, Math.PI, Math.PI * 2)
      ctx.stroke()
      break
    case 'sad':
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y - 1.5, 2.6, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
    case 'closed':
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x - 2.5, y)
      ctx.lineTo(x + 2.5, y)
      ctx.stroke()
      break
  }
}

/** 눈 안의 빛 — 양자화 뒤에 찍는다. 레퍼런스 눈이 살아 보이는 이유다. */
function drawEyeShine(ctx: Ctx, x: number, y: number, style: EyeStyle): void {
  if (style !== 'dot' && style !== 'side') return
  ctx.fillStyle = LIGHT
  ctx.fillRect(style === 'side' ? x + 2 : x, y - 1, 1, 1)
}

function drawBrow(ctx: Ctx, x: number, side: 'L' | 'R', style: Expr['brow']): void {
  if (!style) return
  const y = BROW_Y
  const dir = side === 'L' ? 1 : -1
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  if (style === 'down') {
    ctx.moveTo(x - 3 * dir, y - 1)
    ctx.lineTo(x + 2.5 * dir, y + 1.5)
  } else if (style === 'up') {
    ctx.moveTo(x - 3 * dir, y + 1.5)
    ctx.lineTo(x + 2.5 * dir, y - 1)
  } else {
    ctx.moveTo(x - 3, y - 1)
    ctx.lineTo(x + 3, y - 1)
  }
  ctx.stroke()
}

function drawMouth(ctx: Ctx, style: MouthStyle): void {
  const x = CX
  const y = MOUTH_Y
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 1.5
  switch (style) {
    case 'neutral':
      ctx.fillRect(x - 2, y, 4, 1)
      break
    case 'smile':
      ctx.beginPath()
      ctx.arc(x, y - 1.5, 3, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
      break
    case 'grin':
      ctx.beginPath()
      ctx.arc(x, y - 1, 4, 0.08 * Math.PI, 0.92 * Math.PI)
      ctx.closePath()
      ctx.fill()
      break
    case 'open':
      ellipse(ctx, x, y, 1.8, 2.5)
      break
    case 'frown':
      ctx.beginPath()
      ctx.arc(x, y + 2.5, 3, 1.2 * Math.PI, 1.8 * Math.PI)
      ctx.stroke()
      break
    case 'flat':
      ctx.fillRect(x - 4, y, 8, 1)
      break
    case 'small':
      ctx.fillRect(x - 1, y, 2, 1)
      break
    case 'smirk':
      ctx.beginPath()
      ctx.arc(x + 1.5, y - 1, 3.5, 0.3 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
  }
}

const EXPR: Expr[] = [
  { eye: 'dot', mouth: 'neutral' }, // 0 무표정
  { eye: 'dot', mouth: 'smile', blush: true }, // 1 웃음
  { eye: 'happy', mouth: 'grin', blush: true }, // 2 활짝
  { eye: 'wide', brow: 'raise', mouth: 'open' }, // 3 놀람
  { eye: 'dot', brow: 'down', mouth: 'frown' }, // 4 찡그림
  { eye: 'dot', brow: 'down', mouth: 'flat' }, // 5 화남
  { eye: 'dot', brow: 'up', mouth: 'frown', tear: true }, // 6 슬픔
  { eye: 'closed', mouth: 'neutral' }, // 7 눈 감음
  { eye: 'side', mouth: 'small' }, // 8 딴 데
  { eye: 'happy', eyeR: 'dot', mouth: 'smirk', blush: true }, // 9 능글
]

function drawFace(ctx: Ctx, e: Expr): void {
  drawBrow(ctx, EYE_L, 'L', e.brow)
  drawBrow(ctx, EYE_R, 'R', e.brow)
  drawEye(ctx, EYE_L, EYE_Y, e.eye)
  drawEye(ctx, EYE_R, EYE_Y, e.eyeR ?? e.eye)
  drawMouth(ctx, e.mouth)
}

/** 양자화 뒤에 얹는 것들 — 눈빛·눈물·볼 홍조. */
function drawFaceAccents(ctx: Ctx, e: Expr): void {
  drawEyeShine(ctx, EYE_L, EYE_Y, e.eye)
  drawEyeShine(ctx, EYE_R, EYE_Y, e.eyeR ?? e.eye)
  ctx.fillStyle = MID
  if (e.tear) ctx.fillRect(EYE_L + 2, EYE_Y + 2, 1, 3)
  if (e.blush) {
    ctx.fillRect(EYE_L - 3, EYE_Y + 3, 3, 1)
    ctx.fillRect(EYE_R + 1, EYE_Y + 3, 3, 1)
  }
}

// ── 도트화 ──────────────────────────────────────────────────────

/**
 * 곡선을 그리면 가장자리가 번진다. 픽셀마다 먹·살 둘 중 가까운 쪽으로 붙이고,
 * 반쯤 투명한 건 지운다. 그래야 다른 도트 그림과 같은 결이 난다.
 */
function quantize(ctx: Ctx): void {
  const img = ctx.getImageData(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) {
      d[i + 3] = 0
      continue
    }
    const dark = (d[i] + d[i + 1] + d[i + 2]) / 3 < 110
    const [r, g, b] = dark ? [0x0b, 0x0d, 0x0f] : [0xc9, 0xce, 0xd2]
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

const cache = new Map<string, HTMLCanvasElement>()

/** 32×32 얼굴 하나. 몸·옷은 없다 — 고르는 화면·명단 얼굴 아이콘 전용. */
export function portraitSprite(look: AvatarLook): HTMLCanvasElement {
  const color = look.color ?? 0
  const key = `${look.hair}-${look.face}-${color}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = PORTRAIT_SIZE
  c.height = PORTRAIT_SIZE
  const ctx = c.getContext('2d') as Ctx
  const e = EXPR[look.face % EXPR.length]
  drawEars(ctx)
  drawHead(ctx)
  drawFace(ctx, e)
  quantize(ctx)
  drawFaceAccents(ctx, e)
  // 머리는 맨 마지막 — 눈을 가리는 머리면 눈빛까지 덮어야 한다
  compositeHair(ctx, look.hair, color)
  cache.set(key, c)
  return c
}
