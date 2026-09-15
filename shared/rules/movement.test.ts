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

  // 교무실(1층 서쪽) → 급식실 → 체육관 → 강당 → 운동장. 복도를 따라 네 걸음
  it('같은 층을 가로지르면 네 걸음이다', () => {
    expect(walk('baseA', 'playground', '2026-03-02T10:00:00').path).toHaveLength(4)
  })

  it('계단으로 층을 넘는 것도 한 걸음씩이다', () => {
    // 교무실 → 1층 서쪽 계단 → 2층 서쪽 계단 → 2-3 교실
    expect(walk('baseA', 'centralPlaza', '2026-03-02T10:00:00').path).toEqual([
      'stair_f1_w',
      'stair_f2_w',
      'centralPlaza',
    ])
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

  it('칸마다 도착 시각이 찍힌다', () => {
    const w = walk('baseA', 'playground', '2026-03-02T10:00:00')
    const out = arrivals(w)
    expect(out).toHaveLength(4)
    expect(out[0].atMs).toBe(seoul('2026-03-02T10:15:00'))
    expect(out[3].atMs).toBe(seoul('2026-03-02T11:00:00'))
    expect(walkEndsAtMs(w)).toBe(seoul('2026-03-02T11:00:00'))
  })

  // 예전에는 소등에 걸려 문 앞에서 밤을 샜다. 이제는 그냥 걷는다
  it('자정을 넘어도 멈추지 않는다', () => {
    // 23:50 출발, 네 칸이면 한 시간 → 다음 날 00:50 도착
    const w = walk('baseA', 'playground', '2026-03-02T23:50:00')
    expect(walkEndsAtMs(w)).toBe(seoul('2026-03-03T00:50:00'))
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

  it('다음 칸만 알려 준다 — 목적지가 아니다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T10:20:00'))
    expect(p.tileId).toBe(null)
    expect(p.toTile).toBe(w.path[1])
    expect(p.toTile).not.toBe('centralPlaza')
  })

  it('도착하면 그 칸에 선다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T11:00:00'))
    expect(p.tileId).toBe('centralPlaza')
    expect(p.done).toBe(true)
    expect(p.toTile).toBe(null)
  })

  it('한 걸음마다 떠난 칸이 바뀐다', () => {
    const p = walkPositionAt(w, seoul('2026-03-02T10:16:00'))
    expect(p.fromTile).toBe(w.path[0])
  })
})

describe('등교 예약', () => {
  it('두 칸까지다', () => {
    expect(checkCommutePlan('baseA', 'cafeteria').ok).toBe(true)
    expect(checkCommutePlan('baseA', 'annex').ok).toBe(true)
    const far = checkCommutePlan('baseA', 'classroom')
    expect(far.ok).toBe(false)
    expect(far.reason).toBe('tooFar')
  })

  it('하루가 열릴 때 걸음으로 바뀐다', () => {
    const dawn = seoul('2026-03-03T08:00:00')
    const w = releaseCommute({ playerId: 'a1', to: 'annex' }, 'baseA', dawn)
    expect(w?.startedAtMs).toBe(dawn)
    expect(walkEndsAtMs(w as Walk)).toBe(dawn + 30 * MIN)
  })

  it('그 사이에 말이 옮겨져 두 칸을 넘으면 취소된다', () => {
    const w = releaseCommute({ playerId: 'a1', to: 'classroom' }, 'baseA', 0)
    expect(w).toBe(null)
  })
})
