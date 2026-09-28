// 배너에 무엇을 띄울지 — 순수 함수. 시험은 banner.test.ts.
import { BANNER_MAX, type NoteItem } from '../../../../shared/notify/notifyData'

/** 페이즈 알림은 크게, 가운데에 */
export const isBig = (n: NoteItem): boolean => n.type === 'phaseStart' || n.type === 'phaseEnd'

/**
 * 새로 온 줄 — 지난번에 본 것보다 새것. 보관함은 최근 것부터다.
 * 묶인 줄(알림 n건)은 같은 id 로 숫자만 늘므로 시각으로 가른다.
 */
export function freshNotes(notes: readonly NoteItem[], sinceMs: number): NoteItem[] {
  return notes.filter((n) => n.atMs > sinceMs).sort((a, b) => a.atMs - b.atMs)
}

/** 떠 있는 배너에 새 것을 얹는다. 같은 id 는 바꿔 끼우고, 많으면 오래된 것부터 내린다 */
export function stack(shown: readonly NoteItem[], incoming: readonly NoteItem[], max = BANNER_MAX): NoteItem[] {
  let out = [...shown]
  for (const n of incoming) {
    out = out.filter((x) => x.id !== n.id)
    out.push(n)
  }
  return out.slice(-max)
}

/** 안 읽은 수 — 보관함 점과 앱 배지 */
export const unreadOf = (notes: readonly NoteItem[] | undefined, readAtMs: number | undefined): number =>
  (notes ?? []).filter((n) => n.atMs > (readAtMs ?? 0)).length
