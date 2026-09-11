// 게임 시계.
//
// 학교에는 소등이 있다(24:00~08:00). 그동안 말은 걷지 않고, 깃발 시간은
// 멈추고, 토큰도 차지 않는다. 그래서 "30분 뒤"가 실제 30분 뒤가 아니다.
//
// 깃발·이동·발 묶기·잠복·봉쇄는 전부 이 파일의 함수로 계산한다. 반대로
// 견제(24·12시간), 보강(24시간), 동맹 파기 제한(12시간)은 실제 시계다 —
// 그쪽은 그냥 밀리초를 더하면 된다.
//
// 계산은 초 단위로 하고 결과는 올린다.
//
// 이 파일 하나가 유일한 구현이다. Cloud Functions(서버)와 화면이 같은
// 코드를 쓴다 — 판정은 언제나 서버가 하지만, 화면이 세는 남은 시간과
// 서버가 재는 남은 시간이 어긋날 일이 없다.
import { ACTIVE_SECONDS_PER_DAY, DAY_START_HOUR, LIGHTS_OUT_HOUR, TIMEZONE } from './v2'

const HOUR = 3600
const DAY = 86_400

/** 개발용 시계. 실제 시각에 오프셋을 더하고 배속을 곱한다. */
export interface DevClock {
  /** 이 시각부터 배속이 걸린다(실제 시각, ms). */
  anchorRealMs: number
  /** anchor 시점의 게임 속 시각(ms). */
  anchorGameMs: number
  /** 1~120. */
  speed: number
}

export const REAL_CLOCK: DevClock = { anchorRealMs: 0, anchorGameMs: 0, speed: 1 }

/**
 * 지금 몇 시인가. 모든 시각 계산이 반드시 이 함수를 거친다.
 * 배속이 1이고 오프셋이 없으면 그냥 실제 시각이다.
 */
export function gameNow(clock: DevClock = REAL_CLOCK, realNowMs: number = Date.now()): number {
  if (clock.speed === 1 && clock.anchorRealMs === 0 && clock.anchorGameMs === 0) return realNowMs
  return clock.anchorGameMs + (realNowMs - clock.anchorRealMs) * clock.speed
}

/** 게임 속 시각을 실제 시각으로 되돌린다. 타이머를 걸 때 쓴다. */
export function realTimeOf(gameMs: number, clock: DevClock = REAL_CLOCK): number {
  if (clock.speed === 1 && clock.anchorRealMs === 0 && clock.anchorGameMs === 0) return gameMs
  return clock.anchorRealMs + (gameMs - clock.anchorGameMs) / clock.speed
}

/**
 * 한국 시간으로 그날 자정(00:00)이 몇 밀리초인가.
 *
 * Intl로 서울 기준 연·월·일·시·분·초를 읽어 UTC 오프셋을 되짚는다.
 * 서울은 서머타임이 없어 오프셋이 늘 +09:00이지만, 직접 9를 더하는 대신
 * 표준 라이브러리에 물어보는 쪽이 나중에 틀릴 일이 없다.
 */
const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function seoulParts(ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const out: Record<string, string> = {}
  for (const p of PARTS.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value
  }
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    // 자정을 24로 주는 구현이 있다
    h: Number(out.hour) % 24,
    mi: Number(out.minute),
    s: Number(out.second),
  }
}

/** 서울 기준 그날 00:00의 밀리초. */
export function seoulMidnight(ms: number): number {
  const p = seoulParts(ms)
  const secondsIntoDay = p.h * HOUR + p.mi * 60 + p.s
  return ms - secondsIntoDay * 1000 - (ms % 1000)
}

/** 서울 기준 그날 몇 초가 지났는가. */
export function secondsIntoSeoulDay(ms: number): number {
  const p = seoulParts(ms)
  return p.h * HOUR + p.mi * 60 + p.s
}

/** 서울 기준 그날 h시 m분의 밀리초. */
export function seoulTimeOn(ms: number, hour: number, minute = 0): number {
  return seoulMidnight(ms) + (hour * HOUR + minute * 60) * 1000
}

/** 소등 중인가. 24:00~08:00. */
export function isLightsOut(ms: number): boolean {
  const s = secondsIntoSeoulDay(ms)
  return s < DAY_START_HOUR * HOUR
}

/** 그 시각까지 그날 흘러간 활동 시간(초). 소등 부분은 0이다. */
function activeSecondsIntoDay(ms: number): number {
  const s = secondsIntoSeoulDay(ms)
  const start = DAY_START_HOUR * HOUR
  const end = LIGHTS_OUT_HOUR * HOUR
  if (s <= start) return 0
  if (s >= end) return ACTIVE_SECONDS_PER_DAY
  return s - start
}

/**
 * 두 시각 사이에 실제로 흐른 게임 시간(초). 소등은 빠진다.
 *
 * 자정을 몇 번 넘든 하루치씩 더해 계산하므로, 며칠 앱을 꺼 뒀다가
 * 들어와도 한 번에 따라잡을 수 있다.
 */
export function activeSecondsBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0
  const fromDay = seoulMidnight(fromMs)
  const toDay = seoulMidnight(toMs)
  const wholeDays = Math.round((toDay - fromDay) / (DAY * 1000))
  const head = ACTIVE_SECONDS_PER_DAY - activeSecondsIntoDay(fromMs)
  const tail = activeSecondsIntoDay(toMs)
  if (wholeDays === 0) return activeSecondsIntoDay(toMs) - activeSecondsIntoDay(fromMs)
  return head + (wholeDays - 1) * ACTIVE_SECONDS_PER_DAY + tail
}

/**
 * 지금부터 활동 시간으로 이만큼 지나면 몇 시인가.
 * 깃발이 언제 끝나는지, 발 묶기가 언제 풀리는지를 이걸로 정한다.
 */
export function addActiveSeconds(fromMs: number, seconds: number): number {
  if (seconds <= 0) return fromMs
  let cursor = fromMs
  let left = seconds

  // 소등 중에 시작했으면 먼저 등교 시각까지 건너뛴다
  if (isLightsOut(cursor)) cursor = seoulTimeOn(cursor, DAY_START_HOUR)

  for (;;) {
    const leftToday = ACTIVE_SECONDS_PER_DAY - activeSecondsIntoDay(cursor)
    if (left <= leftToday) return cursor + left * 1000
    left -= leftToday
    // 다음 날 등교 시각으로
    cursor = seoulTimeOn(cursor + DAY * 1000, DAY_START_HOUR)
  }
}

/** 분 단위로 쓰는 곳이 많아 감싸 둔다. 결과는 올린다. */
export function addActiveMinutes(fromMs: number, minutes: number): number {
  return addActiveSeconds(fromMs, Math.ceil(minutes * 60))
}

/** 남은 활동 시간(초). 끝났으면 0. */
export function activeSecondsUntil(nowMs: number, deadlineMs: number): number {
  return Math.ceil(activeSecondsBetween(nowMs, deadlineMs))
}

/** 게임 며칠째인가. 08:00에 날이 바뀐다 — 소등은 전날에 붙는다. */
export function dayNumber(startedAtMs: number, nowMs: number): number {
  const firstDawn = seoulTimeOn(startedAtMs, DAY_START_HOUR)
  // 첫날 08:00 전에 시작했으면 그날이 DAY 1이다
  const origin = startedAtMs < firstDawn ? firstDawn - DAY * 1000 : firstDawn
  const dawnsPassed = Math.floor((seoulMidnight(nowMs) - seoulMidnight(origin)) / (DAY * 1000))
  const beforeDawnToday = secondsIntoSeoulDay(nowMs) < DAY_START_HOUR * HOUR
  return Math.max(1, dawnsPassed + 1 - (beforeDawnToday ? 1 : 0))
}

/**
 * DAY n이 시작하는 시각. 그날 08:00이다. dayNumber의 역함수다.
 *
 * 예정 이벤트를 깔 때 쓴다. 「DAY 3 21:00에 정산」을 밀리초로 바꾸는
 * 일이 서버 여기저기서 필요한데, 저마다 86400000을 곱하면 언젠가
 * 한 군데가 틀린다.
 */
export function dayStartMs(startedAtMs: number, day: number): number {
  const firstDawn = seoulTimeOn(startedAtMs, DAY_START_HOUR)
  const origin = startedAtMs < firstDawn ? firstDawn - DAY * 1000 : firstDawn
  return seoulTimeOn(origin + (day - 1) * DAY * 1000, DAY_START_HOUR)
}

/**
 * DAY n의 h시.
 *
 * h가 24 이상이면 소등을 넘어간 시각이다 — DAY 3의 25시는 달력으로는
 * 다음 날 새벽 한 시지만 게임에서는 아직 DAY 3이다. 그래서 그냥
 * 더한다.
 */
export function dayHourMs(startedAtMs: number, day: number, hour: number): number {
  const dawn = dayStartMs(startedAtMs, day)
  if (hour < 24) return seoulTimeOn(dawn, hour)
  return seoulTimeOn(dawn, DAY_START_HOUR) + (hour - DAY_START_HOUR) * HOUR * 1000
}
