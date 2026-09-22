// 아침 등교 시퀀스의 진행.
//
// 두 장면이 한 날을 이룬다.
//
//   기록 읽기 → 미니맵 복귀
//
// **날짜 카드와 「오늘 일어나는 일」은 없앴다.** 날에 이름을 붙이고
// 그날 무엇이 열리는지 미리 적어 주면, 아침이 이야기가 아니라 안내판이
// 된다. 남는 것은 A가 쓴 종이 한 장이고, 탭하면 넘어간다.
//
// 며칠을 건너뛰고 들어온 사람은 빠진 날을 **날짜순으로 이어서** 본다.
// 닷새치를 한꺼번에 뿌리면 무엇이 언제 일어난 일인지 뒤섞인다.
//
// 화면 코드가 아니라 여기에 두는 이유: 어디까지 봤는지가 서버에 남아야
// 하고(다시 들어와도 이어서 봐야 한다), 시험이 필요하기 때문이다.
export type SceneId = 'record' | 'map'

export const SCENE_ORDER: readonly SceneId[] = ['record', 'map']

/** 그날 재생에 필요한 최소한의 모양. 본문은 들어 있지 않다. */
export interface DayScript {
  day: number
  /** 종이 장수와, 장마다 「맨 위」가 있는지. */
  papers: readonly { hasTop: boolean }[]
}

export interface MorningState {
  /** 아직 보지 않은 날들. 첫 번째가 지금 보는 날이다. */
  queue: readonly number[]
  scene: SceneId
  /** 기록 읽기에서 지금 몇 번째 종이인가. */
  paperIndex: number
  /** 「맨 위」를 이미 드러냈는가. */
  topShown: boolean
  /** 건너뛴 날. 보관함에 「읽지 않음」으로 남는다. */
  /**
   * 건너뛴 날.
   *
   * **이제 아무도 못 건너뛴다** — 아침은 관리자가 여는 대로 겪는다.
   * 그래서 이 목록은 늘 비어 있다. 자리를 남겨 두는 것은 예전에 넘긴
   * 날이 적힌 판이 아직 돌기 때문이다. 보관함이 그 날들을 「읽지 않음」
   * 으로 가려내는 데 이 값을 쓴다.
   */
  skipped: readonly number[]
}

/** 지금 보고 있는 날. 다 봤으면 null. */
export function currentDay(s: MorningState): number | null {
  return s.queue.length > 0 ? s.queue[0] : null
}

export function done(s: MorningState): boolean {
  return s.queue.length === 0
}

/**
 * 아직 재생하지 않은 날. 열린 날에서 이미 처리한 날을 뺀다.
 *
 * handled에는 **끝까지 본 날과 건너뛴 날이 함께** 들어간다. 건너뛴 날은
 * 다시 재생하지 않는다 — 건너뛰기를 누른 사람에게 다음 접속 때 또
 * 들이미는 건 건너뛰기가 아니다. 대신 보관함에 「읽지 않음」으로 남는다.
 *
 * 둘을 따로 들고 있다가 본 날만 넘기면 건너뛴 아침이 매일 다시 뜬다.
 * 그러지 않도록 handledDays()가 둘을 합쳐 준다.
 */
export function pendingDays(
  released: readonly number[],
  handled: readonly number[],
): number[] {
  const done = new Set(handled)
  return [...released].filter((d) => !done.has(d)).sort((a, b) => a - b)
}

export function startMorning(days: readonly number[]): MorningState {
  return { queue: [...days].sort((a, b) => a - b), scene: 'record', paperIndex: 0, topShown: false, skipped: [] }
}

function nextDay(s: MorningState, skippedNow: boolean): MorningState {
  const finished = s.queue[0]
  return {
    queue: s.queue.slice(1),
    scene: 'record',
    paperIndex: 0,
    topShown: false,
    skipped: skippedNow && finished !== undefined ? [...s.skipped, finished] : s.skipped,
  }
}

/**
 * 탭 한 번. 다음 장면으로 넘어간다.
 *
 * 기록 읽기에서는 종이가 여러 장일 수 있고(DAY 2), 「맨 위」가 있으면
 * 탭을 한 번 더 받는다(DAY 5). 그 둘을 다 넘겨야 다음 장면이다.
 */
export function advance(s: MorningState, script: DayScript | null): MorningState {
  if (done(s)) return s

  if (s.scene === 'record') {
    const paper = script?.papers[s.paperIndex]
    // 맨 위가 아직 안 나왔으면 이번 탭은 그걸 여는 데 쓴다
    if (paper?.hasTop && !s.topShown) return { ...s, topShown: true }
    const last = (script?.papers.length ?? 1) - 1
    if (s.paperIndex < last) return { ...s, paperIndex: s.paperIndex + 1, topShown: false }
    return { ...s, scene: 'map' }
  }

  // map — 이 날은 끝났다
  return nextDay(s, false)
}

/**
 * 이번에 끝까지 본 날.
 *
 * 건너뛴 날은 여기 없다 — 보관함이 「읽지 않음」을 가리는 데 쓰기
 * 때문이다. 다음 재생을 정하는 목록은 이게 아니라 handledDays()다.
 */
export function readDays(before: readonly number[], after: MorningState): number[] {
  const left = new Set(after.queue)
  const skipped = new Set(after.skipped)
  return before.filter((d) => !left.has(d) && !skipped.has(d))
}

/**
 * 이번에 처리한 날 전부 — 본 날과 건너뛴 날.
 *
 * 서버에 적어 두었다가 다음 접속 때 pendingDays()에 그대로 넘긴다.
 * 「봤다」와 「건너뛰었다」를 가르는 건 보관함 쪽 일이고, 재생 여부는
 * 둘을 가르지 않는다.
 */
export function handledDays(before: readonly number[], after: MorningState): number[] {
  const left = new Set(after.queue)
  return before.filter((d) => !left.has(d))
}

// ── 언제 재생하나 ───────────────────────────────────────────────

/**
 * 08:00에 접속해 있으면 바로, 아니면 그날 처음 들어올 때.
 *
 * 두 경우를 굳이 가르지 않는다. 「열렸는데 아직 안 봤다」면 재생한다 —
 * 같은 조건이고, 접속 상태를 따로 추적할 필요가 없다.
 */
export function shouldPlay(released: readonly number[], handled: readonly number[]): boolean {
  return pendingDays(released, handled).length > 0
}
