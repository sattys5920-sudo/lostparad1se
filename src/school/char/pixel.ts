// 오버월드 도트 캐릭터 — GBA·DS 시절 JRPG 규격.
//
//   · 한 칸 32×32, 캐릭터는 2등신(머리 14줄 + 몸 15줄)
//   · 살짝 내려다보는 3/4 부감이라 정수리가 보인다
//   · 실루엣 둘레는 1픽셀 진한 외곽선, 안티앨리어싱 없음
//   · 색은 12~16개, 재질마다 두세 단계 평면 음영(셀 셰이딩)
//   · 눈은 두세 칸, 입은 아주 작거나 없다
//   · 4방향 × 걷기 4프레임 = 16칸, 모든 칸에서 비율이 같다
//
// 프로필용 벡터 아바타(svg.ts)와 같은 파츠 번호·같은 팔레트를 쓴다. 그래서
// 프로필에서 고른 모습이 지도 위에서도 같은 사람으로 보인다.
import { BAND_TONES, CLOTH, HAIR_COLORS, tone, type Tone } from './palette'
import type { AvatarLook, TeamId } from '../types'

export const PX = 32
/** 시트 한 칸. 32×32 스프라이트를 가운데 둔다. */
export const CELL = 64

export type Dir = 'down' | 'left' | 'right' | 'up'
export type Pose = 0 | 1 | 2
/** 걷기 4프레임: 서기 → 왼발 → 서기 → 오른발 */
export const WALK: readonly Pose[] = [0, 1, 0, 2]
export const DIRS: readonly Dir[] = ['down', 'left', 'right', 'up']

/** 실루엣 둘레는 재질과 상관없이 이 한 색이다. GBA 스프라이트의 기본 문법. */
const OUTLINE = '#2b2431'
const SKIN = tone('#f3c9a0')
const SHOE = tone('#3c4048')
const EYE = '#33272f'

type Mat = 'skin' | 'hair' | 'shirt' | 'jacket' | 'accent' | 'bottom' | 'shoe' | 'eye' | 'band'

/** [y, x0, x1] — 양끝 포함 */
type Row = readonly [number, number, number]

const MAT_LAYER: Record<Mat, number> = {
  skin: 1,
  bottom: 2,
  shirt: 3,
  jacket: 4,
  accent: 5,
  shoe: 5,
  eye: 6,
  hair: 7,
  band: 8,
}

// ── 뼈대 ────────────────────────────────────────────────────────

/** 머리통 — 어느 방향에서도 이 모양이다. */
const HEAD: Row[] = [
  [2, 11, 20], [3, 9, 22], [4, 8, 23], [5, 8, 23], [6, 8, 23], [7, 8, 23],
  [8, 8, 23], [9, 8, 23], [10, 8, 23], [11, 8, 23], [12, 8, 23],
  [13, 9, 22], [14, 10, 21], [15, 12, 19],
]
const HEAD_TOP = 2
const HEAD_BOTTOM = 15
/** 머리통 가로폭 표 — 머리카락이 이 위에 얹힌다. */
const HEAD_W: Record<number, [number, number]> = Object.fromEntries(
  HEAD.map(([y, x0, x1]) => [y, [x0, x1] as [number, number]]),
)

const TORSO_FRONT: Record<number, [number, number]> = {
  17: [10, 21], 18: [9, 22], 19: [9, 22], 20: [9, 22], 21: [10, 21], 22: [10, 21], 23: [10, 21],
}
const TORSO_SIDE: Record<number, [number, number]> = {
  17: [11, 20], 18: [11, 20], 19: [11, 20], 20: [11, 20], 21: [11, 20], 22: [11, 20], 23: [11, 20],
}

const ARM_TOP = 18
const ARM_END = 23
const LEG_TOP = 24
const HIP_TOP = 24

interface Foot {
  x: [number, number]
  legBottom: number
  shoe: [number, number]
  shoeTop: number
}

function feet(dir: Dir, pose: Pose): Foot[] {
  if (dir === 'right') {
    if (pose === 0) return [{ x: [13, 18], legBottom: 28, shoe: [12, 19], shoeTop: 29 }]
    const fwd: Foot = { x: [16, 19], legBottom: 27, shoe: [16, 21], shoeTop: 28 }
    const back: Foot = { x: [11, 14], legBottom: 28, shoe: [10, 15], shoeTop: 29 }
    return pose === 1 ? [back, fwd] : [{ x: [12, 15], legBottom: 28, shoe: [11, 16], shoeTop: 29 }, { x: [16, 19], legBottom: 28, shoe: [16, 21], shoeTop: 29 }]
  }
  const l: Foot = { x: [12, 14], legBottom: 28, shoe: [11, 15], shoeTop: 29 }
  const r: Foot = { x: [17, 19], legBottom: 28, shoe: [16, 20], shoeTop: 29 }
  if (pose === 1) return [{ ...l, legBottom: 27, shoeTop: 28 }, r]
  if (pose === 2) return [l, { ...r, legBottom: 27, shoeTop: 28 }]
  return [l, r]
}

/** 팔 — 정면·뒤는 둘, 옆은 하나. 걸으면 위아래로 젓는다. */
function armsAt(dir: Dir, pose: Pose, y: number): [number, number][] {
  if (dir === 'right') {
    const dx = pose === 1 ? 1 : pose === 2 ? -2 : 0
    return y >= ARM_TOP && y <= ARM_END ? [[19 + dx, 21 + dx]] : []
  }
  const s = pose === 1 ? 1 : pose === 2 ? -1 : 0
  const out: [number, number][] = []
  if (y >= ARM_TOP - s && y <= ARM_END - s) out.push([7, 8])
  if (y >= ARM_TOP + s && y <= ARM_END + s) out.push([23, 24])
  return out
}

interface Rig {
  dir: Dir
  pose: Pose
  bob: number
  side: boolean
  body: Row[]
  shoes: Row[]
  torso: Record<number, [number, number]>
  armsAt(y: number): [number, number][]
  legsAt(y: number): [number, number][]
}

function makeRig(dir: Dir, pose: Pose): Rig {
  const side = dir === 'right'
  const bob = pose === 0 ? 0 : -1
  const torso = side ? TORSO_SIDE : TORSO_FRONT
  const fs = feet(side ? 'right' : 'down', pose)

  const body: Row[] = []
  for (const [y, x0, x1] of HEAD) body.push([y + bob, x0, x1])
  body.push([16 + bob, side ? 14 : 14, side ? 18 : 17])
  for (const y of Object.keys(torso).map(Number)) body.push([y + bob, torso[y][0], torso[y][1]])
  for (let y = ARM_TOP; y <= ARM_END; y++) {
    for (const [x0, x1] of armsAt(side ? 'right' : 'down', pose, y)) body.push([y + bob, x0, x1])
  }
  for (const f of fs) for (let y = LEG_TOP; y <= f.legBottom; y++) body.push([y, f.x[0], f.x[1]])

  const shoes: Row[] = []
  for (const f of fs) for (let y = f.shoeTop; y <= 31; y++) shoes.push([y, f.shoe[0], f.shoe[1]])

  return {
    dir,
    pose,
    bob,
    side,
    body,
    shoes,
    torso,
    armsAt: (y) => armsAt(side ? 'right' : 'down', pose, y - bob),
    legsAt: (y) => fs.filter((f) => y >= LEG_TOP && y <= f.legBottom).map((f) => f.x),
  }
}

// ── 머리 15종 ───────────────────────────────────────────────────
// 벡터 아바타와 같은 순서·같은 이름. 32칸 안에서도 실루엣이 갈리도록
// 앞머리 모양 · 옆머리 길이 · 뒷머리 길이 · 묶음으로 나눈다.

type Bangs = 'full' | 'part' | 'straight' | 'short' | 'spiky'
type Extra = 'twin' | 'lowTwin' | 'pony' | 'highPony' | 'sidePony' | 'braid' | 'bun' | null

interface HairSpec {
  name: string
  bangs: Bangs
  /** 옆머리가 내려오는 줄 */
  side: number
  /** 뒷머리가 내려오는 줄 */
  back: number
  extra: Extra
  wavy?: boolean
}

export const HAIR_SPECS: HairSpec[] = [
  { name: '기본 단발', bangs: 'full', side: 15, back: 18, extra: null },
  { name: '긴 생머리', bangs: 'full', side: 20, back: 27, extra: null },
  { name: '양갈래', bangs: 'full', side: 12, back: 15, extra: 'twin' },
  { name: '낮은 양갈래', bangs: 'full', side: 15, back: 17, extra: 'lowTwin' },
  { name: '포니테일', bangs: 'full', side: 12, back: 14, extra: 'pony' },
  { name: '높은 포니테일', bangs: 'short', side: 10, back: 13, extra: 'highPony' },
  { name: '숏컷', bangs: 'part', side: 12, back: 13, extra: null },
  { name: '웨이브 단발', bangs: 'full', side: 16, back: 19, extra: null, wavy: true },
  { name: '긴 웨이브', bangs: 'full', side: 21, back: 26, extra: null, wavy: true },
  { name: '앞머리 일자 단발', bangs: 'straight', side: 19, back: 21, extra: null },
  { name: '사이드 포니테일', bangs: 'part', side: 13, back: 14, extra: 'sidePony' },
  { name: '땋은 머리', bangs: 'full', side: 12, back: 15, extra: 'braid' },
  { name: '반묶음', bangs: 'full', side: 19, back: 25, extra: 'bun' },
  { name: '보브컷', bangs: 'full', side: 14, back: 17, extra: null },
  { name: '헝클어진 짧은 머리', bangs: 'spiky', side: 11, back: 13, extra: null },
]

export const HAIR_NAMES = HAIR_SPECS.map((h) => h.name)

/** 앞머리가 이마를 덮는 줄 — 눈(9~11줄)은 절대 가리지 않는다. */
const BANGS_TO: Record<Bangs, number> = { full: 8, part: 7, straight: 9, short: 6, spiky: 7 }

function hairFront(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  const to = BANGS_TO[spec.bangs]
  // 정수리 — 머리통보다 한 칸 크게 얹어 두께를 준다
  // 정수리만 한 칸 부풀린다. 아래까지 부풀리면 머리통이 투구처럼 커진다.
  for (let y = HEAD_TOP - 1; y <= to; y++) {
    const w = HEAD_W[y] ?? HEAD_W[HEAD_TOP]
    const grow = y >= HEAD_TOP + 1 && y <= HEAD_TOP + 4 ? 1 : 0
    out.push([y, w[0] - grow, w[1] + grow])
  }
  if (dir === 'up') {
    // 뒤통수는 머리카락으로 꽉 찬다
    for (let y = to + 1; y <= HEAD_BOTTOM; y++) {
      const w = HEAD_W[y]
      if (w) out.push([y, w[0], w[1]])
    }
    return out
  }
  if (spec.bangs === 'part') out.push([to + 1, 8, 14])
  if (spec.bangs === 'straight') out.push([to + 1, 9, 22])
  if (spec.bangs === 'spiky') out.push([HEAD_TOP - 2, 12, 13], [HEAD_TOP - 2, 16, 18], [HEAD_TOP - 3, 17, 17])
  // 옆머리
  for (let y = to + 1; y <= spec.side; y++) {
    const w = HEAD_W[y] ?? HEAD_W[HEAD_BOTTOM]
    const d = spec.wavy && y % 4 < 2 ? 1 : 0
    if (dir === 'right') {
      // 옆모습은 뒤통수 쪽만 덮는다 — 얼굴이 드러나야 방향이 보인다
      out.push([y, w[0] - 1 + d, Math.min(w[0] + 3, 15)])
    } else {
      out.push([y, w[0] - 1 + d, w[0] + 1 + d])
      out.push([y, w[1] - 1 - d, w[1] + 1 - d])
    }
  }
  return out
}

function hairBack(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  // 머리통 안에서는 머리통 폭 그대로, 어깨 아래로 내려가서야 살짝 퍼진다.
  // 처음부터 넓게 잡으면 검은 판자를 뒤집어쓴 것처럼 보인다.
  const below: [number, number] = dir === 'right' ? [9, 15] : [8, 23]
  for (let y = HEAD_TOP; y <= spec.back; y++) {
    const head = HEAD_W[y]
    const w: [number, number] = head ?? below
    const d = spec.wavy && y % 4 < 2 ? 1 : 0
    const taper = y >= spec.back - 1 ? 1 : 0
    out.push([y, w[0] + d + taper, w[1] - d - taper])
  }
  const tail = (cx: number, y0: number, y1: number, half: number) => {
    for (let y = y0; y <= y1; y++) {
      const h = y === y0 || y >= y1 - 1 ? half - 1 : half
      out.push([y, cx - h, cx + h])
    }
  }
  switch (spec.extra) {
    case 'twin':
      tail(5, 8, 20, 2)
      tail(26, 8, 20, 2)
      break
    case 'lowTwin':
      tail(6, 14, 26, 2)
      tail(25, 14, 26, 2)
      break
    case 'pony':
      tail(26, 9, 24, 2)
      break
    case 'highPony':
      out.push([1, 18, 22], [2, 20, 24])
      tail(25, 3, 18, 2)
      break
    case 'sidePony':
      tail(27, 8, 22, 3)
      break
    case 'braid':
      for (let y = 9; y <= 25; y += 2) {
        out.push([y, 4, 6], [y + 1, 5, 6])
        out.push([y, 25, 27], [y + 1, 25, 26])
      }
      break
    case 'bun':
      out.push([0, 14, 17], [1, 13, 18], [2, 13, 18])
      break
    default:
      break
  }
  return out
}

// ── 표정 ────────────────────────────────────────────────────────
// 32칸에서 표정은 눈 몇 칸으로만 낸다. 벡터 아바타의 열다섯 표정을
// 여기서는 다섯 가지 눈 모양으로 모은다 — 그 이상은 뭉개져서 안 보인다.

type EyeKind = 'open' | 'happy' | 'angry' | 'sad' | 'closed'

const EYE_OF: EyeKind[] = [
  'open', 'happy', 'happy', 'open', 'angry',
  'angry', 'sad', 'sad', 'open', 'open',
  'happy', 'happy', 'closed', 'angry', 'open',
]

const EYE_Y = 10
const EYE_L = 11
const EYE_R = 19

function eyes(kind: EyeKind, dir: Dir): Row[] {
  if (dir === 'up') return []
  if (dir === 'right') {
    // 옆모습은 눈 하나. 앞쪽에 붙인다.
    return kind === 'closed'
      ? [[EYE_Y + 1, 18, 19]]
      : [[EYE_Y, 18, 19], [EYE_Y + 1, 18, 19]]
  }
  const pair = (rows: Row[]): Row[] =>
    rows.flatMap(([y, x0, x1]) => [
      [y, EYE_L + x0, EYE_L + x1] as Row,
      [y, EYE_R - x1, EYE_R - x0] as Row,
    ])
  switch (kind) {
    case 'happy':
      return pair([[EYE_Y, 0, 1], [EYE_Y + 1, -1, -1], [EYE_Y + 1, 2, 2]])
    case 'angry':
      return pair([[EYE_Y - 1, 0, 0], [EYE_Y, 1, 1], [EYE_Y + 1, 0, 1]])
    case 'sad':
      return pair([[EYE_Y - 1, 1, 1], [EYE_Y, 0, 0], [EYE_Y + 1, 0, 1]])
    case 'closed':
      return pair([[EYE_Y + 1, 0, 1]])
    default:
      return pair([[EYE_Y, 0, 1], [EYE_Y + 1, 0, 1]])
  }
}

// ── 교복 15종 ───────────────────────────────────────────────────
// 벡터 아바타와 같은 순서·같은 색. 32칸에서는 소매 길이, 앞이 트였는지,
// 바지인지 치마인지, 리본인지 넥타이인지로만 갈린다.

type Bottom = 'pants' | 'skirt' | 'shorts'

interface OutfitSpec {
  name: string
  shirt: Tone
  jacket?: Tone
  /** 앞이 트인 옷(가디건·재킷)이면 몸통 양옆만 덮는다 */
  open?: boolean
  /** 조끼 — 소매 없이 몸통만 */
  vest?: boolean
  accent?: Tone
  ribbon?: boolean
  bottom: Tone
  kind: Bottom
  long: boolean
}

export const OUTFITS: OutfitSpec[] = [
  { name: '단정한 셔츠', shirt: CLOTH.shirt, accent: CLOTH.navy, bottom: CLOTH.charcoal, kind: 'pants', long: true },
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

function sleeveRows(r: Rig, long: boolean): Row[] {
  const out: Row[] = []
  const to = long ? ARM_END : ARM_TOP + 2
  for (let y = ARM_TOP; y <= to; y++) {
    for (const [x0, x1] of r.armsAt(y + r.bob)) out.push([y + r.bob, x0, x1])
  }
  return out
}

function bottomRows(r: Rig, kind: Bottom): Row[] {
  const out: Row[] = [...torsoRows(r, 21, 23)]
  if (kind === 'skirt') {
    const flare: Row[] = r.side
      ? [[HIP_TOP, 10, 21], [HIP_TOP + 1, 9, 22], [HIP_TOP + 2, 9, 22]]
      : [[HIP_TOP, 9, 22], [HIP_TOP + 1, 8, 23], [HIP_TOP + 2, 8, 23]]
    return [...out, ...flare]
  }
  const hem = kind === 'shorts' ? LEG_TOP + 1 : LEG_TOP + 3
  for (let y = LEG_TOP; y <= hem; y++) {
    for (const [x0, x1] of r.legsAt(y)) out.push([y, x0, x1])
  }
  return out
}

function accentRows(r: Rig, o: OutfitSpec): Row[] {
  if (!o.accent || r.dir === 'up') return []
  const b = r.bob
  return o.ribbon
    ? [[17 + b, 14, 17], [18 + b, 15, 16]]
    : [[17 + b, 15, 16], [18 + b, 15, 16], [19 + b, 15, 16], [20 + b, 15, 16]]
}

// ── 굽기 ────────────────────────────────────────────────────────

interface Cell {
  mat: Mat
  layer: number
}

class Grid {
  cells: (Cell | null)[] = new Array(PX * PX).fill(null)

  paint(rows: readonly Row[], mat: Mat): void {
    const layer = MAT_LAYER[mat]
    for (const [y, x0, x1] of rows) {
      if (y < 0 || y >= PX) continue
      for (let x = Math.max(0, x0); x <= Math.min(PX - 1, x1); x++) {
        this.cells[y * PX + x] = { mat, layer }
      }
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

  g.paint(hairBack(spec, facing).map(([y, a, b]) => [y + rig.bob, a, b] as Row), 'hair')
  g.paint(rig.body, 'skin')
  g.paint(bottomRows(rig, o.kind), 'bottom')
  g.paint([...torsoRows(rig, 17, 23), ...sleeveRows(rig, o.long)], 'shirt')
  if (o.jacket) {
    if (o.vest) g.paint(torsoRows(rig, 18, 22, 1), 'jacket')
    else if (o.open) g.paint([...edgeRows(rig, 17, 23, 3), ...sleeveRows(rig, o.long)], 'jacket')
    else g.paint([...torsoRows(rig, 17, 23), ...sleeveRows(rig, o.long)], 'jacket')
  }
  if (o.jacket && !o.vest && !o.open && facing !== 'up') g.paint(torsoRows(rig, 17, 20, 5), 'shirt')
  g.paint(accentRows(rig, o), 'accent')
  g.paint(rig.shoes, 'shoe')
  g.paint(eyes(EYE_OF[look.face % EYE_OF.length], facing).map(([y, a, b]) => [y + rig.bob, a, b] as Row), 'eye')
  g.paint(hairFront(spec, facing).map(([y, a, b]) => [y + rig.bob, a, b] as Row), 'hair')
  if (team) {
    const arm = rig.armsAt(19 + rig.bob)[0]
    if (arm) g.paint([[19 + rig.bob, arm[0], arm[1]], [20 + rig.bob, arm[0], arm[1]]], 'band')
  }
  return g
}

/** 정수리 왼쪽 위 — 머리에만 넣는 작은 빛. GBA 스프라이트의 인장 같은 것. */
function isHighlight(x: number, y: number): boolean {
  return y >= 3 && y <= 4 && x >= 11 && x <= 15
}

function paint(grid: Grid, tones: Record<Mat, Tone>): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PX
  c.height = PX
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  const outline = new Uint8Array(PX * PX)
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      if (!grid.at(x, y)) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!grid.at(x + dx, y + dy)) {
          outline[y * PX + x] = 1
          break
        }
      }
    }
  }
  const isEdge = (x: number, y: number) => {
    const n = grid.at(x, y)
    return n === null || outline[y * PX + x] === 1
  }
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const cell = grid.at(x, y)
      if (!cell) continue
      const t = tones[cell.mat]
      let color: string
      if (outline[y * PX + x]) {
        color = OUTLINE
      } else {
        // 아래 레이어와 맞닿은 자리는 그 재질의 진한 색으로 한 줄 — 머리와
        // 이마, 옷과 살이 여기서 갈린다.
        const border = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const n = grid.at(x + dx, y + dy)
          return n !== null && n.mat !== cell.mat && n.layer < cell.layer
        })
        if (border) color = t.line
        else if (cell.mat === 'hair' && isHighlight(x, y)) color = t.light
        else if (isEdge(x + 1, y) || isEdge(x, y + 1)) color = t.shade
        else color = t.base
      }
      ctx.fillStyle = color
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
    for (let f = 0; f < 4; f++) {
      ctx.drawImage(pixelFrame(look, team, dir, f), f * CELL + pad, row * CELL + pad)
    }
  })
  return c
}
