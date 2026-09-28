// 자정 판정 — 날이 바뀔 때 열넷의 미션을 굳혀 둔다.
//
// **순수 함수다.** judge.ts 가 「지금 얼마나 찼나」를 내면, 여기서 그것을
// 네 가지 판정으로 바꾼다. 서버(functions/src/missionDays.ts)가 날이 바뀌는
// 순간 부르고, 결과를 날짜별 스냅샷으로 남긴다.
//
//   달성          이미 다 채웠다. 남은 날에 뒤집힐 수 없다
//   실패 확정     뒤집힐 수 없게 못 채웠다
//   진행 중       아직 가능하다. 지금 수치를 같이 적는다
//   끝날 때 판정  마지막 날에만 정해진다(전학생의 순위 · 마지막 선택 · 끝까지 쥐고 있기)
//
// **실패 확정은 정말 뒤집힐 수 없을 때만** 붙인다. 애매하면 진행 중이다.
// 지금은 한 가지뿐이다 — 투명인간 투표가 남은 날보다 모자란 뒷자리.
// 쪽지는 빈 종이를 사서 적으면 새로 생기므로 미화부도 끝나기 전에는 안 떨어진다.
//
// 스냅샷에는 두 벌이 있다.
//   truth  운영자가 보는 것. 숨긴 조항까지 다 센 값
//   view   본인에게 보낼 것. 공개 시점이 안 된 조항은 값도 상태도 빼고 만든다
//          — 「나에 대한 쪽지를 읽은 사람」이 도중에 실패로 뜨면 세 사람이
//          읽었다는 것이 샌다
import type { ClauseKind, Disclosure } from './roleTypes'
import type { MissionStatus } from './roleNames'
import type { ClauseProgress, Mode, PersonalResult, SlipMissionProgress, Unit } from './judge'
import type { SlipMissionId } from './roles'

export type DayStatus = MissionStatus

export interface DayContext {
  /** 이 날이 마지막 날인가. 마지막 날 판정이 최종이다 */
  final: boolean
  /**
   * 이 날 뒤로 남은 투명인간 투표 날 수. 뒷자리의 「실패 확정」이 본다.
   * 마지막 날에는 투표가 없다
   */
  ballotDaysLeft: number
}

/** 조항 한 줄의 판정 */
export interface DayClause {
  kind: ClauseKind | SlipMissionId
  text: string
  unit: Unit
  mode: Mode
  have: number
  bar: number
  status: DayStatus
  disclosure: Disclosure
}

/** 본인에게 갈 한 줄. 공개 시점이 안 됐으면 have 가 null 이고 상태는 「끝날 때 판정」 */
export interface DayClauseView {
  text: string
  unit: Unit
  mode: Mode
  have: number | null
  bar: number
  status: DayStatus
}

export interface DayVerdict {
  status: DayStatus
  clauses: DayClause[]
  slips: DayClause[]
  /** 마지막 선택. 마지막 날에만 정해진다 */
  choice: DayStatus
}

export interface DayVerdictView {
  status: DayStatus
  clauses: DayClauseView[]
  slips: DayClauseView[]
  choice: DayStatus
}

/** 끝에 가서야 정해지는 조항 — 남의 순위나 끝까지 쥐고 있는지에 걸린 것 */
const AT_END: ReadonlySet<string> = new Set<string>(['teamNotFirstAtEnd', 'keepOthers'])

/** 투표가 남은 날보다 모자라면 뒤집힐 수 없다 */
const BALLOT_KINDS: ReadonlySet<string> = new Set<string>(['invisibleHits', 'invisibleHitsSameTeam'])

function clauseStatus(
  kind: string,
  p: { have: number; bar: number; mode: Mode; met: boolean; broken: boolean },
  ctx: DayContext,
): DayStatus {
  if (ctx.final) return p.met ? 'met' : 'failed'
  if (AT_END.has(kind)) return 'endOnly'
  if (p.mode === 'atMost') {
    // 넘었으면 다시는 안 줄어든다. 안 넘었어도 아직은 모른다
    return p.broken ? 'failed' : 'running'
  }
  // 세는 수는 올라가기만 한다 — 채웠으면 달성이 굳는다
  if (p.met) return 'met'
  if (BALLOT_KINDS.has(kind) && p.have + ctx.ballotDaysLeft < p.bar) return 'failed'
  return 'running'
}

/** 줄 여럿을 하나로. 하나라도 실패면 실패, 다 달성이면 달성, 끝날 때가 섞였으면 끝날 때 */
export function combine(statuses: readonly DayStatus[]): DayStatus {
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.length > 0 && statuses.every((s) => s === 'met')) return 'met'
  if (statuses.some((s) => s === 'endOnly')) return 'endOnly'
  return 'running'
}

const mainRow = (p: ClauseProgress, ctx: DayContext): DayClause => ({
  kind: p.kind,
  text: p.text,
  unit: p.unit,
  mode: p.mode,
  have: p.have,
  bar: p.bar,
  status: clauseStatus(p.kind, p, ctx),
  disclosure: p.disclosure,
})

const slipRow = (s: SlipMissionProgress, ctx: DayContext): DayClause => ({
  kind: s.id,
  text: s.text,
  unit: s.unit,
  mode: s.mode,
  have: s.have,
  bar: s.bar,
  status: clauseStatus(s.id, s, ctx),
  disclosure: s.disclosure,
})

/** 운영자가 보는 판정 — 숨긴 조항까지 다 센다 */
export function dayVerdict(result: PersonalResult, ctx: DayContext): DayVerdict {
  const clauses = result.main.clauses.map((p) => mainRow(p, ctx))
  const slips = result.slips.map((s) => slipRow(s, ctx))
  return {
    status: combine(clauses.map((c) => c.status)),
    clauses,
    slips,
    choice: ctx.final ? (result.choiceMet ? 'met' : 'failed') : 'endOnly',
  }
}

/**
 * 자정에 공개되는가. 자정은 하루가 바뀐 뒤이자 그날 투명인간 발표(21:00) 뒤다 —
 * 「바로」 · 「하루가 바뀔 때」 · 「발표 뒤」는 열리고 「끝날 때」만 닫혀 있다.
 */
export const openAtMidnight = (d: Disclosure, final: boolean): boolean => final || d !== 'endOnly'

function viewRow(c: DayClause, final: boolean): DayClauseView {
  const open = openAtMidnight(c.disclosure, final)
  return {
    text: c.text,
    unit: c.unit,
    mode: c.mode,
    // 닫힌 것은 **값을 빼고** 만든다. 받아서 가리면 개발자도구로 다 보인다
    have: open ? c.have : null,
    bar: c.bar,
    status: open ? c.status : 'endOnly',
  }
}

/** 본인에게 보낼 판정 — 공개 시점이 안 된 것은 값도 상태도 없다 */
export function dayView(v: DayVerdict, final: boolean): DayVerdictView {
  const clauses = v.clauses.map((c) => viewRow(c, final))
  return {
    status: combine(clauses.map((c) => c.status)),
    clauses,
    slips: v.slips.map((c) => viewRow(c, final)),
    choice: v.choice,
  }
}

/** 전날 대비 변화. 운영자 화면이 「+1」로 찍는다. 전날이 없으면 null */
export function deltaOf(today: readonly DayClause[], yesterday: readonly DayClause[] | null): (number | null)[] {
  return today.map((c, i) => {
    const y = yesterday?.[i]
    if (!y || y.kind !== c.kind) return null
    return c.have - y.have
  })
}
