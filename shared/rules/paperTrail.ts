// 종이 이력 — 운영자 화면의 「이력」 탭과 쪽지 탭의 「이력」 단추.
//
// 판에 나간 종이 한 장마다 누가 처음 주웠고(발견), 지금 누가 들고
// 있고, 누가 읽고 건네고 두고 찢고 풀었는지를 시간순으로 모은다.
// **운영자만 본다.** 서버가 기록(secret/records)에서 뽑아 이름까지
// 붙여 보낸다 — 이 파일은 그 셈만 한다. 문서도 시계도 모른다.
//
//   쪽지   운영자가 뿌린 56장(주인이 있다)
//   메모   운영자가 손으로 적어 놓은 종이(주인이 없다)
//   문제   문제 종이. 먼저 맞힌 한 사람이 가져간다
import type { GameRecord, RecordKind } from './records'

export type PaperKind = 'note' | 'memo' | 'quiz'
export type PaperState = 'floor' | 'held' | 'torn' | 'solved'

export const PAPER_KIND_LABEL: Record<PaperKind, string> = { note: '쪽지', memo: '메모', quiz: '문제' }
export const PAPER_STATE_LABEL: Record<PaperState, string> = {
  floor: '바닥',
  held: '손에',
  torn: '찢김',
  solved: '풀림',
}

/** 이력이 보는 기록 종류. 서버가 이것만 읽는다 */
export const TRAIL_KINDS = [
  'slipTake',
  'slipRead',
  'slipGive',
  'slipDrop',
  'slipTear',
  'quizTake',
  'quizWrong',
  'quizSolved',
] as const satisfies readonly RecordKind[]
export type TrailKind = (typeof TRAIL_KINDS)[number]

export const TRAIL_LABEL: Record<TrailKind, string> = {
  slipTake: '주웠다',
  slipRead: '읽었다',
  slipGive: '건넸다',
  slipDrop: '내려놓았다',
  slipTear: '찢었다',
  quizTake: '주웠다',
  quizWrong: '틀렸다',
  quizSolved: '맞혔다',
}

/** 이력 한 줄. 이름은 서버가 붙인다 */
export interface TrailRow {
  atMs: number
  kind: TrailKind
  who: string
  /** 건넨 상대 */
  to: string | null
  /** 어디서 */
  where: string | null
}

/** 종이 한 장. 목록 한 줄과 팝업이 같이 쓴다 */
export interface PaperRow {
  id: string
  kind: PaperKind
  /** 목록 한 줄의 이름. 쪽지면 「01 반장 · 1짝 역할」 */
  title: string
  /** 운영자용 전문. 쪽지는 {이름}이 실제 이름으로 바뀌어 있다 */
  text: string
  state: PaperState
  /** 처음 놓인 곳(방 이름). 모르면 null */
  placedAt: string | null
  placedAtMs: number | null
  /** 지금 바닥이면 그 방 */
  where: string | null
  /** 지금 든 사람 */
  holder: string | null
  /** 처음 주운 사람 — 「발견」 */
  foundBy: string | null
  /** 끝낸 사람 — 찢은 사람 · 맞힌 사람 */
  doneBy: string | null
  /** 읽은 사람들(쪽지 · 메모). 문제는 빈 목록 */
  readers: string[]
  trail: TrailRow[]
}

/** 기록에서 이 종이의 줄만 시간순으로. 같은 시각이면 들어온 순서 그대로 */
export function trailOf(
  id: string,
  records: readonly Pick<GameRecord, 'kind' | 'atMs' | 'actorId' | 'otherId' | 'tileId' | 'subjectId'>[],
  nameOf: (playerId: string | null | undefined) => string | null,
  roomName: (tileId: string | null | undefined) => string | null,
): TrailRow[] {
  const kinds = new Set<string>(TRAIL_KINDS)
  return records
    .filter((r) => r.subjectId === id && kinds.has(r.kind))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.atMs - b.r.atMs || a.i - b.i)
    .map(({ r }) => ({
      atMs: r.atMs,
      kind: r.kind as TrailKind,
      who: nameOf(r.actorId) ?? '누군가',
      to: r.kind === 'slipGive' ? nameOf(r.otherId) : null,
      where: roomName(r.tileId),
    }))
}

/** 처음 주운 사람. 줍기 줄이 없는 옛 판이면 null */
export const foundByOf = (trail: readonly TrailRow[]): string | null =>
  trail.find((t) => t.kind === 'slipTake' || t.kind === 'quizTake')?.who ?? null

/** 목록 정렬 — 아직 움직이는 것(손 · 바닥)이 위, 끝난 것이 아래. 그 안에서는 최근 것이 위 */
export function sortPapers(rows: readonly PaperRow[]): PaperRow[] {
  const rank: Record<PaperState, number> = { held: 0, floor: 1, solved: 2, torn: 2 }
  const last = (p: PaperRow) => p.trail[p.trail.length - 1]?.atMs ?? p.placedAtMs ?? 0
  return [...rows].sort((a, b) => rank[a.state] - rank[b.state] || last(b) - last(a))
}
