// 쪽지 70장 배포판 — 운영자 화면과 서버가 같이 쓰는 셈.
//
// **문안은 여기 없다.** 문안은 서버 전용(functions/src/story/slipNotes.ts)이고,
// 여기서는 번호 · 역할 · 짝 · 상태만 다룬다. 화면이 불러도 새는 것이 없다.
//
//   대기   아직 안 뿌렸다
//   뿌림   바닥에 있다(어느 방)
//   주움   누가 들고 있다
//   찢김   찢긴 종이로 바닥에 있다. 테이프로 붙이면 다시 「주움」이 된다
import type { RoleId } from '../missions/roleNames'
import { START_TILE, TILES, type TileId } from './board'

export type SlipState = 'waiting' | 'placed' | 'held' | 'torn'

export const SLIP_STATE_LABEL: Record<SlipState, string> = {
  waiting: '대기',
  placed: '뿌림',
  held: '주움',
  torn: '찢김',
}

/** 3~4번(그날)은 세다. 이날부터 뿌린다 — 그 전에는 한 번 더 묻는다 */
export const LATE_FROM_DAY = 3

/**
 * 뿌릴 수 있는 방. **2-3 교실은 뺀다** — 열넷이 아침마다 모여 서는
 * 곳이라, 거기 떨어진 쪽지는 누가 먼저 줍느냐가 아니라 누가 먼저
 * 들어오느냐가 된다.
 */
export const SCATTER_ROOMS: readonly TileId[] = TILES.filter((t) => t.id !== START_TILE).map((t) => t.id)

/** 운영자 판에 가는 한 장. **문안 전문은 운영자에게만** 서버가 이름까지 끼워 보낸다 */
export interface BoardNote {
  id: string
  /** 역할 번호(1~14). 목록 순서다 */
  no: number
  roleKey: RoleId
  slot: 1 | 2 | 3 | 4 | 5
  kind: 'role' | 'name'
  state: SlipState
  /** 판에 나간 쪽지 문서의 번호. 회수할 때 쓴다. 대기면 null */
  slipId: string | null
  /** 뿌림 — 놓인 방 */
  room: TileId | null
  /** 주움 — 든 사람 이름 */
  holder: string | null
  /** 뿌린 날. 몰림 경고가 본다. 대기면 null */
  placedDay: number | null
  /** 한 번이라도 누가 주웠나. 주웠던 것은 회수 못 한다 */
  everHeld: boolean
  /** 운영자용 전문 — {이름}은 실제 이름으로 바뀌어 있다 */
  text: string
}

/** 역할 하나의 경고 */
export interface RoleWarn {
  /** 이름형과 역할형이 하나라도 같이 판에 나갔다 — 이 역할이 누구인지 맞출 수 있다 */
  solvable: boolean
  /** 같은 날 이 역할의 쪽지가 두 장 이상 뿌려졌다 */
  crowdedDays: number[]
}

export function roleWarn(notes: readonly BoardNote[]): RoleWarn {
  const nameOut = notes.some((n) => n.kind === 'name' && n.state !== 'waiting')
  const roleOut = notes.some((n) => n.kind === 'role' && n.state !== 'waiting')
  const solvable = nameOut && roleOut
  const perDay = new Map<number, number>()
  for (const n of notes) if (n.placedDay !== null) perDay.set(n.placedDay, (perDay.get(n.placedDay) ?? 0) + 1)
  const crowdedDays = [...perDay.entries()].filter(([, c]) => c >= 2).map(([d]) => d).sort((a, b) => a - b)
  return { solvable, crowdedDays }
}

/** 3~4번(그날)인가. 5번(미션)은 그날 것이 아니라 언제든 뿌린다 */
export const isLateSlot = (slot: number): boolean => slot === 3 || slot === 4

/** 3~4번(그날)을 이날 뿌리면 한 번 더 물어야 하는가 */
export const needsEarlyConfirm = (slot: 1 | 2 | 3 | 4 | 5, day: number): boolean => isLateSlot(slot) && day < LATE_FROM_DAY

/**
 * 무작위로 n장 고른다. **서버가 부른다** — 화면이 고른 것을 믿지 않는다.
 *
 *   - 대기 중인 것에서만
 *   - 3~4번(그날)은 DAY 3 이후에만 후보
 *   - 한 역할이 같은 날 두 장 이상 되지 않게(이미 오늘 뿌린 것까지 센다)
 *   - 방은 쪽지가 안 놓인 빈 방부터, 서로 다르게
 *
 * 조건을 못 채우면 n보다 적게 돌려준다.
 */
export function planScatter(input: {
  notes: readonly Pick<BoardNote, 'id' | 'roleKey' | 'slot' | 'state' | 'placedDay' | 'room'>[]
  day: number
  n: number
  rooms?: readonly TileId[]
  rng?: () => number
}): { id: string; room: TileId }[] {
  const rng = input.rng ?? Math.random
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const today = new Map<RoleId, number>()
  for (const n of input.notes) if (n.placedDay === input.day) today.set(n.roleKey, (today.get(n.roleKey) ?? 0) + 1)
  const pool = shuffle(
    input.notes.filter((n) => n.state === 'waiting' && (!isLateSlot(n.slot) || input.day >= LATE_FROM_DAY)),
  )
  const busy = new Set(input.notes.filter((n) => n.state === 'placed' && n.room).map((n) => n.room as TileId))
  const rooms = input.rooms ?? SCATTER_ROOMS
  const empty = shuffle(rooms.filter((r) => !busy.has(r)))
  const rest = shuffle(rooms.filter((r) => busy.has(r)))
  const roomQueue = [...empty, ...rest]
  const out: { id: string; room: TileId }[] = []
  for (const n of pool) {
    if (out.length >= input.n || out.length >= roomQueue.length) break
    if ((today.get(n.roleKey) ?? 0) >= 1) continue
    today.set(n.roleKey, 1)
    out.push({ id: n.id, room: roomQueue[out.length] })
  }
  return out
}
