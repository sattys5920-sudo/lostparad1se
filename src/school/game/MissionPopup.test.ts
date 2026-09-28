// 판정 팝업의 셈 — 결과 한 마디, 어느 날을 먼저 띄우나, 숫자 칸.
import { describe, expect, it } from 'vitest'

import type { InboxDoc, MissionMail } from '../../../shared/missions/mail'
import { amountText, finalMail, mailKey, receivedMails, resultWord, unseenMails } from './MissionPopup'

const mail = (day: number, over: Partial<MissionMail> = {}): MissionMail => ({
  day,
  final: false,
  status: 'met',
  clauses: [],
  choice: 'endOnly',
  roleName: '주번',
  line: '이번에는 …',
  sentAtMs: 1000 + day,
  ...over,
})

describe('결과 한 마디', () => {
  it('넷이 다 다르다', () => {
    expect(resultWord('met')).toBe('해냈다')
    expect(resultWord('running')).toBe('아직이다')
    expect(resultWord('failed')).toBe('끝났다')
    expect(resultWord('endOnly')).toBe('아직 모른다')
  })
})

describe('어느 날을 띄우나', () => {
  it('우편함이 없으면 아무것도 없다', () => {
    expect(unseenMails(null)).toEqual([])
    expect(receivedMails(undefined)).toEqual([])
  })

  it('안 닫은 날만, 오래된 날부터', () => {
    const inbox: InboxDoc = {
      missions: { d3: mail(3), d1: mail(1), d2: mail(2) },
      seen: { d1: true },
    }
    expect(unseenMails(inbox).map((m) => m.day)).toEqual([2, 3])
  })

  it('**열쇠가 아니라 day 로 줄 세운다** — d10 이 d2 보다 앞에 서면 안 된다', () => {
    const inbox: InboxDoc = { missions: { d10: mail(10), d2: mail(2) } }
    expect(receivedMails(inbox).map((m) => m.day)).toEqual([2, 10])
  })

  it('다시 보내면 열쇠가 바뀐다 — 전에 닫았어도 새 종이다', () => {
    expect(mailKey(mail(1, { sentAtMs: 5 }))).not.toBe(mailKey(mail(1, { sentAtMs: 6 })))
  })

  it('마지막 날 판정이 와야 나흘 표를 편다', () => {
    expect(finalMail({ missions: { d1: mail(1), d2: mail(2) } })).toBeNull()
    expect(finalMail({ missions: { d1: mail(1), d4: mail(4, { final: true }) } })?.day).toBe(4)
  })
})

describe('숫자 칸', () => {
  it('**숫자가 안 온 줄은 「—」**', () => {
    expect(amountText({ have: null, bar: 3, unit: 'count' })).toBe('—')
  })
  it('센 줄은 셈/기준', () => {
    expect(amountText({ have: 2, bar: 3, unit: 'count' })).toBe('2/3')
    expect(amountText({ have: 12, bar: 15, unit: 'minutes' })).toBe('12/15분')
  })
  it('했다·안 했다 줄은 말로', () => {
    expect(amountText({ have: 1, bar: 1, unit: 'flag' })).toBe('했다')
    expect(amountText({ have: 0, bar: 1, unit: 'flag' })).toBe('아직')
  })
})
