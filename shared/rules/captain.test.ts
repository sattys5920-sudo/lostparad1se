import { describe, expect, it } from 'vitest'

import {
  CAPTAIN_TALK_MINUTES,
  CAPTAIN_VOTE_MINUTES,
  countsDouble,
  phaseOf,
  roundAt,
  tallyCaptain,
  whyNotVote,
} from './captain'

const b = (voterId: string, targetId: string) => ({ voterId, targetId })
const three = ['a', 'b', 'c']

describe('표를 센다', () => {
  it('최다가 하나면 그 사람이다', () => {
    expect(tallyCaptain([b('a', 'b'), b('b', 'b'), b('c', 'a')], three)).toEqual({ winner: 'b', tied: false })
  })

  it('한 장만 받아도 최다면 팀장이다', () => {
    expect(tallyCaptain([b('a', 'c')], three)).toEqual({ winner: 'c', tied: false })
  })

  /** 세 명이 서로를 가리키는 1·1·1 이 가장 흔한 동점이다. */
  it('동점이면 아무도 못 된다', () => {
    expect(tallyCaptain([b('a', 'b'), b('b', 'c'), b('c', 'a')], three)).toEqual({ winner: null, tied: true })
  })

  it('한 장도 없으면 못 정한 것이다', () => {
    expect(tallyCaptain([], three)).toEqual({ winner: null, tied: true })
  })

  it('자기를 적는 것은 된다 — 맡겠다고 나서는 것도 뜻이다', () => {
    expect(tallyCaptain([b('a', 'a')], three)).toEqual({ winner: 'a', tied: false })
  })

  it('팀 밖 사람에게 준 표는 안 센다', () => {
    expect(tallyCaptain([b('a', 'z'), b('b', 'z'), b('c', 'a')], three)).toEqual({ winner: 'a', tied: false })
  })

  it('팀 밖 사람이 던진 표도 안 센다', () => {
    expect(tallyCaptain([b('z', 'b'), b('a', 'c')], three)).toEqual({ winner: 'c', tied: false })
  })
})

describe('한 차례의 창', () => {
  const v = roundAt(2, 1, 1_000_000)

  it('상의가 먼저고 투표가 뒤다', () => {
    expect(v.opensAtMs).toBe(1_000_000 + CAPTAIN_TALK_MINUTES * 60_000)
    expect(v.closesAtMs).toBe(v.opensAtMs + CAPTAIN_VOTE_MINUTES * 60_000)
  })

  it('세 토막으로 갈린다', () => {
    expect(phaseOf(v, v.opensAtMs - 1)).toBe('talking')
    expect(phaseOf(v, v.opensAtMs)).toBe('open')
    expect(phaseOf(v, v.closesAtMs - 1)).toBe('open')
    expect(phaseOf(v, v.closesAtMs)).toBe('closed')
  })
})

describe('못 던지는 까닭', () => {
  const v = roundAt(2, 1, 0)
  const at = (nowMs: number, over: Partial<Parameters<typeof whyNotVote>[0]> = {}) =>
    whyNotVote({ vote: v, settled: false, nowMs, sameTeam: true, ...over })

  it('창이 열려 있으면 던진다', () => {
    expect(at(v.opensAtMs)).toBeNull()
  })

  it('상의 중에는 못 던진다', () => {
    expect(at(0)).toBe('notOpen')
  })

  it('닫히면 못 던진다', () => {
    expect(at(v.closesAtMs)).toBe('over')
  })

  it('남의 팀에는 못 던진다', () => {
    expect(at(v.opensAtMs, { sameTeam: false })).toBe('otherTeam')
  })

  it('이미 정해졌으면 못 던진다', () => {
    expect(at(v.opensAtMs, { settled: true })).toBe('settled')
  })
})

describe('머릿수 두 배는 세 명인 팀만', () => {
  it('세 명인 팀의 팀장만 둘로 센다', () => {
    expect(countsDouble(3, true)).toBe(true)
    expect(countsDouble(4, true)).toBe(false)
    expect(countsDouble(3, false)).toBe(false)
  })
})
