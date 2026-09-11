// 체류·동석·방문 — 소등을 빼고 세는지, 걷는 말을 빼는지 본다.
//
// 단짝·목격자·편지가 전부 이 계산 위에 서 있다. 밤새 서 있던 것을 시간으로
// 세면 아무도 움직이지 않고 미션을 깬다.
import { describe, expect, it } from 'vitest'
import {
  coStaySeconds,
  presentAt,
  stayedSeconds,
  tileAt,
  tilesStayedOver,
  visitedTiles,
  type Interval,
} from './presence'
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

const DAY = ['2026-03-02T00:00:00', '2026-03-03T00:00:00'] as const
const all = { from: seoul('2026-03-02T00:00:00'), to: seoul('2026-03-04T00:00:00') }

describe('체류', () => {
  it('한 칸에 머문 시간을 센다', () => {
    const log = [iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00')]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(2 * HOUR)
  })

  it('같은 칸에 여러 번 왔으면 더한다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T11:00:00'),
      iv('a', 'gym', '2026-03-02T11:00:00', '2026-03-02T12:00:00'),
      iv('a', 'library', '2026-03-02T12:00:00', '2026-03-02T12:30:00'),
    ]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(1.5 * HOUR)
  })

  it('소등은 빠진다', () => {
    // 23:00부터 다음 날 09:00까지 서 있어도 1시간 + 1시간이다
    const log = [iv('a', 'library', '2026-03-02T23:00:00', '2026-03-03T09:00:00')]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(2 * HOUR)
  })

  it('소등 중에만 서 있었으면 0이다', () => {
    const log = [iv('a', 'library', '2026-03-03T01:00:00', '2026-03-03T05:00:00')]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(0)
  })

  it('잠든 말도 그 자리에 있는 것으로 센다', () => {
    const log = [iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00', 'asleep')]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(2 * HOUR)
  })

  it('걷는 중은 어느 칸에도 세지 않는다', () => {
    const log = [
      iv('a', null, '2026-03-02T10:00:00', '2026-03-02T10:30:00', 'walking'),
      iv('a', 'library', '2026-03-02T10:30:00', '2026-03-02T11:00:00'),
    ]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(0.5 * HOUR)
  })

  it('아직 서 있으면 구간 끝까지 센다', () => {
    const log = [iv('a', 'library', '2026-03-02T10:00:00', null)]
    expect(stayedSeconds(log, 'a', 'library', all.from, seoul('2026-03-02T14:00:00'))).toBe(4 * HOUR)
  })

  it('구간 밖은 자른다', () => {
    const log = [iv('a', 'library', '2026-03-02T09:00:00', '2026-03-02T20:00:00')]
    const from = seoul('2026-03-02T10:00:00')
    const to = seoul('2026-03-02T12:00:00')
    expect(stayedSeconds(log, 'a', 'library', from, to)).toBe(2 * HOUR)
  })

  it('남의 구간은 세지 않는다', () => {
    const log = [iv('b', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00')]
    expect(stayedSeconds(log, 'a', 'library', all.from, all.to)).toBe(0)
  })
})

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

  it('소등은 여기서도 빠진다', () => {
    const log = [
      iv('a', 'library', '2026-03-02T23:00:00', '2026-03-03T09:00:00'),
      iv('b', 'library', '2026-03-02T23:00:00', '2026-03-03T09:00:00'),
    ]
    expect(coStaySeconds(log, 'a', 'b', all.from, all.to)).toBe(2 * HOUR)
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

  it('그 칸에 선 사람을 센다 — 잠든 사람도 포함', () => {
    expect(presentAt(log, 'library', seoul('2026-03-02T11:30:00')).sort()).toEqual(['a', 'b'])
  })

  it('끝난 구간은 그 시각에 이미 빠져 있다', () => {
    expect(presentAt(log, 'library', seoul('2026-03-02T12:00:00'))).toEqual(['b'])
  })

  it('시작 전에는 아무도 없다', () => {
    expect(presentAt(log, 'library', seoul('2026-03-02T09:00:00'))).toEqual([])
  })

  it('그 사람이 선 칸을 짚는다', () => {
    expect(tileAt(log, 'a', seoul('2026-03-02T11:00:00'))).toBe('library')
    expect(tileAt(log, 'c', seoul('2026-03-02T11:30:00'))).toBe(null)
    expect(tileAt(log, 'a', seoul('2026-03-02T13:00:00'))).toBe(null)
  })
})

describe('조건에 맞는 칸 세기', () => {
  const log = [
    iv('a', 'library', '2026-03-02T10:00:00', '2026-03-02T12:00:00'),
    iv('a', 'gym', '2026-03-02T12:00:00', '2026-03-02T12:30:00'),
    iv('a', 'garden', '2026-03-02T13:00:00', '2026-03-02T15:00:00'),
  ]

  it('기준 시간을 넘긴 칸만 남는다', () => {
    const out = tilesStayedOver(log, 'a', 1 * HOUR, all.from, all.to)
    expect([...out].sort()).toEqual(['garden', 'library'])
  })

  it('거른 뒤에 센다', () => {
    const out = tilesStayedOver(log, 'a', 1 * HOUR, all.from, all.to, (id) => id === 'garden')
    expect([...out]).toEqual(['garden'])
  })

  it('딱 맞으면 들어간다', () => {
    const out = tilesStayedOver(log, 'a', 30 * 60, all.from, all.to, (id) => id === 'gym')
    expect([...out]).toEqual(['gym'])
  })
})
