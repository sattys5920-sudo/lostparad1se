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
import {
  BAND_TONES,
  BLUSH_TONE,
  HAIR_COLORS,
  MOUTH_TONE,
  SCHOOL_PALETTE,
  SHOE_TONE,
  tone,
  type Tone,
} from './palette'
import type { TeamId } from '../types'
import type { AvatarLook } from '../../../shared/look'

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
  | 'leg'
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
  /** 맨다리·체육복 다리 — 살과 같은 층이다 */
  leg: 1,
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

// ── 머리 모양 30종 ──────────────────────────────────────────────
// 머리통 맵은 건드리지 않는다. 이 표가 정하는 것은 네 가지뿐이다.
//
//   이마를 몇 줄 드러내는가(forehead)
//   그 위에 앞머리를 어떻게 다시 얹는가(bangs)
//   머리통 밖으로 무엇이 흐르는가(sideTo·backTo·extra)
//   같은 머리색을 어떻게 칠하는가(undercut·flat·partLine·rough)
//
// 여자 머리는 이마를 앞머리로 덮는 데서 시작하고(forehead 0), 남자 머리는
// 이마를 한두 줄 더 드러내는 데서 시작한다. 남자 머리에는 눈높이에 귀 한
// 칸(살)이 붙고, 그 안쪽 한 칸이 구레나룻으로 남는다.
//
// 스파이크·헝클어진 머리·볼륨펌 말고는 머리통 윤곽 위로 튀어나오지 않는다.

export type StyleSet = 'F' | 'M'
export type HairId = string

type Bangs =
  | 'full' | 'straight' | 'part' | 'half' | 'diag'
  | 'round' | 'bowl' | 'comma' | 'oneEye' | 'none'
  // 아래 넷은 이마를 얼마쯤 드러내 놓고 그 위에 다시 얹는 앞머리다
  | 'seeThrough' | 'curtain' | 'baby' | 'choppy' | 'heavy'

/**
 * 그 앞머리를 그리려면 이마를 몇 줄 비워 둬야 하는가.
 *
 * **앞머리는 이마를 덮는 것이 아니라 이마 위에 얹는 것이다.** 시스루는
 * 숱 사이로 이마가 비쳐야 시스루이고, 커튼은 가운데가 갈라져야 커튼이다.
 * 머리통 맵은 이마까지 머리로 차 있으므로, 먼저 살로 비워 낸 다음
 * 그 위에 머리칸을 몇 개만 다시 얹는다.
 *
 * 앞머리 모양을 고르면 비울 줄 수가 따라온다 — 둘을 따로 적으면
 * 언젠가 어긋나서, 시스루인데 이마가 막혀 있는 머리가 나온다.
 */
const BANGS_OPEN: Partial<Record<Bangs, number>> = {
  seeThrough: 1,
  curtain: 1,
  baby: 2,
  none: 1,
}
type Extra =
  | 'twin' | 'lowTwin' | 'pony' | 'highPony' | 'sidePony'
  | 'braid' | 'bun' | 'bigBun' | 'spike' | null
type Rough = 'spikes' | 'curly' | null

export interface HairSpec {
  id: HairId
  name: string
  set: StyleSet
  bangs: Bangs
  /** 이마를 몇 줄 드러내는가. 0이면 여자 앞머리 기준선까지 덮는다 */
  forehead: number
  /** 눈높이에 귀 한 칸(살) */
  ear: boolean
  /** 옆·뒤 아래 몇 줄을 민 것처럼 어둡게 하는가 */
  undercut: number
  /** 윤기 없이 그늘 톤 한 가지로 (반삭) */
  flat: boolean
  partLine: 'center' | 'back' | null
  rough: Rough
  /** 옆머리가 물결친다 */
  wave: boolean
  /** 끝이 안으로 말린다 (보브) */
  curlIn: boolean
  /** 옆머리가 몸통 옆으로 내려오는 줄. 0이면 머리통 안에서 끝난다 */
  sideTo: number
  /** 옆·뒷모습에서 등을 타고 내려오는 줄. 0이면 없다 */
  backTo: number
  extra: Extra
  /** 앞머리가 한쪽 눈을 덮는다 — 그 눈은 그리지 않는다 */
  coversEye: boolean
}

type HairOpts = Partial<Omit<HairSpec, 'id' | 'name' | 'set'>>

function hair(id: HairId, name: string, o: HairOpts = {}): HairSpec {
  return {
    id,
    name,
    set: id[0] as StyleSet,
    bangs: 'full',
    // 앞머리 모양이 정하는 기본값. 남자 머리처럼 따로 적으면 그쪽이 이긴다
    forehead: BANGS_OPEN[o.bangs ?? 'full'] ?? 0,
    ear: false,
    undercut: 0,
    flat: false,
    partLine: null,
    rough: null,
    wave: false,
    curlIn: false,
    sideTo: 0,
    backTo: 0,
    extra: null,
    coversEye: false,
    ...o,
  }
}

export const HAIR_SPECS: HairSpec[] = [
  // 여자.
  //
  // **묶는 모양만 다르고 앞머리는 전부 같았다.** 열다섯 중 열이 같은
  // 한 줄짜리 앞머리를 썼다 — 정면에서 보면 뒤가 안 보이므로, 얼굴
  // 위쪽이 다 똑같아서 열이 한 사람처럼 보였다.
  //
  // 이제 앞머리로도 갈린다. 겹치는 것은 셋뿐이고(full·curtain·seeThrough
  // 가 한 번씩 더 나온다), 그 짝은 뒤가 크게 달라서 헷갈리지 않는다.
  hair('F00', '기본 단발', { backTo: 21 }),
  hair('F01', '긴 생머리', { bangs: 'curtain', sideTo: 25, backTo: 25 }),
  hair('F02', '양갈래', { bangs: 'choppy', extra: 'twin' }),
  hair('F03', '낮은 양갈래', { bangs: 'seeThrough', backTo: 20, extra: 'lowTwin' }),
  hair('F04', '포니테일', { bangs: 'diag', extra: 'pony' }),
  hair('F05', '높은 포니테일', { bangs: 'none', extra: 'highPony' }),
  hair('F06', '숏컷', { bangs: 'part', backTo: 20 }),
  hair('F07', '웨이브 단발', { bangs: 'baby', sideTo: 22, backTo: 22, wave: true }),
  hair('F08', '긴 웨이브', { bangs: 'round', sideTo: 26, backTo: 26, wave: true }),
  hair('F09', '앞머리 일자 단발', { bangs: 'straight', sideTo: 23, backTo: 23 }),
  hair('F10', '사이드 포니테일', { bangs: 'comma', extra: 'sidePony' }),
  hair('F11', '땋은 머리', { bangs: 'half', extra: 'braid' }),
  hair('F12', '반묶음', { bangs: 'curtain', sideTo: 24, backTo: 24, extra: 'bun' }),
  hair('F13', '보브컷', { bangs: 'heavy', sideTo: 21, backTo: 20, curlIn: true }),
  hair('F14', '똥머리', { bangs: 'seeThrough', extra: 'bigBun' }),
  // 남자 — 이마를 한두 줄 더 드러내고 귀가 보인다
  hair('M00', '기본 커트', { bangs: 'half', forehead: 2, ear: true }),
  hair('M01', '투블럭', { bangs: 'round', forehead: 2, ear: true, undercut: 2 }),
  hair('M02', '스포츠머리', { bangs: 'none', forehead: 2, ear: true, undercut: 1 }),
  hair('M03', '반삭', { bangs: 'none', forehead: 3, ear: true, flat: true }),
  hair('M04', '댄디컷', { bangs: 'round', forehead: 1, ear: true }),
  hair('M05', '5:5 가르마', { bangs: 'full', forehead: 1, ear: true, partLine: 'center' }),
  hair('M06', '6:4 가르마', { bangs: 'diag', forehead: 2, ear: true }),
  hair('M07', '올백', { bangs: 'none', forehead: 3, ear: true, partLine: 'back' }),
  hair('M08', '쉼표머리', { bangs: 'comma', forehead: 2, ear: true }),
  hair('M09', '스파이크', { bangs: 'part', forehead: 2, ear: true, extra: 'spike' }),
  hair('M10', '헝클어진 짧은 머리', { bangs: 'full', forehead: 1, ear: true, rough: 'spikes' }),
  hair('M11', '볼륨펌', { bangs: 'round', forehead: 1, ear: true, rough: 'curly' }),
  hair('M12', '울프컷', { bangs: 'full', forehead: 1, ear: true, backTo: 22 }),
  hair('M13', '바가지머리', { bangs: 'bowl', forehead: 0 }),
  hair('M14', '눈 가린 앞머리', { bangs: 'oneEye', forehead: 1, ear: true, coversEye: true }),
]

export const HAIR_BY_ID: Record<HairId, HairSpec> = Object.fromEntries(
  HAIR_SPECS.map((h) => [h.id, h]),
)
export const HAIR_IDS: HairId[] = HAIR_SPECS.map((h) => h.id)
export const HAIR_IDS_F: HairId[] = HAIR_SPECS.filter((h) => h.set === 'F').map((h) => h.id)
export const HAIR_IDS_M: HairId[] = HAIR_SPECS.filter((h) => h.set === 'M').map((h) => h.id)

export function hairSpec(id: HairId | number | undefined): HairSpec {
  if (typeof id === 'string' && HAIR_BY_ID[id]) return HAIR_BY_ID[id]
  return HAIR_SPECS[0]
}

/** 얼굴이 시작하는 줄. 여자 앞머리는 여기까지 덮는다 */
const FACE_TOP = HEAD_Y + 6
/** 정면 얼굴 칸 */
const FACE_L = 12
const FACE_R = 19
/** 옆얼굴에서 이마가 보이는 칸 */
const SIDE_BROW_L = 18
const SIDE_BROW_R = 21

/**
 * 이마를 드러낸다 — 머리통 맵의 머리칸을 살로 덮는다.
 *
 * 위로 갈수록 한 칸씩 좁힌다. 같은 폭으로 세 줄을 그대로 드러내면 머리가
 * 벗어진 사람이 된다. 좁혀 놓으면 헤어라인이 둥글게 남는다.
 */
function foreheadRows(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.forehead || dir === 'up') return []
  const side = dir === 'right'
  const [x0, x1] = side ? [SIDE_BROW_L + 1, SIDE_BROW_R] : [FACE_L, FACE_R]
  const out: Row[] = []
  for (let i = 0; i < spec.forehead; i++) {
    const y = FACE_TOP - i
    const inset = side ? Math.max(0, i - 1) : i
    out.push([y, x0 + inset, x1 - inset])
  }
  return out
}

/** 드러난 이마 위에 앞머리를 다시 얹는다. */
function bangRows(spec: HairSpec, dir: Dir): Row[] {
  if (dir === 'up') return []
  const y = FACE_TOP
  if (dir === 'right') {
    if (spec.bangs === 'none') return []
    if (spec.bangs === 'straight' || spec.bangs === 'bowl' || spec.bangs === 'choppy' || spec.bangs === 'heavy') {
      return [[y + 1, SIDE_BROW_L, SIDE_BROW_R - 1]]
    }
    if (spec.bangs === 'oneEye') return [[y, SIDE_BROW_L, SIDE_BROW_R], [y + 1, SIDE_BROW_L + 1, SIDE_BROW_R]]
    // 이마를 비워 놓는 앞머리도 옆에서는 이마에 한 줄 걸린다. 안 그리면
    // 옆모습만 이마가 훤한 딴사람이 된다
    if (spec.bangs === 'seeThrough' || spec.bangs === 'curtain' || spec.bangs === 'baby') {
      return [[y, SIDE_BROW_L, SIDE_BROW_R - 1]]
    }
    return spec.forehead ? [] : [[y, SIDE_BROW_L - 1, SIDE_BROW_R]]
  }
  switch (spec.bangs) {
    case 'full':
      return [[y, FACE_L, FACE_R]]
    case 'straight':
      return [[y, FACE_L, FACE_R], [y + 1, FACE_L, FACE_R]]
    case 'bowl':
      return [[y, FACE_L, FACE_R], [y + 1, FACE_L, FACE_R]]
    case 'part':
      return [[y, FACE_L, FACE_L + 3]]
    case 'half':
      return [[y, FACE_L, FACE_L + 4]]
    case 'diag':
      return [[y - 1, FACE_L, FACE_L + 5], [y, FACE_L, FACE_L + 3]]
    case 'comma':
      return [[y - 1, FACE_L, FACE_L + 5], [y, FACE_L, FACE_L + 3], [y + 1, FACE_L, FACE_L + 1]]
    case 'round':
      return [[y - 1, FACE_L + 1, FACE_R - 1], [y, FACE_L + 1, FACE_R - 1]]
    case 'oneEye':
      return [[y - 1, FACE_L, FACE_L + 4], [y, FACE_L, FACE_L + 4], [y + 1, FACE_L, FACE_L + 3], [y + 2, FACE_L, FACE_L + 2]]
    // 시스루 — 숱을 세 갈래로만 남긴다. 사이로 이마가 비친다
    case 'seeThrough':
      return [[y, FACE_L, FACE_L + 1], [y, FACE_L + 3, FACE_L + 4], [y, FACE_R - 1, FACE_R]]
    // 커튼 — 가운데를 갈라 양옆으로 흘린다. 이마 한가운데가 열린다
    case 'curtain':
      return [
        [y - 1, FACE_L, FACE_L + 2], [y, FACE_L, FACE_L + 1],
        [y - 1, FACE_R - 2, FACE_R], [y, FACE_R - 1, FACE_R],
      ]
    // 짧은 앞머리 — 눈썹 한참 위에서 끊는다. 아래로 이마가 한 줄 남는다
    case 'baby':
      return [[y - 1, FACE_L + 1, FACE_R - 1]]
    // 두꺼운 앞머리 — 눈썹 줄을 다 덮고 한 겹 더 내려온다. 가운데가
    // 살짝 좁아 둥글다.
    //
    // **아래로 쌓아야 한다.** 이마를 안 비우는 머리(여자 기본)는
    // 눈썹 줄 위가 이미 머리칸이라, 위에 얹은 것은 한 칸도 안 보인다 —
    // 위로 쌓았더니 기본 단발과 픽셀 하나 다르지 않았다
    case 'heavy':
      return [[y, FACE_L, FACE_R], [y + 1, FACE_L + 1, FACE_R - 1]]
    // 숱 친 일자 — 일자로 자르되 밑단이 들쭉날쭉하다
    case 'choppy':
      return [
        [y, FACE_L, FACE_R],
        [y + 1, FACE_L, FACE_L + 1], [y + 1, FACE_L + 3, FACE_L + 4], [y + 1, FACE_R - 1, FACE_R],
      ]
    case 'none':
      return []
  }
}

/**
 * 귀 한 칸(살). 눈높이에만, 양쪽에 둔다 — 한쪽만 내면 얼굴에 구멍이
 * 뚫린 것처럼 보인다. 귀 바깥 한 칸이 구레나룻으로 남는다.
 */
function earRows(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.ear || dir !== 'down') return []
  const out: Row[] = []
  for (let y = FACE_TOP + 2; y <= FACE_TOP + 3; y++) out.push([y, 11, 11], [y, 20, 20])
  return out
}

/** 가르마 — 정수리를 1칸 가른다. */
function partRows(spec: HairSpec, dir: Dir): Row[] {
  if (spec.partLine !== 'center' || dir !== 'down') return []
  // 이마 바로 위 두 칸만. 정수리까지 그으면 흉터처럼 보인다
  return [[FACE_TOP - 2, 15, 15], [FACE_TOP - 1, 15, 15]]
}

/** 뒤로 넘긴 결 두 줄(올백)·민 부분(투블럭) — 머리칸만 어둡게 한다. */
function hairShadeRows(spec: HairSpec, dir: Dir): Row[] {
  const out: Row[] = []
  if (spec.partLine === 'back' && dir !== 'up') {
    if (dir === 'right') out.push([HEAD_Y + 2, 11, 20], [HEAD_Y + 4, 11, 20])
    else out.push([HEAD_Y + 2, FACE_L, FACE_R], [HEAD_Y + 4, FACE_L, FACE_R])
  }
  for (let i = 0; i < spec.undercut; i++) {
    const y = HEAD_BOTTOM - 1 - i
    if (dir === 'right') out.push([y, HEAD_X + 1, HEAD_X + 7])
    else if (dir === 'up') out.push([y, HEAD_X + 1, HEAD_X + 12])
    else out.push([y, HEAD_X + 1, HEAD_X + 3], [y, HEAD_X + 10, HEAD_X + 12])
  }
  return out
}

/** 윤곽 밖 1칸 삐침. 짧은 머리 중에서도 헝클어진 것만 쓴다. */
const ROUGH_SPIKES_FRONT: Row[] = [[HEAD_Y - 1, 14, 14], [HEAD_Y - 1, 18, 18], [HEAD_Y + 1, 10, 10], [HEAD_Y + 2, 22, 22], [HEAD_Y + 9, 9, 9]]
const ROUGH_SPIKES_SIDE: Row[] = [[HEAD_Y - 1, 13, 13], [HEAD_Y - 1, 17, 17], [HEAD_Y + 1, 10, 10], [HEAD_Y + 5, 8, 8], [HEAD_Y + 9, 9, 9]]
const ROUGH_CURLY_FRONT: Row[] = [[HEAD_Y - 1, 14, 14], [HEAD_Y - 1, 17, 17], [HEAD_Y + 1, 10, 10], [HEAD_Y + 1, 21, 21], [HEAD_Y + 3, 8, 8], [HEAD_Y + 5, 23, 23], [HEAD_Y + 7, 8, 8], [HEAD_Y + 10, 22, 22]]
const ROUGH_CURLY_SIDE: Row[] = [[HEAD_Y - 1, 13, 13], [HEAD_Y - 1, 16, 16], [HEAD_Y + 1, 10, 10], [HEAD_Y + 3, 8, 8], [HEAD_Y + 5, 8, 8], [HEAD_Y + 7, 8, 8], [HEAD_Y + 10, 9, 9]]

function roughRows(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.rough) return []
  const side = dir === 'right'
  if (spec.rough === 'spikes') return side ? ROUGH_SPIKES_SIDE : ROUGH_SPIKES_FRONT
  return side ? ROUGH_CURLY_SIDE : ROUGH_CURLY_FRONT
}

/** 몸통 옆으로 흐르는 옆머리. 폭 두 칸, 몸(10~21칸) 바깥에 붙는다. */
function sideStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.sideTo || dir === 'right') return []
  const out: Row[] = []
  for (let y = HEAD_BOTTOM; y <= spec.sideTo; y++) {
    // 물결 — 두 줄마다 한 칸 안팎으로 흔든다
    const w = spec.wave && (y - HEAD_BOTTOM) % 4 >= 2 ? 1 : 0
    // 보브는 끝이 안으로 말린다
    const c = spec.curlIn && y >= spec.sideTo - 1 ? 1 : 0
    out.push([y, 8 + w + c, 9 + w + c])
    out.push([y, 22 - w - c, 23 - w - c])
  }
  return out
}

/** 등을 타고 내려오는 뒷머리. 몸을 덮지 않는다. */
function backStrands(spec: HairSpec, dir: Dir): Row[] {
  if (!spec.backTo) return []
  const out: Row[] = []
  if (dir === 'right') for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 10, 13])
  else if (dir === 'up') for (let y = HEAD_BOTTOM; y <= spec.backTo; y++) out.push([y, 11, 20])
  return out
}

/** 묶은 머리·번·스파이크. 머리통에 붙어 있어야 한다. */
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
    case 'bigBun':
      // 정수리 뒤쪽 4×3. 머리 위로 두 칸까지만 올라간다
      if (near) out.push([HEAD_Y - 2, 9, 12], [HEAD_Y - 1, 8, 12], [HEAD_Y, 8, 11])
      else if (dir === 'up') out.push([HEAD_Y - 2, 14, 17], [HEAD_Y - 1, 13, 18], [HEAD_Y, 13, 18])
      else out.push([HEAD_Y - 2, 15, 18], [HEAD_Y - 1, 15, 18], [HEAD_Y, 16, 19])
      break
    case 'spike':
      // 뾰족 네 개. 머리 위로 두 칸까지
      if (near) out.push([HEAD_Y - 2, 12, 12], [HEAD_Y - 1, 12, 13], [HEAD_Y - 2, 15, 15], [HEAD_Y - 1, 15, 16], [HEAD_Y - 1, 18, 19])
      else out.push([HEAD_Y - 2, 13, 13], [HEAD_Y - 1, 13, 14], [HEAD_Y - 2, 16, 16], [HEAD_Y - 1, 16, 17], [HEAD_Y - 2, 19, 19], [HEAD_Y - 1, 18, 19])
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

function facePix(expression: number, dir: Dir, hair: HairSpec): Pix[] {
  if (dir === 'up') return []
  const spec = EXPRESSIONS[expression % EXPRESSIONS.length]
  const out: Pix[] = []
  for (let r = 0; r < spec.map.length; r++) {
    for (let c = 0; c < spec.map[r].length; c++) {
      const ch = spec.map[r][c]
      if (dir === 'right') {
        // 옆모습은 오른쪽 눈만 쓰고 입은 생략한다
        if (ch !== 'E' || c < 4 || hair.coversEye) continue
        out.push({ x: SIDE_EYE_X - RIGHT_EYE_COL + c, y: FACE_Y + r, mat: 'eye', shade: 'base' })
        continue
      }
      const x = FACE_X + c
      const y = FACE_Y + r
      // 앞머리가 덮은 눈은 그리지 않는다
      if (hair.coversEye && x <= FACE_L + 4) continue
      if (ch === 'S') out.push({ x, y, mat: 'skin', shade: 'base' })
      else if (ch === 'E') out.push({ x, y, mat: 'eye', shade: 'base' })
      else if (ch === 'M') out.push({ x, y, mat: 'mouth', shade: 'base' })
      else if (ch === 'P') out.push({ x, y, mat: 'blush', shade: 'base' })
    }
  }
  return out
}

// ── 교복 ────────────────────────────────────────────────────────
// 전원 같은 학교다. 그래서 옷 색은 고르는 값이 아니다 — SCHOOL_PALETTE 한
// 벌뿐이고, 복장 × 착용 스타일 × 하의 × 목 장식 네 갈래로만 달라진다.
//
// 몸 실루엣 맵은 한 글자도 바꾸지 않는다. 바뀌는 것은 맵의 글자를 무슨
// 재질로 칠하느냐와, 그 위에 한두 칸짜리 디테일을 얹느냐뿐이다. 그래야
// 무엇을 입어도 사람의 덩치가 같고, 완장 자리가 그대로 남는다.

type Cloth = keyof typeof SCHOOL_PALETTE

export interface OutfitSpec {
  name: string
  /** 한 줄 설명. 고르는 화면에서 이 옷이 무엇인지 알려 준다 */
  note: string
  /** 몸통 천 */
  body: Cloth
  /** 팔 천. 없으면 몸통과 같다 — 춘추복만 다르다(조끼 몸통 + 셔츠 소매) */
  arm?: Cloth
  /** 반팔 — 팔 아랫부분이 맨살. 팔에 살이 보이는 유일한 복장이다 */
  shortSleeve?: boolean
  /** 앞을 여미는 겉옷. 껄렁하게 입으면 앞이 벌어져 셔츠가 보인다 */
  over?: boolean
  /** 가운데 세로 단추선 — 가디건 */
  buttons?: boolean
  /** 팔·다리 바깥에 흰 줄 — 체육복 */
  stripe?: boolean
  /** 목 뒤에 후드 덩어리. 정면에서도 어깨 위로 한 칸씩 삐져나온다 */
  hood?: boolean
  /**
   * 어깨에 한 줄 그늘. 겉옷은 안에 셔츠를 껴입은 만큼 어깨가 도톰하다.
   *
   * **실루엣은 못 넓힌다.** 넓히면 옷을 갈아입을 때 사람 덩치가
   * 달라져서, 멀리서 보면 다른 사람이 온 것처럼 보인다. 그래서
   * 윤곽 안쪽에 그늘 한 줄로 두께를 낸다.
   */
  padded?: boolean
  /**
   * 바탕이 셔츠만큼 밝다. 흰 깃과 명찰을 흰색으로 얹으면 안 보이므로,
   * 이 옷에서는 둘을 그늘색으로 뒤집어 그린다.
   */
  pale?: boolean
  /** 깃도 목 장식도 없다 — 체육복 */
  bare?: boolean
  /** 하의 선택을 무시하고 이 천을 입는다 */
  fixedBottom?: Cloth
}

/**
 * 복장 여섯.
 *
 * **색만 다르면 안 된다.** 32칸 안에서 색 차이는 한 단계 어두워진
 * 것으로만 보이고, 어두운 복도에 서면 그마저 사라진다. 그래서 여섯이
 * 저마다 **모양으로** 갈린다 —
 *
 *   하복   팔에 살이 보인다
 *   춘추복 몸통과 팔의 색이 다르다
 *   동복   어깨가 도톰하고 가슴에 V가 깊다
 *   가디건 가운데 단추가 점점이 박힌다
 *   후드   목 뒤가 두껍다
 *   체육복 팔다리에 흰 줄이 있고 깃이 없다
 *
 * 하나씩 봐도 무엇을 입었는지 알 수 있어야 한다.
 */
export const OUTFITS: OutfitSpec[] = [
  { name: '하복', note: '반팔. 여름에는 이것뿐이다', body: 'shirt', shortSleeve: true, pale: true },
  { name: '춘추복', note: '흰 셔츠 위에 조끼를 껴입는다', body: 'vest', arm: 'shirt' },
  { name: '동복', note: '남색 블레이저. 정장에 가깝다', body: 'blazer', over: true, padded: true },
  { name: '가디건', note: '단추를 채워 입는 니트', body: 'cardigan', over: true, buttons: true },
  { name: '후드집업', note: '교칙에는 없지만 다들 입는다', body: 'hood', over: true, hood: true },
  { name: '체육복', note: '체육 시간 뒤로 갈아입지 않았다', body: 'gym', stripe: true, bare: true, fixedBottom: 'gym' },
]
export const OUTFIT_NAMES = OUTFITS.map((o) => o.name)

/** 0 단정 · 1 보통 · 2 껄렁 */
export const WEAR_STYLE_NAMES = ['단정', '보통', '껄렁']
export const NEAT = 0
export const LOOSE = 2
/** 0 넥타이 · 1 리본 · 2 없음 */
export const NECKWEAR_NAMES = ['넥타이', '리본', '없음']
const NO_NECK = 2

/**
 * 몸 맵을 한 번 훑어 팔·다리가 어디인지 찾아 둔다.
 *
 * 팔은 "양옆이 테두리로 막힌 소매칸(w) 기둥"이다. 걸음 프레임마다 팔이
 * 옮겨 다니므로 칸 번호를 못 박아 두면 안 된다. 다리는 L 덩어리다.
 */
interface BodyScan {
  arm: Set<string>
  /** 팔 기둥의 맨 위칸 — 반팔 경계를 여기서 센다 */
  armTop: Map<number, number>
  /** 팔 기둥의 맨 아랫칸 — 소매를 걷는 자리 */
  armLow: Set<string>
  /** 팔·다리의 바깥쪽 칸 — 체육복 줄 */
  outer: Set<string>
  /** 한쪽 바짓단 — 껄렁하게 걷어 올리는 자리 */
  cuff: string | null
  /** 하의가 시작하는 줄 */
  hem: number
}

const key = (x: number, y: number) => `${x},${y}`
const MID = 7

function scanBody(map: string[]): BodyScan {
  const arm = new Set<string>()
  const outer = new Set<string>()
  const legLow: string[] = []
  let hem = map.length
  for (let y = 0; y < map.length; y++) {
    const row = map[y]
    if (hem === map.length && row.includes('D')) hem = y
    let x = 0
    while (x < row.length) {
      const c = row[x]
      if (c !== 'w' && c !== 'L') {
        x++
        continue
      }
      let e = x
      while (row[e + 1] === c) e++
      if (c === 'w') {
        if (row[x - 1] === 'O' && row[e + 1] === 'O') {
          for (let i = x; i <= e; i++) arm.add(key(i, y))
          // 한 칸짜리 팔에 줄을 그으면 소매가 통째로 흰 막대가 된다
          if (e > x) outer.add(key((x + e) / 2 < MID ? x : e, y))
        }
      } else {
        outer.add(key((x + e) / 2 < MID ? x : e, y))
      }
      x = e + 1
    }
  }
  const armTop = new Map<number, number>()
  const armLow = new Set<string>()
  for (const k of arm) {
    const [x, y] = k.split(',').map(Number)
    armTop.set(x, Math.min(armTop.get(x) ?? y, y))
    if (!arm.has(key(x, y + 1))) armLow.add(k)
  }
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'L' && map[y + 1]?.[x] !== 'L') legLow.push(key(x, y))
    }
  }
  // 화면 오른쪽 다리 한쪽만 걷는다
  legLow.sort((a, b) => Number(b.split(',')[0]) - Number(a.split(',')[0]))
  return { arm, armTop, armLow, outer, cuff: legLow[0] ?? null, hem }
}

const scanCache = new Map<string[], BodyScan>()
function bodyScan(map: string[]): BodyScan {
  let hit = scanCache.get(map)
  if (!hit) {
    hit = scanBody(map)
    scanCache.set(map, hit)
  }
  return hit
}

interface WearCtx {
  o: OutfitSpec
  style: number
  neck: number
  skirt: boolean
  dir: Dir
  scan: BodyScan
}

// ── 옷의 자리 ───────────────────────────────────────────────────
//
// 몸 맵 안에서의 칸 번호다. 맵을 안 고치기로 했으므로 여기 숫자는
// 맵의 글자와 맞아떨어져야 한다 — 가슴 한가운데가 T 두 칸(6,7)이고
// 그 양옆이 몸통(5,8), 또 그 밖이 어깨 끝(4,9)이다.
/** 가슴 한가운데. 목 장식과 단추가 여기 선다 */
const CHEST_L = 6
const CHEST_R = 7
/** 깃이 서는 칸 — 가슴 양옆 */
const COLLAR_L = 5
const COLLAR_R = 8
/** 어깨 끝 — 후드가 삐져나오고 껄렁한 어깨가 처지는 자리 */
const SHOULDER_L = 4
const SHOULDER_R = 9
/** 명찰 — 화면 왼쪽 가슴 */
const BADGE_X = 4
const BADGE_Y = 2

/** 몸 맵의 글자 하나를 재질과 그늘로 바꾼다. */
function roleOf(c: string, x: number, y: number, w: WearCtx): { mat: Mat; shade: Shade } | null {
  const { o, style, scan } = w
  const k = key(x, y)
  const onArm = scan.arm.has(k)
  switch (c) {
    case 'W':
    case 'w': {
      const shade: Shade = c === 'w' ? 'shade' : 'base'
      if (onArm) {
        // 반팔 — 소매는 어깨 한 칸뿐이고 그 아래는 전부 맨살이다.
        // **팔에 살이 보이는 복장은 하복 하나뿐이라** 1배율에서도
        // 이것 하나로 하복인 줄 안다
        if (o.shortSleeve && y - (scan.armTop.get(x) ?? y) >= 1) return { mat: 'skin', shade: 'base' }
        // 껄렁 — 긴소매를 걷어 손목 한 칸이 드러난다
        if (style === LOOSE && !o.shortSleeve && scan.armLow.has(k)) return { mat: 'skin', shade: 'base' }
        if (o.stripe && scan.outer.has(k)) return { mat: 'stripe', shade: 'base' }
        return { mat: o.arm ? 'collar' : 'shirt', shade }
      }
      // 겉옷은 어깨가 도톰하다. 윤곽을 넓히는 대신 안쪽에 그늘 한 줄
      if (o.padded && y === 0 && (x === SHOULDER_L || x === SHOULDER_R)) {
        return { mat: 'shirt', shade: 'shade' }
      }
      return { mat: 'shirt', shade }
    }
    case 'T':
      return chestCell(y, w)
    case 'K':
      return { mat: 'skin', shade: 'base' }
    case 'D':
      // 껄렁 — 셔츠를 빼입어 밑단이 하의 윗줄을 덮는다. 겉옷이 아니라
      // 속 셔츠가 나오는 것이므로 셔츠 색이다
      if (style === LOOSE && y === scan.hem) return { mat: 'collar', shade: 'base' }
      // 치마는 무릎 길이에 짙은 가로선 한 줄
      if (w.skirt && !o.fixedBottom && y === scan.hem + 1) return { mat: 'bottom', shade: 'shade' }
      return { mat: 'bottom', shade: 'base' }
    case 'd':
      return { mat: 'bottom', shade: 'shade' }
    case 'L': {
      if (o.stripe && scan.outer.has(k)) return { mat: 'stripe', shade: 'base' }
      // 껄렁 — 한쪽 바짓단을 걷어 발목 한 칸이 드러난다
      if (style === LOOSE && !w.skirt && scan.cuff === k) return { mat: 'leg', shade: 'base' }
      return w.skirt ? { mat: 'leg', shade: 'base' } : { mat: 'bottom', shade: 'base' }
    }
    case 'F':
      return { mat: 'shoe', shade: 'base' }
    default:
      return null
  }
}

/**
 * 가슴 한가운데 두 칸이 바탕으로 무슨 색인가.
 *
 * 목 장식과 깃은 이 위에 따로 얹는다(wearPix). 여기서 정하는 것은
 * **그 뒤에 무엇이 있는가**뿐이다 — 목인가, 속 셔츠인가, 겉옷인가.
 */
function chestCell(y: number, w: WearCtx): { mat: Mat; shade: Shade } {
  const { o, style } = w
  // 체육복은 깃이 없다. 가운데 지퍼 한 줄만 선다
  if (o.bare) return { mat: 'shirt', shade: y === 0 ? 'base' : 'shade' }
  // 깃이 V로 벌어진 자리. 껄렁하면 한 줄 더 벌어져 목이 더 보인다
  if (y <= (style === LOOSE ? 1 : 0)) return { mat: 'skin', shade: 'base' }
  // 껄렁 — 겉옷 앞을 풀어 속 셔츠가 두 칸 보인다
  if (style === LOOSE && o.over) return { mat: 'collar', shade: 'base' }
  // 여미고 입으면 겉옷 색 그대로, 겉옷이 아니면 셔츠 그대로
  return { mat: 'shirt', shade: 'base' }
}

/**
 * 맵 위에 얹는 옷 디테일. 전부 완장(layer 7)보다 아래에 그린다 —
 * 껄렁한 앞섶도 빼입은 셔츠도 완장을 가리지 못한다.
 *
 * **교복으로 보이게 하는 것이 여기 다 있다.** 흰 깃, 목 장식, 명찰 —
 * 이 셋 중 둘이 안 보이면 그냥 사복이다. 32칸 안에서 「교복」은 천의
 * 색이 아니라 이 작은 표지들로 읽힌다.
 *
 * 쓸 수 있는 자리는 가슴 다섯 줄(0~4) × 여섯 칸(4~9)뿐이다. 그 안에서
 * 서로 자리를 빼앗지 않게 칸을 나눠 뒀다 —
 *
 *   깃    x5·x8      목 양옆. 목 장식이 여기를 밟지 않는다
 *   목구멍 x6·x7 0줄  깃이 V로 벌어진 자리. 살이 보인다
 *   목장식 x6·x7 1줄~ 매듭부터 아래로
 *   명찰   x4  2줄    한 칸. 팔·완장과 겹치지 않는다
 *   단추   x5  2~4줄  가디건. 가운데는 넥타이가 쓰므로 한 칸 옆이다
 */
function wearPix(w: WearCtx, map: string[]): Pix[] {
  const { o, style, neck, scan } = w
  const out: Pix[] = []
  if (w.dir !== 'down') return out
  const add = (x: number, y: number, mat: Mat, shade: Shade = 'base') =>
    out.push({ x: BODY_X + x, y: BODY_Y + y, mat, shade })
  const neat = style === NEAT
  const loose = style === LOOSE
  // 밝은 옷 위에는 흰 표지가 안 보인다. 그때만 그늘색으로 뒤집는다
  const markShade: Shade = o.pale ? 'shade' : 'base'

  // ── 흰 셔츠 깃 ────────────────────────────────────────────────
  // **가장 중요한 단서다.** 목 양옆에 흰 기둥 둘.
  //
  // 단정은 두 줄이라 목을 감싸고, 보통은 한 줄, 껄렁은 한 줄이 아래로
  // 내려가 앞이 벌어진 것처럼 보인다. **깃 높이가 착용 스타일을 가르는
  // 가장 큰 차이다** — 한 칸짜리 목 장식 길이보다 눈에 띈다.
  if (!o.bare) {
    const top = loose ? 1 : 0
    const tall = neat ? 1 : 0
    for (let i = 0; i <= tall; i++) {
      add(COLLAR_L, top + i, 'collar', markShade)
      add(COLLAR_R, top + i, 'collar', markShade)
    }
  }

  // ── 후드 ──────────────────────────────────────────────────────
  // 목 뒤가 두꺼운 유일한 복장. 정면에서도 어깨 위로 한 칸씩 나온다
  if (o.hood) {
    add(SHOULDER_L, 0, 'shirt', 'shade')
    add(SHOULDER_R, 0, 'shirt', 'shade')
  }

  // ── 가디건 단추 ───────────────────────────────────────────────
  // **가운데가 아니라 한 칸 옆이다.** 가운데는 넥타이가 덮어서, 거기
  // 그리면 목 장식을 「없음」으로 둔 사람만 단추를 본다
  if (o.buttons) {
    for (let y = 2; y <= 4; y++) add(COLLAR_L, y, 'shirt', y === 3 ? 'light' : 'shade')
  }

  // ── 목 장식 ───────────────────────────────────────────────────
  if (!o.bare && neck !== NO_NECK) {
    // 껄렁하면 한 칸 내려가고 한 칸 옆으로 비뚤어진다
    const top = 1 + (loose ? 1 : 0)
    const off = loose ? 1 : 0
    if (neck === 1) {
      // 리본 — 매듭 양옆으로 날개가 한 칸씩. 넥타이보다 넓고 짧다
      add(CHEST_L + off, top, 'accent', 'base')
      add(CHEST_R + off, top, 'accent', 'base')
      add(CHEST_L - 1 + off, top, 'accent', 'shade')
      add(CHEST_R + 1 + off, top, 'accent', 'shade')
      add(CHEST_L + off, top + 1, 'accent', 'shade')
      add(CHEST_R + off, top + 1, 'accent', 'shade')
    } else {
      // 넥타이 — 매듭 아래로 날이 내려간다. 몸통이 다섯 줄뿐이라
      // 길이는 두 칸까지다. 보통은 한 칸 짧다
      const len = neat ? 2 : 1
      add(CHEST_L + off, top, 'accent', 'light')
      add(CHEST_R + off, top, 'accent', 'light')
      for (let i = 1; i <= len; i++) {
        add(CHEST_L + off, top + i, 'accent', 'base')
        add(CHEST_R + off, top + i, 'accent', 'base')
      }
      // 끝이 뾰족하게 한 칸
      add(CHEST_L + off, top + len + 1, 'accent', 'shade')
    }
  }

  // ── 명찰 ──────────────────────────────────────────────────────
  // 한 칸짜리지만 교복 신호가 강하다. 껄렁하면 떼고 다닌다
  if (!o.bare && !loose) add(BADGE_X, BADGE_Y, 'stripe', markShade)

  // ── 허리·어깨 ─────────────────────────────────────────────────
  if (neat) {
    // 단정 — 셔츠를 넣어 입어 허리선이 또렷하다
    for (let x = 0; x < map[scan.hem].length; x++) {
      if (map[scan.hem][x] === 'D') add(x, scan.hem, 'bottom', 'shade')
    }
  } else if (loose) {
    // 껄렁 — 한쪽 어깨가 처진다. 윤곽은 못 건드리니 그늘로 기울인다.
    // **깃(x5·x8)은 안 건드린다** — 여기를 덮으면 교복 단서가 하나 준다
    add(SHOULDER_R, 0, 'shirt', 'shade')
  }
  return out
}

/** 몸 맵을 칸 목록으로 편다. O는 이웃 글자를 보고 어느 색의 테두리인지 정한다. */
function readBody(map: string[], w: WearCtx): Pix[] {
  const out: Pix[] = []
  const at = (x: number, y: number) => map[y]?.[x] ?? '.'
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const c = at(x, y)
      if (c === '.') continue
      let cell = roleOf(c, x, y, w)
      if (c === 'O') {
        const near = [
          roleOf(at(x, y - 1), x, y - 1, w),
          roleOf(at(x, y + 1), x, y + 1, w),
          roleOf(at(x - 1, y), x - 1, y, w),
          roleOf(at(x + 1, y), x + 1, y, w),
        ].find((r) => r !== null)
        cell = { mat: near?.mat ?? 'shirt', shade: 'line' }
      }
      if (!cell) continue
      out.push({ x: BODY_X + x, y: BODY_Y + y, mat: cell.mat, shade: cell.shade })
    }
  }
  return out.concat(wearPix(w, map))
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

  /** 이미 머리칸인 자리만 그늘로 눌러 준다 — 민 부분·뒤로 넘긴 결. */
  shadeHair(rows: readonly Row[]): void {
    for (const [y, x0, x1] of rows) {
      for (let x = Math.max(0, x0); x <= Math.min(PX - 1, x1); x++) {
        const c = this.at(x, y)
        if (c?.mat === 'hair' && c.shade !== 'line') c.shade = 'shade'
      }
    }
  }

  /** 반삭 — 머리 전체를 윤기 없이 한 톤으로. */
  flattenHair(): void {
    for (const c of this.cells) if (c?.mat === 'hair' && c.shade !== 'line') c.shade = 'shade'
  }

  at(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= PX || y >= PX) return null
    return this.cells[y * PX + x]
  }
}

function tonesFor(look: AvatarLook, team: TeamId | null): Record<Mat, Tone> {
  const o = OUTFITS[look.outfit % OUTFITS.length]
  const P = SCHOOL_PALETTE
  const skirt = look.bottom === 1
  // 껄렁하게 입은 치마 밑에는 체육복 바지를 받쳐 입는다
  const gymLegs = skirt && look.wearStyle === LOOSE
  return {
    skin: SKIN,
    hair: HAIR_COLORS[look.hairColor % HAIR_COLORS.length].tone,
    shirt: P[o.body],
    collar: o.arm ? P[o.arm] : P.shirt,
    stripe: P.gymLine,
    accent: P.neck,
    bottom: o.fixedBottom ? P[o.fixedBottom] : skirt ? P.skirt : P.trousers,
    leg: gymLegs ? P.gym : SKIN,
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
  const spec = hairSpec(look.hairStyle)
  const o = OUTFITS[look.outfit % OUTFITS.length]
  const map = bodyMap(facing, pose)
  const g = new Grid()

  // 몸 뒤로 흐르는 머리 먼저
  g.paint(backStrands(spec, facing), 'hair', 'auto', 0)
  g.paint(tails(spec, facing), 'hair', 'auto', 0)

  // 몸 — 맵 그대로. 옷은 글자를 무슨 색으로 칠하느냐로만 갈린다
  const wear: WearCtx = {
    o,
    style: look.wearStyle,
    neck: look.neckwear,
    skirt: look.bottom === 1 && !o.fixedBottom,
    dir: facing,
    scan: bodyScan(map),
  }
  for (const p of readBody(map, wear)) g.put(p, MAT_LAYER[p.mat])

  // 완장은 옷 위·머리 아래. 어떤 복장·스타일에서도 여기가 가려지지 않는다
  if (team) g.paint(bandRows(side, facing), 'band', 'base', MAT_LAYER.band)

  // 머리는 맨 마지막 — 목이 없으니 턱이 어깨 위에 바로 앉는다
  const head = facing === 'up' ? HEAD_BACK : side ? HEAD_SIDE : HEAD_FRONT
  for (const p of head) g.put(p, MAT_LAYER.hair)
  g.paint(sideStrands(spec, facing), 'hair')
  g.paint(backStrands(spec, facing), 'hair', 'auto', 0)
  g.paint(roughRows(spec, facing), 'hair')
  g.paint(foreheadRows(spec, facing), 'skin', 'base', MAT_LAYER.hair)
  g.paint(earRows(spec, facing), 'skin', 'base', MAT_LAYER.hair)
  g.paint(partRows(spec, facing), 'skin', 'base', MAT_LAYER.hair)

  // 표정을 먼저 찍고 그 위에 앞머리를 얹는다. 표정은 얼굴칸 8×4를 통째로
  // 갈아 끼우므로, 눈썹까지 내려오는 앞머리를 먼저 그리면 표정이 그걸
  // 지워 버린다 — 일자 앞머리와 쉼표머리가 기본 앞머리가 돼 버린다.
  for (const p of facePix(look.expression, facing, spec)) g.put(p, MAT_LAYER[p.mat])
  g.paint(bangRows(spec, facing), 'hair', 'base', MAT_LAYER.hair)

  g.shadeHair(hairShadeRows(spec, facing))
  if (spec.flat) g.flattenHair()
  else {
    for (const [x, y] of side ? STRANDS_SIDE : STRANDS_FRONT) {
      if (g.at(x, y)?.mat === 'hair') g.paint([[y, x, x]], 'hair', 'shade', MAT_LAYER.hair)
    }
  }
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
  const id =
    `${look.hairStyle}-${look.hairColor}-${look.expression}-${look.outfit}` +
    `-${look.wearStyle}-${look.bottom}-${look.neckwear}-${team ?? '-'}-${dir}-${frame}`
  const hit = cache.get(id)
  if (hit) return hit
  const drawn = paint(build(look, team, dir, WALK[frame % WALK.length]), tonesFor(look, team))
  const out = dir === 'left' ? mirrored(drawn) : drawn
  cache.set(id, out)
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
