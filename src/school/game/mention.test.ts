import { describe, expect, it } from 'vitest'

import { insertMention, mentionPicks, mentionQuery } from './mention'

describe('무전 태그', () => {
  it('줄 끝의 @ 만 본다', () => {
    expect(mentionQuery('@')).toBe('')
    expect(mentionQuery('창고로 와 @가')).toBe('가')
    expect(mentionQuery('메일@주소')).toBeNull()
    expect(mentionQuery('@가온 와')).toBeNull()
  })
  it('나는 빼고 앞글자로 거른다', () => {
    expect(mentionPicks(['가온', '가람', '나래'], '가', '가온')).toEqual(['가람'])
    expect(mentionPicks(['가온', '나래'], '', '나래')).toEqual(['가온'])
  })
  it('고르면 이름을 끼우고 한 칸 띄운다', () => {
    expect(insertMention('창고로 @가', '가람')).toBe('창고로 @가람 ')
  })
})
