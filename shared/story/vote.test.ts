// 투표 화면 문구 — 날마다 한 줄씩 늘어난다.
import { describe, expect, it } from 'vitest'

import { VOTE_MURMURS, murmursUpTo } from './vote'

describe('회색 글씨', () => {
  it('날마다 한 줄씩 늘어난다', () => {
    expect(murmursUpTo(1)).toHaveLength(1)
    expect(murmursUpTo(3)).toHaveLength(3)
    expect(murmursUpTo(5)).toHaveLength(5)
  })

  it('앞 줄은 그대로 남는다 — 쌓이는 것이 요점이다', () => {
    expect(murmursUpTo(3).slice(0, 2)).toEqual(murmursUpTo(2))
  })

  it('날짜가 넘쳐도 있는 만큼만', () => {
    expect(murmursUpTo(99)).toHaveLength(VOTE_MURMURS.length)
    expect(murmursUpTo(0)).toEqual([])
  })
})
