// 연구실에 놓이는 완성품 — 서버 쪽.
//
// 연구를 건 지 스무 분 뒤에 그 연구실에 하나가 놓인다. 그때 거기 서
// 있던 본인이 받으면 바로 그 팀 로봇이 되고, 아니면 완성품으로 놓인다.
// **그 페이즈 동안에는 건 사람만** 가져가고, 페이즈가 끝나도록 안
// 가져갔으면 그다음부터는 누구든 — 자유 시간에도, 남의 팀도.
//
// 시각을 보는 일이라 규칙(occupy.settle)이 아니라 여기서 한다.
// 따라잡기가 지날 때마다 익은 것을 처리한다 — 시계가 따로 돌지 않고
// 사람이 서버를 두드릴 때 밀린 것이 따라잡히는, 이 판의 방식이다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { MADE_NO, landsToOwner, whyNotTake, type MadeDoc } from '../../shared/rules/made'
import { MAX_CARRIED_ROBOTS, type PendingResearch } from '../../shared/rules/occupy'
import type { TileId } from '../../shared/rules/board'
import type { TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc } from '../../shared/model'
import { gameRef, nowOf, requireUid } from './index'
import { note } from './records'
import { refreshViews } from './views'
import { notify } from './notify'
import { requireFree } from './turn'

const db = getFirestore()

export const madeOf = (gameId: string) => gameRef(gameId).collection('made')
const robotsOf = (gameId: string) => gameRef(gameId).collection('robots')
const hiddenOf = (gameId: string) => gameRef(gameId).collection('secret').doc('phase')

/** 걸어 둔 연구 하나. 규칙이 보는 것에 **익는 시각**을 더한 것이다. */
export interface Brewing extends PendingResearch {
  doneAtMs: number
}


/** 새 로봇 이름 */
const newBotId = () => `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/**
 * **손에 드는 로봇은 무조건 두 기까지.** 트랜잭션 안에서 지금 든 것을 세고,
 * 사람 문서도 같이 건드린다 — 같은 사람에게 로봇이 동시에 둘 들어오면
 * 한쪽이 쓴 사람 문서를 다른 쪽이 읽었으므로 다시 돌아와 센다.
 * (든 로봇을 세는 질의만으로는 새로 생기는 문서를 못 막는다)
 */
async function readHands(tx: FirebaseFirestore.Transaction, gameId: string, holder: string) {
  const pawnRef = gameRef(gameId).collection('pawns').doc(holder)
  const [pawn, held] = await Promise.all([tx.get(pawnRef), tx.get(robotsOf(gameId).where('carriedBy', '==', holder))])
  return { pawnRef, pawn: pawn.data() as PawnDoc | undefined, carried: held.size }
}

/** readHands 뒤에 부른다. 로봇 하나를 그 사람 손에 쥐여 준다 */
function giveBot(tx: FirebaseFirestore.Transaction, gameId: string, pawnRef: FirebaseFirestore.DocumentReference, team: TeamId, tileId: TileId, holder: string): string {
  const id = newBotId()
  tx.set(robotsOf(gameId).doc(id), { id, team, tileId, carriedBy: holder, placedBy: null })
  tx.update(pawnRef, { handsRev: FieldValue.increment(1) })
  return id
}

/**
 * 연구 하나가 끝났다. **팀의 연구 단계를 올리고 카드를 한 장 준다.**
 *
 * 받은 쪽에게 붙는다. 남이 두고 간 것을 주워 가면 주운 팀의 단계가
 * 오른다 — 로봇이 그 팀 것이 되는 것과 같은 이치다. 누가 만들었는지는
 * 기록에 따로 남는다.
 */
export async function researchTierUp(gameId: string, team: TeamId) {
  const ref = gameRef(gameId).collection('teams').doc(team)
  const snap = await ref.get()
  const tier = ((snap.data()?.researchTier as number | undefined) ?? 0) + 1
  // **카드는 없앴다.** 로봇이 태어날 때 한 장 뽑히던 자리다 — 카드로
  // 가는 입구가 여기 하나뿐이라, 종이를 안 놓으면 열두 종이 한 장도
  // 안 돌았다. 남는 것은 연구 단계 하나다
  await ref.update({ researchTier: tier })
}

/**
 * 익은 연구를 처리한다. **아무 때나 불러도 된다.**
 *
 * 페이즈가 닫혀 있으면 아무것도 안 한다 — 안 익은 연구는 닫힐 때
 * 규칙이 이미 버렸고, 익은 것은 페이즈 안에서만 놓인다.
 */
export async function landResearch(gameId: string, atMs?: number): Promise<void> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) return
  const game = snap.data() as GameDoc
  if (game.phase !== 'running' || !game.phaseNow?.open) return
  // 저절로 닫히기 직전에는 끝 시각으로 부른다 — 끝나는 순간 익은 연구도 판정에 든다
  const nowMs = atMs ?? nowOf(game)

  /*
   * **익은 줄을 먼저 뺀다(트랜잭션).** 두 요청이 같은 순간에 들어와도
   * 한 줄은 한 번만 로봇이 된다 — 뺀 쪽만 만든다.
   */
  const ripe = await db.runTransaction(async (tx) => {
    const hidden = await tx.get(hiddenOf(gameId))
    const rows = ((hidden.data()?.pendingResearch ?? []) as Brewing[]).filter(
      (r) => r && typeof r.doneAtMs === 'number' && r.tileId,
    )
    const done = rows.filter((r) => r.doneAtMs <= nowMs)
    if (done.length > 0) tx.update(hiddenOf(gameId), { pendingResearch: rows.filter((r) => r.doneAtMs > nowMs) })
    return done
  })
  if (ripe.length === 0) return
  // 맡긴 사람에게 알린다(제작 완료). 받았든 놓였든 다 된 것은 같다
  for (const r of ripe) await notify(gameId, [r.playerId], 'made', `made:research:${r.playerId}:${r.doneAtMs}`)

  for (const r of ripe) {
    // 본인이 그 연구실에 서 있고 손에 자리가 있으면 바로 받는다. 아니면 완성품으로 놓인다 —
    // 이 페이즈 동안은 건 사람만 가져간다
    const landed = await db.runTransaction(async (tx) => {
      const { pawnRef, pawn, carried } = await readHands(tx, gameId, r.playerId)
      const team = pawn?.team as TeamId | undefined
      if (pawn && team && landsToOwner(pawn.tileId, r.tileId) && carried < MAX_CARRIED_ROBOTS) {
        return { id: giveBot(tx, gameId, pawnRef, team, r.tileId, r.playerId), team }
      }
      // 손이 찼으면(두 기) 받지 못한다. 물건은 그대로 놓인다 — 하나 놓고 와서 가져간다
      const doc: MadeDoc = {
        tileId: r.tileId,
        byPlayerId: r.playerId,
        byTeam: team ?? ('A' as TeamId),
        atMs: nowMs,
        // 이 페이즈 동안은 건 사람 것이다
        phaseNo: game.phaseNow!.no,
        // 치워질 때까지 이 기계는 찼다 — 한 대에 한 건
        ...(typeof r.machine === 'number' ? { machine: r.machine } : {}),
      }
      tx.set(madeOf(gameId).doc(), doc)
      return { id: null, team }
    })
    if (landed.id && landed.team) {
      await note(gameId, 'robotBorn', nowMs, { id: r.playerId, team: landed.team }, {
        tileId: r.tileId,
        subjectId: landed.id,
        ownerId: r.playerId,
      })
      await researchTierUp(gameId, landed.team)
    }
  }

  await refreshViews(gameId)
}

/**
 * 놓인 완성품을 가져간다.
 *
 * **만든 페이즈 동안은 건 사람만.** 그 페이즈가 닫힌 뒤로는 팀을 안
 * 본다 — 남의 팀이 주워 가면 그 팀 로봇이 된다. 걸어 놓고 안 챙기면
 * 남 좋은 일을 하는 셈이다.
 */
export const takeMade = onCall<{ gameId: string; madeId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, madeId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const nowMs = nowOf(game)

  const pawnSnap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!pawnSnap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const pawn = pawnSnap.data() as PawnDoc
  // 덫에 걸렸거나 하던 일이 안 끝났으면 못 가져간다
  requireFree(pawn, nowMs)

  const ref = madeOf(gameId).doc(madeId)

  const { made, id } = await db.runTransaction(async (tx) => {
    const [d, hands] = await Promise.all([tx.get(ref), readHands(tx, gameId, uid)])
    if (!d.exists) throw new HttpsError('not-found', '그런 완성품이 없다.')
    const m = d.data() as MadeDoc
    const no = whyNotTake({
      openPhaseNo: game.phaseNow?.open ? game.phaseNow.no : null,
      madePhaseNo: m.phaseNo,
      mine: m.byPlayerId === uid,
      here: pawn.tileId,
      tileId: m.tileId,
      // **트랜잭션 안에서 센다** — 두 개를 동시에 가져가도 두 기를 못 넘는다
      carried: hands.carried,
      carryCap: MAX_CARRIED_ROBOTS,
    })
    if (no) throw new HttpsError('failed-precondition', `${MADE_NO[no]}.`)
    // **먼저 가져간 사람만 가진다.** 둘이 같은 것을 노리면 여기서 갈린다
    tx.delete(ref)
    return { made: m, id: giveBot(tx, gameId, hands.pawnRef, pawn.team as TeamId, m.tileId, uid) }
  })

  await note(gameId, 'robotBorn', nowMs, { id: uid, team: pawn.team }, {
    tileId: made.tileId,
    subjectId: id,
    // **만든 사람은 따로 남긴다.** 남의 것을 주워 간 판이 기록에 보여야 한다
    ownerId: made.byPlayerId,
  })
  await researchTierUp(gameId, pawn.team)
  await refreshViews(gameId)
  return {
    took: true,
    mine: made.byPlayerId === uid,
    said: made.byPlayerId === uid ? '연구한 것을 받았다.' : '남이 두고 간 것을 가져갔다.',
  }
})
