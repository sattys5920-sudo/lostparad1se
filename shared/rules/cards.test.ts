// 카드 — 손패 한도와 지속 시간의 기준.
import { describe, expect, it } from 'vitest'
import { ACCORD_GAIN, cardEffect, checkPlay, drawCard, playCard } from './cards'
import { CARDS, CARD_ACCORD_MONEY, HAND_LIMIT, type CardKind } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const NOW = seoul('2026-03-02T10:00:00')
const HOUR = 3_600_000

const play = (kind: CardKind, over: Record<string, unknown> = {}) =>
  cardEffect({ kind, team: 'A', nowMs: NOW, realNowMs: NOW, ...over })

describe('뽑기', () => {
  it('열두 장 중 하나가 나온다', () => {
    const kinds = new Set<CardKind>()
    for (let i = 0; i < 120; i++) kinds.add(drawCard([], i / 120).drawn)
    expect(kinds.size).toBe(CARDS.length)
  })

  it('손패가 차 있으면 그대로 버려진다', () => {
    const full = CARDS.slice(0, HAND_LIMIT).map((c) => c.kind)
    const out = drawCard(full, 0.5)
    expect(out.discarded).toBe(true)
    expect(out.hand).toHaveLength(HAND_LIMIT)
  })

  it('자리가 있으면 들어온다', () => {
    const out = drawCard(['ambush'], 0)
    expect(out.discarded).toBe(false)
    expect(out.hand).toHaveLength(2)
  })

  it('쓰면 한 장만 빠진다', () => {
    expect(playCard(['ambush', 'ambush', 'windfall'], 'ambush')).toEqual(['ambush', 'windfall'])
  })

  it('없는 카드는 못 쓴다', () => {
    expect(playCard(['ambush'], 'windfall')).toBe(null)
  })
})

describe('고를 것', () => {
  it('손에 없으면 막는다', () => {
    expect(checkPlay([], { kind: 'windfall', team: 'A', nowMs: NOW, realNowMs: NOW }).reason).toBe('notInHand')
  })

  it('헛소문은 팀을 골라야 한다', () => {
    expect(checkPlay(['falseRumor'], { kind: 'falseRumor', team: 'A', nowMs: NOW, realNowMs: NOW }).reason).toBe('needsTeam')
  })

  it('우리 팀에는 못 건다', () => {
    const out = checkPlay(['falseRumor'], {
      kind: 'falseRumor', team: 'A', nowMs: NOW, realNowMs: NOW, targetTeam: 'A',
    })
    expect(out.reason).toBe('ownTeam')
  })

  it('봉쇄는 칸을, 잠복은 말을 골라야 한다', () => {
    expect(checkPlay(['blockade'], { kind: 'blockade', team: 'A', nowMs: NOW, realNowMs: NOW }).reason).toBe('needsTile')
    expect(checkPlay(['ambushHide'], { kind: 'ambushHide', team: 'A', nowMs: NOW, realNowMs: NOW }).reason).toBe('needsPawn')
  })

  it('고를 것이 없는 카드는 그냥 쓴다', () => {
    expect(checkPlay(['windfall'], { kind: 'windfall', team: 'A', nowMs: NOW, realNowMs: NOW }).ok).toBe(true)
  })
})

describe('카드가 하는 일', () => {
  it('특별 매출과 벼락치기는 자원을 준다', () => {
    expect(play('windfall').gain).toEqual({ money: 4 })
    expect(play('cramming').gain).toEqual({ knowledge: 4 })
  })

  it('헛소문은 대상 팀 영향력을 2 깎는다', () => {
    expect(play('falseRumor', { targetTeam: 'B' }).influenceHit).toEqual({ team: 'B', amount: 2 })
  })

  it('보강은 실제 시계로 24시간이다', () => {
    const t = play('reinforce', { targetTile: 'classroom' }).tile
    expect(t?.reinforce).toBe(2)
    expect(t?.untilRealMs).toBe(NOW + 24 * HOUR)
  })

  it('봉쇄는 게임 시계로 여섯 시간이다 — 소등을 건너뛴다', () => {
    const late = cardEffect({
      kind: 'blockade', team: 'A', nowMs: seoul('2026-03-02T22:00:00'),
      realNowMs: 0, targetTile: 'library',
    })
    expect(late.tile?.blockedUntilMs).toBe(seoul('2026-03-03T12:00:00'))
  })

  it('잠복도 게임 시계로 여섯 시간이다', () => {
    const out = play('ambushHide', { targetPawn: 'a1' })
    expect(out.pawn?.hiddenUntilMs).toBe(seoul('2026-03-02T16:00:00'))
  })

  it('강행군은 두 칸까지다', () => {
    expect(play('forcedMarch', { targetPawn: 'a1' }).pawn?.jumpTiles).toBe(2)
  })

  it('밀서는 실제 시계로 한 시간이다', () => {
    expect(play('secretLetter').roomUntilRealMs).toBe(NOW + HOUR)
  })

  it('기습·급조·협정서는 다음 한 번을 위해 표시만 남긴다', () => {
    expect(play('ambush').pending).toBe('ambush')
    expect(play('quickBuild').pending).toBe('quickBuild')
    expect(play('accord').pending).toBe('accord')
  })

  it('가짜 깃발은 가짜라는 표시를 남긴다', () => {
    const out = play('fakeFlag', { targetTile: 'library' })
    expect(out.fakeFlag).toBe(true)
    expect(out.tile?.tileId).toBe('library')
  })

  it('협정서 보너스는 돈 2다', () => {
    expect(ACCORD_GAIN).toEqual({ money: CARD_ACCORD_MONEY })
  })

  it('열두 장 모두 결과가 나온다', () => {
    for (const c of CARDS) {
      const out = cardEffect({
        kind: c.kind, team: 'A', nowMs: NOW, realNowMs: NOW,
        targetTeam: 'B', targetTile: 'library', targetPawn: 'a1',
      })
      expect(out.kind).toBe(c.kind)
    }
  })
})
