import { describe, expect, it } from 'vitest'
import { padFace } from './Controls'

const all = (w: 'shut' | 'open' | 'door') => ({ up: w, down: w, left: w, right: w }) as const

describe('padFace', () => {
  it('벽은 어둡게 두고 값도 안 붙인다', () => {
    const f = padFace(all('shut'), true, 9, 1)
    expect(f.up).toEqual({ open: false })
    expect(f.up.cost).toBeUndefined()
  })

  it('자유 시간에는 문을 넘어도 값이 안 든다', () => {
    const f = padFace(all('door'), false, 0, 1)
    expect(f.left).toEqual({ open: true })
  })

  it('방 안에서 한 칸 옮기는 데는 페이즈 중에도 값이 안 든다', () => {
    const f = padFace(all('open'), true, 0, 1)
    expect(f.right).toEqual({ open: true })
  })

  it('페이즈 중에 문·계단을 넘는 쪽에만 값이 붙는다', () => {
    const f = padFace({ up: 'door', down: 'open', left: 'shut', right: 'door' }, true, 3, 1)
    expect(f.up).toEqual({ open: true, cost: 1, why: undefined })
    expect(f.down.cost).toBeUndefined()
    expect(f.left.cost).toBeUndefined()
    expect(f.right.cost).toBe(1)
  })

  /**
   * **벽과 「토큰이 없다」는 다르다.**
   *
   * 둘을 같이 어둡게 하면 사방이 막힌 것처럼 보여서 방에 갇힌 줄
   * 안다. 값이 모자란 쪽은 멀쩡한 채로 두고 눌리게 해서, 누른
   * 사람이 까닭을 듣게 한다.
   */
  it('토큰이 모자라면 어둡게 하지 않고 까닭을 붙인다', () => {
    const f = padFace(all('door'), true, 0, 1)
    expect(f.up.open).toBe(true)
    expect(f.up.why).toContain('페이즈 토큰')
  })

  it('딱 한 개 남았으면 아직 갈 수 있다', () => {
    expect(padFace(all('door'), true, 1, 1).up.why).toBeUndefined()
  })
})
