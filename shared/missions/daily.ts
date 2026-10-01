// 자정 판정 — 날이 바뀔 때 열넷의 그날 미션을 판정해 굳혀 둔다.
//
// **미션은 하루짜리다.** 매일 0부터 그날 한 것만 세고, 자정이 기한이다.
// 그래서 자정 판정은 그날로서는 최종이다 — 달성 아니면 실패, 둘뿐이다.
// 서버(functions/src/missionDays.ts)가 날이 바뀌는 순간 부르고, 결과를
// 날짜별 스냅샷으로 남긴다. 운영자가 날마다 발표한다.
//
//   달성          그날 다 채웠다
//   실패          그날 못 채웠다
//   끝날 때 판정  지금은 쓰는 조항이 없다 — 남아 있으면 마지막 날에 연다
//   (진행 중은 하루 중간에 「나」 탭이 보여 주는 상태다 — 자정 판정에는 없다)
//
// 투명인간 투표가 없는 날(마지막 날)은 뒷자리의 투표 조항을 달성으로 친다 —
// 할 수 없는 일로 실패를 매기지 않는다.
//
// 스냅샷에는 두 벌이 있다.
//   truth  운영자가 보는 것. 숨긴 조항까지 다 센 값
//   view   본인에게 보낼 것. 공개 시점이 안 된 조항은 값도 상태도 빼고 만든다
//          — 「나에 대한 쪽지를 읽은 사람」이 도중에 실패로 뜨면 세 사람이
//          읽었다는 것이 샌다
import type { ClauseKind, Disclosure } from './roleTypes'
import type { MissionStatus } from './roleNames'
import type { ClauseProgress, Mode, PersonalResult, Unit } from './judge'

export type DayStatus = MissionStatus

export interface DayContext {
  /** 마지막 날인가. 「끝날 때」 조항이 이날 열린다 */
  final: boolean
  /** 이날 투명인간 투표가 없었다(마지막 날). 뒷자리의 투표 조항을 달성으로 친다 */
  noBallot: boolean
}

/** 조항 한 줄의 판정 */
export interface DayClause {
  kind: ClauseKind
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
}

export interface DayVerdictView {
  status: DayStatus
  clauses: DayClauseView[]
}

/** 투명인간 투표에 걸린 조항 */
const BALLOT_KINDS: ReadonlySet<string> = new Set<string>(['invisibleHits', 'invisibleHitsSameTeam'])

/** 하루가 닫혔다 — 채웠으면 달성, 아니면 실패 */
function clauseStatus(kind: string, p: { met: boolean }, ctx: DayContext): DayStatus {
  if (ctx.noBallot && BALLOT_KINDS.has(kind)) return 'met'
  return p.met ? 'met' : 'failed'
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

/** 운영자가 보는 판정 — 숨긴 조항까지 다 센다 */
export function dayVerdict(result: PersonalResult, ctx: DayContext): DayVerdict {
  const clauses = result.main.clauses.map((p) => mainRow(p, ctx))
  return {
    status: combine(clauses.map((c) => c.status)),
    clauses,
  }
}

/**
 * 자정에 공개되는가. **하루짜리 미션은 자정에 다 열린다** — 그날은 끝났고,
 * 결과를 알려 주는 것이 발표다. 「끝날 때」는 이제 쓰는 조항이 없지만,
 * 남아 있으면 마지막 날에만 연다
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
