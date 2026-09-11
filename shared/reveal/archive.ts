// 기록 보관함.
//
// 네 탭이 있다. 기록 · 고백 · 기억 · 내 추리.
//
// 보관함은 **보는 사람마다 따로 만든다.** 전체 목록을 만들어 두고
// 「너는 이건 못 봐」 표시를 붙이는 방식은 쓰지 않는다 — 그러면 목록에
// 남의 1:1 고백이 제목만이라도 실려 나간다. 여기서는 애초에 담지 않는다.
import type { TileId } from '../rules/board'
import type { RevealScope, TeamId } from '../rules/v2'

export type ArchiveTab = 'record' | 'confession' | 'memory' | 'mine'

export const ARCHIVE_TABS: readonly { id: ArchiveTab; label: string }[] = [
  { id: 'record', label: '기록' },
  { id: 'confession', label: '고백' },
  { id: 'memory', label: '기억' },
  { id: 'mine', label: '내 추리' },
]

// ── 서버가 쥐고 있는 것 ─────────────────────────────────────────

/** 공개된 A의 기록 한 조각. 전원 공통이다. */
export interface RecordSource {
  day: number
  atMs: number
}

/** 털어놓기 한 번. */
export interface ConfessionSource {
  id: string
  speakerId: string
  scope: RevealScope
  /** 그 자리에서 들은 사람. 전체 털어놓기면 자기를 뺀 열세 명. */
  listenerIds: readonly string[]
  /** 숨긴 사실 원문. 공인된 고백이라 그대로 남는다. */
  text: string
  atMs: number
}

/** 칸에 묻힌 A의 기억. 먼저 가져간 팀만 안다. */
export interface MemorySource {
  tileId: TileId
  /** 이 기억을 연 팀. */
  team: TeamId
  atMs: number
}

/** A의 시선. 그 자리에 서 본 사람에게만 열린다. */
export interface SightSource {
  ownerId: string
  atMs: number
}

// ── 보는 사람에게 담기는 것 ─────────────────────────────────────

export interface ArchiveItem {
  /** 메모를 붙일 때 쓰는 열쇠. 보관함 안에서 유일하다. */
  id: string
  tab: ArchiveTab
  atMs: number
  /** 목록에 뜨는 한 줄. 본문은 열어야 나온다. */
  title: string
  /** 아직 안 읽은 조각. 건너뛴 아침이 여기 남는다. */
  unread?: boolean
  /** 고백이면 누가 했는지. 기억이면 어느 칸인지. */
  subjectId?: string
  tileId?: TileId
  day?: number
  /** 1:1로 들은 고백인가. 전체 고백과 눈에 띄게 달라야 한다. */
  private?: boolean
}

export interface BuildInput {
  viewerId: string
  viewerTeam: TeamId
  records: readonly RecordSource[]
  /** 건너뛰어서 아직 안 읽은 날. */
  unreadDays?: readonly number[]
  confessions: readonly ConfessionSource[]
  memories: readonly MemorySource[]
  sights: readonly SightSource[]
  /** 끝났으면 기억 열세 장면이 전원에게 열린다. */
  over?: boolean
  /** 칸 이름을 붙이는 데 쓴다. */
  tileName: (id: TileId) => string
  /** 사람 이름. 고백 제목에 쓴다. */
  nameOf: (id: string) => string
}

/** 이 사람이 그 고백을 볼 수 있는가. */
export function canSeeConfession(c: ConfessionSource, viewerId: string): boolean {
  // 전체 털어놓기는 반 전체의 기록이다
  if (c.scope === 'class') return true
  // 1:1은 말한 사람과 들은 사람만
  return c.speakerId === viewerId || c.listenerIds.includes(viewerId)
}

/** 이 사람이 그 기억을 볼 수 있는가. */
export function canSeeMemory(m: MemorySource, viewerTeam: TeamId, over: boolean): boolean {
  return over || m.team === viewerTeam
}

/**
 * 보는 사람의 보관함을 만든다.
 *
 * 담기지 않은 것은 목록에도 없다. 제목만 남기지도 않는다 —
 * 「○○의 고백(비공개)」이라는 줄 하나로도 누가 누구에게 털어놓았는지가
 * 샌다.
 */
export function buildArchive(input: BuildInput): ArchiveItem[] {
  const out: ArchiveItem[] = []
  const unread = new Set(input.unreadDays ?? [])

  for (const r of input.records) {
    out.push({
      id: `record:${r.day}`,
      tab: 'record',
      atMs: r.atMs,
      title: `DAY ${r.day}`,
      day: r.day,
      unread: unread.has(r.day),
    })
  }

  for (const c of input.confessions) {
    if (!canSeeConfession(c, input.viewerId)) continue
    const mine = c.speakerId === input.viewerId
    out.push({
      id: `confession:${c.id}`,
      tab: 'confession',
      atMs: c.atMs,
      title: `${mine ? '나' : input.nameOf(c.speakerId)} · 공인된 고백`,
      subjectId: c.speakerId,
      private: c.scope === 'private',
    })
  }

  for (const m of input.memories) {
    if (!canSeeMemory(m, input.viewerTeam, input.over === true)) continue
    out.push({
      id: `memory:${m.tileId}`,
      tab: 'memory',
      atMs: m.atMs,
      title: `A의 기억 · ${input.tileName(m.tileId)}`,
      tileId: m.tileId,
    })
  }

  for (const s of input.sights) {
    // A의 시선은 본인 것만 있다. 남의 것은 서버가 애초에 넘기지 않는다
    if (s.ownerId !== input.viewerId) continue
    out.push({ id: 'sight:mine', tab: 'memory', atMs: s.atMs, title: 'A의 시선' })
  }

  return out.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
}

/** 탭 하나의 목록. */
export function itemsOf(items: readonly ArchiveItem[], tab: ArchiveTab): ArchiveItem[] {
  return items.filter((i) => i.tab === tab)
}

/** 안 읽은 조각 수. 탭에 점을 찍는 데 쓴다. */
export function unreadCount(items: readonly ArchiveItem[]): number {
  return items.filter((i) => i.unread).length
}
