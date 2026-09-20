// 학생증의 셈 두 가지 — 진행도 막대와 카드 오른쪽 위의 한 마디.
import { describe, expect, it } from 'vitest'

import { cells, stateOf } from './Me'
import type { MissionShown } from './useMyPaper'

const m = (over: Partial<MissionShown> = {}): MissionShown => ({
  text: '무엇무엇을 한다',
  clauses: [],
  met: false,
  broken: false,
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

describe('카드 오른쪽 위 한 마디', () => {
  it('깨졌으면 실패다. 달성 여부보다 먼저 본다', () => {
    expect(stateOf(m({ broken: true, met: false }))).toBe('실패')
  })

  it('이뤘으면 달성', () => {
    expect(stateOf(m({ met: true }))).toBe('달성')
  })

  it('아직 알려 줄 수 없으면 「끝날 때 판정」 — 서버가 met 을 null 로 준다', () => {
    expect(stateOf(m({ met: null }))).toBe('끝날 때 판정')
  })

  it('그 밖에는 진행 중', () => {
    expect(stateOf(m())).toBe('진행 중')
  })
})
