import { afterEach, describe, expect, it } from 'vitest'

import { applyProbe, correctedNow, getSkewMs, isStale, onSkew, resetSkew, STALE_MS } from './skew'

const REAL = { anchorRealMs: 0, anchorGameMs: 0, speed: 1 }

describe('기기 시계 보정', () => {
  afterEach(() => resetSkew())

  it('폰이 10분 빠르면 어긋남은 −10분이다', () => {
    const device = 1_000_000_000
    const server = device - 10 * 60_000
    // 왕복 200ms — 서버 시각은 가운데(+100ms)로 친다
    const skew = applyProbe(server, REAL, device, device + 200)
    expect(skew).toBe(-10 * 60_000 + 100 - 200)
    expect(getSkewMs()).toBe(skew)
  })

  it('폰이 10분 느리면 +10분이다', () => {
    const device = 1_000_000_000
    expect(applyProbe(device + 10 * 60_000, REAL, device, device)).toBe(10 * 60_000)
    expect(correctedNow()).toBeGreaterThan(Date.now() + 9 * 60_000)
  })

  it('개발용 시계가 걸려 있으면 게임 시각을 실제 시각으로 되돌려 잰다', () => {
    // 60배속 — 실제 1초에 게임 1분. 앵커: 실제 0 = 게임 100만
    const clock = { anchorRealMs: 0, anchorGameMs: 1_000_000, speed: 60 }
    // 서버: 실제 5000ms → 게임 1_000_000 + 300_000. 폰: 실제 5000ms (딱 맞음)
    expect(applyProbe(1_300_000, clock, 5000, 5000)).toBe(0)
    // 폰이 실제 2초 빠르다 → 폰 7000 일 때 서버는 5000
    expect(applyProbe(1_300_000, clock, 7000, 7000)).toBe(-2000)
  })

  it('왕복이 5초를 넘으면 믿지 않는다', () => {
    expect(applyProbe(0, REAL, 0, 6000)).toBeNull()
    expect(getSkewMs()).toBe(0)
  })

  it('1초 미만의 흔들림은 무시하고, 넘으면 알린다', () => {
    let calls = 0
    const off = onSkew(() => calls++)
    applyProbe(10_000, REAL, 10_000, 10_000) // 첫 측정은 알린다
    expect(calls).toBe(1)
    applyProbe(10_500, REAL, 10_000, 10_000) // 500ms — 잡음
    expect(calls).toBe(1)
    expect(getSkewMs()).toBe(0)
    applyProbe(13_000, REAL, 10_000, 10_000) // 3초 — 반영
    expect(calls).toBe(2)
    expect(getSkewMs()).toBe(3000)
    off()
  })

  it('잰 적이 없거나 10분이 지나면 다시 잰다', () => {
    expect(isStale(0)).toBe(true)
    applyProbe(100, REAL, 100, 100)
    expect(isStale(100)).toBe(false)
    expect(isStale(100 + STALE_MS + 1)).toBe(true)
  })
})
