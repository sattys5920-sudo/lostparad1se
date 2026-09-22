// 판정 엔진. **경계에서 갈리는지**를 본다.
//
// 「3번 이상」은 2에서 안 되고 3에서 돼야 한다. 하나 모자란 자리와
// 딱 맞는 자리를 나란히 놓는다 — 둘 중 하나만 보면 부등호가 뒤집혀
// 있어도 통과한다.
//
// 공개 정책도 여기서 본다. 가려야 할 값이 문서에 **들어 있지 않은지**
// 까지 본다 — 받아서 가리는 방식이면 개발자도구로 다 보인다.
import { describe, expect, it } from 'vitest'
import { discloseFor, judge, type BallotVote, type GameLog, type JudgeVote } from './judge'
import type { Assignment } from './assign'
import { ROLES, ROLE_BY_ID, type RoleId } from './roles'
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

// ── 경계 ────────────────────────────────────────────────────────

describe('셈이 경계에서 갈린다', () => {
  const counts: [RoleId, RecordKind, number][] = [
    ['locker', 'slipRead', 4],
    ['cleanup', 'slipTear', 3],
    ['duty', 'errandDone', 4],
    ['gardener', 'potHarvest', 5],
    ['science', 'robotBorn', 3],
    ['topstudent', 'quizSolved', 6],
    ['snacker', 'vendBuy', 3],
  ]

  for (const [roleId, kind, need] of counts) {
    const name = ROLE_BY_ID[roleId].name
    it(`${name} — ${need - 1}번은 안 되고 ${need}번은 된다`, () => {
      const short = mainOf(roleId, { records: did(kind, need - 1) })
      const exact = mainOf(roleId, { records: did(kind, need) })
      const first = (m: typeof short) => m.clauses[0]
      expect(first(short).met, '하나 모자랄 때').toBe(false)
      expect(first(short).have).toBe(need - 1)
      expect(first(exact).met, '딱 맞을 때').toBe(true)
      expect(first(exact).bar).toBe(need)
    })
  }
})

describe('반장 — 같은 방에 1분 이상', () => {
  const others = EVERYONE.filter((id) => id !== 'me')

  /** 나와 n명이 m분씩 같은 방에. */
  const withN = (n: number, minutes: number): Interval[] =>
    others.slice(0, n).flatMap((id, i) => together('me', id, minutes, `room${i}`))

  it('여덟 명은 안 되고 아홉 명은 된다', () => {
    expect(mainOf('classlead', { intervals: withN(8, 5) }).met).toBe(false)
    expect(mainOf('classlead', { intervals: withN(9, 5) }).met).toBe(true)
  })

  it('1분을 못 채운 사람은 안 센다', () => {
    const brief = others.slice(0, 12).flatMap((id, i) => together('me', id, 0.5, `room${i}`))
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
    const asleep: Interval[] = others.slice(0, 9).flatMap((id, i) => [
      { playerId: 'me', tileId: `room${i}`, startMs: START, endMs: START + 5 * MIN, state: 'standing' as const },
      { playerId: id, tileId: `room${i}`, startMs: START, endMs: START + 5 * MIN, state: 'asleep' as const },
    ])
    expect(mainOf('classlead', { intervals: asleep }).met).toBe(true)
  })
})

describe('모범생 — 신뢰표 셋, 서로 다른 두 팀에서', () => {
  const vote = (voterId: string): JudgeVote => ({
    voterId,
    targetId: 'me',
    kind: 'trust',
    day: 1,
    atMs: START,
  })

  it('한 팀에서 셋이면 모자라다', () => {
    const m = mainOf('model', { votes: [vote('b1'), vote('b2'), vote('b3')] })
    expect(m.clauses[0].met, '장수').toBe(true)
    expect(m.clauses[1].met, '팀 수').toBe(false)
    expect(m.met).toBe(false)
  })

  it('두 팀에서 셋이면 된다', () => {
    expect(mainOf('model', { votes: [vote('b1'), vote('b2'), vote('c1')] }).met).toBe(true)
  })

  it('두 팀이어도 두 장이면 모자라다', () => {
    expect(mainOf('model', { votes: [vote('b1'), vote('c1')] }).met).toBe(false)
  })

  it('호감표는 안 센다', () => {
    const liking = [vote('b1'), vote('b2'), { ...vote('c1'), kind: 'liking' as const }]
    expect(mainOf('model', { votes: liking }).clauses[0].have).toBe(2)
  })
})

describe('매점 단골 — 다른 팀과의 거래만', () => {
  const trade = (otherId: string): GameRecord => ({
    kind: 'trade',
    atMs: START,
    actorId: 'me',
    actorTeam: 'A',
    otherId,
    otherTeam: TEAM_OF[otherId],
  })

  it('같은 팀과 거래한 것은 안 센다', () => {
    const rows = [...did('vendBuy', 3), trade('a2'), trade('a3')]
    expect(mainOf('snacker', { records: rows }).clauses[1].have).toBe(0)
  })

  it('내가 받은 거래도 센다 — 제안한 쪽만 세면 받기만 한 사람이 억울하다', () => {
    const got: GameRecord = { kind: 'trade', atMs: START, actorId: 'b1', actorTeam: 'B', otherId: 'me' }
    const rows = [...did('vendBuy', 3), trade('c1'), got]
    expect(mainOf('snacker', { records: rows }).met).toBe(true)
  })

  it('자판기 매입은 구매가 아니다', () => {
    const rows = [...did('vendSell', 5), trade('c1'), trade('d1')]
    expect(mainOf('snacker', { records: rows }).clauses[0].have).toBe(0)
  })
})

describe('쪽지 — 같은 장을 두 번 읽어도 한 장이다', () => {
  it('사물함', () => {
    const same = did('slipRead', 6, { subjectId: 'one' })
    expect(mainOf('locker', { records: same }).clauses[0].have).toBe(1)
  })

  it('도서부는 읽기와 건네기를 따로 센다', () => {
    const rows = [...did('slipRead', 4), ...did('slipGive', 1, { subjectId: 'g0' })]
    const m = mainOf('bookclub', { records: rows })
    expect(m.clauses[0].met).toBe(true)
    expect(m.clauses[1].met).toBe(false)
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

  it('남의 팀 짝 셋이면 된다', () => {
    expect(mainOf('tech', { records: did('robotSmashed', 3, { otherTeam: 'B' as TeamId }) }).met).toBe(true)
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

  it('29분은 안 되고 30분은 된다', () => {
    const hit = did('slipRead', 1, { ownerId: target })
    const short = mainOf('crush', { records: hit, intervals: together('me', target, 29) }, target)
    const exact = mainOf('crush', { records: hit, intervals: together('me', target, 30) }, target)
    expect(short.clauses[1].met).toBe(false)
    expect(exact.clauses[1].met).toBe(true)
    expect(exact.met).toBe(true)
  })

  it('대상이 없으면 아무것도 안 찬다 — 짝사랑이 아닌 사람이 잘못 들어와도', () => {
    const hit = did('slipRead', 3, { ownerId: target })
    expect(mainOf('crush', { records: hit, intervals: together('me', target, 90) }, null).met).toBe(false)
  })
})

describe('전학생 — 1위가 아니어야 한다', () => {
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
      endMs: START + i * 60 * MIN + 12 * MIN,
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
  })

  it('10분을 못 채운 방은 안 센다', () => {
    const intervals: Interval[] = [
      { playerId: 'me', tileId: 'r1', startMs: START, endMs: START + 9 * MIN, state: 'standing' },
    ]
    const ownerChanges = [{ tileId: 'r1', team: 'B' as TeamId, ownerBefore: null, atMs: START - MIN }]
    expect(mainOf('newcomer', { intervals, ownerChanges }).clauses[1].have).toBe(0)
  })
})

describe('뒷자리 — 동률로 무효가 된 날은 안 센다', () => {
  const ballot = (day: number, targetId: string): BallotVote => ({
    day,
    voterId: 'me',
    targetId,
    voterTeam: 'A',
    targetTeam: TEAM_OF[targetId],
  })

  it('적중한 날 둘, 그중 하나가 우리 팀이면 된다', () => {
    const m = mainOf('backseat', {
      ballots: [ballot(1, 'b1'), ballot(2, 'a2')],
      ballotDays: [
        { day: 1, invisibleId: 'b1', reason: 'picked' },
        { day: 2, invisibleId: 'a2', reason: 'picked' },
      ],
    })
    expect(m.met).toBe(true)
  })

  it('둘 다 남의 팀이면 모자라다', () => {
    const m = mainOf('backseat', {
      ballots: [ballot(1, 'b1'), ballot(2, 'c1')],
      ballotDays: [
        { day: 1, invisibleId: 'b1', reason: 'picked' },
        { day: 2, invisibleId: 'c1', reason: 'picked' },
      ],
    })
    expect(m.clauses[0].met, '적중 수').toBe(true)
    expect(m.clauses[1].met, '우리 팀').toBe(false)
  })

  it('동률로 아무도 안 지워진 날은 적중이 아니다', () => {
    const m = mainOf('backseat', {
      ballots: [ballot(1, 'b1'), ballot(2, 'a2')],
      ballotDays: [
        { day: 1, invisibleId: null, reason: 'tie' },
        { day: 2, invisibleId: 'a2', reason: 'picked' },
      ],
    })
    expect(m.clauses[0].have).toBe(1)
  })

  it('적은 그 순간 같은 팀이면 센다 — 나중에 이적해도', () => {
    // 적을 때는 같은 A팀이었고, 지금 teamOf 로는 D팀이 된 사람
    const moved: BallotVote = { day: 1, voterId: 'me', targetId: 'd1', voterTeam: 'A', targetTeam: 'A' }
    const m = mainOf('backseat', {
      ballots: [moved, ballot(2, 'b1')],
      ballotDays: [
        { day: 1, invisibleId: 'd1', reason: 'picked' },
        { day: 2, invisibleId: 'b1', reason: 'picked' },
      ],
    })
    expect(m.met).toBe(true)
  })
})

// ── 쪽지 미션 ───────────────────────────────────────────────────

describe('쪽지 미션 셋', () => {
  const slipOf = (id: string, out = judge(me('locker'), log())) =>
    out.slips.find((s) => s.id === id)

  it('남의 쪽지를 읽고 끝까지 쥐고 있어야 한다', () => {
    const read = did('slipRead', 1, { subjectId: 'slipX', ownerId: 'b1' })
    const kept = judge(me('locker'), log({ records: read, slipsHeldAtEnd: { me: ['slipX'] } }))
    const lost = judge(me('locker'), log({ records: read, slipsHeldAtEnd: { me: [] } }))
    expect(slipOf('keepOthers', kept)?.met).toBe(true)
    expect(slipOf('keepOthers', lost)?.met).toBe(false)
  })

  it('내 쪽지를 내가 쥐고 있는 것은 안 센다', () => {
    const read = did('slipRead', 1, { subjectId: 'mine', ownerId: 'me' })
    const out = judge(me('locker'), log({ records: read, slipsHeldAtEnd: { me: ['mine'] } }))
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
    const two = judge(me('locker'), log({ records: readers(['b1', 'c1']) }))
    const three = judge(me('locker'), log({ records: readers(['b1', 'c1', 'd1']) }))
    expect(slipOf('fewReadMine', two)?.met).toBe(true)
    expect(slipOf('fewReadMine', three)?.met).toBe(false)
    expect(slipOf('fewReadMine', three)?.broken, '상한은 도중에 깨진다').toBe(true)
  })

  it('내가 내 쪽지를 읽은 것은 남이 읽은 것이 아니다', () => {
    const selfRead = did('slipRead', 1, { subjectId: 'aboutMe', ownerId: 'me' })
    const out = judge(me('locker'), log({ records: selfRead }))
    expect(slipOf('fewReadMine', out)?.have).toBe(0)
  })

  it('같은 사람의 쪽지를 두 번 주우면 찬다', () => {
    const once = did('slipTake', 1, { ownerId: 'b1' })
    const twice = [...did('slipTake', 1, { ownerId: 'b1' }), ...did('slipTake', 1, { ownerId: 'b1' })]
    const spread = [...did('slipTake', 1, { ownerId: 'b1' }), ...did('slipTake', 1, { ownerId: 'c1' })]
    expect(slipOf('twiceSamePerson', judge(me('locker'), log({ records: once })))?.met).toBe(false)
    expect(slipOf('twiceSamePerson', judge(me('locker'), log({ records: twice })))?.met).toBe(true)
    expect(slipOf('twiceSamePerson', judge(me('locker'), log({ records: spread })))?.met).toBe(false)
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

  it('전학생의 1위 조항은 끝나야 열린다', () => {
    const nc = judge(me('newcomer'), log({ over: false }))
    for (const phase of ['live', 'dayTurned', 'ballotShown'] as const) {
      const v = discloseFor(nc, phase)
      expect(v.main.clauses[0].shown, phase).toBe(false)
      expect(v.main.clauses[0].status, phase).toBe('endOnly')
    }
    expect(discloseFor(nc, 'end').main.clauses[0].shown).toBe(true)
  })

  it('마지막 선택은 끝날 때 판정이다', () => {
    const out = judge(me('locker'), log({ choiceMet: { me: true } }))
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
    const out = judge(me('duty'), log({ records: did('errandDone', 1), over: false }))
    expect(discloseFor(out, 'live').main.status).toBe('running')
  })

  it('끝났는데 못 채웠으면 실패다', () => {
    const out = judge(me('duty'), log({ records: did('errandDone', 1) }))
    expect(discloseFor(out, 'end').main.status).toBe('failed')
  })

  it('상한을 넘기면 도중에도 실패다', () => {
    const readers: GameRecord[] = ['b1', 'c1', 'd1'].map((id) => ({
      kind: 'slipRead',
      atMs: START,
      actorId: id,
      actorTeam: TEAM_OF[id],
      subjectId: 'aboutMe',
      ownerId: 'me',
    }))
    const out = judge(me('locker'), log({ records: readers, over: false }))
    const few = discloseFor(out, 'live').slips.find((s) => s.id === 'fewReadMine')
    expect(few?.status).toBe('failed')
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
