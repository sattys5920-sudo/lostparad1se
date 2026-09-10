// 32×32 얼굴 초상화 — 지도 위를 걷는 12×18 인형과는 다른 캔버스다.
//
// 완전한 원으로 그렸더니 굴곡이 없어 달걀귀신 같았다. 레퍼런스(RPG 만들기식
// 얼굴 시트, 도트 이모티콘 시트)의 얼굴은 원이 아니다 —
//   · 정수리는 넓고 둥글다
//   · 눈높이에서 볼이 가장 넓다
//   · 턱으로 갈수록 좁아져 바닥이 납작하다
//   · 눈은 아래쪽에 낮게 앉고 이마가 넓다
//   · 귀가 옆으로 살짝 튀어나온다
// 그 형태를 베지어 곡선 넷으로 잡고, 머리카락은 그 안에 클리핑해서 얹는다.
//
// 곡선은 안티앨리어싱이 걸리므로 다 그린 뒤 팔레트 두 색(먹·살)으로
// 양자화해서 도트로 만든다. 중간 톤(눈물·볼 홍조·머리끝)은 그 뒤에
// 사각형으로만 얹는다 — 사각형은 번지지 않는다.
import type { AvatarLook } from '../types'

export const PORTRAIT_SIZE = 32

const INK = '#0b0d0f'
const LIGHT = '#c9ced2'
const MID = '#5c646b'

const CX = 16
/** 정수리 · 턱 바닥 · 볼 반폭 · 볼이 가장 넓은 높이 */
const TOP = 3
const BOTTOM = 27.5
const HW = 12.5
const CHEEK_Y = 14

/** 머리 윤곽. 정수리는 넓게, 볼에서 가장 넓고, 턱으로 좁아진다. */
function headPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(CX, TOP)
  ctx.bezierCurveTo(CX + 7.5, TOP, CX + HW, 7.5, CX + HW, CHEEK_Y)
  ctx.bezierCurveTo(CX + HW, 21, CX + 6.5, BOTTOM, CX, BOTTOM)
  ctx.bezierCurveTo(CX - 6.5, BOTTOM, CX - HW, 21, CX - HW, CHEEK_Y)
  ctx.bezierCurveTo(CX - HW, 7.5, CX - 7.5, TOP, CX, TOP)
  ctx.closePath()
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
}

const EAR_Y = 15
const EAR_L = CX - HW - 1
const EAR_R = CX + HW + 1

function drawEars(ctx: CanvasRenderingContext2D): void {
  for (const x of [EAR_L, EAR_R]) {
    ctx.fillStyle = INK
    circle(ctx, x, EAR_Y, 2.6)
    ctx.fill()
    ctx.fillStyle = LIGHT
    circle(ctx, x, EAR_Y, 1.4)
    ctx.fill()
  }
}

function drawHead(ctx: CanvasRenderingContext2D): void {
  headPath(ctx)
  ctx.fillStyle = LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.stroke()
}

// ── 머리카락 ────────────────────────────────────────────────────

function withHeadClip(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save()
  headPath(ctx)
  ctx.clip()
  draw()
  ctx.restore()
}

/** 정수리부터 toY까지 이마를 덮는 캡. */
function cap(ctx: CanvasRenderingContext2D, toY: number): void {
  withHeadClip(ctx, () => {
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, PORTRAIT_SIZE, toY)
  })
}

/** 얼굴 양옆을 따라 내려오는 머리 — 레퍼런스의 「( )」 괄호. */
function sideLocks(ctx: CanvasRenderingContext2D, fromY: number, toY: number, width: number): void {
  withHeadClip(ctx, () => {
    ctx.fillStyle = INK
    ctx.fillRect(0, fromY, CX - HW + width, toY - fromY)
    ctx.fillRect(CX + HW - width, fromY, PORTRAIT_SIZE, toY - fromY)
  })
}

/** 스포츠머리 — 짧게 깎은 밑동을 점묘로. 중간 톤 없이 먹 점만으로 낸다. */
function stipple(ctx: CanvasRenderingContext2D, fromY: number, toY: number): void {
  withHeadClip(ctx, () => {
    ctx.fillStyle = INK
    for (let y = fromY; y < toY; y++) {
      for (let x = (y % 2 === 0 ? 0 : 1); x < PORTRAIT_SIZE; x += 2) ctx.fillRect(x, y, 1, 1)
    }
  })
}

function drawHair(ctx: CanvasRenderingContext2D, hair: number): void {
  switch (hair) {
    case 0: // 짧은 머리 — 이마 위까지만
      cap(ctx, 10)
      break
    case 1: // 단발 — 캡 + 양옆으로 턱까지 내려오는 괄호
      cap(ctx, 10)
      sideLocks(ctx, 8, BOTTOM, 4)
      break
    case 2: // 긴 머리 — 단발에 턱 아래로 두 가닥
      cap(ctx, 10)
      sideLocks(ctx, 8, BOTTOM, 4)
      ctx.fillStyle = INK
      ctx.fillRect(4, 19, 4, 12)
      ctx.fillRect(24, 19, 4, 12)
      break
    case 3: // 하나로 묶음 — 짧은 캡 + 뒤로 묶은 꼬리
      cap(ctx, 10)
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.ellipse(CX + HW + 1, 10, 2.6, 6.5, 0.25, 0, Math.PI * 2)
      ctx.fill()
      break
    case 4: // 양갈래 — 짧은 캡 + 양옆 동그라미
      cap(ctx, 10)
      ctx.fillStyle = INK
      circle(ctx, EAR_L - 0.5, 17, 3.6)
      ctx.fill()
      circle(ctx, EAR_R + 0.5, 17, 3.6)
      ctx.fill()
      break
    case 5: // 스포츠머리 — 정수리만 덮고 그 아래는 점묘
      cap(ctx, 6)
      stipple(ctx, 6, 10)
      break
    case 6: // 곱슬 — 작은 동그라미를 이어붙여 테두리를 둥글둥글하게
      withHeadClip(ctx, () => {
        ctx.fillStyle = INK
        const bumps: [number, number][] = [
          [7, 9], [11, 5], [16, 4], [21, 5], [25, 9],
          [4.5, 13], [27.5, 13], [4, 17], [28, 17],
        ]
        for (const [x, y] of bumps) {
          circle(ctx, x, y, 3.6)
          ctx.fill()
        }
      })
      break
    case 7: // 앞머리 — 눈썹 바로 위까지 일자로 덮는다
      cap(ctx, 13)
      sideLocks(ctx, 8, 22, 3)
      break
    case 8: { // 가르마 — 캡에 이마까지 이어지는 갈림선
      cap(ctx, 10)
      ctx.fillStyle = LIGHT
      ctx.beginPath()
      ctx.moveTo(CX - 2, TOP + 1)
      ctx.lineTo(CX + 1, TOP + 1)
      ctx.lineTo(CX - 3, 10)
      ctx.lineTo(CX - 5, 10)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 9: // 쪽머리 — 짧은 캡 + 정수리 위 작은 쪽
      cap(ctx, 10)
      ctx.fillStyle = INK
      circle(ctx, CX, TOP + 0.5, 3.2)
      ctx.fill()
      break
  }
}

/** 양자화 뒤에 얹는 중간 톤 장식. 사각형이라 번지지 않는다. */
function drawHairAccents(ctx: CanvasRenderingContext2D, hair: number): void {
  ctx.fillStyle = MID
  if (hair === 2) {
    ctx.fillRect(4, 29, 4, 2)
    ctx.fillRect(24, 29, 4, 2)
  }
  if (hair === 7) ctx.fillRect(CX - 7, 13, 14, 1)
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

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, style: EyeStyle): void {
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
      circle(ctx, x, y, 2.6)
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
function drawEyeShine(ctx: CanvasRenderingContext2D, x: number, y: number, style: EyeStyle): void {
  if (style !== 'dot' && style !== 'side') return
  ctx.fillStyle = LIGHT
  ctx.fillRect(style === 'side' ? x + 2 : x, y - 1, 1, 1)
}

function drawBrow(ctx: CanvasRenderingContext2D, x: number, side: 'L' | 'R', style: Expr['brow']): void {
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

function drawMouth(ctx: CanvasRenderingContext2D, style: MouthStyle): void {
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
      ctx.beginPath()
      ctx.ellipse(x, y, 1.8, 2.5, 0, 0, Math.PI * 2)
      ctx.fill()
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

function drawFace(ctx: CanvasRenderingContext2D, e: Expr): void {
  drawBrow(ctx, EYE_L, 'L', e.brow)
  drawBrow(ctx, EYE_R, 'R', e.brow)
  drawEye(ctx, EYE_L, EYE_Y, e.eye)
  drawEye(ctx, EYE_R, EYE_Y, e.eyeR ?? e.eye)
  drawMouth(ctx, e.mouth)
}

/** 양자화 뒤에 얹는 것들 — 눈빛·눈물·볼 홍조. */
function drawFaceAccents(ctx: CanvasRenderingContext2D, e: Expr): void {
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
function quantize(ctx: CanvasRenderingContext2D): void {
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
  const key = `${look.hair}-${look.face}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = PORTRAIT_SIZE
  c.height = PORTRAIT_SIZE
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  const e = EXPR[look.face % EXPR.length]
  drawEars(ctx)
  drawHead(ctx)
  drawHair(ctx, look.hair)
  drawFace(ctx, e)
  quantize(ctx)
  drawHairAccents(ctx, look.hair)
  drawFaceAccents(ctx, e)
  cache.set(key, c)
  return c
}
