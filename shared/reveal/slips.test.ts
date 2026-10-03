// 쪽지 문장에 이름을 끼워 넣는 자리.
import { describe, expect, it } from 'vitest'
import { SLIPS_PER_PERSON, SLIP_SUBJECT_MARK, fillSubject, isBlank } from './slips'

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

  it('**「{이름}은/는」은 이름 끝을 보고 고른다**', () => {
    expect(fillSubject(`${SLIP_SUBJECT_MARK}은/는 거기 있었다`, '봇4')).toBe('봇4은 거기 있었다')
    expect(fillSubject(`${SLIP_SUBJECT_MARK}은/는 거기 있었다`, '나래')).toBe('나래는 거기 있었다')
    expect(fillSubject(`${SLIP_SUBJECT_MARK}이/가 울었다`, '한결')).toBe('한결이 울었다')
    expect(fillSubject(`${SLIP_SUBJECT_MARK}를/을 봤다`, '가온')).toBe('가온을 봤다')
    expect(fillSubject(`${SLIP_SUBJECT_MARK}와/과 둘이`, '나래')).toBe('나래와 둘이')
    expect(fillSubject(`${SLIP_SUBJECT_MARK}이/가 ${SLIP_SUBJECT_MARK}을/를`, '마루')).toBe('마루가 마루를')
  })

  it('조사 없이 적으면 이름만 넣는다', () => {
    expect(fillSubject(`${SLIP_SUBJECT_MARK}의 일`, '마루')).toBe('마루의 일')
  })

  it('아직 안 쓴 자리를 알아본다', () => {
    expect(isBlank('[작성 예정]')).toBe(true)
    expect(isBlank('  [작성 예정]  ')).toBe(true)
    expect(isBlank('무언가 적혀 있다')).toBe(false)
  })
})

describe('한 사람 앞으로 다섯 장', () => {
  it('열넷이면 일흔 장이다', () => {
    expect(SLIPS_PER_PERSON * 14).toBe(70)
  })
})

describe('조사를 한 글자로 붙여 쓴 문안 — 쪽지 56장', () => {
  it('「{이름}은」은 받침을 보고 은/는', () => {
    expect(fillSubject('{이름}은 늘 마지막으로 학교를 나선다.', '민준')).toBe('민준은 늘 마지막으로 학교를 나선다.')
    expect(fillSubject('{이름}은 늘 마지막으로 학교를 나선다.', '지우')).toBe('지우는 늘 마지막으로 학교를 나선다.')
  })
  it('「{이름}이」는 이/가', () => {
    expect(fillSubject('{이름}이 묻었기 때문이다.', '지우')).toBe('지우가 묻었기 때문이다.')
    expect(fillSubject('{이름}이 묻었기 때문이다.', '민준')).toBe('민준이 묻었기 때문이다.')
  })
  it('「{이름}이다」 · 「{이름}이었다」는 받침 없으면 다 · 였다', () => {
    expect(fillSubject('꺼낸 건 {이름}이다.', '지우')).toBe('꺼낸 건 지우다.')
    expect(fillSubject('연 것도 {이름}이었다.', '지우')).toBe('연 것도 지우였다.')
    expect(fillSubject('연 것도 {이름}이었다.', '민준')).toBe('연 것도 민준이었다.')
  })
  it('「의」「에게」「 때문에」는 그대로다', () => {
    expect(fillSubject('{이름}의 말이라면', '지우')).toBe('지우의 말이라면')
    expect(fillSubject('아직 {이름}에게 있다.', '지우')).toBe('아직 지우에게 있다.')
    expect(fillSubject('{이름} 때문에 꺼지지 않는다.', '지우')).toBe('지우 때문에 꺼지지 않는다.')
  })
})
