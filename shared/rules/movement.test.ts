// 이동 — 자정을 넘어도 그냥 걷는지, 목적지가 새지 않는지.
import { describe, expect, it } from 'vitest'
import {
  arrivals,
  checkCommutePlan,
  planWalk,
  releaseCommute,
  stepSeconds,
  walkEndsAtMs,
  walkPositionAt,
  type Walk,
} from './movement'
import { MOVE_GAME_MIN_PER_TILE } from './v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const MIN = 60_000

const walk = (from: string, to: string, at: string, factor = 1): Walk => {
  const out = planWalk('a1', from, to, seoul(at), factor)
  if (!out.walk) throw new Error(out.reason ?? '')
  return out.walk
}

describe('경로', () => {
  it('이웃 칸은 한 걸음이다', () => {
    expect(walk('baseA', 'cafeteria', '2026-03-02T10:00:00').path).toEqual(['cafeteria'])
  })

  // **어디로 가든 한 걸음이다.** 복도가 층을 통째로 잇고 계단은
  // 문이라, 걸음을 세는 자리가 「방에 들어서는 문」 하나밖에 없다
  it('층을 가로질러도 한 걸음이다', () => {
    expect(walk('baseA', 'playground', '2026-03-02T10:00:00').path).toEqual(['playground'])
  })

  it('층을 넘어도 한 걸음이다 — 계단은 세지 않는다', () => {
    expect(walk('baseA', 'centralPlaza', '2026-03-02T10:00:00').path).toEqual(['centralPlaza'])
    expect(walk('storage', 'rooftop', '2026-03-02T10:00:00').path).toEqual(['rooftop'])
  })

  it('같은 칸은 찍을 수 없다', () => {
    const out = planWalk('a1', 'baseA', 'baseA', 0)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('sameTile')
  })

  it('없는 칸은 막는다', () => {
    expect(planWalk('a1', 'baseA', 'nowhere', 0).reason).toBe('unknownTile')
  })
})

describe('걷는 시간', () => {
  it('한 칸에 15분이다', () => {
    expect(stepSeconds()).toBe(MOVE_GAME_MIN_PER_TILE * 60)
  })

  it('체육관을 쥐면 절반이다', () => {
    expect(stepSeconds(0.5)).toBe((MOVE_GAME_MIN_PER_TILE / 2) * 60)
  })

  it('걸음마다 도착 시각이 찍힌다', () => {
    const w = walk('baseA', 'playground', '2026-03-02T10:00:00')
    const out = arrivals(w)
    expect(out).toHaveLength(1)
    expect(out[0].atMs).toBe(seoul('2026-03-02T10:15:00'))
    expect(walkEndsAtMs(w)).toBe(seoul('2026-03-02T10:15:00'))
  })

  // 예전에는 소등에 걸려 문 앞에서 밤을 샜다. 이제는 그냥 걷는다
  it('자정을 넘어도 멈추지 않는다', () => {
    const w = walk('baseA', 'playground', '2026-03-02T23:50:00')
    expect(walkEndsAtMs(w)).toBe(seoul('2026-03-03T00:05:00'))
  })

  it('새벽에 출발시켜도 그 자리에서 센다', () => {
    const w = walk('baseA', 'cafeteria', '2026-03-03T03:00:00')
    expect(walkEndsAtMs(w)).toBe(seoul('2026-03-03T03:15:00'))
  })
})

describe('걷는 도중의 위치', () => {
  const w = walk('baseA', 'centralPlaza', '2026-03-02T10:00:00')

  it('출발하는 순간 원래 칸을 떠난다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T10:00:00'))
    expect(p.tileId).toBe(null)
    expect(p.fromTile).toBe('baseA')
    expect(p.done).toBe(false)
  })

  it('걷는 동안은 갈 곳만 알려 준다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T10:10:00'))
    expect(p.tileId).toBe(null)
    expect(p.toTile).toBe('centralPlaza')
  })

  it('도착하면 그 칸에 선다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T10:15:00'))
    expect(p.tileId).toBe('centralPlaza')
    expect(p.done).toBe(true)
    expect(p.toTile).toBe(null)
  })
})

describe('등교 예약', () => {
  // **「두 칸까지」가 이제 아무것도 안 막는다.** 어디로 가든 한
  // 걸음이라 COMMUTE_MAX_TILES 에 걸릴 데가 없다. 걷기와 예약은
  // 복도가 생기기 전 규칙이라, 자유 시간 걸음(roamTo)과 겹친다 —
  // 정리할지는 아직 안 정했다
  it('어디든 예약할 수 있다 — 멀어서 막히는 데가 없다', () => {
    expect(checkCommutePlan('baseA', 'cafeteria').ok).toBe(true)
    expect(checkCommutePlan('baseA', 'classroom').ok).toBe(true)
    expect(checkCommutePlan('storage', 'rooftop').ok).toBe(true)
  })

  it('같은 칸은 예약이 아니다', () => {
    expect(checkCommutePlan('baseA', 'baseA').ok).toBe(false)
  })

  it('하루가 열릴 때 걸음으로 바뀐다', () => {
    const dawn = seoul('2026-03-03T08:00:00')
    const w = releaseCommute({ playerId: 'a1', to: 'annex' }, 'baseA', dawn)
    expect(w?.startedAtMs).toBe(dawn)
    expect(walkEndsAtMs(w as Walk)).toBe(dawn + MOVE_GAME_MIN_PER_TILE * MIN)
  })

  it('이미 그 칸에 있으면 취소된다', () => {
    expect(releaseCommute({ playerId: 'a1', to: 'baseA' }, 'baseA', 0)).toBe(null)
  })
})
