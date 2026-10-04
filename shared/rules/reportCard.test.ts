import { describe, expect, it } from 'vitest'
import { rankRows } from './reportCard'

describe('성적통지표 석차', () => {
  it('높은 점수부터, 같은 점수는 같은 석차', () => {
    const out = rankRows([
      { name: '다', score: 87 },
      { name: '가', score: 95 },
      { name: '나', score: 87 },
      { name: '라', score: 80 },
    ])
    expect(out.map((r) => [r.name, r.rank])).toEqual([
      ['가', 1],
      ['나', 2],
      ['다', 2],
      ['라', 4],
    ])
  })
})
