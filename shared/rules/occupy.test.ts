import { describe, expect, it } from 'vitest'

import {
  MAX_CARRIED_ROBOTS,
  ROOM_CAPACITY,
  ROOM_KIND,
  capacityOf,
  ownerOf,
  resolvePhase,
  shownCount,
  stepToward,
  type Action,
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
})
const robot = (id: string, team: TeamId, tileId: string, carriedBy: string | null = null): Robot => ({
  id,
  team,
  tileId,
  carriedBy,
})
const state = (over: Partial<PhaseState> = {}): PhaseState => ({
  people: [],
  robots: [],
  owners: {},
  pendingResearch: [],
  ...over,
})
const doIt = (playerId: string, kind: Action['kind'], over: Partial<Action> = {}, atMs = 1): Action => ({
  playerId,
  kind,
  atMs,
  ...over,
})

describe('방 종류', () => {
  it('좁은 방·연구실·발전소가 하나씩은 있다', () => {
    const kinds = TILES.map((t) => ROOM_KIND[t.id])
    expect(kinds).toContain('narrow')
    expect(kinds).toContain('lab')
    expect(kinds).toContain('plant')
  })

  it('발전소는 한 곳뿐이고 네 기지에서 거리가 같다', () => {
    const plants = TILES.filter((t) => ROOM_KIND[t.id] === 'plant')
    expect(plants).toHaveLength(1)
    const bases = TILES.filter((t) => t.homeOf !== null)
    const walk = (from: string, to: string) => {
      let at = from
      let n = 0
      while (at !== to && n < 20) {
        at = stepToward(at, to) as string
        n += 1
      }
      return n
    }
    const dists = bases.map((b) => walk(b.id, plants[0].id))
    expect(new Set(dists).size).toBe(1)
  })

  it('연구실과 좁은 방도 네 팀에게 공평하다', () => {
    const bases = TILES.filter((t) => t.homeOf !== null)
    const walk = (from: string, to: string) => {
      let at = from
      let n = 0
      while (at !== to && n < 20) {
        at = stepToward(at, to) as string
        n += 1
      }
      return n
    }
    for (const kind of ['lab', 'narrow'] as const) {
      const rooms = TILES.filter((t) => ROOM_KIND[t.id] === kind)
      // 각 기지에서 제일 가까운 그 종류의 방까지 거리가 모두 같아야 한다
      const nearest = bases.map((b) => Math.min(...rooms.map((r) => walk(b.id, r.id))))
      expect(new Set(nearest).size).toBe(1)
    }
  })

  it('정원은 종류가 정한다', () => {
    const narrow = TILES.find((t) => ROOM_KIND[t.id] === 'narrow') as (typeof TILES)[number]
    expect(capacityOf(narrow.id)).toBe(ROOM_CAPACITY.narrow)
  })
})

describe('주인 정하기', () => {
  it('가장 많은 팀이 가져간다', () => {
    expect(ownerOf({ A: 3, B: 1 }, null)).toBe('A')
  })

  it('동점이면 주인이 안 바뀐다', () => {
    expect(ownerOf({ A: 2, B: 2 }, 'C')).toBe('C')
    expect(ownerOf({ A: 2, B: 2 }, null)).toBe(null)
  })

  it('아무도 없으면 주인이 그대로다', () => {
    expect(ownerOf({}, 'D')).toBe('D')
  })

  it('주장은 둘로 세서 3인 팀이 4인 팀과 맞선다', () => {
    const s = state({
      people: [
        person('a1', 'A', 'classroom'),
        person('a2', 'A', 'classroom'),
        person('c1', 'C', 'classroom', true),
        person('c2', 'C', 'classroom'),
      ],
    })
    const out = resolvePhase(s, [])
    // A 둘 대 C 셋(주장 2 + 1)
    expect(out.next.owners.classroom).toBe('C')
  })
})

describe('이동', () => {
  it('옆방으로만 간다', () => {
    const s = state({ people: [person('a1', 'A', 'baseA')] })
    const far = resolvePhase(s, [doIt('a1', 'move', { targetTile: 'baseB' })])
    expect(far.next.people[0].tileId).toBe('baseA')
    expect(far.log.some((l) => l.kind === 'moveBlocked')).toBe(true)
  })

  it('데리고 있는 로봇도 같이 간다. 두고 간 로봇은 남는다', () => {
    const s = state({
      people: [person('a1', 'A', 'baseA')],
      robots: [robot('r1', 'A', 'baseA', 'a1'), robot('r2', 'A', 'baseA', null)],
    })
    const out = resolvePhase(s, [doIt('a1', 'move', { targetTile: 'classroom' })])
    expect(out.next.robots.find((r) => r.id === 'r1')?.tileId).toBe('classroom')
    expect(out.next.robots.find((r) => r.id === 'r2')?.tileId).toBe('baseA')
  })

  it('꽉 찬 방에는 못 들어간다 — 좁은 방은 둘까지다', () => {
    const narrow = TILES.find((t) => ROOM_KIND[t.id] === 'narrow') as (typeof TILES)[number]
    const near = TILES.find((t) => t.id !== narrow.id && stepToward(t.id, narrow.id) === narrow.id)
    const s = state({
      people: [
        person('a1', 'A', narrow.id),
        person('a2', 'A', narrow.id),
        person('b1', 'B', near?.id ?? 'centralPlaza'),
      ],
    })
    const out = resolvePhase(s, [doIt('b1', 'move', { targetTile: narrow.id })])
    expect(out.next.people.find((p) => p.playerId === 'b1')?.tileId).not.toBe(narrow.id)
    expect(out.log.find((l) => l.kind === 'moveBlocked')?.why).toContain('꽉 찼다')
  })

  it('먼저 낸 쪽이 마지막 자리를 가져간다', () => {
    const narrow = TILES.find((t) => ROOM_KIND[t.id] === 'narrow') as (typeof TILES)[number]
    const doors = TILES.filter((t) => stepToward(t.id, narrow.id) === narrow.id).slice(0, 2)
    const s = state({
      people: [person('a1', 'A', narrow.id), person('b1', 'B', doors[0].id), person('c1', 'C', doors[1].id)],
    })
    const out = resolvePhase(s, [
      doIt('c1', 'move', { targetTile: narrow.id }, 200),
      doIt('b1', 'move', { targetTile: narrow.id }, 100),
    ])
    expect(out.next.people.find((p) => p.playerId === 'b1')?.tileId).toBe(narrow.id)
    expect(out.next.people.find((p) => p.playerId === 'c1')?.tileId).not.toBe(narrow.id)
  })
})

describe('호출', () => {
  it('한 칸 끌려온다. 옆방이면 내 방으로 들어온다', () => {
    const s = state({ people: [person('a1', 'A', 'baseA'), person('a2', 'A', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'summon', { targetPlayer: 'a2' })])
    expect(out.next.people.find((p) => p.playerId === 'a2')?.tileId).toBe('baseA')
  })

  it('그 사람이 스스로 움직였으면 불발된다', () => {
    const s = state({ people: [person('a1', 'A', 'baseA'), person('a2', 'A', 'classroom')] })
    const out = resolvePhase(s, [
      doIt('a1', 'summon', { targetPlayer: 'a2' }, 100),
      doIt('a2', 'move', { targetTile: 'library' }, 200),
    ])
    expect(out.next.people.find((p) => p.playerId === 'a2')?.tileId).toBe('library')
    expect(out.log.find((l) => l.kind === 'summonFailed')?.why).toContain('스스로')
  })

  it('둘이 같은 사람을 부르면 먼저 부른 쪽만', () => {
    const s = state({
      people: [person('a1', 'A', 'baseA'), person('a2', 'A', 'library'), person('a3', 'A', 'artRoom')],
    })
    const out = resolvePhase(s, [
      doIt('a1', 'summon', { targetPlayer: 'a2' }, 100),
      doIt('a3', 'summon', { targetPlayer: 'a2' }, 200),
    ])
    expect(out.log.filter((l) => l.kind === 'summoned')).toHaveLength(1)
    expect(out.log.find((l) => l.kind === 'summonFailed')?.why).toContain('먼저')
  })

  it('다른 팀은 못 부른다', () => {
    const s = state({ people: [person('a1', 'A', 'baseA'), person('b1', 'B', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'summon', { targetPlayer: 'b1' })])
    expect(out.next.people.find((p) => p.playerId === 'b1')?.tileId).toBe('classroom')
    expect(out.log.find((l) => l.kind === 'summonFailed')?.why).toContain('같은 팀')
  })
})

describe('방해', () => {
  it('그 대상은 이번 판정에서 0으로 센다', () => {
    const s = state({
      people: [person('a1', 'A', 'classroom'), person('b1', 'B', 'classroom'), person('b2', 'B', 'classroom')],
    })
    // 방해 없으면 B가 둘로 가져간다
    expect(resolvePhase(s, []).next.owners.classroom).toBe('B')
    // b1을 지우면 1:1이라 동점 — 주인이 안 바뀐다
    const out = resolvePhase(s, [doIt('a1', 'disturb', { targetPlayer: 'b1' })])
    expect(out.next.owners.classroom).toBe(null)
  })

  it('둘이 같은 대상을 방해해도 효과는 같다', () => {
    const s = state({
      people: [
        person('a1', 'A', 'classroom'),
        person('a2', 'A', 'classroom'),
        person('b1', 'B', 'classroom'),
        person('b2', 'B', 'classroom'),
        person('b3', 'B', 'classroom'),
      ],
    })
    const one = resolvePhase(s, [doIt('a1', 'disturb', { targetPlayer: 'b1' }, 1)])
    const two = resolvePhase(s, [
      doIt('a1', 'disturb', { targetPlayer: 'b1' }, 1),
      doIt('a2', 'disturb', { targetPlayer: 'b1' }, 2),
    ])
    expect(one.next.owners.classroom).toBe(two.next.owners.classroom)
  })

  it('같은 방에 없으면 불발된다', () => {
    const s = state({ people: [person('a1', 'A', 'baseA'), person('b1', 'B', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'disturb', { targetPlayer: 'b1' })])
    expect(out.log.find((l) => l.kind === 'disturbFailed')?.why).toContain('같은 방')
  })

  it('로봇도 방해할 수 있다', () => {
    const s = state({
      people: [person('a1', 'A', 'classroom')],
      robots: [robot('r1', 'B', 'classroom'), robot('r2', 'B', 'classroom')],
    })
    const out = resolvePhase(s, [doIt('a1', 'disturb', { targetRobot: 'r1' })])
    // B는 로봇 하나만 세고 A는 사람 하나 — 동점이라 주인이 안 바뀐다
    expect(out.next.owners.classroom).toBe(null)
  })
})

describe('로봇', () => {
  it('사람만 부술 수 있고, 그 방에 상대 사람이 없어야 한다', () => {
    const guarded = state({
      people: [person('a1', 'A', 'classroom'), person('b1', 'B', 'classroom')],
      robots: [robot('r1', 'B', 'classroom')],
    })
    const no = resolvePhase(guarded, [doIt('a1', 'smashRobot', { targetRobot: 'r1' })])
    expect(no.next.robots).toHaveLength(1)
    expect(no.log.find((l) => l.kind === 'smashFailed')?.why).toContain('상대 팀 사람')

    const alone = state({
      people: [person('a1', 'A', 'classroom')],
      robots: [robot('r1', 'B', 'classroom')],
    })
    const yes = resolvePhase(alone, [doIt('a1', 'smashRobot', { targetRobot: 'r1' })])
    expect(yes.next.robots).toHaveLength(0)
  })

  it('우리 팀 로봇은 못 부순다', () => {
    const s = state({ people: [person('a1', 'A', 'classroom')], robots: [robot('r1', 'A', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'smashRobot', { targetRobot: 'r1' })])
    expect(out.next.robots).toHaveLength(1)
  })

  it('두고 간 로봇은 그 자리에서 계속 센다', () => {
    const s = state({
      people: [person('a1', 'A', 'classroom')],
      robots: [robot('r1', 'A', 'classroom', 'a1')],
    })
    const out = resolvePhase(s, [doIt('a1', 'dropRobot')])
    expect(out.next.robots[0].carriedBy).toBe(null)
    expect(out.next.robots[0].tileId).toBe('classroom')
  })
})

describe('연구', () => {
  const lab = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as (typeof TILES)[number]
  const plant = TILES.find((t) => ROOM_KIND[t.id] === 'plant') as (typeof TILES)[number]

  it('연구실에서만 걸 수 있다', () => {
    const s = state({ people: [person('a1', 'A', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'research')])
    expect(out.next.pendingResearch).toHaveLength(0)
    expect(out.log.find((l) => l.kind === 'researchFailed')?.why).toContain('연구실')
  })

  it('한 페이즈 뒤에 로봇이 생긴다', () => {
    const s = state({ people: [person('a1', 'A', lab.id)] })
    const first = resolvePhase(s, [doIt('a1', 'research')])
    expect(first.next.robots).toHaveLength(0)
    expect(first.next.pendingResearch).toEqual(['a1'])

    const second = resolvePhase(first.next, [])
    expect(second.next.robots).toHaveLength(1)
    expect(second.next.robots[0].carriedBy).toBe('a1')
  })

  it('발전소를 쥔 팀은 그 자리에서 끝난다', () => {
    const s = state({ people: [person('a1', 'A', lab.id)], owners: { [plant.id]: 'A' } })
    const out = resolvePhase(s, [doIt('a1', 'research')])
    expect(out.next.robots).toHaveLength(1)
    expect(out.next.pendingResearch).toHaveLength(0)
  })

  it(`데리고 다니는 로봇은 ${MAX_CARRIED_ROBOTS}기까지. 넘치면 그 자리에 선다`, () => {
    const s = state({
      people: [person('a1', 'A', lab.id)],
      robots: [robot('r1', 'A', lab.id, 'a1'), robot('r2', 'A', lab.id, 'a1')],
      owners: { [plant.id]: 'A' },
    })
    const out = resolvePhase(s, [doIt('a1', 'research')])
    const fresh = out.next.robots.filter((r) => r.id !== 'r1' && r.id !== 'r2')
    expect(fresh).toHaveLength(1)
    expect(fresh[0].carriedBy).toBe(null)
  })

  it('새로 생긴 로봇은 이번 판정에 끼어들지 않는다', () => {
    // 연구실에서 A 하나 대 B 하나. 로봇이 이번에 세어지면 A가 가져간다
    const s = state({
      people: [person('a1', 'A', lab.id), person('b1', 'B', lab.id)],
      pendingResearch: ['a1'],
    })
    const out = resolvePhase(s, [])
    expect(out.next.robots).toHaveLength(1)
    expect(out.next.owners[lab.id]).toBe(null)
  })
})

describe('위장', () => {
  it('판정은 그대로고 남에게 보이는 숫자만 바뀐다', () => {
    const s = state({ people: [person('a1', 'A', 'classroom'), person('b1', 'B', 'classroom')] })
    const out = resolvePhase(s, [doIt('a1', 'disguise')])
    expect(out.next.owners.classroom).toBe(null)
    expect(out.disguised).toEqual(['a1'])
    // 남에게는 둘로, 같은 팀에게는 하나로
    expect(shownCount(out.next, 'classroom', 'B', out.disguised)).toBe(3)
    expect(shownCount(out.next, 'classroom', 'A', out.disguised)).toBe(2)
  })
})

describe('판 전체', () => {
  it('네 팀이 기지에서 시작하면 각자 자기 기지를 쥔다', () => {
    const people = TEAM_IDS.map((t, i) => person(`p${i}`, t, `base${t}`))
    const out = resolvePhase(state({ people }), [])
    for (const t of TEAM_IDS) expect(out.next.owners[`base${t}`]).toBe(t)
  })

  it('행동을 안 낸 사람은 그 자리에 그대로 있다', () => {
    const s = state({ people: [person('a1', 'A', 'classroom')] })
    const out = resolvePhase(s, [])
    expect(out.next.people[0].tileId).toBe('classroom')
  })
})
