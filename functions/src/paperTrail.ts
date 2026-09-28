// 종이 이력 — 운영자만. 판에 나간 쪽지 · 메모 · 문제 종이 한 장마다
// 누가 발견했고(처음 주움) 지금 누가 들고 있고 누가 처리했는지를
// 기록에서 뽑아 이름까지 붙여 보낸다. 셈은 shared/rules/paperTrail.
//
// **참가자 쪽 어떤 응답에도 안 실린다.** 이 기록을 다 보면 누가 무엇을
// 모으는지 — 곧 누구의 미션이 무엇인지 — 가 역산된다.
import { onCall } from 'firebase-functions/v2/https'

import { TILE_BY_ID, roomOfCell, type TileId } from '../../shared/rules/board'
import { ROLE_NAMES } from '../../shared/missions/roleNames'
import { fillSubject } from '../../shared/reveal/slips'
import {
  TRAIL_KINDS,
  foundByOf,
  sortPapers,
  trailOf,
  type PaperRow,
} from '../../shared/rules/paperTrail'
import type { GameRecord } from '../../shared/rules/records'
import type { GameDoc } from '../../shared/model'
import { SLIP_NOTE_BY_ID } from './story/slipNotes'
import type { SlipDoc } from './slips'
import type { QuizDoc, QuizPaperDoc } from './quiz'
import { roomOfSlip } from './notes'
import { gameRef } from './index'
import { requireHost } from './host'

const KIND_WORD = { role: '역할', name: '이름' } as const

export const hostPapers = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ref = gameRef(gameId)
  const [gameSnap, slips, floor, bank, recs] = await Promise.all([
    ref.get(),
    ref.collection('secret').doc('slips').collection('items').get(),
    ref.collection('secret').doc('quiz').collection('floor').get(),
    ref.collection('secret').doc('quiz').collection('bank').get(),
    ref.collection('secret').doc('records').collection('items').where('kind', 'in', [...TRAIL_KINDS]).get(),
  ])
  const game = gameSnap.data() as GameDoc | undefined
  const names = new Map((game?.seats ?? []).map((s) => [s.playerId, s.name]))
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null)
  const roomName = (t: string | null | undefined) => (t ? (TILE_BY_ID[t as TileId]?.name ?? null) : null)
  const records = recs.docs.map((d) => d.data() as GameRecord)

  const rows: PaperRow[] = []
  for (const d of slips.docs) {
    const s = d.data() as SlipDoc
    const note = s.noteId ? SLIP_NOTE_BY_ID[s.noteId] : undefined
    // 사람이 빈 종이에 적은 것은 운영자가 뿌린 것이 아니다 — 여기 안 싣는다
    if (!note && s.subjectId) continue
    const trail = trailOf(d.id, records, nameOf, roomName)
    const onFloor = !s.heldBy && !s.tornBy
    rows.push({
      id: d.id,
      kind: note ? 'note' : 'memo',
      title: note
        ? `${note.id.slice(1, 3)} ${ROLE_NAMES[note.roleKey]} · ${note.pair}짝 ${KIND_WORD[note.kind]}`
        : s.writtenBy
          ? `손글씨 · ${nameOf(s.writtenBy) ?? '누군가'}`
          : (s.text ?? '').slice(0, 16),
      text: note ? fillSubject(note.text, nameOf(s.subjectId)) : (s.text ?? ''),
      state: s.tornBy ? 'torn' : s.heldBy ? 'held' : 'floor',
      placedAt: roomName(s.placedTile ?? (s.writtenBy ? s.tileId : null)),
      placedAtMs: s.placedAtMs ?? null,
      where: onFloor ? (roomName(roomOfSlip(s)) ?? '복도') : null,
      holder: nameOf(s.heldBy),
      foundBy: foundByOf(trail),
      doneBy: nameOf(s.tornBy),
      readers: s.readBy.map((id) => nameOf(id) ?? '누군가'),
      trail,
    })
  }
  const prompts = new Map(bank.docs.map((d) => [d.id, (d.data() as QuizDoc).prompt ?? '']))
  for (const d of floor.docs) {
    const q = d.data() as QuizPaperDoc
    const trail = trailOf(d.id, records, nameOf, roomName)
    const placed = roomName(roomOfCell(q.x, q.y)) ?? '복도'
    const text = prompts.get(q.quizId) ?? ''
    rows.push({
      id: d.id,
      kind: 'quiz',
      title: text.slice(0, 16),
      text,
      state: q.solvedBy ? 'solved' : q.heldBy ? 'held' : 'floor',
      placedAt: placed,
      placedAtMs: q.atMs ?? null,
      where: !q.heldBy && !q.solvedBy ? placed : null,
      holder: q.solvedBy ? null : nameOf(q.heldBy),
      // 줍기 줄이 없는 옛 판이면 든 사람이 곧 처음 주운 사람이다
      foundBy: foundByOf(trail) ?? nameOf(q.heldBy),
      doneBy: nameOf(q.solvedBy),
      readers: [],
      trail,
    })
  }
  return { papers: sortPapers(rows) }
})
