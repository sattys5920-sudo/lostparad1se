// 개인 미션 판정.
//
// 순수 함수다. 기록을 받아 조항마다 「얼마나 찼는가」를 낸다. 서버가
// 이걸 돌리고, 그 결과를 disclosure에 따라 걸러서 본인에게만 내려보낸다.
// 거르는 일은 discloseFor()가 한다 — 판정과 공개를 한 함수에 두면
// 언젠가 남의 진행도가 섞여 나간다.
//
// **숫자가 한 개도 없다.** 기준치는 전부 roles.ts에서 온다. 여기 있는
// 것은 종류마다 「무엇을 세는가」 하나씩뿐이다. 난이도를 고칠 때 이
// 파일을 열 일은 없어야 한다.
//
// 개인 판정은 팀 점수에 아무 영향도 주지 않는다. 이 파일은 팀 순위를
// 읽기만 하고(전학생 조항), 어디에도 쓰지 않는다.
import {
  ROLE_BY_ID,
  SLIP_MISSIONS,
  type Clause,
  type ClauseKind,
  type Disclosure,
  type MissionSpec,
  type MissionStatus,
  type SlipMissionId,
  type SlipMissionSpec,
} from './roles'
import type { Assignment } from './assign'
import { coStaySeconds, type Interval } from '../rules/presence'
import { stayInTeamRoomsAtTimeMs, type GameRecord, type OwnerChange, type Stay } from '../rules/records'
import { TEAM_IDS, type TeamId, type VoteKind } from '../rules/v2'

const MINUTE_SEC = 60
const MINUTE_MS = 60_000

// ── 기록 ────────────────────────────────────────────────────────

/** 신뢰·호감 표 한 장. 투명인간 투표는 이게 아니다. */
export interface JudgeVote {
  voterId: string
  targetId: string
  kind: VoteKind
  day: number
  atMs: number
}

/**
 * 투명인간 투표 한 장. **적은 그 순간의 두 팀을 같이 담는다.**
 *
 * 뒷자리의 「그중 1번은 우리 팀 사람」은 적은 시점으로 판정한다.
 * 나중에 이적으로 팀이 갈리면 그때 같은 팀이었다는 사실이 사라진다.
 */
export interface BallotVote {
  day: number
  voterId: string
  targetId: string
  voterTeam: TeamId
  targetTeam: TeamId
}

/**
 * 그날 투명인간 투표가 어떻게 끝났나.
 *
 * 뒷자리는 **동률로 무효가 된 날을 안 센다**. 그러려면 「아무도 안
 * 지워졌다」가 왜인지가 남아 있어야 한다.
 */
export interface BallotDay {
  day: number
  invisibleId: string | null
  /** picked · tooFew · tie · repeat */
  reason: string
}

/** 판정에 필요한 기록 전부. 서버만 이 모양을 쥔다. */
export interface GameLog {
  startedAtMs: number
  nowMs: number
  /** 종례가 끝났는가. 끝나야 endOnly 조항이 열린다. */
  over: boolean
  teamOf: (playerId: string) => TeamId
  /** 판에 있는 열넷. 「서로 다른 사람」을 셀 때 쓴다. */
  roster: readonly string[]
  intervals: readonly Interval[]
  votes: readonly JudgeVote[]
  ballots: readonly BallotVote[]
  ballotDays: readonly BallotDay[]
  /** 쌓인 기록 전부. 자판기·심부름·화분·쪽지·짝·시험지가 여기 있다. */
  records: readonly GameRecord[]
  /** 방 주인이 바뀐 이력. 「서 있던 그때 그 방 주인」이 이것으로 갈린다. */
  ownerChanges: readonly OwnerChange[]
  /**
   * 안 가른 팀 순위. **동점은 같은 수를 갖는다**(1·2·2·4).
   *
   * 「우리 팀이 1위가 아니다」가 이쪽을 본다. 공동 1위를 지식으로
   * 갈라서 2위로 만들어 놓으면, 실제로는 제일 잘한 팀이 「1위가
   * 아니다」를 채우게 된다.
   */
  teamTiedRank: Record<TeamId, number>
  /** 끝날 때 내 손에 남아 있는 쪽지. */
  slipsHeldAtEnd: Readonly<Record<string, readonly string[]>>
  /** DAY 3에 고른 중요한 사람. */
  chosenBy: Record<string, string | null>
  /** 마지막 선택이 맞아떨어졌는가. */
  choiceMet: Record<string, boolean>
}

// ── 조항 하나의 진행도 ──────────────────────────────────────────

export type Unit = 'count' | 'minutes' | 'flag'
export type Mode = 'atLeast' | 'atMost'

export interface ClauseProgress {
  kind: ClauseKind
  text: string
  disclosure: Disclosure
  unit: Unit
  mode: Mode
  /** 지금까지 센 값. */
  have: number
  /** 넘어야 할(또는 넘지 말아야 할) 값. */
  bar: number
  met: boolean
  /** 되돌릴 수 없이 깨졌는가. 상한 조항만 도중에 깨질 수 있다. */
  broken: boolean
}

// ── 세는 법 ─────────────────────────────────────────────────────

export interface Ctx {
  me: Assignment
  log: GameLog
}

const meOf = (c: Ctx) => c.me.playerId
const myTeam = (c: Ctx) => c.me.team

/** 내가 한 일 중 그 종류만. */
const mine = (c: Ctx, kind: GameRecord['kind']) =>
  c.log.records.filter((r) => r.kind === kind && r.actorId === meOf(c))

/** 서로 다른 subjectId의 수. 같은 쪽지를 두 번 읽어도 한 장이다. */
const distinctSubjects = (rows: readonly GameRecord[]): number =>
  new Set(rows.map((r) => r.subjectId).filter((id): id is string => !!id)).size

/** 걷는 중이 아니고 판정에 세는 구간만. 같은 방 판정이 이것을 쓴다. */
function staysOf(log: GameLog): Stay[] {
  return log.intervals
    .filter((iv) => iv.tileId !== null && (iv.state === 'standing' || iv.state === 'asleep'))
    .map((iv) => ({ playerId: iv.playerId, tileId: iv.tileId, startMs: iv.startMs, endMs: iv.endMs }))
}

/** 내 투명인간 표가 적중한 날. 동률로 무효가 된 날은 애초에 안 들어온다. */
function ballotHits(c: Ctx): BallotVote[] {
  const settled = new Map(c.log.ballotDays.filter((d) => d.invisibleId !== null).map((d) => [d.day, d.invisibleId]))
  return c.log.ballots.filter((b) => b.voterId === meOf(c) && settled.get(b.day) === b.targetId)
}

interface Measured {
  unit: Unit
  have: number
}

/**
 * 조항 종류마다 세는 법 하나.
 *
 * clause에서 읽는 것은 need·limit·minutes뿐이다. 그 밖의 숫자는
 * 여기 없다.
 */
function measure(clause: Clause, c: Ctx): Measured {
  const log = c.log
  const me = meOf(c)

  switch (clause.kind) {
    // ── 사람 ──
    case 'sameRoomPeople': {
      const least = (clause.minutes ?? 1) * MINUTE_SEC
      const others = log.roster.filter((id) => id !== me)
      const met = others.filter((id) => coStaySeconds(log.intervals, me, id, log.startedAtMs, log.nowMs) >= least)
      return { unit: 'count', have: met.length }
    }
    case 'trustReceived':
      return { unit: 'count', have: log.votes.filter((v) => v.targetId === me && v.kind === 'trust').length }
    case 'trustTeams': {
      const teams = new Set(
        log.votes.filter((v) => v.targetId === me && v.kind === 'trust').map((v) => log.teamOf(v.voterId)),
      )
      return { unit: 'count', have: teams.size }
    }
    case 'vendBuys':
      // 매입(파는 것)은 vendSell로 따로 남는다. 여기 안 들어온다
      return { unit: 'count', have: mine(c, 'vendBuy').length }
    case 'dealsWithOtherTeam': {
      const deals = log.records.filter(
        (r) =>
          r.kind === 'trade' &&
          ((r.actorId === me && r.otherTeam && r.otherTeam !== myTeam(c)) ||
            (r.otherId === me && r.actorTeam !== myTeam(c))),
      )
      return { unit: 'count', have: deals.length }
    }

    // ── 쪽지 ──
    case 'slipsRead':
      return { unit: 'count', have: distinctSubjects(mine(c, 'slipRead')) }
    case 'slipsGiven':
      return { unit: 'count', have: distinctSubjects(mine(c, 'slipGive')) }
    case 'slipsTorn':
      return { unit: 'count', have: distinctSubjects(mine(c, 'slipTear')) }

    // ── 손 ──
    case 'errandsDone':
      // 포기·시간초과는 errandQuit으로 남는다. 남이 먼저 끝낸 것은
      // 애초에 완료 기록이 안 생긴다
      return { unit: 'count', have: mine(c, 'errandDone').length }
    case 'harvests':
      // 시든 것은 수확 기록을 남기지 않는다
      return { unit: 'count', have: mine(c, 'potHarvest').length }
    case 'robotsMade':
      return { unit: 'count', have: mine(c, 'robotBorn').length }
    case 'robotsSmashedOfOthers': {
      // 이적으로 저절로 사라진 짝은 robotGone으로 따로 남는다
      const rows = mine(c, 'robotSmashed').filter((r) => r.otherTeam && r.otherTeam !== myTeam(c))
      return { unit: 'count', have: rows.length }
    }
    case 'quizzesSolved':
      return { unit: 'count', have: distinctSubjects(mine(c, 'quizSolved')) }

    // ── 어긋남 ★ ──
    case 'targetSlipRead': {
      const target = c.me.targetId
      if (!target) return { unit: 'count', have: 0 }
      return { unit: 'count', have: distinctSubjects(mine(c, 'slipRead').filter((r) => r.ownerId === target)) }
    }
    case 'coStayWithTarget': {
      const target = c.me.targetId
      if (!target) return { unit: 'minutes', have: 0 }
      const sec = coStaySeconds(log.intervals, me, target, log.startedAtMs, log.nowMs)
      return { unit: 'minutes', have: Math.floor(sec / MINUTE_SEC) }
    }
    case 'teamNotFirstAtEnd':
      return { unit: 'flag', have: log.teamTiedRank[myTeam(c)] !== 1 ? 1 : 0 }
    case 'otherTeamRoomsStood': {
      const least = (clause.minutes ?? 1) * MINUTE_MS
      const stays = staysOf(log)
      const teams = TEAM_IDS.filter((t) => t !== myTeam(c)).filter(
        // 서 있던 그 시점에 그 팀 방이었어야 한다
        (t) => stayInTeamRoomsAtTimeMs(stays, me, t, log.ownerChanges, log.nowMs) >= least,
      )
      return { unit: 'count', have: teams.length }
    }
    case 'invisibleHits':
      return { unit: 'count', have: new Set(ballotHits(c).map((b) => b.day)).size }
    case 'invisibleHitsSameTeam': {
      // 적은 그 순간 같은 팀이었으면 된다
      const days = new Set(ballotHits(c).filter((b) => b.voterTeam === b.targetTeam).map((b) => b.day))
      return { unit: 'count', have: days.size }
    }
  }
}

/**
 * need·limit·minutes 중 이 조항이 쓰는 기준치.
 *
 * **need 가 minutes 보다 먼저다.** 반장은 need 9 · minutes 1 인데,
 * minutes 를 먼저 집으면 기준이 「아홉 명」이 아니라 「1」이 되어
 * 한 명만 만나도 찬다. 시간은 세는 방법 쪽이고, 넘어야 할 수는
 * need 다 — minutes 만 있는 조항(짝사랑의 30분)에서만 기준이 된다.
 */
const barOf = (clause: Pick<Clause, 'need' | 'limit' | 'minutes'>): number =>
  clause.limit ?? clause.need ?? clause.minutes ?? 1

/** 조항 하나를 판정한다. */
export function judgeClause(clause: Clause, c: Ctx): ClauseProgress {
  const measured = measure(clause, c)
  const mode: Mode = clause.limit !== undefined ? 'atMost' : 'atLeast'
  const bar = barOf(clause)
  const met = mode === 'atMost' ? measured.have <= bar : measured.have >= bar
  return {
    kind: clause.kind,
    text: clause.text,
    disclosure: clause.disclosure,
    unit: measured.unit,
    mode,
    have: measured.have,
    bar,
    met,
    // 올라가기만 하는 수는 끝나기 전에 깨질 수 없다. 상한만 깨진다
    broken: mode === 'atMost' && !met,
  }
}

export interface MissionProgress {
  text: string
  clauses: ClauseProgress[]
  met: boolean
  broken: boolean
}

function judgeMission(spec: MissionSpec, c: Ctx): MissionProgress {
  const clauses = spec.clauses.map((cl) => judgeClause(cl, c))
  return {
    text: spec.text,
    clauses,
    met: clauses.every((p) => p.met),
    broken: clauses.some((p) => p.broken),
  }
}

// ── 쪽지 미션 ───────────────────────────────────────────────────

export interface SlipMissionProgress {
  id: SlipMissionId
  text: string
  disclosure: Disclosure
  unit: Unit
  mode: Mode
  have: number
  bar: number
  met: boolean
  broken: boolean
}

function measureSlip(spec: SlipMissionSpec, c: Ctx): number {
  const me = meOf(c)
  switch (spec.id) {
    case 'keepOthers': {
      // 남의 쪽지를 읽었고, 그 쪽지가 끝에도 내 손에 있다
      const held = new Set(c.log.slipsHeldAtEnd[me] ?? [])
      const read = mine(c, 'slipRead').filter((r) => r.ownerId && r.ownerId !== me && r.subjectId)
      return new Set(read.map((r) => r.subjectId as string).filter((id) => held.has(id))).size
    }
    case 'fewReadMine': {
      // 나에 대한 쪽지를 읽은 사람. 나 자신은 빼고 센다
      const readers = c.log.records
        .filter((r) => r.kind === 'slipRead' && r.ownerId === me && r.actorId !== me)
        .map((r) => r.actorId)
      return new Set(readers).size
    }
    case 'twiceSamePerson': {
      // 한 사람의 쪽지를 몇 번 손에 넣었나. 그중 제일 많은 수
      const byOwner = new Map<string, number>()
      for (const r of mine(c, 'slipTake')) {
        if (!r.ownerId) continue
        byOwner.set(r.ownerId, (byOwner.get(r.ownerId) ?? 0) + 1)
      }
      return byOwner.size === 0 ? 0 : Math.max(...byOwner.values())
    }
  }
}

function judgeSlipMissions(c: Ctx): SlipMissionProgress[] {
  return SLIP_MISSIONS.map((spec) => {
    const have = measureSlip(spec, c)
    const mode: Mode = spec.limit !== undefined ? 'atMost' : 'atLeast'
    const bar = barOf(spec)
    const met = mode === 'atMost' ? have <= bar : have >= bar
    return {
      id: spec.id,
      text: spec.text,
      disclosure: spec.disclosure,
      unit: 'count' as Unit,
      mode,
      have,
      bar,
      met,
      broken: mode === 'atMost' && !met,
    }
  })
}

// ── 한 사람의 판정 ──────────────────────────────────────────────

export interface PersonalResult {
  playerId: string
  roleId: Assignment['roleId']
  main: MissionProgress
  slips: SlipMissionProgress[]
  /** 마지막 선택이 맞아떨어졌는가. */
  choiceMet: boolean
}

/**
 * 한 사람의 미션 판정. 남의 결과는 들어 있지 않다.
 *
 * **점수는 매기지 않는다.** 미션마다 달성이냐 아니냐만 남긴다.
 */
export function judge(me: Assignment, log: GameLog): PersonalResult {
  const c: Ctx = { me, log }
  const role = ROLE_BY_ID[me.roleId]
  return {
    playerId: me.playerId,
    roleId: me.roleId,
    main: judgeMission(role.main, c),
    slips: judgeSlipMissions(c),
    choiceMet: log.choiceMet[me.playerId] === true,
  }
}

// ── 어디까지 보여 줄까 ──────────────────────────────────────────

/**
 * 지금이 언제인가.
 *
 *   live         판이 도는 중
 *   dayTurned    하루가 막 바뀌었다 — 받은 표 조항이 갱신된다
 *   ballotShown  투명인간 발표 직후 — 뒷자리 조항이 갱신된다
 *   end          종례가 끝났다. 전부 열린다
 */
export type Phase = 'live' | 'dayTurned' | 'ballotShown' | 'end'

function visibleAt(d: Disclosure, phase: Phase): boolean {
  if (phase === 'end') return true
  if (d === 'realtime') return true
  if (d === 'daily') return phase === 'dayTurned'
  if (d === 'afterBallot') return phase === 'ballotShown'
  return false
}

/** 진행도 한 줄을 화면에 어떻게 내보낼까. */
export interface ClauseView {
  text: string
  /** 숫자를 보여 주는가. */
  shown: boolean
  unit: Unit
  mode: Mode
  have: number | null
  bar: number
  status: MissionStatus
}

/**
 * 한 줄의 상태.
 *
 * **실패는 뒤집힐 수 없을 때만 붙인다.** 아직 채울 수 있는 것은
 * 끝나기 전까지 「진행 중」이다.
 */
function statusOf(met: boolean, broken: boolean, shown: boolean, over: boolean): MissionStatus {
  if (broken) return 'failed'
  if (!shown) return 'endOnly'
  if (met) return 'met'
  return over ? 'failed' : 'running'
}

/**
 * 본인에게 내려보낼 모양으로 깎는다.
 *
 * 숫자를 감추는 게 아니라 **빼고 만든다**. have가 null이면 그 값은 문서에
 * 아예 들어가지 않는다 — 받은 뒤 가리는 방식이면 개발자도구로 다 보인다.
 */
export function discloseClause(p: ClauseProgress, phase: Phase): ClauseView {
  const shown = visibleAt(p.disclosure, phase)
  return {
    text: p.text,
    shown,
    unit: p.unit,
    mode: p.mode,
    have: shown ? p.have : null,
    bar: p.bar,
    status: statusOf(p.met, p.broken, shown, phase === 'end'),
  }
}

export interface MissionView {
  text: string
  clauses: ClauseView[]
  status: MissionStatus
}

function discloseMission(m: MissionProgress, phase: Phase): MissionView {
  const clauses = m.clauses.map((p) => discloseClause(p, phase))
  const allShown = clauses.every((v) => v.shown)
  return { text: m.text, clauses, status: statusOf(m.met, m.broken, allShown, phase === 'end') }
}

export interface SlipMissionView {
  id: SlipMissionId
  text: string
  shown: boolean
  have: number | null
  bar: number
  mode: Mode
  status: MissionStatus
}

export interface PersonalView {
  playerId: string
  roleId: Assignment['roleId']
  main: MissionView
  slips: SlipMissionView[]
  /** 마지막 선택은 끝나야 판정한다. */
  choice: MissionStatus
}

/** 본인에게 내려보낼 전부. 남의 역할도 남의 진행도도 들어 있지 않다. */
export function discloseFor(result: PersonalResult, phase: Phase): PersonalView {
  return {
    playerId: result.playerId,
    roleId: result.roleId,
    main: discloseMission(result.main, phase),
    slips: result.slips.map((s) => {
      const shown = visibleAt(s.disclosure, phase)
      return {
        id: s.id,
        text: s.text,
        shown,
        have: shown ? s.have : null,
        bar: s.bar,
        mode: s.mode,
        status: statusOf(s.met, s.broken, shown, phase === 'end'),
      }
    }),
    choice: phase === 'end' ? (result.choiceMet ? 'met' : 'failed') : 'endOnly',
  }
}
