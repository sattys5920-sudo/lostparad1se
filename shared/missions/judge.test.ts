// 판정 엔진 — 세는 법과, 무엇을 안 내보내는가.
//
// 두 가지를 본다. 조항이 규칙대로 세는가, 그리고 disclosure에 따라
// 걸러 낸 결과에 숨겨야 할 숫자가 남아 있지 않은가. 뒤쪽이 더 중요하다 —
// 여기서 새면 익명 표가 무너진다.
import { describe, expect, it } from 'vitest'
import { discloseFor, judge, type GameLog } from './judge'
import type { Assignment } from './assign'
import { ROLES, ROLE_BY_ID, SCORE } from './roles'
import type { TeamId } from '../rules/v2'

const seoul = (iso: string) => new Date(`${iso}+09:00`).getTime()
const START = seoul('2026-03-02T08:00:00')
const NOW = seoul('2026-03-04T12:00:00')

const TEAM_OF: Record<string, TeamId> = { me: 'A', pal: 'B', x: 'C', y: 'D', z: 'B' }

function log(over: Partial<GameLog> = {}): GameLog {
  return {
    startedAtMs: START,
    nowMs: NOW,
    over: false,
    teamOf: (id) => TEAM_OF[id] ?? 'A',
    intervals: [],
    votes: [],
    reveals: [],
    leverageUses: [],
    flags: [],
    trades: [],
    scouts: [],
    fragmentTiles: [],
    ownerAtEnd: () => null,
    teamRank: { A: 2, B: 1, C: 3, D: 4 },
    allianceAtEnd: { A: null, B: null, C: null, D: null },
    leverageAtEnd: [],
    teamLostTile: { A: false, B: false, C: false, D: false },
    chosenBy: {},
    choiceMet: {},
    closingTogether: {},
    closingMutual: {},
    awakened: {},
    snowStopped: false,
    ...over,
  }
}

const me = (roleId: Assignment['roleId']): Assignment => ({
  playerId: 'me',
  team: 'A',
  roleId,
  bondId: 'pal',
})

describe('세는 법 — 수첩', () => {
  it('서로 다른 두 명에게서 들어야 한다', () => {
    const one = judge(
      me('notebook'),
      log({
        reveals: [
          { speakerId: 'x', scope: 'private', listenerIds: ['me'], day: 1, atMs: START },
          { speakerId: 'x', scope: 'private', listenerIds: ['me'], day: 2, atMs: START },
        ],
      }),
    )
    expect(one.main.clauses[0].have).toBe(1)
    expect(one.main.met).toBe(false)

    const two = judge(
      me('notebook'),
      log({
        reveals: [
          { speakerId: 'x', scope: 'private', listenerIds: ['me'], day: 1, atMs: START },
          { speakerId: 'y', scope: 'private', listenerIds: ['me'], day: 2, atMs: START },
        ],
      }),
    )
    expect(two.main.clauses[0].have).toBe(2)
    expect(two.main.met).toBe(true)
  })

  it('전체 털어놓기는 1:1로 세지 않는다', () => {
    const out = judge(
      me('notebook'),
      log({
        reveals: [{ speakerId: 'x', scope: 'class', listenerIds: ['me', 'y'], day: 1, atMs: START }],
      }),
    )
    expect(out.main.clauses[0].have).toBe(0)
  })

  it('약점을 쓰면 되돌릴 수 없이 깨진다', () => {
    const out = judge(
      me('notebook'),
      log({ leverageUses: [{ holderId: 'me', aboutId: 'x', use: 'bind', atMs: START }] }),
    )
    const clause = out.main.clauses.find((c) => c.kind === 'neverSpentLeverage')
    expect(clause?.met).toBe(false)
    expect(clause?.broken).toBe(true)
    expect(out.main.broken).toBe(true)
  })

  it('남이 쓴 약점은 나를 깨지 않는다', () => {
    const out = judge(
      me('notebook'),
      log({ leverageUses: [{ holderId: 'x', aboutId: 'me', use: 'extort', atMs: START }] }),
    )
    expect(out.main.clauses.find((c) => c.kind === 'neverSpentLeverage')?.met).toBe(true)
  })
})

describe('세는 법 — 지킴이', () => {
  const defended = (success: boolean) => ({
    tileId: 'classroom',
    team: 'B' as TeamId,
    planterId: 'pal',
    target: 'enemy' as const,
    success,
    ownerBefore: 'A' as TeamId,
    standing: ['me'],
    atMs: START,
  })

  it('막아 낸 것만 방어 참여다', () => {
    const won = judge(me('guard'), log({ flags: [defended(false), defended(false)] }))
    expect(won.main.clauses[0].have).toBe(2)
    const lost = judge(me('guard'), log({ flags: [defended(true), defended(true)] }))
    expect(lost.main.clauses[0].have).toBe(0)
  })

  it('한 번도 안 뺏겼으면 그것만으로 달성이다', () => {
    const out = judge(me('guard'), log({ teamLostTile: { A: false, B: false, C: false, D: false } }))
    expect(out.main.clauses[0].have).toBe(0)
    expect(out.main.met).toBe(true)
  })

  it('뺏겼으면 방어 횟수를 채워야 한다', () => {
    const out = judge(
      me('guard'),
      log({ teamLostTile: { A: true, B: false, C: false, D: false }, flags: [defended(false)] }),
    )
    expect(out.main.met).toBe(false)
  })

  it('인연 대상의 깃발을 막아선 것만 센다', () => {
    const out = judge(me('guard'), log({ flags: [defended(false)] }))
    expect(out.bond.met).toBe(true)
    const other = { ...defended(false), planterId: 'x' }
    expect(judge(me('guard'), log({ flags: [other] })).bond.met).toBe(false)
  })
})

describe('세는 법 — 체류', () => {
  const intervals = [
    { playerId: 'me', tileId: 'library', startMs: seoul('2026-03-02T10:00:00'), endMs: seoul('2026-03-02T13:00:00'), state: 'standing' as const },
    { playerId: 'pal', tileId: 'library', startMs: seoul('2026-03-02T11:00:00'), endMs: seoul('2026-03-02T13:00:00'), state: 'standing' as const },
  ]

  it('동석 시간을 시간 단위로 센다', () => {
    const out = judge(me('witness'), log({ intervals }))
    const clause = out.bond.clauses.find((c) => c.kind === 'coStayWithBond') ?? out.main.clauses.find((c) => c.kind === 'coStayWithBond')
    expect(clause?.unit).toBe('hours')
    expect(clause?.have).toBe(2)
  })

  it('방문한 칸을 센다', () => {
    const out = judge(me('transfer'), log({ intervals }))
    const clause = [...out.main.clauses, ...out.bond.clauses].find((c) => c.kind === 'tilesVisited')
    expect(clause?.have).toBe(1)
  })
})

describe('점수', () => {
  it('주 미션 3 · 인연 2 · 선택 2 · 종례 1 · 상호 1', () => {
    const out = judge(
      me('guard'),
      log({
        teamLostTile: { A: false, B: false, C: false, D: false },
        flags: [
          {
            tileId: 'classroom', team: 'B', planterId: 'pal', target: 'enemy', success: false,
            ownerBefore: 'A', standing: ['me'], atMs: START,
          },
        ],
        choiceMet: { me: true },
        closingTogether: { me: true },
        closingMutual: { me: true },
      }),
    )
    expect(out.main.met).toBe(true)
    expect(out.bond.met).toBe(true)
    expect(out.score).toBe(SCORE.main + SCORE.bond + SCORE.choice + SCORE.closingTogether + SCORE.closingMutual)
    expect(out.score).toBe(9)
    expect(out.band.id).toBe('stayed')
  })

  it('아무것도 못 하면 0점이다', () => {
    const out = judge(me('liar'), log())
    expect(out.score).toBe(0)
    expect(out.band.id).toBe('left')
  })

  it('열네 역할 모두 판정이 돈다', () => {
    for (const r of ROLES) {
      const out = judge(me(r.id), log())
      expect(out.main.clauses.length).toBe(ROLE_BY_ID[r.id].main.clauses.length)
      expect(out.score).toBeGreaterThanOrEqual(0)
      expect(out.score).toBeLessThanOrEqual(9)
    }
  })
})

describe('공개 정책', () => {
  const result = judge(
    me('witness'),
    log({
      votes: [
        { voterId: 'x', targetId: 'me', kind: 'suspicion', day: 2, atMs: NOW },
        { voterId: 'y', targetId: 'me', kind: 'trust', day: 2, atMs: NOW },
      ],
      reveals: [{ speakerId: 'me', scope: 'class', listenerIds: ['x', 'y'], day: 3, atMs: START }],
    }),
  )

  it('실시간 조항은 바로 보인다', () => {
    const view = discloseFor(result, 'live')
    const live = view.main.clauses.filter((c) => c.shown)
    for (const c of live) expect(c.have).not.toBe(null)
  })

  it('받은 표에 걸린 조항은 진행 중에 숫자가 나가지 않는다', () => {
    const view = discloseFor(result, 'live')
    const hidden = result.main.clauses
      .map((p, i) => ({ p, v: view.main.clauses[i] }))
      .filter(({ p }) => p.disclosure !== 'realtime')
    expect(hidden.length).toBeGreaterThan(0)
    for (const { v } of hidden) {
      expect(v.have).toBe(null)
      expect(v.met).toBe(null)
    }
  })

  it('정산 때는 정산 조항만 열린다', () => {
    const view = discloseFor(result, 'settlement')
    for (const [i, p] of result.main.clauses.entries()) {
      const v = view.main.clauses[i]
      if (p.disclosure === 'realtime' || p.disclosure === 'settlement') expect(v.have).not.toBe(null)
      else expect(v.have).toBe(null)
    }
  })

  it('끝나면 전부 열린다', () => {
    const view = discloseFor(result, 'end')
    for (const v of [...view.main.clauses, ...view.bond.clauses]) expect(v.have).not.toBe(null)
    expect(view.score).not.toBe(null)
    expect(view.bandId).not.toBe(null)
  })

  it('끝나기 전에는 점수도 엔딩도 내려보내지 않는다', () => {
    for (const phase of ['live', 'settlement'] as const) {
      const view = discloseFor(result, phase)
      expect(view.score).toBe(null)
      expect(view.bandId).toBe(null)
    }
  })

  it('가려진 조항은 달성 여부도 알려 주지 않는다', () => {
    const view = discloseFor(result, 'live')
    if (view.main.clauses.some((c) => !c.shown)) expect(view.main.met).toBe(null)
  })

  it('고발자의 적중은 끝까지 숫자가 나가지 않는다', () => {
    const accuser = judge(
      me('accuser'),
      log({ votes: [{ voterId: 'me', targetId: 'x', kind: 'suspicion', day: 1, exactHit: true, atMs: NOW }] }),
    )
    for (const phase of ['live', 'settlement'] as const) {
      const view = discloseFor(accuser, phase)
      for (const c of view.main.clauses) expect(c.have).toBe(null)
    }
  })
})

describe('새면 안 되는 것', () => {
  const result = judge(
    me('witness'),
    log({ votes: [{ voterId: 'x', targetId: 'me', kind: 'suspicion', day: 2, atMs: NOW }] }),
  )

  it('내려보내는 문서에 표를 보낸 사람이 없다', () => {
    for (const phase of ['live', 'settlement', 'end'] as const) {
      const text = JSON.stringify(discloseFor(result, phase))
      expect(text).not.toContain('voterId')
      expect(text).not.toContain('"x"')
    }
  })

  it('내려보내는 문서에 인연 대상 아이디가 없다', () => {
    // 인연은 본인도 모른다 — 미션 글에 「인연 대상」이라고만 적혀 있다
    const text = JSON.stringify(discloseFor(result, 'live'))
    expect(text).not.toContain('bondId')
    expect(text).not.toContain('"pal"')
  })

  it('내려보내는 문서에 남의 아이디가 하나도 없다', () => {
    const text = JSON.stringify(discloseFor(result, 'end'))
    for (const other of ['pal', 'x', 'y', 'z']) {
      expect(text.includes(`"${other}"`), other).toBe(false)
    }
    expect(text).toContain('"me"')
  })
})
