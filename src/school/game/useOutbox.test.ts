// 먼저 세운 줄이 서버 줄과 짝을 짓는 규칙, 그리고 키보드 높이 셈.
import { describe, expect, it } from 'vitest'

import { insetOf } from './useKeyboardInset'
import { settled, type Outgoing } from './useOutbox'

interface L { who: string; text: string }
const mine = (l: L, text: string) => l.who === 'me' && l.text === text
const out = (id: number, text: string, after: L | null, state: Outgoing['state'] = 'sent'): Outgoing =>
  ({ id, text, state, after, scope: null })

describe('서버 줄이 오면 먼저 세운 줄이 빠진다', () => {
  it('보낸 뒤에 온 내 줄과 짝을 짓는다', () => {
    const old: L = { who: 'x', text: '안녕' }
    const back: L = { who: 'me', text: '안녕' }
    expect(settled([old, back], [out(1, '안녕', old)], mine)).toEqual(new Set([1]))
  })

  it('남이 친 같은 말은 짝이 아니다', () => {
    const other: L = { who: 'x', text: 'ㅇㅇ' }
    expect(settled([other], [out(1, 'ㅇㅇ', null)], mine).size).toBe(0)
  })

  it('보내기 전에 있던 같은 말은 짝이 아니다 — 아까 한 「ㅋㅋ」를 이번 것으로 집으면 안 된다', () => {
    const before: L = { who: 'me', text: 'ㅋㅋ' }
    expect(settled([before], [out(1, 'ㅋㅋ', before)], mine).size).toBe(0)
  })

  it('같은 말을 두 번 보냈는데 서버 줄이 하나면 하나만 빠진다', () => {
    const a: L = { who: 'me', text: 'ㅋㅋ' }
    expect(settled([a], [out(1, 'ㅋㅋ', null), out(2, 'ㅋㅋ', null)], mine)).toEqual(new Set([1]))
  })

  it('못 보낸 줄은 짝을 짓지 않는다 — 붉게 남아 있어야 다시 누른다', () => {
    const a: L = { who: 'me', text: '가자' }
    expect(settled([a], [out(1, '가자', null, 'failed')], mine).size).toBe(0)
  })

  it('끝 줄이 잘려 나갔으면 처음부터 본다', () => {
    const gone: L = { who: 'x', text: '옛말' }
    const back: L = { who: 'me', text: '새말' }
    expect(settled([back], [out(1, '새말', gone)], mine)).toEqual(new Set([1]))
  })
})

describe('키보드 높이', () => {
  it('보이는 창이 줄어든 만큼이다', () => {
    expect(insetOf(844, 544, 0)).toBe(300)
  })

  it('보이는 창이 밀려 내려간 만큼은 뺀다 — 안 빼면 바가 먼저 튄다', () => {
    expect(insetOf(844, 544, 40)).toBe(260)
  })

  it('주소창이 줄었다 늘었다 하는 정도는 키보드가 아니다', () => {
    expect(insetOf(844, 790, 0)).toBe(0)
  })

  it('음수는 없다', () => {
    expect(insetOf(844, 900, 0)).toBe(0)
  })
})
