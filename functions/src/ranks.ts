// 순위 — 운영자만. 사람마다 센 수를 5 등까지. 셈은 shared/rules/ranks.
//
//   심부름     기록의 errandDone
//   문제       기록의 quizSolved — 한 장은 먼저 맞힌 한 사람 것이다
//   쪽지       운영자가 뿌린 56장 가운데, 한 장마다 **처음 주운 사람**(이력의 「발견」)
//   작물       기록의 potHarvest — 화분에서 열매 하나 딸 때마다 한 줄
//   걸음       멈춘 자리(qa 로그의 standAt)를 가장 짧은 길로 이은 칸 수 — 추정
//   덫 걸림    qa 로그의 trapSprung — 걸린 사람
//   덫 제조    qa 로그의 trapCommissioned — 맡겨서 나온 덫 개수(detail.count)
//   번 돈      심부름 보상(qa errandDone.coins) + 자판기 매입(cropSold.paid) + 거래로 받은 돈
//   쓴 돈      자판기에서 산 값(shopBought.cost) + 덫 맡긴 값 + 거래로 내준 돈
//   말         맵 대화(secret/chat). 무전은 다른 곳(secret/radio)이라 안 섞인다
//
// 지갑에 돈이 들고 나는 곳은 이것뿐이다 — 거래에 수수료는 없다.
// **참가자 쪽 어떤 응답에도 안 실린다.** 수만 싣고 쪽지 주인은 안 싣는다.
import { onCall } from 'firebase-functions/v2/https'

import { RANK_LIMIT, topRanks, walkDistance, walkedCells } from '../../shared/rules/ranks'
import type { DealState } from '../../shared/rules/deal'
import { TRAP_COIN_COST } from '../../shared/rules/trap'
import type { GameRecord } from '../../shared/rules/records'
import type { GameDoc } from '../../shared/model'
import type { SlipDoc } from './slips'
import { qaLogOf } from './qaLog'
import { gameRef } from './index'
import { requireHost } from './host'

const bump = (m: Map<string, number>, id: string | undefined, by = 1) => {
  if (id) m.set(id, (m.get(id) ?? 0) + by)
}

export const hostRanks = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ref = gameRef(gameId)
  const records = ref.collection('secret').doc('records').collection('items')
  const qa = qaLogOf(gameId)
  const [gameSnap, done, solved, takes, slips, stops, picked, sprung, made, paid, sold, bought, deals, said] =
    await Promise.all([
      ref.get(),
      records.where('kind', '==', 'errandDone').get(),
      records.where('kind', '==', 'quizSolved').get(),
      records.where('kind', '==', 'slipTake').get(),
      ref.collection('secret').doc('slips').collection('items').get(),
      qa.where('kind', '==', 'standAt').select('playerId', 'atMs', 'detail').get(),
      records.where('kind', '==', 'potHarvest').get(),
      qa.where('kind', '==', 'trapSprung').select('playerId').get(),
      qa.where('kind', '==', 'trapCommissioned').select('playerId', 'detail').get(),
      qa.where('kind', '==', 'errandDone').select('playerId', 'detail').get(),
      qa.where('kind', '==', 'cropSold').select('playerId', 'detail').get(),
      qa.where('kind', '==', 'shopBought').select('playerId', 'detail').get(),
      ref.collection('deals').where('status', '==', 'done').get(),
      ref.collection('secret').doc('chat').collection('items').select('playerId').get(),
    ])
  const game = gameSnap.data() as GameDoc | undefined
  const names = new Map((game?.seats ?? []).map((s) => [s.playerId, s.name]))
  const nameOf = (id: string) => names.get(id) ?? null

  const errands = new Map<string, number>()
  for (const d of done.docs) bump(errands, (d.data() as GameRecord).actorId)

  // 같은 종이를 두 번 맞힐 일은 없지만, 기록이 겹쳐도 한 장으로 센다
  const quizzes = new Map<string, number>()
  const seenQuiz = new Set<string>()
  for (const d of solved.docs) {
    const r = d.data() as GameRecord
    const key = r.subjectId ?? d.id
    if (seenQuiz.has(key)) continue
    seenQuiz.add(key)
    bump(quizzes, r.actorId)
  }

  const crops = new Map<string, number>()
  for (const d of picked.docs) bump(crops, (d.data() as GameRecord).actorId)

  const noteIds = new Set(slips.docs.filter((d) => (d.data() as SlipDoc).noteId).map((d) => d.id))
  const firstTake = new Map<string, GameRecord>()
  for (const d of takes.docs) {
    const r = d.data() as GameRecord
    if (!r.subjectId || !noteIds.has(r.subjectId)) continue
    const was = firstTake.get(r.subjectId)
    if (!was || r.atMs < was.atMs) firstTake.set(r.subjectId, r)
  }
  const notes = new Map<string, number>()
  for (const r of firstTake.values()) bump(notes, r.actorId)

  const byPlayer = new Map<string, { atMs: number; x: number; y: number }[]>()
  for (const d of stops.docs) {
    const r = d.data() as {
      playerId?: string
      atMs?: number
      detail?: { x?: number; y?: number }
    }
    const x = r.detail?.x
    const y = r.detail?.y
    if (!r.playerId || typeof x !== 'number' || typeof y !== 'number') continue
    const list = byPlayer.get(r.playerId) ?? []
    list.push({ atMs: r.atMs ?? 0, x, y })
    byPlayer.set(r.playerId, list)
  }
  const dist = walkDistance()
  const steps = new Map<string, number>()
  for (const [id, list] of byPlayer) {
    if (!names.has(id)) continue
    list.sort((a, b) => a.atMs - b.atMs)
    steps.set(id, walkedCells(list, dist))
  }

  type Row = { playerId?: string; detail?: Record<string, unknown> }
  const num = (v: unknown, or = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : or)
  const rowsOf = (q: FirebaseFirestore.QuerySnapshot) => q.docs.map((d) => d.data() as Row)

  const trapped = new Map<string, number>()
  for (const r of rowsOf(sprung)) bump(trapped, r.playerId)

  const trapsMade = new Map<string, number>()
  const earned = new Map<string, number>()
  const spent = new Map<string, number>()
  for (const r of rowsOf(made)) {
    bump(trapsMade, r.playerId, num(r.detail?.count, 1))
    bump(spent, r.playerId, TRAP_COIN_COST)
  }
  for (const r of rowsOf(paid)) bump(earned, r.playerId, num(r.detail?.coins))
  for (const r of rowsOf(sold)) bump(earned, r.playerId, num(r.detail?.paid))
  for (const r of rowsOf(bought)) bump(spent, r.playerId, num(r.detail?.cost))
  // 거래 — 내가 올린 돈은 나가고, 상대가 올린 돈은 들어온다
  for (const d of deals.docs) {
    const deal = d.data() as DealState
    const a = num(deal.a?.stake?.money)
    const b = num(deal.b?.stake?.money)
    bump(spent, deal.a?.playerId, a)
    bump(earned, deal.a?.playerId, b)
    bump(spent, deal.b?.playerId, b)
    bump(earned, deal.b?.playerId, a)
  }

  const talk = new Map<string, number>()
  for (const r of rowsOf(said)) bump(talk, r.playerId)

  return {
    limit: RANK_LIMIT,
    errands: topRanks(errands, nameOf),
    steps: topRanks(steps, nameOf),
    quizzes: topRanks(quizzes, nameOf),
    notes: topRanks(notes, nameOf),
    crops: topRanks(crops, nameOf),
    trapped: topRanks(trapped, nameOf),
    trapsMade: topRanks(trapsMade, nameOf),
    earned: topRanks(earned, nameOf),
    spent: topRanks(spent, nameOf),
    talk: topRanks(talk, nameOf),
  }
})
