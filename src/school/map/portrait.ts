// 32×32 얼굴 초상화 — 지도 위를 걷는 12×18 인형과는 다른 캔버스다.
// 그 안에서는 얼굴 폭이 6~8칸뿐이라 눈 하나 놓을 자리가 1~2칸이었고,
// 아무리 다시 그려도 테두리에 들러붙었다. 여기서는 원을 좌표식(circle)으로
// 그려 둥글기를 계산으로 보장하고, 눈·눈썹·입도 곡선으로 그릴 만큼 자리를 둔다.
// 머리카락도 머리 원에 클리핑해서 얹기 때문에 어떤 스타일을 얹어도
// 윤곽 자체는 항상 완전한 원으로 남는다.
import type { AvatarLook } from '../types'

export const PORTRAIT_SIZE = 32

const INK = '#0b0d0f'
const LIGHT = '#c9ced2'
const MID = '#5c646b'

const CX = 16
const CY = 16
const R_OUT = 14
const R_IN = 12

function circlePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
}

function drawHead(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = INK
  circlePath(ctx, CX, CY, R_OUT)
  ctx.fill()
  ctx.fillStyle = LIGHT
  circlePath(ctx, CX, CY, R_IN)
  ctx.fill()
}

// ── 머리카락 ────────────────────────────────────────────────────
// 머리 원에 클리핑해서 얹는다. 무엇을 얹든 윤곽 자체는 늘 완전한 원이다.
// 길이·장식만 스타일마다 다르다.

function withHeadClip(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save()
  circlePath(ctx, CX, CY, R_OUT)
  ctx.clip()
  draw()
  ctx.restore()
}

/** 정수리부터 y줄까지 이마를 덮는 기본 앞머리 캡. */
function cap(ctx: CanvasRenderingContext2D, toY: number): void {
  withHeadClip(ctx, () => {
    ctx.fillStyle = INK
    ctx.fillRect(CX - R_OUT, CY - R_OUT, R_OUT * 2, toY - (CY - R_OUT))
  })
}

function drawHair(ctx: CanvasRenderingContext2D, hair: number): void {
  switch (hair) {
    case 0: // 짧은 머리 — 이마 위까지만
      cap(ctx, CY - 6)
      break
    case 1: // 단발 — 귀선까지, 아래는 일자로 자른다
      cap(ctx, CY + 2)
      break
    case 2: // 긴 머리 — 단발에 어깨까지 두 가닥을 늘어뜨린다
      cap(ctx, CY + 2)
      ctx.fillStyle = INK
      ctx.fillRect(CX - R_OUT - 1, CY - 1, 3, 11)
      ctx.fillRect(CX + R_OUT - 2, CY - 1, 3, 11)
      ctx.fillStyle = MID
      ctx.fillRect(CX - R_OUT - 1, CY + 8, 3, 2)
      ctx.fillRect(CX + R_OUT - 2, CY + 8, 3, 2)
      break
    case 3: // 하나로 묶음 — 짧은 캡 + 뒤로 묶은 꼬리
      cap(ctx, CY - 6)
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.ellipse(CX + R_OUT + 1, CY - 2, 3, 6, 0.3, 0, Math.PI * 2)
      ctx.fill()
      break
    case 4: // 양갈래 — 짧은 캡 + 양옆 동그라미
      cap(ctx, CY - 6)
      ctx.fillStyle = INK
      circlePath(ctx, CX - R_OUT + 1, CY, 4)
      ctx.fill()
      circlePath(ctx, CX + R_OUT - 1, CY, 4)
      ctx.fill()
      break
    case 5: // 스포츠머리 — 아주 짧게, 정수리만
      cap(ctx, CY - 9)
      break
    case 6: // 곱슬 — 캡 대신 작은 동그라미를 이어붙여 둥글둥글한 테두리를 만든다
      withHeadClip(ctx, () => {
        ctx.fillStyle = INK
        const bumps: [number, number][] = [
          [CX - 9, CY - 8], [CX - 4, CY - 11], [CX + 1, CY - 12],
          [CX + 6, CY - 11], [CX + 10, CY - 7], [CX - 11, CY - 3], [CX + 12, CY - 2],
        ]
        for (const [x, y] of bumps) {
          circlePath(ctx, x, y, 4)
          ctx.fill()
        }
      })
      break
    case 7: // 앞머리 — 이마 아래까지 덮고, 가장자리에 한 줄 그어 앞머리 선을 낸다
      cap(ctx, CY - 3)
      ctx.fillStyle = MID
      ctx.fillRect(CX - 8, CY - 4, 16, 1)
      break
    case 8: { // 가르마 — 캡에 이마까지 이어지는 갈림선을 낸다
      cap(ctx, CY - 6)
      ctx.fillStyle = LIGHT
      ctx.beginPath()
      ctx.moveTo(CX - 2, CY - R_OUT)
      ctx.lineTo(CX + 1, CY - R_OUT)
      ctx.lineTo(CX - 3, CY - 6)
      ctx.lineTo(CX - 5, CY - 6)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 9: // 쪽머리 — 짧은 캡 + 정수리 위 작은 쪽
      cap(ctx, CY - 6)
      ctx.fillStyle = INK
      circlePath(ctx, CX, CY - R_OUT - 1, 3)
      ctx.fill()
      break
  }
}

// ── 표정 ────────────────────────────────────────────────────────
// 32칸이면 곡선을 그릴 자리가 있다 — 점 하나로 뭉개지 않고 웃는 눈,
// 처진 눈, 뜬 눈을 실제로 다른 곡선으로 그린다.

type EyeStyle = 'dot' | 'happy' | 'sad' | 'wide' | 'closed' | 'side'
type MouthStyle = 'neutral' | 'smile' | 'grin' | 'open' | 'frown' | 'flat' | 'small' | 'smirk'

interface Expr {
  eye: EyeStyle
  eyeR?: EyeStyle
  brow?: 'flat' | 'down' | 'up' | 'raise'
  mouth: MouthStyle
  tear?: boolean
  blush?: boolean
}

const EYE_L = CX - 5
const EYE_R = CX + 5
const EYE_Y = CY - 1
const MOUTH_Y = CY + 6

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, style: EyeStyle): void {
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  switch (style) {
    case 'dot':
      ctx.fillRect(x - 1, y - 1, 2, 2)
      break
    case 'wide':
      ctx.lineWidth = 1
      circlePath(ctx, x, y, 2)
      ctx.stroke()
      ctx.fillRect(x - 1, y - 1, 1, 1)
      break
    case 'happy':
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(x, y + 1, 2.4, Math.PI, Math.PI * 2)
      ctx.stroke()
      break
    case 'sad':
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(x, y - 1, 2.4, 0, Math.PI)
      ctx.stroke()
      break
    case 'closed':
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(x - 2, y)
      ctx.lineTo(x + 2, y)
      ctx.stroke()
      break
    case 'side':
      ctx.fillRect(x, y - 1, 2, 2)
      break
  }
}

function drawBrow(ctx: CanvasRenderingContext2D, x: number, y: number, side: 'L' | 'R', style: Expr['brow']): void {
  if (!style || style === 'flat') return
  const dir = side === 'L' ? 1 : -1
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2
  ctx.beginPath()
  if (style === 'down') {
    // 화남·찡그림 — 안쪽이 처진 八자
    ctx.moveTo(x - 3 * dir, y - 1)
    ctx.lineTo(x + 2 * dir, y + 1)
  } else if (style === 'up') {
    // 슬픔 — 안쪽이 올라간 八자
    ctx.moveTo(x - 3 * dir, y + 1)
    ctx.lineTo(x + 2 * dir, y - 1)
  } else if (style === 'raise') {
    // 놀람 — 둘 다 위로
    ctx.moveTo(x - 3, y)
    ctx.lineTo(x + 3, y - 1)
  }
  ctx.stroke()
}

function drawMouth(ctx: CanvasRenderingContext2D, style: MouthStyle): void {
  const x = CX
  const y = MOUTH_Y
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  switch (style) {
    case 'neutral':
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(x - 2, y)
      ctx.lineTo(x + 2, y)
      ctx.stroke()
      break
    case 'smile':
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(x, y - 1, 2.6, 0.25 * Math.PI, 0.75 * Math.PI)
      ctx.stroke()
      break
    case 'grin':
      ctx.beginPath()
      ctx.arc(x, y - 1, 4, 0.12 * Math.PI, 0.88 * Math.PI)
      ctx.lineTo(x + 3, y - 1)
      ctx.closePath()
      ctx.fill()
      break
    case 'open':
      ctx.beginPath()
      ctx.ellipse(x, y, 1.6, 2.2, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'frown':
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(x, y + 2, 2.6, 1.25 * Math.PI, 1.75 * Math.PI)
      ctx.stroke()
      break
    case 'flat':
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(x - 4, y)
      ctx.lineTo(x + 4, y)
      ctx.stroke()
      break
    case 'small':
      ctx.fillRect(x - 1, y, 2, 1)
      break
    case 'smirk':
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(x + 1, y, 3, 0.3 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
  }
}

const EXPR: Expr[] = [
  { eye: 'dot', mouth: 'neutral' }, // 0 무표정
  { eye: 'dot', mouth: 'smile' }, // 1 웃음
  { eye: 'happy', mouth: 'grin' }, // 2 활짝
  { eye: 'wide', brow: 'raise', mouth: 'open' }, // 3 놀람
  { eye: 'dot', brow: 'down', mouth: 'frown' }, // 4 찡그림
  { eye: 'dot', brow: 'down', mouth: 'flat' }, // 5 화남
  { eye: 'dot', brow: 'up', mouth: 'frown', tear: true }, // 6 슬픔
  { eye: 'closed', mouth: 'neutral' }, // 7 눈 감음
  { eye: 'side', mouth: 'small' }, // 8 딴 데
  { eye: 'happy', eyeR: 'dot', mouth: 'smirk' }, // 9 능글
]

function drawFace(ctx: CanvasRenderingContext2D, face: number): void {
  const e = EXPR[face % EXPR.length]
  drawBrow(ctx, EYE_L, EYE_Y - 3, 'L', e.brow)
  drawBrow(ctx, EYE_R, EYE_Y - 3, 'R', e.brow)
  drawEye(ctx, EYE_L, EYE_Y, e.eye)
  drawEye(ctx, EYE_R, EYE_Y, e.eyeR ?? e.eye)
  drawMouth(ctx, e.mouth)
  if (e.tear) {
    ctx.fillStyle = MID
    ctx.fillRect(EYE_L - 1, EYE_Y + 3, 1, 2)
  }
  if (e.blush) {
    ctx.fillStyle = MID
    ctx.fillRect(EYE_L - 1, EYE_Y + 3, 2, 1)
    ctx.fillRect(EYE_R - 1, EYE_Y + 3, 2, 1)
  }
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
  drawHead(ctx)
  drawHair(ctx, look.hair)
  drawFace(ctx, look.face)
  cache.set(key, c)
  return c
}
