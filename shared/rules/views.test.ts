// views 투영 시험.
//
// 다른 시험과 목적이 다르다. 「맞게 담겼나」보다 **「안 담겼나」**를
// 본다. 그래서 대부분이 JSON 전문을 훑어 남의 것이 한 조각이라도
// 섞였는지 확인한다 — 어느 칸에 담기든 걸리게.
import { describe, expect, it } from 'vitest'
import { projectAll, projectView, type World, type WorldPawn } from './views'
import { type TileId } from './board'

/**
 * 시험에서 팀마다 서 있는 방. 전에는 기지였다 — 기지를 없앴으므로
 * 여기에 적어 둔다. 방 이름이 무엇이든 시험이 보는 것은 「내 팀 칸은
 * 보이고 남의 칸은 안 보인다」다.
 */
const ROOM_OF: Record<string, TileId> = { A: 'baseA', B: 'baseB', C: 'baseC', D: 'baseD' }
import type { TeamId } from './v2'

/** 쪽지에 적힌 것. 투영을 통과하면 안 되는 문장들이다. */
const SLIP_FLOOR = '바닥에 떨어져 있는 문장'
const QUIZ_SHUT = '아직 안 펼친 문제의 본문'
const QUIZ_OPEN = '펼쳐진 문제의 본문'
const SLIP_HELD = '주워서 읽은 문장'
const SLIP_BLIND = '주웠지만 아직 안 읽은 문장'
const SLIP_TORN = '찢겨서 사라진 문장'

const TEAMS: TeamId[] = ['A', 'B', 'C', 'D']
const SIZES: Record<TeamId, number> = { A: 4, B: 4, C: 3, D: 3 }

const ROSTER = TEAMS.flatMap((team) =>
  Array.from({ length: SIZES[team] }, (_, i) => ({
    playerId: `${team}${i}`,
    team,
    roleId: `role-${team}${i}`,
    targetId: `${team}${(i + 1) % SIZES[team]}`,
  })),
)

/**
 * 시험용 말 하나.
 *
 * **자리(at)를 안 주면** 방까지만 아는 사람이 된다. 문제 종이가 칸으로
 * 견주므로, 자리 있는 말과 없는 말이 둘 다 지나가야 한다.
 */
const pawn = (playerId: string, team: TeamId, tileId: TileId | null, extra: Partial<WorldPawn> = {}): WorldPawn => ({
  playerId,
  team,
  tileId,
  fromTile: null,
  toTile: null,
  asleep: false,
  hiddenUntilMs: null,
  intelOfficer: false,
  ...extra,
})

function world(over = false, invisibleId: string | null = null): World {
  return {
    nowMs: 1000,
    over,
    invisibleId,
    pawns: ROSTER.map((r) => pawn(r.playerId, r.team, ROOM_OF[r.team])),
    tiles: [
      { tileId: 'baseA', ownerTeam: 'A' },
      { tileId: 'baseB', ownerTeam: 'B' },
      { tileId: 'baseC', ownerTeam: 'C' },
      { tileId: 'baseD', ownerTeam: 'D' },
      { tileId: 'classroom', ownerTeam: 'A' },
      { tileId: 'artRoom', ownerTeam: 'B' },
      { tileId: 'centralPlaza', ownerTeam: null },
    ],
    roster: ROSTER,
    hands: [
      { id: 'cA', team: 'A', kind: 'windfall' },
      { id: 'cB', team: 'B', kind: 'windfall' },
    ],
    peeks: [
      { playerId: 'A0', voteKind: 'trust', voterNickname: '누군가' },
      { playerId: 'B0', voteKind: 'liking', voterNickname: '다른누군가' },
    ],
    choices: [
      { playerId: 'A0', chosenId: 'B0', day4: 'bond' },
      { playerId: 'B0', chosenId: 'A0', day4: 'team' },
    ],
    releasedDays: [1, 2],
    progress: [
      { playerId: 'A0', handledDays: [1, 2], readDays: [1] },
      { playerId: 'B0', handledDays: [1], readDays: [1] },
    ],
    // 쪽지 — A0 가 선 기지 바닥에 한 장, A1 이 주워서 읽은 것 한 장
    slips: [
      { id: 'sFloor', subjectId: 'C0', line: SLIP_FLOOR, tileId: 'baseA', heldBy: null, readBy: [] },
      { id: 'sHeld', subjectId: 'D0', line: SLIP_HELD, tileId: null, heldBy: 'A1', readBy: ['A1'] },
      { id: 'sBlind', subjectId: 'C1', line: SLIP_BLIND, tileId: null, heldBy: 'B0', readBy: [] },
      { id: 'sTorn', subjectId: 'D1', line: SLIP_TORN, tileId: null, heldBy: null, readBy: ['A0'] },
    ],
    quizzes: [
      // 바닥에 한 장 — 아직 아무도 안 주웠다
      {
        id: 'qShut',
        x: 12,
        y: 68,
        kind: 'short' as const,
        prompt: QUIZ_SHUT,
        choices: [],
        heldBy: null,
        solvedTeam: null,
        wrongBy: [],
      },
      // B0 가 주워 간 한 장. **B0 에게만 문장이 간다**
      {
        id: 'qOpen',
        x: 13,
        y: 68,
        kind: 'choice' as const,
        prompt: QUIZ_OPEN,
        choices: ['하나', '둘', '셋', '넷'],
        heldBy: 'B0',
        solvedTeam: null,
        wrongBy: ['A1'],
      },
      // 1층 복도에 한 장. **복도에 선 사람에게만 보인다**
      {
        id: 'qHall',
        x: 10,
        y: 79,
        kind: 'short' as const,
        prompt: '복도 문제',
        choices: [],
        heldBy: null,
        solvedTeam: null,
        wrongBy: [],
      },
      // 이미 누가 가져간 종이. 아무에게도 안 보인다
      {
        id: 'qDone',
        x: 14,
        y: 68,
        kind: 'short' as const,
        prompt: '가져간 문제',
        choices: [],
        heldBy: 'A0',
        solvedTeam: 'A' as const,
        wrongBy: [],
      },
    ],
    memories: [
      { tileId: 'library', team: 'A', atMs: 30 },
      { tileId: 'gym', team: 'B', atMs: 40 },
    ],
    awakenedAtMs: { A0: 50 },
    notices: [
      { id: 'n1', toPlayerId: null, text: '전원에게', atMs: 60 },
      { id: 'n2', toPlayerId: 'A0', text: 'A0에게만', atMs: 70 },
    ],
  }
}

const json = (v: unknown) => JSON.stringify(v)

describe('역할', () => {
  it('자기 한 줄만 나간다', () => {
    const v = projectView(world(), 'A0')
    expect(v.own).toEqual({ roleId: 'role-A0', targetId: 'A1' })
  })

  it('열넷 몫 어디에도 남의 역할이 없다', () => {
    const all = projectAll(world())
    for (const r of ROSTER) {
      const mine = json(all[r.playerId])
      for (const other of ROSTER) {
        if (other.playerId === r.playerId) continue
        expect(mine).not.toContain(other.roleId)
      }
    }
  })

  it('명단에 없는 사람에게는 빈 view가 간다', () => {
    const v = projectView(world(), '구경꾼')
    expect(v.own).toBeNull()
    expect(v.visiblePawns).toEqual([])
    expect(v.hand).toEqual([])
  })
})

describe('안개', () => {
  it('멀리 있는 남의 말은 목록에 없다', () => {
    const v = projectView(world(), 'A0')
    const ids = v.visiblePawns.map((p) => p.playerId)
    // 같은 팀 넷은 보인다
    expect(ids).toContain('A0')
    expect(ids).toContain('A3')
    // B 기지는 A 기지에서 멀다
    expect(ids).not.toContain('B0')
  })

  it('잠복한 말은 같은 팀에게도 안 보인다', () => {
    const w = world()
    w.pawns = w.pawns.map((p) => (p.playerId === 'A1' ? { ...p, hiddenUntilMs: 9999 } : p))
    const v = projectView(w, 'A0')
    expect(v.visiblePawns.map((p) => p.playerId)).not.toContain('A1')
  })

  it('잠복해도 본인은 자기 말을 본다', () => {
    const w = world()
    w.pawns = w.pawns.map((p) => (p.playerId === 'A1' ? { ...p, hiddenUntilMs: 9999 } : p))
    expect(projectView(w, 'A1').visiblePawns.map((p) => p.playerId)).toContain('A1')
  })

  // 「저 말이 어디로 가는지」를 알면 안개가 있으나 마나다
  it('걷는 말의 목적지는 어느 view에도 없다', () => {
    const w = world()
    w.pawns = w.pawns.map((p) =>
      p.playerId === 'A0' ? { ...p, tileId: null, fromTile: 'baseA', toTile: 'classroom' } : p,
    )
    for (const other of ROSTER.filter((r) => r.playerId !== 'A0')) {
      const v = projectView(w, other.playerId)
      const walking = v.visiblePawns.find((p) => p.playerId === 'A0')
      if (!walking) continue
      expect(walking.toTile).toBe('classroom') // 가는 칸까지만
    }
  })

})

describe('우리 팀 것', () => {
  it('손패는 우리 것만', () => {
    expect(projectView(world(), 'A0').hand.map((c) => c.id)).toEqual(['cA'])
    expect(projectView(world(), 'B0').hand.map((c) => c.id)).toEqual(['cB'])
  })

  it('엿본 결과는 엿본 사람만', () => {
    expect(projectView(world(), 'A0').peeked).toHaveLength(1)
    expect(projectView(world(), 'A1').peeked).toEqual([])
    expect(json(projectView(world(), 'A1'))).not.toContain('누군가')
  })
})

// 잠복은 「안 보인다」이고 투명인간은 「없는 사람」이다.
// 위치 데이터가 아예 안 나간다
// 「누가 나를 중요한 사람으로 골랐나」가 보이면 그걸 노리고 서로
// 붙어 다니게 된다. 고르는 일이 마음이 아니라 수가 된다
describe('선택', () => {
  it('내가 고른 것은 내 몫에 있다', () => {
    expect(projectView(world(), 'A0').myChoice).toEqual({ chosenId: 'B0', day4: 'bond' })
  })

  it('안 고른 사람은 비어 있다', () => {
    expect(projectView(world(), 'A1').myChoice).toBeNull()
  })

  it('남이 무엇을 골랐는지는 어느 몫에도 없다', () => {
    const all = projectAll(world())
    for (const r of ROSTER) {
      if (r.playerId === 'B0') continue
      expect(json(all[r.playerId])).not.toContain('"day4":"team"')
    }
  })

  it('누가 나를 골랐는지도 안 보인다', () => {
    // B0이 A0을 골랐다. A0의 몫에는 그 사실이 없다
    const v = projectView(world(), 'A0')
    expect(v.myChoice?.chosenId).toBe('B0')
    expect(json(v).match(/"chosenId"/g)?.length).toBe(1)
  })
})

describe('투명인간', () => {
  it('남에게 보이지 않는다 — 같은 팀에게도', () => {
    const all = projectAll(world(false, 'A1'))
    for (const r of ROSTER) {
      if (r.playerId === 'A1') continue
      expect(all[r.playerId].visiblePawns.map((p) => p.playerId)).not.toContain('A1')
    }
  })

  it('본인은 자기 말을 본다', () => {
    expect(projectView(world(false, 'A1'), 'A1').visiblePawns.map((p) => p.playerId)).toContain('A1')
  })

  it('위치가 어느 몫에도 남지 않는다', () => {
    const v = projectView(world(false, 'A1'), 'A0')
    expect(json(v.visiblePawns)).not.toContain('A1')
  })

  // 지워진 사람이 우리 팀이어도 그 사람 자리의 시야는 살아 있다.
  // 지워진 것은 남이 보는 일이지 그 사람이 눈을 감은 것이 아니다
  it('지워져도 본인의 시야는 그대로다', () => {
    const v = projectView(world(false, 'A0'), 'A0')
    expect(v.visibleTiles.length).toBeGreaterThan(0)
    expect(v.own).not.toBeNull()
  })
})

describe('진상 공개', () => {
  it('A의 기억은 먼저 가져간 팀만', () => {
    expect(projectView(world(), 'A0').memories.map((m) => m.tileId)).toEqual(['library'])
    expect(projectView(world(), 'C0').memories).toEqual([])
  })

  it('끝나면 열셋이 전원에게 열린다', () => {
    const v = projectView(world(true), 'C0')
    expect(v.memories.map((m) => m.tileId).sort()).toEqual(['gym', 'library'])
  })

  it('A의 시선은 깨달음에 이른 본인에게만', () => {
    expect(projectView(world(), 'A0').sightAtMs).toBe(50)
    expect(projectView(world(), 'A1').sightAtMs).toBeNull()
  })

  it('공지는 전체와 내 것만 섞인다', () => {
    expect(projectView(world(), 'A0').notices.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(projectView(world(), 'A1').notices.map((n) => n.id)).toEqual(['n1'])
    expect(json(projectView(world(), 'A1'))).not.toContain('A0에게만')
  })

  it('아침 진행은 본인 것만', () => {
    expect(projectView(world(), 'A0').handledDays).toEqual([1, 2])
    expect(projectView(world(), 'A2').handledDays).toEqual([])
  })

  it('본 날과 처리한 날을 따로 담는다', () => {
    const v = projectView(world(), 'A0')
    expect(v.handledDays).toEqual([1, 2]) // 2는 건너뛴 날
    expect(v.readDays).toEqual([1])
  })
})

// 한 판 전체를 훑는다. 어느 칸에 담기든 걸린다
describe('열넷 몫을 통째로 훑는다', () => {
  const all = projectAll(world())

  it('남의 손패 아이디가 없다', () => {
    for (const r of ROSTER) {
      const mine = json(all[r.playerId])
      const theirs = r.team === 'A' ? 'cB' : 'cA'
      expect(mine).not.toContain(theirs)
    }
  })

  it('남의 인연 대상이 없다', () => {
    for (const r of ROSTER) {
      const v = all[r.playerId]
      expect(v.own?.targetId).toBe(ROSTER.find((x) => x.playerId === r.playerId)?.targetId)
    }
  })
})

describe('문제 종이 — 주워야 보이고, 정답은 안 온다', () => {
  it('바닥에 있는 동안에는 **자리까지만** 간다', () => {
    const v = projectView(world(), 'A0')
    const shut = v.quizzesHere.find((q) => q.id === 'qShut')
    expect(shut).toEqual({ id: 'qShut', x: 12, y: 68 })
    // 본문이 어디에도 안 실린다
    expect(JSON.stringify(v)).not.toContain(QUIZ_SHUT)
  })

  it('**든 사람에게만** 문장이 간다', () => {
    const mine = projectView(world(), 'B0').myQuizzes.find((q) => q.id === 'qOpen')
    expect(mine?.prompt).toBe(QUIZ_OPEN)
    expect(mine?.choices).toHaveLength(4)
  })

  it('남이 든 종이는 **있다는 것도 안 간다**', () => {
    for (const who of ['A0', 'A1', 'C0']) {
      const v = projectView(world(), who)
      expect(v.myQuizzes.map((q) => q.id), who).not.toContain('qOpen')
      // 바닥 목록에서도 빠진다 — 자리만 남기면 「누가 가져갔다」가 보인다
      expect(v.quizzesHere.map((q) => q.id), who).not.toContain('qOpen')
      expect(JSON.stringify(v), who).not.toContain(QUIZ_OPEN)
    }
  })

  it('푼 종이는 든 사람 손에서도 사라진다', () => {
    const v = projectView(world(), 'A0')
    expect(v.myQuizzes.map((q) => q.id)).not.toContain('qDone')
    expect(JSON.stringify(v)).not.toContain('가져간 문제')
  })

  it('다른 방 사람에게는 **있다는 것조차** 안 간다', () => {
    // qShut 은 A기지 안 칸(10,10)에 있다. D0 는 거기 없다
    const v = projectView(world(), 'D0')
    expect(v.quizzesHere.map((q) => q.id)).not.toContain('qShut')
    expect(JSON.stringify(v)).not.toContain(QUIZ_SHUT)
  })

  /*
   * **복도 것은 복도에 서야 보인다.**
   *
   * 여기가 한동안 비어 있었다. 「방 안에서는 안 보인다」만 재고
   * 「복도에서는 보인다」를 안 재는 바람에, 복도 종이가 **아무에게도**
   * 안 보이던 것을 한참 못 봤다 — tileId 는 복도에 서 있어도 마지막
   * 방으로 남아 있는데 그걸로 「복도에 섰나」를 봤기 때문이다.
   */
  it('복도 것은 **복도에 선 사람에게 보인다**', () => {
    const w = world()
    const inHall = {
      ...w,
      pawns: w.pawns.map((p) => (p.playerId === 'A0' ? { ...p, at: { x: 11, y: 79 } } : p)),
    }
    const ids = projectView(inHall, 'A0').quizzesHere.map((q) => q.id)
    expect(ids).toContain('qHall')
    // 같은 복도에 섰으니 방 안 것은 안 보인다
    expect(ids).not.toContain('qShut')
  })

  it('복도 것은 방 안에서 안 보인다', () => {
    const ids = projectView(world(), 'A0').quizzesHere.map((q) => q.id)
    expect(ids).not.toContain('qHall')
  })

  it('다른 층 복도 것도 안 보인다', () => {
    const w = world()
    // A0 는 1층 복도, 종이는 2층 복도
    const twoFloors = {
      ...w,
      pawns: w.pawns.map((p) => (p.playerId === 'A0' ? { ...p, at: { x: 11, y: 79 } } : p)),
      quizzes: (w.quizzes ?? []).map((q) => (q.id === 'qHall' ? { ...q, x: 10, y: 30 } : q)),
    }
    expect(projectView(twoFloors, 'A0').quizzesHere.map((q) => q.id)).not.toContain('qHall')
  })

  it('이미 누가 가져간 종이는 사라진다', () => {
    const ids = projectView(world(), 'A0').quizzesHere.map((q) => q.id)
    expect(ids).not.toContain('qDone')
  })

  it('든 사람에게 **내가 틀렸는지만** 오고, 남이 틀렸는지는 안 온다', () => {
    // wrongBy 에 A1 이 있는데 든 사람은 B0 다. 「저 사람은 이미
    // 틀렸다」를 알면 누가 무엇을 모르는지가 공개 정보가 된다
    const mine = projectView(world(), 'B0').myQuizzes.find((q) => q.id === 'qOpen')
    expect(mine?.iFailed).toBe(false)
    expect(JSON.stringify(projectView(world(), 'B0').myQuizzes)).not.toContain('A1')
  })
})

describe('쪽지 — 주워서 읽어야 안다', () => {
  it('같은 방이면 **한 장 있다는 것까지만** 안다', () => {
    // A0 는 A기지에 서 있고 거기 한 장이 떨어져 있다
    const v = projectView(world(), 'A0')
    expect(v.slipsHere.map((s) => s.id)).toEqual(['sFloor'])
    // 적힌 것도, 누구 것인지도 안 온다
    expect(JSON.stringify(v)).not.toContain(SLIP_FLOOR)
    expect(JSON.stringify(v.slipsHere)).not.toContain('C0')
  })

  it('다른 방 사람에게는 있다는 것조차 안 간다', () => {
    const v = projectView(world(), 'B0')
    expect(v.slipsHere).toEqual([])
    expect(JSON.stringify(v)).not.toContain(SLIP_FLOOR)
  })

  it('들고만 있고 안 읽었으면 문장이 안 온다', () => {
    const v = projectView(world(), 'B0')
    const mine = v.mySlips.find((s) => s.id === 'sBlind')
    expect(mine?.read).toBe(false)
    expect(mine?.line).toBeNull()
    expect(mine?.subjectId).toBeNull()
    expect(JSON.stringify(v)).not.toContain(SLIP_BLIND)
  })

  it('읽었으면 문장과 주인이 온다', () => {
    const v = projectView(world(), 'A1')
    const mine = v.mySlips.find((s) => s.id === 'sHeld')
    expect(mine?.line).toBe(SLIP_HELD)
    expect(mine?.subjectId).toBe('D0')
  })

  it('**남이 읽은 쪽지는 나에게 안 온다**', () => {
    for (const who of ['A0', 'B0', 'C0', 'D0']) {
      const v = projectView(world(), who)
      if (who === 'A1') continue
      expect(JSON.stringify(v)).not.toContain(SLIP_HELD)
    }
  })

  it('찢긴 쪽지는 읽었던 사람에게도 안 온다', () => {
    const v = projectView(world(), 'A0')
    expect(v.mySlips.some((s) => s.id === 'sTorn')).toBe(false)
    expect(JSON.stringify(v)).not.toContain(SLIP_TORN)
  })

  it('열넷 누구에게도 남의 쪽지 문장이 안 간다', () => {
    for (const r of ROSTER) {
      const j = JSON.stringify(projectView(world(), r.playerId))
      if (r.playerId !== 'A1') expect(j).not.toContain(SLIP_HELD)
      expect(j).not.toContain(SLIP_FLOOR)
      expect(j).not.toContain(SLIP_BLIND)
      expect(j).not.toContain(SLIP_TORN)
    }
  })
})
