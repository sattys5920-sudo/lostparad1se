// 깃발 — 방은 깃발을 많이 꽂은 팀의 것이다.
//
// 페이즈 끝의 머릿수로 주인을 정하던 것을 걷어내고, **꽂힌 깃발 수**로
// 정한다. 서 있는 사람은 이제 세지 않는다.
//
//   꽂기    페이즈 중에만. 선 방에 우리 팀 깃발 하나를 꽂는다. 토큰은
//           안 들고 팀 깃발 상자에서 하나가 빠진다. 누가 서 있든 꽂는다 —
//           지워진 사람도 꽂는다. 혼자 하는 일이라 막을 까닭이 없다
//   남는다  꽂은 깃발은 **뽑히기 전까지 그 자리에 있다.** 페이즈가
//           바뀌어도, 아무도 안 서 있어도
//   뽑기    **서로 다른 두 사람이 손대야 하나가 뽑힌다.** 한 사람이
//           손대면 1/2, 다른 사람이 한 번 더 손대면 2/2로 뽑힌다.
//           **같은 팀일 필요는 없다** — 깃발 주인 팀 사람이 손대도 되고
//           (배신), 서로 다른 팀 둘이 힘을 합쳐도 된다. 사람마다 토큰
//           하나씩 든다. 페이즈당 횟수 한도는 없다
//
//   판정    페이즈가 끝날 때 방마다 깃발 + 로봇을 센다. 제일 많은 팀이
//           주인이고, 동점이거나 아무것도 없으면 **전 주인이 그대로다**
//
// 로봇은 **사라지지 않고 옮길 수 있는 깃발**이다. 한 기가 깃발 하나로
// 세어지고, 데리고 다니다 두고 올 수 있다.
//
// 깃발은 **팀 것**이다. 토큰처럼 팀 상자 하나를 같이 쓴다.
//
//   페이즈 몫   페이즈가 열릴 때마다 팀마다 같은 수로 **다시 채운다**.
//               남은 것이 쌓이지 않는다 — 한 페이즈에 쓸 수 있는 한도다.
//               인원이 셋이든 넷이든 같다
//   자판기      돈으로 산다. 학교 전체에 하루 몇 개뿐이라 먼저 사는 쪽이
//               임자다. **산 것은 페이즈가 바뀌어도 남는다**
//
// 이 파일은 **순수한 수와 함수**다. 판정에 쓰는 숫자는 전부 여기 있다.
import { TILE_BY_ID, type TileId } from './board'
import type { TeamId } from './v2'

/** 페이즈마다 팀에 채워 주는 깃발. 남은 것에 더하지 않고 이 수로 맞춘다. */
export const FLAGS_PER_PHASE = 4

/** 자판기에서 깃발 하나 값(돈). */
export const FLAG_PRICE = 10

/** 자판기가 하루에 파는 깃발 — 학교 전체에서. */
export const FLAG_STOCK_PER_DAY = 10

/** 깃발 하나를 손댈 때마다 드는 팀 토큰. 사람마다, 손댈 때마다 든다. */
export const PULL_COST = 1

/** 깃발 하나가 뽑히는 데 필요한 손길 수. **서로 다른 두 사람이어야 한다.** */
export const PULL_HITS = 2

/** 방마다 팀마다 꽂힌 수. 없는 칸은 0이다. */
export type FlagMap = Readonly<Partial<Record<TileId, Readonly<Partial<Record<TeamId, number>>>>>>

/** 팀마다 깃발 상자. */
export type FlagBoxes = Readonly<Partial<Record<TeamId, number>>>

/** 그 방에 그 팀 깃발이 몇 개인가. */
export const flagsIn = (flags: FlagMap, tile: TileId, team: TeamId): number => flags[tile]?.[team] ?? 0

/** 그 방에 꽂힌 깃발 전부. */
export const flagTotal = (flags: FlagMap, tile: TileId): number =>
  Object.values(flags[tile] ?? {}).reduce<number>((n, k) => n + (k ?? 0), 0)

/**
 * 깃발을 꽂을 수 있는 방인가. **2-3 교실은 안 된다** — 열넷이 아침마다
 * 모이는 방이라 아무도 못 가진다(occupy 의 settle 과 같은 이유).
 */
export const canHoldFlags = (tile: TileId): boolean => TILE_BY_ID[tile]?.tier !== 'plaza'

/** 하나 꽂은 뒤. 원래 것은 안 고친다. */
export function withPlanted(flags: FlagMap, tile: TileId, team: TeamId): FlagMap {
  const room = { ...(flags[tile] ?? {}) }
  room[team] = (room[team] ?? 0) + 1
  return { ...flags, [tile]: room }
}

/** 하나 뽑은 뒤. 그 팀 깃발이 없으면 null. */
export function withPulled(flags: FlagMap, tile: TileId, team: TeamId): FlagMap | null {
  const had = flagsIn(flags, tile, team)
  if (had <= 0) return null
  const room = { ...(flags[tile] ?? {}) }
  if (had === 1) delete room[team]
  else room[team] = had - 1
  return { ...flags, [tile]: room }
}

/**
 * 뽑을 깃발을 안 골랐을 때 뽑는 팀 — **나 말고 제일 많이 꽂은 팀.**
 * 동수면 팀 순서가 앞선 쪽. 남의 깃발이 없으면 null.
 */
export function pullTarget(flags: FlagMap, tile: TileId, mine: TeamId): TeamId | null {
  const rows = (Object.entries(flags[tile] ?? {}) as [TeamId, number][])
    .filter(([t, n]) => t !== mine && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return rows[0]?.[0] ?? null
}

/**
 * 팀 상자는 두 칸이다 — 페이즈 몫(given)과 산 것(bought).
 * 꽂을 때는 **페이즈 몫부터** 쓴다. 다음 페이즈에 사라질 것을 먼저
 * 써야 산 것이 남는다.
 */
export interface FlagBox {
  given: number
  bought: number
}

export const boxTotal = (b: FlagBox): number => b.given + b.bought

/** 총 수가 줄었으면 페이즈 몫에서 먼저 뺀다. */
export function spendFlags(b: FlagBox, totalAfter: number): FlagBox {
  const spent = Math.max(0, boxTotal(b) - totalAfter)
  const fromGiven = Math.min(b.given, spent)
  return { given: b.given - fromGiven, bought: Math.max(0, b.bought - (spent - fromGiven)) }
}
