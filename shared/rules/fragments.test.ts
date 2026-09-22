// A의 기록 — 무엇이 언제 열리는가.
import { describe, expect, it } from 'vitest'
import {
  eventsOn,
  inLastHours,
  isOver,
  lastHoursStartMs,
} from './fragments'
import { TILES } from './board'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const dayN = (n: number, hhmm = '10:00') =>
  seoul(`2026-03-0${1 + n}T${hhmm}:00`)

describe('방은 처음부터 다 열려 있다', () => {
  // 전에는 A의 기록이 날마다 핵심을 두 칸씩 열어 줬다. 그 규칙을
  // 걷어냈으니 여는 함수도 없어야 한다 — 남아 있으면 누가 다시 쓴다
  // A의 기록은 이제 읽을 글 한 장이다. 판 위의 무엇도 바꾸지 않는다 —
  // 여는 일정도, 지목한 칸의 +2도 없다. 남아 있으면 누가 다시 쓴다
  it('판을 바꾸는 함수가 아예 없다', async () => {
    const mod = (await import('./fragments')) as Record<string, unknown>
    expect(mod.openedOn).toBeUndefined()
    expect(mod.openTilesBy).toBeUndefined()
    expect(mod.coreOpen).toBeUndefined()
    expect(mod.tileValue).toBeUndefined()
  })

  it('스물다섯 방이 전부 있다', () => {
    expect(TILES).toHaveLength(25)
  })
})

describe('날마다 일어나는 일', () => {
  it('DAY 3에 비밀 목표 한 장을 공개한다', () => {
  })

  it('DAY 4에 모든 동맹이 풀린다', () => {
  })

  it('DAY 5에 마지막 여섯 시간이 있다', () => {
    expect(eventsOn(5).hasLastHours).toBe(true)
  })
})

describe('마지막 여섯 시간', () => {
  it('DAY 5 15:00부터다', () => {
    expect(inLastHours(START, dayN(5, '14:59'))).toBe(false)
    expect(inLastHours(START, dayN(5, '15:00'))).toBe(true)
  })

  it('다른 날 15시는 아니다', () => {
    expect(inLastHours(START, dayN(4, '15:00'))).toBe(false)
  })

  it('시작 시각을 짚는다', () => {
    expect(lastHoursStartMs(dayN(5, '10:00'))).toBe(dayN(5, '15:00'))
  })
})

describe('끝', () => {
  it('DAY 5까지는 안 끝났다', () => {
    expect(isOver(START, dayN(5, '20:00'))).toBe(false)
  })

  it('여섯째 날이면 끝났다', () => {
    expect(isOver(START, seoul('2026-03-07T09:00:00'))).toBe(true)
  })
})
