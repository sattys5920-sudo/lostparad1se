// 투명인간 — 누가 지워지고, 지워지면 무엇이 달라지는가.
//
// 가장 중요한 건 「갈리면 아무도 지워지지 않는다」다. 누군가를 지우려면
// 모두가 같은 이름을 적어야 한다. 그 규칙이 무너지면 매일 누군가 지워지고,
// 그러면 이 게임이 하려는 말이 사라진다.
import { describe, expect, it } from 'vitest'
import {
  countableForFlag,
  INVISIBLE_CAN,
  INVISIBLE_CANNOT,
  isInvisible,
  maskClassChat,
  pickInvisible,
} from './invisible'
import { INVISIBLE_CHAT_MASK, INVISIBLE_MIN_SUSPICION } from './v2'

const counts = (o: Record<string, number>) =>
  Object.entries(o).map(([playerId, count]) => ({ playerId, count }))

describe('내일의 투명인간', () => {
  it('가장 많이 받은 사람이 지워진다', () => {
    const out = pickInvisible({ counts: counts({ a: 3, b: 2, c: 0 }) })
    expect(out).toEqual({ playerId: 'a', reason: 'picked' })
  })

  it('두 장 미만이면 아무도 아니다', () => {
    const out = pickInvisible({ counts: counts({ a: 1, b: 1 }) })
    expect(out.playerId).toBe(null)
    expect(out.reason).toBe('tooFew')
    expect(INVISIBLE_MIN_SUSPICION).toBe(2)
  })

  it('최다가 둘이면 아무도 지워지지 않는다', () => {
    const out = pickInvisible({ counts: counts({ a: 3, b: 3, c: 1 }) })
    expect(out.playerId).toBe(null)
    expect(out.reason).toBe('tie')
  })

  it('셋이 같아도 마찬가지다', () => {
    expect(pickInvisible({ counts: counts({ a: 2, b: 2, c: 2 }) }).reason).toBe('tie')
  })

  it('2등이 여럿인 건 상관없다 — 1등만 하나면 된다', () => {
    expect(pickInvisible({ counts: counts({ a: 4, b: 2, c: 2 }) }).playerId).toBe('a')
  })

  it('이틀 연속은 없다', () => {
    const out = pickInvisible({ counts: counts({ a: 5, b: 1 }), yesterdayId: 'a' })
    expect(out.playerId).toBe(null)
    expect(out.reason).toBe('repeat')
  })

  it('어제 다른 사람이었으면 그대로 지워진다', () => {
    expect(pickInvisible({ counts: counts({ a: 5 }), yesterdayId: 'b' }).playerId).toBe('a')
  })

  it('아무도 표를 안 받았으면 아무도 아니다', () => {
    expect(pickInvisible({ counts: [] }).playerId).toBe(null)
  })
})

describe('지워진 하루', () => {
  it('걷고, 행동하고, 털어놓을 수 있다', () => {
    expect(INVISIBLE_CAN.walk).toBe(true)
    expect(INVISIBLE_CAN.act).toBe(true)
    expect(INVISIBLE_CAN.reveal).toBe(true)
    expect(INVISIBLE_CAN.castVote).toBe(true)
  })

  it('보이지 않고, 세지 않고, 표를 받지 못한다', () => {
    expect(INVISIBLE_CANNOT.beSeen).toBe(false)
    expect(INVISIBLE_CANNOT.countInFlag).toBe(false)
    expect(INVISIBLE_CANNOT.receiveVote).toBe(false)
  })

  it('누가 투명인간인지 짚는다', () => {
    expect(isInvisible('a', 'a')).toBe(true)
    expect(isInvisible('a', 'b')).toBe(false)
    expect(isInvisible(null, 'a')).toBe(false)
    expect(isInvisible(undefined, 'a')).toBe(false)
  })
})

describe('전체 채팅', () => {
  it('남에게는 「…」로만 간다', () => {
    expect(maskClassChat('나 아니야', true, false)).toBe(INVISIBLE_CHAT_MASK)
  })

  it('본인에게는 자기 말이 그대로 보인다', () => {
    expect(maskClassChat('나 아니야', true, true)).toBe('나 아니야')
  })

  it('투명인간이 아니면 그대로다', () => {
    expect(maskClassChat('나 아니야', false, false)).toBe('나 아니야')
  })
})

describe('깃발 판정에서 빼기', () => {
  const standing = [{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }]

  it('투명인간만 빠진다', () => {
    expect(countableForFlag(standing, 'b').map((s) => s.playerId)).toEqual(['a', 'c'])
  })

  it('없으면 그대로다', () => {
    expect(countableForFlag(standing, null)).toHaveLength(3)
  })
})
