// 점령 규칙. 페이즈는 한 시간짜리 라이브 판이고, 행동은 그때그때 처리된다.
//
// 여기서 지키려는 것은 두 가지다. **토큰을 쓴 만큼만 움직인다**는 것과,
// **끝나는 순간 서 있는 자리로만 주인이 정해진다**는 것.
import { describe, expect, it } from 'vitest'

import {
  ACT_COST,
  MAX_CARRIED_ROBOTS,
  ROBOTS_PER_ROOM,
  ROBOTS_PER_TEAM,
  ROOM_CAPACITY,
  SHORT_TEAM_BONUS,
  TOKEN_CAP,
  ROOM_KIND,
  TOKENS_PER_PHASE,
  arrive,
  capacityOf,
  doAct,
  leftBehindCount,
  absenceRefunds,
  grantFor,
  nextTokens,
  ownerOf,
  robotsIn,
  roomsOf,
  teamRanks,
  robotsLeftBehind,
  robotsOfTeam,
  settle,
  shownCount,
  stepToward,
  type Act,
  type PhaseState,
  type Person,
  type Robot,
} from './occupy'
import { TILES } from './board'
import { TEAM_IDS, type TeamId } from './v2'

const person = (playerId: string, team: TeamId, tileId: string, captain = false): Person => ({
  playerId,
  team,
  tileId,
  captain,
  tokens: TOKENS_PER_PHASE,
})

const robot = (id: string, team: TeamId, tileId: string, carriedBy: string | null = null): Robot => ({
  id,
  team,
  tileId,
  carriedBy,
})

const board = (over: Partial<PhaseState> = {}): PhaseState => ({
  people: [],
  robots: [],
  owners: {},
  pendingResearch: [],
  zeroedPeople: [],
  zeroedRobots: [],
  disguised: [],
  smashedBy: [],
  actedBy: [],
  ...over,
})

/** 될 줄 알고 쓴 행동이 안 됐으면 시험이 거짓말을 하고 있는 것이다. */
function must(state: PhaseState, playerId: string, act: Act): PhaseState {
  const out = doAct(state, playerId, act)
  if (!out.ok) throw new Error(`${playerId} ${act.kind}: ${out.why}`)
  return out.next
}

const at = (s: PhaseState, id: string) => s.people.find((p) => p.playerId === id) as Person

/** 문을 넘고 10분 뒤 — 서버의 시계가 하는 일을 시험에서 손으로 한다. */
const land = (s: PhaseState, ...ids: string[]) => ids.reduce(arrive, s)
const lab = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as (typeof TILES)[number]
const plant = TILES.find((t) => ROOM_KIND[t.id] === 'plant') as (typeof TILES)[number]

describe('토큰이 한 페이즈의 전부다', () => {
  it('다른 방에 들어가면 토큰이 하나 준다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA')] })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'classroom' })
    // **바로 도착하지 않는다.** 나가는 데 5분, 들어가는 데 5분
    expect(at(s1, 'a').tileId).toBeNull()
    expect(at(s1, 'a').toTile).toBe('classroom')
    expect(at(s1, 'a').tokens).toBe(TOKENS_PER_PHASE - ACT_COST.move)
    const s2 = land(s1, 'a')
    expect(at(s2, 'a').tileId).toBe('classroom')
    expect(at(s2, 'a').toTile).toBeNull()
  })

  it('걷는 중에는 아무 방에도 없다 — 그때 닫히면 아무 데도 못 센다', () => {
    let s = board({ people: [person('a', 'A', 'library')], owners: { library: null } })
    s = must(s, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(settle(s).next.owners.library).toBeNull()
    expect(settle(s).next.owners.classroom).toBeNull()
  })

  it('토큰이 떨어지면 더는 못 움직인다', () => {
    let s = board({ people: [{ ...person('a', 'A', 'baseA'), tokens: 2 }] })
    s = land(must(s, 'a', { kind: 'move', targetTile: 'classroom' }), 'a')
    s = land(must(s, 'a', { kind: 'move', targetTile: 'library' }), 'a')
    expect(at(s, 'a').tokens).toBe(0)
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'artRoom' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('토큰')
  })

  it('**안 되는 행동은 토큰도 안 먹는다**', () => {
    // 반쯤 되고 토큰만 빠지면 그 페이즈를 통째로 날린다
    const s = board({ people: [person('a', 'A', 'baseA')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'centralPlaza' })
    expect(out.ok).toBe(false)
    expect(at(s, 'a').tokens).toBe(TOKENS_PER_PHASE)
    expect(at(s, 'a').tileId).toBe('baseA')
  })

  it('행동마다 값이 다르다', () => {
    expect(ACT_COST.research).toBeGreaterThan(ACT_COST.move)
    // 들고 있던 것을 내려놓는 것뿐이라 값이 없다
    expect(ACT_COST.dropRobot).toBe(0)
  })
})

describe('움직임', () => {
  it('옆방이 아니면 못 간다', () => {
    const s = board({ people: [person('a', 'A', 'baseA')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'baseB' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('옆방')
  })

  it('꽉 찬 방에는 못 들어간다 — 먼저 누른 쪽만 들어간다', () => {
    // 급식실은 관문이라 정원이 둘이다
    expect(capacityOf('cafeteria')).toBe(ROOM_CAPACITY.narrow)
    let s = board({
      // 창고는 급식실 옆방이다. 정원은 붙어 있지 않다
      people: [person('x', 'A', 'cafeteria'), person('y', 'A', 'cafeteria'), person('a', 'B', 'storage')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('꽉 찼다')
    // 하나가 비키면 들어간다. 나가는 순간 자리가 난다
    s = must(s, 'y', { kind: 'move', targetTile: 'musicRoom' })
    s = land(must(s, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    expect(at(s, 'a').tileId).toBe('cafeteria')
  })

  it('데리고 있는 로봇도 같이 간다', () => {
    const s0 = board({
      people: [person('a', 'A', 'baseA')],
      robots: [robot('r1', 'A', 'baseA', 'a')],
    })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(s1.robots[0].tileId).toBe('classroom')
  })

  it('로봇은 정원을 차지하지 않는다 — 사람만 센다', () => {
    // 급식실은 정원 2. 로봇이 둘 서 있어도 사람 자리는 그대로 둘이다.
    // 전에는 로봇이 자리를 먹어서, 좁은 방에 로봇 둘을 세워 두면
    // 아무도 못 들어갔고 들어가야 부술 수 있으니 영영 그 팀 것이었다
    const s = board({
      people: [person('a', 'B', 'storage')],
      robots: [robot('r1', 'A', 'cafeteria'), robot('r2', 'A', 'cafeteria')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(true)
  })

  it('사람으로 꽉 찬 방에는 로봇이 없어도 못 간다', () => {
    const s = board({
      people: [person('x', 'A', 'cafeteria'), person('y', 'A', 'cafeteria'), person('a', 'B', 'storage')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(false)
  })

  it('저쪽 로봇 자리가 모자라면 넘치는 로봇만 두고 간다', () => {
    const s0 = board({
      people: [person('a', 'B', 'storage')],
      robots: [
        robot('r1', 'B', 'storage', 'a'),
        robot('r2', 'B', 'storage', 'a'),
        robot('mine', 'A', 'cafeteria'),
      ],
    })
    // 급식실에 이미 한 기 — 자리는 하나뿐이라 둘 중 하나만 따라간다
    expect(robotsLeftBehind(s0, 'a', 'cafeteria')).toBe(1)
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' })
    const went = s1.robots.filter((r) => r.carriedBy === 'a')
    const stayed = s1.robots.filter((r) => r.team === 'B' && r.carriedBy === null)
    expect(went).toHaveLength(1)
    expect(went[0].tileId).toBe('cafeteria')
    expect(stayed).toHaveLength(1)
    // 두고 온 것은 떠난 방에 선다. 걷는 사람을 따라 허공에 뜨지 않는다
    expect(stayed[0].tileId).toBe('storage')
  })

  it('로봇이 꽉 찬 방으로도 사람은 간다 — 로봇만 남는다', () => {
    const s0 = board({
      people: [person('a', 'B', 'storage')],
      robots: [
        robot('r1', 'B', 'storage', 'a'),
        robot('x1', 'A', 'cafeteria'),
        robot('x2', 'A', 'cafeteria'),
      ],
    })
    const s1 = land(must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    expect(at(s1, 'a').tileId).toBe('cafeteria')
    expect(robotsIn(s1, 'cafeteria')).toBe(ROBOTS_PER_ROOM)
    expect(s1.robots.find((r) => r.id === 'r1')?.tileId).toBe('storage')
  })
})

describe('호출', () => {
  it('같은 팀 하나를 내 쪽으로 한 칸 끌어온다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')] })
    const s1 = land(must(s0, 'a', { kind: 'summon', targetPlayer: 'b' }), 'b')
    expect(at(s1, 'b').tileId).toBe(stepToward('library', 'baseA'))
    expect(at(s1, 'a').tokens).toBe(TOKENS_PER_PHASE - ACT_COST.summon)
  })

  it('남의 팀은 못 부른다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'B', 'classroom')] })
    const out = doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('같은 팀')
  })

  it('이미 같은 방이면 부를 것이 없다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'baseA')] })
    expect(doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' }).ok).toBe(false)
  })
})

describe('방해 — 숫자만 빠지고 사람은 그대로 선다', () => {
  it('같은 방 상대를 판정에서 0으로 만든다', () => {
    let s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      owners: { library: null },
    })
    s = must(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    expect(s.zeroedPeople).toContain('b')
    // 방해당한 사람은 여전히 그 방에 서 있다
    expect(at(s, 'b').tileId).toBe('library')
    // 1대1이었는데 상대가 0이 되어 A가 가져간다
    expect(settle(s).next.owners.library).toBe('A')
  })

  it('다른 방 사람은 못 건드린다', () => {
    const s = board({ people: [person('a', 'A', 'library'), person('b', 'B', 'classroom')] })
    expect(doAct(s, 'a', { kind: 'disturb', targetPlayer: 'b' }).ok).toBe(false)
  })

  it('같은 사람을 두 번 방해하지 못한다 — 토큰만 나갈 일이다', () => {
    let s = board({
      people: [person('a', 'A', 'library'), person('c', 'A', 'library'), person('b', 'B', 'library')],
    })
    s = must(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    expect(doAct(s, 'c', { kind: 'disturb', targetPlayer: 'b' }).ok).toBe(false)
    expect(at(s, 'c').tokens).toBe(TOKENS_PER_PHASE)
  })
})

describe('위장 — 판정은 그대로, 보이는 숫자만 바뀐다', () => {
  it('남에게는 둘로 보이고 판정은 하나다', () => {
    let s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      owners: { library: null },
    })
    s = must(s, 'a', { kind: 'disguise' })
    expect(shownCount(s, 'library', 'B', s.disguised)).toBe(3)
    expect(shownCount(s, 'library', 'A', s.disguised)).toBe(2)
    // 1대1이라 주인이 안 바뀐다 — 위장은 판정을 못 바꾼다
    expect(settle(s).next.owners.library).toBeNull()
  })
})

describe('로봇', () => {
  it('두고 가면 그 방에 남고 점령에 센다', () => {
    let s = board({
      people: [person('a', 'A', 'library')],
      robots: [robot('r1', 'A', 'library', 'a')],
      owners: { library: null },
    })
    s = must(s, 'a', { kind: 'dropRobot' })
    expect(s.robots[0].carriedBy).toBeNull()
    s = land(must(s, 'a', { kind: 'move', targetTile: 'classroom' }), 'a')
    expect(s.robots[0].tileId).toBe('library')
    // 사람은 떠났지만 로봇이 남아 도서관을 가져간다
    expect(settle(s).next.owners.library).toBe('A')
  })

  it('상대가 보고 있어도 부순다', () => {
    // 전에는 막혀 있었다. 그래서 로봇만 남은 방이 교착됐다 — 부수러
    // 가려면 아무도 없을 때 가야 하고, 뺏으려면 사람을 몰고 가야 했다
    let s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      robots: [robot('r1', 'B', 'library')],
    })
    s = must(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    expect(s.robots).toHaveLength(0)
  })

  it('혼자여도 부순다', () => {
    let s = board({ people: [person('a', 'A', 'library')], robots: [robot('r1', 'B', 'library')] })
    s = must(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    expect(s.robots).toHaveLength(0)
  })

  it('한 사람은 한 페이즈에 한 기까지다', () => {
    let s = board({
      people: [{ ...person('a', 'A', 'library'), tokens: 99 }],
      robots: [robot('r1', 'B', 'library'), robot('r2', 'B', 'library')],
    })
    s = must(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    const out = doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r2' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('이미 부쉈다')
    // 거절은 값을 물리지 않는다
    expect(at(s, 'a').tokens).toBe(99 - ACT_COST.smashRobot)
  })

  it('둘이 가면 두 기를 나눠 부순다 — 로봇 둘짜리 방은 혼자 못 뺏는다', () => {
    let s = board({
      people: [person('a', 'A', 'library'), person('a2', 'A', 'library')],
      robots: [robot('r1', 'B', 'library'), robot('r2', 'B', 'library')],
      owners: { library: 'B' },
    })
    s = must(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    s = must(s, 'a2', { kind: 'smashRobot', targetRobot: 'r2' })
    expect(s.robots).toHaveLength(0)
    expect(settle(s).next.owners.library).toBe('A')
  })

  it('페이즈가 닫히면 부순 기록이 지워진다', () => {
    const s = board({
      people: [person('a', 'A', 'library')],
      smashedBy: ['a'],
    })
    expect(settle(s).next.smashedBy).toEqual([])
  })
})

describe('연구', () => {
  it('연구실에서만 건다', () => {
    const notLab = TILES.find((t) => ROOM_KIND[t.id] === 'normal') as (typeof TILES)[number]
    expect(doAct(board({ people: [person('a', 'A', notLab.id)] }), 'a', { kind: 'research' }).ok).toBe(false)
    expect(doAct(board({ people: [person('a', 'A', lab.id)] }), 'a', { kind: 'research' }).ok).toBe(true)
  })

  it('건 다음 페이즈가 닫힐 때 로봇이 된다', () => {
    let s = board({ people: [person('a', 'A', lab.id)] })
    s = must(s, 'a', { kind: 'research' })
    expect(s.robots).toHaveLength(0)
    expect(s.pendingResearch).toEqual(['a'])
    const done = settle(s)
    expect(done.next.robots).toHaveLength(1)
    expect(done.next.pendingResearch).toEqual([])
  })

  it('발전소를 쥔 팀은 그 자리에서 나온다', () => {
    let s = board({ people: [person('a', 'A', lab.id)], owners: { [plant.id]: 'A' } })
    s = must(s, 'a', { kind: 'research' })
    expect(s.robots).toHaveLength(1)
    expect(s.pendingResearch).toEqual([])
  })

  it('한 방에 두 기까지다 — 셋째는 설 자리가 없다', () => {
    let s = board({
      people: [{ ...person('a', 'A', lab.id), tokens: 99 }],
      owners: { [plant.id]: 'A' },
    })
    for (let i = 0; i < ROBOTS_PER_ROOM; i++) s = must(s, 'a', { kind: 'research' })
    expect(robotsIn(s, lab.id)).toBe(ROBOTS_PER_ROOM)
    expect(s.robots.filter((r) => r.carriedBy === 'a')).toHaveLength(MAX_CARRIED_ROBOTS)
    const out = doAct(s, 'a', { kind: 'research' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain(`${ROBOTS_PER_ROOM}기`)
  })

  it('팀 한도에 걸리면 연구를 고를 수 없다 — 토큰도 안 든다', () => {
    const full = Array.from({ length: ROBOTS_PER_TEAM }, (_, i) => robot(`r${i}`, 'A', 'baseA'))
    const s = board({ people: [person('a', 'A', lab.id)], robots: full })
    expect(robotsOfTeam(s, 'A')).toBe(ROBOTS_PER_TEAM)
    const out = doAct(s, 'a', { kind: 'research' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('팀당')
    // 거절된 행동은 토큰을 먹지 않는다
    expect(at(s, 'a').tokens).toBe(TOKENS_PER_PHASE)
  })

  it('걸어 둔 연구도 자리를 잡는다 — 넷이 한꺼번에 걸어 한도를 넘지 못한다', () => {
    const almost = Array.from({ length: ROBOTS_PER_TEAM - 1 }, (_, i) => robot(`r${i}`, 'A', 'baseA'))
    const s = board({
      people: [person('a', 'A', lab.id), person('b', 'A', lab.id)],
      robots: almost,
      pendingResearch: ['a'],
    })
    const out = doAct(s, 'b', { kind: 'research' })
    expect(out.ok).toBe(false)
  })

  it('한도에 걸려 불발되면 토큰을 돌려준다', () => {
    // 연구를 건 뒤 같은 팀이 먼저 채워 버린 판. 내 잘못이 아니라 환불한다
    const full = Array.from({ length: ROBOTS_PER_TEAM }, (_, i) => robot(`r${i}`, 'A', 'baseA'))
    const s = board({
      people: [{ ...person('a', 'A', lab.id), tokens: 1 }],
      robots: full,
      pendingResearch: ['a'],
    })
    const done = settle(s)
    expect(done.next.robots).toHaveLength(ROBOTS_PER_TEAM)
    expect(done.log.some((l) => l.kind === 'researchFizzled' && l.playerId === 'a')).toBe(true)
    expect(done.next.people.find((p) => p.playerId === 'a')?.tokens).toBe(1 + ACT_COST.research)
    // 불발은 미뤄 두지 않는다. 한도는 다음 페이즈에도 그대로다
    expect(done.next.pendingResearch).toEqual([])
  })
})

describe('로봇 두고 가기', () => {
  it('방에 이미 두 기면 못 둔다 — 토큰도 안 든다', () => {
    const s = board({
      people: [person('a', 'A', 'storage')],
      robots: [
        robot('mine', 'A', 'storage', 'a'),
        robot('x1', 'B', 'storage'),
        robot('x2', 'B', 'storage'),
      ],
    })
    const out = doAct(s, 'a', { kind: 'dropRobot' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain(`${ROBOTS_PER_ROOM}기`)
  })

  it('내가 데리고 온 것이면 수가 늘지 않으므로 둘 수 있다', () => {
    const s = board({
      people: [person('a', 'A', 'storage')],
      robots: [robot('m1', 'A', 'storage', 'a'), robot('m2', 'A', 'storage', 'a')],
    })
    const out = doAct(s, 'a', { kind: 'dropRobot' })
    expect(out.ok).toBe(true)
  })
})

describe('두고 가게 될 로봇 셈', () => {
  it('자리가 남으면 0, 모자란 만큼만 남는다', () => {
    expect(leftBehindCount(0, 0)).toBe(0)
    expect(leftBehindCount(2, 0)).toBe(0)
    expect(leftBehindCount(2, 1)).toBe(1)
    expect(leftBehindCount(2, ROBOTS_PER_ROOM)).toBe(2)
  })
})

describe('닫으면 서 있는 자리로 주인이 정해진다', () => {
  it('많은 쪽이 가져간다 — 파랑 둘, 빨강 하나면 파랑', () => {
    const s = board({
      people: [person('b1', 'B', 'library'), person('b2', 'B', 'library'), person('a1', 'A', 'library')],
      owners: { library: null },
    })
    expect(settle(s).next.owners.library).toBe('B')
  })

  it('동점이면 주인이 그대로다', () => {
    const held = board({
      people: [person('a1', 'A', 'library'), person('b1', 'B', 'library')],
      owners: { library: 'A' },
    })
    expect(settle(held).next.owners.library).toBe('A')
    const empty = board({
      people: [person('a1', 'A', 'library'), person('b1', 'B', 'library')],
      owners: { library: null },
    })
    expect(settle(empty).next.owners.library).toBeNull()
  })

  it('아무도 없어도 주인은 남는다', () => {
    expect(settle(board({ owners: { library: 'C' } })).next.owners.library).toBe('C')
  })

  it('주장은 둘로 센다', () => {
    const s = board({
      people: [person('c1', 'C', 'library', true), person('a1', 'A', 'library'), person('a2', 'A', 'library')],
      owners: { library: null },
    })
    // 주장 하나(2) 대 둘(2) — 동점이라 안 바뀐다
    expect(settle(s).next.owners.library).toBeNull()
  })

  it('닫으면 방해와 위장이 풀린다', () => {
    let s = board({ people: [person('a', 'A', 'library'), person('b', 'B', 'library')] })
    s = must(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    s = must(s, 'a', { kind: 'disguise' })
    const done = settle(s)
    expect(done.next.zeroedPeople).toEqual([])
    expect(done.next.disguised).toEqual([])
  })

  it('닫을 때 난 로봇은 이번 판정에 안 낀다', () => {
    // A 하나가 연구를 걸어 둔 방에 B 하나가 서 있다
    const s = board({
      people: [person('a', 'A', lab.id), person('b', 'B', lab.id)],
      owners: { [lab.id]: null },
      pendingResearch: ['a'],
    })
    const done = settle(s)
    // 로봇이 끼었다면 A가 2대1로 가져갔을 것이다. 1대1이라 안 바뀐다
    expect(done.next.owners[lab.id]).toBeNull()
    expect(done.next.robots).toHaveLength(1)
  })
})

describe('판이 네 팀에게 공평하다', () => {
  it('종류가 회전 대칭인 묶음째로 주어진다', () => {
    const byTier = new Map<string, Set<string>>()
    for (const t of TILES) {
      const set = byTier.get(t.tier) ?? new Set<string>()
      set.add(ROOM_KIND[t.id])
      byTier.set(t.tier, set)
    }
    for (const [, kinds] of byTier) expect(kinds.size).toBe(1)
  })

  it('네 기지에서 중앙광장까지 걸음 수가 같다', () => {
    const steps = TEAM_IDS.map((team) => {
      let cur = `base${team}`
      let n = 0
      while (cur !== 'centralPlaza' && n < 20) {
        cur = stepToward(cur, 'centralPlaza') as string
        n += 1
      }
      return n
    })
    expect(new Set(steps).size).toBe(1)
  })
})

describe('토큰 지급', () => {
  it('네 명이면 4, 모자란 팀은 한 사람당 하나 더', () => {
    expect(grantFor(4)).toBe(TOKENS_PER_PHASE)
    expect(grantFor(3)).toBe(TOKENS_PER_PHASE + SHORT_TEAM_BONUS)
  })

  it('팀 총합이 엇비슷해진다 — 4인 16 대 3인 15', () => {
    expect(grantFor(4) * 4).toBe(16)
    expect(grantFor(3) * 3).toBe(15)
  })

  it('이적으로 인원이 바뀌면 그 인원수로 받는다', () => {
    // 상수를 읽지 않고 명단을 세므로, 넷이 된 팀은 4를 받는다
    expect(grantFor(4)).toBe(TOKENS_PER_PHASE)
  })

  it('한도까지 깎은 **뒤에** 얹는다', () => {
    // 순서가 뒤바뀌면 결석 보정이 그 자리에서 사라져 아무 뜻이 없다
    expect(nextTokens({ held: TOKEN_CAP + 5, teamSize: 4 })).toBe(TOKEN_CAP + grantFor(4))
    expect(nextTokens({ held: 2, teamSize: 4 })).toBe(2 + grantFor(4))
  })

  it('보정은 한도를 넘어서 얹힌다', () => {
    const got = nextTokens({ held: TOKEN_CAP, teamSize: 3, refund: 3 })
    expect(got).toBe(TOKEN_CAP + grantFor(3) + 3)
    // 넘긴 것은 그다음 지급에서 한도까지 깎인다 — 안 그러면 계속
    // 결석해서 쌓아 두는 쪽이 이득이 된다
    expect(nextTokens({ held: got, teamSize: 3 })).toBe(TOKEN_CAP + grantFor(3))
  })
})

describe('결석 보정', () => {
  const idle = (over: Partial<PhaseState> = {}) =>
    board({
      people: [
        { ...person('a1', 'A', 'baseA'), tokens: 7 },
        { ...person('a2', 'A', 'baseA'), tokens: 4 },
        { ...person('b1', 'B', 'baseB'), tokens: 6 },
      ],
      ...over,
    })

  it('안 쓴 토큰의 절반을 내림해서 돌려준다', () => {
    const back = absenceRefunds(idle({ actedBy: ['b1'] }), TEAM_IDS)
    expect(back.a1).toBe(3)
    expect(back.a2).toBe(2)
  })

  it('한 명이라도 움직였으면 그 팀은 결석이 아니다', () => {
    // 남은 사람이 대신 움직일 수 있었다는 뜻이다. 개인 사정까지
    // 메워 주면 안 들어오는 편이 이득이 된다
    const back = absenceRefunds(idle({ actedBy: ['a2'] }), TEAM_IDS)
    expect(back.a1).toBeUndefined()
    expect(back.a2).toBeUndefined()
  })

  it('움직인 팀에게는 아무것도 없다', () => {
    expect(absenceRefunds(idle({ actedBy: ['b1'] }), TEAM_IDS).b1).toBeUndefined()
  })

  it('토큰이 1이면 절반이 0이라 아무것도 안 준다', () => {
    const s = board({ people: [{ ...person('c1', 'C', 'baseC'), tokens: 1 }] })
    expect(absenceRefunds(s, TEAM_IDS)).toEqual({})
  })
})

describe('움직인 사람 기록', () => {
  it('성공한 행동은 남고, 거절된 것은 안 남는다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA'), person('b', 'B', 'baseB')] })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(s1.actedBy).toEqual(['a'])
    // 옆방이 아니라 거절된다 — 움직인 것으로 치지 않는다
    const bad = doAct(s1, 'b', { kind: 'move', targetTile: 'classroom' })
    expect(bad.ok).toBe(false)
  })

  it('한 사람이 여러 번 해도 한 번만 적힌다', () => {
    let s = board({ people: [{ ...person('a', 'A', 'baseA'), tokens: 99 }] })
    s = must(s, 'a', { kind: 'disguise' })
    const before = s.actedBy.length
    s = must(s, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(s.actedBy).toHaveLength(before)
  })

  it('페이즈가 닫히면 지워진다', () => {
    const s = board({ people: [person('a', 'A', 'baseA')], actedBy: ['a'] })
    expect(settle(s).next.actedBy).toEqual([])
  })
})

describe('팀 점수는 방 개수다', () => {
  it('기지는 세지 않는다 — 거저 받은 것으로 점수가 생기면 안 된다', () => {
    const owners = { baseA: 'A', classroom: 'A', hallway: 'A' } as const
    expect(roomsOf(owners, 'A')).toBe(2)
  })

  it('아무것도 없으면 0이다', () => {
    expect(roomsOf({}, 'A')).toBe(0)
  })

  it('많이 가진 팀이 앞선다', () => {
    const owners: Partial<Record<string, TeamId | null>> = {
      classroom: 'A',
      hallway: 'A',
      storage: 'A',
      musicRoom: 'B',
      clubRoom: 'B',
      artRoom: 'C',
    }
    const rank = teamRanks(owners, TEAM_IDS)
    expect(rank.A).toBe(1)
    expect(rank.B).toBe(2)
    expect(rank.C).toBe(3)
    expect(rank.D).toBe(4)
  })

  it('동순위는 같은 수를 갖고, 다음 자리는 건너뛴다', () => {
    // 이적이 「동순위면 불가」를 판정하므로 같은 자리에 둘이 선 것이
    // 구별돼야 한다. 억지로 순서를 매기면 안 되는 이적이 열린다
    const owners: Partial<Record<string, TeamId | null>> = {
      classroom: 'A',
      musicRoom: 'B',
      artRoom: 'C',
    }
    const rank = teamRanks(owners, TEAM_IDS)
    expect(rank.A).toBe(1)
    expect(rank.B).toBe(1)
    expect(rank.C).toBe(1)
    expect(rank.D).toBe(4)
  })

  it('전부 같으면 모두 1위다', () => {
    const rank = teamRanks({}, TEAM_IDS)
    expect(Object.values(rank)).toEqual([1, 1, 1, 1])
  })
})

describe('ownerOf', () => {
  it('가장 많은 팀이 하나뿐일 때만 바뀐다', () => {
    expect(ownerOf({ A: 3, B: 1 }, null)).toBe('A')
    expect(ownerOf({ A: 2, B: 2 }, 'C')).toBe('C')
    expect(ownerOf({}, 'D')).toBe('D')
    expect(ownerOf({ A: 0 }, null)).toBeNull()
  })
})
