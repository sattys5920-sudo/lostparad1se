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

type Mat = 'skin' | 'hair' | 'shirt' | 'jacket' | 'sleeve' | 'accent' | 'bottom' | 'shoe' | 'eye' | 'band'

/** [y, x0, x1] — 양끝 포함 */
type Row = readonly [number, number, number]

const MAT_LAYER: Record<Mat, number> = {
  skin: 1,
  bottom: 2,
  shirt: 3,
  jacket: 4,
  // 소매는 몸통보다 한 층 위에 둔다. 그래야 같은 천이라도 경계에 선이 생겨
  // 옆모습에서 팔이 몸통에 먹히지 않는다.
  sleeve: 5,
  accent: 6,
  shoe: 5,
  eye: 7,
  hair: 8,
  band: 9,
}

// ── 뼈대 ────────────────────────────────────────────────────────
// 비율이 이 캐릭터의 전부다. 아래 숫자를 지키면 어떤 파츠를 얹어도
// 같은 사람으로 보인다.
//
//   머리   2~18줄 (17칸) — 전체 높이의 57%, 몸보다 확실히 넓다
//   몸통  17~24줄 (8칸)  — 어깨 12칸에서 허리 10칸으로 좁아지는 작은 통
//   다리  25~29줄 (5칸)  — 전체의 6분의 1
//   발    30~31줄 (2칸)  — 작고 어두운 덩어리
//
// 목은 없다. 턱(18줄)이 깃 위에 바로 얹히고, 머리 아래 두 줄이 몸통 위를
// 덮는다. 목을 한 칸이라도 그리면 2등신 비율이 깨져 인형처럼 보인다.
// 어깨는 턱 아래에서 둥글게 흘러내리고(17줄이 좁고 18줄이 넓다) 세로로
// 곧게 뻗는 변이 없어야 실루엣이 동글동글해진다.

/** 머리통 — 어느 방향에서도 이 모양이다. */
const HEAD: Row[] = [
  [2, 11, 20], [3, 9, 22], [4, 8, 23], [5, 8, 23], [6, 8, 23], [7, 8, 23],
  [8, 8, 23], [9, 8, 23], [10, 8, 23], [11, 8, 23], [12, 8, 23], [13, 8, 23],
  [14, 8, 23], [15, 9, 22], [16, 10, 21], [17, 11, 20], [18, 13, 18],
]
const HEAD_TOP = 2
const HEAD_BOTTOM = 18
/** 머리통 가로폭 표 — 머리카락이 이 위에 얹힌다. */
const HEAD_W: Record<number, [number, number]> = Object.fromEntries(
  HEAD.map(([y, x0, x1]) => [y, [x0, x1] as [number, number]]),
)

/** 어깨 12칸(머리의 3/4) → 허리 10칸. 위아래가 좁아 통처럼 보인다. */
const TORSO_FRONT: Record<number, [number, number]> = {
  17: [11, 20], 18: [10, 21], 19: [10, 21], 20: [10, 21],
  21: [11, 20], 22: [11, 20], 23: [11, 20], 24: [11, 20],
}
/** 옆몸은 정면의 70%. 앞쪽(오른쪽)으로 쏠려 있다. */
const TORSO_SIDE: Record<number, [number, number]> = {
  17: [13, 19], 18: [12, 20], 19: [12, 20], 20: [12, 20],
  21: [13, 19], 22: [13, 19], 23: [13, 19], 24: [13, 19],
}

const ARM_TOP = 19
const ARM_END = 24
/** 손 — 엉덩이 높이의 두 칸짜리 덩어리 */
const HAND_TOP = 23
const LEG_TOP = 25

interface Foot {
  x: [number, number]
  legBottom: number
  shoe: [number, number]
  shoeTop: number
}

function feet(dir: Dir, pose: Pose): Foot[] {
  if (dir === 'right') {
    if (pose === 0) return [{ x: [13, 18], legBottom: 29, shoe: [12, 19], shoeTop: 30 }]
    const fwd: Foot = { x: [16, 19], legBottom: 28, shoe: [16, 21], shoeTop: 29 }
    const back: Foot = { x: [11, 14], legBottom: 29, shoe: [10, 15], shoeTop: 30 }
    return pose === 1
      ? [back, fwd]
      : [{ x: [12, 15], legBottom: 29, shoe: [11, 16], shoeTop: 30 }, { x: [16, 19], legBottom: 29, shoe: [16, 21], shoeTop: 30 }]
  }
  const l: Foot = { x: [12, 14], legBottom: 29, shoe: [11, 14], shoeTop: 30 }
  const r: Foot = { x: [17, 19], legBottom: 29, shoe: [17, 20], shoeTop: 30 }
  if (pose === 1) return [{ ...l, legBottom: 28, shoeTop: 29 }, r]
  if (pose === 2) return [l, { ...r, legBottom: 28, shoeTop: 29 }]
  return [l, r]
}

/** 팔 — 몸통에 딱 붙는 두 칸. 정면·뒤는 둘, 옆은 하나. */
function armsAt(dir: Dir, pose: Pose, y: number): [number, number][] {
  if (dir === 'right') {
    const dx = pose === 1 ? 1 : pose === 2 ? -2 : 0
    return y >= ARM_TOP && y <= ARM_END ? [[19 + dx, 20 + dx]] : []
  }
  const s = pose === 1 ? 1 : pose === 2 ? -1 : 0
  const out: [number, number][] = []
  if (y >= ARM_TOP - s && y <= ARM_END - s) out.push([8, 9])
  if (y >= ARM_TOP + s && y <= ARM_END + s) out.push([22, 23])
  return out
}

interface Rig {
  dir: Dir
  pose: Pose
  bob: number
  side: boolean
  /** 머리 아래 — 몸통·팔·다리 */
  body: Row[]
  /** 머리 — 옷보다 위에 얹어 턱이 깃을 덮게 한다 */
  head: Row[]
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

  const head: Row[] = HEAD.map(([y, x0, x1]) => [y + bob, x0, x1] as Row)
  // 옆모습엔 코가 있다. 눈높이에서 얼굴 앞으로 한 칸 나온다.
  if (side) head.push([14 + bob, 24, 24], [15 + bob, 24, 24])
  const body: Row[] = []
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
    head,
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
  { name: '기본 단발', bangs: 'full', side: 18, back: 21, extra: null },
  { name: '긴 생머리', bangs: 'full', side: 23, back: 30, extra: null },
  { name: '양갈래', bangs: 'full', side: 15, back: 18, extra: 'twin' },
  { name: '낮은 양갈래', bangs: 'full', side: 18, back: 20, extra: 'lowTwin' },
  { name: '포니테일', bangs: 'full', side: 15, back: 17, extra: 'pony' },
  { name: '높은 포니테일', bangs: 'short', side: 13, back: 16, extra: 'highPony' },
  { name: '숏컷', bangs: 'part', side: 15, back: 16, extra: null },
  { name: '웨이브 단발', bangs: 'full', side: 19, back: 22, extra: null, wavy: true },
  { name: '긴 웨이브', bangs: 'full', side: 24, back: 29, extra: null, wavy: true },
  { name: '앞머리 일자 단발', bangs: 'straight', side: 22, back: 24, extra: null },
  { name: '사이드 포니테일', bangs: 'part', side: 16, back: 17, extra: 'sidePony' },
  { name: '땋은 머리', bangs: 'full', side: 15, back: 18, extra: 'braid' },
  { name: '반묶음', bangs: 'full', side: 22, back: 28, extra: 'bun' },
  { name: '보브컷', bangs: 'full', side: 17, back: 20, extra: null },
  { name: '헝클어진 짧은 머리', bangs: 'spiky', side: 14, back: 16, extra: null },
]

export const HAIR_NAMES = HAIR_SPECS.map((h) => h.name)

/**
 * 앞머리가 이마를 덮는 줄. 얼굴 위쪽 3분의 1까지만이다 —
 * 눈(14~15줄)과 볼은 통째로 드러나야 한다.
 */
const BANGS_TO: Record<Bangs, number> = { full: 10, part: 9, straight: 11, short: 8, spiky: 9 }

function hairFront(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  const to = BANGS_TO[spec.bangs]
  // 머리카락은 두개골에 붙는다. 위·옆으로 머리통 밖 한 칸까지만 —
  // 레퍼런스 캐릭터가 쓴 모자의 부피를 머리로 옮기면 안 된다.
  for (let y = HEAD_TOP - 1; y <= to; y++) {
    const w = HEAD_W[y] ?? HEAD_W[HEAD_TOP]
    const grow = y >= HEAD_TOP + 1 && y <= HEAD_TOP + 3 ? 1 : 0
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
      // 뒤통수는 통째로 머리카락이고, 헤어라인은 비스듬히 물러난다 —
      // 관자놀이 쪽은 앞까지 내려오고 턱으로 갈수록 뒤로 빠진다.
      // 수직으로 자르면 옆얼굴이 아니라 살 한 줄 붙은 덩어리로 보인다.
      const edge = Math.max(13, 19 - Math.floor((y - to - 1) / 2))
      out.push([y, w[0] - 1 + d, edge])
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
  const below: [number, number] = dir === 'right' ? [9, 16] : [9, 22]
  for (let y = HEAD_TOP; y <= spec.back; y++) {
    const head = HEAD_W[y]
    const w: [number, number] = head ?? below
    const d = spec.wavy && y % 4 < 2 ? 1 : 0
    const taper = y >= spec.back - 1 ? 1 : 0
    out.push([y, w[0] + d + taper, w[1] - d - taper])
  }
  // 묶은 머리는 굵어도 세 칸이다. 머리통 반쪽보다 넓어지면 머리가 아니라 날개가 된다.
  const tail = (cx: number, y0: number, y1: number, half = 1) => {
    for (let y = y0; y <= y1; y++) {
      const h = y === y0 || y >= y1 - 1 ? Math.max(0, half - 1) : half
      out.push([y, cx - h, cx + h])
    }
  }
  // 옆모습에서는 가까운 쪽 하나만 보인다. 반대쪽 갈래는 머리 뒤에 숨는다.
  const near = dir === 'right'
  switch (spec.extra) {
    case 'twin':
      if (near) tail(7, 10, 23)
      else {
        tail(7, 10, 23)
        tail(24, 10, 23)
      }
      break
    case 'lowTwin':
      if (near) tail(8, 16, 28)
      else {
        tail(8, 16, 28)
        tail(23, 16, 28)
      }
      break
    case 'pony':
      tail(near ? 8 : 24, 11, 26)
      break
    case 'highPony':
      out.push([2, 19, 22])
      tail(near ? 9 : 23, 4, 20)
      break
    case 'sidePony':
      tail(near ? 8 : 25, 10, 24)
      break
    case 'braid':
      for (let y = 11; y <= 27; y += 2) {
        out.push([y, 6, 8], [y + 1, 7, 8])
        if (!near) out.push([y, 23, 25], [y + 1, 23, 24])
      }
      break
    case 'bun':
      out.push([0, 14, 17], [1, 14, 17])
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

const EYE_Y = 14
const EYE_L = 11
const EYE_R = 19

/** 입은 한두 칸. 이보다 크면 이 크기에서 얼굴이 무너진다. */
const MOUTH_Y = EYE_Y + 3

function eyes(kind: EyeKind, dir: Dir): Row[] {
  if (dir === 'up') return []
  if (dir === 'right') {
    // 옆모습은 눈 하나. 폭 한 칸, 높이 두 칸, 얼굴 앞 끝에서 두 칸 안쪽.
    const eye: Row[] = kind === 'closed' ? [[EYE_Y + 1, 21, 21]] : [[EYE_Y, 21, 21], [EYE_Y + 1, 21, 21]]
    return [...eye, [MOUTH_Y, 21, 21]]
  }
  const pair = (rows: Row[]): Row[] =>
    rows.flatMap(([y, x0, x1]) => [
      [y, EYE_L + x0, EYE_L + x1] as Row,
      [y, EYE_R - x1, EYE_R - x0] as Row,
    ])
  const mouth: Row[] = kind === 'happy' ? [[MOUTH_Y, 15, 16]] : [[MOUTH_Y, 15, 15]]
  switch (kind) {
    case 'happy':
      return [...pair([[EYE_Y, 0, 1], [EYE_Y + 1, -1, -1], [EYE_Y + 1, 2, 2]]), ...mouth]
    case 'angry':
      return [...pair([[EYE_Y - 1, 0, 0], [EYE_Y, 1, 1], [EYE_Y + 1, 0, 1]]), ...mouth]
    case 'sad':
      return [...pair([[EYE_Y - 1, 1, 1], [EYE_Y, 0, 0], [EYE_Y + 1, 0, 1]]), ...mouth]
    case 'closed':
      return [...pair([[EYE_Y + 1, 0, 1]]), ...mouth]
    default:
      return [...pair([[EYE_Y, 0, 1], [EYE_Y + 1, 0, 1]]), ...mouth]
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
  const to = long ? HAND_TOP - 1 : ARM_TOP + 1
  for (let y = ARM_TOP; y <= to; y++) {
    for (const [x0, x1] of r.armsAt(y + r.bob)) out.push([y + r.bob, x0, x1])
  }
  return out
}

function bottomRows(r: Rig, kind: Bottom): Row[] {
  const out: Row[] = [...torsoRows(r, 22, 24)]
  if (kind === 'skirt') {
    // 치마는 엉덩이에서 한두 칸만 퍼진다. 더 퍼뜨리면 짧은 다리가 다 묻힌다.
    const flare: Row[] = r.side
      ? [[LEG_TOP, 11, 20], [LEG_TOP + 1, 10, 21]]
      : [[LEG_TOP, 10, 21], [LEG_TOP + 1, 9, 22]]
    return [...out, ...flare]
  }
  const hem = kind === 'shorts' ? LEG_TOP : LEG_TOP + 2
  for (let y = LEG_TOP; y <= hem; y++) {
    for (const [x0, x1] of r.legsAt(y)) out.push([y, x0, x1])
  }
  return out
}

function accentRows(r: Rig, o: OutfitSpec): Row[] {
  if (!o.accent || r.dir === 'up') return []
  const b = r.bob
  // 옆에서는 넥타이도 리본도 가슴 앞 끝에 한 칸만 걸친다
  if (r.side) return [[19 + b, 20, 20], [20 + b, 20, 20]]
  return o.ribbon
    ? [[18 + b, 14, 17], [19 + b, 15, 16]]
    : [[18 + b, 15, 16], [19 + b, 15, 16], [20 + b, 15, 16], [21 + b, 15, 16]]
}

// ── 굽기 ────────────────────────────────────────────────────────

interface Cell {
  mat: Mat
  layer: number
}

class Grid {
  cells: (Cell | null)[] = new Array(PX * PX).fill(null)

  paint(rows: readonly Row[], mat: Mat, layerOverride?: number): void {
    const layer = layerOverride ?? MAT_LAYER[mat]
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
    sleeve: o.jacket && o.long && !o.vest ? o.jacket : o.shirt,
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
  g.paint([...torsoRows(rig, 17, 24), ...sleeveRows(rig, o.long)], 'shirt')
  if (o.jacket) {
    if (o.vest) g.paint(torsoRows(rig, 19, 23, 1), 'jacket')
    else if (o.open) g.paint([...edgeRows(rig, 18, 24, 3), ...sleeveRows(rig, o.long)], 'jacket')
    else g.paint([...torsoRows(rig, 17, 24), ...sleeveRows(rig, o.long)], 'jacket')
  }
  if (o.jacket && !o.vest && !o.open && facing !== 'up') g.paint(torsoRows(rig, 18, 21, 4), 'shirt')
  // 팔은 맨 나중에 — 소매 경계선이 남아야 걷는 팔이 보인다
  g.paint(sleeveRows(rig, o.long), 'sleeve')
  g.paint(accentRows(rig, o), 'accent')
  g.paint(rig.shoes, 'shoe')
  // 목이 없다 — 머리를 옷보다 나중에 얹어 턱이 깃 위에 바로 앉게 한다
  g.paint(rig.head, 'skin', MAT_LAYER.eye - 1)
  g.paint(eyes(EYE_OF[look.face % EYE_OF.length], facing).map(([y, a, b]) => [y + rig.bob, a, b] as Row), 'eye')
  g.paint(hairFront(spec, facing).map(([y, a, b]) => [y + rig.bob, a, b] as Row), 'hair')
  if (team) {
    const arm = rig.armsAt(20 + rig.bob)[0]
    if (arm) g.paint([[20 + rig.bob, arm[0], arm[1]], [21 + rig.bob, arm[0], arm[1]]], 'band')
  }
  return g
}

/** 정수리 왼쪽 위에 찍는 두세 칸짜리 빛. 이게 있어야 머리가 덩어리로 안 보인다. */
function isHighlight(x: number, y: number): boolean {
  return (y === 4 && x >= 12 && x <= 14) || (y === 5 && x >= 12 && x <= 13)
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
