import type {
  ActionLogEntry,
  MissionItem,
  MissionMetric,
  RevealLogEntry,
  RoleSpec,
  RumorEntry,
  VoteEntry,
} from '../types'

export interface MissionContext {
  viewerId: string
  actionLog: ActionLogEntry[]
  revealLog: RevealLogEntry[]
  rumors: RumorEntry[]
  votes: VoteEntry[]
  dmPartnerCount: number
}

export interface MissionItemProgress {
  item: MissionItem
  current: number
  done: boolean
}

function countMetric(metric: MissionMetric, ctx: MissionContext): number {
  switch (metric.kind) {
    case 'action': {
      const isMine =
        metric.direction === 'by'
          ? (e: ActionLogEntry) => e.actorId === ctx.viewerId
          : (e: ActionLogEntry) => e.targetId === ctx.viewerId
      const matches = ctx.actionLog.filter((e) => e.kind === metric.action && isMine(e))
      if (!metric.distinct) return matches.length
      const otherIdOf = metric.direction === 'by' ? (e: ActionLogEntry) => e.targetId : (e: ActionLogEntry) => e.actorId
      return new Set(matches.map(otherIdOf).filter((id): id is string => id !== null)).size
    }
    case 'vote': {
      const matches = ctx.votes.filter((v) => v.targetId === ctx.viewerId && v.category === metric.category)
      return new Set(matches.map((v) => v.voterId)).size
    }
    case 'reveal':
      return ctx.revealLog.filter(
        (e) => e.actorId === ctx.viewerId && (metric.revealKind === undefined || e.revealKind === metric.revealKind),
      ).length
    case 'dmPartners':
      return ctx.dmPartnerCount
    case 'rumor':
      return ctx.rumors.filter(
        (r) => r.tellerId === ctx.viewerId && (metric.origin ? r.parentRumorId === null : r.parentRumorId !== null),
      ).length
  }
}

export function evaluateMissionItem(item: MissionItem, ctx: MissionContext): MissionItemProgress {
  const current = countMetric(item.metric, ctx)
  return { item, current, done: current >= item.threshold }
}

export function evaluateMission(role: RoleSpec, ctx: MissionContext): MissionItemProgress[] {
  return role.mission.checklist.map((item) => evaluateMissionItem(item, ctx))
}

export function missionCompleteCount(progress: MissionItemProgress[]): number {
  return progress.filter((p) => p.done).length
}

export function missionTotalCount(role: RoleSpec): number {
  return role.mission.checklist.length
}

export function isMissionComplete(progress: MissionItemProgress[], role: RoleSpec): boolean {
  return missionCompleteCount(progress) >= missionTotalCount(role)
}
