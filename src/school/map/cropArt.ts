// 작물 스무 가지의 열매 그림. **한 벌을 세 군데서 쓴다** — 정원 화분
// 위, 아이템창, 자판기 매입구.
//
// 8×8 이다. 화분(12칸) 위에 얹혀야 하고, 글자 옆에 붙어도 줄을 안
// 벌려야 한다.
//
// 글자 하나에 색 하나:
//   3 윤곽(맵과 같은 먹색)
//   a 그 작물의 색 — **규칙 쪽 CropSpec.color 를 그대로 쓴다.** 운영자가
//     색을 고치면 그림도 따라 바뀐다
//   d a 를 어둡게 · c a 를 밝게 — a 에서 셈해 낸다
//   g · h 잎(밝은 · 어두운 초록) · w 흰 면 · x 씨(갈색)
//
// 모양만으로도 갈려야 한다. 같은 붉은 것이라도 딸기는 씨가 박히고
// 고추는 비스듬히 길고 토마토는 둥글다 — 색을 못 가리는 사람도 있다.
import { CROPS } from '../../../shared/rules/crop'
import { MAP } from '../skin'

export const CROP_PX = 8

const CROP_ART: Readonly<Record<string, readonly string[]>> = {
  /** 감자 — 울퉁불퉁한 덩이에 눈 두어 개 */
  potato: [
    '        ',
    '  3333  ',
    ' 3acaa3 ',
    '3aaadaa3',
    '3adaaaa3',
    '3aaaada3',
    ' 33aaa3 ',
    '   333  ',
  ],
  /** 무 — 둥글고 굵은 흰 뿌리, 위에 잎 */
  radish: [
    '  3gg3  ',
    ' 3ghhg3 ',
    ' 33gg33 ',
    '3caaaaa3',
    '3caaaad3',
    '3aaaaad3',
    ' 3aaad3 ',
    '  3333  ',
  ],
  /** 상추 — 잎이 겹겹이 말린 포기 */
  lettuce: [
    '  3333  ',
    ' 3cacc3 ',
    '3caacac3',
    '3aadaaa3',
    '3adaada3',
    '3aaddaa3',
    ' 3daad3 ',
    '  3333  ',
  ],
  /** 방울토마토 — 동그랗고 꼭지가 초록 별 */
  tomato: [
    '   3h3  ',
    ' 33ggg3 ',
    '3caagaa3',
    '3caaaaa3',
    '3aaaaaa3',
    '3aaaaad3',
    ' 3aadd3 ',
    '  3333  ',
  ],
  /** 고추 — 비스듬히 길고 끝이 가늘다 */
  pepper: [
    '     33 ',
    '    3hg3',
    '   3gg3 ',
    '  3ca3  ',
    ' 3caa3  ',
    ' 3aad3  ',
    '3ad33   ',
    '33      ',
  ],
  /** 딸기 — 아래로 뾰족하고 씨가 박혔다 */
  strawberry: [
    ' 33gg33 ',
    '3gghhgg3',
    '3acaaca3',
    '3aaacaa3',
    ' 3caaa3 ',
    ' 3aaca3 ',
    '  3ad3  ',
    '   33   ',
  ],
  /** 당근 — 위가 굵고 아래로 가늘어진다. 무보다 길고 좁다 */
  carrot: [
    ' 3g33g3 ',
    '  3hh3  ',
    ' 3caad3 ',
    ' 3aada3 ',
    '  3aa3  ',
    '  3ad3  ',
    '  3ad3  ',
    '   33   ',
  ],
  /** 옥수수 — 알이 줄지어 박힌 자루를 잎이 감쌌다 */
  corn: [
    '   33   ',
    '  3ca3  ',
    ' 3acac3 ',
    '3gcacag3',
    '3gacacg3',
    '3hgcagh3',
    ' 3hggh3 ',
    '  3333  ',
  ],
  /** 호박 — 납작하고 골이 졌다 */
  pumpkin: [
    '        ',
    '   3h3  ',
    ' 33hh33 ',
    '3cadaad3',
    '3aadada3',
    '3aadada3',
    '3dadadd3',
    ' 333333 ',
  ],
  /** 해바라기 — 노란 꽃잎 가운데 갈색 씨 */
  sunflower: [
    '  3aa3  ',
    ' 3a33a3 ',
    '3a3xx3a3',
    '3a3xx3a3',
    ' 3a33a3 ',
    '  3aa3  ',
    '   3g3  ',
    '  3hg3  ',
  ],
  /** 수박 — 통째로. 짙은 줄무늬가 세로로 간다 */
  watermelon: [
    '  3333  ',
    ' 3cdad3 ',
    '3cdadad3',
    '3adadad3',
    '3adadad3',
    '3ddadad3',
    ' 3dadd3 ',
    '  3333  ',
  ],
  /** 고구마 — 비스듬히 누운 길쭉한 덩이 */
  sweetPotato: [
    '        ',
    '     333',
    '   33ac3',
    '  3aada3',
    ' 3adaa3 ',
    '3aaad3  ',
    '3dd33   ',
    ' 33     ',
  ],
  /** 검은 튤립 — 세 갈래 컵 모양 꽃, 잎이 양쪽으로 */
  blackTulip: [
    ' 3 33 3 ',
    '3a3ca3a3',
    '3aacaaa3',
    '3adaada3',
    ' 3adda3 ',
    '  3gg3  ',
    '3h3gg3h3',
    ' 3hgg3  ',
  ],
  /** 서리버섯 — 옅은 푸른 갓에 흰 점, 흰 대 */
  frostMushroom: [
    '  3333  ',
    ' 3awca3 ',
    '3acaawa3',
    '3dddddd3',
    ' 33ww33 ',
    '  3ww3  ',
    '  3wc3  ',
    '  3333  ',
  ],
  /** 얼음꽃 — 네 방향으로 뻗은 결정 */
  iceFlower: [
    '   33   ',
    '  3wa3  ',
    '333ca333',
    '3wacwad3',
    '3dacwad3',
    '333ad333',
    '  3ad3  ',
    '   33   ',
  ],
  /** 밤에 피는 나팔꽃 — 벌어진 나팔, 안쪽이 밝다 */
  nightGlory: [
    ' 333333 ',
    '3aaccaa3',
    '3dacwad3',
    ' 3daad3 ',
    '  3ad3  ',
    '   3g3  ',
    '  3hg3  ',
    '  33    ',
  ],
  /** 종이꽃 — 접은 자국이 선 꽃. 한쪽은 빛을 받고 한쪽은 그늘이다 */
  paperFlower: [
    '   33   ',
    '  3wd3  ',
    ' 3wwdd3 ',
    '3awwddd3',
    ' 3aadd3 ',
    '  3ad3  ',
    '   3g3  ',
    '   3h3  ',
  ],
  /** 이름 없는 풀 — 가늘고 제멋대로 뻗은 포기 */
  namelessGrass: [
    '    3   ',
    ' 3 3a3 3',
    '3a33a33a',
    '3a3ad3a3',
    ' 3a3a3d3',
    ' 3ada3a3',
    '  3aadd3',
    '  33333 ',
  ],
  /** 유리 열매 — 투명한 알 세 개, 빛이 한 점씩 */
  glassBerry: [
    '   3h3  ',
    ' 33 h33 ',
    '3wa33wa3',
    '3ad33ad3',
    ' 33wa33 ',
    '  3ad3  ',
    '   33   ',
    '        ',
  ],
  /** 그 애가 심은 것 — 별 모양으로 핀 옅은 금빛 꽃. 이것만 이렇게 생겼다 */
  hers: [
    '   33   ',
    '  3wc3  ',
    '333cc333',
    '3acwwca3',
    ' 3acca3 ',
    ' 3a33a3 ',
    '3a3  3a3',
    '33    33',
  ],
}

// ── 색 ──────────────────────────────────────────────────────────

const LEAF = '#6f9a55'
const LEAF_DARK = '#44663c'
const WHITE = '#eef1f3'
const SEED = '#6b4a2a'

function mix(hex: string, to: number, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 글자 → 색. a·c·d 는 작물마다 다르다 */
export function cropPalette(color: string): Record<string, string> {
  return {
    '3': MAP.outline,
    a: color,
    c: mix(color, 255, 0.45),
    d: mix(color, 0, 0.35),
    g: LEAF,
    h: LEAF_DARK,
    w: WHITE,
    x: SEED,
  }
}

export function cropArt(id: string): readonly string[] | null {
  return CROP_ART[id] ?? null
}

// ── 정원 화분 위의 열매 ──────────────────────────────────────────
//
// 16×16 한 칸. **화분은 다른 단계와 같은 자리에 있다** — 12칸 그림을
// 칸 가운데(2,2)에 두던 그대로라 테두리가 들썩이지 않는다. 그 위에
// 열매 그림을 얹고, 양옆으로 잎을 조금 낸다.

const POT_UNDER = [
  '                ',
  '                ',
  '                ',
  '                ',
  '  3          3  ',
  ' 3g3        3g3 ',
  '  3h33333333h3  ',
  '    32222223    ',
  '    31111113    ',
  '    31111113    ',
  '     311113     ',
  '     333333     ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 열매가 얹힐 자리. 화분 테두리에 아랫단 두 줄이 걸친다 */
export const FRUIT_AT = { x: 4, y: 0 }

/** 16×16 격자 — 화분 아래판 위에 그 작물 열매를 겹친 것 */
export function fruitPotRows(id: string): string[] | null {
  const art = CROP_ART[id]
  if (!art) return null
  const rows = POT_UNDER.map((r) => r.split(''))
  for (const [y, row] of art.entries()) {
    for (const [x, ch] of [...row].entries()) {
      if (ch !== ' ') rows[FRUIT_AT.y + y][FRUIT_AT.x + x] = ch
    }
  }
  return rows.map((r) => r.join(''))
}

/** 화분 아래판의 1·2 는 맵 팔레트다 */
export const POT_TONES: Record<string, string> = { '1': MAP.light, '2': MAP.mid }

// 그림이 빠지거나 틀어진 채로 나가지 않게 여기서 막는다
for (const c of CROPS) {
  const rows = CROP_ART[c.id]
  if (!rows) throw new Error(`${c.name}(${c.id})에 그림이 없다`)
  if (rows.length !== CROP_PX) throw new Error(`${c.id}: ${rows.length}줄이다. ${CROP_PX}줄이어야 한다`)
  for (const [i, r] of rows.entries()) {
    if (r.length !== CROP_PX) throw new Error(`${c.id} ${i}번째 줄이 ${r.length}칸이다`)
    for (const ch of r) if (!' 3acdghwx'.includes(ch)) throw new Error(`${c.id}: 모르는 색 ${ch}`)
  }
}
