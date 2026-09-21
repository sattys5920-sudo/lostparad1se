// 심부름 — 게시판에 붙는 일거리.
//
// **붙이는 것은 운영자뿐이다.** 서버가 때맞춰 알아서 붙이는 길은 두지
// 않았다. 판에 붙는 심부름이 전부 사람 손을 거치면, 지금 이 판에서
// 무슨 일이 일어나기를 바라는지가 그대로 게시판에 붙는다.
//
// 붙고 난 뒤의 규칙은 누가 붙였든 같다. 받는 사람에게는 운영자가
// 붙였다는 티가 안 난다 — 티가 나면 그건 게임 안의 일이 아니라
// 게임 밖의 일이 된다.
import type { Cell, Floor, TileId } from './board'

/** 등록해 둔 일거리 하나. 운영자가 풀에 넣는다. */
export interface ErrandSpec {
  id: string
  /** 물건 이름. 머리 위에 들고 다니는 그것이다. */
  thing: string
  /** 도트 아이콘 이름(errandArt 의 키). 없으면 기본 상자. */
  icon?: string
  from: TileId
  to: TileId
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

/** 제한 시간이 지났는가. 지나면 받은 사람 전원 실패다. */
export const isExpired = (postedMs: number, limitMin: number, nowMs: number): boolean =>
  nowMs - postedMs >= limitMin * 60_000

/** 남은 시간(분). 0 아래로는 안 내려간다. */
export const minutesLeft = (postedMs: number, limitMin: number, nowMs: number): number =>
  Math.max(0, Math.ceil((postedMs + limitMin * 60_000 - nowMs) / 60_000))

/** 판에 처음 깔아 두는 일거리. 운영자가 지우고 새로 넣을 수 있다. */
export const STARTING_ERRANDS: readonly ErrandSpec[] = [
  {
    id: 'beaker',
    thing: '비커',
    from: 'labRoom',
    to: 'annex',
    coins: 2,
    limitMin: 40,
    text: '깨지지 않게.',
  },
  {
    id: 'broom',
    thing: '빗자루',
    from: 'gym',
    to: 'auditorium',
    coins: 1,
    limitMin: 25,
    text: '쓰고 제자리에.',
  },
  {
    id: 'tray',
    thing: '식판',
    from: 'cafeteria',
    to: 'baseB',
    coins: 1,
    limitMin: 30,
    text: '한 장도 흘리지 말 것.',
  },
]
