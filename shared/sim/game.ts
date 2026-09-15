// 봇 시뮬레이션 — 규칙을 실제로 돌려 본다.
//
// 사람이 못 하는 일을 한다. 백 판을 끝까지 돌려서 점수가 한쪽으로
// 쏠리지 않는지, 미션이 아무도 못 깰 만큼 어렵지 않은지, 규칙이 서로
// 부딪혀 판이 멈추지 않는지 본다.
//
// 이 파일은 판정 규칙을 다시 쓰지 않는다. shared/rules와 shared/missions의
// 함수를 그대로 부른다 — 여기서 따로 계산하면 시뮬레이션이 통과해도
// 진짜 판은 다르게 돈다.
import {
  ADJACENCY,
  START_TILE,
  TILE_BY_ID,
  TILE_IDS,
  pathBetween,
  startingTiles,
  type TileId,
} from '../rules/board'
import { addActiveSeconds, dayNumber, secondsIntoSeoulDay, seoulTimeOn } from '../rules/clock'
import { gain, pay, type TileState } from '../rules/resources'
import { ownerLookup } from '../rules/actions'
import { ROOM_KIND, ownerOf, researchKnowledge } from '../rules/occupy'
import { coreOpen, inLastHours } from '../rules/fragments'
import { accrueTokens, initialTokenState, markComeback, spendToken, type TokenState } from '../rules/tokens'
import { tallyVotes, type Vote } from '../rules/votes'
import { reveal, type Leverage } from '../rules/leverage'
import { acceptTrade, breakAlliance, canAlly, clearAlliances, type AllianceState } from '../rules/diplomacy'
import { finalScore, publicScore, settle, territoryScore, type ScoreBreakdown, type TeamState } from '../rules/score'
import {
  DAY_START_HOUR,
  GOALS,
  GOALS_PER_TEAM,
  MOVE_GAME_MIN_PER_TILE,
  SETTLEMENT_HOUR,
  STARTING_RESOURCES,
  TEAM_IDS,
  STARTING_TEAM_SIZES,
  TOTAL_DAYS,
  type GoalKind,
  type Resource,
  type TeamId,
} from '../rules/v2'
import type { Interval } from '../rules/presence'
import { assignRoles, rngFrom, type Assignment, type Player } from '../missions/assign'
import { judge, type CaptureRecord, type GameLog, type JudgeVote, type RevealRecord, type TradeRecord } from '../missions/judge'
import { ROLE_BY_ID } from '../missions/roles'

const TICK_SEC = MOVE_GAME_MIN_PER_TILE * 60

// ── 상태 ────────────────────────────────────────────────────────

interface SimTeam {
  resources: Record<Resource, number>
  tokens: TokenState
  researchTier: number
  alliance: AllianceState
  goals: { kind: GoalKind; rivalTeam?: TeamId }[]
  lostTile: boolean
  raidSuccesses: number
  brokeAlliance: boolean
  trustFrom: Set<TeamId>
  revealed: boolean
  spotlighted: boolean
}

interface SimPlayer {
  id: string
  team: TeamId
  tileId: TileId | null
  /** 남은 경로. 첫 칸이 다음 목적지다. */
  path: TileId[]
  arriveAtMs: number | null
  votedToday: boolean
  revealGained: number
  /** 내가 꽂은 깃발이 익을 때까지 자리를 지킨다. */
  guardUntilMs: number | null
}

export interface SimResult {
  seed: string
  /** 팀별 최종 점수. */
  teamScores: ScoreBreakdown[]
  winner: TeamId
  /** 사람별 개인 점수. */
  personal: { playerId: string; roleId: string; score: number; main: boolean; bond: boolean }[]
  /** 주인이 바뀐 횟수. */
  capturesMade: number
  votesCast: number
  reveals: number
  /** 판이 멈추지 않고 끝까지 갔는가. */
  finished: boolean
}

// ── 한 판 ───────────────────────────────────────────────────────

export function simulateGame(seed: string, startMs: number): SimResult {
  const rnd = rngFrom(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]

  // 명단
  const roster: Player[] = (Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]).flatMap(([team, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${team}${i + 1}`, team })),
  )
  const assignments = assignRoles(roster, seed)
  const byId = new Map(assignments.map((a) => [a.playerId, a]))
  const teamOf = (id: string) => byId.get(id)?.team ?? 'A'

  // 판
  const tiles = new Map<TileId, TileState>()
  for (const id of TILE_IDS) {
    tiles.set(id, { tileId: id, ownerTeam: TILE_BY_ID[id].homeOf })
  }
  for (const team of TEAM_IDS) {
    for (const id of startingTiles(team)) {
      const t = tiles.get(id)
      if (t) t.ownerTeam = team
    }
  }

  // 비밀 목표 — 열여섯 장에서 겹치지 않게 나눈다
  const deck = [...GOALS].sort(() => rnd() - 0.5)
  const teams = {} as Record<TeamId, SimTeam>
  for (const team of TEAM_IDS) {
    teams[team] = {
      resources: { ...STARTING_RESOURCES },
      tokens: initialTokenState(startMs),
      researchTier: 0,
      alliance: { allyTeam: null, lockUntilRealMs: null },
      goals: deck.splice(0, GOALS_PER_TEAM).map((g) => ({
        kind: g.kind,
        rivalTeam: g.needsRivalTeam ? pick(TEAM_IDS.filter((t) => t !== team)) : undefined,
      })),
      lostTile: false,
      raidSuccesses: 0,
      brokeAlliance: false,
      trustFrom: new Set(),
      revealed: false,
      spotlighted: false,
    }
  }

  const players = new Map<string, SimPlayer>(
    assignments.map((a) => [
      a.playerId,
      {
        id: a.playerId, team: a.team, tileId: START_TILE, path: [], arriveAtMs: null,
        votedToday: false, revealGained: 0, guardUntilMs: null,
      },
    ]),
  )

  // 기록
  const intervals: Interval[] = [...players.values()].map((p) => ({
    playerId: p.id,
    tileId: p.tileId,
    startMs: startMs,
    endMs: null,
    state: 'standing',
  }))
  const votes: Vote[] = []
  const judgeVotes: JudgeVote[] = []
  const reveals: RevealRecord[] = []
  const leverages: Leverage[] = []
  const captureLog: CaptureRecord[] = []
  const trades: TradeRecord[] = []
  const fragments: { day: number; spotTile: TileId }[] = []

  let capturesMade = 0
  let lastSettleHour = -1

  const owner = () => ownerLookup([...tiles.values()])

  /** 말을 옮긴 것으로 기록한다. 걷는 동안은 어느 칸에도 서 있지 않다. */
  function close(playerId: string, atMs: number) {
    for (const iv of intervals) if (iv.playerId === playerId && iv.endMs === null) iv.endMs = atMs
  }
  function open(playerId: string, tileId: TileId | null, atMs: number, state: Interval['state']) {
    intervals.push({ playerId, tileId, startMs: atMs, endMs: null, state })
  }

  const endMs = seoulTimeOn(startMs + (TOTAL_DAYS - 1) * 86_400_000, SETTLEMENT_HOUR)
  let nowMs = startMs
  let lastDay = 1

  // ── 시계 ──
  while (nowMs < endMs) {
    const day = dayNumber(startMs, nowMs)

    // 08:00 — 새 날
    if (day !== lastDay) {
      lastDay = day
      fragments.push({ day, spotTile: pick(TILE_IDS.filter((t) => TILE_BY_ID[t].tier !== 'base')) })
      for (const p of players.values()) p.votedToday = false
      if (day === 4) {
        const cleared = clearAlliances(
          Object.fromEntries(TEAM_IDS.map((t) => [t, teams[t].alliance])) as Record<TeamId, AllianceState>,
        )
        for (const t of TEAM_IDS) teams[t].alliance = cleared[t]
      }
    }

    // 토큰 충전
    for (const t of TEAM_IDS) teams[t].tokens = accrueTokens(teams[t].tokens, nowMs).state

    // 도착
    for (const p of players.values()) {
      if (p.arriveAtMs !== null && nowMs >= p.arriveAtMs) {
        const next = p.path.shift() as TileId
        close(p.id, p.arriveAtMs)
        if (p.path.length > 0) {
          // 지나쳐 간 칸이다. 발은 디뎠으므로 방문으로는 세지만, 서 있지
          // 않으므로 깃발 판정에는 들어가지 않는다
          p.tileId = null
          p.arriveAtMs = addActiveSeconds(p.arriveAtMs, TICK_SEC)
          open(p.id, next, nowMs, 'walking')
        } else {
          p.tileId = next
          p.arriveAtMs = null
          open(p.id, next, nowMs, 'standing')
        }
      }
    }

    // 한 시간마다 점령을 판정한다. **서 있는 머릿수로만 정한다** —
    // 페이즈가 닫힐 때 서버가 하는 일과 같은 셈이다
    const hour = Math.floor(nowMs / 3_600_000)
    if (hour !== lastSettleHour) {
      lastSettleHour = hour
      for (const tile of tiles.values()) {
        if (TILE_BY_ID[tile.tileId].tier === 'base') continue
        const standing = [...players.values()].filter((p) => p.tileId === tile.tileId)
        const heads: Partial<Record<TeamId, number>> = {}
        for (const p of standing) heads[p.team as TeamId] = (heads[p.team as TeamId] ?? 0) + 1
        const before = tile.ownerTeam
        const after = ownerOf(heads, before)
        if (standing.length > 0 || after !== before) {
          captureLog.push({
            tileId: tile.tileId,
            team: after,
            ownerBefore: before,
            standing: standing.map((p) => p.id),
            atMs: nowMs,
          })
        }
        if (after === before) continue
        if (before) teams[before as TeamId].lostTile = true
        if (after && before) teams[after as TeamId].raidSuccesses += 1
        tile.ownerTeam = after
        capturesMade += 1
      }
    }

    // 사람마다 한 수
    for (const a of assignments) {
      const p = players.get(a.playerId) as SimPlayer
      act(p, a)
    }

    // 21:00 정산
    if (secondsIntoSeoulDay(nowMs) === SETTLEMENT_HOUR * 3600) settlement(day)

    nowMs = addActiveSeconds(nowMs, TICK_SEC)
  }

  // ── 종례 ──
  for (const p of players.values()) close(p.id, endMs)

  const finalTeam = (team: TeamId): TeamState => ({
    team,
    resources: teams[team].resources,
    researchTier: teams[team].researchTier,
    allyTeam: teams[team].alliance.allyTeam,
    goals: teams[team].goals,
    lostTile: teams[team].lostTile,
    raidSuccesses: teams[team].raidSuccesses,
    brokeAlliance: teams[team].brokeAlliance,
    trustFrom: [...teams[team].trustFrom],
    revealed: teams[team].revealed,
  })
  const tileList = [...tiles.values()]
  const territoryOf = (team: TeamId) =>
    territoryScore({ tiles: tileList, fragments, team: finalTeam(team) })
  const scores = TEAM_IDS.map((team) =>
    finalScore({ tiles: tileList, fragments, team: finalTeam(team) }, territoryOf),
  )
  const ranked = settle(scores, (t) => teams[t].resources.knowledge)

  const gameLog: GameLog = {
    startedAtMs: startMs,
    nowMs: endMs,
    over: true,
    teamOf,
    intervals,
    votes: judgeVotes,
    reveals,
    leverageUses: [],
    captures: captureLog,
    leverageGains: leverages.map((l) => ({ holderId: l.holderId, aboutId: l.aboutId, atMs: l.gainedAtMs })),
    trades,
    fragmentTiles: fragments.map((f) => f.spotTile),
    ownerAtEnd: (id) => tiles.get(id)?.ownerTeam ?? null,
    teamRank: Object.fromEntries(ranked.ranked.map((r) => [r.team, r.rank])) as Record<TeamId, number>,
    allianceAtEnd: Object.fromEntries(TEAM_IDS.map((t) => [t, teams[t].alliance.allyTeam])) as Record<TeamId, TeamId | null>,
    leverageAtEnd: leverages.filter((l) => l.spentAtMs === null).map((l) => ({ holderId: l.holderId, aboutId: l.aboutId })),
    teamLostTile: Object.fromEntries(TEAM_IDS.map((t) => [t, teams[t].lostTile])) as Record<TeamId, boolean>,
    chosenBy: {},
    choiceMet: {},
    closingTogether: {},
    closingMutual: {},
    // 봇은 그 자리를 모르고, 공동 목표도 노리지 않는다.
    // 0단계에서는 자리만 만들어 두고 6단계 시뮬레이션에서 채운다.
    awakened: {},
    snowStopped: false,
  }

  const personal = assignments.map((a) => {
    const out = judge(a, gameLog)
    return { playerId: a.playerId, roleId: a.roleId as string, score: out.score, main: out.main.met, bond: out.bond.met }
  })

  return {
    seed,
    teamScores: scores,
    winner: ranked.ranked[0].team,
    personal,
    capturesMade,
    votesCast: votes.length,
    reveals: reveals.length,
    finished: true,
  }

  // ── 봇 한 수 ──

  function act(p: SimPlayer, a: Assignment): void {
    if (p.tileId === null) return
    const team = teams[p.team]
    const day = dayNumber(startMs, nowMs)

    // 표 — 하루 한 장
    if (!p.votedToday && rnd() < 0.15 && secondsIntoSeoulDay(nowMs) < SETTLEMENT_HOUR * 3600) {
      const others = assignments.filter((x) => x.team !== p.team)
      const target = pick(others)
      const kind = rnd() < 0.5 ? 'trust' : 'liking'
      votes.push({
        voterId: p.id, voterTeam: p.team, targetId: target.playerId, targetTeam: target.team,
        kind, atMs: nowMs,
      })
      judgeVotes.push({ voterId: p.id, targetId: target.playerId, kind, day, atMs: nowMs })
      if (kind === 'trust') teams[target.team].trustFrom.add(p.team)
      p.votedToday = true
      return
    }

    // 털어놓기 — 가끔
    if (rnd() < 0.004) {
      const scope = rnd() < 0.3 ? 'class' : 'private'
      const listeners =
        scope === 'class'
          ? assignments.map((x) => x.playerId).filter((x) => x !== p.id)
          : [pick(assignments.filter((x) => x.playerId !== p.id)).playerId]
      const out = reveal({
        speakerId: p.id, scope, listenerIds: listeners, alreadyGained: p.revealGained,
        atMs: nowMs, existing: leverages,
      })
      p.revealGained += 1
      leverages.push(...out.gained)
      team.revealed = true
      reveals.push({ speakerId: p.id, scope, listenerIds: listeners, day, atMs: nowMs })
      return
    }

    // 토큰이 있으면 행동
    const here = tiles.get(p.tileId) as TileState
    const look = owner()


    // 연구. **연구실에서만 한다.** 차지한 팀은 지식 한 점, 남은 두 점을
    // 주인 팀 금고에 낸다 — 판이 연구실 하나로 돌아가는지를 여기서 본다
    if (ROOM_KIND[p.tileId] === 'lab' && rnd() < 0.5) {
      const owner = here.ownerTeam
      const need = researchKnowledge(owner === p.team)
      const left = pay(team.resources, { knowledge: need })
      if (left) {
        const spent = spendToken(team.tokens, p.id)
        if (spent.ok) {
          team.tokens = spent.state
          team.resources = left
          team.researchTier += 1
          if (owner && owner !== p.team) {
            teams[owner].resources = gain(teams[owner].resources, { knowledge: need })
          }
          return
        }
      }
    }


    // 교역 — 가끔
    if (rnd() < 0.02) {
      const other = pick(TEAM_IDS.filter((t) => t !== p.team))
      const out = acceptTrade(
        { id: 't', fromTeam: p.team, toTeam: other, give: { money: 2 }, want: { knowledge: 1 }, createdAtMs: nowMs },
        team.resources,
        teams[other].resources,
      )
      if (out.ok) {
        team.resources = out.fromResources
        teams[other].resources = out.toResources
        trades.push({ fromTeam: p.team, toTeam: other, atMs: nowMs })
      }
      return
    }

    // 동맹 — 아주 가끔
    if (rnd() < 0.01) {
      const other = pick(TEAM_IDS.filter((t) => t !== p.team))
      const ok = canAlly({
        us: team.alliance, them: teams[other].alliance, ourTeam: p.team, theirTeam: other,
        realNowMs: nowMs, lastHours: inLastHours(startMs, nowMs),
      })
      if (ok.ok) {
        team.alliance = { ...team.alliance, allyTeam: other }
        teams[other].alliance = { ...teams[other].alliance, allyTeam: p.team }
      } else if (team.alliance.allyTeam && rnd() < 0.3) {
        const broke = breakAlliance(nowMs)
        const ally = team.alliance.allyTeam
        team.alliance = broke.breaker
        teams[ally].alliance = broke.other
        team.brokeAlliance = true
      }
      return
    }

    // 깃발을 꽂았으면 익을 때까지 서 있는다. 떠나면 그 자리에서 실패다
    if (p.guardUntilMs !== null) {
      if (nowMs < p.guardUntilMs) return
      p.guardUntilMs = null
    }

    // 걷는다 — 절반은 우리 땅으로 돌아가고, 절반은 남의 땅을 노린다
    if (p.path.length === 0 && rnd() < 0.4) {
      const goHome = rnd() < 0.4
      const wanted = goHome
        ? TILE_IDS.filter(
            (id) => TILE_BY_ID[id].tier !== 'base' && look(id) === p.team,
          )
        : TILE_IDS.filter(
            (id) =>
              TILE_BY_ID[id].tier !== 'base' &&
              look(id) !== p.team &&
              ADJACENCY[id].some((n) => look(n) === p.team) &&
              coreOpen(id, day),
          )
      const goal = wanted.length > 0 ? pick(wanted) : pick(ADJACENCY[p.tileId])
      const path = pathBetween(p.tileId, goal)
      if (path.length > 0) {
        close(p.id, nowMs)
        p.path = path
        p.tileId = null
        p.arriveAtMs = addActiveSeconds(nowMs, TICK_SEC)
        open(p.id, null, nowMs, 'walking')
      }
    }
    void a
  }

  // ── 21:00 ──
  function settlement(day: number): void {
    // **생산은 없어졌다.** 21:00에 나오던 것은 건물 생산뿐이었다 —
    // 이제 금고는 노동·탐색·카드·교역으로만 는다
    // 1. 표
    const todays = votes.filter((v) => dayNumber(startMs, v.atMs) === day)
    // 표는 금고를 움직이지 않는다. 받은 장수만 세어 목표 판정에 쓴다
    tallyVotes({ votes: todays })
    // 3. 점수와 순위
    const list = [...tiles.values()]
    const open = TEAM_IDS.map((team) =>
      publicScore({
        tiles: list,
        fragments,
        team: {
          team, resources: teams[team].resources, researchTier: teams[team].researchTier,
          allyTeam: teams[team].alliance.allyTeam, goals: [], lostTile: teams[team].lostTile,
          raidSuccesses: teams[team].raidSuccesses, brokeAlliance: teams[team].brokeAlliance,
          trustFrom: [...teams[team].trustFrom], revealed: teams[team].revealed,
        },
      }),
    )
    // 4. 주목과 만회
    const out = settle(open, (t) => teams[t].resources.knowledge)
    for (const t of TEAM_IDS) teams[t].spotlighted = t === out.spotlighted
    teams[out.comeback].tokens = markComeback(teams[out.comeback].tokens)
  }
}

// ── 여러 판 ─────────────────────────────────────────────────────

export interface SimReport {
  games: number
  /** 팀별 우승 횟수. 한 팀이 몰아 가면 판이 기울어 있다는 뜻이다. */
  wins: Record<TeamId, number>
  teamScore: { min: number; max: number; mean: number }
  personalScore: { mean: number; dist: number[] }
  /** 역할마다 주 미션을 깬 비율. */
  mainRate: Record<string, number>
  bondRate: Record<string, number>
  perGame: { captures: number; votes: number; reveals: number }
}

export function runGames(count: number, startMs: number, seedPrefix = 'sim'): SimReport {
  const results: SimResult[] = []
  for (let i = 0; i < count; i++) results.push(simulateGame(`${seedPrefix}-${i}`, startMs))

  const wins = Object.fromEntries(TEAM_IDS.map((t) => [t, 0])) as Record<TeamId, number>
  const teamTotals: number[] = []
  const personalTotals: number[] = []
  const dist = Array.from({ length: 10 }, () => 0)
  const mainHit = new Map<string, { met: number; n: number }>()
  const bondHit = new Map<string, { met: number; n: number }>()
  const sums = { captures: 0, votes: 0, reveals: 0 }

  for (const r of results) {
    wins[r.winner] += 1
    for (const s of r.teamScores) teamTotals.push(s.total)
    for (const p of r.personal) {
      personalTotals.push(p.score)
      dist[p.score] += 1
      const m = mainHit.get(p.roleId) ?? { met: 0, n: 0 }
      m.n++
      if (p.main) m.met++
      mainHit.set(p.roleId, m)
      const b = bondHit.get(p.roleId) ?? { met: 0, n: 0 }
      b.n++
      if (p.bond) b.met++
      bondHit.set(p.roleId, b)
    }
    sums.captures += r.capturesMade
    sums.votes += r.votesCast
    sums.reveals += r.reveals
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const rate = (m: Map<string, { met: number; n: number }>) =>
    Object.fromEntries([...m].map(([k, v]) => [k, v.met / Math.max(1, v.n)]))

  return {
    games: count,
    wins,
    teamScore: { min: Math.min(...teamTotals), max: Math.max(...teamTotals), mean: mean(teamTotals) },
    personalScore: { mean: mean(personalTotals), dist },
    mainRate: rate(mainHit),
    bondRate: rate(bondHit),
    perGame: {
      captures: sums.captures / count,
      votes: sums.votes / count,
      reveals: sums.reveals / count,
    },
  }
}

export { DAY_START_HOUR, ROLE_BY_ID }
