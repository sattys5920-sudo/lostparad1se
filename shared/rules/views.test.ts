// views 투영 시험.
//
// 다른 시험과 목적이 다르다. 「맞게 담겼나」보다 **「안 담겼나」**를
// 본다. 그래서 대부분이 JSON 전문을 훑어 남의 것이 한 조각이라도
// 섞였는지 확인한다 — 어느 칸에 담기든 걸리게.
import { describe, expect, it } from 'vitest'
import { projectAll, projectView, type World, type WorldPawn } from './views'
import { BASE_OF, type TileId } from './board'
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
    bondId: `${team}${(i + 1) % SIZES[team]}`,
  })),
)

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
    pawns: ROSTER.map((r) => pawn(r.playerId, r.team, BASE_OF[r.team])),
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
    goals: [
      { id: 'gA', team: 'A', kind: 'distantFriend', rivalTeam: 'C', revealed: false },
      { id: 'gB', team: 'B', kind: 'distantFriend', rivalTeam: 'D', revealed: false },
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
    confessions: [
      { id: 'c1', speakerId: 'C0', scope: 'private', listenerIds: ['A0'], text: '조용히 한 말', atMs: 10 },
      { id: 'c2', speakerId: 'D0', scope: 'class', listenerIds: [], text: '모두 앞에서 한 말', atMs: 20 },
    ],
    // 쪽지 — A0 가 선 기지 바닥에 한 장, A1 이 주워서 읽은 것 한 장
    slips: [
      { id: 'sFloor', subjectId: 'C0', line: SLIP_FLOOR, tileId: BASE_OF.A, heldBy: null, readBy: [] },
      { id: 'sHeld', subjectId: 'D0', line: SLIP_HELD, tileId: null, heldBy: 'A1', readBy: ['A1'] },
      { id: 'sBlind', subjectId: 'C1', line: SLIP_BLIND, tileId: null, heldBy: 'B0', readBy: [] },
      { id: 'sTorn', subjectId: 'D1', line: SLIP_TORN, tileId: null, heldBy: null, readBy: ['A0'] },
    ],
    quizzes: [
      // A기지에 두 장 — 한 장은 접혀 있고 한 장은 B0 가 펼쳐 두었다
      {
        id: 'qShut',
        tileId: BASE_OF.A,
        kind: 'short' as const,
        prompt: QUIZ_SHUT,
        choices: [],
        openedBy: null,
        solvedTeam: null,
        wrongBy: [],
      },
      {
        id: 'qOpen',
        tileId: BASE_OF.A,
        kind: 'choice' as const,
        prompt: QUIZ_OPEN,
        choices: ['하나', '둘', '셋', '넷'],
        openedBy: 'B0',
        solvedTeam: null,
        wrongBy: ['A1'],
      },
      // 이미 누가 가져간 종이. 아무에게도 안 보인다
      {
        id: 'qDone',
        tileId: BASE_OF.A,
        kind: 'short' as const,
        prompt: '가져간 문제',
        choices: [],
        openedBy: 'A0',
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
    expect(v.own).toEqual({ roleId: 'role-A0', bondId: 'A1' })
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

  it('비밀 목표는 우리 것만', () => {
    expect(projectView(world(), 'A0').goals.map((g) => g.id)).toEqual(['gA'])
    expect(json(projectView(world(), 'C0'))).not.toContain('gA')
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
  it('1:1 고백은 말한 사람과 들은 사람만', () => {
    const all = projectAll(world())
    const sees = ROSTER.filter((r) => all[r.playerId].confessions.some((c) => c.id === 'c1'))
    expect(sees.map((r) => r.playerId).sort()).toEqual(['A0', 'C0'])
  })

  it('못 들은 사람에게는 본문도 아이디도 없다', () => {
    const v = projectView(world(), 'B1')
    expect(json(v)).not.toContain('조용히 한 말')
    expect(json(v)).not.toContain('c1')
  })

  it('전체 고백은 열넷 모두에게', () => {
    const all = projectAll(world())
    expect(ROSTER.every((r) => all[r.playerId].confessions.some((c) => c.id === 'c2'))).toBe(true)
  })

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

  it('남의 비밀 목표 아이디가 없다', () => {
    for (const r of ROSTER) {
      const mine = json(all[r.playerId])
      if (r.team !== 'A') expect(mine).not.toContain('"gA"')
      if (r.team !== 'B') expect(mine).not.toContain('"gB"')
    }
  })

  it('남의 인연 대상이 없다', () => {
    for (const r of ROSTER) {
      const v = all[r.playerId]
      expect(v.own?.bondId).toBe(ROSTER.find((x) => x.playerId === r.playerId)?.bondId)
    }
  })
})

describe('문제 종이 — 펼쳐야 보이고, 정답은 안 온다', () => {
  it('안 펼친 것은 **한 장 있다는 것까지만** 안다', () => {
    const v = projectView(world(), 'A0')
    const shut = v.quizzesHere.find((q) => q.id === 'qShut')
    expect(shut?.opened).toBe(false)
    expect(shut?.prompt).toBeNull()
    expect(shut?.choices).toEqual([])
    // 본문이 어디에도 안 실린다
    expect(JSON.stringify(v)).not.toContain(QUIZ_SHUT)
  })

  it('펼치면 그 방 사람 **전원**에게 본문이 간다 — 남의 팀도', () => {
    // A기지에 B0 를 세워 둔다. 다른 팀 앞에서 여는 것이 이 물건의
    // 전부라, 여기서 팀을 가르면 규칙이 성립하지 않는다
    const shared = world()
    const mixed = {
      ...shared,
      pawns: shared.pawns.map((p) => (p.playerId === 'B0' ? { ...p, tileId: BASE_OF.A } : p)),
    }
    for (const who of ['A0', 'A1', 'B0']) {
      const q = projectView(mixed, who).quizzesHere.find((x) => x.id === 'qOpen')
      expect(q?.opened).toBe(true)
      expect(q?.prompt).toBe(QUIZ_OPEN)
      expect(q?.choices).toHaveLength(4)
    }
  })

  it('다른 방 사람에게는 있다는 것조차 안 간다', () => {
    const v = projectView(world(), 'D0')
    expect(v.quizzesHere).toEqual([])
    expect(JSON.stringify(v)).not.toContain(QUIZ_OPEN)
  })

  it('이미 누가 가져간 종이는 사라진다', () => {
    const ids = projectView(world(), 'A0').quizzesHere.map((q) => q.id)
    expect(ids).not.toContain('qDone')
  })

  it('내가 틀렸는지만 오고, 남이 틀렸는지는 안 온다', () => {
    // A1 이 틀렸다. 본인은 알고 남은 모른다 — 「저 사람은 이미
    // 틀렸다」를 알면 누가 무엇을 모르는지가 공개 정보가 된다
    expect(projectView(world(), 'A1').quizzesHere.find((q) => q.id === 'qOpen')?.iFailed).toBe(true)
    expect(projectView(world(), 'A0').quizzesHere.find((q) => q.id === 'qOpen')?.iFailed).toBe(false)
    expect(JSON.stringify(projectView(world(), 'A0').quizzesHere)).not.toContain('A1')
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
