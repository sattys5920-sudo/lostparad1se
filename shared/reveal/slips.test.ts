// 쪽지 문장에 이름을 끼워 넣는 자리.
import { describe, expect, it } from 'vitest'
import { SLIPS_ON_FLOOR_MAX, SLIPS_PER_PHASE, SLIP_SUBJECT_MARK, fillSubject, isBlank } from './slips'

describe('이름 끼워 넣기', () => {
  it('{이름}이 주인 이름으로 바뀐다', () => {
    expect(fillSubject(`${SLIP_SUBJECT_MARK}은 그날 거기 있었다`, '한결')).toBe('한결은 그날 거기 있었다')
  })

  it('여러 번 나와도 다 바뀐다', () => {
    const out = fillSubject(`${SLIP_SUBJECT_MARK}과 ${SLIP_SUBJECT_MARK}`, '한결')
    expect(out).toBe('한결과 한결')
  })

  it('**이름을 모르면 「누군가」로 둔다** — 자리표가 그대로 보이면 안 된다', () => {
    const out = fillSubject(`${SLIP_SUBJECT_MARK}의 일`, null)
    expect(out).toBe('누군가의 일')
    expect(out).not.toContain(SLIP_SUBJECT_MARK)
  })

  it('아직 안 쓴 자리를 알아본다', () => {
    expect(isBlank('[작성 예정]')).toBe(true)
    expect(isBlank('  [작성 예정]  ')).toBe(true)
    expect(isBlank('무언가 적혀 있다')).toBe(false)
  })
})

describe('바닥이 종이밭이 되지 않는다', () => {
  it('한 번에 뿌리는 수가 한도보다 적다', () => {
    // 한 페이즈에 한도만큼 뿌리면 아무도 안 주워도 늘 꽉 차 있다
    expect(SLIPS_PER_PHASE).toBeLessThan(SLIPS_ON_FLOOR_MAX)
  })
})
