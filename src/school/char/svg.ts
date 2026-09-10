// 벡터 아바타. 도트 격자 대신 곡선으로 그린다.
//
// 32칸 격자 안에서는 계단이 그대로 보여 머리 모양 열다섯 개를 구분하기 어려웠다.
// SVG는 곡선을 그대로 그릴 수 있어 작게 줄여도 실루엣이 뭉개지지 않는다.
// 대신 규칙은 도트 때와 똑같이 지킨다 —
//   · 좌표계 하나(64×96)를 못 박고 모든 파츠가 그 위에 얹힌다
//   · 머리·얼굴·옷을 따로 만들어 자유롭게 조합한다
//   · 무엇을 갈아 끼워도 머리 크기·눈 위치·키가 변하지 않는다
//
// 색은 팔레트에서 온다. 학교와 지도는 흑백이고 사람만 색을 가진다.
import { BAND_TONES, CLOTH, HAIR_COLORS, tone, type Tone } from './palette'
import type { TeamId } from '../types'

export const VIEW_W = 64
export const VIEW_H = 96

/** 머리통 — 모든 파츠의 기준. 이 타원은 어떤 조합에서도 변하지 않는다. */
const HEAD = { cx: 32, cy: 28, rx: 18, ry: 19 }
/** 얼굴 기준선 */
const EYE_Y = 32
const EYE_DX = 7.5
const MOUTH_Y = 40
const BROW_Y = 24

const SKIN = tone('#f6d0a8')
const LINE = '#4a3b33'
const SHOE = tone('#3f434b')

const esc = (s: string) => s

function fill(t: Tone, extra = ''): string {
  return `fill="${t.base}" stroke="${t.line}" stroke-width="1.4" stroke-linejoin="round" ${extra}`
}

// ── 몸 ──────────────────────────────────────────────────────────

/** 목·몸통·팔·다리. 옷이 그 위를 덮는다. */
function body(): string {
  return `
    <g ${fill(SKIN)}>
      <path d="M26,42 h12 v14 h-12 z"/>
      <path d="M24,87 h7 v-16 h-7 z" />
      <path d="M33,87 h7 v-16 h-7 z" />
      <path d="M16,54 q-4,2 -4,8 v14 q0,4 4,4 h4 q4,0 4,-4 v-14 q0,-6 -4,-8 z"/>
      <path d="M48,54 q4,2 4,8 v14 q0,4 -4,4 h-4 q-4,0 -4,-4 v-14 q0,-6 4,-8 z"/>
      <path d="M32,50 q-14,1 -16,10 v14 q0,4 4,4 h24 q4,0 4,-4 v-14 q-2,-9 -16,-10 z"/>
      <circle cx="16" cy="79" r="4.6"/>
      <circle cx="48" cy="79" r="4.6"/>
    </g>`
}

function head(): string {
  return `
    <g ${fill(SKIN)}>
      <ellipse cx="12.5" cy="31" rx="3.4" ry="4"/>
      <ellipse cx="51.5" cy="31" rx="3.4" ry="4"/>
      <ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}"/>
    </g>
    <ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}"
      fill="${SKIN.shade}" opacity="0.35" clip-path="url(#lower)"/>`
}

function shoes(): string {
  return `
    <g ${fill(SHOE)}>
      <path d="M23,85 h9 v5 q0,2 -2,2 h-5 q-2,0 -2,-2 z"/>
      <path d="M32,85 h9 v5 q0,2 -2,2 h-5 q-2,0 -2,-2 z"/>
    </g>`
}

// ── 머리카락 15종 ───────────────────────────────────────────────
// front는 얼굴 위, back은 몸 뒤. 앞머리 모양과 뒤로 흐르는 길이로 구분한다.

/** 정수리를 덮는 기본 덩어리. 앞머리 선(hairline)만 바꿔 여러 모양을 낸다. */
function crown(d: string): string {
  return `<path d="${d}"/>`
}

/** 이마를 가로로 덮는 앞머리. 바깥 곡선은 머리통 꼭대기를 확실히 덮어야 한다. */
const BANGS_FULL = 'M13,30 C13,0 51,0 51,30 C51,22 45,18 32,18 C19,18 13,22 13,30 Z'
/** 한쪽으로 넘긴 가르마 */
const BANGS_PART = 'M13,30 C13,0 51,0 51,30 C50,20 44,26 28,20 C21,17 15,22 13,30 Z'
/** 눈썹 위에서 일자로 자른 앞머리 */
const BANGS_STRAIGHT = 'M13,30 C13,0 51,0 51,30 L51,25 Q32,29 13,25 Z'
/** 짧고 위로 뻗친 머리 */
const BANGS_SPIKY =
  'M13,30 C13,0 51,0 51,30 C50,22 46,20 43,22 L45,15 L38,20 L37,13 L31,19 L27,13 L24,20 L19,16 L20,22 C16,20 14,24 13,30 Z'
/** 이마를 시원하게 드러낸 짧은 머리 */
const BANGS_SHORT = 'M13,30 C13,0 51,0 51,30 C50,21 43,17 32,17 C21,17 14,21 13,30 Z'

/** 얼굴 양옆으로 흐르는 머리카락 한 가닥씩. 끝이 살짝 안으로 말린다. */
const sideLocks = (toY: number, w = 5) => {
  const mid = (26 + toY) / 2
  const L = `M13.5,26 C${10.5 - w * 0.2},${mid} 11,${toY - 2} 15,${toY} C19,${toY - 1} 19,${mid} ${13.5 + w},26 Z`
  const R = `M50.5,26 C${53.5 + w * 0.2},${mid} 53,${toY - 2} 49,${toY} C45,${toY - 1} 45,${mid} ${50.5 - w},26 Z`
  return `<path d="${L}"/><path d="${R}"/>`
}

/**
 * 정수리에서 시작해 어깨 뒤로 흐르는 머리 덩어리.
 * 네모난 판이 되지 않게 머리통을 감싸는 곡선으로 내려온다.
 */
const backHair = (toY: number, spread = 3, wavy = false) => {
  const w = HEAD.rx + spread
  const l = 32 - w
  const r = 32 + w
  const mid = (30 + toY) / 2
  const fallL = wavy
    ? `C10,${mid} ${l - 3},${mid + 6} ${l},${toY}`
    : `C10,${mid} ${l},${mid + 6} ${l},${toY}`
  const riseR = wavy
    ? `C${r + 3},${mid + 6} 54,${mid} 52,30`
    : `C${r},${mid + 6} 54,${mid} 52,30`
  return `<path d="M32,7 C18,7 12,17 12,30 ${fallL} Q32,${toY + 7} ${r},${toY} ${riseR} C52,17 46,7 32,7 Z"/>`
}

const tail = (x: number, y0: number, y1: number, w: number) =>
  `<path d="M${x},${y0} q${w},${(y1 - y0) * 0.3} ${w * 0.4},${y1 - y0} q-${w * 0.4},${w * 0.6} -${w * 0.8},0 q-${w * 0.6},-${(y1 - y0) * 0.7} ${w * 0.4},-${y1 - y0} z"/>`

const bun = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`

const braid = (x: number, y0: number, n: number) =>
  Array.from({ length: n }, (_, i) => `<circle cx="${x}" cy="${y0 + i * 6}" r="4"/>`).join('')

export interface HairStyle {
  name: string
  back: string
  front: string
}

export const HAIR_STYLES: HairStyle[] = [
  { name: '기본 단발', back: backHair(52, 3), front: crown(BANGS_FULL) + sideLocks(48) },
  { name: '긴 생머리', back: backHair(82, 4), front: crown(BANGS_FULL) + sideLocks(62) },
  {
    name: '양갈래',
    back: backHair(44, 1) + tail(9, 34, 62, 9) + tail(55, 34, 62, -9),
    front: crown(BANGS_FULL) + sideLocks(38),
  },
  {
    name: '낮은 양갈래',
    back: backHair(50, 2) + tail(10, 48, 76, 9) + tail(54, 48, 76, -9),
    front: crown(BANGS_FULL) + sideLocks(46),
  },
  {
    name: '포니테일',
    back: backHair(42, 0) + tail(52, 30, 68, 10),
    front: crown(BANGS_FULL) + sideLocks(36),
  },
  {
    name: '높은 포니테일',
    back: backHair(38, 0) + `<path d="M44,12 q14,-4 16,10 q3,18 -6,30 q-4,4 -7,-1 q9,-14 5,-28 q-2,-8 -8,-6 z"/>`,
    front: crown(BANGS_SHORT) + sideLocks(34, 4),
  },
  { name: '숏컷', back: backHair(38, 0), front: crown(BANGS_PART) + sideLocks(38, 4) },
  { name: '웨이브 단발', back: backHair(54, 4, true), front: crown(BANGS_FULL) + sideLocks(50) },
  { name: '긴 웨이브', back: backHair(80, 6, true), front: crown(BANGS_FULL) + sideLocks(64) },
  { name: '앞머리 일자 단발', back: backHair(60, 3), front: crown(BANGS_STRAIGHT) + sideLocks(58, 6) },
  {
    name: '사이드 포니테일',
    back: backHair(40, 0) + tail(54, 28, 64, 11),
    front: crown(BANGS_PART) + sideLocks(40),
  },
  {
    name: '땋은 머리',
    back: backHair(42, 1) + braid(9, 40, 6) + braid(55, 40, 6),
    front: crown(BANGS_FULL) + sideLocks(38),
  },
  {
    name: '반묶음',
    back: backHair(74, 4) + bun(32, 7, 8),
    front: crown(BANGS_FULL) + sideLocks(58),
  },
  {
    name: '보브컷',
    back: backHair(46, 2),
    front: crown(BANGS_FULL) + `<path d="M13,28 v14 q0,8 8,7 q-5,-5 -4,-21 z"/><path d="M51,28 v14 q0,8 -8,7 q5,-5 4,-21 z"/>`,
  },
  { name: '헝클어진 짧은 머리', back: backHair(36, 0), front: crown(BANGS_SPIKY) + sideLocks(36, 4) },
]

export const HAIR_NAMES = HAIR_STYLES.map((h) => h.name)

// ── 표정 15종 ───────────────────────────────────────────────────
// 눈·눈썹·입만 갈아 끼운다. 눈을 크게 그리지 않는다 — 작게 줄였을 때
// 눈이 크면 얼굴이 뭉개진다.

const eye = (dx: number, kind: string): string => {
  const x = 32 + dx
  switch (kind) {
    case 'open':
      return `<ellipse cx="${x}" cy="${EYE_Y}" rx="2.1" ry="2.8" fill="${LINE}"/>
              <circle cx="${x - 0.7}" cy="${EYE_Y - 1}" r="0.8" fill="#fff"/>`
    case 'wide':
      return `<ellipse cx="${x}" cy="${EYE_Y}" rx="2.6" ry="3.4" fill="#fff" stroke="${LINE}" stroke-width="1.1"/>
              <circle cx="${x}" cy="${EYE_Y}" r="1.5" fill="${LINE}"/>`
    case 'happy':
      return `<path d="M${x - 3},${EYE_Y + 1} q3,-4 6,0" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'closed':
      return `<path d="M${x - 3},${EYE_Y} q3,2 6,0" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'narrow':
      return `<path d="M${x - 2.6},${EYE_Y} h5.2" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`
    case 'sleepy':
      return `<path d="M${x - 3},${EYE_Y - 1} q3,3 6,0" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'dot':
      return `<circle cx="${x}" cy="${EYE_Y}" r="1.3" fill="${LINE}"/>`
    default:
      return ''
  }
}

const brow = (dx: number, kind: string): string => {
  const x = 32 + dx
  const s = dx < 0 ? 1 : -1
  switch (kind) {
    case 'angry':
      return `<path d="M${x - 3 * s},${BROW_Y - 1} L${x + 3 * s},${BROW_Y + 2}" stroke="${LINE}" stroke-width="1.5" stroke-linecap="round"/>`
    case 'sad':
      return `<path d="M${x - 3 * s},${BROW_Y + 2} L${x + 3 * s},${BROW_Y - 1}" stroke="${LINE}" stroke-width="1.5" stroke-linecap="round"/>`
    case 'up':
      return `<path d="M${x - 3},${BROW_Y - 1} q3,-2 6,0" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-linecap="round"/>`
    default:
      return ''
  }
}

const mouth = (kind: string): string => {
  const y = MOUTH_Y
  switch (kind) {
    case 'small':
      return `<path d="M30,${y} q2,2 4,0" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-linecap="round"/>`
    case 'smile':
      return `<path d="M28,${y - 1} q4,4 8,0" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'grin':
      return `<path d="M27,${y - 1} q5,6 10,0 z" fill="${LINE}"/>`
    case 'open':
      return `<ellipse cx="32" cy="${y + 1}" rx="2.6" ry="3.2" fill="${LINE}"/>`
    case 'flat':
      return `<path d="M28,${y} h8" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'frown':
      return `<path d="M28,${y + 2} q4,-4 8,0" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    case 'wavy':
      return `<path d="M28,${y} q2,-2 4,0 q2,2 4,0" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-linecap="round"/>`
    case 'smirk':
      return `<path d="M30,${y} q4,3 6,-2" fill="none" stroke="${LINE}" stroke-width="1.6" stroke-linecap="round"/>`
    default:
      return ''
  }
}

const blush = `<ellipse cx="19" cy="37" rx="4" ry="2.4" fill="#f08a8a" opacity="0.5"/>
               <ellipse cx="45" cy="37" rx="4" ry="2.4" fill="#f08a8a" opacity="0.5"/>`
const tear = `<path d="M23,36 q1.6,3 0,4.5 q-1.6,-1.5 0,-4.5 z" fill="#8fc7ea"/>`
const sweat = `<path d="M47,20 q2,3.5 0,5 q-2,-1.5 0,-5 z" fill="#8fc7ea"/>`

export interface FaceStyle {
  name: string
  svg: string
}

function face(name: string, eyes: string, m: string, brows = '', extra = ''): FaceStyle {
  const e = eyes.includes('|') ? eyes.split('|') : [eyes, eyes]
  const b = brows ? brow(-EYE_DX, brows) + brow(EYE_DX, brows) : ''
  return { name, svg: b + eye(-EYE_DX, e[0]) + eye(EYE_DX, e[1]) + mouth(m) + extra }
}

export const FACES: FaceStyle[] = [
  face('기본', 'open', 'small'),
  face('밝게 웃음', 'open', 'smile', '', blush),
  face('활짝 웃음', 'happy', 'grin', '', blush),
  face('무표정', 'narrow', 'flat'),
  face('살짝 화남', 'open', 'frown', 'angry'),
  face('화남', 'open', 'flat', 'angry'),
  face('슬픔', 'open', 'frown', 'sad'),
  face('울먹임', 'wide', 'wavy', 'sad', tear),
  face('놀람', 'wide', 'open', 'up'),
  face('당황', 'open', 'wavy', 'up', sweat),
  face('윙크', 'happy|open', 'smile', '', blush),
  face('장난스러움', 'happy', 'smirk', '', blush),
  face('졸림', 'sleepy', 'small'),
  face('자신만만', 'narrow', 'smirk'),
  face('멍함', 'dot', 'open'),
]

export const FACE_NAMES = FACES.map((f) => f.name)

// ── 교복 15종 ───────────────────────────────────────────────────
// 옷 색은 디자인마다 정해져 있다. 셔츠 위에 조끼·가디건·재킷을 얹고,
// 아래는 바지나 치마를 고른다.

const SHIRT = `<path d="M32,50 q-14,1 -16,10 v14 q0,4 4,4 h24 q4,0 4,-4 v-14 q-2,-9 -16,-10 z"/>`
const SLEEVE_LONG = `
  <path d="M16,54 q-4,2 -4,8 v12 q0,3 4,3 h4 q4,0 4,-3 v-12 q0,-6 -4,-8 z"/>
  <path d="M48,54 q4,2 4,8 v12 q0,3 -4,3 h-4 q-4,0 -4,-3 v-12 q0,-6 4,-8 z"/>`
const SLEEVE_SHORT = `
  <path d="M16,54 q-4,2 -4,8 v4 q0,3 4,3 h4 q4,0 4,-3 v-4 q0,-6 -4,-8 z"/>
  <path d="M48,54 q4,2 4,8 v4 q0,3 -4,3 h-4 q-4,0 -4,-3 v-4 q0,-6 4,-8 z"/>`
const VEST = `<path d="M32,52 q-11,1 -12,8 v10 q0,3 3,3 h18 q3,0 3,-3 v-10 q-1,-7 -12,-8 z"/>`
const OPEN_JACKET = `
  <path d="M32,50 q-14,1 -16,10 v14 q0,4 4,4 h6 v-26 z"/>
  <path d="M32,50 q14,1 16,10 v14 q0,4 -4,4 h-6 v-26 z"/>`
const COLLAR = `<path d="M27,50 L32,57 L37,50 L34,49 L32,52 L30,49 z" fill="#fff" stroke="${LINE}" stroke-width="0.9"/>`
const TIE = (t: Tone) =>
  `<path d="M32,56 l3,3 l-2,10 h-2 l-2,-10 z" fill="${t.base}" stroke="${t.line}" stroke-width="0.9"/>`
const RIBBON = (t: Tone) =>
  `<path d="M32,58 l-6,-3 v6 z M32,58 l6,-3 v6 z" fill="${t.base}" stroke="${t.line}" stroke-width="0.9"/>
   <circle cx="32" cy="58" r="1.8" fill="${t.base}" stroke="${t.line}" stroke-width="0.9"/>`
// 가랑이를 V로 파야 두 다리가 보인다. 밑단은 신발 위에서 끝난다.
const PANTS = `<path d="M19,71 H45 L43,86 H35 L32,76 L29,86 H21 L19,76 Z"/>`
const SHORTS = `<path d="M19,71 H45 L44,80 H35 L32,74 L29,80 H20 L19,76 Z"/>`
const SKIRT = `<path d="M20,71 h24 l6,12 q-7,3 -18,3 q-11,0 -18,-3 z"/>`

export interface UniformStyle {
  name: string
  /** 셔츠 위에 얹는 것 */
  build: (c: typeof CLOTH) => string
}

const wear = (t: Tone, d: string) => `<g ${fill(t)}>${d}</g>`

export const UNIFORMS: UniformStyle[] = [
  {
    name: '단정한 셔츠',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_LONG) + wear(c.charcoal, PANTS) + COLLAR + TIE(c.navy),
  },
  {
    name: '니트 조끼',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_LONG) + wear(c.charcoal, PANTS) + COLLAR + wear(c.navy, VEST) + TIE(c.wine),
  },
  {
    name: '가디건',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_LONG) + wear(c.charcoal, PANTS) + COLLAR + TIE(c.brown) + wear(c.beige, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '재킷',
    build: (c) => wear(c.shirt, SHIRT) + wear(c.navy, PANTS) + COLLAR + TIE(c.red) + wear(c.navy, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '풀어헤친 셔츠',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_LONG) + wear(c.charcoal, PANTS) + COLLAR,
  },
  {
    name: '느슨한 넥타이',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.charcoal, PANTS) + COLLAR + TIE(c.green),
  },
  {
    name: '어깨에 걸친 재킷',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.denim, PANTS) + COLLAR + TIE(c.navy) + wear(c.charcoal, OPEN_JACKET),
  },
  {
    name: '블레이저 + 리본',
    build: (c) => wear(c.shirt, SHIRT) + wear(c.navy, SKIRT) + COLLAR + RIBBON(c.red) + wear(c.navy, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '조끼 + 스커트',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.charcoal, SKIRT) + COLLAR + wear(c.wine, VEST) + RIBBON(c.wine),
  },
  {
    name: '가디건 + 스커트',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_LONG) + wear(c.grey, SKIRT) + COLLAR + RIBBON(c.sky) + wear(c.cream, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '블레이저 + 넥타이',
    build: (c) => wear(c.shirt, SHIRT) + wear(c.plaid, SKIRT) + COLLAR + TIE(c.yellow) + wear(c.charcoal, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '셔츠 + 리본',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.navy, SKIRT) + COLLAR + RIBBON(c.red),
  },
  {
    name: '캐주얼 교복',
    build: (c) => wear(c.cream, SHIRT + SLEEVE_SHORT) + wear(c.plaid, SKIRT) + RIBBON(c.sky),
  },
  {
    name: '긴 가디건',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.charcoal, SKIRT) + COLLAR + RIBBON(c.wine) + wear(c.grey, OPEN_JACKET + SLEEVE_LONG),
  },
  {
    name: '체육복',
    build: (c) => wear(c.shirt, SHIRT + SLEEVE_SHORT) + wear(c.navy, SHORTS),
  },
]

export const UNIFORM_NAMES = UNIFORMS.map((u) => u.name)

// ── 조립 ────────────────────────────────────────────────────────

export interface CharLook {
  hair: number
  color: number
  face: number
  uniform: number
}

/** 팀 완장 — 교복을 자유롭게 골라도 팀은 여기서 갈린다. */
function band(team: TeamId | null): string {
  if (!team) return ''
  const t = BAND_TONES[team]
  return `<path d="M12,62 q4,2 8,0 v7 q-4,2 -8,0 z" fill="${t.base}" stroke="${t.line}" stroke-width="1"/>`
}

/** 'full'은 전신, 'face'는 얼굴만 잘라 낸다(명단·대화용). */
export type CharView = 'full' | 'face'

const VIEWBOX: Record<CharView, string> = {
  full: `0 0 ${VIEW_W} ${VIEW_H}`,
  face: '9 7 46 46',
}

export function charSvg(look: CharLook, team: TeamId | null, view: CharView = 'full'): string {
  const hair = HAIR_STYLES[look.hair % HAIR_STYLES.length]
  const hairTone = HAIR_COLORS[look.color % HAIR_COLORS.length].tone
  const uniform = UNIFORMS[look.uniform % UNIFORMS.length]
  const expr = FACES[look.face % FACES.length]
  return esc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX[view]}">
  <defs>
    <clipPath id="lower"><rect x="0" y="34" width="64" height="30"/></clipPath>
  </defs>
  <g ${fill(hairTone)}>${hair.back}</g>
  ${body()}
  ${shoes()}
  ${uniform.build(CLOTH)}
  ${band(team)}
  ${head()}
  ${expr.svg}
  <g ${fill(hairTone)}>${hair.front}</g>
</svg>`)
}

/** <img src>에 바로 넣을 수 있는 형태. */
export function charDataUri(look: CharLook, team: TeamId | null, view: CharView = 'full'): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(charSvg(look, team, view))}`
}

/** 아무것도 고르지 않은 사람도 서로 달라 보이게. */
export function defaultChar(seed: string): CharLook {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return {
    hair: h % HAIR_STYLES.length,
    color: Math.floor(h / 15) % HAIR_COLORS.length,
    face: Math.floor(h / 225) % FACES.length,
    uniform: Math.floor(h / 3375) % UNIFORMS.length,
  }
}
