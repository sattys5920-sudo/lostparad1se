// 깃발 — 방은 깃발을 많이 꽂은 팀의 것이다.
//
// 페이즈 끝의 머릿수로 주인을 정하던 것을 걷어내고, **꽂힌 깃발 수**로
// 정한다. 서 있는 사람은 이제 세지 않는다.
//
//   꽂기    페이즈 중에만. 선 방에 우리 팀 깃발 하나를 꽂는다. 토큰은
//           안 들고 팀 깃발 상자에서 하나가 빠진다. 누가 서 있든 꽂는다
//   남는다  꽂은 깃발은 **뽑히기 전까지 그 자리에 있다.** 페이즈가
//           바뀌어도, 아무도 안 서 있어도
//   뽑기    **우리 팀 로봇이 같은 방에 있어야 한다.** 사람 하나와 로봇
//           하나가 같이 가서 다른 팀 깃발 하나를 뽑는다. 토큰이 들고,
//           팀마다 한 페이즈에 한 번뿐이다. 뽑힌 깃발은 없어진다
//
//           두 사람이 가야 뽑게 하면 세 명짜리 팀은 셋 중 둘이 묶인다.
//           로봇을 둘째 손으로 쳐서 인원이 적은 팀도 한 명만 묶인다
//
//           **호루라기로도 뽑는다.** 로봇도 토큰도 안 들고 한도에도 안
//           든다. 상대가 와서 둘을 꽂고 가면 로봇 뽑기 한 번으로는 못
//           따라가서, 그때 쓰라고 있다(items)
//   판정    페이즈가 끝날 때 방마다 깃발 + 로봇을 센다. 제일 많은 팀이
//           주인이고, 동점이면 전 주인이 그대로다. 아무것도 없으면 빈 방
//
// 로봇은 **사라지지 않고 옮길 수 있는 깃발**이다. 한 기가 깃발 하나로
// 세어지고, 데리고 다니다 두고 올 수 있다.
//
// 깃발은 **팀 것**이다. 토큰처럼 팀 상자 하나를 같이 쓴다.
//
//   하루 지급   팀마다 같은 수. 인원이 셋이든 넷이든 같다
//   자판기      돈으로 산다. 학교 전체에 하루 몇 개뿐이라 먼저 사는 쪽이 임자다
//
// 이 파일은 **순수한 수와 함수**다. 판정에 쓰는 숫자는 전부 여기 있다.
import { TILE_BY_ID, type TileId } from './board'
import type { TeamId } from './v2'

/** 하루에 팀마다 들어오는 깃발. 그날 첫 페이즈가 열릴 때 들어온다. */
export const FLAGS_PER_DAY = 3

/** 자판기에서 깃발 하나 값(돈). */
export const FLAG_PRICE = 5

/** 자판기가 하루에 파는 깃발 — 학교 전체에서. */
export const FLAG_STOCK_PER_DAY = 4

/** 깃발 하나 뽑는 데 드는 팀 토큰. 이동 두 번 값이다. */
export const PULL_COST = 2

/**
 * 팀마다 한 페이즈에 뽑을 수 있는 수. **인원과 상관없이 같다.**
 *
 * 토큰은 하루 예순 개쯤 들어오고 깃발은 셋이다. 값만으로 막으면
 * 뽑는 속도가 꽂는 속도를 한참 앞질러 판이 금방 빈다 — 한도가 막는다.
 */
export const PULLS_PER_PHASE = 1

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
 * 오늘 몫을 넣은 상자. **그날 한 번만 들어온다** — 마지막으로 넣은 날을
 * 같이 받아서, 같은 날 두 번째 부르면 그대로 돌려준다.
 */
export function grantFlags(held: number, lastDay: number | null, today: number): { held: number; day: number } {
  if (lastDay === today) return { held, day: today }
  return { held: held + FLAGS_PER_DAY, day: today }
}
