// 흑백 4색만 쓴다. 앱 본편의 눈밭 팔레트를 그대로 도트로 옮긴 것.
//
// **소품 그림은 여기에 없다.** 전부 propArt.ts 에 있고, 어떤 소품이
// 있는지는 props.ts 가 안다. 여기서는 바닥·벽·문·계단과 흔적만 굽는다.
import { PROP_ART, PROP_KINDS, type PropKind } from './props'

export const PAL = {
  paper: '#eef0f2', // 0 — 바닥
  light: '#c9ced2', // 1 — 밝은 면, 옷
  mid: '#5c646b', // 2 — 중간 톤, 그림자
  ink: '#0b0d0f', // 3 — 벽, 윤곽
} as const

const CH: Record<string, string | null> = {
  ' ': null,
  '0': PAL.paper,
  '1': PAL.light,
  '2': PAL.mid,
  '3': PAL.ink,
}

/** 문자열 격자를 오프스크린 캔버스로 굽는다. 매 프레임 픽셀을 다시 찍지 않으려고. */
function bake(rows: string[]): HTMLCanvasElement {
  const w = rows[0].length
  const h = rows.length
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = CH[rows[y][x]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return c
}

// ── 타일 (16×16) ────────────────────────────────────────────────

/**
 * 바닥. **민무늬다.**
 *
 * 전에는 복도에 점을 찍고 교실에 격자를 긋고 실외에 자갈을 뿌렸는데,
 * 그 위에 팀 무늬까지 얹히니 화면이 요란해서 사람과 가구가 안 보였다.
 * 지금은 넷 다 단색이고, 어느 실인지는 가구가, 누구 땅인지는 색이 말한다.
 *
 * 무늬 자체는 아래 grid() 로 언제든 되살릴 수 있다.
 */
const FLOOR_FLAT = Array.from({ length: 16 }, () => '0'.repeat(16))
const FLOOR_HALL = FLOOR_FLAT
const FLOOR_ROOM = FLOOR_FLAT

/** 벽 몸통 — 위로 벽이 이어질 때 쓴다. 갓을 반복해 찍으면 벽이 아니라 블록 더미로 보인다. */
const WALL_BODY = [
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '2233223322332233',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3322332233223322',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
]

/** 벽 갓 — 윗면(3줄)만 회색으로 띄워 두께를 준다. 벽 줄기의 맨 위에만 얹는다. */
const WALL = [
  '1111111111111111',
  '2222222222222222',
  '2222222222222222',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
  '3333333333333333',
]

/**
 * 문. **벽 한 줄을 그대로 메운다.**
 *
 * 전에는 바닥에 문설주 점 두 개만 찍어 뒀다. 벽에 구멍이 뚫린 것처럼
 * 보일 뿐 문으로는 안 보였다 — 어디로 나가는지 눈으로 알 수가 없었다.
 *
 * 문은 한 칸이다. 그래도 옆으로 이어 찍어도 이음매가 안 보이게 짜 뒀다 —
 * 너비를 다시 넓히더라도 그림은 그대로 쓴다.
 *
 * 벽이 가로로 뻗으면(위아래 방 사이) 널빤지도 가로로 눕고, 세로로
 * 뻗으면 널빤지도 선다. 그리는 쪽이 문의 방향을 보고 고른다.
 */

/** 가로로 뻗은 벽에 난 문. 위아래로 지나간다. */
const DOOR_H = [
  '3333333333333333',
  '2222222222222222',
  '1111111111111111',
  '1111111111111111',
  '2222222222222222',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '1111111111111111',
  '2222222222222222',
  '1111111111111111',
  '1111111111111111',
  '2222222222222222',
  '3333333333333333',
]

/**
 * 계단.
 *
 * **세로로 이어 찍는다.** 계단 한 칸은 계단으로 안 보인다 — 발판이
 * 하나뿐이라 그냥 줄무늬 바닥이다. 그래서 계단은 세 칸짜리 층계로
 * 놓고, 이 그림을 위아래로 이어 붙여도 이음매가 안 보이게 짰다.
 * 네 줄이 발판 하나이고, 열여섯 줄이면 발판 넷이다.
 *
 * 화살표는 발판마다 하나씩 들어간다. 오르는 계단은 위를, 내려가는
 * 계단은 아래를 가리키고, 내려가는 쪽은 발판도 어둡다.
 */
const STAIR_UP = [
  '3333333333333333',
  '3000000000000003',
  '3000003333000003',
  '3000333333330003',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3111111111111113',
  '3333333333333333',
  '3000000000000003',
  '3000003333000003',
  '3000333333330003',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3111111111111113',
]

const STAIR_DOWN = [
  '3333333333333333',
  '3222222222222223',
  '3220000000000223',
  '3222200000022223',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3111111111111113',
  '3333333333333333',
  '3222222222222223',
  '3220000000000223',
  '3222200000022223',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3111111111111113',
]

/** 세로로 뻗은 벽에 난 문. 좌우로 지나간다. */
const DOOR_V = Array.from({ length: 16 }, () => '3211211111121123')


// ── 점령된 바닥 ─────────────────────────────────────────────────
// 흑백이라 색으로 팀을 구분할 수 없다. 바닥 무늬로 나눈다 —
// 어느 구역에 들어선 순간 발밑을 보면 누구 땅인지 안다.

function grid(mark: (x: number, y: number) => string): string[] {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let row = ''
    for (let x = 0; x < 16; x++) row += mark(x, y)
    rows.push(row)
  }
  return rows
}

/** 흙바닥 — 정원·운동장·옥상. 자잘한 알갱이만 흩어 둔다. */
const FLOOR_OUTDOOR = FLOOR_FLAT

/** 마루 — 체육관·강당. 바탕색만 다르다. */
const FLOOR_WOOD = FLOOR_FLAT

/**
 * 팀 무늬. **지금은 비어 있다.**
 *
 * 점·사선·가로줄을 바닥에 얹었더니 무늬 위에 무늬라 눈이 아팠다.
 * 누구 땅인지는 벽과 바닥에 입히는 색(Walk.tsx 의 TEAM_WASH)만으로
 * 충분하다. 되살리려면 아래 teamPattern 을 다시 쓰면 된다.
 */
function teamPattern(mark: (x: number, y: number) => boolean): string[] {
  return grid((x, y) => (mark(x, y) ? '2' : ' '))
}

const NO_PATTERN = teamPattern(() => false)

const FLOOR_TEAM: Record<string, string[]> = {
  A: NO_PATTERN,
  B: NO_PATTERN,
  C: NO_PATTERN,
  D: NO_PATTERN,
}

/** 아직 A의 기록이 열지 않은 문. 널빤지를 가로질러 박아 둔다. */
const DOOR_LOCKED = [
  '3333333333333333',
  '3222222222222223',
  '3211111111111123',
  '3211111111111123',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3333333333333333',
  '3211111111111123',
  '3211111111111123',
  '3333333333333333',
  '3111111111111113',
  '3111111111111113',
  '3211111111111123',
  '3222222222222223',
  '3333333333333333',
]


// ── 흔적 ────────────────────────────────────────────────────────
// 지나갈 수는 있다. 다만 지나가면서 보게 된다.

/** 국화 한 다발. */
const FLOWERS = [
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '      3  3      ',
  '     313 313    ',
  '      3  3      ',
  '    33333333    ',
  '   3111111113   ',
  '    33333333    ',
  '      2222      ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 지워지다 만 분필 자국. */
const CHALK = [
  '                ',
  '                ',
  '                ',
  '   2  2   2 2   ',
  '   2222   222   ',
  '   2  2   2     ',
  '                ',
  '      22 2      ',
  '     2  2 2     ',
  '      222       ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 가지런히 벗어 둔 실내화. */
const SHOES = [
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '    333  333    ',
  '    313  313    ',
  '    313  313    ',
  '    313  313    ',
  '    333  333    ',
  '    323  323    ',
  '    333  333    ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 출입을 막아 둔 테이프. */
const TAPE = [
  '                ',
  '                ',
  '                ',
  '                ',
  '3333333333333333',
  '1111111111111111',
  '3311331133113311',
  '1111111111111111',
  '3333333333333333',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 뜯겨 떨어진 게시물. */
const POSTER = [
  '                ',
  '                ',
  '                ',
  '                ',
  '    33333333    ',
  '    31111113    ',
  '    31221113    ',
  '    31111113    ',
  '    3111 313    ',
  '    311  333    ',
  '    3333        ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
]

/** 갈라진 바닥. */
const CRACK = [
  '                ',
  '   2            ',
  '    2           ',
  '    22          ',
  '     2          ',
  '     2   2      ',
  '      2 2       ',
  '      22        ',
  '       2        ',
  '       22       ',
  '        2       ',
  '        2       ',
  '         2      ',
  '                ',
  '                ',
  '                ',
]

/** 누가 켜 두고 간 초. */
const CANDLE = [
  '                ',
  '                ',
  '                ',
  '       3        ',
  '      313       ',
  '       3        ',
  '      333       ',
  '     31113      ',
  '     31113      ',
  '     31113      ',
  '     31113      ',
  '     33333      ',
  '    3333333     ',
  '                ',
  '                ',
  '                ',
]

/** 지워지지 않은 얼룩. */
const STAIN = [
  '                ',
  '                ',
  '                ',
  '      222       ',
  '     22222      ',
  '    2222222     ',
  '    2211222     ',
  '     222222     ',
  '      2222      ',
  '       22       ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
  '                ',
]

export type Dir = 'down' | 'up' | 'left' | 'right'

export type { PropKind } from './props'

/** 길을 막지 않는 흔적. 바닥에 깔리고, 지나가면서 보게 된다. */
export type MarkKind = 'flowers' | 'chalk' | 'shoes' | 'tape' | 'poster' | 'crack' | 'candle' | 'stain'

export interface SpriteSet {
  tiles: {
    floorHall: HTMLCanvasElement
    floorRoom: HTMLCanvasElement
    floorOutdoor: HTMLCanvasElement
    floorWood: HTMLCanvasElement
    wall: HTMLCanvasElement
    wallBody: HTMLCanvasElement
    doorH: HTMLCanvasElement
    doorV: HTMLCanvasElement
    doorLocked: HTMLCanvasElement
    stairUp: HTMLCanvasElement
    stairDown: HTMLCanvasElement
    floorTeam: Record<string, HTMLCanvasElement>
  }
  props: Record<PropKind, HTMLCanvasElement>
  marks: Record<MarkKind, HTMLCanvasElement>
  shadow: HTMLCanvasElement
}


export function buildSprites(): SpriteSet {
  return {
    tiles: {
      floorHall: bake(FLOOR_HALL),
      floorRoom: bake(FLOOR_ROOM),
      floorOutdoor: bake(FLOOR_OUTDOOR),
      floorWood: bake(FLOOR_WOOD),
      wall: bake(WALL),
      wallBody: bake(WALL_BODY),
      doorH: bake(DOOR_H),
      doorV: bake(DOOR_V),
      doorLocked: bake(DOOR_LOCKED),
      stairUp: bake(STAIR_UP),
      stairDown: bake(STAIR_DOWN),
      floorTeam: Object.fromEntries(
        Object.entries(FLOOR_TEAM).map(([team, rows]) => [team, bake(rows)]),
      ),
    },
    props: Object.fromEntries(
      PROP_KINDS.map((k) => [k, bake(PROP_ART[k] as unknown as string[])]),
    ) as Record<PropKind, HTMLCanvasElement>,
    marks: {
      flowers: bake(FLOWERS),
      chalk: bake(CHALK),
      shoes: bake(SHOES),
      tape: bake(TAPE),
      poster: bake(POSTER),
      crack: bake(CRACK),
      candle: bake(CANDLE),
      stain: bake(STAIN),
    },
    // 사람은 아바타(map/avatar.ts)가 그린다. 여기서는 발밑 그림자만 낸다.
    shadow: bake(['    2222    ', '   222222   ']),
  }
}

