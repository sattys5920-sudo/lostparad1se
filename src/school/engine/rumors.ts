import type { RumorDistortion, RumorEntry } from '../types'

/**
 * 소문이 한 번 더 옮겨질 때마다 왜곡이 어느 방향으로 흔들릴 수 있는지 정의한다.
 * 진행자 화면에서만 참고용으로 보여준다 — 플레이어에게는 절대 알려주지 않는다(7번 원칙).
 */
const DRIFT: Record<RumorDistortion, RumorDistortion[]> = {
  truth: ['truth', 'truth', 'partial', 'exaggeration'],
  partial: ['partial', 'misunderstanding', 'exaggeration', 'false'],
  misunderstanding: ['misunderstanding', 'false', 'exaggeration'],
  exaggeration: ['exaggeration', 'false', 'misunderstanding'],
  false: ['false', 'false', 'misunderstanding'],
}

export function driftDistortion(previous: RumorDistortion): RumorDistortion {
  const options = DRIFT[previous]
  return options[Math.floor(Math.random() * options.length)]
}

export function createOriginRumor(text: string, tellerId: string): RumorEntry {
  return {
    id: crypto.randomUUID(),
    text,
    tellerId,
    originId: tellerId,
    parentRumorId: null,
    distortion: 'truth',
    createdAtMs: Date.now(),
  }
}

export function retellRumor(parent: RumorEntry, text: string, tellerId: string): RumorEntry {
  return {
    id: crypto.randomUUID(),
    text,
    tellerId,
    originId: parent.originId,
    parentRumorId: parent.id,
    distortion: driftDistortion(parent.distortion),
    createdAtMs: Date.now(),
  }
}

export function rumorLineage(rumors: RumorEntry[], rumorId: string): RumorEntry[] {
  const byId = new Map(rumors.map((r) => [r.id, r]))
  const chain: RumorEntry[] = []
  let current = byId.get(rumorId) ?? null
  while (current) {
    chain.unshift(current)
    current = current.parentRumorId ? (byId.get(current.parentRumorId) ?? null) : null
  }
  return chain
}
