// 눈치 게임 — 1부터 차례로 외친다. 둘이 한꺼번에 외치면 둘 다 탈락,
// 끝까지 못 외친 한 사람도 탈락.
//
// n 명이면 n−1 까지 외친다. 마지막 남은 사람이 진다. 누가 외치자마자
// NUNCHI_SAME_MS 안에 다른 사람이 외치면 「겹쳤다」 — 그 둘이 진다.
//
// **서버에 닿은 순서와 시각으로 가른다.** 외친 숫자를 화면이 정하지 않는다
// — 「다음 숫자」를 누르면 서버가 몇 번째인지 매긴다.
import type { ArcadeOutcome } from './arcade'

/** 이 안에 둘이 외치면 겹친 것이다. 손과 망이 느린 만큼 넉넉히. */
export const NUNCHI_SAME_MS = 600
/** 판 끝. 이때까지 못 외친 사람은 다 진다. */
export const NUNCHI_LIMIT_MS = 20_000

export interface NunchiCall {
  id: string
  n: number
  atMs: number
}

export interface NunchiState {
  calls: NunchiCall[]
  /** 겹친 두 사람. 겹치면 판이 끝난다. */
  clash: string[] | null
  /** n−1 까지 다 외친 때 + 겹침 창. 이때 지나면 판이 닫힌다. */
  closeAtMs: number | null
}

export const nunchiNew = (): NunchiState => ({ calls: [], clash: null, closeAtMs: null })

export type NunchiRefusal = 'early' | 'over' | 'twice'
export const NUNCHI_NO: Record<NunchiRefusal, string> = {
  early: '아직 시작 전이다',
  over: '이미 끝났다',
  twice: '벌써 외쳤다',
}

export function nunchiCall(
  s: NunchiState,
  id: string,
  nowMs: number,
  startAtMs: number,
  players: number,
): { ok: true; s: NunchiState } | { ok: false; why: NunchiRefusal } {
  if (nowMs < startAtMs) return { ok: false, why: 'early' }
  if (nunchiOver(s, nowMs, startAtMs)) return { ok: false, why: 'over' }
  if (s.calls.some((c) => c.id === id)) return { ok: false, why: 'twice' }
  const last = s.calls.at(-1)
  if (last && nowMs - last.atMs < NUNCHI_SAME_MS) {
    // 같은 숫자를 둘이 외쳤다
    return { ok: true, s: { ...s, calls: [...s.calls, { id, n: last.n, atMs: nowMs }], clash: [last.id, id] } }
  }
  const calls = [...s.calls, { id, n: s.calls.length + 1, atMs: nowMs }]
  const closeAtMs = calls.length >= players - 1 ? nowMs + NUNCHI_SAME_MS : null
  return { ok: true, s: { ...s, calls, closeAtMs } }
}

export const nunchiOver = (s: NunchiState, nowMs: number, startAtMs: number): boolean =>
  s.clash !== null || (s.closeAtMs !== null && nowMs >= s.closeAtMs) || nowMs >= startAtMs + NUNCHI_LIMIT_MS

/** 끝났으면 사람마다 이김·짐. 안 끝났으면 null. */
export function nunchiResult(
  s: NunchiState,
  nowMs: number,
  startAtMs: number,
  ids: readonly string[],
): Record<string, ArcadeOutcome> | null {
  if (!nunchiOver(s, nowMs, startAtMs)) return null
  const called = new Set(s.calls.map((c) => c.id))
  const out: Record<string, ArcadeOutcome> = {}
  for (const id of ids) {
    const lose = s.clash ? s.clash.includes(id) : !called.has(id)
    out[id] = lose ? 'lose' : 'win'
  }
  return out
}
