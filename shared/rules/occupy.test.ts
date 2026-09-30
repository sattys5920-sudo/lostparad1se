// 점령 규칙. 페이즈는 한 시간짜리 라이브 판이고, 행동은 그때그때 처리된다.
//
// 여기서 지키려는 것은 두 가지다. **토큰을 쓴 만큼만 움직인다**는 것과,
// **끝나는 순간 꽂힌 깃발과 로봇으로만 주인이 정해진다**는 것.
import { describe, expect, it } from 'vitest'

import {
  ACT_COST,
  costOf,
  ENTER_COST,
  MAX_CARRIED_ROBOTS,
  KNOWLEDGE_PER_RESEARCH,
  KNOWLEDGE_PER_RESEARCH_OWNER,
  ROOM_CAPACITY,
  TOKEN_CAP,
  ROOM_KIND,
  TOKENS_PER_PHASE,
  arrive,
  capacityOf,
  doAct,
  nextWallet,
  walletOf,
  ownerOf,
  robotsIn,
  roomsOf,
  teamRanks,
  robotsCarriedBy,
  canCollectRobot,
  researchKnowledge,
  vaultOf,
  robotsOfTeam,
  settle,
  stepToward,
  type Act,
  type PhaseState,
  type Person,
  type Robot,
} from './occupy'
import { TILES, isAdjacent, type TileId } from './board'
import { TEAM_IDS, type TeamId } from './v2'
import { PULL_COST, PULL_HITS, type FlagMap } from './flag'

const person = (playerId: string, team: TeamId, tileId: string): Person => ({
  playerId,
  team,
  tileId,
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
  flags: {},
  // 깃발 상자도 넉넉히. 모자란 경우는 따로 쓴다
  flagBoxes: Object.fromEntries(TEAM_IDS.map((t) => [t, 9])),
  flagPullHits: {},
  smashedBy: [],
  actedBy: [],
  // 시험에서는 금고도 주머니도 넉넉하다고 본다. 모자란 경우는 따로 쓴다
  // **금고는 팀마다다.** 네 팀 다 넉넉히 채워 둔다
  vaults: Object.fromEntries(TEAM_IDS.map((t) => [t, { money: 99, knowledge: 99 }])),
  // 주머니는 **사람마다**다. 시험에 나오는 이름을 넉넉히 채워 둔다
  satchels: Object.fromEntries(
    ['a', 'b', 'c', 'x', 'y', 'a1', 'a2', 'b1', 'c1'].map((id) => [id, { lock: 9, whistle: 9, screwdriver: 9 }]),
  ),
  // 상자도 한 사람 몫만큼 넣어 둔다. 모자란 경우는 따로 쓴다
  wallets: Object.fromEntries(TEAM_IDS.map((t) => [t, TOKENS_PER_PHASE])),
  // 시험은 따로 적지 않는 한 핵심이 다 열린 판으로 본다
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

describe('토큰이 한 페이즈의 전부다', () => {
  it('다른 방에 들어가면 토큰이 하나 준다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA')] })
    const s1 = must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' })
    // **바로 도착하지 않는다.** 걷는 데 5분
    expect(at(s1, 'a').tileId).toBeNull()
    expect(at(s1, 'a').toTile).toBe('cafeteria')
    expect(purse(s1, 'A')).toBe(TOKENS_PER_PHASE - ACT_COST.move)
    const s2 = land(s1, 'a')
    expect(at(s2, 'a').tileId).toBe('cafeteria')
    expect(at(s2, 'a').toTile).toBeNull()
  })

  it('걷는 중에는 아무 방에도 없다 — 깃발을 못 꽂는다', () => {
    let s = board({ people: [person('a', 'A', 'library')], owners: { library: null } })
    s = must(s, 'a', { kind: 'move', targetTile: 'artRoom' })
    expect(doAct(s, 'a', { kind: 'plant' }).ok).toBe(false)
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
    // 연구는 지식만 든다. 방에 들어가는 것은 토큰이 든다
    expect(ACT_COST.move).toBeGreaterThan(ACT_COST.research)
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

  it('들고 있는 로봇은 가방 속이라 같이 간다 — 저쪽 방이 로봇으로 차 있어도', () => {
    const s0 = board({
      people: [person('a', 'B', 'gym')],
      robots: [
        robot('r1', 'B', 'gym', 'a'),
        robot('r2', 'B', 'gym', 'a'),
        robot('x1', 'A', 'cafeteria'),
        robot('x2', 'A', 'cafeteria'),
      ],
    })
    const s1 = land(must(s0, 'a', { kind: 'move', targetTile: 'cafeteria' }), 'a')
    expect(at(s1, 'a').tileId).toBe('cafeteria')
    const held = s1.robots.filter((r) => r.carriedBy === 'a')
    expect(held).toHaveLength(2)
    // 든 로봇은 사람을 따라 선다. 떠난 방에 남지도, 방 한도를 먹지도 않는다
    for (const r of held) expect(r.tileId).toBe('cafeteria')
    expect(robotsIn(s1, 'cafeteria')).toBe(2)
    expect(robotsIn(s1, 'gym')).toBe(0)
  })
})

describe('호출', () => {
  it('같은 팀 하나를 내 쪽으로 한 칸 끌어온다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')] })
    const s1 = land(must(s0, 'a', { kind: 'summon', targetPlayer: 'b' }), 'b')
    expect(at(s1, 'b').tileId).toBe(stepToward('library', 'baseA'))
  })

  it('**호루라기가 하나 든다** — 토큰은 안 든다', () => {
    const s0 = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')] })
    const s1 = must(s0, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(s1.satchels.a?.whistle).toBe(8)
    expect(purse(s1, 'A')).toBe(TOKENS_PER_PHASE)
    expect(ACT_COST.summon).toBe(0)
  })

  it('호루라기가 없으면 못 부른다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'library')], satchels: { a: {} } })
    const out = doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('호루라기')
  })

  it('**같은 팀이라도 남의 호루라기는 못 쓴다**', () => {
    const s = board({
      people: [person('a', 'A', 'baseA'), person('c', 'A', 'baseA'), person('b', 'A', 'library')],
      satchels: { a: { whistle: 1 }, c: {} },
    })
    expect(doAct(s, 'c', { kind: 'summon', targetPlayer: 'b' }).ok).toBe(false)
    expect(doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' }).ok).toBe(true)
  })

  it('못 부르면 호루라기를 안 먹는다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'baseA')], satchels: { a: { whistle: 1 } } })
    expect(doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' }).ok).toBe(false)
    expect(s.satchels.a?.whistle).toBe(1)
  })

  it('남의 팀은 못 부른다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'B', 'classroom')] })
    const out = doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('같은 분단')
  })

  it('이미 같은 방이면 부를 것이 없다', () => {
    const s = board({ people: [person('a', 'A', 'baseA'), person('b', 'A', 'baseA')] })
    expect(doAct(s, 'a', { kind: 'summon', targetPlayer: 'b' }).ok).toBe(false)
  })
})

describe('깃발 꽂기', () => {
  it('선 방에 우리 팀 깃발이 하나 꽂히고 상자에서 하나 빠진다', () => {
    const s = must(board({ people: [person('a', 'A', 'library')] }), 'a', { kind: 'plant' })
    expect(s.flags.library?.A).toBe(1)
    expect(s.flagBoxes.A).toBe(8)
  })

  it('**토큰은 안 든다** — 깃발이 든다', () => {
    const s = must(board({ people: [person('a', 'A', 'library')] }), 'a', { kind: 'plant' })
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
    expect(ACT_COST.plant).toBe(0)
  })

  it('상자가 비면 못 꽂는다', () => {
    const s = board({ people: [person('a', 'A', 'library')], flagBoxes: { A: 0 } })
    const out = doAct(s, 'a', { kind: 'plant' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('깃발이 없다')
  })

  it('**상자는 팀이 같이 쓴다** — 한 사람이 꽂으면 팀원 몫이 준다', () => {
    let s = board({ people: [person('a', 'A', 'library'), person('c', 'A', 'artRoom')], flagBoxes: { A: 1 } })
    s = must(s, 'a', { kind: 'plant' })
    expect(doAct(s, 'c', { kind: 'plant' }).ok).toBe(false)
  })

  it('**주인 팀이 서 있어도 꽂는다**', () => {
    const s = board({
      people: [person('a', 'A', 'library'), person('b1', 'B', 'library'), person('b2', 'B', 'library')],
      owners: { library: 'B' },
    })
    expect(doAct(s, 'a', { kind: 'plant' }).ok).toBe(true)
  })

  it('2-3 교실에는 못 꽂는다', () => {
    const out = doAct(board({ people: [person('a', 'A', 'centralPlaza')] }), 'a', { kind: 'plant' })
    expect(out.ok).toBe(false)
  })

  it('지워진 사람도 꽂는다 — 혼자 하는 일이다', () => {
    const s = board({ people: [person('a', 'A', 'library')], invisibleId: 'a' })
    expect(doAct(s, 'a', { kind: 'plant' }).ok).toBe(true)
  })

  it('**꽂은 깃발은 페이즈가 닫히면 사라진다** — 주인은 판정대로 남는다', () => {
    const s = must(board({ people: [person('a', 'A', 'library')] }), 'a', { kind: 'plant' })
    const done = settle(s).next
    expect(done.owners.library).toBe('A')
    expect(done.flags).toEqual({})
    // 다음 페이즈에 아무것도 없으면 전 주인이 그대로다
    expect(settle({ ...done, people: [] }).next.owners.library).toBe('A')
  })

  it('놓인 로봇은 페이즈가 닫혀도 남는다', () => {
    const s = board({ people: [person('a', 'A', 'library')], robots: [robot('r1', 'A', 'library')] })
    const done = settle(s).next
    expect(done.robots.map((r) => r.id)).toEqual(['r1'])
  })
})

describe('깃발 뽑기 — 서로 다른 두 사람이 손대야 한다', () => {
  const planted: FlagMap = { library: { B: 2, C: 1 } }
  const withTwo = (over: Partial<PhaseState> = {}) =>
    board({ people: [person('a', 'A', 'library'), person('a2', 'A', 'library')], flags: planted, ...over })

  it('한 사람이 손대면 1/2 — 아직 안 뽑힌다', () => {
    const s = must(withTwo(), 'a', { kind: 'pull' })
    expect(s.flags.library?.B).toBe(2)
    expect(s.flagPullHits.library?.B).toEqual(['a'])
  })

  it(`손댈 때마다 토큰이 ${PULL_COST}개 든다`, () => {
    const s = must(withTwo(), 'a', { kind: 'pull' })
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE - PULL_COST)
  })

  it(`서로 다른 두 사람이 손대면(${PULL_HITS}번째) 뽑힌다. 안 고르면 제일 많은 팀 것`, () => {
    let s = must(withTwo(), 'a', { kind: 'pull' })
    s = must(s, 'a2', { kind: 'pull' })
    expect(s.flags.library?.B).toBe(1)
    expect(s.flagPullHits.library?.B).toBeUndefined()
  })

  it('같은 사람이 두 번 손대는 것으로는 안 뽑힌다', () => {
    const s = must(withTwo(), 'a', { kind: 'pull' })
    const again = doAct(s, 'a', { kind: 'pull' })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.why).toContain('이미')
  })

  it('같은 팀일 필요는 없다 — 다른 팀 둘이 힘을 합쳐도 된다', () => {
    let s = board({ people: [person('a', 'A', 'library'), person('c', 'C', 'library')], flags: planted })
    s = must(s, 'a', { kind: 'pull' })
    s = must(s, 'c', { kind: 'pull' })
    expect(s.flags.library?.B).toBe(1)
  })

  it('깃발 주인 팀도 자기 걸 뽑는 데 손댈 수 있다(배신)', () => {
    const s = board({ people: [person('b', 'B', 'library'), person('a', 'A', 'library')], flags: { library: { B: 1 } } })
    expect(doAct(s, 'b', { kind: 'pull', targetTeam: 'B' }).ok).toBe(true)
  })

  it('로봇은 필요 없다', () => {
    const s = withTwo({ robots: [] })
    expect(doAct(s, 'a', { kind: 'pull' }).ok).toBe(true)
  })

  it('뽑다 만 것은 페이즈가 닫히면 같이 사라진다 — 깃발도 없다', () => {
    let s = must(withTwo(), 'a', { kind: 'pull' })
    s = settle(s).next
    expect(s.flagPullHits).toEqual({})
    expect(s.flags).toEqual({})
  })

  it('팀을 골라 뽑는다', () => {
    let s = must(withTwo(), 'a', { kind: 'pull', targetTeam: 'C' })
    s = must(s, 'a2', { kind: 'pull', targetTeam: 'C' })
    expect(s.flags.library?.C).toBeUndefined()
  })

  it('뽑을 것이 없으면 거절되고 토큰도 안 먹는다', () => {
    const s = withTwo({ flags: {} })
    expect(doAct(s, 'a', { kind: 'pull' }).ok).toBe(false)
    expect(purse(s, 'A')).toBe(TOKENS_PER_PHASE)
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
    // 거절은 드라이버를 물리지 않는다. 토큰은 원래 안 든다
    expect(ACT_COST.smashRobot).toBe(0)
    expect(purse(s, 'A')).toBe(99)
    expect(s.satchels.a?.screwdriver).toBe(8)
  })

  it('**드라이버가 없으면 못 부순다** — 한 기에 한 자루', () => {
    const s = board({
      people: [person('a', 'A', 'library')],
      robots: [robot('r1', 'B', 'library')],
      satchels: { a: {} },
    })
    const out = doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('드라이버')
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
    s = must(s, 'a', { kind: 'plant' })
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

describe('차지한 방은 드나드는 값이 없다', () => {
  it('우리 팀 방에 들어갈 때는 토큰이 안 든다', () => {
    expect(costOf({ owners: { baseB: 'A' } }, 'A', { kind: 'move', targetTile: 'baseB' as TileId })).toBe(0)
  })
  it('남의 방·빈 방은 전처럼 든다', () => {
    expect(costOf({ owners: { baseB: 'B' } }, 'A', { kind: 'move', targetTile: 'baseB' as TileId })).toBe(ENTER_COST)
    expect(costOf({ owners: {} }, 'A', { kind: 'move', targetTile: 'baseB' as TileId })).toBe(ENTER_COST)
  })
  it('연구는 토큰이 안 든다 — 지식만', () => {
    expect(ACT_COST.research).toBe(0)
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
      { playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, tileId: lab.id },
    ])
  })

  it('**분단 한도는 없다** — 로봇이 여럿 있어도 연구를 건다', () => {
    const many = Array.from({ length: 10 }, (_, i) => robot(`r${i}`, 'A', 'baseA'))
    const s = board({ people: [person('a', 'A', lab.id)], robots: many })
    expect(robotsOfTeam(s, 'A')).toBe(10)
    expect(doAct(s, 'a', { kind: 'research' }).ok).toBe(true)
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
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, tileId: lab.id }],
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
  const withVault = (knowledge: number, over: Partial<PhaseState> = {}) =>
    board({
      people: [person('a', 'A', lab2.id)],
      vaults: { A: { money: 0, knowledge } },
      ...over,
    })

  it('연구실을 차지했으면 1, 아니면 3이다', () => {
    expect(researchKnowledge(false)).toBe(KNOWLEDGE_PER_RESEARCH)
    expect(researchKnowledge(true)).toBe(KNOWLEDGE_PER_RESEARCH_OWNER)
  })

  it('걸 때 바로 뺀다 — 완성될 때 빼면 없는 지식으로 넷이 연구한다', () => {
    const s = must(withVault(5), 'a', { kind: 'research' })
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
    expect(s.pendingResearch).toEqual([
      { playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, tileId: lab2.id },
    ])
  })

  it('우리 연구실이면 한 점만 들고, 그 한 점은 아무도 안 받는다', () => {
    const s = must(withVault(5, { owners: { [lab2.id]: 'A' } }), 'a', { kind: 'research' })
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH_OWNER)
  })

  /**
   * **낸 지식은 사라진다.** 주인 팀도 안 받는다.
   *
   * 연구실을 쥐는 값은 받는 것이 아니라 **덜 내는 것**이다 —
   * 우리 연구실이면 한 점, 남의 것이면 두 점.
   */
  it('남의 연구실에 낸 두 점은 아무에게도 안 간다', () => {
    const s = must(
      board({
        people: [person('a', 'A', lab2.id), person('b', 'B', lab2.id), person('b1', 'B', lab2.id)],
        owners: { [lab2.id]: 'B' },
        vaults: {
          A: { money: 0, knowledge: 5 },
          B: { money: 0, knowledge: 4 },
        },
      }),
      'a',
      { kind: 'research' },
    )
    expect(vaultOf(s, 'A').knowledge).toBe(5 - KNOWLEDGE_PER_RESEARCH)
    // 주인 팀은 한 점도 안 는다
    expect(vaultOf(s, 'B').knowledge).toBe(4)
  })

  /** **금고는 팀에 하나다.** 누가 벌었든 넷 중 누구든 꺼내 쓴다 */
  it('같은 팀 금고를 넷이 같이 쓴다 — 먼저 건 사람이 임자다', () => {
    const lab3 = TILES.filter((t) => ROOM_KIND[t.id] === 'lab')[0]
    const s0 = board({
      people: [person('a', 'A', lab3.id), person('a2', 'A', lab3.id)],
      vaults: { A: { money: 0, knowledge: KNOWLEDGE_PER_RESEARCH } },
    })
    const s1 = must(s0, 'a2', { kind: 'research' })
    expect(vaultOf(s1, 'A').knowledge).toBe(0)
    const out = doAct(s1, 'a', { kind: 'research' })
    expect(out.ok).toBe(false)
  })

  it('아무도 안 쥔 연구실이면 세 점이 그냥 사라진다', () => {
    const s = must(withVault(5), 'a', { kind: 'research' })
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

  /** 낸 지식은 **돌아오지 않는다.** 판에서 빠져나간 값이다. */
  it('안 익은 채로 닫혀도 낸 지식은 안 돌아온다', () => {
    const s = board({
      people: [person('a', 'A', lab2.id), person('b', 'B', lab2.id)],
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, tileId: lab2.id }],
      vaults: { A: { money: 0, knowledge: 0 }, B: { money: 0, knowledge: 0 } },
    })
    const done = settle(s).next
    expect(vaultOf(done, 'A').knowledge).toBe(0)
    // 주인 팀에도 안 간다 — 아무 데도 안 간다
    expect(vaultOf(done, 'B').knowledge).toBe(0)
  })
})

describe('로봇 놓기', () => {
  it('2-3 교실에는 못 놓는다 — 깃발을 못 꽂는 방이라 판정에서 안 센다', () => {
    const s = board({
      people: [person('a', 'A', 'centralPlaza')],
      robots: [robot('mine', 'A', 'centralPlaza', 'a')],
    })
    const out = doAct(s, 'a', { kind: 'dropRobot' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('로봇을 못 놓는다')
  })

  it('**방 한도는 없다** — 이미 여럿 놓인 방에도 놓는다', () => {
    const s = board({
      people: [person('a', 'A', 'storage')],
      robots: [
        robot('mine', 'A', 'storage', 'a'),
        robot('x1', 'B', 'storage'),
        robot('x2', 'B', 'storage'),
        robot('x3', 'C', 'storage'),
      ],
    })
    expect(doAct(s, 'a', { kind: 'dropRobot' }).ok).toBe(true)
  })

  it('들고 있는 것은 방 한도를 안 먹는다 — 둘 들고 와도 둘 다 놓는다', () => {
    let s = board({
      people: [person('a', 'A', 'storage')],
      robots: [robot('m1', 'A', 'storage', 'a'), robot('m2', 'A', 'storage', 'a')],
    })
    expect(robotsIn(s, 'storage')).toBe(0)
    s = must(s, 'a', { kind: 'dropRobot' })
    s = must(s, 'a', { kind: 'dropRobot' })
    expect(robotsIn(s, 'storage')).toBe(2)
    expect(ACT_COST.dropRobot).toBe(0)
  })

  it('고른 로봇을 놓는다 — 남이 든 것은 못 고른다', () => {
    let s = board({
      people: [person('a', 'A', 'storage'), person('a2', 'A', 'storage')],
      robots: [robot('m1', 'A', 'storage', 'a'), robot('m2', 'A', 'storage', 'a'), robot('o1', 'A', 'storage', 'a2')],
    })
    const bad = doAct(s, 'a', { kind: 'dropRobot', targetRobot: 'o1' })
    expect(bad.ok).toBe(false)
    s = must(s, 'a', { kind: 'dropRobot', targetRobot: 'm2' })
    expect(s.robots.find((r) => r.id === 'm2')).toMatchObject({ carriedBy: null, placedBy: 'a', tileId: 'storage' })
    expect(s.robots.find((r) => r.id === 'm1')?.carriedBy).toBe('a')
  })
})

describe('로봇 수거 — 놓은 사람만', () => {
  const placed = (id: string, team: TeamId, tileId: string, by: string): Robot => ({
    ...robot(id, team, tileId),
    placedBy: by,
  })

  it('놓은 사람은 도로 든다 — 토큰 없이', () => {
    let s = board({ people: [person('a', 'A', 'storage')], robots: [placed('m1', 'A', 'storage', 'a')] })
    expect(ACT_COST.takeRobot).toBe(0)
    s = must(s, 'a', { kind: 'takeRobot' })
    expect(s.robots[0]).toMatchObject({ carriedBy: 'a', placedBy: null })
    expect(robotsIn(s, 'storage')).toBe(0)
    expect(robotsCarriedBy(s, 'a')).toBe(1)
  })

  it('같은 팀이어도 남이 놓은 것은 못 거둔다', () => {
    const s = board({
      people: [person('a', 'A', 'storage'), person('a2', 'A', 'storage')],
      robots: [placed('m1', 'A', 'storage', 'a')],
    })
    const pick = doAct(s, 'a2', { kind: 'takeRobot', targetRobot: 'm1' })
    expect(pick.ok).toBe(false)
    if (!pick.ok) expect(pick.why).toContain('놓은 사람만')
    expect(doAct(s, 'a2', { kind: 'takeRobot' }).ok).toBe(false)
  })

  it('남의 팀 로봇은 거두지 못한다 — 부숴야 없어진다', () => {
    const s = board({ people: [person('b', 'B', 'storage')], robots: [placed('m1', 'A', 'storage', 'a')] })
    expect(doAct(s, 'b', { kind: 'takeRobot', targetRobot: 'm1' }).ok).toBe(false)
    expect(doAct(s, 'b', { kind: 'smashRobot', targetRobot: 'm1' }).ok).toBe(true)
  })

  it('이미 두 기 들었으면 더 못 든다', () => {
    const s = board({
      people: [person('a', 'A', 'storage')],
      robots: [robot('h1', 'A', 'storage', 'a'), robot('h2', 'A', 'storage', 'a'), placed('m1', 'A', 'storage', 'a')],
    })
    const out = doAct(s, 'a', { kind: 'takeRobot' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain(`${MAX_CARRIED_ROBOTS} 기`)
  })

  it('놓은 사람이 적히지 않은 옛 로봇은 같은 팀이 거둔다', () => {
    const s = board({ people: [person('a2', 'A', 'storage')], robots: [robot('old', 'A', 'storage')] })
    expect(doAct(s, 'a2', { kind: 'takeRobot' }).ok).toBe(true)
  })

  it('canCollectRobot — 든 로봇은 거둘 대상이 아니다', () => {
    expect(canCollectRobot(robot('r', 'A', 'storage', 'a'), 'a', 'A')).toBe(false)
    expect(canCollectRobot(placed('r', 'A', 'storage', 'a'), 'a', 'A')).toBe(true)
    expect(canCollectRobot(placed('r', 'A', 'storage', 'a'), 'a2', 'A')).toBe(false)
  })
})

describe('점령해도 드나드는 것은 못 막는다', () => {
  /*
   * **점령은 문이 아니다.** 남의 칸이라고 못 들어가면 한 번 가져간
   * 방은 영영 그 팀 것이다. 막는 것은 자물쇠(물건)와 정원뿐이다.
   */
  it('남의 칸으로 걸어 들어간다', () => {
    const s = board({
      people: [person('a', 'A', 'artRoom')],
      owners: { library: 'B' },
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'library' })
    expect(out.ok).toBe(true)
  })

  it('들어가서 깃발을 더 꽂으면 뺏는다', () => {
    let s = board({
      people: [person('a1', 'A', 'library'), person('a2', 'A', 'library')],
      owners: { library: 'B' },
      flags: { library: { B: 1 } },
    })
    s = must(s, 'a1', { kind: 'plant' })
    expect(settle(s).next.owners.library).toBe('B')
    s = must(s, 'a2', { kind: 'plant' })
    expect(settle(s).next.owners.library).toBe('A')
  })

  /** 막는 것은 자물쇠뿐이다 — 그것도 한 시간이고 물건을 써야 한다 */
  it('잠긴 문만 막는다', () => {
    const s = board({
      people: [person('a', 'A', 'artRoom')],
      owners: { library: 'B' },
      locks: { library: 'B' },
    })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'library' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('잠겨')
  })
})

describe('닫으면 깃발과 로봇으로 주인이 정해진다', () => {
  it('많은 쪽이 가져간다 — 파랑 둘, 빨강 하나면 파랑', () => {
    const s = board({ flags: { library: { B: 2, A: 1 } }, owners: { library: null } })
    expect(settle(s).next.owners.library).toBe('B')
  })

  it('**서 있는 사람은 안 센다** — 셋이 서 있어도 깃발 하나에 진다', () => {
    const s = board({
      people: [person('a1', 'A', 'library'), person('a2', 'A', 'library'), person('a3', 'A', 'library')],
      flags: { library: { B: 1 } },
      owners: { library: 'A' },
    })
    expect(settle(s).next.owners.library).toBe('B')
  })

  it('동점이면 주인이 그대로다', () => {
    expect(settle(board({ flags: { library: { A: 1, B: 1 } }, owners: { library: 'A' } })).next.owners.library).toBe('A')
    expect(settle(board({ flags: { library: { A: 1, B: 1 } }, owners: { library: null } })).next.owners.library).toBeNull()
  })

  it('아무것도 없으면 전 주인이 그대로 쥔다', () => {
    expect(settle(board({ owners: { library: 'C' } })).next.owners.library).toBe('C')
  })

  it('로봇은 깃발 하나로 센다 — 깃발 하나와 로봇 하나면 둘', () => {
    const s = board({
      flags: { library: { A: 1, B: 1 } },
      robots: [robot('r1', 'A', 'library')],
      owners: { library: 'B' },
    })
    expect(settle(s).next.owners.library).toBe('A')
  })

  it('**들고 있는 로봇은 안 센다** — 놓아야 깃발이다', () => {
    const s = board({
      people: [person('a', 'A', 'library')],
      flags: { library: { B: 1 } },
      robots: [robot('r1', 'A', 'library', 'a'), robot('r2', 'A', 'library', 'a')],
      owners: { library: null },
    })
    expect(settle(s).next.owners.library).toBe('B')
    const put = must(must(s, 'a', { kind: 'dropRobot' }), 'a', { kind: 'dropRobot' })
    expect(settle(put).next.owners.library).toBe('A')
  })

  it('걸어 둔 연구는 판정에 안 낀다 — 로봇이 아직 없다', () => {
    const s = board({
      people: [person('a', 'A', lab.id)],
      flags: { [lab.id]: { B: 1 } },
      owners: { [lab.id]: null },
      pendingResearch: [{ playerId: 'a', knowledge: KNOWLEDGE_PER_RESEARCH, tileId: lab.id }],
    })
    const done = settle(s)
    expect(done.next.owners[lab.id]).toBe('B')
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

  // 전에는 5×5 격자라 네 귀퉁이에서 중앙까지 걸음 수가 똑같았다. 층이
  // 생기면서 그 대칭은 없어졌다 — 대신 **어느 구석에서든 닿기는 한다**
  it('어느 구석에서든 2-3 교실까지 길이 있다', () => {
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
  it('꽂는 것은 혼자 하는 일이라 된다', () => {
    const s = board({ people: [person('b', 'B', 'library')], flagBoxes: { B: 1 }, invisibleId: 'b' })
    expect(doAct(s, 'b', { kind: 'plant' }).ok).toBe(true)
  })

  it('뽑는 것은 여전히 안 된다', () => {
    const s = board({
      people: [person('b', 'B', 'library'), person('b2', 'B', 'library')],
      flags: { library: { A: 1 } },
      invisibleId: 'b',
    })
    expect(doAct(s, 'b', { kind: 'pull' }).ok).toBe(false)
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

  it('투명인간이 든 로봇은 가방 속이라 못 부순다 — 놓인 것만 부순다', () => {
    const s = board({
      people: [person('a', 'A', 'library'), person('b', 'B', 'library')],
      robots: [robot('r1', 'B', 'library', 'b'), robot('r2', 'B', 'library')],
      invisibleId: 'b',
    })
    expect(doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r1' }).ok).toBe(false)
    expect(doAct(s, 'a', { kind: 'smashRobot', targetRobot: 'r2' }).ok).toBe(true)
  })

  it('혼자 하는 일은 그대로 된다 — 걷기·로봇 만들기', () => {
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
    if (!out.ok) expect(out.why).toContain('분단 토큰')
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
  it('팀 상자에 페이즈마다 여섯', () => {
    expect(TOKENS_PER_PHASE).toBe(6)
    expect(nextWallet({ held: 0 })).toBe(6)
  })

  /*
   * **인원을 안 본다.** 전에는 1인당 넷씩 주고 인원을 곱해서 4인 팀
   * 16, 3인 팀 15였다. 곱셈이 돌아오면 이 시험이 먼저 깨진다.
   */
  it('세 명짜리 팀도 네 명짜리 팀도 똑같이 여섯', () => {
    expect(nextWallet({ held: 0 })).toBe(TOKENS_PER_PHASE)
    expect(nextWallet({ held: 0 })).not.toBe(TOKENS_PER_PHASE * 4)
  })

  it('**보유 최대는 12** — 남은 것에 여섯을 얹고 12 로 자른다', () => {
    expect(TOKEN_CAP).toBe(12)
    expect(nextWallet({ held: 2 })).toBe(8)
    expect(nextWallet({ held: 6 })).toBe(12)
    expect(nextWallet({ held: 9 })).toBe(12)
    expect(nextWallet({ held: TOKEN_CAP + 5 })).toBe(TOKEN_CAP)
  })

  it('상자 한도는 두 페이즈치다', () => {
    expect(TOKEN_CAP).toBe(TOKENS_PER_PHASE * 2)
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
    s = must(s, 'a', { kind: 'plant' })
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
  it('쥔 방은 다 센다 — **빼는 방이 없다**', () => {
    // 기지를 없앴다. 거저 받는 방이 없으니 뺄 것도 없다
    const owners = { baseA: 'A', classroom: 'A', hallway: 'A' } as const
    expect(roomsOf(owners, 'A')).toBe(3)
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

  it('아무도 없으면 전 주인이 그대로다 — 빈 방이 되지 않는다', () => {
    expect(ownerOf({}, 'D')).toBe('D')
    expect(ownerOf({ A: 0 }, 'D')).toBe('D')
    expect(ownerOf({}, null)).toBeNull()
  })
})

describe('물건은 페이즈를 넘어 남는다', () => {
  it('닫혀도 주머니는 그대로다', () => {
    const s = board({ people: [person('a', 'A', 'storage')], satchels: { a: { lock: 3 } } })
    expect(settle(s).next.satchels.a?.lock).toBe(3)
  })
})

describe('못 박힌 방은 없다', () => {
  /*
   * **기지를 없앴다.** 스물다섯 방이 전부 같은 규칙을 받는다 — 깃발을
   * 더 꽂은 팀의 것이다.
   */
  it('깃발이 없어도 전 주인이 그대로 쥔다 — 기지든 아니든 같은 규칙', () => {
    const out = settle(board({ owners: { baseA: 'A' } })).next.owners
    expect(out.baseA).toBe('A')
  })

  it('남이 더 꽂으면 뺏긴다 — 전에는 기지라고 안 뺏겼다', () => {
    const s = board({ flags: { baseA: { B: 3, A: 1 } }, owners: { baseA: 'A' } })
    expect(settle(s).next.owners.baseA).toBe('B')
  })

  it('계단에는 아예 설 수가 없다 — 칸이 아니다', () => {
    expect(TILES.some((t) => t.id.startsWith('stair'))).toBe(false)
    const s = board({ people: [person('a', 'A', 'centralPlaza')] })
    const out = doAct(s, 'a', { kind: 'move', targetTile: 'stair_f1_w' as never })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toContain('그런 방은 없다')
  })
})

describe('방은 처음부터 다 열려 있다', () => {
  it('핵심도 첫 페이즈부터 넘어간다', () => {
    const s = must(board({ people: [person('a', 'A', 'auditorium')] }), 'a', { kind: 'plant' })
    expect(settle(s).next.owners.auditorium).toBe('A')
  })

  it('열넷이 시작하는 방 말고는 다 넘어간다', () => {
    const s = board({ flags: { playground: { A: 1 }, library: { B: 1 } } })
    const out = settle(s).next.owners
    expect(out.playground).toBe('A')
    expect(out.library).toBe('B')
  })
})

describe('2-3 교실은 아무도 못 가진다', () => {
  // 열넷이 아침마다 모이는 방이다. 깃발도 못 꽂는다

  it('어쩌다 깃발이 적혀 있어도 주인이 안 생긴다', () => {
    const s = board({ flags: { centralPlaza: { A: 3 } }, owners: { centralPlaza: null } })
    expect(settle(s).next.owners.centralPlaza).toBeNull()
  })

  it('어쩌다 주인이 적혀 있었어도 지워진다', () => {
    const s = board({ owners: { centralPlaza: 'B' } })
    expect(settle(s).next.owners.centralPlaza).toBeNull()
  })

  it('서 있는 것 자체는 막지 않는다 — 아침에 열넷이 여기 모인다', () => {
    const s = board({
      people: [person('a', 'A', 'centralPlaza'), person('b', 'B', 'centralPlaza')],
    })
    expect(settle(s).next.people).toHaveLength(2)
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
