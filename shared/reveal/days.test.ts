// 닷새.
import { describe, expect, it } from 'vitest'

import { DAYS } from './days'
import { TOTAL_DAYS } from '../rules/v2'

describe('닷새', () => {
  it('하루부터 닷새까지다', () => {
    expect(DAYS).toEqual([1, 2, 3, 4, 5])
    expect(DAYS.length).toBe(TOTAL_DAYS)
  })
})
