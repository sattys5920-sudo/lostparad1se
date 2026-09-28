// 판정 엔진. **경계에서 갈리는지**를 본다.
//
// 「3번 이상」은 2에서 안 되고 3에서 돼야 한다. 하나 모자란 자리와
// 딱 맞는 자리를 나란히 놓는다 — 둘 중 하나만 보면 부등호가 뒤집혀
// 있어도 통과한다.
//
// 공개 정책도 여기서 본다. 가려야 할 값이 문서에 **들어 있지 않은지**
// 까지 본다 — 받아서 가리는 방식이면 개발자도구로 다 보인다.
import { describe, expect, it } from 'vitest'
import { discloseFor, judge, type BallotDay, type BallotVote, type GameLog, type JudgeVote } from './judge'
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
    chosenBy: {},
    choiceMet: {},
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
    ['science', 'robotsMade', 'robotBorn'],
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
  it('옆자리', () => {
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

  it('아무도 안 지워진 날(사람이 모자라다)도 적중이 아니다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1')], ballotDays: day(null, 'tooFew') })
    expect(m.met).toBe(false)
  })

  it('내가 안 적었으면 남이 맞혀도 안 찬다', () => {
    const m = mainOf('backseat', { ballots: [ballot('b1', 'c1')], ballotDays: day('b1') })
    expect(m.met).toBe(false)
  })
})

// ── 쪽지 미션 ───────────────────────────────────────────────────

describe('쪽지 미션 셋', () => {
  const slipOf = (id: string, out = judge(me('deskmate'), log())) =>
    out.slips.find((s) => s.id === id)

  it('남의 쪽지를 읽고 끝까지 쥐고 있어야 한다', () => {
    const read = did('slipRead', 1, { subjectId: 'slipX', ownerId: 'b1' })
    const kept = judge(me('deskmate'), log({ records: read, slipsHeldAtEnd: { me: ['slipX'] } }))
    const lost = judge(me('deskmate'), log({ records: read, slipsHeldAtEnd: { me: [] } }))
    expect(slipOf('keepOthers', kept)?.met).toBe(true)
    expect(slipOf('keepOthers', lost)?.met).toBe(false)
  })

  it('내 쪽지를 내가 쥐고 있는 것은 안 센다', () => {
    const read = did('slipRead', 1, { subjectId: 'mine', ownerId: 'me' })
    const out = judge(me('deskmate'), log({ records: read, slipsHeldAtEnd: { me: ['mine'] } }))
    expect(slipOf('keepOthers', out)?.met).toBe(false)
  })

  it('나에 대한 쪽지를 둘이 읽으면 되고 셋이면 깨진다', () => {
    const readers = (ids: string[]): GameRecord[] =>
      ids.map((id) => ({
        kind: 'slipRead' as const,
        atMs: START,
        actorId: id,
        actorTeam: TEAM_OF[id],
        subjectId: 'aboutMe',
        ownerId: 'me',
      }))
    const two = judge(me('deskmate'), log({ records: readers(['b1', 'c1']) }))
    const three = judge(me('deskmate'), log({ records: readers(['b1', 'c1', 'd1']) }))
    expect(slipOf('fewReadMine', two)?.met).toBe(true)
    expect(slipOf('fewReadMine', three)?.met).toBe(false)
    expect(slipOf('fewReadMine', three)?.broken, '상한은 도중에 깨진다').toBe(true)
  })

  it('내가 내 쪽지를 읽은 것은 남이 읽은 것이 아니다', () => {
    const selfRead = did('slipRead', 1, { subjectId: 'aboutMe', ownerId: 'me' })
    const out = judge(me('deskmate'), log({ records: selfRead }))
    expect(slipOf('fewReadMine', out)?.have).toBe(0)
  })

  it('같은 사람의 쪽지를 두 번 주우면 찬다', () => {
    const once = did('slipTake', 1, { ownerId: 'b1' })
    const twice = [...did('slipTake', 1, { ownerId: 'b1' }), ...did('slipTake', 1, { ownerId: 'b1' })]
    const spread = [...did('slipTake', 1, { ownerId: 'b1' }), ...did('slipTake', 1, { ownerId: 'c1' })]
    expect(slipOf('twiceSamePerson', judge(me('deskmate'), log({ records: once })))?.met).toBe(false)
    expect(slipOf('twiceSamePerson', judge(me('deskmate'), log({ records: twice })))?.met).toBe(true)
    expect(slipOf('twiceSamePerson', judge(me('deskmate'), log({ records: spread })))?.met).toBe(false)
  })
})

// ── 공개 정책 ───────────────────────────────────────────────────

describe('공개 정책', () => {
  const votes: JudgeVote[] = ['b1', 'b2', 'c1'].map((voterId) => ({
    voterId,
    targetId: 'me',
    kind: 'trust' as const,
    day: 1,
    atMs: START,
  }))
  const result = judge(me('model'), log({ votes, over: false }))

  it('받은 표 조항은 판이 도는 중에 숫자를 안 내려보낸다', () => {
    const view = discloseFor(result, 'live')
    for (const c of view.main.clauses) {
      expect(c.shown).toBe(false)
      expect(c.have).toBe(null)
    }
  })

  it('하루가 바뀌면 열린다', () => {
    const view = discloseFor(result, 'dayTurned')
    for (const c of view.main.clauses) expect(c.have).not.toBe(null)
  })

  it('가린 값은 문서에 아예 안 들어간다', () => {
    const text = JSON.stringify(discloseFor(result, 'live'))
    expect(text).not.toContain('"have":3')
    expect(text).not.toContain('b1')
    expect(text).not.toContain('voterId')
  })

  it('뒷자리 조항은 투명인간 발표 뒤에만 열린다', () => {
    const back = judge(me('backseat'), log({ over: false }))
    expect(discloseFor(back, 'live').main.clauses[0].shown).toBe(false)
    expect(discloseFor(back, 'dayTurned').main.clauses[0].shown).toBe(false)
    expect(discloseFor(back, 'ballotShown').main.clauses[0].shown).toBe(true)
  })

  it('전학생의 1위 조항은 하루가 바뀌면 열린다', () => {
    expect(clauseOf('newcomer', 'teamNotFirstAtEnd').disclosure).toBe('daily')
    const nc = judge(me('newcomer'), log({ over: false }))
    for (const phase of ['live', 'ballotShown'] as const) {
      const v = discloseFor(nc, phase)
      expect(v.main.clauses[0].shown, phase).toBe(false)
      expect(v.main.clauses[0].have, phase).toBe(null)
      expect(v.main.clauses[0].status, phase).toBe('endOnly')
    }
    const turned = discloseFor(nc, 'dayTurned').main.clauses[0]
    expect(turned.shown).toBe(true)
    expect(turned.have, '우리 팀은 2위다').toBe(1)
    expect(turned.status).toBe('met')
    expect(discloseFor(nc, 'end').main.clauses[0].shown).toBe(true)
  })

  it('마지막 선택은 끝날 때 판정이다', () => {
    const out = judge(me('deskmate'), log({ choiceMet: { me: true } }))
    expect(discloseFor(out, 'live').choice).toBe('endOnly')
    expect(discloseFor(out, 'end').choice).toBe('met')
  })

  it('남의 아이디는 어디에도 안 들어간다', () => {
    const rows = [...did('slipRead', 2, { ownerId: 'b1' }), ...did('slipTake', 1, { ownerId: 'c1' })]
    const out = judge(me('crush', 'b1'), log({ records: rows, over: false }))
    const text = JSON.stringify(discloseFor(out, 'live'))
    expect(text).not.toContain('b1')
    expect(text).not.toContain('c1')
  })
})

// ── 실패는 뒤집힐 수 없을 때만 ──────────────────────────────────

describe('실패는 뒤집힐 수 없을 때만 붙는다', () => {
  it('아직 채울 수 있으면 진행 중이다', () => {
    const out = judge(me('duty'), log({ records: did('errandDone', needOf('duty', 'errandsDone') - 1), over: false }))
    expect(discloseFor(out, 'live').main.status).toBe('running')
  })

  it('끝났는데 못 채웠으면 실패다', () => {
    const out = judge(me('duty'), log({ records: did('errandDone', needOf('duty', 'errandsDone') - 1) }))
    expect(discloseFor(out, 'end').main.status).toBe('failed')
  })

  it('상한을 넘겨도 도중에는 「끝날 때 판정」이다 — 실패로 뜨면 세 사람이 읽은 것이 샌다', () => {
    const readers: GameRecord[] = ['b1', 'c1', 'd1'].map((id) => ({
      kind: 'slipRead',
      atMs: START,
      actorId: id,
      actorTeam: TEAM_OF[id],
      subjectId: 'aboutMe',
      ownerId: 'me',
    }))
    const out = judge(me('deskmate'), log({ records: readers, over: false }))
    const few = discloseFor(out, 'live').slips.find((s) => s.id === 'fewReadMine')
    expect(few?.status).toBe('endOnly')
    expect(few?.have).toBeNull()
    // 끝나면 그때 실패다
    expect(discloseFor(out, 'end').slips.find((s) => s.id === 'fewReadMine')?.status).toBe('failed')
  })
})

describe('열네 역할 모두', () => {
  it('판정이 돈다', () => {
    for (const r of ROLES) {
      const out = judge(me(r.id, r.id === 'crush' ? 'b1' : null), log())
      expect(out.main.clauses.length, r.id).toBe(r.main.clauses.length)
      expect(typeof out.main.met, r.id).toBe('boolean')
      expect(out.slips, r.id).toHaveLength(3)
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

describe('마지막 선택 — 판정이 직접 셈한다', () => {
  const run = (choice: 'team' | 'self' | 'chosen', rank: Partial<Record<TeamId, number>>, chosen: string | null = null) =>
    judge(
      me('duty'),
      log({
        day4Choice: { me: choice },
        chosenBy: { me: chosen },
        teamTiedRank: { A: 4, B: 4, C: 4, D: 4, ...rank },
        records: did('errandDone', needOf('duty', 'errandsDone')),
      }),
    ).choiceMet
  it('팀을 지킨다 — 공동 2위도 2위 이내다', () => {
    expect(run('team', { A: 2 })).toBe(true)
    expect(run('team', { A: 3 })).toBe(false)
  })
  it('나를 지킨다 — 주 미션을 채웠으면 된다', () => {
    expect(run('self', {})).toBe(true)
  })
  it('그 사람을 지킨다 — 중요한 사람의 팀이 (공동) 1위', () => {
    expect(run('chosen', { B: 1 }, 'b1')).toBe(true)
    expect(run('chosen', { B: 2 }, 'b1')).toBe(false)
    expect(run('chosen', { B: 1 }, null)).toBe(false)
  })
  it('안 골랐으면 실패다', () => {
    expect(judge(me('duty'), log({ day4Choice: {} })).choiceMet).toBe(false)
  })
})
