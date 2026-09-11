// views 투영 시험.
//
// 다른 시험과 목적이 다르다. 「맞게 담겼나」보다 **「안 담겼나」**를
// 본다. 그래서 대부분이 JSON 전문을 훑어 남의 것이 한 조각이라도
// 섞였는지 확인한다 — 어느 칸에 담기든 걸리게.
import { describe, expect, it } from 'vitest'
import { projectAll, projectView, type World, type WorldPawn } from './views'
import { BASE_OF, type TileId } from './board'
import type { TeamId } from './v2'

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
      { tileId: 'baseA', ownerTeam: 'A', buildings: [] },
      { tileId: 'baseB', ownerTeam: 'B', buildings: [] },
      { tileId: 'baseC', ownerTeam: 'C', buildings: [] },
      { tileId: 'baseD', ownerTeam: 'D', buildings: [] },
      { tileId: 'classroom', ownerTeam: 'A', buildings: [] },
      { tileId: 'artRoom', ownerTeam: 'B', buildings: [] },
      { tileId: 'centralPlaza', ownerTeam: null, buildings: [] },
    ],
    roster: ROSTER,
    hands: [
      { id: 'cA', team: 'A', kind: 'quickBuild' },
      { id: 'cB', team: 'B', kind: 'quickBuild' },
    ],
    goals: [
      { id: 'gA', team: 'A', kind: 'distantFriend', rivalTeam: 'C', revealed: false },
      { id: 'gB', team: 'B', kind: 'distantFriend', rivalTeam: 'D', revealed: false },
    ],
    plans: [
      { playerId: 'A0', path: ['classroom', 'library'], plantFlag: true },
      { playerId: 'A1', path: ['hallway'], plantFlag: false },
      { playerId: 'B0', path: ['artRoom'], plantFlag: true },
    ],
    flagTruth: [
      { tileId: 'library', team: 'A', fake: true },
      { tileId: 'gym', team: 'B', fake: true },
      { tileId: 'garden', team: 'A', fake: false },
    ],
    peeks: [
      { playerId: 'A0', voteKind: 'trust', voterNickname: '누군가' },
      { playerId: 'B0', voteKind: 'suspicion', voterNickname: '다른누군가' },
    ],
    trades: [
      { id: 't-AB', fromTeam: 'A', toTeam: 'B', give: { money: 2 }, want: { knowledge: 1 }, note: 'A와 B 사이', status: 'open', createdAtMs: 5 },
      { id: 't-CD', fromTeam: 'C', toTeam: 'D', give: { money: 1 }, want: {}, note: 'C와 D 사이', status: 'open', createdAtMs: 6 },
    ],
    proposals: [
      { id: 'a-AC', fromTeam: 'A', toTeam: 'C', status: 'open', createdAtMs: 7 },
      { id: 'a-BD', fromTeam: 'B', toTeam: 'D', status: 'open', createdAtMs: 8 },
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
    w.plans = [{ playerId: 'A0', path: ['classroom', 'library', 'centralPlaza'], plantFlag: true }]
    for (const other of ROSTER.filter((r) => r.playerId !== 'A0')) {
      const v = projectView(w, other.playerId)
      const walking = v.visiblePawns.find((p) => p.playerId === 'A0')
      if (!walking) continue
      expect(walking.toTile).toBe('classroom') // 다음 칸까지만
      expect(json(v)).not.toContain('centralPlaza') // 목적지는 없다
    }
  })

  it('같은 팀에게도 남의 등교 예약은 안 보인다', () => {
    const v = projectView(world(), 'A1')
    expect(v.commutePlan).toEqual({ path: ['hallway'], plantFlag: false })
    expect(json(v.commutePlan)).not.toContain('library')
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

  // 가짜 깃발은 꽂은 팀만 안다. 다른 팀에게는 진짜와 구별되지 않아야 한다
  it('가짜 깃발은 꽂은 팀만 안다', () => {
    expect(projectView(world(), 'A0').fakeFlagTiles).toEqual(['library'])
    expect(projectView(world(), 'C0').fakeFlagTiles).toEqual([])
  })

  it('진짜 깃발은 우리 팀에게도 가짜 목록에 없다', () => {
    expect(projectView(world(), 'A0').fakeFlagTiles).not.toContain('garden')
  })

  it('엿본 결과는 엿본 사람만', () => {
    expect(projectView(world(), 'A0').peeked).toHaveLength(1)
    expect(projectView(world(), 'A1').peeked).toEqual([])
    expect(json(projectView(world(), 'A1'))).not.toContain('누군가')
  })
})

// 잠복은 「안 보인다」이고 투명인간은 「없는 사람」이다.
// 위치 데이터가 아예 안 나간다
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

describe('협상', () => {
  // 네 팀이 서로의 제안을 다 보면 협상이 협상이 아니다
  it('교역 제안은 관련된 두 팀만 본다', () => {
    const all = projectAll(world())
    for (const r of ROSTER) {
      const ids = all[r.playerId].trades.map((t) => t.id)
      expect(ids.includes('t-AB')).toBe(r.team === 'A' || r.team === 'B')
      expect(ids.includes('t-CD')).toBe(r.team === 'C' || r.team === 'D')
    }
  })

  it('남의 협상은 덧붙인 말까지 안 보인다', () => {
    expect(json(projectView(world(), 'C0'))).not.toContain('A와 B 사이')
    expect(json(projectView(world(), 'A0'))).not.toContain('C와 D 사이')
  })

  it('동맹 제안도 관련된 두 팀만', () => {
    const all = projectAll(world())
    for (const r of ROSTER) {
      const ids = all[r.playerId].proposals.map((p) => p.id)
      expect(ids.includes('a-AC')).toBe(r.team === 'A' || r.team === 'C')
      expect(ids.includes('a-BD')).toBe(r.team === 'B' || r.team === 'D')
    }
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

  it('남의 등교 예약이 없다', () => {
    for (const r of ROSTER) {
      if (r.playerId === 'A0') continue
      expect(all[r.playerId].commutePlan?.path ?? []).not.toContain('library')
    }
  })

  it('남의 인연 대상이 없다', () => {
    for (const r of ROSTER) {
      const v = all[r.playerId]
      expect(v.own?.bondId).toBe(ROSTER.find((x) => x.playerId === r.playerId)?.bondId)
    }
  })
})
