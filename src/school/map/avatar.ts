// 아바타 — 머리 30종 × 머리색 5종 × 표정 10종 × 팀 유니폼.
//
// 캐릭터는 12×18이다. 16픽셀 타일보다 조금 커서 사람이 사물보다 눈에 먼저 든다.
// 몸통 틀에 F(얼굴)와 U(옷) 자리를 비워 두고, 머리·표정·유니폼을 얹어 굽는다.
// 조합이 많아 미리 굽지 않고 쓸 때 굽고 쌓아 둔다.
//
// 12칸 폭에는 머리 30종을 다 구분해 그릴 자리가 없다. 여기서는 열 가지 틀만
// 두고, 초상화(portrait.ts)의 30종을 그중 가장 닮은 틀로 보낸다.
import { PAL, type Dir } from './sprites'
import { defaultChar } from '../char/svg'
import type { AvatarLook, TeamId } from '../types'

export const ACTOR_W = 12
export const ACTOR_H = 18

export type { AvatarLook }

export const FACE_NAMES = [
  '무표정', '웃음', '활짝', '놀람', '찡그림',
  '화남', '슬픔', '눈 감음', '딴 데', '능글',
]

// ── 몸통 틀 ─────────────────────────────────────────────────────
// ' ' 비움 · '3' 윤곽 · '1' 살 · 'F' 얼굴(표정이 덮는다) · 'U' 옷(팀이 덮는다)

// 몸은 통짜 사각형이 아니라 사람 모양이어야 한다.
// 어깨(8칸) → 몸통(4칸) → 허리(4칸)로 좁아지고, 팔은 몸통과 다른 톤으로 갈라 놓는다.
// 'A'는 팔 — 옷이 밝으면 어둡게, 어두우면 밝게 칠해 늘 몸통과 갈린다.

// 얼굴을 동그라미로 그린다. 예전에는 눈썹 줄(3번)만 테두리가 두 겹이라
// 거기서 폭이 확 줄었다가 다시 늘어 — 이마가 움푹 들어간 것처럼 보였다.
// 이제 위아래로 4→6→8→8→8→8→6→6→4 로 폭이 매끄럽게 늘고 줄어든다.
// 눈썹은 구조(테두리)가 아니라 표정(FACES)이 살 위에 얇게 한 줄만 얹는다.
const BODY_DOWN = [
  '            ',
  '    3333    ',
  '   311113   ',
  '  31111113  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '   311113   ',
  '   311113   ',
  '    3113    ',
  '  33UUUU33  ',
  '  3AUUUUA3  ',
  '  3AUUUUA3  ',
  '  3AUUUUA3  ',
  '  31UUUU13  ',
  '  3UUUUUU3  ',
]

const BODY_UP = [
  '            ',
  '    3333    ',
  '   333333   ',
  '  33333333  ',
  '  33333333  ',
  '  33333333  ',
  '  32333323  ',
  '   322223   ',
  '   311113   ',
  '    3113    ',
  '  33UUUU33  ',
  '  3AUUUUA3  ',
  '  3AUUUUA3  ',
  '  3AUUUUA3  ',
  '  31UUUU13  ',
  '  3UUUUUU3  ',
]

// 옆모습을 앞모습과 다른 골격으로 그렸더니 이마가 돔처럼 부풀고 턱이
// 뾰족해져 외계인처럼 보였다. 포켓몬 GBA·언더테일류 도트 캐릭터의 옆모습은
// 그렇게 깎지 않는다 — 머리통은 앞모습과 똑같은 둥근 윤곽을 그대로 쓰고,
// 머리카락을 뒤쪽 절반에만 덮어 방향만 알려준다. 코도 따로 튀어나오지
// 않는다(윤곽선 자체가 경계라 그걸로 충분하다). 몸통도 마찬가지로 앞모습과
// 같은 실루엣을 쓰고, 팔만 앞쪽(보는 방향) 한쪽만 그린다 — 반대쪽 팔은
// 몸 뒤에 가려 안 보인다고 치는 것이 포켓몬 트레이너 스프라이트 방식이다.
const BODY_SIDE = [
  '            ',
  '    3333    ',
  '   311113   ',
  '  31111113  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '   311113   ',
  '   311113   ',
  '    3113    ',
  '  33UUUU33  ',
  '  3UUUUUA3  ',
  '  3UUUUUA3  ',
  '  3UUUUUA3  ',
  '   1UUUU13  ',
  '   UUUUUU3  ',
]

/** 다리는 앞뒤가 다르다. 옆모습은 앞뒤로 엇갈리게 딛는다. */
const LEGS_FRONT: Record<number, string[]> = {
  0: ['   33  33   ', '   33  33   '],
  1: ['   33  3    ', '  333  33   '],
  2: ['    3  33   ', '   33  333  '],
}

const LEGS_SIDE: Record<number, string[]> = {
  0: ['     33     ', '    3333    '],
  1: ['    33 3    ', '   33  333  '],
  2: ['     3 33   ', '   333  33  '],
}

// ── 머리 (앞모습) ───────────────────────────────────────────────
// 12칸 × 12줄. 옆모습과 뒷모습은 여기서 만들어 낸다.

const HAIR_DOWN: string[][] = [
  // 0 짧은 머리
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '            ', '            ', '            ',
    '            ', '            ', '            ', '            ',
  ],
  // 1 단발
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '  33    33  ', '  33    33  ', '  333  333  ',
    '            ', '            ', '            ', '            ',
  ],
  // 2 긴 머리 — 몸 폭 안에서 어깨 위로 떨어진다. 밖으로 뻗으면 날개처럼 보인다.
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '  33    33  ', '  33    33  ', '  33    33  ',
    '  33    33  ', '  33    33  ', '  23    32  ', '  23    32  ',
  ],
  // 3 하나로 묶음
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '  33    333 ', '          33', '          33',
    '          32', '           3', '            ', '            ',
  ],
  // 4 양갈래
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    ' 333    333 ', ' 33      33 ', ' 33      33 ', ' 32      23 ',
    '            ', '            ', '            ', '            ',
  ],
  // 5 스포츠머리
  [
    '            ', '    3333    ', '   322223   ', '  32222223  ',
    '  33    33  ', '            ', '            ', '            ',
    '            ', '            ', '            ', '            ',
  ],
  // 6 곱슬
  [
    '            ', '   3 33 3   ', '  33333333  ', ' 3333333333 ',
    ' 33      33 ', '  3      3  ', '  33    33  ', '   3    3   ',
    '            ', '            ', '            ', '            ',
  ],
  // 7 앞머리
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33333333  ', '  33    33  ', '  33    33  ', '  33    33  ',
    '            ', '            ', '            ', '            ',
  ],
  // 8 가르마
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  3333  33  ', '  33    33  ', '  33     3  ', '            ',
    '            ', '            ', '            ', '            ',
  ],
  // 9 쪽머리
  [
    '     33     ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '  33    33  ', '   3    3   ', '            ',
    '            ', '            ', '            ', '            ',
  ],
]

/** 초상화 머리 30종 → 위 열 가지 틀. 순서는 portrait.ts의 HAIR_NAMES와 같다. */
const ACTOR_HAIR_OF = [
  // 남자: 짧은·스포츠·가르마·삐침·앞머리·넘긴·더벅·곱슬·아프로·투블럭·올백·장발·포니·헝클·커튼
  0, 5, 8, 0, 7, 8, 6, 6, 6, 5, 0, 2, 3, 6, 8,
  // 여자: 단발·긴생머리·웨이브·양갈래·묶음·쪽·앞머리단발·히메·땋은·똥머리둘·숏컷·옆머리·반묶음·긴곱슬·옆묶음
  1, 2, 2, 4, 3, 9, 7, 2, 3, 9, 0, 8, 2, 6, 3,
]

// ── 머리색 ──────────────────────────────────────────────────────
// 초상화와 같은 규칙이다. 바깥 테두리(몸 실루엣 밖과 닿는 칸)는 늘 먹,
// 얼굴과 닿는 안쪽 테두리는 색의 테두리 톤, 속은 색의 속 톤.
// 12칸 머리는 거의가 테두리라 속 톤은 한두 줄만 보인다 — 그래도 흑발과는 갈린다.

interface ActorTone {
  fill: string
  rim: string
  /** 브릿지 — 안쪽에 밝은 칸을 섞는다 */
  streak?: boolean
}

const ACTOR_TONES: ActorTone[] = [
  { fill: '3', rim: '3' }, // 흑발
  { fill: '2', rim: '3' }, // 적발
  { fill: '1', rim: '2' }, // 금발
  { fill: '0', rim: '2' }, // 백발
  { fill: '3', rim: '3', streak: true }, // 브릿지
]

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function hairTone(layer: string[], base: string[], x: number, y: number, c: string, color: number): string {
  if (color % ACTOR_TONES.length === 0) return c
  const tone = ACTOR_TONES[color % ACTOR_TONES.length]
  let outer = false
  let inner = false
  for (const [dx, dy] of N4) {
    const nx = x + dx
    const ny = y + dy
    const h = layer[ny]?.[nx] ?? ' '
    if (h !== ' ') continue
    const b = base[ny]?.[nx] ?? ' '
    if (b === ' ') outer = true
    else inner = true
  }
  if (outer) return '3'
  if (tone.streak) return (x + y) % 3 === 0 ? '1' : '3'
  if (inner) return tone.rim
  return c === '2' ? tone.rim : tone.fill
}

/**
 * 옆모습 머리. 정수리와 헤어라인(0~3줄)은 앞뒤 구분이 없으니 그대로 쓰고,
 * 그 아래(옆머리·뒷머리)는 뒤쪽 절반(0~5칸)만 남긴다. 얼굴 쪽(6~11칸)은
 * 항상 비워 둬야 눈·코·입이 들어갈 자리가 생긴다 — 여기서 "방향"이 나온다.
 */
function hairSide(down: string[]): string[] {
  return down.map((row, y) => {
    if (y <= 3) return row
    let out = ''
    for (let x = 0; x < ACTOR_W; x++) out += x <= 5 ? row[x] : ' '
    return out
  })
}

/** 뒷모습 머리 — 앞모습에 뒤통수를 채운다. */
function hairUp(down: string[]): string[] {
  return down.map((row, y) => {
    // 6~7줄(목덜미)은 몸통 틀의 음영을 살려 둔다. 다 채우면 머리가 검은 덩어리가 된다.
    if (y < 2 || y > 5) return row
    let out = ''
    for (let x = 0; x < ACTOR_W; x++) out += x >= 3 && x <= 8 ? '3' : row[x]
    return out
  })
}

// ── 표정 ────────────────────────────────────────────────────────
// 눈은 3~4줄 왼쪽(3,4)·오른쪽(7,8), 입은 6~7줄 (4~7).

interface FaceSpec {
  /** 눈썹 — 3줄, 두 칸씩. */
  browL: string
  browR: string
  /** 눈 — 4~5줄, 두 칸씩. */
  eyeL: [string, string]
  eyeR: [string, string]
  /** 입 — 6~7줄, 네 칸씩. */
  mouth: [string, string]
  /** 눈물 한 방울. */
  tear?: boolean
}

const FACES: FaceSpec[] = [
  // 0 무표정
  { browL: '  ', browR: '  ', eyeL: ['33', '  '], eyeR: ['33', '  '], mouth: [' 33 ', '    '] },
  // 1 웃음
  { browL: '  ', browR: '  ', eyeL: ['33', '  '], eyeR: ['33', '  '], mouth: ['3  3', ' 33 '] },
  // 2 활짝
  { browL: '  ', browR: '  ', eyeL: [' 3', '3 '], eyeR: ['3 ', ' 3'], mouth: ['3333', ' 33 '] },
  // 3 놀람
  { browL: '3 ', browR: ' 3', eyeL: ['33', '33'], eyeR: ['33', '33'], mouth: [' 33 ', ' 33 '] },
  // 4 찡그림
  { browL: ' 3', browR: '3 ', eyeL: ['33', '  '], eyeR: ['33', '  '], mouth: [' 33 ', '3  3'] },
  // 5 화남
  { browL: ' 3', browR: '3 ', eyeL: ['33', '3 '], eyeR: ['33', ' 3'], mouth: ['3333', '    '] },
  // 6 슬픔
  { browL: '3 ', browR: ' 3', eyeL: ['33', '  '], eyeR: ['33', '  '], mouth: [' 33 ', '3  3'], tear: true },
  // 7 눈 감음
  { browL: '  ', browR: '  ', eyeL: ['  ', '33'], eyeR: ['  ', '33'], mouth: [' 33 ', '    '] },
  // 8 딴 데
  { browL: '  ', browR: '  ', eyeL: [' 3', '  '], eyeR: [' 3', '  '], mouth: ['  33', '    '] },
  // 9 능글
  { browL: '  ', browR: '33', eyeL: ['33', '  '], eyeR: ['3 ', '  '], mouth: ['  33', ' 33 '] },
]

// ── 유니폼 ──────────────────────────────────────────────────────
// 흑백이라 색으로 팀을 나눌 수 없다. 무지 밝음·무지 어두움·가로줄·세로줄로 나눈다.

function uniformCell(team: TeamId | null, x: number, y: number): string {
  switch (team) {
    case 'A':
      return '1'
    case 'B':
      return '2'
    case 'C':
      return y % 2 === 0 ? '1' : '2'
    case 'D':
      return x % 2 === 0 ? '1' : '2'
    default:
      return '1'
  }
}

/** 팔은 옷과 반대 톤으로. 어느 팀 옷을 입어도 몸통과 팔이 갈린다. */
function armCell(team: TeamId | null, x: number, y: number): string {
  return uniformCell(team, x, y) === '1' ? '2' : '1'
}

export const TEAM_WEAR: Record<TeamId, string> = {
  A: '밝은 무지',
  B: '어두운 무지',
  C: '가로 줄무늬',
  D: '세로 줄무늬',
}

// ── 조립 ────────────────────────────────────────────────────────

const CH: Record<string, string | null> = {
  ' ': null,
  '0': PAL.paper,
  '1': PAL.light,
  '2': PAL.mid,
  '3': PAL.ink,
}

function put(grid: string[][], x: number, y: number, ch: string): void {
  if (ch === ' ' || y < 0 || y >= grid.length || x < 0 || x >= ACTOR_W) return
  grid[y][x] = ch
}

/** 몸통 틀에 머리·표정·유니폼을 얹어 한 장을 만든다. */
function compose(
  look: AvatarLook,
  team: TeamId | null,
  dir: Dir,
  frame: number,
  skipHair = false,
): string[][] {
  const base = dir === 'up' ? BODY_UP : dir === 'down' ? BODY_DOWN : BODY_SIDE
  const grid = base.map((row, y) =>
    [...row].map((c, x) =>
      c === 'F' ? '1' : c === 'U' ? uniformCell(team, x, y) : c === 'A' ? armCell(team, x, y) : c,
    ),
  )
  // 옷깃 — 어느 팀이든 목 아래에 한 줄
  put(grid, 5, 10, '3')
  put(grid, 6, 10, '3')

  if (!skipHair) {
    const hair = HAIR_DOWN[ACTOR_HAIR_OF[look.hair % ACTOR_HAIR_OF.length]]
    const layer = dir === 'up' ? hairUp(hair) : dir === 'down' ? hair : hairSide(hair)
    const color = look.color ?? 0
    layer.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === ' ') return
        put(grid, x, y, hairTone(layer, base, x, y, c, color))
      }),
    )
  }

  // 앞머리가 눈과 입까지 덮으면 얼굴이 사라진다. 이마(3줄)와 턱은 머리에 내주고
  // 눈·입 줄만 살로 되돌린다.
  if (dir !== 'up') {
    for (let y = 4; y <= 6; y++) {
      for (let x = 3; x <= 8; x++) if (base[y][x] === 'F') grid[y][x] = '1'
    }
  }

  const f = FACES[look.face % FACES.length]
  if (dir === 'down') {
    // 눈이 폭 6칸짜리 살(3~8칸)의 가장자리(3·8칸)에 바로 붙으면 테두리와
    // 뭉개져 안 보인다. 한 칸씩 안쪽(4·7칸)으로 모아 찍어서 양옆에 살을
    // 남긴다 — 대신 눈은 두 칸이 아니라 한 칸으로 줄인다(6칸 폭에 두 눈이
    // 서로 안 닿고 떨어져 앉을 자리가 그것뿐이다).
    ;[...f.browL].forEach((c, i) => put(grid, 4 + i, 3, c))
    ;[...f.browR].forEach((c, i) => put(grid, 6 + i, 3, c))
    f.eyeL.forEach((row, ry) => put(grid, 4, 4 + ry, row[1] ?? row[0]))
    f.eyeR.forEach((row, ry) => put(grid, 7, 4 + ry, row[0]))
    f.mouth.forEach((row, ry) => [...row].forEach((c, i) => put(grid, 4 + i, 6 + ry, c)))
    if (f.tear) put(grid, 8, 6, '2')
  } else if (dir !== 'up') {
    // 옆얼굴은 눈도 입도 한 칸이다. 얼굴 경계선(9칸) 바로 옆(8칸)에 찍으면
    // 살색 틈이 없어 눈이 윤곽선에 들러붙어 안 보인다 — 한 칸 더 안쪽(7칸)에 찍어
    // 양옆에 살이 남게 한다.
    f.eyeR.forEach((row, ry) => [...row.slice(0, 1)].forEach((c, i) => put(grid, 7 + i, 4 + ry, c)))
    f.mouth.forEach((row, ry) => [...row.slice(1, 2)].forEach((c, i) => put(grid, 7 + i, 6 + ry, c)))
    if (f.tear) put(grid, 8, 5, '2')
  }

  const legs = dir === 'down' || dir === 'up' ? LEGS_FRONT[frame] : LEGS_SIDE[frame]
  return [...grid, ...legs.map((row) => [...row])]
}

function paint(grid: string[][]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = ACTOR_W
  c.height = ACTOR_H
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      const color = CH[ch]
      if (!color) return
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }),
  )
  return c
}

function mirror(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.translate(src.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

const cache = new Map<string, HTMLCanvasElement>()

/** 쓸 때 굽고 쌓아 둔다. 조합이 4800가지라 미리 다 구울 수 없다. */
export function actorSprite(look: AvatarLook, team: TeamId | null, dir: Dir, frame: number): HTMLCanvasElement {
  const key = `${look.hair}-${look.color ?? 0}-${look.face}-${team ?? '-'}-${dir}-${frame}`
  const hit = cache.get(key)
  if (hit) return hit
  const drawn = dir === 'left' ? mirror(paint(compose(look, team, 'right', frame))) : paint(compose(look, team, dir, frame))
  cache.set(key, drawn)
  return drawn
}

/**
 * 머리를 얹기 전의 맨머리 얼굴. 골격 자체가 맞는지 검토할 때 쓴다
 * (프로필 뼈대를 다시 잡을 때처럼 머리카락이 문제를 가릴 수 있어서).
 */
export function bareHeadSprite(face: number, dir: Dir, frame = 0): HTMLCanvasElement {
  const drawn =
    dir === 'left'
      ? mirror(paint(compose({ hair: 0, face }, null, 'right', frame, true)))
      : paint(compose({ hair: 0, face }, null, dir, frame, true))
  return drawn
}

/** 아바타 고르는 화면용 — 앞모습 한 장을 큼직하게. */
export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  look: AvatarLook,
  team: TeamId | null,
  scale: number,
): void {
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, ACTOR_W * scale, ACTOR_H * scale)
  ctx.drawImage(actorSprite(look, team, 'down', 0), 0, 0, ACTOR_W * scale, ACTOR_H * scale)
}

/** 참가자 id에서 기본 아바타를 뽑는다. 아무것도 고르지 않아도 서로 달라 보이게. */
export function defaultLook(seed: string): AvatarLook {
  return defaultChar(seed)
}
