import { describe, expect, it } from 'vitest'

import {
  ARCADE_CELL,
  ARCADE_GAMES,
  RPS_MAX_ROUNDS,
  UPDOWN_MAX,
  UPDOWN_TRIES,
  atArcade,
  rpsJudge,
  rpsResolve,
  updownGuess,
  updownNew,
} from './arcade'
import { HALLS, canStandAt, roomOfCell } from './board'
import { isFixture } from './fixtures'

describe('오락기 자리', () => {
  it('복도 칸에 선다 — 방 안이 아니다', () => {
    expect(roomOfCell(ARCADE_CELL.x, ARCADE_CELL.y)).toBeNull()
    expect(HALLS.some((h) => h.floor === 'f1' && ARCADE_CELL.x >= h.rect.x && ARCADE_CELL.x < h.rect.x + h.rect.w && ARCADE_CELL.y >= h.rect.y && ARCADE_CELL.y < h.rect.y + h.rect.h)).toBe(true)
  })

  it('기물이라 못 밟는다', () => {
    expect(isFixture(ARCADE_CELL.x, ARCADE_CELL.y)).toBe(true)
  })

  /*
   * **둘이 붙어 설 자리가 있다.** 대결은 둘 다 오락기 옆에 서야 하므로
   * 둘레에 설 칸이 둘은 넘어야 한다. 「옆이다」만 재면 설 칸이 하나도
   * 없어도 통과하므로, 실제로 설 수 있는 칸을 센다.
   */
  it('둘레에 설 수 있는 칸이 넉넉하다', () => {
    let n = 0
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const c = { x: ARCADE_CELL.x + dx, y: ARCADE_CELL.y + dy }
        if ((dx || dy) && canStandAt(c.x, c.y) && !isFixture(c.x, c.y)) {
          n++
          expect(atArcade(c)).toBe(true)
        }
      }
    expect(n).toBeGreaterThanOrEqual(3)
  })

  it('기계 칸 자체나 두 칸 밖은 옆이 아니다', () => {
    expect(atArcade(ARCADE_CELL)).toBe(false)
    expect(atArcade({ x: ARCADE_CELL.x + 2, y: ARCADE_CELL.y })).toBe(false)
    expect(atArcade(null)).toBe(false)
  })
})

describe('게임 목록', () => {
  it('열 개, 아이디가 안 겹친다', () => {
    expect(ARCADE_GAMES).toHaveLength(10)
    expect(new Set(ARCADE_GAMES.map((g) => g.id)).size).toBe(10)
  })
  it('혼자 하는 것과 둘이 하는 것이 다 있다', () => {
    expect(ARCADE_GAMES.some((g) => g.players === 1 && g.ready)).toBe(true)
    expect(ARCADE_GAMES.some((g) => g.players === 2 && g.ready)).toBe(true)
  })
})

describe('업다운', () => {
  it('숫자는 1~100 안에서 뽑힌다 — 굴림 끝까지', () => {
    expect(updownNew(0).secret.target).toBe(1)
    expect(updownNew(0.999999).secret.target).toBe(UPDOWN_MAX)
  })

  it('처음 화면에는 답이 없다', () => {
    const { view } = updownNew(0.5)
    expect(view.answer).toBeNull()
    expect(JSON.stringify(view)).not.toContain(String(updownNew(0.5).secret.target))
  })

  it('작으면 업, 크면 다운, 맞으면 이긴다', () => {
    const s = { target: 42 }
    let v = updownNew(0).view
    const a = updownGuess(s, v, 10)
    expect(a.ok && a.view.guesses.at(-1)?.hint).toBe('up')
    v = a.ok ? a.view : v
    const b = updownGuess(s, v, 80)
    expect(b.ok && b.view.guesses.at(-1)?.hint).toBe('down')
    v = b.ok ? b.view : v
    expect(v.answer).toBeNull() // 끝나기 전에는 여전히 없다
    const c = updownGuess(s, v, 42)
    expect(c.ok && c.view.outcome).toBe('win')
    expect(c.ok && c.view.answer).toBe(42)
  })

  it(`${UPDOWN_TRIES}번을 다 쓰면 지고, 그때 답이 드러난다`, () => {
    const s = { target: 99 }
    let v = updownNew(0).view
    for (let i = 0; i < UPDOWN_TRIES; i++) {
      const r = updownGuess(s, v, 1)
      if (!r.ok) throw new Error(r.why)
      v = r.view
    }
    expect(v.outcome).toBe('lose')
    expect(v.answer).toBe(99)
    const more = updownGuess(s, v, 99)
    expect(more.ok).toBe(false)
  })

  it('정수가 아니거나 범위 밖이면 안 받고, 횟수도 안 깎는다', () => {
    const s = { target: 5 }
    const v = updownNew(0).view
    for (const bad of [0, 101, 3.5, Number.NaN]) {
      const r = updownGuess(s, v, bad)
      expect(r.ok, String(bad)).toBe(false)
    }
    expect(v.left).toBe(UPDOWN_TRIES)
  })

  /*
   * **여섯이면 머리로 늘 이기지는 못한다.** 반씩 잘라 가는 사람이
   * 1~100 전부를 해 보면 63 개를 잡는다. 일곱이었으면 100 개 다 잡혀서
   * 운이 끼어들 틈이 없었다.
   */
  it('반씩 자르는 사람이 이기는 숫자는 100 중 63 이다', () => {
    let wins = 0
    for (let t = 1; t <= UPDOWN_MAX; t++) {
      let lo = 1
      let hi = UPDOWN_MAX
      let v = updownNew(0).view
      while (v.outcome === null) {
        const mid = Math.floor((lo + hi) / 2)
        const r = updownGuess({ target: t }, v, mid)
        if (!r.ok) throw new Error(r.why)
        v = r.view
        const h = v.guesses.at(-1)?.hint
        if (h === 'up') lo = mid + 1
        if (h === 'down') hi = mid - 1
      }
      if (v.outcome === 'win') wins++
    }
    expect(wins).toBe(63)
  })
})

describe('가위바위보', () => {
  it('바위는 가위를, 가위는 보를, 보는 바위를 이긴다', () => {
    expect(rpsJudge('rock', 'scissors')).toBe('a')
    expect(rpsJudge('scissors', 'paper')).toBe('a')
    expect(rpsJudge('paper', 'rock')).toBe('a')
    expect(rpsJudge('scissors', 'rock')).toBe('b')
    expect(rpsJudge('paper', 'paper')).toBe('tie')
  })

  it('비기면 판이 안 닫히고, 갈리면 닫힌다', () => {
    const tie = rpsResolve([], 'rock', 'rock')
    expect(tie.outcome).toBeNull()
    const won = rpsResolve(tie.rounds, 'paper', 'rock')
    expect(won.outcome).toBe('a')
    expect(won.rounds).toHaveLength(2)
  })

  it(`${RPS_MAX_ROUNDS}번 연속 비기면 무승부로 닫는다`, () => {
    let r = rpsResolve([], 'rock', 'rock')
    for (let i = 1; i < RPS_MAX_ROUNDS; i++) r = rpsResolve(r.rounds, 'rock', 'rock')
    expect(r.outcome).toBe('draw')
  })
})
