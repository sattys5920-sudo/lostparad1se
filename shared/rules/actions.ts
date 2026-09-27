// 행동을 걸 수 있는가 — 몸 상태와 땅 주인.
//
// **생산·공부는 없앴다.** 페이즈에 토큰을 쓰는 길은 점령(이동)과
// 연구 둘뿐이고, 그 둘은 occupy.ts 가 센다. 여기 남은 것은 어느
// 행동에나 붙는 두 가지다 — 발이 묶였는지, 그리고 그 칸이 누구 것인지.
//
// 토큰은 여기서 빼지 않는다(tokens.ts). 서버가 검사와 빼기를 한
// 트랜잭션으로 묶는다.
import { type TeamId } from './v2'
import { type TileId } from './board'
import { type TileState } from './resources'

export interface ActionGate {
  /** 발이 묶여 있는가. */
  bound: boolean
  /** 잠들어 있어도 행동은 못 한다 — 앱이 닫혀 있다는 뜻이다. */
  asleep: boolean
}

export type GateRefusal = 'bound' | 'asleep'

export function checkGate(gate: ActionGate): { ok: boolean; reason: GateRefusal | null } {
  if (gate.bound) return { ok: false, reason: 'bound' }
  if (gate.asleep) return { ok: false, reason: 'asleep' }
  return { ok: true, reason: null }
}

/** 그 칸이 우리 것인지 보는 짧은 도우미. 시험과 서버가 같이 쓴다. */
export function ownerLookup(tiles: readonly TileState[]): (tileId: TileId) => TeamId | null {
  const map = new Map(tiles.map((t) => [t.tileId, t.ownerTeam]))
  return (tileId) => map.get(tileId) ?? null
}
