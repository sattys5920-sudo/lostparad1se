// 팀을 찍을 수 있는 사람 — **진짜 서버에서는 운영자뿐이다.**
import { describe, expect, it } from 'vitest'

import { mayPickTeam } from '../../../shared/rules/lobby'

describe('팀을 찍어서 들어오기', () => {
  it('진짜 서버의 보통 사람은 못 찍는다 — 이 한 줄이 규칙의 전부다', () => {
    expect(mayPickTeam({ host: false, emulator: false })).toBe(false)
  })

  it('운영자는 찍는다. 판을 세워 보려면 필요하다', () => {
    expect(mayPickTeam({ host: true, emulator: false })).toBe(true)
  })

  it('에뮬레이터에서는 찍는다 — 검수 대본 스물여섯 개가 팀을 고정해 둔다', () => {
    expect(mayPickTeam({ host: false, emulator: true })).toBe(true)
  })
})
