// 판 스물다섯 칸. **여기에는 판이 없다 — shared/rules/board.ts 에서 가져온다.**
//
// 전에는 이 파일이 판을 따로 한 벌 들고 있었다. 그러다 규칙 쪽 판이
// 5×5 스물다섯 칸으로 커졌는데 여기는 스물두 칸인 채로 남았고, 걸어
// 다니는 학교가 그 스물두 칸으로 지어졌다. 그래서 문을 지나면 서버가
// 「옆방이 아니다」라고 되받는 자리가 생겼다 — 미술실에서 음악실로
// 가는 문이 그랬다. 두 벌이면 반드시 이렇게 된다.
//
// 화면 쪽이 쓰던 이름(baseValue·isCore·buildingSlots)은 그대로 두고
// 규칙 쪽 값에서 번역만 한다. 부르는 자리를 전부 고치는 것보다 낫다.
import { TILES as BOARD, ADJACENCY as BOARD_ADJACENCY } from '../../../shared/rules/board'
import type { TileId, TileSpec } from '../types'

export const TILES: TileSpec[] = BOARD.map((t) => ({
  id: t.id as TileId,
  name: t.name,
  baseValue: t.value,
  homeOf: t.homeOf,
  // 「핵심 지역」은 A의 기록이 열어 주기 전까지 잠긴 칸이다.
  // 규칙 쪽 등급으로는 core 와 plaza 가 그것이다
  isCore: t.tier === 'core' || t.tier === 'plaza',
}))

export const tileById: Record<TileId, TileSpec> = Object.fromEntries(TILES.map((t) => [t.id, t])) as Record<
  TileId,
  TileSpec
>

export const ADJACENCY: Record<TileId, TileId[]> = Object.fromEntries(
  Object.entries(BOARD_ADJACENCY).map(([id, ns]) => [id, [...ns]]),
) as Record<TileId, TileId[]>

/** 핵심 지역을 점령할 때 드는 영향력. 영향력은 오직 투표로만 들어온다. */
export const CORE_INFLUENCE_COST = 4
