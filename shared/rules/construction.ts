// 공사 중인 방 — 2-3 교실.
//
// 판이 도는 동안 2-3 교실은 문이 닫혀 있고 「공사 중」 팻말이 붙는다. 페이즈든
// 자유 시간이든 **아무 때도 못 들어간다.** 감독관이 「열기」를 누르면(게임 문서
// plazaOpen) 그때부터 드나든다. 시작 전 로비는 이 교실에 모이므로 막지 않는다.
//
// 이미 안에 있던 사람은 나갈 수 있다 — 들어가는 것만 막는다.
import type { TileId } from './board'

export const CONSTRUCTION_ROOM: TileId = 'centralPlaza'
export const CONSTRUCTION_WHY = '공사 중이다.'

/** 그 방이 지금 공사 중이라 못 들어가는가 */
export function isUnderConstruction(
  game: { phase?: string; plazaOpen?: boolean | null } | null | undefined,
  tileId: TileId | string | null | undefined,
): boolean {
  return tileId === CONSTRUCTION_ROOM && game?.phase === 'running' && game.plazaOpen !== true
}
