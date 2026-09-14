// 문제 종이 — 채점 정규화.
import { describe, expect, it } from 'vitest'

import { QUIZ_MIN_BANK, bankIsThin, isCorrect, normalizeAnswer } from './quiz'

describe('단답형 정규화', () => {
  it('앞뒤 공백을 뗀다', () => {
    expect(normalizeAnswer('  사과 ')).toBe('사과')
  })

  it('가운데 연속 공백은 하나로', () => {
    expect(normalizeAnswer('빨간   사과')).toBe('빨간 사과')
  })

  it('영문 대소문자를 무시한다', () => {
    expect(normalizeAnswer('Apple')).toBe(normalizeAnswer('aPPle'))
  })

  it('한글 자모를 합쳐 놓는다', () => {
    // 자판에 따라 「사과」가 자모로 들어오기도 한다. 눈으로는 똑같은데
    // 합쳐 두지 않으면 다른 글자열이라 틀렸다고 나온다
    const decomposed = '사과'.normalize('NFD')
    expect(decomposed).not.toBe('사과')
    expect(normalizeAnswer(decomposed)).toBe('사과')
  })
})

describe('채점', () => {
  it('정답을 여러 개 둘 수 있다', () => {
    const answers = ['사과', 'apple', '능금']
    expect(isCorrect('  APPLE ', answers)).toBe(true)
    expect(isCorrect('능금', answers)).toBe(true)
    expect(isCorrect('배', answers)).toBe(false)
  })

  it('빈 답은 틀린 것이다', () => {
    // 정답 목록에 실수로 빈 줄이 들어가 있어도 빈칸 제출이 통과하면 안 된다
    expect(isCorrect('', ['사과', ''])).toBe(false)
    expect(isCorrect('   ', ['사과', ''])).toBe(false)
  })

  it('정답이 하나도 없으면 무엇을 내도 틀린다', () => {
    expect(isCorrect('사과', [])).toBe(false)
  })
})

describe('문제 은행', () => {
  it('권장치보다 적으면 경고한다', () => {
    expect(bankIsThin(QUIZ_MIN_BANK - 1)).toBe(true)
    expect(bankIsThin(QUIZ_MIN_BANK)).toBe(false)
    expect(bankIsThin(0)).toBe(true)
  })
})
