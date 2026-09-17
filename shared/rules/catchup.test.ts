import { describe, expect, it } from 'vitest'
import { clockItems, dueItems, nextByHand, nextDueMs, type Due } from './catchup'
import { SCHEDULE_ORD } from '../model'

const d = (id: string, dueAtMs: number, kind: Due['kind'], doneAtMs: number | null = null): Due => ({
  id,
  dueAtMs,
  ord: SCHEDULE_ORD[kind],
  kind,
  doneAtMs,
})

describe('밀어야 할 것', () => {
  it('아직 안 온 것은 빼고 이른 것부터', () => {
    const items = [d('c', 300, 'dayStart'), d('a', 100, 'dayStart'), d('b', 200, 'dayStart')]
    expect(dueItems(items, 250).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('이미 민 것은 다시 밀지 않는다', () => {
    const items = [d('a', 100, 'dayStart', 100), d('b', 200, 'dayStart')]
    expect(dueItems(items, 300).map((i) => i.id)).toEqual(['b'])
  })

  it('딱 그 시각이면 민다', () => {
    expect(dueItems([d('a', 100, 'dayStart')], 100)).toHaveLength(1)
    expect(dueItems([d('a', 100, 'dayStart')], 99)).toHaveLength(0)
  })

  // 같은 시각에 도착과 깃발과 아침이 겹칠 수 있다.
  // 말이 도착한 뒤에 깃발을 판정해야 그 칸에 선 것으로 센다
  it('같은 시각이면 도착 → 깃발 → 정시', () => {
    const items = [
      d('x', 100, 'settlement'),
      d('y', 100, 'arrive'),
      d('z', 100, 'arrive'),
    ]
    expect(dueItems(items, 100).map((i) => i.kind)).toEqual(['arrive', 'arrive', 'settlement'])
  })

  it('시각도 순서도 같으면 아이디로 가른다', () => {
    const items = [d('b', 100, 'arrive'), d('a', 100, 'arrive')]
    expect(dueItems(items, 100).map((i) => i.id)).toEqual(['a', 'b'])
  })

  // 두 번 따라잡아도 같은 순서여야 한다 — 안 그러면 같은 판이 갈린다
  it('들어온 순서가 달라도 결과가 같다', () => {
    const items = [d('a', 100, 'arrive'), d('b', 100, 'arrive'), d('c', 200, 'dayStart')]
    const shuffled = [items[2], items[0], items[1]]
    expect(dueItems(items, 999).map((i) => i.id)).toEqual(dueItems(shuffled, 999).map((i) => i.id))
  })

  it('며칠이 비어 있어도 한 번에 다 민다', () => {
    const items = Array.from({ length: 11 }, (_, i) => d(`s${i}`, i * 1000, 'settlement'))
    expect(dueItems(items, 99_999)).toHaveLength(11)
  })
})

describe('다음 일', () => {
  it('아직 안 온 것 중 가장 이른 시각', () => {
    const items = [d('a', 100, 'dayStart'), d('b', 300, 'settlement'), d('c', 200, 'arrive')]
    expect(nextDueMs(items, 100)).toBe(200)
  })

  it('이미 민 것은 세지 않는다', () => {
    const items = [d('a', 200, 'dayStart', 200), d('b', 300, 'settlement')]
    expect(nextDueMs(items, 100)).toBe(300)
  })

  it('남은 게 없으면 null', () => {
    expect(nextDueMs([d('a', 100, 'dayStart', 100)], 0)).toBeNull()
    expect(nextDueMs([], 0)).toBeNull()
  })
})

describe('시계가 미는 것과 사람이 미는 것', () => {
  /**
   * **이것이 「엔딩만 뜬다」의 정체다.**
   *
   * 판을 세워 두고 며칠 지나면, 아무도 안 들어온 사이에 닷새가 통째로
   * 지나가 버렸다. 다음에 들어온 사람이 보는 것은 엔딩 화면뿐이다.
   * 걸음은 시계가 밀어야 하지만 달력은 사람이 넘긴다.
   */
  it('시계는 도착만 민다 — 날도 정산도 끝도 안 민다', () => {
    const items = [
      d('a', 100, 'arrive'),
      d('b', 100, 'dayStart'),
      d('c', 100, 'settlement'),
      d('d', 100, 'lastHours'),
      d('e', 100, 'gameEnd'),
    ]
    expect(clockItems(items, 999).map((i) => i.kind)).toEqual(['arrive'])
  })

  it('사람이 미는 것은 이른 것 하나. 시각은 보지 않는다', () => {
    const items = [d('b', 900, 'settlement'), d('a', 200, 'dayStart')]
    // 200 도 900 도 아직 안 왔다. 그래도 넘긴다 — 그것이 손으로 넘긴다는 뜻이다
    expect(nextByHand(items)?.id).toBe('a')
  })

  it('이미 민 것은 건너뛴다', () => {
    const items = [d('a', 200, 'dayStart', 200), d('b', 300, 'settlement')]
    expect(nextByHand(items)?.id).toBe('b')
  })

  /** 정산을 건너뛰고 끝내지 못한다. 순서는 원래 달력 그대로다. */
  it('도착은 사람 차례에 끼어들지 않는다', () => {
    const items = [d('x', 10, 'arrive'), d('a', 200, 'settlement')]
    expect(nextByHand(items)?.id).toBe('a')
  })

  it('남은 게 없으면 null', () => {
    expect(nextByHand([d('a', 100, 'gameEnd', 100)])).toBeNull()
    expect(nextByHand([])).toBeNull()
  })
})
