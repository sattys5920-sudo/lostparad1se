// 오버월드 도트 캐릭터 — 레퍼런스 시트 규격.
//
// 머리도 몸도 픽셀 맵을 코드에 그대로 박아 둔다. 좌표를 계산으로 만들면
// 두 칸짜리 팔다리가 통째로 테두리색이 되거나 손이 떠 버리는 사고가 난다.
// 맵은 "이 칸이 무엇인지"를 글자로 적어 둔 것이고, 색은 교복·머리색에 따라
// 나중에 입힌다.
//
//   머리  7~19줄 (14×13) — 정면·옆 두 장, 뒤는 정면을 머리카락으로 채운다
//   몸   20~30줄 (맵 폭 14칸, 실제 몸 폭 12칸) — 머리보다 좁다
//   걷기 프레임에서는 팔과 다리만 바뀐다. 몸통은 들썩이지 않는다.
//
// 테두리는 한 색이 아니다. 닿아 있는 색을 어둡게 한 값을 쓴다 —
// 머리 테두리는 가장 어두운 머리색, 살 테두리는 진한 갈색.
import { BAND_TONES, BLUSH_TONE, CLOTH, HAIR_COLORS, MOUTH_TONE, SHOE_TONE, tone, type Tone } from './palette'
import type { AvatarLook, TeamId } from '../types'

export const PX = 32
/** 시트 한 칸. 32×32 스프라이트를 가운데 둔다. */
export const CELL = 64

export type Dir = 'down' | 'left' | 'right' | 'up'
export type Pose = 0 | 1 | 2
/** 걷기 4프레임: 서기 → 걸음A → 서기 → 걸음B */
export const WALK: readonly Pose[] = [0, 1, 0, 2]
export const DIRS: readonly Dir[] = ['down', 'left', 'right', 'up']

const SKIN = tone('#e6c9a8')
/** 눈은 살보다 훨씬 어두운 한 색. 표정 맵의 E 칸이다. */
const EYE = tone('#3a3040')

type Mat =
  | 'skin'
  | 'hair'
  | 'shirt'
  | 'collar'
  | 'stripe'
  | 'accent'
  | 'bottom'
  | 'shoe'
  | 'eye'
  | 'mouth'
  | 'blush'
  | 'band'
/**
 * 칸 하나가 쓸 색. 'auto'는 실루엣 둘레면 테두리, 아니면 바탕.
 * 맵에서 온 칸은 색을 직접 지정한다.
 */
type Shade = 'auto' | 'base' | 'line' | 'light' | 'shade'

/** [y, x0, x1] — 양끝 포함 */
type Row = readonly [number, number, number]

/**
 * 레이어 순서. 뒷머리(0)는 몸보다 뒤, 머리통(8)은 옷보다 앞이다.
 * 완장은 소매 위에 덮어 그려야 하므로 옷보다 위, 머리보다 아래에 둔다.
 */
const MAT_LAYER: Record<Mat, number> = {
  skin: 1,
  bottom: 2,
  shirt: 3,
  collar: 4,
  stripe: 4,
  shoe: 5,
  accent: 6,
  band: 7,
  eye: 9,
  mouth: 9,
  blush: 9,
  hair: 8,
}

// ── 머리통 맵 ───────────────────────────────────────────────────
// O=테두리 H=머리카락 h=윤기 S=살 E=눈 .=투명

const FRONT_MAP = [
  '....OOOOOO....',
  '..OOHHHHHHOO..',
  '.OHHhhHHHHHHO.',
  'OHHhHHHHHHHHHO',
  'OHHHHHHHHHHHHO',
  'OHHHHHHHHHHHHO',
  'OHHSSSHSSSSHHO',
  'OHHSSSSSSSSHHO',
  'OHHSESSSSESHHO',
  'OHHSESSSSESHHO',
  'OHHSSSSSSSSHHO',
  '.OHHSSSSSSHHO.',
  '..OOOOOOOOOO..',
]

const SIDE_MAP = [
  '....OOOOOO....',
  '..OOHHHHHHOO..',
  '.OHHhhhHHHHHO.',
  'OHHHHhHHHHHHHO',
  'OHHHHHHHHHHHHO',
  'OHHHHHHHHHHHHO',
  'OHHHHHHHHHHHHO',
  'OHHHHHHHSSSSSO',
  'OHHHHHHHSSSESO',
  'OHHHHHHHSSSESO',
  '.OHHHHHHSSSSSO',
  '..OHHHHHSSSSO.',
  '...OOOOOOOOO..',
]

/** 맵 왼쪽 위가 캔버스에서 놓이는 자리 */
const HEAD_X = 9
const HEAD_Y = 7
const HEAD_BOTTOM = HEAD_Y + FRONT_MAP.length - 1
/** 몸은 머리 윤곽 바로 아래에서 시작한다 */
const BODY_X = 9
const BODY_Y = HEAD_BOTTOM + 1

interface Pix {
  x: number
  y: number
  mat: Mat
  shade: Shade
}

/** 머리 맵을 칸 목록으로 편다. O는 이웃을 보고 머리 테두리인지 살 테두리인지 정한다. */
function readHead(map: string[]): Pix[] {
  const out: Pix[] = []
  const at = (x: number, y: number) => map[y]?.[x] ?? '.'
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const c = at(x, y)
      if (c === '.') continue
      let mat: Mat = 'hair'
      let shade: Shade = 'base'
      if (c === 'S') mat = 'skin'
      else if (c === 'E') mat = 'eye'
      else if (c === 'h') shade = 'light'
      else if (c === 'O') {
        const near = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)]
        mat = near.some((n) => n === 'S' || n === 'E') && !near.includes('H') ? 'skin' : 'hair'
        shade = 'line'
      }
      out.push({ x: HEAD_X + x, y: HEAD_Y + y, mat, shade })
    }
  }
  return out
}

const HEAD_FRONT = readHead(FRONT_MAP)
const HEAD_SIDE = readHead(SIDE_MAP)
/** 뒷모습 — 정면과 같은 윤곽에 머리카락만 채운다. */
const HEAD_BACK: Pix[] = HEAD_FRONT.map((p) =>
  p.mat === 'skin' || p.mat === 'eye' ? { ...p, mat: 'hair' as Mat, shade: p.shade === 'line' ? 'line' : 'base' } : p,
)

/** 머릿결 — 넓은 머리 면에 어두운 줄 두세 개. */
const STRANDS_FRONT: [number, number][] = [[11, 10], [20, 11], [12, 8]]
const STRANDS_SIDE: [number, number][] = [[12, 11], [15, 8], [11, 14]]

// ── 몸 맵 ───────────────────────────────────────────────────────
// O=테두리 W=셔츠 w=셔츠 그늘(소매) T=넥타이 K=손(살)
// D=바지·치마 d=밑단 그늘 L=다리 F=신발 .=투명
//
// 팔은 속이 찬 소매다 — 가운데 한 칸에 양옆 테두리. 몸통에 붙어 있고
// 손은 소매 끝에 붙은 살 한 칸이다. 다리는 두 칸씩 채우고 테두리로 가른다.
// 신발은 다리 바로 아래에 붙는다. 몸 전체가 끊기지 않은 한 덩어리다.

const BODY_FRONT_IDLE = [
  '...OWWTTWWO...',
  '..OWWWTTWWWO..',
  '.OwOWWTTWWOwO.',
  '.OwOWWTTWWOwO.',
  '.OwOwWWWWwOwO.',
  '.OKODDDDDDOKO.',
  '..OODDDDDDOO..',
  '...OddddddO...',
  '...OLLOOLLO...',
  '...OFFOOFFO...',
  '...OOOOOOOO...',
]

const BODY_FRONT_STEP = [
  '...OWWTTWWO...',
  '..OWWWTTWWWO..',
  '.OwOWWTTWWOwO.',
  '.OwOWWTTWWOwO.',
  '.OKOwWWWWwOwO.',
  '..OODDDDDDOKO.',
  '...ODDDDDDOO..',
  '...OddddddO...',
  '...OLLOOLLO...',
  '...OFFOOLLO...',
  '...OOOOOFFO...',
  '.......OOOO...',
]

const BODY_SIDE_IDLE = [
  '....OWWWWO....',
  '...OWWWWWWO...',
  '...OWOwwOWO...',
  '...OWOwwOWO...',
  '...OWOwwOWO...',
  '...ODOKKODO...',
  '...ODDOODDO...',
  '...OddddddO...',
  '....OLLLLO....',
  '....OFFFFFO...',
  '....OOOOOOO...',
]

/** 걸음A — 팔은 앞으로, 다리는 八자로 */
const BODY_SIDE_STEP_A = [
  '....OWWWWO....',
  '...OWWWWWWO...',
  '...OWOwwOWO...',
  '...OWWOwwOO...',
  '...OWWWOwwO...',
  '...ODDDOKKO...',
  '...ODDDDOOO...',
  '...OddddddO...',
  '...OLLOOLLO...',
  '..OLLO..OLLO..',
  '..OFFFO.OFFFO.',
  '..OOOOO.OOOOO.',
]

/** 걸음B — 걸음A에서 팔만 뒤로. 팔이 있는 3~6줄을 좌우로 뒤집었다. */
const BODY_SIDE_STEP_B = [
  '....OWWWWO....',
  '...OWWWWWWO...',
  '...OWOwwOWO...',
  '...OOwwOWWO...',
  '...OwwOWWWO...',
  '...OKKODDDO...',
  '...OOODDDDO...',
  '...OddddddO...',
  '...OLLOOLLO...',
  '..OLLO..OLLO..',
  '..OFFFO.OFFFO.',
  '..OOOOO.OOOOO.',
]

const mirrorMap = (map: string[]): string[] => map.map((r) => [...r].reverse().join(''))
/** 뒷모습 — 정면 맵에서 넥타이만 셔츠로 바꾼다. */
const backOf = (map: string[]): string[] => map.map((r) => r.replace(/T/g, 'W'))

function bodyMap(dir: Dir, pose: Pose): string[] {
  if (dir === 'right') return pose === 0 ? BODY_SIDE_IDLE : pose === 1 ? BODY_SIDE_STEP_A : BODY_SIDE_STEP_B
  const front = pose === 0 ? BODY_FRONT_IDLE : pose === 1 ? BODY_FRONT_STEP : mirrorMap(BODY_FRONT_STEP)
  return dir === 'up' ? backOf(front) : front
}

/** 소매가 놓인 칸 — 완장과 반팔 처리에 쓴다. */
const ARM_COLS_FRONT = [2, 11]
const ARM_COLS_SIDE = [6, 7, 8, 9]

// ── 머리 모양 15종 ──────────────────────────────────────────────
// 머리통 맵은 건드리지 않는다. 앞머리가 어디까지 내려오는지, 옆머리가 몸통
// 옆으로 얼마나 흐르는지, 뒤로 무엇이 달렸는지만 다르다.

type Bangs = 'full' | 'part' | 'straight' | 'short' | 'spiky'
type Extra = 'twin' | 'lowTwin' | 'pony' | 'highPony' | 'sidePony' | 'braid' | 'bun' | null

interface HairSpec {
  name: string
  bangs: Bangs
  /** 옆머리가 몸통 옆으로 내려오는 줄. 0이면 머리통 안에서 끝난다. */
  sideTo: number
  /** 옆·뒷모습에서 등을 타고 내려오는 줄. 0이면 없다. */
  backTo: number
  extra: Extra
}

export const HAIR_SPECS: HairSpec[] = [
  { name: '기본 단발', bangs: 'full', sideTo: 0, backTo: 21, extra: null },
  { name: '긴 생머리', bangs: 'full', sideTo: 25, backTo: 25, extra: null },
  { name: '양갈래', bangs: 'full', sideTo: 0, backTo: 0, extra: 'twin' },
  { name: '낮은 양갈래', bangs: 'full', sideTo: 0, backTo: 20, extra: 'lowTwin' },
  { name: '포니테일', bangs: 'full', sideTo: 0, backTo: 0, extra: 'pony' },
  { name: '높은 포니테일', bangs: 'short', sideTo: 0, backTo: 0, extra: 'highPony' },
  { name: '숏컷', bangs: 'part', sideTo: 0, backTo: 0, extra: null },
  { name: '웨이브 단발', bangs: 'full', sideTo: 22, backTo: 22, extra: null },
  { name: '긴 웨이브', bangs: 'full', sideTo: 26, backTo: 26, extra: null },
  { name: '앞머리 일자 단발', bangs: 'straight', sideTo: 23, backTo: 23, extra: null },
  { name: '사이드 포니테일', bangs: 'part', sideTo: 0, backTo: 0, extra: 'sidePony' },
  { name: '땋은 머리', bangs: 'full', sideTo: 0, backTo: 0, extra: 'braid' },
  { name: '반묶음', bangs: 'full', sideTo: 24, backTo: 24, extra: 'bun' },
  { name: '보브컷', bangs: 'full', sideTo: 21, backTo: 21, extra: null },
  { name: '헝클어진 짧은 머리', bangs: 'spiky', sideTo: 0, backTo: 0, extra: null },
]

export const HAIR_NAMES = HAIR_SPECS.map((h) => h.name)

/** 얼굴이 시작하는 줄. 앞머리는 눈높이 아래로 내려오지 않는다. */
const FACE_TOP = HEAD_Y + 6

function bangRows(bangs: Bangs, dir: Dir): Row[] {
  if (dir === 'right') return []
  const out: Row[] = []
  switch (bangs) {
    case 'straight':
      out.push([FACE_TOP, 12, 19], [FACE_TOP + 1, 12, 19])
      break
    case 'full':
      out.push([FACE_TOP, 12, 19])
      break
    case 'part':
      out.push([FACE_TOP, 12, 15])
      break
    case 'short':
      break
    case 'spiky':
      out.push([HEAD_Y - 1, 13, 14], [HEAD_Y - 1, 17, 18], [HEAD_Y - 2, 17, 17])
      break
  }
  return out
}

/** 몸통 옆으로 흐르는 옆머리. 폭 두 칸, 몸(10~21칸) 바깥에 붙는다. */
function sideStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.sideTo || dir === 'right') return []
  const out: Row[] = []
  for (let y = HEAD_BOTTOM; y <= spec.sideTo; y++) {
    out.push([y, 8, 9])
    out.push([y, 22, 23])
  }
  return out
}

/** 등을 타고 내려오는 뒷머리. 넉 줄을 넘지 않고 몸을 덮지 않는다. */
function backStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.backTo) return []
  const out: Row[] = []
  if (dir === 'right') for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 10, 13])
  else if (dir === 'up') for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 11, 20])
  return out
}

/** 묶은 머리 — 3칸 다발. 머리통에 붙어 어깨 높이에서 끝난다. */
function tails(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  const near = dir === 'right'
  const bunch = (x0: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) out.push([y, x0, x0 + 2])
  }
  switch (spec.extra) {
    case 'twin':
      bunch(7, 15, 20)
      if (!near) bunch(22, 15, 20)
      break
    case 'lowTwin':
      bunch(7, 18, 23)
      if (!near) bunch(22, 18, 23)
      break
    case 'pony':
      bunch(near ? 7 : 22, 14, 21)
      break
    case 'highPony':
      out.push([HEAD_Y, 19, 21])
      bunch(near ? 7 : 21, 8, 19)
      break
    case 'sidePony':
      bunch(near ? 7 : 22, 15, 22)
      break
    case 'braid':
      for (let y = 16; y <= 24; y += 2) {
        out.push([y, 7, 9], [y + 1, 8, 9])
        if (!near) out.push([y, 22, 24], [y + 1, 22, 23])
      }
      break
    case 'bun':
      out.push([HEAD_Y - 2, 14, 17], [HEAD_Y - 1, 14, 17])
      break
    default:
      break
  }
  return out
}

// ── 표정 ────────────────────────────────────────────────────────
// 얼굴 눈 주변 8×4 칸만 통째로 갈아 끼운다. 머리통 맵은 건드리지 않으므로
// 어떤 표정을 골라도 얼굴 크기와 눈 위치가 변하지 않는다.
//
//   S=피부  E=눈  M=입  P=볼터치
//
// 블록 왼쪽 위를 (12,14)에 놓으면 E가 맵의 눈 자리(x13·x18, y15·16)에
// 정확히 얹힌다.

const FACE_X = HEAD_X + 3
const FACE_Y = HEAD_Y + 7

export interface ExpressionSpec {
  name: string
  map: string[]
}

export const EXPRESSIONS: ExpressionSpec[] = [
  { name: '기본', map: ['SSSSSSSS', 'SESSSSES', 'SESSSSES', 'SSSSSSSS'] },
  { name: '웃음', map: ['SSSSSSSS', 'SESSSSES', 'ESESSESE', 'PSSMMSSP'] },
  { name: '화남', map: ['ESSSSSSE', 'SESSSSES', 'SESSSSES', 'SSSMMSSS'] },
  { name: '졸림', map: ['SSSSSSSS', 'SSSSSSSS', 'SEESSEES', 'SSSSSSSS'] },
  { name: '놀람', map: ['SSSSSSSS', 'SEESSEES', 'SEESSEES', 'SSSMMSSS'] },
  { name: '시무룩', map: ['SSESSESS', 'SESSSSES', 'SESSSSES', 'SSSSSSSS'] },
]

export const EXPRESSION_NAMES = EXPRESSIONS.map((e) => e.name)

/** 옆얼굴에서 눈 한 칸이 앉는 자리 */
const SIDE_EYE_X = HEAD_X + 11
/** 표정 맵에서 오른쪽 눈이 있는 칸 */
const RIGHT_EYE_COL = 6

function facePix(expression: number, dir: Dir): Pix[] {
  if (dir === 'up') return []
  const spec = EXPRESSIONS[expression % EXPRESSIONS.length]
  const out: Pix[] = []
  for (let r = 0; r < spec.map.length; r++) {
    for (let c = 0; c < spec.map[r].length; c++) {
      const ch = spec.map[r][c]
      if (dir === 'right') {
        // 옆모습은 오른쪽 눈만 쓰고 입은 생략한다
        if (ch !== 'E' || c < 4) continue
        out.push({ x: SIDE_EYE_X - RIGHT_EYE_COL + c, y: FACE_Y + r, mat: 'eye', shade: 'base' })
        continue
      }
      const x = FACE_X + c
      const y = FACE_Y + r
      if (ch === 'S') out.push({ x, y, mat: 'skin', shade: 'base' })
      else if (ch === 'E') out.push({ x, y, mat: 'eye', shade: 'base' })
      else if (ch === 'M') out.push({ x, y, mat: 'mouth', shade: 'base' })
      else if (ch === 'P') out.push({ x, y, mat: 'blush', shade: 'base' })
    }
  }
  return out
}

// ── 옷 6종 + 하의 토글 ──────────────────────────────────────────
// 몸 실루엣 맵은 절대 건드리지 않는다. 색과 1픽셀 디테일만 바꾼다.

interface OutfitSpec {
  name: string
  /** 상의 바탕 */
  top: Tone
  /** 넥타이·스카프·단추 — 몸 맵의 T 칸 */
  accent?: Tone
  /** 단추면 T 두 칸 중 왼쪽 한 칸만 쓴다 */
  buttons?: boolean
  /** 상의 맨 윗줄을 덮는 깃(세일러 두 줄, 후드 한 줄) */
  collar?: Tone
  collarRows?: number
  /** 소매를 타고 내려가는 줄(체육복) */
  stripe?: Tone
  /** 아래옷 색 */
  bottom: Tone
}

export const OUTFITS: OutfitSpec[] = [
  { name: '셔츠 + 넥타이', top: CLOTH.shirt, accent: CLOTH.wine, bottom: CLOTH.charcoal },
  { name: '블레이저', top: CLOTH.navy, accent: CLOTH.red, collar: CLOTH.shirt, collarRows: 1, bottom: CLOTH.navy },
  { name: '세일러복', top: CLOTH.shirt, accent: CLOTH.red, collar: CLOTH.navy, collarRows: 2, bottom: CLOTH.navy },
  { name: '가디건', top: CLOTH.beige, accent: CLOTH.brown, buttons: true, bottom: CLOTH.charcoal },
  { name: '후드티', top: CLOTH.grey, collar: CLOTH.charcoal, collarRows: 1, bottom: CLOTH.denim },
  { name: '체육복', top: CLOTH.navy, stripe: CLOTH.shirt, bottom: CLOTH.navy },
]

export const OUTFIT_NAMES = OUTFITS.map((o) => o.name)

/** 몸 맵의 글자 하나를 재질과 색으로 바꾼다. */
function roleOf(
  c: string,
  o: OutfitSpec,
  x: number,
  y: number,
  side: boolean,
  skirt: boolean,
): { mat: Mat; shade: Shade } | null {
  const onArm = (side ? ARM_COLS_SIDE : ARM_COLS_FRONT).includes(x)
  const onCollar = o.collar !== undefined && y < (o.collarRows ?? 1)
  switch (c) {
    case 'W':
      if (onCollar) return { mat: 'collar', shade: 'base' }
      return { mat: 'shirt', shade: 'base' }
    case 'w':
      if (onArm && o.stripe) return { mat: 'stripe', shade: 'base' }
      if (onCollar) return { mat: 'collar', shade: 'shade' }
      return { mat: 'shirt', shade: 'shade' }
    case 'T':
      // 가디건 단추는 한 칸짜리 세로줄이다
      if (o.buttons && x % 2 === 1) return { mat: 'shirt', shade: 'base' }
      if (onCollar && o.collar) return { mat: 'collar', shade: 'base' }
      return o.accent ? { mat: 'accent', shade: 'base' } : { mat: 'shirt', shade: 'base' }
    case 'K':
      return { mat: 'skin', shade: 'base' }
    case 'D':
      return { mat: 'bottom', shade: 'base' }
    case 'd':
      return { mat: 'bottom', shade: 'shade' }
    case 'L':
      return { mat: skirt ? 'skin' : 'bottom', shade: 'base' }
    case 'F':
      return { mat: 'shoe', shade: 'base' }
    default:
      return null
  }
}

/** 몸 맵을 칸 목록으로 편다. O는 이웃 글자를 보고 어느 색의 테두리인지 정한다. */
function readBody(map: string[], o: OutfitSpec, side: boolean, skirt: boolean): Pix[] {
  const out: Pix[] = []
  const at = (x: number, y: number) => map[y]?.[x] ?? '.'
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const c = at(x, y)
      if (c === '.') continue
      let cell = roleOf(c, o, x, y, side, skirt)
      if (c === 'O') {
        const near = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)]
          .map((n, i) => roleOf(n, o, i === 2 ? x - 1 : i === 3 ? x + 1 : x, y + (i === 0 ? -1 : i === 1 ? 1 : 0), side, skirt))
          .find((r) => r !== null)
        cell = { mat: near?.mat ?? 'shirt', shade: 'line' }
      }
      if (!cell) continue
      out.push({ x: BODY_X + x, y: BODY_Y + y, mat: cell.mat, shade: cell.shade })
    }
  }
  return out
}

// ── 굽기 ────────────────────────────────────────────────────────

interface Cell {
  mat: Mat
  layer: number
  shade: Shade
}

class Grid {
  cells: (Cell | null)[] = new Array(PX * PX).fill(null)

  paint(rows: readonly Row[], mat: Mat, shade: Shade = 'auto', layerOverride?: number): void {
    const layer = layerOverride ?? MAT_LAYER[mat]
    for (const [y, x0, x1] of rows) {
      if (y < 0 || y >= PX) continue
      for (let x = Math.max(0, x0); x <= Math.min(PX - 1, x1); x++) {
        this.cells[y * PX + x] = { mat, layer, shade }
      }
    }
  }

  put(p: Pix, layer: number): void {
    if (p.x < 0 || p.y < 0 || p.x >= PX || p.y >= PX) return
    this.cells[p.y * PX + p.x] = { mat: p.mat, layer, shade: p.shade }
  }

  at(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= PX || y >= PX) return null
    return this.cells[y * PX + x]
  }
}

function tonesFor(look: AvatarLook, team: TeamId | null): Record<Mat, Tone> {
  const o = OUTFITS[look.outfit % OUTFITS.length]
  return {
    skin: SKIN,
    hair: HAIR_COLORS[look.hairColor % HAIR_COLORS.length].tone,
    shirt: o.top,
    collar: o.collar ?? o.top,
    stripe: o.stripe ?? o.top,
    accent: o.accent ?? o.top,
    bottom: o.bottom,
    shoe: SHOE_TONE,
    eye: EYE,
    mouth: MOUTH_TONE,
    blush: BLUSH_TONE,
    band: team ? BAND_TONES[team] : SHOE_TONE,
  }
}

/**
 * 완장 — 위팔에 가로 3칸 세로 2칸, 소매 위에 덮어 그린다.
 * 항상 "보이는 팔"에 붙인다. 왼쪽 방향은 오른쪽을 좌우 반전한 것이므로
 * 오른쪽 기준으로 앞팔에 그려 두면 뒤집혀도 그대로 보인다.
 */
function bandRows(side: boolean, dir: Dir, bob = 0): Row[] {
  // 정면은 화면 오른쪽 팔, 뒷모습은 화면 왼쪽 팔
  const cols = side ? [5, 6, 7] : dir === 'up' ? [1, 2, 3] : [10, 11, 12]
  const x0 = BODY_X + cols[0]
  const x1 = BODY_X + cols[cols.length - 1]
  return [
    [BODY_Y + 2 + bob, x0, x1],
    [BODY_Y + 3 + bob, x0, x1],
  ]
}

function build(look: AvatarLook, team: TeamId | null, dir: Dir, pose: Pose): Grid {
  const facing: Dir = dir === 'left' ? 'right' : dir
  const side = facing === 'right'
  const spec = HAIR_SPECS[look.hairStyle % HAIR_SPECS.length]
  const o = OUTFITS[look.outfit % OUTFITS.length]
  const skirt = look.bottom === 1
  const g = new Grid()

  // 몸 뒤로 흐르는 머리 먼저
  g.paint(backStrands(spec, facing), 'hair', 'auto', 0)
  g.paint(tails(spec, facing), 'hair', 'auto', 0)

  // 몸 — 맵 그대로
  for (const p of readBody(bodyMap(facing, pose), o, side, skirt)) g.put(p, MAT_LAYER.shirt)

  if (team) g.paint(bandRows(side, facing), 'band', 'base', MAT_LAYER.band)

  // 머리는 맨 마지막 — 목이 없으니 턱이 어깨 위에 바로 앉는다
  const head = facing === 'up' ? HEAD_BACK : side ? HEAD_SIDE : HEAD_FRONT
  for (const p of head) g.put(p, MAT_LAYER.hair)
  g.paint(sideStrands(spec, facing), 'hair')
  g.paint(bangRows(spec.bangs, facing), 'hair')
  if (spec.bangs === 'short' && facing === 'down') g.paint([[FACE_TOP, 12, 19]], 'skin', 'base', MAT_LAYER.hair)
  for (const [x, y] of side ? STRANDS_SIDE : STRANDS_FRONT) {
    if (g.at(x, y)?.mat === 'hair') g.paint([[y, x, x]], 'hair', 'shade', MAT_LAYER.hair)
  }
  // 표정은 맨 마지막 — 앞머리가 덮는 자리가 아니라 얼굴 안쪽이다
  for (const p of facePix(look.expression, facing)) g.put(p, MAT_LAYER[p.mat])
  return g
}

function paint(grid: Grid, tones: Record<Mat, Tone>): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PX
  c.height = PX
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const cell = grid.at(x, y)
      if (!cell) continue
      let key: Shade = cell.shade
      if (key === 'auto') {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !grid.at(x + dx, y + dy))
        key = edge ? 'line' : 'base'
      }
      ctx.fillStyle = tones[cell.mat][key as Exclude<Shade, 'auto'>]
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return c
}

const cache = new Map<string, HTMLCanvasElement>()

function mirrored(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.translate(src.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

/** 지도에 찍는 한 칸. 32×32. */
export function pixelFrame(look: AvatarLook, team: TeamId | null, dir: Dir, frame: number): HTMLCanvasElement {
  const key = `${look.hairStyle}-${look.hairColor}-${look.expression}-${look.outfit}-${look.bottom}-${team ?? '-'}-${dir}-${frame}`
  const hit = cache.get(key)
  if (hit) return hit
  const drawn = paint(build(look, team, dir, WALK[frame % WALK.length]), tonesFor(look, team))
  const out = dir === 'left' ? mirrored(drawn) : drawn
  cache.set(key, out)
  return out
}

/** 4방향 × 걷기 4프레임. 한 칸 64×64에 32×32를 가운데 둔다. */
export function pixelSheet(look: AvatarLook, team: TeamId | null): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CELL * 4
  c.height = CELL * 4
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingEnabled = false
  const pad = (CELL - PX) / 2
  DIRS.forEach((dir, row) => {
    for (let f = 0; f < 4; f++) ctx.drawImage(pixelFrame(look, team, dir, f), f * CELL + pad, row * CELL + pad)
  })
  return c
}
