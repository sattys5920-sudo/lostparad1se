// 점령 규칙. 페이즈는 한 시간짜리 라이브 판이고, 행동은 그때그때 처리된다.
//
// 여기서 지키려는 것은 두 가지다. **토큰을 쓴 만큼만 움직인다**는 것과,
// **끝나는 순간 서 있는 자리로만 주인이 정해진다**는 것.
import { describe, expect, it } from 'vitest'

import {
  ACT_COST,
  ENTER_COST,
  MAX_CARRIED_ROBOTS,
  ROBOTS_PER_ROOM,
  ROBOTS_PER_TEAM,
  KNOWLEDGE_PER_RESEARCH,
  KNOWLEDGE_PER_RESEARCH_OWNER,
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
  nextWallet,
  walletCap,
  walletOf,
  ownerOf,
  robotsIn,
  roomsOf,
  teamRanks,
  robotsLeftBehind,
  researchKnowledge,
  vaultOf,
  robotsOfTeam,
  settle,
  shownCount,
  stepToward,
  type Act,
  type PhaseState,
  type Person,
  type Robot,
} from './occupy'
import { TILES, isAdjacent } from './board'
import { TEAM_IDS, type TeamId } from './v2'

const person = (playerId: string, team: TeamId, tileId: string, captain = false): Person => ({
  playerId,
  team,
  tileId,
  captain,
})

/** 그 팀 상자에 남은 토큰. **지갑은 팀에 하나다.** */
const purse = (state: PhaseState, team: TeamId): number => walletOf(state, team)

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
  // 시험에서는 금고도 주머니도 넉넉하다고 본다. 모자란 경우는 따로 쓴다
  vaults: Object.fromEntries(TEAM_IDS.map((t) => [t, { money: 99, knowledge: 99 }])),
  // 주머니는 **사람마다**다. 시험에 나오는 이름을 넉넉히 채워 둔다
  satchels: Object.fromEntries(
    ['a', 'b', 'c', 'x', 'y', 'a1', 'a2', 'b1', 'c1'].map((id) => [id, { whistle: 9, nameTag: 9 }]),
  ),
  // 상자도 한 사람 몫만큼 넣어 둔다. 모자란 경우는 따로 쓴다
  wallets: Object.fromEntries(TEAM_IDS.map((t) => [t, TOKENS_PER_PHASE])),
  // 시험은 따로 적지 않는 한 핵심이 다 열린 판으로 본다
  openedTiles: TILES.filter((t) => t.tier === 'core' || t.tier === 'plaza').map((t) => t.id),
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
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' })
    // **바로 도착하지 않는다.** 나가는 데 5분, 들어가는 데 5분
    expect(at(s1, 'a').tileId).toBeNull()
    expect(at(s1, 'a').toTile).toBe('cafeteria')
    expect(purse(s1, 'A')).toBe(TOKENS_PER_PHASE - ACT_COST.move)
    const s2 = land(s1, 'a')
    expect(at(s2, 'a').tileId).toBe('cafeteria')
    expect(at(s2, 'a').toTile).toBeNull()
  })

  it('걷는 중에는 아무 방에도 없다 — 그때 닫히면 아무 데도 못 센다', () => {
    let s = board({ people: [person('a', 'A', 'library')], owners: { library: null } })
    s = must(s, 'a', { kind: 'move', targetTile: 'artRoom' })
    expect(settle(s).next.owners.library).toBeNull()
    expect(settle(s).next.owners.artRoom).toBeNull()
  })

  it('팀 상자가 떨어지면 더는 못 움직인다', () => {
    let s = board({ people: [person('a', 'A', 'baseA')], wallets: { A: 2 } })
    s = land(must(s, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    s = land(must(s, 'a', { kind: 'move', targetTile: 'annex' }), 'a')
    expect(purse(s, 'A')).toBe(0)
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'baseB' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('토큰')
  })

  it('**안 되는 행동은 토큰도 안 먹는다**', () => {
    // 반쯤 되고 토큰만 빠지면 그 페이즈를 통째로 날린다.
    // 급식실은 관문이라 정원이 둘이다 — 꽉 찬 방에 들어가려다 거절당한다
    const s = board({
      people: [person('a', 'A', 'baseA'), person('x', 'B', 'cafeteria'), person('y', 'B', 'cafeteria')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(false)
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
    expect(at(s, 'a').tileId).toBe('baseA')
  })

  it('행동마다 값이 다르다', () => {
    expect(ACT_COST.research).toBeGreaterThan(ACT_COST.move)
    // 들고 있던 것을 내려놓는 것뿐이라 값이 없다
    expect(ACT_COST.dropRobot).toBe(0)
  })
})

describe('움직임', () => {
  it('복도가 이어지면 옆방이 아니어도 간다', () => {
    // 교무실과 화장실은 1층 양 끝이고 이웃이 아니다. 그래도 복도
    // 하나로 이어져 있으니 문 하나 값에 간다
    expect(isAdjacent('baseA', 'baseB')).toBe(false)
    const s = board({ people: [person('a', 'A', 'baseA')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'baseB' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(at(out.next, 'a').toTile).toBe('baseB')
  })


  it('층을 넘어도 한 걸음이다 — 계단은 문이라 셈에 안 든다', () => {
    // 2층 교실에서 1층 연구실까지. 사이에 계단이 둘 있지만 칸이 아니다
    const s = board({ people: [person('a', 'A', 'centralPlaza')] })
    const before = purse(s, 'A')
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'labRoom' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.spent).toBe(ENTER_COST)
    expect(purse(out.next, 'A')).toBe(before - ENTER_COST)
    expect(at(out.next, 'a').tileId).toBe(null)
    expect(at(arrive(out.next, 'a'), 'a').tileId).toBe('labRoom')
  })

  it('지하에서 옥상까지도 값은 하나다', () => {
    const s = board({ people: [person('a', 'A', 'storage')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'rooftop' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.spent).toBe(ENTER_COST)
  })

  it('문 하나에 토큰 하나 — 복도를 길게 걸어도 같다', () => {
    const near = board({ people: [person('a', 'A', 'baseA')] })
    const far = board({ people: [person('b', 'A', 'baseA')] })
    // 이웃인 방과 복도 건너 먼 방의 값이 같다
    const one = doAct(near, 'a', { kind: 'move', targetTile: 'hallway' })
    const two = doAct(far, 'b', { kind: 'move', targetTile: 'baseB' })
    expect(one.ok && two.ok).toBe(true)
    if (one.ok && two.ok) {
      expect(purse(one.next, 'A')).toBe(purse(two.next, 'A'))
      expect(purse(one.next, 'A')).toBe(purse(near, 'A') - ENTER_COST)
    }
  })

  it('꽉 찬 방에는 못 들어간다 — 먼저 누른 쪽만 들어간다', () => {
    // 급식실은 관문이라 정원이 둘이다
    expect(capacityOf('cafeteria')).toBe(ROOM_CAPACITY.narrow)
    let s = board({
      // 체육관은 복도 건너 급식실 맞은편이다
      people: [person('x', 'A', 'cafeteria'), person('y', 'A', 'cafeteria'), person('a', 'B', 'gym')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('꽉 찼다')
    // 하나가 비키면 들어간다. 나가는 순간 자리가 난다
    s = must(s, 'y', { kind: 'move', targetTile: 'annex' })
    s = land(must(s, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    expect(at(s, 'a').tileId).toBe('cafeteria')
  })

  it('데리고 있는 로봇도 같이 간다', () => {
    const s0 = board({
      people: [person('a', 'A', 'baseA')],
      robots: [robot('r1', 'A', 'baseA', 'a')],
    })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(s1.robots[0].tileId).toBe('cafeteria')
  })

  it('로봇은 정원을 차지하지 않는다 — 사람만 센다', () => {
    // 급식실은 정원 2. 로봇이 둘 서 있어도 사람 자리는 그대로 둘이다.
    // 전에는 로봇이 자리를 먹어서, 좁은 방에 로봇 둘을 세워 두면
    // 아무도 못 들어갔고 들어가야 부술 수 있으니 영영 그 팀 것이었다
    const s = board({
      people: [person('a', 'B', 'gym')],
      robots: [robot('r1', 'A', 'cafeteria'), robot('r2', 'A', 'cafeteria')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(true)
  })

  it('사람으로 꽉 찬 방에는 로봇이 없어도 못 간다', () => {
    const s = board({
      people: [person('x', 'A', 'cafeteria'), person('y', 'A', 'cafeteria'), person('a', 'B', 'gym')],
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(out.ok).toBe(false)
  })

  it('저쪽 로봇 자리가 모자라면 넘치는 로봇만 두고 간다', () => {
    const s0 = board({
      people: [person('a', 'B', 'gym')],
      robots: [
        robot('r1', 'B', 'gym', 'a'),
        robot('r2', 'B', 'gym', 'a'),
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
    expect(stayed[0].tileId).toBe('gym')
  })

  it('로봇이 꽉 찬 방으로도 사람은 간다 — 로봇만 남는다', () => {
    const s0 = board({
      people: [person('a', 'B', 'gym')],
      robots: [
        robot('r1', 'B', 'gym', 'a'),
        robot('x1', 'A', 'cafeteria'),
        robot('x2', 'A', 'cafeteria'),
      ],
    })
    const s1 = land(must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    expect(at(s1, 'a').tileId).toBe('cafeteria')
    expect(robotsIn(s1, 'cafeteria')).toBe(ROBOTS_PER_ROOM)
    expect(s1.robots.find((r) => r.id === 'r1')?.tileId).toBe('gym')
  })
})

describe('호출', () => {
  it('같은 팀 하나를 내 쪽으로 한 칸 끌어온다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')] })
    const s1 = land(must(s0, 'a', { kind: 'summon', targetPlayer: 'b' }), 'b')
    expect(at(s1, 'b').tileId).toBe(stepToward('library', 'baseA'))
    expect(purse(s1, 'A')).toBe(TOKENS_PER_PHASE - ACT_COST.summon)
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

  it('같은 사람을 두 번 방해하지 못한다 — 팀 상자만 축날 일이다', () => {
    let s = board({
      people: [person('a', 'A', 'library'), person('c', 'A', 'library'), person('b', 'B', 'library')],
    })
    s = must(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    expect(doAct(s, 'c', { kind: 'disturb', targetPlayer: 'b' }).ok).toBe(false)
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
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
    s = land(must(s, 'a', { kind: 'move', targetTile: 'artRoom' }), 'a')
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
      people: [person('a', 'A', 'library')],
      robots: [robot('r1', 'B', 'library'), robot('r2', 'B', 'library')],
      wallets: { A: 99 },
    })
    s = must(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    const out = doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r2' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('이미 부쉈다')
    // 거절은 값을 물리지 않는다
    expect(purse(s, 'A')).toBe(99 - ACT_COST.smashRobot)
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

  /**
   * 거는 순간에는 아무것도 안 난다. **어느 연구실에 걸었는지**를
   * 적어 두고, 완성은 스무 분 뒤 그 방에서 서버가 처리한다.
   */
  it('걸면 그 연구실이 적힌다 — 로봇은 아직 없다', () => {
    let s = board({ people: [person('a', 'A', lab.id)] })
    s = must(s, 'a', { kind: 'research' })
    expect(s.robots).toHaveLength(0)
    expect(s.pendingResearch).toEqual([
      { playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null, tileId: lab.id },
    ])
  })

  it('발전소를 쥔 팀은 그 자리에서 나온다', () => {
    let s = board({ people: [person('a', 'A', lab.id)], owners: { [plant.id]: 'A' } })
    s = must(s, 'a', { kind: 'research' })
    expect(s.robots).toHaveLength(1)
    expect(s.pendingResearch).toEqual([])
  })

  it('한 방에 두 기까지다 — 셋째는 설 자리가 없다', () => {
    let s = board({
      people: [person('a', 'A', lab.id)],
      owners: { [plant.id]: 'A' },
      wallets: { A: 99 },
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
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
  })

  it('걸어 둔 연구도 자리를 잡는다 — 넷이 한꺼번에 걸어 한도를 넘지 못한다', () => {
    const almost = Array.from({ length: ROBOTS_PER_TEAM - 1 }, (_, i) => robot(`r${i}`, 'A', 'baseA'))
    const s = board({
      people: [person('a', 'A', lab.id), person('b', 'A', lab.id)],
      robots: almost,
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null, tileId: lab.id }],
    })
    const out = doAct(s, 'b', { kind: 'research' })
    expect(out.ok).toBe(false)
  })

  /**
   * **안 익은 연구는 페이즈가 닫힐 때 사라진다.** 값도 안 돌아온다.
   *
   * 완성은 스무 분 뒤 그 연구실에서 일어나는 일이라, 종이 치면 그냥
   * 끝이다. 낸 값을 돌려주면 페이즈 끝무렵에 밑져야 본전으로 거는
   * 것이 되어 「남은 시간을 보고 건다」가 규칙이 아니게 된다.
   */
  it('안 익은 연구는 닫힐 때 사라지고 값도 안 돌아온다', () => {
    const s = board({
      people: [person('a', 'A', lab.id)],
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null, tileId: lab.id }],
      vaults: { A: { money: 0, knowledge: 0 } },
      wallets: { A: 1 },
    })
    const done = settle(s)
    expect(done.next.pendingResearch).toEqual([])
    // 로봇도 안 난다 — 나는 자리는 연구실이고 나는 때는 스무 분 뒤다
    expect(done.next.robots).toHaveLength(0)
    expect(purse(done.next, 'A')).toBe(1)
    expect(vaultOf(done.next, 'A').knowledge).toBe(0)
  })
})

describe('연구에 드는 지식', () => {
  const lab2 = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as (typeof TILES)[number]
  const plant2 = TILES.find((t) => ROOM_KIND[t.id] === 'plant') as (typeof TILES)[number]
  const withVault = (knowledge: number, over: Partial<PhaseState> = {}) =>
    board({
      people: [person('a', 'A', lab2.id)],
      vaults: { A: { money: 0, knowledge } },
      ...over,
    })

  it('연구실을 차지했으면 1, 아니면 2다', () => {
    expect(researchKnowledge(false)).toBe(KNOWLEDGE_PER_RESEARCH)
    expect(researchKnowledge(true)).toBe(KNOWLEDGE_PER_RESEARCH_OWNER)
  })

  it('걸 때 바로 뺀다 — 완성될 때 빼면 없는 지식으로 넷이 연구한다', () => {
    const s = must(withVault(5), 'a', { kind: 'research' })
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
    expect(s.pendingResearch).toEqual([
      { playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null, tileId: lab2.id },
    ])
  })

  it('우리 연구실이면 한 점만 들고, 그 한 점은 아무도 안 받는다', () => {
    const s = must(withVault(5, { owners: { [lab2.id]: 'A' } }), 'a', { kind: 'research' })
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH_OWNER)
    expect(s.pendingResearch[0].paidTo).toBeNull()
  })

  it('남의 연구실이면 두 점을 **주인 팀 금고로** 낸다', () => {
    const s = must(
      withVault(5, { owners: { [lab2.id]: 'B' }, vaults: { A: { money: 0, knowledge: 5 }, B: { money: 0, knowledge: 0 } } }),
      'a',
      { kind: 'research' },
    )
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
    expect(vaultOf(s, 'B').knowledge).toBe(KNOWLEDGE_PER_RESEARCH)
    expect(s.pendingResearch[0].paidTo).toBe('B')
  })

  it('아무도 안 쥔 연구실이면 두 점이 그냥 사라진다', () => {
    const s = must(withVault(5), 'a', { kind: 'research' })
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
    expect(s.pendingResearch[0].paidTo).toBeNull()
  })

  it('발전소를 쥐면 그 자리에서 로봇이 난다 — 값과는 상관없다', () => {
    const s = must(withVault(5, { owners: { [plant2.id]: 'A' } }), 'a', { kind: 'research' })
    expect(robotsIn(s, lab2.id)).toBe(1)
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
  })

  it('지식이 모자라면 고를 수 없다 — 토큰도 안 든다', () => {
    const s = withVault(KNOWLEDGE_PER_RESEARCH - 1)
    const out = doAct(s, 'a', { kind: 'research' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('지식이 모자란다')
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
    expect(vaultOf(s, 'A').knowledge).toBe(KNOWLEDGE_PER_RESEARCH - 1)
  })

  /** 남의 연구실에 낸 지식은 **돌아오지 않는다.** 주인 팀이 가진 값이다. */
  it('남의 연구실에 낸 지식은 닫혀도 주인 팀에 남는다', () => {
    const s = board({
      people: [person('a', 'A', lab2.id)],
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: 'B', tileId: lab2.id }],
      vaults: { A: { money: 0, knowledge: 0 }, B: { money: 0, knowledge: KNOWLEDGE_PER_RESEARCH } },
    })
    const done = settle(s).next
    expect(vaultOf(done, 'A').knowledge).toBe(0)
    expect(vaultOf(done, 'B').knowledge).toBe(KNOWLEDGE_PER_RESEARCH)
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

  it('아무도 안 서 있으면 주인이 없어진다', () => {
    expect(settle(board({ owners: { library: 'C' } })).next.owners.library).toBeNull()
  })

  it('서 있으면 지킨다', () => {
    const s = board({ people: [person('c1', 'C', 'library')], owners: { library: 'C' } })
    expect(settle(s).next.owners.library).toBe('C')
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

  it('걸어 둔 연구는 판정에 안 낀다 — 로봇이 아직 없다', () => {
    // A 하나가 연구를 걸어 둔 방에 B 하나가 서 있다
    const s = board({
      people: [person('a', 'A', lab.id), person('b', 'B', lab.id)],
      owners: { [lab.id]: null },
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, paidTo: null, tileId: lab.id }],
    })
    const done = settle(s)
    // 로봇이 끼었다면 A가 2대1로 가져갔을 것이다. 1대1이라 안 바뀐다
    expect(done.next.owners[lab.id]).toBeNull()
    expect(done.next.robots).toHaveLength(0)
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

  // 전에는 5×5 격자라 네 기지에서 중앙까지 걸음 수가 똑같았다. 층이
  // 생기면서 그 대칭은 없어졌다 — 대신 **어느 기지에서든 닿기는 한다**
  it('어느 기지에서든 2-3 교실까지 길이 있다', () => {
    for (const team of TEAM_IDS) {
      let cur = `base${team}`
      let n = 0
      while (cur !== 'centralPlaza' && n < 20) {
        cur = stepToward(cur, 'centralPlaza') as string
        n += 1
      }
      expect(cur, `${team}`).toBe('centralPlaza')
    }
  })
})

describe('투명인간은 없는 사람이다', () => {
  it('점령 판정에서 0명으로 센다', () => {
    // 파랑 둘 중 하나가 지워지면 빨강 하나와 같아져 주인이 안 바뀐다
    const s = board({
      people: [person('b1', 'B', 'library'), person('b2', 'B', 'library'), person('a1', 'A', 'library')],
      owners: { library: null },
      invisibleId: 'b2',
    })
    expect(settle(s).next.owners.library).toBe(null)
  })

  it('지워진 사람은 부를 수 없다', () => {
    const s = board({
      people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')],
      invisibleId: 'b',
    })
    const out = doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('그런 사람이 없다')
  })

  it('지워진 사람은 부르지도 못한다', () => {
    const s = board({
      people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')],
      invisibleId: 'a',
    })
    const out = doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('보이지 않는')
  })

  it('지워진 사람은 방해의 대상이 안 된다', () => {
    const s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      invisibleId: 'b',
    })
    expect(doAct(s, 'a', { kind: 'disturb', targetPlayer: 'b' }).ok).toBe(false)
  })

  it('그래도 데리고 있는 짝은 부술 수 있다', () => {
    // 사람은 없는 것으로 치지만 짝은 그 자리에 서 있다
    const s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      robots: [robot('r1', 'B', 'library', 'b')],
      invisibleId: 'b',
    })
    expect(doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' }).ok).toBe(true)
  })

  it('혼자 하는 일은 그대로 된다 — 걷기·짝 만들기', () => {
    const lab3 = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as (typeof TILES)[number]
    const s = board({ people: [person('a', 'A', lab3.id)], invisibleId: 'a' })
    expect(doAct(s, 'a', { kind: 'research' }).ok).toBe(true)
    const w = board({ people: [person('a', 'A', 'baseA')], invisibleId: 'a' })
    expect(doAct(w, 'a', { kind: 'move', targetTile: 'cafeteria' }).ok).toBe(true)
  })
})

describe('토큰은 팀이 한 주머니를 나눠 쓴다', () => {
  it('한 사람이 쓰면 같은 팀 다른 사람이 쓸 것이 준다', () => {
    const s0 = board({
      people: [person('a1', 'A', 'baseA'), person('a2', 'A', 'baseA')],
      wallets: { A: ENTER_COST * 2 },
    })
    const s1 = land(must(s0, 'a1', { kind: 'move', targetTile: 'cafeteria' }), 'a1')
    expect(purse(s1, 'A')).toBe(ENTER_COST)
    // a2 는 아무것도 안 했는데 쓸 것이 줄었다. **이게 이 규칙의 전부다**
    const s2 = land(must(s1, 'a2', { kind: 'move', targetTile: 'hallway' }), 'a2')
    expect(purse(s2, 'A')).toBe(0)
    const out = doAct(s2, 'a2', { kind: 'move', targetTile: 'gym' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('팀 토큰')
  })

  it('남의 팀 상자는 안 건드린다', () => {
    const s0 = board({
      people: [person('a', 'A', 'baseA'), person('b', 'B', 'baseB')],
      wallets: { A: 4, B: 4 },
    })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' })
    expect(purse(s1, 'A')).toBe(4 - ENTER_COST)
    expect(purse(s1, 'B')).toBe(4)
  })

  it('먼저 쓰는 사람이 임자다 — 상한이 없다', () => {
    // 한 사람이 상자를 다 비울 수 있다. 막지 않는 것이 규칙이다 —
    // 누가 몇 번 움직일지를 말로 정하라고 이렇게 뒀다
    let s = board({ people: [person('a1', 'A', 'baseA'), person('a2', 'A', 'baseA')], wallets: { A: 2 } })
    s = land(must(s, 'a1', { kind: 'move', targetTile: 'cafeteria' }), 'a1')
    s = land(must(s, 'a1', { kind: 'move', targetTile: 'annex' }), 'a1')
    expect(purse(s, 'A')).toBe(0)
    expect(doAct(s, 'a2', { kind: 'move', targetTile: 'hallway' }).ok).toBe(false)
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

  it('상자에는 사람 몫에 사람 수를 곱해서 넣는다 — 총량은 그대로다', () => {
    expect(nextWallet({ held: 0, teamSize: 4 })).toBe(grantFor(4) * 4)
    expect(nextWallet({ held: 0, teamSize: 3 })).toBe(grantFor(3) * 3)
  })

  it('한도까지 깎은 **뒤에** 얹는다', () => {
    // 순서가 뒤바뀌면 결석 보정이 그 자리에서 사라져 아무 뜻이 없다
    const cap = walletCap(4)
    expect(nextWallet({ held: cap + 5, teamSize: 4 })).toBe(cap + grantFor(4) * 4)
    expect(nextWallet({ held: 2, teamSize: 4 })).toBe(2 + grantFor(4) * 4)
  })

  it('상자 한도는 사람 수만큼이다', () => {
    expect(walletCap(4)).toBe(TOKEN_CAP * 4)
    expect(walletCap(3)).toBe(TOKEN_CAP * 3)
  })

  it('보정은 한도를 넘어서 얹힌다', () => {
    const cap = walletCap(3)
    const got = nextWallet({ held: cap, teamSize: 3, refund: 3 })
    expect(got).toBe(cap + grantFor(3) * 3 + 3)
    // 넘긴 것은 그다음 지급에서 한도까지 깎인다 — 안 그러면 계속
    // 결석해서 쌓아 두는 쪽이 이득이 된다
    expect(nextWallet({ held: got, teamSize: 3 })).toBe(cap + grantFor(3) * 3)
  })
})

describe('결석 보정', () => {
  const idle = (over: Partial<PhaseState> = {}) =>
    board({
      people: [
        person('a1', 'A', 'baseA'),
        person('a2', 'A', 'baseA'),
        person('b1', 'B', 'baseB'),
      ],
      wallets: { A: 7, B: 6 },
      ...over,
    })

  it('상자에 안 쓰고 남은 것의 절반을 내림해서 돌려준다', () => {
    const back = absenceRefunds(idle({ actedBy: ['b1'] }), TEAM_IDS)
    expect(back.A).toBe(3)
  })

  it('한 명이라도 움직였으면 그 팀은 결석이 아니다', () => {
    // 남은 사람이 대신 움직일 수 있었다는 뜻이다. 개인 사정까지
    // 메워 주면 안 들어오는 편이 이득이 된다
    expect(absenceRefunds(idle({ actedBy: ['a2'] }), TEAM_IDS).A).toBeUndefined()
  })

  it('움직인 팀에게는 아무것도 없다', () => {
    expect(absenceRefunds(idle({ actedBy: ['b1'] }), TEAM_IDS).B).toBeUndefined()
  })

  it('상자에 하나 남았으면 절반이 0이라 아무것도 안 준다', () => {
    const s = board({ people: [person('c1', 'C', 'baseC')], wallets: { C: 1 } })
    expect(absenceRefunds(s, TEAM_IDS)).toEqual({})
  })
})

describe('움직인 사람 기록', () => {
  it('성공한 행동은 남고, 거절된 것은 안 남는다', () => {
    const s0 = board({
      people: [
        person('a', 'A', 'baseA'),
        person('b', 'B', 'baseB'),
        person('x', 'C', 'cafeteria'),
        person('y', 'C', 'cafeteria'),
      ],
    })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'hallway' })
    expect(s1.actedBy).toEqual(['a'])
    // 급식실이 꽉 차 거절된다 — 움직인 것으로 치지 않는다
    const bad = doAct(s1, 'b', { kind: 'move', targetTile: 'cafeteria' })
    expect(bad.ok).toBe(false)
  })

  it('한 사람이 여러 번 해도 한 번만 적힌다', () => {
    let s = board({ people: [person('a', 'A', 'baseA')] })
    s = must(s, 'a', { kind: 'disguise' })
    const before = s.actedBy.length
    s = must(s, 'a', { kind: 'move', targetTile: 'cafeteria' })
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
  })

  it('아무도 없으면 주인이 없어진다 — 전 주인도 남지 않는다', () => {
    expect(ownerOf({}, 'D')).toBeNull()
    expect(ownerOf({ A: 0 }, 'D')).toBeNull()
  })
})

describe('방해와 위장에는 물건이 든다', () => {
  /** 아무도 아무것도 안 가진 판. 주머니는 사람마다다. */
  const empty = { a: {}, b: {}, c: {} }

  it('토큰은 안 든다', () => {
    expect(ACT_COST.disturb).toBe(0)
    expect(ACT_COST.disguise).toBe(0)
  })

  it('호루라기가 없으면 방해를 못 한다 — 토큰도 안 든다', () => {
    const s = board({
      people: [person('a', 'A', 'storage'), person('b', 'B', 'storage')],
      satchels: empty,
    })
    const out = doAct(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('호루라기')
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
  })

  it('방해하면 호루라기가 하나 준다', () => {
    const s = board({
      people: [person('a', 'A', 'storage'), person('b', 'B', 'storage')],
      satchels: { ...empty, a: { whistle: 2 } },
    })
    const next = must(s, 'a', { kind: 'disturb', targetPlayer: 'b' })
    expect(next.satchels.a?.whistle).toBe(1)
    expect(next.zeroedPeople).toContain('b')
  })

  it('명찰이 없으면 위장을 못 한다', () => {
    const s = board({ people: [person('a', 'A', 'storage')], satchels: empty })
    const out = doAct(s, 'a', { kind: 'disguise' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('명찰')
  })

  it('위장하면 명찰이 하나 준다', () => {
    const s = board({ people: [person('a', 'A', 'storage')], satchels: { ...empty, a: { nameTag: 1 } } })
    const next = must(s, 'a', { kind: 'disguise' })
    expect(next.satchels.a?.nameTag).toBe(0)
    expect(next.disguised).toContain('a')
  })

  it('거절당한 방해는 물건을 먹지 않는다', () => {
    const s = board({ people: [person('a', 'A', 'storage')], satchels: { ...empty, a: { whistle: 1 } } })
    const out = doAct(s, 'a', { kind: 'disturb', targetPlayer: 'nobody' })
    expect(out.ok).toBe(false)
    expect(s.satchels.a?.whistle).toBe(1)
  })

  it('**같은 팀이라도 남의 물건은 못 쓴다**', () => {
    // 주머니가 팀 것이던 때에는 상점에 다녀온 사람과 쓰는 사람이
    // 달라도 됐다. 멀리 나가 사 온 것을 기지에 앉은 사람이 쓴다
    const s = board({
      people: [person('a', 'A', 'storage'), person('c', 'A', 'storage'), person('b', 'B', 'storage')],
      satchels: { ...empty, a: { whistle: 1 } },
    })
    const out = doAct(s, 'c', { kind: 'disturb', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('호루라기')
    // a 는 제 것으로 할 수 있다
    expect(doAct(s, 'a', { kind: 'disturb', targetPlayer: 'b' }).ok).toBe(true)
  })

  it('물건은 페이즈를 넘어 남는다', () => {
    const s = board({ people: [person('a', 'A', 'storage')], satchels: { ...empty, a: { whistle: 3 } } })
    expect(settle(s).next.satchels.a?.whistle).toBe(3)
  })
})

describe('기지와 계단은 판정 밖이다', () => {
  it('아무도 안 서 있어도 기지는 제 팀 것이다', () => {
    const out = settle(board({ owners: { baseA: 'A' } })).next.owners
    expect(out.baseA).toBe('A')
  })

  it('남이 기지에 몰려 서도 안 뺏긴다', () => {
    const s = board({
      people: [person('b1', 'B', 'baseA'), person('b2', 'B', 'baseA'), person('b3', 'B', 'baseA')],
      owners: { baseA: 'A' },
    })
    expect(settle(s).next.owners.baseA).toBe('A')
  })

  it('계단에는 아예 설 수가 없다 — 칸이 아니다', () => {
    // 전에는 계단이 칸이라 「서 있어도 아무도 못 가진다」를 재야 했다.
    // 이제는 갈 수 있는 자리 목록에 없다
    expect(TILES.some((t) => t.id.startsWith('stair'))).toBe(false)
    const s = board({ people: [person('a', 'A', 'centralPlaza')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'stair_f1_w' as never })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('그런 방은 없다')
  })
})

describe('A의 기록이 열기 전에는 핵심을 못 가진다', () => {
  const shut = { openedTiles: [] as string[] }

  it('열리지 않은 핵심은 아무리 서 있어도 안 넘어간다', () => {
    const s = board({
      people: [person('a', 'A', 'auditorium'), person('a2', 'A', 'auditorium')],
      owners: { auditorium: null },
      ...shut,
    })
    expect(settle(s).next.owners.auditorium).toBeNull()
  })

  it('첫날 아침 2-3 교실에 열넷이 서 있어도 주인이 안 생긴다', () => {
    const s = board({
      people: [person('a', 'A', 'centralPlaza'), person('a2', 'A', 'centralPlaza'), person('b', 'B', 'centralPlaza')],
      owners: { centralPlaza: null },
      ...shut,
    })
    expect(settle(s).next.owners.centralPlaza).toBeNull()
  })

  it('열린 뒤에는 보통 방과 같다', () => {
    const s = board({
      people: [person('a', 'A', 'auditorium')],
      owners: { auditorium: null },
      openedTiles: ['auditorium'],
    })
    expect(settle(s).next.owners.auditorium).toBe('A')
  })

  it('열리기 전이라도 이미 주인이 있으면 그대로 둔다', () => {
    const s = board({ owners: { auditorium: 'B' }, ...shut })
    expect(settle(s).next.owners.auditorium).toBe('B')
  })
})

describe('자물쇠', () => {
  const locked = { locks: { classroom: 'B' as const } }

  it('잠근 팀이 아니면 못 들어간다', () => {
    const s = board({ people: [person('a', 'A', 'centralPlaza')], ...locked })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('잠겨')
  })

  it('잠근 팀은 드나든다', () => {
    const s = board({ people: [person('b', 'B', 'centralPlaza')], ...locked })
    expect(doAct(s, 'b', { kind: 'move', targetTile: 'classroom' }).ok).toBe(true)
  })

  it('자물쇠가 없으면 그냥 들어간다 — 시험이 거짓말을 하고 있지 않다', () => {
    const s = board({ people: [person('a', 'A', 'centralPlaza')] })
    expect(doAct(s, 'a', { kind: 'move', targetTile: 'classroom' }).ok).toBe(true)
  })

  it('거절은 토큰을 안 먹는다', () => {
    const s = board({ people: [person('a', 'A', 'centralPlaza')], ...locked })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'classroom' })
    expect(out.ok).toBe(false)
    // 다음 걸음이 그대로 가능해야 한다. 값이 먹혔으면 여기서 드러난다
    expect(doAct(s, 'a', { kind: 'move', targetTile: 'artRoom' }).ok).toBe(true)
  })

  it('**부르는 것도 걸음이다** — 잠긴 방으로는 불려 들어가지 않는다', () => {
    const s = board({
      people: [person('b', 'B', 'classroom'), person('b1', 'B', 'centralPlaza')],
      locks: { classroom: 'A' },
    })
    const out = doAct(s, 'b', { kind: 'summon', targetPlayer: 'b1' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('잠겨')
  })
})
