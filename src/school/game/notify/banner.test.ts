import { describe, expect, it } from 'vitest'

import type { NoteItem } from '../../../../shared/notify/notifyData'
import { freshNotes, isBig, stack, unreadOf } from './banner'

const n = (id: string, atMs: number, type: NoteItem['type'] = 'notice'): NoteItem => ({ id, type, text: id, link: 'map', atMs })

describe('배너', () => {
  it('지난번 뒤로 온 것만, 오래된 것부터', () => {
    expect(freshNotes([n('c', 30), n('b', 20), n('a', 10)], 15).map((x) => x.id)).toEqual(['b', 'c'])
  })
  it('둘까지만 쌓고 오래된 것부터 내린다', () => {
    expect(stack([n('a', 1), n('b', 2)], [n('c', 3)]).map((x) => x.id)).toEqual(['b', 'c'])
  })
  it('같은 줄(묶인 알림)은 바꿔 끼운다', () => {
    const out = stack([n('burst', 1)], [{ ...n('burst', 5), text: '알림 3건' }])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('알림 3건')
  })
  it('페이즈만 크게', () => {
    expect(isBig(n('p', 1, 'phaseStart'))).toBe(true)
    expect(isBig(n('t', 1, 'tag'))).toBe(false)
  })
  it('안 읽은 수', () => {
    expect(unreadOf([n('a', 10), n('b', 20)], 15)).toBe(1)
    expect(unreadOf(undefined, undefined)).toBe(0)
  })
})
