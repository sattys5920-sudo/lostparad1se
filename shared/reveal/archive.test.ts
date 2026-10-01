// 보관함 — 기록 탭.
import { describe, expect, it } from 'vitest'
import { buildArchive, itemsOf, unreadCount, type BuildInput } from './archive'

const base: Omit<BuildInput, 'viewerId' | 'viewerTeam'> = {
  records: [
    { day: 1, atMs: 100 },
    { day: 2, atMs: 200 },
  ],
  unreadDays: [2],
}

const build = (viewerId: string, viewerTeam: 'A' | 'B' | 'C' | 'D') => buildArchive({ ...base, viewerId, viewerTeam })

describe('기록 탭', () => {
  it('공개된 날이 날짜순으로 쌓인다', () => {
    const out = itemsOf(build('p9', 'C'), 'record')
    expect(out.map((i) => i.title)).toEqual(['DAY 1', 'DAY 2'])
  })

  it('건너뛴 날은 읽지 않음으로 남는다', () => {
    const out = itemsOf(build('p9', 'C'), 'record')
    expect(out.find((i) => i.day === 2)?.unread).toBe(true)
    expect(out.find((i) => i.day === 1)?.unread).toBe(false)
    expect(unreadCount(out)).toBe(1)
  })

  it('전원 공통이다', () => {
    expect(itemsOf(build('p1', 'A'), 'record')).toHaveLength(2)
    expect(itemsOf(build('p9', 'D'), 'record')).toHaveLength(2)
  })
})

describe('정렬', () => {
  it('시간순이다', () => {
    const items = build('p3', 'A')
    for (let i = 1; i < items.length; i++) {
      expect(items[i].atMs).toBeGreaterThanOrEqual(items[i - 1].atMs)
    }
  })
})
