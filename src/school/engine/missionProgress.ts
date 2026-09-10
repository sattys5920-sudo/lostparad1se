import type {
  ActionLogEntry,
  MapFragment,
  MissionItem,
  MissionMetric,
  PresenceInterval,
  RevealLogEntry,
  RoleSpec,
  RumorEntry,
  SpatialEvent,
  TerritoryState,
  VoteEntry,
} from '../types'
import {
  aloneSeconds,
  metDistinct,
  pairAloneDistinct,
  pairAloneSeconds,
  roomSeconds,
  roomsVisited,
  togetherDistinct,
  togetherSeconds,
  visitedByOthers,
} from './presence'

export interface MissionContext {
  viewerId: string
  actionLog: ActionLogEntry[]
  revealLog: RevealLogEntry[]
  rumors: RumorEntry[]
  votes: VoteEntry[]
  dmPartnerCount: number
  territory: TerritoryState
  // ── 지도 위의 기록 ──
  intervals: PresenceInterval[]
  spatialEvents: SpatialEvent[]
  fragments: MapFragment[]
  /** 「지정된 한 사람」이 필요한 미션의 대상. */
  assignedTargetId: string | null
  /** 시간 계산의 기준점. 아직 방에 있는 구간은 여기까지로 친다. */
  now: number
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
    case 'leverageHeld':
      return ctx.territory.leverage.filter((l) => l.holderId === ctx.viewerId && l.spentAs === null).length
    case 'leverageUsed':
      return ctx.territory.leverage.filter((l) => l.holderId === ctx.viewerId && l.spentAs !== null).length
    case 'territoryAction':
      return ctx.territory.actionLog.filter((e) => e.playerId === ctx.viewerId && e.kind === metric.action).length

    // ── 지도 ──
    case 'aloneSeconds':
      return aloneSeconds(ctx.intervals, ctx.viewerId, ctx.now)
    case 'roomSeconds':
      return roomSeconds(ctx.intervals, ctx.viewerId, metric.rooms, ctx.now)
    case 'metDistinct':
      return metDistinct(ctx.intervals, ctx.viewerId)
    case 'roomsVisited':
      return roomsVisited(ctx.intervals, ctx.viewerId)
    case 'pairAloneDistinct':
      return pairAloneDistinct(ctx.intervals, ctx.viewerId, metric.minSeconds, ctx.now)
    case 'pairAloneWithTargetSeconds':
      return ctx.assignedTargetId
        ? pairAloneSeconds(ctx.intervals, ctx.viewerId, ctx.assignedTargetId, ctx.now)
        : 0
    case 'withTargetSeconds':
      return ctx.assignedTargetId ? togetherSeconds(ctx.intervals, ctx.viewerId, ctx.assignedTargetId, ctx.now) : 0
    case 'togetherDistinct':
      return togetherDistinct(ctx.intervals, ctx.viewerId, metric.minSeconds, ctx.now)
    case 'visitedByOthers':
      return visitedByOthers(ctx.intervals, ctx.viewerId, ctx.now)
    case 'spatial':
      return ctx.spatialEvents.filter(
        (e) =>
          e.actorId === ctx.viewerId &&
          (metric.action === undefined || e.kind === metric.action) &&
          (!metric.unseenOnly || e.witnessIds.length === 0),
      ).length
    case 'witnessedOthers':
      return ctx.spatialEvents.filter(
        (e) =>
          e.actorId !== ctx.viewerId &&
          e.witnessIds.includes(ctx.viewerId) &&
          (metric.action === undefined || e.kind === metric.action),
      ).length
    case 'witnessedMe': {
      const seen = new Set<string>()
      for (const e of ctx.spatialEvents) {
        if (e.actorId !== ctx.viewerId) continue
        if (metric.action !== undefined && e.kind !== metric.action) continue
        for (const w of e.witnessIds) seen.add(w)
      }
      return seen.size
    }
    case 'atFragmentSpawn': {
      // 조각이 놓인 순간 그 방에 구간이 열려 있었는가.
      let count = 0
      for (const f of ctx.fragments) {
        const wasThere = ctx.intervals.some(
          (iv) =>
            iv.playerId === ctx.viewerId &&
            iv.roomId === f.roomId &&
            iv.enteredAtMs <= f.createdAtMs &&
            (iv.leftAtMs ?? ctx.now) >= f.createdAtMs,
        )
        if (wasThere) count += 1
      }
      return count
    }
  }
}

export function evaluateMissionItem(item: MissionItem, ctx: MissionContext): MissionItemProgress {
  const current = countMetric(item.metric, ctx)
  const done = item.comparison === 'atMost' ? current <= item.threshold : current >= item.threshold
  return { item, current, done }
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
