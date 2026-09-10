// 오버월드 도트 캐릭터 — 레퍼런스 시트 규격.
//
// 한 칸 32×32, 캐릭터는 26칸(5~30줄), 발바닥이 30줄에 닿는다.
//   머리   5~17줄 (14×13) — 전체의 절반
//   몸통  17~23줄 (7칸)   — 정면 10칸 폭, 옆 7칸 폭. 머리가 한 칸 겹친다(목 없음)
//   다리  24~28줄         — 폭 2칸, 사이 한 칸
//   신발  29~30줄         — 3×2
//
// 머리통은 네 방향이 같은 윤곽을 쓴다. 아래 두 맵이 그 기준이고, 머리 모양
// 열다섯 개는 이 맵 위에서 "어디까지가 머리카락이고 어디부터가 살인지"만
// 바꾼다. 그래서 무엇을 골라도 머리 크기와 눈 위치가 변하지 않는다.
//
// 테두리는 한 색이 아니다. 닿아 있는 색을 어둡게 한 값을 쓴다 —
// 머리 테두리는 가장 어두운 머리색, 살 테두리는 진한 갈색.
import { BAND_TONES, CLOTH, HAIR_COLORS, tone, type Tone } from './palette'
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
const SHOE = tone('#2f3350')
const EYE = '#3a3040'

type Mat = 'skin' | 'hair' | 'shirt' | 'jacket' | 'sleeve' | 'accent' | 'bottom' | 'shoe' | 'eye' | 'band'
/**
 * 칸 하나가 쓸 색. 'auto'는 실루엣 둘레면 테두리, 아니면 바탕이다.
 * 두 칸짜리 다리·양말처럼 좁은 부위는 'base'로 못 박는다 — 양쪽이 다 가장자리라
 * auto로 두면 통째로 테두리색이 되어 까맣게 뭉친다.
 */
type Shade = 'auto' | 'base' | 'line' | 'light' | 'shade'

/** [y, x0, x1] — 양끝 포함 */
type Row = readonly [number, number, number]

const MAT_LAYER: Record<Mat, number> = {
  skin: 1,
  bottom: 2,
  shirt: 3,
  jacket: 4,
  sleeve: 5,
  shoe: 5,
  accent: 6,
  eye: 7,
  hair: 8,
  band: 9,
}

// ── 머리통 맵 ───────────────────────────────────────────────────
// O=테두리 H=머리카락 h=윤기 S=살 E=눈 .=투명
// 이 두 장이 모든 머리 모양의 바탕이다.

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
const HEAD_Y = 5
const HEAD_BOTTOM = HEAD_Y + FRONT_MAP.length - 1

interface Pix {
  x: number
  y: number
  mat: Mat
  shade: Shade
}

/** 맵 한 장을 칸 목록으로 편다. O는 이웃을 보고 머리 테두리인지 살 테두리인지 정한다. */
function readMap(map: string[]): Pix[] {
  const out: Pix[] = []
  const at = (x: number, y: number) => map[y]?.[x] ?? '.'
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const c = at(x, y)
      if (c === '.') continue
      let mat: Mat = 'hair'
      let shade: Shade = 'base'  // 맵이 테두리를 직접 지정한다
      if (c === 'S') mat = 'skin'
      else if (c === 'E') {
        mat = 'eye'
      } else if (c === 'h') shade = 'light'
      else if (c === 'O') {
        // 위아래 이웃이 살이면 살 테두리, 아니면 머리 테두리
        const near = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)]
        mat = near.some((n) => n === 'S' || n === 'E') && !near.includes('H') ? 'skin' : 'hair'
        shade = 'line'
      }
      out.push({ x: HEAD_X + x, y: HEAD_Y + y, mat, shade })
    }
  }
  return out
}

const HEAD_FRONT = readMap(FRONT_MAP)
const HEAD_SIDE = readMap(SIDE_MAP)
/** 뒷모습 — 정면과 같은 윤곽에 머리카락만 채운다. */
const HEAD_BACK: Pix[] = HEAD_FRONT.map((p) =>
  p.mat === 'skin' || p.mat === 'eye' ? { ...p, mat: 'hair' as Mat, shade: p.shade === 'line' ? 'line' : 'base' } : p,
)

/** 머릿결 — 넓은 머리 면에 어두운 줄 두세 개. */
const STRANDS_FRONT: [number, number][] = [[11, 8], [20, 9], [12, 6]]
const STRANDS_SIDE: [number, number][] = [[12, 9], [15, 6], [11, 12]]

// ── 몸 ──────────────────────────────────────────────────────────

const TORSO_TOP = 17
const TORSO_BOTTOM = 23
const ARM_TOP = 18
/** 팔 길이 5칸 */
const ARM_LEN = 4
const HAND_TOP = 23
const HAND_BOTTOM = 24
const LEG_TOP = 24
const LEG_BOTTOM = 28
const SHOE_TOP = 29
const FLOOR = 30

/** 정면 몸통 10칸, 어깨만 좁게 둥글린다. */
const TORSO_FRONT: Record<number, [number, number]> = {
  17: [12, 19], 18: [11, 20], 19: [11, 20], 20: [11, 20], 21: [11, 20], 22: [11, 20], 23: [11, 20],
}
/** 옆 몸통 7칸. 앞쪽으로 쏠려 있다. */
const TORSO_SIDE: Record<number, [number, number]> = {
  17: [14, 18], 18: [13, 19], 19: [13, 19], 20: [13, 19], 21: [13, 19], 22: [13, 19], 23: [13, 19],
}

interface Foot {
  leg: [number, number]
  legBottom: number
  shoe: [number, number]
  shoeTop: number
}

/** 걸음. 정면·뒤는 한 발이 한 칸 들리고, 옆은 앞뒤로 벌어진다. */
function feet(side: boolean, pose: Pose): Foot[] {
  if (side) {
    if (pose === 0) return [{ leg: [15, 16], legBottom: LEG_BOTTOM, shoe: [14, 16], shoeTop: SHOE_TOP }]
    const fwd: Foot = { leg: [17, 18], legBottom: LEG_BOTTOM - 1, shoe: [17, 19], shoeTop: SHOE_TOP - 1 }
    const back: Foot = { leg: [13, 14], legBottom: LEG_BOTTOM, shoe: [12, 14], shoeTop: SHOE_TOP }
    return pose === 1 ? [back, fwd] : [{ ...fwd, leg: [16, 17], shoe: [16, 18] }, { ...back, leg: [14, 15], shoe: [13, 15] }]
  }
  const l: Foot = { leg: [14, 15], legBottom: LEG_BOTTOM, shoe: [13, 15], shoeTop: SHOE_TOP }
  const r: Foot = { leg: [17, 18], legBottom: LEG_BOTTOM, shoe: [17, 19], shoeTop: SHOE_TOP }
  const lift = (f: Foot): Foot => ({ ...f, legBottom: f.legBottom - 1, shoeTop: f.shoeTop - 1 })
  if (pose === 1) return [lift(l), r]
  if (pose === 2) return [l, lift(r)]
  return [l, r]
}

/** 팔 — 폭 2칸, 길이 5칸. 걸을 때 반대쪽이 한 칸 앞뒤로 흔들린다. */
function arms(side: boolean, pose: Pose): { x: [number, number]; top: number }[] {
  if (side) {
    const dy = pose === 1 ? -1 : pose === 2 ? 1 : 0
    return [{ x: [18, 19], top: ARM_TOP + dy }]
  }
  const s = pose === 1 ? 1 : pose === 2 ? -1 : 0
  return [
    { x: [9, 10], top: ARM_TOP - s },
    { x: [21, 22], top: ARM_TOP + s },
  ]
}

interface Rig {
  dir: Dir
  pose: Pose
  bob: number
  side: boolean
  head: Pix[]
  strands: [number, number][]
  torso: Record<number, [number, number]>
  arms: { x: [number, number]; top: number }[]
  feet: Foot[]
}

function makeRig(dir: Dir, pose: Pose): Rig {
  const side = dir === 'right'
  // 걸음 프레임에서는 몸 전체가 한 칸 들썩인다
  const bob = pose === 0 ? 0 : -1
  const head = dir === 'up' ? HEAD_BACK : side ? HEAD_SIDE : HEAD_FRONT
  return {
    dir,
    pose,
    bob,
    side,
    head: head.map((p) => ({ ...p, y: p.y + bob })),
    strands: (side ? STRANDS_SIDE : STRANDS_FRONT).map(([x, y]) => [x, y + bob] as [number, number]),
    torso: side ? TORSO_SIDE : TORSO_FRONT,
    arms: arms(side, pose),
    feet: feet(side, pose),
  }
}

// ── 머리 모양 15종 ──────────────────────────────────────────────
// 맵의 머리통은 건드리지 않는다. 앞머리가 어디까지 내려오는지, 옆머리가
// 얼굴 옆으로 얼마나 흐르는지, 뒤로 무엇이 달렸는지만 다르다.

type Bangs = 'full' | 'part' | 'straight' | 'short' | 'spiky'
type Extra = 'twin' | 'lowTwin' | 'pony' | 'highPony' | 'sidePony' | 'braid' | 'bun' | null

interface HairSpec {
  name: string
  bangs: Bangs
  /** 옆머리가 얼굴 옆을 지나 몸통 옆으로 내려오는 줄. 0이면 머리통 안에서 끝난다. */
  sideTo: number
  /** 옆모습에서 등을 타고 내려오는 줄. 0이면 없다. */
  backTo: number
  extra: Extra
}

export const HAIR_SPECS: HairSpec[] = [
  { name: '기본 단발', bangs: 'full', sideTo: 0, backTo: 19, extra: null },
  { name: '긴 생머리', bangs: 'full', sideTo: 22, backTo: 22, extra: null },
  { name: '양갈래', bangs: 'full', sideTo: 0, backTo: 0, extra: 'twin' },
  { name: '낮은 양갈래', bangs: 'full', sideTo: 0, backTo: 18, extra: 'lowTwin' },
  { name: '포니테일', bangs: 'full', sideTo: 0, backTo: 0, extra: 'pony' },
  { name: '높은 포니테일', bangs: 'short', sideTo: 0, backTo: 0, extra: 'highPony' },
  { name: '숏컷', bangs: 'part', sideTo: 0, backTo: 0, extra: null },
  { name: '웨이브 단발', bangs: 'full', sideTo: 19, backTo: 20, extra: null },
  { name: '긴 웨이브', bangs: 'full', sideTo: 23, backTo: 23, extra: null },
  { name: '앞머리 일자 단발', bangs: 'straight', sideTo: 20, backTo: 21, extra: null },
  { name: '사이드 포니테일', bangs: 'part', sideTo: 0, backTo: 0, extra: 'sidePony' },
  { name: '땋은 머리', bangs: 'full', sideTo: 0, backTo: 0, extra: 'braid' },
  { name: '반묶음', bangs: 'full', sideTo: 21, backTo: 22, extra: 'bun' },
  { name: '보브컷', bangs: 'full', sideTo: 18, backTo: 19, extra: null },
  { name: '헝클어진 짧은 머리', bangs: 'spiky', sideTo: 0, backTo: 0, extra: null },
]

export const HAIR_NAMES = HAIR_SPECS.map((h) => h.name)

/** 앞머리는 어느 방향에서도 눈높이(13줄) 아래로 내려오지 않는다. */
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
      // 정수리 위로 솟은 머리끝. 맵 꼭대기(5줄)에 붙어 있어야 한다.
      out.push([HEAD_Y - 1, 13, 14], [HEAD_Y - 1, 17, 18], [HEAD_Y - 2, 17, 17])
      break
  }
  return out
}

/** 얼굴 옆을 지나 가슴까지 흐르는 옆머리. 폭 두 칸. */
function sideStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.sideTo || dir === 'right') return []
  const out: Row[] = []
  for (let y = HEAD_BOTTOM; y <= spec.sideTo; y++) {
    out.push([y, 9, 10])
    out.push([y, 21, 22])
  }
  return out
}

/** 옆모습에서 등을 타고 내려오는 뒷머리. 넉 줄을 넘지 않는다. */
function backStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.backTo) return []
  const out: Row[] = []
  if (dir === 'right') {
    for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 10, 13])
  } else if (dir === 'up') {
    for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 11, 20])
  }
  return out
}

/** 묶은 머리 — 3칸 다발. 귀 높이에 붙어 어깨 높이에서 끝난다. */
function tails(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  const near = dir === 'right'
  const bunch = (x0: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) out.push([y, x0, x0 + 2])
  }
  switch (spec.extra) {
    case 'twin':
      if (near) bunch(7, 13, 18)
      else {
        bunch(7, 13, 18)
        bunch(22, 13, 18)
      }
      break
    case 'lowTwin':
      if (near) bunch(7, 16, 21)
      else {
        bunch(7, 16, 21)
        bunch(22, 16, 21)
      }
      break
    case 'pony':
      bunch(near ? 7 : 22, 12, 19)
      break
    case 'highPony':
      out.push([HEAD_Y, 19, 21])
      bunch(near ? 7 : 21, 6, 17)
      break
    case 'sidePony':
      bunch(near ? 7 : 22, 13, 20)
      break
    case 'braid':
      for (let y = 14; y <= 22; y += 2) {
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
// 눈은 맵에 이미 박혀 있다. 여기서는 그 자리를 어떻게 바꿀지만 정한다.

type EyeKind = 'open' | 'happy' | 'angry' | 'sad' | 'closed'

const EYE_OF: EyeKind[] = [
  'open', 'happy', 'happy', 'open', 'angry',
  'angry', 'sad', 'sad', 'open', 'open',
  'happy', 'happy', 'closed', 'angry', 'open',
]

const EYE_Y = HEAD_Y + 8
const EYE_L = HEAD_X + 4
const EYE_R = HEAD_X + 9

/** 표정에 따라 눈 칸을 다시 찍는다. 맵의 기본 눈은 지운다. */
function eyeRows(kind: EyeKind, dir: Dir): { on: Row[]; off: Row[] } {
  if (dir === 'up') return { on: [], off: [[EYE_Y, EYE_L, EYE_L], [EYE_Y + 1, EYE_L, EYE_L], [EYE_Y, EYE_R, EYE_R], [EYE_Y + 1, EYE_R, EYE_R]] }
  if (dir === 'right') {
    const x = HEAD_X + 11
    const on: Row[] = kind === 'closed' ? [[EYE_Y + 1, x, x]] : [[EYE_Y, x, x], [EYE_Y + 1, x, x]]
    return { on, off: [] }
  }
  const off: Row[] = []
  const on: Row[] = []
  for (const x of [EYE_L, EYE_R]) {
    off.push([EYE_Y, x, x], [EYE_Y + 1, x, x])
    switch (kind) {
      case 'closed':
        on.push([EYE_Y + 1, x, x])
        break
      case 'happy':
        on.push([EYE_Y, x, x], [EYE_Y + 1, x - 1, x - 1], [EYE_Y + 1, x + 1, x + 1])
        break
      case 'angry':
        on.push([EYE_Y, x, x], [EYE_Y + 1, x, x], [EYE_Y - 1, x + (x === EYE_L ? -1 : 1), x + (x === EYE_L ? -1 : 1)])
        break
      case 'sad':
        on.push([EYE_Y, x, x], [EYE_Y + 1, x, x], [EYE_Y - 1, x + (x === EYE_L ? 1 : -1), x + (x === EYE_L ? 1 : -1)])
        break
      default:
        on.push([EYE_Y, x, x], [EYE_Y + 1, x, x])
    }
  }
  return { on, off }
}

// ── 교복 15종 ───────────────────────────────────────────────────

type Bottom = 'pants' | 'skirt' | 'shorts'

interface OutfitSpec {
  name: string
  shirt: Tone
  jacket?: Tone
  open?: boolean
  vest?: boolean
  accent?: Tone
  ribbon?: boolean
  bottom: Tone
  kind: Bottom
  long: boolean
}

export const OUTFITS: OutfitSpec[] = [
  { name: '단정한 셔츠', shirt: CLOTH.shirt, accent: CLOTH.wine, bottom: CLOTH.charcoal, kind: 'pants', long: true },
  { name: '니트 조끼', shirt: CLOTH.shirt, jacket: CLOTH.navy, vest: true, accent: CLOTH.wine, bottom: CLOTH.charcoal, kind: 'pants', long: true },
  { name: '가디건', shirt: CLOTH.shirt, jacket: CLOTH.beige, open: true, accent: CLOTH.brown, bottom: CLOTH.charcoal, kind: 'pants', long: true },
  { name: '재킷', shirt: CLOTH.shirt, jacket: CLOTH.navy, accent: CLOTH.red, bottom: CLOTH.navy, kind: 'pants', long: true },
  { name: '풀어헤친 셔츠', shirt: CLOTH.shirt, bottom: CLOTH.charcoal, kind: 'pants', long: true },
  { name: '느슨한 넥타이', shirt: CLOTH.shirt, accent: CLOTH.green, bottom: CLOTH.charcoal, kind: 'pants', long: false },
  { name: '어깨에 걸친 재킷', shirt: CLOTH.shirt, jacket: CLOTH.charcoal, open: true, accent: CLOTH.navy, bottom: CLOTH.denim, kind: 'pants', long: false },
  { name: '블레이저 + 리본', shirt: CLOTH.shirt, jacket: CLOTH.navy, accent: CLOTH.red, ribbon: true, bottom: CLOTH.navy, kind: 'skirt', long: true },
  { name: '조끼 + 스커트', shirt: CLOTH.shirt, jacket: CLOTH.wine, vest: true, accent: CLOTH.wine, ribbon: true, bottom: CLOTH.charcoal, kind: 'skirt', long: false },
  { name: '가디건 + 스커트', shirt: CLOTH.shirt, jacket: CLOTH.cream, open: true, accent: CLOTH.sky, ribbon: true, bottom: CLOTH.grey, kind: 'skirt', long: true },
  { name: '블레이저 + 넥타이', shirt: CLOTH.shirt, jacket: CLOTH.charcoal, accent: CLOTH.yellow, bottom: CLOTH.plaid, kind: 'skirt', long: true },
  { name: '셔츠 + 리본', shirt: CLOTH.shirt, accent: CLOTH.red, ribbon: true, bottom: CLOTH.navy, kind: 'skirt', long: false },
  { name: '캐주얼 교복', shirt: CLOTH.cream, accent: CLOTH.sky, ribbon: true, bottom: CLOTH.plaid, kind: 'skirt', long: false },
  { name: '긴 가디건', shirt: CLOTH.shirt, jacket: CLOTH.grey, open: true, accent: CLOTH.wine, ribbon: true, bottom: CLOTH.charcoal, kind: 'skirt', long: true },
  { name: '체육복', shirt: CLOTH.shirt, accent: CLOTH.navy, bottom: CLOTH.navy, kind: 'shorts', long: false },
]

export const OUTFIT_NAMES = OUTFITS.map((o) => o.name)

function torsoRows(r: Rig, y0: number, y1: number, inset = 0): Row[] {
  const out: Row[] = []
  for (let y = y0; y <= y1; y++) {
    const t = r.torso[y]
    if (t) out.push([y + r.bob, t[0] + inset, t[1] - inset])
  }
  return out
}

function edgeRows(r: Rig, y0: number, y1: number, w: number): Row[] {
  const out: Row[] = []
  for (let y = y0; y <= y1; y++) {
    const t = r.torso[y]
    if (!t) continue
    out.push([y + r.bob, t[0], t[0] + w - 1])
    out.push([y + r.bob, t[1] - w + 1, t[1]])
  }
  return out
}

/** 소매 — 팔의 위쪽 몇 칸. 손(2×2)은 늘 맨살로 남는다. */
function sleeveRows(r: Rig, long: boolean): Row[] {
  const out: Row[] = []
  for (const a of r.arms) {
    const end = long ? a.top + ARM_LEN : a.top + 2
    for (let y = a.top; y <= end; y++) out.push([y + r.bob, a.x[0], a.x[1]])
  }
  return out
}

function bottomRows(r: Rig, kind: Bottom): Row[] {
  const out: Row[] = [...torsoRows(r, 22, TORSO_BOTTOM)]
  if (kind === 'skirt') {
    const flare: Row[] = r.side ? [[LEG_TOP, 13, 19], [LEG_TOP + 1, 12, 20]] : [[LEG_TOP, 11, 20], [LEG_TOP + 1, 10, 21]]
    return [...out, ...flare]
  }
  const hem = kind === 'shorts' ? LEG_TOP : LEG_TOP + 1
  for (let y = LEG_TOP; y <= hem; y++) {
    for (const f of r.feet) if (y <= f.legBottom) out.push([y, f.leg[0], f.leg[1]])
  }
  return out
}

/** 넥타이·리본. 옆에서는 가슴 앞 끝에 한 칸만 걸친다. */
function accentRows(r: Rig, o: OutfitSpec): Row[] {
  if (!o.accent || r.dir === 'up') return []
  const b = r.bob
  if (r.side) return [[19 + b, 18, 18], [20 + b, 18, 18]]
  return o.ribbon
    ? [[18 + b, 14, 17], [19 + b, 15, 16]]
    : [[18 + b, 15, 16], [19 + b, 15, 16], [20 + b, 15, 16], [21 + b, 15, 16]]
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

  clear(rows: readonly Row[]): void {
    for (const [y, x0, x1] of rows) {
      if (y < 0 || y >= PX) continue
      for (let x = Math.max(0, x0); x <= Math.min(PX - 1, x1); x++) this.cells[y * PX + x] = null
    }
  }

  at(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= PX || y >= PX) return null
    return this.cells[y * PX + x]
  }
}

function tonesFor(look: AvatarLook, team: TeamId | null): Record<Mat, Tone> {
  const o = OUTFITS[(look.uniform ?? 0) % OUTFITS.length]
  return {
    skin: SKIN,
    hair: HAIR_COLORS[(look.color ?? 0) % HAIR_COLORS.length].tone,
    shirt: o.shirt,
    jacket: o.jacket ?? o.shirt,
    sleeve: o.jacket && o.long && !o.vest ? o.jacket : o.shirt,
    accent: o.accent ?? o.shirt,
    bottom: o.bottom,
    shoe: SHOE,
    eye: { base: EYE, shade: EYE, light: EYE, line: EYE },
    band: team ? BAND_TONES[team] : SHOE,
  }
}

function build(look: AvatarLook, team: TeamId | null, dir: Dir, pose: Pose): Grid {
  const facing: Dir = dir === 'left' ? 'right' : dir
  const rig = makeRig(facing, pose)
  const spec = HAIR_SPECS[look.hair % HAIR_SPECS.length]
  const o = OUTFITS[(look.uniform ?? 0) % OUTFITS.length]
  const g = new Grid()
  const shift = (rows: Row[]): Row[] => rows.map(([y, a, b]) => [y + rig.bob, a, b] as Row)

  // 몸 뒤로 흐르는 머리 먼저
  g.paint(shift(backStrands(spec, facing)), 'hair', 'base', 0)
  g.paint(shift(tails(spec, facing)), 'hair', 'base', 0)

  // 몸통·팔·손·다리
  g.paint(torsoRows(rig, TORSO_TOP, TORSO_BOTTOM), 'skin')
  for (const a of rig.arms) {
    for (let y = a.top; y <= a.top + ARM_LEN; y++) g.paint([[y + rig.bob, a.x[0], a.x[1]]], 'skin')
    for (let y = HAND_TOP; y <= HAND_BOTTOM; y++) g.paint([[y + rig.bob, a.x[0], a.x[1]]], 'skin')
  }
  for (const f of rig.feet) {
    for (let y = LEG_TOP; y <= f.legBottom; y++) g.paint([[y, f.leg[0], f.leg[1]]], 'skin')
  }

  // 옷 — 셔츠를 먼저 입히고 그 위에 바지·치마를 올린다(허리가 보이게)
  g.paint(torsoRows(rig, TORSO_TOP, TORSO_BOTTOM), 'shirt')
  if (o.jacket) {
    if (o.vest) g.paint(torsoRows(rig, TORSO_TOP + 1, TORSO_BOTTOM - 1, 1), 'jacket')
    else if (o.open) g.paint(edgeRows(rig, TORSO_TOP, TORSO_BOTTOM, 3), 'jacket')
    else g.paint(torsoRows(rig, TORSO_TOP, TORSO_BOTTOM), 'jacket')
    if (!o.vest && !o.open && facing !== 'up') g.paint(torsoRows(rig, TORSO_TOP + 1, TORSO_BOTTOM - 2, 3), 'shirt')
  }
  g.paint(bottomRows(rig, o.kind), 'bottom')
  // 양말 — 밑단과 신발 사이. 맨다리를 두 칸으로 두면 테두리색만 남아 갈색 막대가 된다.
  for (const f of rig.feet) {
    for (let y = LEG_TOP + 2; y < f.shoeTop; y++) {
      if (y <= f.legBottom) g.paint([[y, f.leg[0], f.leg[1]]], 'shirt', 'base')
    }
  }
  g.paint(sleeveRows(rig, o.long), 'sleeve')
  g.paint(accentRows(rig, o), 'accent')
  for (const f of rig.feet) {
    for (let y = f.shoeTop; y <= FLOOR - (SHOE_TOP - f.shoeTop); y++) g.paint([[y, f.shoe[0], f.shoe[1]]], 'shoe')
  }
  if (team) {
    const a = rig.arms[0]
    g.paint([[a.top + 2 + rig.bob, a.x[0], a.x[1]], [a.top + 3 + rig.bob, a.x[0], a.x[1]]], 'band')
  }

  // 머리는 맨 마지막 — 목이 없으니 턱이 깃 위에 바로 얹힌다
  for (const p of rig.head) g.put(p, MAT_LAYER.hair)
  g.paint(shift(sideStrands(spec, facing)), 'hair')
  g.paint(shift(bangRows(spec.bangs, facing)), 'hair')
  if (spec.bangs === 'short' && facing === 'down') g.paint([[FACE_TOP, 12, 19]], 'skin', 'base', MAT_LAYER.hair)
  for (const [x, y] of rig.strands) {
    if (g.at(x, y)?.mat === 'hair') g.paint([[y, x, x]], 'hair', 'shade', MAT_LAYER.hair)
  }
  const e = eyeRows(EYE_OF[look.face % EYE_OF.length], facing)
  // 눈도 몸과 같이 들썩여야 한다. 안 그러면 걸음 프레임에서 눈이 얼굴 밖으로 샌다.
  g.paint(shift(e.off), 'skin', 'base', MAT_LAYER.hair)
  g.paint(shift(e.on), 'eye', 'base', MAT_LAYER.eye + 2)
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
      const t = tones[cell.mat]
      let key: Shade = cell.shade
      if (key === 'auto') {
        // 테두리는 실루엣 둘레에만. 닿아 있는 색을 어둡게 한 값을 쓴다 —
        // 전부 같은 남색으로 두르지 않는다.
        // 안쪽 경계(머리·살, 셔츠·재킷)는 선을 긋지 않는다. 두 칸짜리 팔·다리가
        // 통째로 테두리색이 되어 까맣게 뭉치기 때문이고, 색이 다르면 선 없이도 갈린다.
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !grid.at(x + dx, y + dy))
        key = edge ? 'line' : 'base'
      }
      ctx.fillStyle = t[key as Exclude<Shade, 'auto'>]
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
  const key = `${look.hair}-${look.color ?? 0}-${look.face}-${look.uniform ?? 0}-${team ?? '-'}-${dir}-${frame}`
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
