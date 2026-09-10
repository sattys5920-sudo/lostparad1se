// 아바타 — 머리 10종 × 표정 10종 × 팀 유니폼.
//
// 캐릭터는 12×18이다. 16픽셀 타일보다 조금 커서 사람이 사물보다 눈에 먼저 든다.
// 몸통 틀에 F(얼굴)와 U(옷) 자리를 비워 두고, 머리·표정·유니폼을 얹어 굽는다.
// 조합이 10×10×4×4×3 = 4800가지라 미리 굽지 않고 쓸 때 굽고 쌓아 둔다.
import { PAL, type Dir } from './sprites'
import type { AvatarLook, TeamId } from '../types'

export const ACTOR_W = 12
export const ACTOR_H = 18

export type { AvatarLook }

export const HAIR_NAMES = [
  '짧은 머리', '단발', '긴 머리', '하나로 묶음', '양갈래',
  '스포츠머리', '곱슬', '앞머리', '가르마', '쪽머리',
]

export const FACE_NAMES = [
  '무표정', '웃음', '활짝', '놀람', '찡그림',
  '화남', '슬픔', '눈 감음', '딴 데', '능글',
]

// ── 몸통 틀 ─────────────────────────────────────────────────────
// ' ' 비움 · '3' 윤곽 · '1' 살 · 'F' 얼굴(표정이 덮는다) · 'U' 옷(팀이 덮는다)

const BODY_DOWN = [
  '            ',
  '    3333    ',
  '   331133   ',
  '  33FFFF33  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '  3FFFFFF3  ',
  '   3FFFF3   ',
  '   311113   ',
  '    3113    ',
  '  33UUUU33  ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 33UUUUUU33 ',
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
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 33UUUUUU33 ',
]

const BODY_SIDE = [
  '            ',
  '    3333    ',
  '   331113   ',
  '   31FFF13  ',
  '   31FFF13  ',
  '   31FFF13  ',
  '   31FFF13  ',
  '    31113   ',
  '    31113   ',
  '    3113    ',
  '  33UUUU33  ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 3UUUUUUUU3 ',
  ' 33UUUUUU33 ',
]

const LEGS: Record<number, string[]> = {
  0: ['   33  33   ', '   33  33   '],
  1: ['   3333     ', '   33  33   '],
  2: ['     3333   ', '   33  33   '],
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
  // 2 긴 머리
  [
    '            ', '    3333    ', '   333333   ', '  33333333  ',
    '  33    33  ', '  33    33  ', '  33    33  ', '  33    33  ',
    '  33    33  ', ' 233    332 ', ' 233    332 ', '  33    33  ',
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

/** 옆모습 머리 — 넷째 줄부터는 뒤통수 쪽(왼쪽)만 남긴다. 묶은 머리는 뒤로 넘어간다. */
function hairSide(down: string[]): string[] {
  return down.map((row, y) => {
    if (y <= 3) return row
    let out = ''
    for (let x = 0; x < ACTOR_W; x++) {
      if (x > 5) {
        out += ' '
        continue
      }
      const here = row[x]
      const mirrored = row[ACTOR_W - 1 - x]
      out += here !== ' ' ? here : mirrored !== ' ' ? mirrored : ' '
    }
    return out
  })
}

/** 뒷모습 머리 — 앞모습에 뒤통수를 채운다. */
function hairUp(down: string[]): string[] {
  return down.map((row, y) => {
    if (y < 2 || y > 7) return row
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
function compose(look: AvatarLook, team: TeamId | null, dir: Dir, frame: number): string[][] {
  const base = dir === 'up' ? BODY_UP : dir === 'down' ? BODY_DOWN : BODY_SIDE
  const grid = base.map((row, y) =>
    [...row].map((c, x) => (c === 'F' ? '1' : c === 'U' ? uniformCell(team, x, y) : c)),
  )
  // 옷깃 — 어느 팀이든 목 아래에 한 줄
  put(grid, 5, 10, '3')
  put(grid, 6, 10, '3')

  const hair = HAIR_DOWN[look.hair % HAIR_DOWN.length]
  const layer = dir === 'up' ? hairUp(hair) : dir === 'down' ? hair : hairSide(hair)
  layer.forEach((row, y) => [...row].forEach((c, x) => put(grid, x, y, c)))

  // 앞머리가 눈과 입까지 덮으면 얼굴이 사라진다. 이마(3줄)와 턱은 머리에 내주고
  // 눈·입 줄만 살로 되돌린다.
  if (dir !== 'up') {
    for (let y = 4; y <= 6; y++) {
      for (let x = 3; x <= 8; x++) if (base[y][x] === 'F') grid[y][x] = '1'
    }
  }

  const f = FACES[look.face % FACES.length]
  if (dir === 'down') {
    ;[...f.browL].forEach((c, i) => put(grid, 3 + i, 3, c))
    ;[...f.browR].forEach((c, i) => put(grid, 7 + i, 3, c))
    f.eyeL.forEach((row, ry) => [...row].forEach((c, i) => put(grid, 3 + i, 4 + ry, c)))
    f.eyeR.forEach((row, ry) => [...row].forEach((c, i) => put(grid, 7 + i, 4 + ry, c)))
    f.mouth.forEach((row, ry) => [...row].forEach((c, i) => put(grid, 4 + i, 6 + ry, c)))
    if (f.tear) put(grid, 8, 6, '2')
  } else if (dir !== 'up') {
    // 옆모습은 한쪽 눈과 입 오른쪽 절반만 보인다
    ;[...f.browR].forEach((c, i) => put(grid, 5 + i, 3, c))
    f.eyeR.forEach((row, ry) => [...row].forEach((c, i) => put(grid, 5 + i, 4 + ry, c)))
    f.mouth.forEach((row, ry) => [...row.slice(2)].forEach((c, i) => put(grid, 6 + i, 6 + ry, c)))
    if (f.tear) put(grid, 7, 6, '2')
  }

  return [...grid, ...LEGS[frame].map((row) => [...row])]
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
  const key = `${look.hair}-${look.face}-${team ?? '-'}-${dir}-${frame}`
  const hit = cache.get(key)
  if (hit) return hit
  const drawn = dir === 'left' ? mirror(paint(compose(look, team, 'right', frame))) : paint(compose(look, team, dir, frame))
  cache.set(key, drawn)
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
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return { hair: h % 10, face: Math.floor(h / 10) % 10 }
}
