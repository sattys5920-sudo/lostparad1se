// 색. 학교·지도·UI는 흑백 그대로 두고, 사람만 색을 가진다 —
// 흑백 배경 위에서 캐릭터가 먼저 눈에 들어오게 하려는 것이다.
//
// 픽셀 아트라 색을 마음대로 늘리지 않는다. 재질 하나에 네 칸(바탕·그늘·빛·
// 테두리)뿐이고, 그 네 칸은 바탕색 하나에서 규칙으로 뽑는다. 그래야 머리색을
// 열다섯 개로 늘려도 명암 방향과 대비가 전부 같게 유지된다.
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

function mix(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const to = amount < 0 ? 0 : 255
  const t = Math.abs(amount)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => clamp(v + (to - v) * t))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 바탕색 하나에서 네 칸을 뽑는다. */
export function tone(base: string): Tone {
  return { base, shade: mix(base, -0.24), light: mix(base, 0.3), line: mix(base, -0.58) }
}

export interface Named {
  name: string
  tone: Tone
}

/** 머리색 15종. 머리 모양과 따로 고른다. */
export const HAIR_COLORS: Named[] = [
  // 새까맣게 칠하면 도트에서 덩어리로 뭉친다. 어두운 청회색이 결이 산다.
  { name: '검정', tone: tone('#4b4763') },
  { name: '짙은 갈색', tone: tone('#4d3627') },
  { name: '갈색', tone: tone('#7a5133') },
  { name: '밝은 갈색', tone: tone('#a97442') },
  { name: '금발', tone: tone('#e0b558') },
  { name: '백금', tone: tone('#e8dcc0') },
  { name: '은색', tone: tone('#c3c9d1') },
  { name: '흰색', tone: tone('#f2f3f5') },
  { name: '회색', tone: tone('#8b8f96') },
  { name: '적갈색', tone: tone('#8c3b2e') },
  { name: '주황', tone: tone('#d4713a') },
  { name: '분홍', tone: tone('#dd8fae') },
  { name: '빨강', tone: tone('#b8352f') },
  { name: '파랑', tone: tone('#4a6fb0') },
  { name: '보라', tone: tone('#7a5aa8') },
]

/** 교복에 쓰는 천 색. 옷 색은 사용자가 고르지 않고 디자인마다 정해져 있다. */
export const CLOTH = {
  shirt: tone('#e9e0cf'),
  cream: tone('#efe6d2'),
  navy: tone('#3a4664'),
  charcoal: tone('#2f3350'),
  black: tone('#33343c'),
  grey: tone('#7d838c'),
  wine: tone('#7a3340'),
  green: tone('#3f6350'),
  beige: tone('#cdb896'),
  brown: tone('#6d523c'),
  sky: tone('#8fb0d4'),
  red: tone('#b4322e'),
  yellow: tone('#d8b24a'),
  plaid: tone('#8a6070'),
  denim: tone('#5b6f92'),
} as const

export const SHOE_TONE = tone('#3a3d45')

/**
 * 팀 완장. 네 칸짜리 작은 조각이라 보통 규칙대로 테두리를 진하게 두르면
 * 색이 다 먹혀 검은 얼룩이 된다. 완장만은 테두리를 살짝만 어둡게 해서
 * 멀리서도 팀 색이 그대로 읽히게 한다.
 */
function bandTone(base: string): Tone {
  return { base, shade: mix(base, -0.12), light: mix(base, 0.2), line: mix(base, -0.3) }
}

export const BAND_TONES: Record<string, Tone> = {
  A: bandTone('#e05555'),
  B: bandTone('#4f86e0'),
  C: bandTone('#43b177'),
  D: bandTone('#e0a63f'),
}
