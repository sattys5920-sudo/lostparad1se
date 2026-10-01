// 기록 보관함.
//
// 두 탭이 있다. 기록 · 내 추리.
import type { TeamId } from '../rules/v2'

export type ArchiveTab = 'record' | 'mine'

export const ARCHIVE_TABS: readonly { id: ArchiveTab; label: string }[] = [
  { id: 'record', label: '기록' },
  { id: 'mine', label: '내 추리' },
]

// ── 서버가 쥐고 있는 것 ─────────────────────────────────────────

/** 공개된 A의 기록 한 조각. 전원 공통이다. */
export interface RecordSource {
  day: number
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
  day?: number
}

export interface BuildInput {
  viewerId: string
  viewerTeam: TeamId
  records: readonly RecordSource[]
  /** 건너뛰어서 아직 안 읽은 날. */
  unreadDays?: readonly number[]
}

/** 보는 사람의 보관함을 만든다. */
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
