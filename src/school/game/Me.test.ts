// 학생증의 셈 두 가지 — 진행도 막대와 카드 오른쪽 위의 한 마디.
import { describe, expect, it } from 'vitest'

import { cells, stateOf } from './Me'
import type { MissionShown } from './useMyPaper'

const m = (over: Partial<MissionShown> = {}): MissionShown => ({
  text: '무엇무엇을 한다',
  clauses: [],
  status: 'running',
  ...over,
})

describe('여덟 칸 막대', () => {
  it('아무것도 안 했으면 한 칸도 안 켠다', () => {
    expect(cells(0, 4)).toBe(0)
  })

  it('다 했으면 여덟 칸이다', () => {
    expect(cells(4, 4)).toBe(8)
  })

  it('넘겨도 여덟 칸에서 멈춘다 — 「6/4」가 열두 칸이 되면 안 된다', () => {
    expect(cells(6, 4)).toBe(8)
  })

  it('반쯤이면 네 칸이다', () => {
    expect(cells(2, 4)).toBe(4)
  })

  it('**하나라도 셌으면 한 칸은 켠다.** 1/20 이 0칸이면 시작조차 안 한 것으로 보인다', () => {
    expect(cells(1, 20)).toBe(1)
  })

  it('기준치가 0이면 나눌 수가 없다 — 했으면 다 켜고 아니면 다 끈다', () => {
    expect(cells(0, 0)).toBe(0)
    expect(cells(1, 0)).toBe(8)
  })
})

/*
 * 카드 오른쪽 위 한 마디.
 *
 * **판정은 서버가 끝내 놓고 보낸다.** 화면은 네 가지 상태를 말로
 * 바꾸기만 한다 — 전에는 met·broken 두 값을 화면이 조합해서
 * 「실패가 달성보다 먼저」 같은 규칙이 여기 있었는데, 같은 규칙이
 * judge.statusOf 에도 있어서 둘이 어긋날 자리였다.
 */
describe('카드 오른쪽 위 한 마디', () => {
  it('네 가지 상태가 그대로 말이 된다', () => {
    expect(stateOf(m({ status: 'failed' }))).toBe('실패')
    expect(stateOf(m({ status: 'met' }))).toBe('달성')
    expect(stateOf(m({ status: 'endOnly' }))).toBe('끝날 때 판정')
    expect(stateOf(m({ status: 'running' }))).toBe('진행 중')
  })
})
