// 나흘.
import { describe, expect, it } from 'vitest'

import { DAYS } from './days'
import { TOTAL_DAYS } from '../rules/v2'

describe('나흘', () => {
  it('하루부터 나흘까지다', () => {
    expect(DAYS).toEqual([1, 2, 3, 4])
    expect(DAYS.length).toBe(TOTAL_DAYS)
  })
})
