import { describe, expect, it } from 'vitest'

import { cleanAnswers, gradeSheet, guessToRole, scoreOf } from './answers'

describe('답안지 채점', () => {
  it('열네 문항 — 다 맞히면 100, 하나 맞히면 7.1', () => {
    expect(scoreOf(14, 14)).toBe(100)
    expect(scoreOf(1, 14)).toBe(7.1)
    expect(scoreOf(7, 14)).toBe(50)
    expect(scoreOf(0, 14)).toBe(0)
  })

  it('정답과 맞춰 센다 — 빈칸 · 모르는 역할은 틀린 것', () => {
    const key = { a: 'classlead', b: 'model', c: 'crush' } as const
    const g = gradeSheet({ a: 'classlead', b: 'crush', c: '' }, key)
    expect(g).toEqual({ correct: 1, total: 3, score: 33.3 })
  })

  it('명단에 없는 사람과 없는 역할은 버린다', () => {
    expect(cleanAnswers({ a: 'classlead', z: 'model', b: 'nope' }, ['a', 'b'])).toEqual({ a: 'classlead' })
    expect(cleanAnswers(null, ['a'])).toEqual({})
  })
})

describe('메모에 적은 역할 짐작', () => {
  it('역할 이름과 같으면 id 로 — 띄어쓰기는 안 본다', () => {
    expect(guessToRole('반장')).toBe('classlead')
    expect(guessToRole(' 반 장 ')).toBe('classlead')
  })

  it('전에 고르던 때 저장된 id 도 받는다', () => {
    expect(guessToRole('classlead')).toBe('classlead')
  })

  it('이름이 아닌 글은 칸을 채우지 않는다', () => {
    expect(guessToRole('반장 같음?')).toBeNull()
    expect(guessToRole('')).toBeNull()
    expect(guessToRole(undefined)).toBeNull()
  })
})
