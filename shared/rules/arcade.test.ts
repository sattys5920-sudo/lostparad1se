import { describe, expect, it } from 'vitest'

import {
  ARCADE_COUNT,
  ARCADE_GAMES,
  ARCADE_MACHINES,
  RPS_MAX_ROUNDS,
  UPDOWN_MAX,
  UPDOWN_TRIES,
  machineAtCell,
  machineAtSeat,
  roomAfterLeave,
  rpsJudge,
  rpsResolve,
  settleRoom,
  updownGuess,
  updownNew,
  type RoomMember,
} from './arcade'
import { ALLEY, HALLS, TILES, canStandAt, isAlleyCell, isHallCell, roomOfCell } from './board'
import { isFixture } from './fixtures'

/** 걸어서 닿는 칸 전부. 기물은 못 밟는다. 계단은 안 탄다(같은 층만) */
function walkFrom(start: { x: number; y: number }): Set<string> {
  const seen = new Set<string>([`${start.x},${start.y}`])
  const q = [start]
  while (q.length) {
    const c = q.shift() as { x: number; y: number }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: c.x + dx, y: c.y + dy }
      const k = `${n.x},${n.y}`
      if (seen.has(k) || !canStandAt(n.x, n.y) || isFixture(n.x, n.y)) continue
      seen.add(k)
      q.push(n)
    }
  }
  return seen
}

describe('뒷골목', () => {
  it('복도 종류다 — 어느 방도 아니고, 규칙이 보는 칸(점령 대상)과 안 겹친다', () => {
    for (const r of ALLEY) {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          expect(isHallCell(x, y)).toBe(true)
          expect(roomOfCell(x, y)).toBeNull()
          expect(TILES.some((t) => x >= t.plan.x && x < t.plan.x + t.plan.w && y >= t.plan.y && y < t.plan.y + t.plan.h)).toBe(false)
        }
    }
  })

  it('1층 복도에서 걸어서 닿는다', () => {
    const main = HALLS.find((h) => h.floor === 'f1')!.rect
    const reach = walkFrom({ x: main.x + 1, y: main.y + 1 })
    const r = ALLEY[1]
    expect(reach.has(`${r.x + 1},${r.y + r.h - 1}`)).toBe(true)
  })

  it('골목 밖 복도 칸은 골목이 아니다', () => {
    const main = HALLS.find((h) => h.floor === 'f1')!.rect
    expect(isAlleyCell(main.x + 1, main.y + 1)).toBe(false)
  })
})

describe('오락기 열 대', () => {
  it('열 대, 칸이 안 겹친다', () => {
    expect(ARCADE_MACHINES).toHaveLength(ARCADE_COUNT)
    expect(ARCADE_COUNT).toBe(10)
    const cells = new Set(ARCADE_MACHINES.flatMap((m) => [`${m.cell.x},${m.cell.y}`, `${m.seat.x},${m.seat.y}`]))
    expect(cells.size).toBe(ARCADE_COUNT * 2)
  })

  it('기계는 골목 칸의 기물이고, 위는 벽이다(두 칸 그림이 벽에 기댄다)', () => {
    for (const m of ARCADE_MACHINES) {
      expect(isAlleyCell(m.cell.x, m.cell.y)).toBe(true)
      expect(isFixture(m.cell.x, m.cell.y)).toBe(true)
      expect(canStandAt(m.cell.x, m.cell.y - 1)).toBe(false)
      expect(machineAtCell(m.cell.x, m.cell.y)).toBe(m.i)
    }
  })

  it('앞자리는 골목 칸이고 밟을 수 있다 — 거기 선 것이 앉은 것이다', () => {
    const r = ALLEY[1]
    const reach = walkFrom({ x: r.x + 1, y: r.y + r.h - 1 })
    for (const m of ARCADE_MACHINES) {
      expect(isAlleyCell(m.seat.x, m.seat.y)).toBe(true)
      expect(isFixture(m.seat.x, m.seat.y)).toBe(false)
      expect(reach.has(`${m.seat.x},${m.seat.y}`), `${m.i}번 앞자리`).toBe(true)
      expect(machineAtSeat(m.seat)).toBe(m.i)
    }
  })

  it('앞자리가 아니면 몇 번 기계도 아니다', () => {
    const m = ARCADE_MACHINES[0]
    expect(machineAtSeat({ x: m.seat.x, y: m.seat.y + 1 })).toBeNull()
    expect(machineAtSeat(m.cell)).toBeNull()
    expect(machineAtSeat(null)).toBeNull()
  })
})

describe('게임 목록', () => {
  it('열 개, 아이디가 안 겹친다', () => {
    expect(ARCADE_GAMES).toHaveLength(10)
    expect(new Set(ARCADE_GAMES.map((g) => g.id)).size).toBe(10)
  })

  it('혼자 · 둘 · 넷까지 — 새 여덟 가운데 1인 둘, 2인 둘, 4인 둘', () => {
    const fresh = ARCADE_GAMES.filter((g) => g.id !== 'updown' && g.id !== 'rps')
    expect(fresh.filter((g) => g.max === 1)).toHaveLength(2)
    expect(fresh.filter((g) => g.min === 2 && g.max === 2)).toHaveLength(2)
    expect(fresh.filter((g) => g.min === 2 && g.max === 4)).toHaveLength(2)
  })

  it('인원 줄이 말이 된다', () => {
    for (const g of ARCADE_GAMES) {
      expect(g.min).toBeGreaterThanOrEqual(1)
      expect(g.max).toBeGreaterThanOrEqual(g.min)
      expect(g.max).toBeLessThanOrEqual(4)
      if (g.mode === 'solo') expect(g.max).toBe(1)
    }
  })
})

describe('방에서 나가기', () => {
  const m = (id: string, state: RoomMember['state']): RoomMember => ({ id, name: id, machine: 0, state })

  it('고르는 중에 방장이 나가면 방이 깨진다', () => {
    const r = roomAfterLeave({ game: 'rps', hostId: 'a', status: 'lobby', members: [m('a', 'in'), m('b', 'in')] }, 'a')
    expect(r.status).toBe('gone')
  })

  it('고르는 중에 부름을 안 받으면 거절한 것이고 방은 남는다', () => {
    const r = roomAfterLeave({ game: 'rps', hostId: 'a', status: 'lobby', members: [m('a', 'in'), m('b', 'invited')] }, 'b')
    expect(r.status).toBe('lobby')
    expect(r.members[1].state).toBe('declined')
  })

  it('차례 게임은 한 사람만 나가도 깨진다', () => {
    const r = roomAfterLeave({ game: 'rps', hostId: 'a', status: 'playing', members: [m('a', 'in'), m('b', 'in')] }, 'b')
    expect(r.status).toBe('gone')
  })

  it('손 게임은 남은 사람끼리 이어 간다 — 아무도 안 남으면 깨진다', () => {
    const two = roomAfterLeave({ game: 'mole', hostId: 'a', status: 'playing', members: [m('a', 'in'), m('b', 'in')] }, 'b')
    expect(two.status).toBe('playing')
    expect(two.members[1].state).toBe('left')
    const none = roomAfterLeave({ game: 'rhythm', hostId: 'a', status: 'playing', members: [m('a', 'in')] }, 'a')
    expect(none.status).toBe('gone')
  })

  it('끝난 방은 그대로다', () => {
    const r = roomAfterLeave({ game: 'rps', hostId: 'a', status: 'done', members: [m('a', 'in'), m('b', 'in')] }, 'a')
    expect(r.status).toBe('done')
  })
})

describe('손 게임 끝내기', () => {
  const s = (id: string, score: number, solo: 'win' | 'lose' = 'win') => ({ id, score, solo, line: '' })

  it('혼자 — 제 기준 그대로', () => {
    expect(settleRoom('solo', [s('a', 10, 'lose')], []).a.outcome).toBe('lose')
  })

  it('겨루기 — 제일 높은 사람이 이기고, 같으면 비긴다, 떠난 사람은 진다', () => {
    const r = settleRoom('versus', [s('a', 30), s('b', 20), s('c', 30)], ['d'])
    expect([r.a.outcome, r.b.outcome, r.c.outcome, r.d.outcome]).toEqual(['draw', 'lose', 'draw', 'lose'])
    expect(settleRoom('versus', [s('a', 5)], ['b']).a.outcome).toBe('win')
  })

  it('협동 — 다 같이 이기거나 다 같이 진다', () => {
    const r = settleRoom('coop', [s('a', 1, 'lose'), s('b', 1, 'win')], [])
    expect(r.a.outcome).toBe('win')
    expect(r.b.outcome).toBe('win')
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
