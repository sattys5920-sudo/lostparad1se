// 보관함 — 남의 1:1 고백이 목록에 섞이지 않는지.
//
// 여기가 새면 제목 한 줄만으로도 누가 누구에게 털어놓았는지 드러난다.
import { describe, expect, it } from 'vitest'
import { buildArchive, canSeeConfession, canSeeMemory, itemsOf, unreadCount, type BuildInput } from './archive'

const base: Omit<BuildInput, 'viewerId' | 'viewerTeam'> = {
  records: [
    { day: 1, atMs: 100 },
    { day: 2, atMs: 200 },
  ],
  unreadDays: [2],
  confessions: [
    { id: 'c1', speakerId: 'p1', scope: 'class', listenerIds: ['p2', 'p3'], text: '전체', atMs: 300 },
    { id: 'c2', speakerId: 'p2', scope: 'private', listenerIds: ['p3'], text: '둘만', atMs: 400 },
  ],
  memories: [
    { tileId: 'library', team: 'A', atMs: 500 },
    { tileId: 'gym', team: 'B', atMs: 600 },
  ],
  sights: [{ ownerId: 'p3', atMs: 700 }],
  tileName: (id) => id,
  nameOf: (id) => id.toUpperCase(),
}

const build = (viewerId: string, viewerTeam: 'A' | 'B' | 'C' | 'D', over = false) =>
  buildArchive({ ...base, viewerId, viewerTeam, over })

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

describe('고백 탭', () => {
  it('전체 털어놓기는 전원 보관함에 들어간다', () => {
    for (const who of ['p1', 'p2', 'p9']) {
      const ids = itemsOf(build(who, 'A'), 'confession').map((i) => i.id)
      expect(ids, who).toContain('confession:c1')
    }
  })

  it('1:1은 들은 사람 보관함에만 들어간다', () => {
    expect(itemsOf(build('p3', 'A'), 'confession').map((i) => i.id)).toContain('confession:c2')
  })

  it('말한 사람 보관함에도 남는다', () => {
    expect(itemsOf(build('p2', 'A'), 'confession').map((i) => i.id)).toContain('confession:c2')
  })

  it('상관없는 사람 보관함에는 제목도 없다', () => {
    const items = build('p9', 'A')
    const text = JSON.stringify(items)
    expect(text).not.toContain('c2')
    expect(text).not.toContain('둘만')
  })

  it('1:1로 들은 것은 표시가 다르다', () => {
    const item = itemsOf(build('p3', 'A'), 'confession').find((i) => i.id === 'confession:c2')
    expect(item?.private).toBe(true)
    const klass = itemsOf(build('p3', 'A'), 'confession').find((i) => i.id === 'confession:c1')
    expect(klass?.private).toBe(false)
  })

  it('내 고백은 「나」로 뜬다', () => {
    const item = itemsOf(build('p1', 'A'), 'confession').find((i) => i.id === 'confession:c1')
    expect(item?.title.startsWith('나')).toBe(true)
  })
})

describe('기억 탭', () => {
  it('우리 팀이 연 것만 보인다', () => {
    expect(itemsOf(build('p1', 'A'), 'memory').map((i) => i.tileId)).toContain('library')
    expect(itemsOf(build('p1', 'A'), 'memory').map((i) => i.tileId)).not.toContain('gym')
  })

  it('끝나면 전부 열린다', () => {
    const tiles = itemsOf(build('p1', 'A', true), 'memory').map((i) => i.tileId)
    expect(tiles).toContain('library')
    expect(tiles).toContain('gym')
  })

  it('A의 시선은 본인 것만이다', () => {
    expect(itemsOf(build('p3', 'A'), 'memory').map((i) => i.id)).toContain('sight:mine')
    expect(itemsOf(build('p1', 'A'), 'memory').map((i) => i.id)).not.toContain('sight:mine')
  })
})

describe('가시성 규칙', () => {
  it('전체 고백은 누구나', () => {
    const c = base.confessions[0]
    expect(canSeeConfession(c, 'p9')).toBe(true)
  })

  it('1:1은 둘만', () => {
    const c = base.confessions[1]
    expect(canSeeConfession(c, 'p2')).toBe(true)
    expect(canSeeConfession(c, 'p3')).toBe(true)
    expect(canSeeConfession(c, 'p9')).toBe(false)
  })

  it('기억은 연 팀만, 끝나면 전원', () => {
    const m = base.memories[0]
    expect(canSeeMemory(m, 'A', false)).toBe(true)
    expect(canSeeMemory(m, 'B', false)).toBe(false)
    expect(canSeeMemory(m, 'B', true)).toBe(true)
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
