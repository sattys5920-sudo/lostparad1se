// 투명인간 — 누가 지워지고, 지워지면 무엇이 달라지는가.
//
// 가장 중요한 건 「갈리면 아무도 지워지지 않는다」다. 누군가를 지우려면
// 모두가 같은 이름을 적어야 한다. 그 규칙이 무너지면 매일 누군가 지워지고,
// 그러면 이 게임이 하려는 말이 사라진다.
import { describe, expect, it } from 'vitest'
import {
  canName,
  countBallots,
  INVISIBLE_CAN,
  INVISIBLE_CANNOT,
  isInvisible,
  chatReaches,
  pickInvisible,
} from './invisible'
import { INVISIBLE_MIN_VOTES } from './v2'

const counts = (o: Record<string, number>) =>
  Object.entries(o).map(([playerId, count]) => ({ playerId, count }))

describe('내일의 투명인간', () => {
  it('가장 많이 받은 사람이 지워진다', () => {
    const out = pickInvisible({ counts: counts({ a: 3, b: 2, c: 0 }) })
    expect(out).toEqual({ playerId: 'a', reason: 'picked' })
  })

  it('한 장만 받아도 최다면 지워진다', () => {
    // 최소선은 한 장이다. 「여러 사람이 같은 이름을 적어야 한다」는
    // 최소선이 아니라 **동률 무효**가 맡는다
    expect(INVISIBLE_MIN_VOTES).toBe(1)
    expect(pickInvisible({ counts: counts({ a: 1 }) }).playerId).toBe('a')
  })

  it('한 장씩 갈리면 아무도 아니다', () => {
    const out = pickInvisible({ counts: counts({ a: 1, b: 1 }) })
    expect(out.playerId).toBe(null)
    expect(out.reason).toBe('tie')
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

  it('보이지 않고 표를 받지 못한다', () => {
    expect(INVISIBLE_CANNOT.beSeen).toBe(false)
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
  const said = { playerId: 'erased', invisible: true }

  /**
   * 가려서 보내지 않고 **아예 안 보낸다**. 가려진 줄 하나가 「지금 이
   * 방에 있다」를 알려 주는데, 그것이야말로 맵이 지워 놓은 값이다.
   */
  it('지워진 사람이 친 줄은 남에게 안 간다', () => {
    expect(chatReaches(said, 'other')).toBe(false)
  })

  it('본인에게는 남는다 — 안 쳐진 것과 안 들린 것을 갈라야 한다', () => {
    expect(chatReaches(said, 'erased')).toBe(true)
  })

  it('투명인간이 아니면 모두에게 간다', () => {
    expect(chatReaches({ playerId: 'anyone', invisible: false }, 'other')).toBe(true)
  })
})


describe('표를 세면 누가 줬는지가 사라진다', () => {
  it('받은 사람별 장수만 남는다', () => {
    const out = countBallots([
      { voterId: 'a1', targetId: 'b1', atMs: 0 },
      { voterId: 'a2', targetId: 'b1', atMs: 0 },
      { voterId: 'a3', targetId: 'c1', atMs: 0 },
    ])
    expect(out).toEqual([
      { playerId: 'b1', count: 2 },
      { playerId: 'c1', count: 1 },
    ])
    expect(JSON.stringify(out)).not.toContain('a1')
  })

  it('아무도 안 적으면 빈 목록이다', () => {
    expect(countBallots([])).toEqual([])
  })
})

describe('누구를 적을 수 있는가', () => {
  const base = { voterId: 'me', captainIds: ['cap'] as string[] }

  it('나 자신은 못 적는다', () => {
    expect(canName({ ...base, targetId: 'me' }).reason).toBe('self')
  })

  it('팀장은 못 적는다', () => {
    expect(canName({ ...base, targetId: 'cap' }).reason).toBe('captain')
  })

  it('어제 지워진 사람은 못 적는다 — 방어 코드다', () => {
    expect(canName({ ...base, targetId: 'x', yesterdayId: 'x' }).reason).toBe('repeat')
  })

  it('같은 팀 사람도 적을 수 있다', () => {
    // 팀을 가르지 않는다. 이 투표는 호의가 아니라 배제라서,
    // 「우리 편은 못 적는다」가 붙으면 규칙이 무뎌진다
    expect(canName({ ...base, targetId: 'mate' }).ok).toBe(true)
  })
})
