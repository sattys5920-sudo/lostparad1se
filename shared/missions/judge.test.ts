// 판정 엔진. **경계에서 갈리는지**를 본다.
//
// 「3번 이상」은 2에서 안 되고 3에서 돼야 한다. 하나 모자란 자리와
// 딱 맞는 자리를 나란히 놓는다 — 둘 중 하나만 보면 부등호가 뒤집혀
// 있어도 통과한다.
//
// 공개 정책도 여기서 본다. 가려야 할 값이 문서에 **들어 있지 않은지**
// 까지 본다 — 받아서 가리는 방식이면 개발자도구로 다 보인다.
import { describe, expect, it } from 'vitest'
import { judge, type BallotDay, type BallotVote, type GameLog, type JudgeVote } from './judge'
import type { Assignment } from './assign'
import { ROLES, ROLE_BY_ID, type ClauseKind, type RoleId } from './roles'
import type { GameRecord, RecordKind } from '../rules/records'
import type { Interval } from '../rules/presence'
import type { TeamId } from '../rules/v2'

const START = new Date('2026-03-02T08:00:00+09:00').getTime()
const MIN = 60_000

const TEAM_OF: Record<string, TeamId> = {
  me: 'A', a2: 'A', a3: 'A', a4: 'A',
  b1: 'B', b2: 'B', b3: 'B', b4: 'B',
  c1: 'C', c2: 'C', c3: 'C',
  d1: 'D', d2: 'D', d3: 'D',
}
const EVERYONE = Object.keys(TEAM_OF)

function log(over: Partial<GameLog> = {}): GameLog {
  return {
    startedAtMs: START,
    nowMs: START + 5 * 24 * 60 * MIN,
    over: true,
    teamOf: (id) => TEAM_OF[id] ?? 'A',
    roster: EVERYONE,
    intervals: [],
    votes: [],
    ballots: [],
    ballotDays: [],
    records: [],
    ownerChanges: [],
    teamTiedRank: { A: 2, B: 1, C: 3, D: 4 },
    slipsHeldAtEnd: {},
    ...over,
  }
}

const me = (roleId: RoleId, targetId: string | null = null): Assignment => ({
  playerId: 'me',
  team: 'A',
  roleId,
  targetId,
})

/** 내가 한 일 n번. */
function did(kind: RecordKind, n: number, extra: Partial<GameRecord> = {}): GameRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    kind,
    atMs: START + i * MIN,
    actorId: 'me',
    actorTeam: 'A' as TeamId,
    subjectId: `s${i}`,
    ...extra,
  }))
}

/** 두 사람이 같은 방에 함께 있은 구간. */
function together(a: string, b: string, minutes: number, tileId = 'library'): Interval[] {
  const span = { startMs: START, endMs: START + minutes * MIN, state: 'standing' as const, tileId }
  return [
    { playerId: a, ...span },
    { playerId: b, ...span },
  ]
}

const mainOf = (roleId: RoleId, over: Partial<GameLog>, targetId: string | null = null) =>
  judge(me(roleId, targetId), log(over)).main

/**
 * 데이터 파일의 조항. **기준치는 여기서 읽는다** — 시험이 숫자를 박아 두면
 * 난이도를 고칠 때마다 시험이 깨지고, 경계를 보는 뜻도 흐려진다.
 */
function clauseOf(roleId: RoleId, kind: ClauseKind) {
  const clauses = ROLE_BY_ID[roleId].main.clauses
  const index = clauses.findIndex((c) => c.kind === kind)
  if (index < 0) throw new Error(`${roleId}에 ${kind} 조항이 없다`)
  return { ...clauses[index], index }
}
const needOf = (roleId: RoleId, kind: ClauseKind): number => {
  const n = clauseOf(roleId, kind).need
  if (n === undefined) throw new Error(`${roleId} · ${kind}에 need 가 없다`)
  return n
}
const minutesOf = (roleId: RoleId, kind: ClauseKind): number => {
  const m = clauseOf(roleId, kind).minutes
  if (m === undefined) throw new Error(`${roleId} · ${kind}에 minutes 가 없다`)
  return m
}

// ── 경계 ────────────────────────────────────────────────────────

describe('셈이 경계에서 갈린다', () => {
  // 역할 · 조항 · 그 조항이 세는 기록 · 기록에 덧붙일 것
  const counts: [RoleId, ClauseKind, RecordKind, Partial<GameRecord>?][] = [
    ['deskmate', 'slipsRead', 'slipRead'],
    ['bookclub', 'slipsRead', 'slipRead'],
    ['bookclub', 'slipsGiven', 'slipGive'],
    ['cleanup', 'slipsTorn', 'slipTear'],
    ['duty', 'errandsDone', 'errandDone'],
    ['gardener', 'harvests', 'potHarvest'],
    ['science', 'robotsMade', 'researchStart'],
    ['tech', 'robotsSmashedOfOthers', 'robotSmashed', { otherTeam: 'B' }],
    ['topstudent', 'quizzesSolved', 'quizSolved'],
    ['treasurer', 'vendBuys', 'vendBuy'],
  ]

  for (const [roleId, clauseKind, kind, extra] of counts) {
    const { index, text } = clauseOf(roleId, clauseKind)
    const need = needOf(roleId, clauseKind)
    it(`${ROLE_BY_ID[roleId].name} ${text} — ${need - 1}번은 안 되고 ${need}번은 된다`, () => {
      const short = mainOf(roleId, { records: did(kind, need - 1, extra) })
      const exact = mainOf(roleId, { records: did(kind, need, extra) })
      expect(short.clauses[index].met, '하나 모자랄 때').toBe(false)
      expect(short.clauses[index].have).toBe(need - 1)
      expect(exact.clauses[index].met, '딱 맞을 때').toBe(true)
      expect(exact.clauses[index].bar).toBe(need)
    })
  }
})

describe('반장 — 같은 방에 1분 이상', () => {
  const others = EVERYONE.filter((id) => id !== 'me')
  const need = needOf('classlead', 'sameRoomPeople')
  const minutes = minutesOf('classlead', 'sameRoomPeople')

  /** 나와 n명이 m분씩 같은 방에. */
  const withN = (n: number, minutes: number): Interval[] =>
    others.slice(0, n).flatMap((id, i) => together('me', id, minutes, `room${i}`))

  it(`${need - 1}명은 안 되고 ${need}명은 된다`, () => {
    expect(mainOf('classlead', { intervals: withN(need - 1, minutes * 5) }).met).toBe(false)
    expect(mainOf('classlead', { intervals: withN(need, minutes * 5) }).met).toBe(true)
  })

  it(`${minutes}분을 못 채운 사람은 안 센다`, () => {
    const brief = others.slice(0, 12).flatMap((id, i) => together('me', id, minutes / 2, `room${i}`))
    expect(mainOf('classlead', { intervals: brief }).clauses[0].have).toBe(0)
  })

  it('걷는 중은 같은 방이 아니다', () => {
    const walking: Interval[] = others.slice(0, 12).flatMap((id) => [
      { playerId: 'me', tileId: null, startMs: START, endMs: START + 60 * MIN, state: 'walking' as const },
      { playerId: id, tileId: null, startMs: START, endMs: START + 60 * MIN, state: 'walking' as const },
    ])
    expect(mainOf('classlead', { intervals: walking }).clauses[0].have).toBe(0)
  })

  it('잠든 사람도 같은 방에 있는 것으로 센다', () => {
    const span = { startMs: START, endMs: START + minutes * 5 * MIN }
    const asleep: Interval[] = others.slice(0, need).flatMap((id, i) => [
      { playerId: 'me', tileId: `room${i}`, ...span, state: 'standing' as const },
      { playerId: id, tileId: `room${i}`, ...span, state: 'asleep' as const },
    ])
    expect(mainOf('classlead', { intervals: asleep }).met).toBe(true)
  })
})

describe('모범생 — 신뢰표 둘, 서로 다른 두 팀에서', () => {
  const trustNeed = needOf('model', 'trustReceived')
  const teamsNeed = needOf('model', 'trustTeams')
  /** 팀을 번갈아 가며 — B · C · D · B · … */
  const spread = ['b1', 'c1', 'd1', 'b2', 'c2', 'd2', 'b3', 'c3', 'd3']
  const vote = (voterId: string): JudgeVote => ({
    voterId,
    targetId: 'me',
    kind: 'trust',
    day: 1,
    atMs: START,
  })

  it('한 팀에서만 받으면 장수가 차도 모자라다', () => {
    const m = mainOf('model', { votes: ['b1', 'b2', 'b3', 'b4'].slice(0, trustNeed).map(vote) })
    expect(m.clauses[0].met, '장수').toBe(true)
    expect(m.clauses[1].have, '팀 수').toBe(1)
    expect(m.clauses[1].met, '팀 수').toBe(false)
    expect(m.met).toBe(false)
  })

  it(`${teamsNeed}팀에서 ${Math.max(trustNeed, teamsNeed)}장이면 된다`, () => {
    const votes = spread.slice(0, Math.max(trustNeed, teamsNeed)).map(vote)
    expect(mainOf('model', { votes }).met).toBe(true)
  })

  it(`여러 팀이어도 ${trustNeed - 1}장이면 모자라다`, () => {
    const m = mainOf('model', { votes: spread.slice(0, trustNeed - 1).map(vote) })
    expect(m.clauses[0].met, '장수').toBe(false)
    expect(m.met).toBe(false)
  })

  it('호감표는 안 센다', () => {
    const liking = [vote('b1'), vote('b2'), { ...vote('c1'), kind: 'liking' as const }]
    expect(mainOf('model', { votes: liking }).clauses[0].have).toBe(2)
  })
})

describe('총무 — 그때 다른 팀이던 사람과의 거래만', () => {
  const buys = needOf('treasurer', 'vendBuys')
  const deals = needOf('treasurer', 'dealsWithOtherTeam')
  const trade = (otherId: string): GameRecord => ({
    kind: 'trade',
    atMs: START,
    actorId: 'me',
    actorTeam: 'A',
    otherId,
    otherTeam: TEAM_OF[otherId],
  })

  it('같은 팀과 거래한 것은 안 센다', () => {
    const rows = [...did('vendBuy', buys), trade('a2'), trade('a3')]
    expect(mainOf('treasurer', { records: rows }).clauses[1].have).toBe(0)
  })

  it(`다른 팀과 ${deals - 1}번은 안 되고 ${deals}번은 된다`, () => {
    const partners = ['b1', 'c1', 'd1', 'b2', 'c2', 'd2']
    const rows = (n: number) => [...did('vendBuy', buys), ...partners.slice(0, n).map(trade)]
    expect(mainOf('treasurer', { records: rows(deals - 1) }).met).toBe(false)
    expect(mainOf('treasurer', { records: rows(deals) }).met).toBe(true)
  })

  it('내가 받은 거래도 센다 — 제안한 쪽만 세면 받기만 한 사람이 억울하다', () => {
    const got: GameRecord = { kind: 'trade', atMs: START, actorId: 'b1', actorTeam: 'B', otherId: 'me', otherTeam: 'A' }
    const rows = [...did('vendBuy', buys), trade('c1'), got]
    const m = mainOf('treasurer', { records: rows })
    expect(m.clauses[1].have).toBe(2)
    expect(m.met).toBe(true)
  })

  it('자판기 매입은 구매가 아니다', () => {
    const rows = [...did('vendSell', 5), trade('c1'), trade('d1')]
    expect(mainOf('treasurer', { records: rows }).clauses[0].have).toBe(0)
  })
})

describe('쪽지 — 같은 장을 두 번 읽어도 한 장이다', () => {
  it('짝꿍', () => {
    const same = did('slipRead', 6, { subjectId: 'one' })
    expect(mainOf('deskmate', { records: same }).clauses[0].have).toBe(1)
  })

  it('도서부는 읽기와 건네기를 따로 센다', () => {
    const read = needOf('bookclub', 'slipsRead')
    const give = needOf('bookclub', 'slipsGiven')
    // 읽기만 넉넉하고 건네기가 하나 모자라다
    const readOnly = mainOf('bookclub', { records: [...did('slipRead', read + 2), ...did('slipGive', give - 1)] })
    expect(readOnly.clauses[0].met).toBe(true)
    expect(readOnly.clauses[1].met).toBe(false)
    expect(readOnly.met).toBe(false)
    // 건네기만 넉넉하고 읽기가 하나 모자라다
    const giveOnly = mainOf('bookclub', { records: [...did('slipRead', read - 1), ...did('slipGive', give + 2)] })
    expect(giveOnly.clauses[0].met).toBe(false)
    expect(giveOnly.clauses[1].met).toBe(true)
    expect(giveOnly.met).toBe(false)
  })
})

describe('과학부 — 맡긴 연구만', () => {
  const idx = clauseOf('science', 'robotsMade').index
  const need = needOf('science', 'robotsMade')

  it('완성품을 주운 것(robotBorn)은 안 센다', () => {
    const got = mainOf('science', { records: did('robotBorn', need) })
    expect(got.clauses[idx].have).toBe(0)
  })

  it('맡기기만 하면 센다 — 아직 안 나왔어도, 남이 가져가도', () => {
    const got = mainOf('science', { records: did('researchStart', need) })
    expect(got.clauses[idx].have).toBe(need)
    expect(got.clauses[idx].met).toBe(true)
  })
})

describe('기술부 — 남의 팀 짝만', () => {
  it('우리 팀 짝을 부순 것은 안 센다', () => {
    const ours = did('robotSmashed', 3, { otherTeam: 'A' as TeamId })
    expect(mainOf('tech', { records: ours }).clauses[0].have).toBe(0)
  })

  it('이적으로 저절로 사라진 짝은 안 센다', () => {
    const gone = did('robotGone', 5, { otherTeam: 'B' as TeamId })
    expect(mainOf('tech', { records: gone }).clauses[0].have).toBe(0)
  })

  it('우리 팀 짝으로 모자란 몫을 메울 수 없다', () => {
    const need = needOf('tech', 'robotsSmashedOfOthers')
    const rows = [
      ...did('robotSmashed', need - 1, { otherTeam: 'B' as TeamId }),
      ...did('robotSmashed', 3, { otherTeam: 'A' as TeamId }),
    ]
    const m = mainOf('tech', { records: rows })
    expect(m.clauses[0].have).toBe(need - 1)
    expect(m.met).toBe(false)
  })
})

describe('짝사랑 — 지정된 한 사람', () => {
  const target = 'b1'

  it('대상이 아닌 사람의 쪽지는 안 센다', () => {
    const others = did('slipRead', 3, { ownerId: 'c1' })
    expect(mainOf('crush', { records: others }, target).clauses[0].have).toBe(0)
  })

  it('대상의 쪽지 한 장이면 그 조항은 찬다', () => {
    const hit = did('slipRead', 1, { ownerId: target })
    expect(mainOf('crush', { records: hit }, target).clauses[0].met).toBe(true)
  })

  const minutes = minutesOf('crush', 'coStayWithTarget')
  it(`${minutes - 1}분은 안 되고 ${minutes}분은 된다`, () => {
    const hit = did('slipRead', needOf('crush', 'targetSlipRead'), { ownerId: target })
    const short = mainOf('crush', { records: hit, intervals: together('me', target, minutes - 1) }, target)
    const exact = mainOf('crush', { records: hit, intervals: together('me', target, minutes) }, target)
    expect(short.clauses[1].met).toBe(false)
    expect(exact.clauses[1].met).toBe(true)
    expect(exact.met).toBe(true)
  })

  it('대상이 없으면 아무것도 안 찬다 — 짝사랑이 아닌 사람이 잘못 들어와도', () => {
    const hit = did('slipRead', 3, { ownerId: target })
    expect(mainOf('crush', { records: hit, intervals: together('me', target, minutes * 6) }, null).met).toBe(false)
  })
})

describe('전학생 — 1위가 아니어야 한다', () => {
  const need = needOf('newcomer', 'otherTeamRoomsStood')
  const minutes = minutesOf('newcomer', 'otherTeamRoomsStood')

  it('공동 1위는 1위다', () => {
    const tied = mainOf('newcomer', { teamTiedRank: { A: 1, B: 1, C: 3, D: 4 } })
    expect(tied.clauses[0].met).toBe(false)
  })

  it('2위면 찬다', () => {
    expect(mainOf('newcomer', { teamTiedRank: { A: 2, B: 1, C: 3, D: 4 } }).clauses[0].met).toBe(true)
  })

  it('서 있던 그 시점의 주인으로 센다', () => {
    const rooms = ['r1', 'r2', 'r3']
    const intervals: Interval[] = rooms.map((tileId, i) => ({
      playerId: 'me',
      tileId,
      startMs: START + i * 60 * MIN,
      endMs: START + i * 60 * MIN + (minutes + 2) * MIN,
      state: 'standing',
    }))
    // 서 있는 동안은 B·C·D 것이었고, 나중에 전부 우리 팀으로 넘어왔다
    const teams: TeamId[] = ['B', 'C', 'D']
    const ownerChanges = rooms.flatMap((tileId, i) => [
      { tileId, team: teams[i], ownerBefore: null, atMs: START - MIN },
      { tileId, team: 'A' as TeamId, ownerBefore: teams[i], atMs: START + 4 * 60 * MIN },
    ])
    const m = mainOf('newcomer', { intervals, ownerChanges })
    expect(m.clauses[1].have).toBe(3)
    expect(m.clauses[1].met).toBe(3 >= need)
  })

  it(`${need - 1}팀은 안 되고 ${need}팀은 된다`, () => {
    const teams: TeamId[] = ['B', 'C', 'D']
    const stood = (n: number) => {
      const rooms = teams.slice(0, n).map((t) => `room-${t}`)
      const intervals: Interval[] = rooms.map((tileId, i) => ({
        playerId: 'me',
        tileId,
        startMs: START + i * 60 * MIN,
        endMs: START + i * 60 * MIN + minutes * MIN,
        state: 'standing',
      }))
      const ownerChanges = rooms.map((tileId, i) => ({ tileId, team: teams[i], ownerBefore: null, atMs: START - MIN }))
      return mainOf('newcomer', { intervals, ownerChanges }).clauses[1]
    }
    expect(stood(need - 1).met).toBe(false)
    expect(stood(need).met).toBe(true)
  })

  it('그날 이적했으면 서 있던 그때의 내 분단으로 가른다', () => {
    // B 에 있다가 START+3시간에 A 로 넘어왔다(자정의 분단은 A)
    const moved = START + 3 * 60 * MIN
    const records = did('teamMoved', 1, { atMs: moved, actorTeam: 'A', otherTeam: 'B' })
    const stay = (tileId: string, at: number): Interval => ({ playerId: 'me', tileId, startMs: at, endMs: at + minutes * MIN, state: 'standing' })
    const intervals: Interval[] = [
      stay('rA', START), // 이적 전 — A 는 그때 남의 분단이었다 → 센다
      stay('rB0', START + 60 * MIN), // 이적 전 — B 는 그때 내 분단이었다 → 안 센다
      stay('rB', moved + 10 * MIN), // 이적 뒤 — B 는 이제 남의 분단이다 → 센다
      stay('rA2', moved + 60 * MIN), // 이적 뒤 — A 는 이제 내 분단이다 → 안 센다
    ]
    const own = (tileId: string, team: TeamId) => ({ tileId, team, ownerBefore: null, atMs: START - MIN })
    const ownerChanges = [own('rA', 'A'), own('rB0', 'B'), own('rB', 'B'), own('rA2', 'A')]
    const m = mainOf('newcomer', { intervals, ownerChanges, records })
    expect(m.clauses[1].have).toBe(2)
  })

  it(`${minutes}분을 못 채운 방은 안 센다`, () => {
    const intervals: Interval[] = [
      { playerId: 'me', tileId: 'r1', startMs: START, endMs: START + (minutes - 1) * MIN, state: 'standing' },
    ]
    const ownerChanges = [{ tileId: 'r1', team: 'B' as TeamId, ownerBefore: null, atMs: START - MIN }]
    expect(mainOf('newcomer', { intervals, ownerChanges }).clauses[1].have).toBe(0)
  })

  it('센 기간 앞에서 서 있던 시간은 오늘 몫이 아니다 — 어제부터 서 있던 방', () => {
    // 한 시간 전부터 서 있었지만 오늘 몫으로는 기준에 1분 모자라다
    const intervals: Interval[] = [
      { playerId: 'me', tileId: 'r1', startMs: START - 60 * MIN, endMs: START + (minutes - 1) * MIN, state: 'standing' },
    ]
    const ownerChanges = [{ tileId: 'r1', team: 'B' as TeamId, ownerBefore: null, atMs: START - 2 * 60 * MIN }]
    expect(mainOf('newcomer', { intervals, ownerChanges }).clauses[1].have).toBe(0)
  })
})

describe('뒷자리 — 내가 적은 이름이 그날 투명인간이 되면', () => {
  const need = needOf('backseat', 'invisibleHits')
  const ballot = (targetId: string, voterId = 'me'): BallotVote => ({
    day: 1,
    voterId,
    targetId,
    voterTeam: TEAM_OF[voterId],
    targetTeam: TEAM_OF[targetId],
  })
  const day = (invisibleId: string | null, reason = invisibleId ? 'picked' : 'tie'): BallotDay[] => [
    { day: 1, invisibleId, reason },
  ]

  it('조항은 하나다 — 우리 팀 조항은 없다', () => {
    expect(ROLE_BY_ID.backseat.main.clauses.map((c) => c.kind)).toEqual(['invisibleHits'])
  })

  it('내가 적은 사람이 투명인간이 되면 찬다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1')], ballotDays: day('b1') })
    expect(m.clauses[0].have).toBe(1)
    expect(m.clauses[0].bar).toBe(need)
    expect(m.met).toBe(true)
  })

  it('우리 팀 사람을 적었어도 똑같이 센다', () => {
    expect(mainOf('backseat', { ballots: [ballot('a2')], ballotDays: day('a2') }).met).toBe(true)
  })

  it('다른 사람이 지워지면 안 찬다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1')], ballotDays: day('c1') })
    expect(m.clauses[0].have).toBe(0)
    expect(m.met).toBe(false)
  })

  it('동률로 아무도 안 지워진 날은 적중이 아니다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1')], ballotDays: day(null) })
    expect(m.clauses[0].have).toBe(0)
    expect(m.met).toBe(false)
  })

  it('아무도 안 지워진 날(표가 하나도 없었다)도 적중이 아니다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1')], ballotDays: day(null, 'none') })
    expect(m.met).toBe(false)
  })

  it('내가 안 적었으면 남이 맞혀도 안 찬다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1', 'c1')], ballotDays: day('b1') })
    expect(m.met).toBe(false)
  })
})

describe('열네 역할 모두', () => {
  it('판정이 돈다', () => {
    for (const r of ROLES) {
      const out = judge(me(r.id, r.id === 'crush' ? 'b1' : null), log())
      expect(out.main.clauses.length, r.id).toBe(r.main.clauses.length)
      expect(typeof out.main.met, r.id).toBe('boolean')
    }
  })

  it('아무것도 안 하면 아무것도 안 찬다', () => {
    for (const r of ROLES) {
      const out = judge(me(r.id, 'b1'), log())
      // 전학생의 「1위가 아님」만 가만히 있어도 찬다 — 우리 팀이 2위다
      if (r.id === 'newcomer') continue
      expect(out.main.met, r.id).toBe(false)
    }
  })
})

describe('그때의 팀으로 센다 — 나중에 이적해도 그 일은 그대로다', () => {
  it('총무: 거래한 그 순간 두 사람의 팀이 달랐으면 센다', () => {
    // 지금은 같은 팀(a2)이지만 거래할 때는 다른 팀이었다
    const then: GameRecord = { kind: 'trade', atMs: START, actorId: 'me', actorTeam: 'A', otherId: 'a2', otherTeam: 'C' }
    // 지금은 다른 팀(c1)이지만 거래할 때는 같은 팀이었다
    const same: GameRecord = { kind: 'trade', atMs: START, actorId: 'me', actorTeam: 'A', otherId: 'c1', otherTeam: 'A' }
    expect(mainOf('treasurer', { records: [then, same] }).clauses[1].have).toBe(1)
  })
  it('기술부: 부순 그 순간 남의 팀 짝이었으면 센다', () => {
    const rows: GameRecord[] = [
      { kind: 'robotSmashed', atMs: START, actorId: 'me', actorTeam: 'A', otherTeam: 'B', subjectId: 'r1' },
      { kind: 'robotSmashed', atMs: START, actorId: 'me', actorTeam: 'B', otherTeam: 'B', subjectId: 'r2' },
    ]
    expect(mainOf('tech', { records: rows }).clauses[0].have).toBe(1)
  })
  it('모범생: 보낸 사람의 팀은 표를 던진 그 순간의 팀이다', () => {
    const v = (voterId: string, voterTeam: TeamId) => ({ voterId, voterTeam, targetId: 'me', kind: 'trust' as const, day: 1, atMs: START })
    // a2 는 지금 A 팀이지만 던질 때는 D 팀이었다
    const out = mainOf('model', { votes: [v('a2', 'D'), v('b1', 'B'), v('b2', 'B')] })
    expect(out.clauses[1].have).toBe(2)
  })
})
