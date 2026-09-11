// 회고 — 역할을 내려놓은 사람만 쓰고, 익명이 진짜 익명인지.
import { describe, expect, it } from 'vitest'
import { boardFor, canPost, hasNotice, newPost, RETRO_MAX, RETRO_TEXT, type RetroPost } from './retro'

const posts: RetroPost[] = [
  { id: 'r1', authorId: 'p1', anonymous: false, text: '재밌었어요', atMs: 200 },
  // 익명 글에는 authorId 칸이 아예 없다
  { id: 'r2', anonymous: true, text: '미안했어요', atMs: 100 },
]
const nameOf = (id: string) => ({ p1: '한겨울', p2: '서리' })[id] ?? id

describe('쓸 수 있는가', () => {
  it('역할을 내려놓아야 쓴다', () => {
    const out = canPost({ retired: false, text: '한 줄' })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('notRetired')
  })

  it('내려놓았으면 쓴다', () => {
    expect(canPost({ retired: true, text: '한 줄' }).ok).toBe(true)
  })

  it('빈 줄은 막는다', () => {
    expect(canPost({ retired: true, text: '   ' }).reason).toBe('empty')
  })

  it('너무 길면 막는다', () => {
    expect(canPost({ retired: true, text: 'ㄱ'.repeat(RETRO_MAX + 1) }).reason).toBe('tooLong')
  })
})

describe('게시판', () => {
  it('시간순이다', () => {
    expect(boardFor(posts, 'p1', nameOf).map((p) => p.id)).toEqual(['r2', 'r1'])
  })

  it('실명이 기본이다', () => {
    expect(boardFor(posts, 'p9', nameOf).find((p) => p.id === 'r1')?.name).toBe('한겨울')
  })

  it('익명 글에는 이름이 없다', () => {
    const view = boardFor(posts, 'p9', nameOf)
    expect(view.find((p) => p.id === 'r2')?.name).toBe('익명')
  })

  it('익명 글에 쓴 사람 아이디가 담기지 않는다', () => {
    // 화면에서 이름만 가리면 개발자도구로 누군지 보인다
    const text = JSON.stringify(boardFor(posts, 'p9', nameOf))
    expect(text).not.toContain('authorId')
    expect(text).not.toContain('p2')
    expect(text).not.toContain('서리')
  })

  it('실명 글은 본인에게 자기 글로 뜬다', () => {
    expect(boardFor(posts, 'p1', nameOf).find((p) => p.id === 'r1')?.mine).toBe(true)
    expect(boardFor(posts, 'p9', nameOf).find((p) => p.id === 'r1')?.mine).toBe(false)
  })

  it('익명 글은 본인에게도 자기 글로 뜨지 않는다', () => {
    // 표시해 주려면 어딘가에 아이디를 남겨야 하고, 남기는 순간 익명이 아니다
    const view = boardFor(posts, 'p2', nameOf).find((p) => p.id === 'r2')
    expect(view?.mine).toBe(false)
    expect(view?.name).toBe('익명')
  })
})

describe('운영자 안내', () => {
  it('둘 다 비면 띄우지 않는다', () => {
    expect(hasNotice(null)).toBe(false)
    expect(hasNotice({ when: '', link: '' })).toBe(false)
    expect(hasNotice({ when: '  ', link: '  ' })).toBe(false)
  })

  it('하나라도 있으면 띄운다', () => {
    expect(hasNotice({ when: '토요일 저녁 8시', link: '' })).toBe(true)
    expect(hasNotice({ when: '', link: 'https://example.com' })).toBe(true)
  })
})

describe('문구', () => {
  it('데이터 파일에 있고 비어 있지 않다', () => {
    for (const [key, value] of Object.entries(RETRO_TEXT)) {
      expect(value.length, key).toBeGreaterThan(0)
    }
  })

  it('기준 문서의 문장 그대로다', () => {
    expect(RETRO_TEXT.headline).toBe(
      '닷새 동안의 역할은 여기까지입니다. 여기부터는 연기가 아닌 우리입니다.',
    )
  })
})

describe('저장할 모양', () => {
  it('실명이면 아이디를 담는다', () => {
    const p = newPost({ id: 'x', authorId: 'p1', anonymous: false, text: ' 한 줄 ', atMs: 1 })
    expect(p.authorId).toBe('p1')
    expect(p.text).toBe('한 줄')
  })

  it('익명이면 아이디 칸이 아예 없다', () => {
    const p = newPost({ id: 'x', authorId: 'p1', anonymous: true, text: '한 줄', atMs: 1 })
    expect('authorId' in p).toBe(false)
    expect(JSON.stringify(p)).not.toContain('p1')
  })
})
