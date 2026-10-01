// 체류·동석·방문 — 시간을 제대로 세는지, 걷는 말을 빼는지 본다.
//
// 단짝·목격자·편지가 전부 이 계산 위에 서 있다.
import { describe, expect, it } from 'vitest'
import {
  coStaySeconds,
  tileAt,
  visitedTiles,
  type Interval } from './presence'
import type { TileId } from './board'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const HOUR = 3600

/** 구간 하나. 끝이 없으면 아직 거기 있는 것이다. */
function iv(
  playerId: string,
  tileId: TileId | null,
  from: string,
  to: string | null,
  state: Interval['state'] = 'standing',
): Interval {
  return { playerId, tileId, startMs: seoul(from), endMs: to === null ? null : seoul(to), state }
}

const all = { from: seoul('2026-03-02T00:00:00'), to: seoul('2026-03-04T00:00:00') }

describe('동석', () => {
  it('겹친 만큼만 센다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
      iv('b', 'library', '2026-03-02T11:00:00', '2026-03-02T14:00:00'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(1 * HOUR)
  })

  it('칸이 다르면 세지 않는다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
      iv('b', 'gym', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(0)
  })

  it('칸을 옮겨 다니며 만난 시간을 모두 더한다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T11:00:00'),
      iv('a', 'gym', '2026-03-02T11:00:00', '2026-03-02T13:00:00'),
      iv('b', 'library', '2026-03-02T10:30:00', '2026-03-02T11:00:00'),
      iv('b', 'gym', '2026-03-02T12:00:00', '2026-03-02T13:00:00'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(1.5 * HOUR)
  })

  it('밤을 걸쳐도 여기서도 그대로 센다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T23:00:00', '2026-03-03T09:00:00'),
      iv('b', 'library', '2026-03-02T23:00:00', '2026-03-03T09:00:00'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(10 * HOUR)
  })

  it('한쪽이 걷는 중이면 만난 것이 아니다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
      iv('b', null, '2026-03-02T10:00:00', '2026-03-02T12:00:00', 'walking'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(0)
  })

  it('순서를 바꿔도 같다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
      iv('b', 'library', '2026-03-02T11:00:00', '2026-03-02T14:00:00'),
    ]
    expect(coStaySeconds(log, 'b', 'a', all.from, all.to)).toBe(
      coStaySeconds(log, 'a', 'b', all.from, all.to),
    )
  })
})

describe('방문', () => {
  it('머문 시간과 상관없이 발 디딘 칸을 모은다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T10:00:01'),
      iv('a', 'gym', '2026-03-02T11:00:00', '2026-03-02T13:00:00'),
      iv('a', null, '2026-03-02T13:00:00', '2026-03-02T13:10:00', 'walking'),
    ]
    expect([...visitedTiles(log, 'a')].sort()).toEqual(['gym', 'library'])
  })

  it('소등 중에 거친 칸도 들어간다', () => {
    const log = [iv('a', 'rooftop', '2026-03-03T02:00:00', '2026-03-03T03:00:00')]
    expect(visitedTiles(log, 'a').has('rooftop')).toBe(true)
  })
})

describe('그 순간 누가 어디에', () => {
  const log = [
    iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
    iv('b', 'library', '2026-03-02T11:00:00', null, 'asleep'),
    iv('c', null, '2026-03-02T11:00:00', '2026-03-02T12:00:00', 'walking'),
  ]

  it('그 사람이 선 칸을 짚는다', () => {
    expect(tileAt(log, 'a', seoul('2026-03-02T11:00:00'))).toBe('library')
    expect(tileAt(log, 'c', seoul('2026-03-02T11:30:00'))).toBe(null)
    expect(tileAt(log, 'a', seoul('2026-03-02T13:00:00'))).toBe(null)
  })
})

