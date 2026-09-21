// 심부름 — 게시판에 붙는 일거리.
//
// **붙이는 것은 운영자뿐이다.** 서버가 때맞춰 알아서 붙이는 길은 두지
// 않았다. 판에 붙는 심부름이 전부 사람 손을 거치면, 지금 이 판에서
// 무슨 일이 일어나기를 바라는지가 그대로 게시판에 붙는다.
//
// 붙고 난 뒤의 규칙은 누가 붙였든 같다. 받는 사람에게는 운영자가
// 붙였다는 티가 안 난다 — 티가 나면 그건 게임 안의 일이 아니라
// 게임 밖의 일이 된다.
import { TILE_BY_ID, type Cell, type Floor, type TileId } from './board'

/**
 * 물건 그림. **심부름마다 하나씩이다.**
 *
 * 전에는 운영자가 이름을 자유롭게 적고 그림은 넷 중에서 골랐다.
 * 그러니 「석고상」에 상자 그림이 붙었다 — 이름과 그림이 어긋나면
 * 멀리서 알아보는 몫을 못 한다.
 *
 * 목록을 닫고 물건마다 그려 둔다. box 는 남겨 둔다: 옛 판에 붙은
 * 종이와, 모르는 이름이 들어왔을 때의 자리다.
 */
export const THING_ICONS = [
  'beaker',
  'broom',
  'tray',
  'firstAid',
  'sheet',
  'mic',
  'bust',
  'can',
  'chalk',
  'keys',
  'box',
] as const
export type ThingIcon = (typeof THING_ICONS)[number]

/** 등록해 둔 일거리 하나. 운영자가 풀에 넣는다. */
export interface ErrandSpec {
  id: string
  /** 물건 이름. 머리 위에 들고 다니는 그것이다. */
  thing: string
  /** 도트 아이콘. 없으면 상자다. */
  icon?: ThingIcon
  /** 물건이 놓여 있는 방. **여기까지가 데이터다** — 어디로 가져갈지는 붙일 때 운영자가 정한다. */
  from: TileId
  /** 보상. 먼저 놓은 사람 지갑으로 들어간다. */
  coins: number
  /** 붙은 때부터 이만큼 지나면 받은 사람 전원 실패. */
  limitMin: number
  /** 한 줄 설명. 게시판에 그대로 나온다. */
  text: string
}

/**
 * 게시판 자리. **복도에 있다** — 맵 데이터에 박혀 있고 방이 아니다.
 *
 * 방에 두면 그 방을 차지한 팀의 것이 된다. 복도는 아무도 차지할 수
 * 없어서 게시판 앞은 늘 아무의 자리도 아니다.
 */
export interface BoardSpot {
  id: string
  /** 사람에게 보이는 이름. 「1층 서쪽 복도」 */
  name: string
  floor: Floor
  /** 전개도 좌표. **방이 아니라 복도 칸이다** — spot-check 가 확인한다. */
  cell: Cell
}

/**
 * 층마다 둘씩 여섯. 복도의 이 끝과 저 끝이다.
 *
 * 가운데에 몰아 두면 지나다니다 저절로 보이는데, 끝에 두면 **보러
 * 가야 한다.** 심부름을 찾는 일 자체가 걸음이 되는 편이 낫다.
 *
 * 좌표는 눈으로 찍지 않았다 — scripts/spot-check.ts 가 이 여섯 칸이
 * 정말 복도인지 지도에 물어본다.
 */
export const BOARDS: readonly BoardSpot[] = [
  { id: 'b1w', name: '지하 서쪽 복도', floor: 'b1', cell: { x: 14, y: 124 } },
  { id: 'b1e', name: '지하 동쪽 복도', floor: 'b1', cell: { x: 35, y: 124 } },
  { id: 'f1w', name: '1층 서쪽 복도', floor: 'f1', cell: { x: 14, y: 80 } },
  { id: 'f1s', name: '1층 남쪽 복도', floor: 'f1', cell: { x: 45, y: 95 } },
  { id: 'f2w', name: '2층 서쪽 복도', floor: 'f2', cell: { x: 14, y: 31 } },
  { id: 'f2s', name: '2층 남쪽 복도', floor: 'f2', cell: { x: 48, y: 47 } },
]

export const BOARD_BY_ID: Record<string, BoardSpot> = Object.fromEntries(BOARDS.map((b) => [b.id, b]))

/** 게시판 하나에 붙을 수 있는 장수. */
export const ERRANDS_PER_BOARD = 2

/** 한 사람이 동시에 받을 수 있는 심부름. **하나다.** */
export const ERRANDS_PER_PERSON = 1

/**
 * 게시판 앞인가. **한 칸 옆까지 친다.**
 *
 * 딱 그 칸에만 서야 하면 게시판이 벽에 붙어 있을 때 설 자리가 없다.
 * 둘레 한 칸이면 둘이 나란히 서서 같은 종이를 볼 수도 있다.
 */
export const atBoard = (me: Cell | null | undefined, board: BoardSpot): boolean =>
  me !== null && me !== undefined && Math.abs(me.x - board.cell.x) <= 1 && Math.abs(me.y - board.cell.y) <= 1

/**
 * 물건이 놓이는 칸. **방 안 한 자리다.**
 *
 * 「그 방 어딘가」로 두면 방에 들어서는 순간 집을 수 있어서, 물건이
 * 바닥에 있다는 말이 무색해진다. 자리를 정해 두면 방에 들어가 **찾아
 * 가서** 집는다 — 그 몇 걸음이 심부름을 일로 만든다.
 *
 * 심부름 아이디로 정한다. 같은 심부름은 늘 같은 자리다 — 어제 거기
 * 있었으면 오늘도 거기다. 서버가 붙일 때 한 번 계산해 문서에 적어
 * 두므로, 나중에 방을 옮겨도 판 위의 물건은 안 움직인다.
 *
 * 가장자리 한 줄은 비운다. 벽에 딱 붙은 자리는 그림이 벽에 먹힌다.
 */
export function thingCellOf(errandId: string, room: TileId): Cell {
  const r = TILE_BY_ID[room].plan
  // 안쪽 한 줄을 뺀 자리. 방이 3칸보다 좁으면 뺄 것이 없으니 그대로 쓴다
  const w = Math.max(1, r.w - 2)
  const h = Math.max(1, r.h - 2)
  const ox = r.w > 2 ? r.x + 1 : r.x
  const oy = r.h > 2 ? r.y + 1 : r.y
  let n = 0
  for (const ch of errandId) n = (n * 31 + ch.charCodeAt(0)) % 100_000
  return { x: ox + (n % w), y: oy + (Math.floor(n / w) % h) }
}

/**
 * 물건 옆인가. **게시판과 같은 자다** — 둘레 한 칸.
 *
 * 딱 그 칸을 밟아야 하면 물건이 책상 위에 놓였을 때 집을 수가 없다.
 */
export const atThing = (me: Cell | null | undefined, cell: Cell | null | undefined): boolean =>
  me != null && cell != null && Math.abs(me.x - cell.x) <= 1 && Math.abs(me.y - cell.y) <= 1

/** 제한 시간이 지났는가. 지나면 받은 사람 전원 실패다. */
export const isExpired = (postedMs: number, limitMin: number, nowMs: number): boolean =>
  nowMs - postedMs >= limitMin * 60_000

/** 남은 시간(분). 0 아래로는 안 내려간다. */
export const minutesLeft = (postedMs: number, limitMin: number, nowMs: number): number =>
  Math.max(0, Math.ceil((postedMs + limitMin * 60_000 - nowMs) / 60_000))

/**
 * 판에 있는 심부름 **전부**. 열 가지다.
 *
 * **운영자는 고르기만 한다.** 새로 만들거나 고치는 길은 없다 —
 * 물건마다 도트를 그려 두려면 목록이 닫혀 있어야 하고, 이름과 그림이
 * 어긋나지 않는 편이 자유롭게 적는 것보다 낫다.
 *
 * **여기 적힌 것은 「어디에 무슨 물건이 있는가」까지다.** 어디로
 * 가져갈지는 붙일 때 운영자가 방을 고른다 — 같은 비커라도 옆방으로
 * 보내면 잔심부름이고 다른 층 끝으로 보내면 한 페이즈짜리 일이다.
 * 값과 시간은 물건에 붙어 있으니, 멀리 보내면 그만큼 박한 일이 된다.
 * 그것도 운영자가 쥔 손잡이다.
 */
export const ERRANDS: readonly ErrandSpec[] = [
  {
    id: 'beaker',
    thing: '비커',
    icon: 'beaker',
    from: 'labRoom',
    coins: 2,
    limitMin: 40,
    text: '깨지지 않게.',
  },
  {
    id: 'broom',
    thing: '빗자루',
    icon: 'broom',
    from: 'gym',
    coins: 1,
    limitMin: 25,
    text: '쓰고 제자리에.',
  },
  {
    id: 'tray',
    thing: '식판',
    icon: 'tray',
    from: 'cafeteria',
    coins: 1,
    limitMin: 30,
    text: '한 장도 흘리지 말 것.',
  },
  {
    id: 'firstAid',
    thing: '구급상자',
    icon: 'firstAid',
    from: 'annex',
    coins: 2,
    limitMin: 30,
    text: '뛰다 넘어진 애가 있다.',
  },
  {
    id: 'sheet',
    thing: '악보 뭉치',
    icon: 'sheet',
    from: 'musicRoom',
    coins: 1,
    limitMin: 20,
    text: '순서가 흐트러지면 아무 쓸모가 없다.',
  },
  {
    id: 'mic',
    thing: '마이크',
    icon: 'mic',
    from: 'broadcastRoom',
    coins: 2,
    limitMin: 35,
    text: '선은 감아서 들 것.',
  },
  {
    id: 'bust',
    thing: '석고상',
    icon: 'bust',
    from: 'artRoom',
    coins: 3,
    limitMin: 40,
    text: '떨어뜨리면 끝이다.',
  },
  {
    id: 'can',
    thing: '물뿌리개',
    icon: 'can',
    from: 'storage',
    coins: 2,
    limitMin: 35,
    text: '가는 길에 다 흘리면 소용없다.',
  },
  {
    id: 'chalk',
    thing: '분필 상자',
    icon: 'chalk',
    from: 'storage',
    coins: 3,
    limitMin: 45,
    text: '한 통은 남겨 둘 것.',
  },
  {
    id: 'keys',
    thing: '열쇠 꾸러미',
    icon: 'keys',
    from: 'oldBuilding',
    coins: 3,
    limitMin: 45,
    text: '소리 나는 것을 들고 다니는 셈이다.',
  },
]

export const ERRAND_BY_ID: Record<string, ErrandSpec> = Object.fromEntries(ERRANDS.map((e) => [e.id, e]))
