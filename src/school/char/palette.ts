// 색. 학교·지도·UI는 흑백 그대로 두고, 사람만 색을 가진다 —
// 흑백 배경 위에서 캐릭터가 먼저 눈에 들어오게 하려는 것이다.
//
// 픽셀 아트라 색을 마음대로 늘리지 않는다. 재질 하나에 네 칸(바탕·그늘·빛·
// 테두리)뿐이고, 그 네 칸은 바탕색 하나에서 규칙으로 뽑는다. 그래야 색을
// 아무리 늘려도 명암 방향과 대비가 전부 같게 유지된다.
//
//   그늘   = 20% 어둡게, 살짝 파랑·보라 쪽으로 (그림자는 차갑다)
//   하이라이트 = 20% 밝게
//   테두리 = 가장 어두운 톤

/** 재질 한 벌 — 바탕·그늘·빛·테두리. 색 하나에서 규칙으로 뽑는다. */
export interface Tone {
  base: string
  shade: string
  light: string
  line: string
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

function mix(rgb: [number, number, number], amount: number): [number, number, number] {
  const to = amount < 0 ? 0 : 255
  const t = Math.abs(amount)
  return rgb.map((v) => v + (to - v) * t) as [number, number, number]
}

/** 그림자는 차갑다 — 어두워지면서 파랑·보라 쪽으로 조금 민다. */
function cool([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [r - 8 * amount, g - 4 * amount, b + 6 * amount]
}

/** 바탕색 하나에서 네 칸을 뽑는다. */
export function tone(base: string): Tone {
  const rgb = parse(base)
  return {
    base,
    shade: hex(cool(mix(rgb, -0.2), 1)),
    light: hex(mix(rgb, 0.2)),
    line: hex(cool(mix(rgb, -0.5), 1.4)),
  }
}

export interface Named {
  name: string
  tone: Tone
}

/**
 * 머리색 9종. 머리 모양과 따로 고른다.
 * 새까만색은 넣지 않는다 — 도트에서 덩어리로 뭉쳐 결이 죽는다.
 */
export const HAIR_COLORS: Named[] = [
  { name: '흑청', tone: tone('#4b4763') },
  { name: '짙은 갈색', tone: tone('#6b4a3a') },
  { name: '밝은 갈색', tone: tone('#9c6e4e') },
  { name: '금발', tone: tone('#d8b96a') },
  { name: '분홍', tone: tone('#d98fae') },
  { name: '하늘', tone: tone('#7fa9cf') },
  { name: '민트', tone: tone('#7fbfa8') },
  { name: '은회색', tone: tone('#b9b6c4') },
  { name: '적갈', tone: tone('#9e4b45') },
]

/**
 * 교복 색. 전원 같은 학교를 다니므로 옷 색은 고르는 값이 아니다 — 여기 적힌
 * 한 벌이 전부다. 복장·스타일이 늘어도 색은 이 표를 넘지 않는다.
 *
 * 그림자는 규칙으로 뽑지 않고 직접 적는다. 천마다 빛을 먹는 정도가 달라
 * 일률적으로 20% 어둡게 하면 남색은 뭉치고 베이지는 뜬다.
 */
const SCHOOL = {
  shirt: ['#e9e0cf', '#c8bba5'],
  blazer: ['#2f3350', '#23263d'],
  vest: ['#8c8272', '#6e6557'],
  cardigan: ['#b9a98e', '#978871'],
  hood: ['#7e8491', '#61667a'],
  gym: ['#3e5a7a', '#2e4560'],
  gymLine: ['#e9e0cf', '#c8bba5'],
  skirt: ['#3a3f5c', '#2a2e44'],
  neck: ['#b4322e', '#8a2522'],
} as const

/** 바탕·그림자는 표에서 그대로 쓰고, 빛과 테두리만 규칙으로 뽑는다. */
function fixed([base, shade]: readonly [string, string]): Tone {
  const rgb = parse(base)
  return { base, shade, light: hex(mix(rgb, 0.2)), line: hex(cool(mix(rgb, -0.5), 1.4)) }
}

export const SCHOOL_PALETTE = {
  shirt: fixed(SCHOOL.shirt),
  /** 블레이저와 바지는 같은 감이다 */
  blazer: fixed(SCHOOL.blazer),
  trousers: fixed(SCHOOL.blazer),
  vest: fixed(SCHOOL.vest),
  cardigan: fixed(SCHOOL.cardigan),
  hood: fixed(SCHOOL.hood),
  gym: fixed(SCHOOL.gym),
  gymLine: fixed(SCHOOL.gymLine),
  skirt: fixed(SCHOOL.skirt),
  neck: fixed(SCHOOL.neck),
} as const

export const SHOE_TONE = tone('#3a3d45')
/** 입술·입 — 짙은 적갈. 표정 맵의 M 칸이 이 색이다. */
export const MOUTH_TONE = tone('#8e4038')
/** 볼터치 — 표정 맵의 P 칸. */
export const BLUSH_TONE = tone('#d98a86')

/**
 * 팀. 팀 수와 색은 여기서만 고친다.
 * 완장은 머리·옷보다 채도를 높인다 — 3×2칸짜리라 작아도 구분돼야 한다.
 */
export interface TeamDef {
  id: 'A' | 'B' | 'C' | 'D'
  name: string
  color: string
}

export const TEAMS: TeamDef[] = [
  { id: 'A', name: '붉은 완장', color: '#e0453f' },
  { id: 'B', name: '푸른 완장', color: '#3f7ae0' },
  { id: 'C', name: '초록 완장', color: '#2fa866' },
  { id: 'D', name: '노랑 완장', color: '#e0a02a' },
]

/**
 * 완장 색. 세 칸짜리 조각이라 보통 규칙대로 테두리를 진하게 두르면 색이 다
 * 먹혀 검은 얼룩이 된다. 완장만은 테두리를 살짝만 어둡게 한다.
 */
function bandTone(base: string): Tone {
  const rgb = parse(base)
  return { base, shade: hex(mix(rgb, -0.16)), light: hex(mix(rgb, 0.2)), line: hex(mix(rgb, -0.38)) }
}

export const BAND_TONES: Record<string, Tone> = Object.fromEntries(
  TEAMS.map((t) => [t.id, bandTone(t.color)]),
)
