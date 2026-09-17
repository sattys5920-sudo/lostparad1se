// 연구실에 놓이는 완성품 — 서버 쪽.
//
// 연구를 건 지 스무 분 뒤에 그 연구실에 하나가 놓인다. 그때 거기 서
// 있던 본인이 받으면 바로 그 팀 로봇이 되고, 아니면 **주인 없는
// 물건**으로 남아 먼저 온 사람이 가진다 — 누구든.
//
// 시각을 보는 일이라 규칙(occupy.settle)이 아니라 여기서 한다.
// 따라잡기가 지날 때마다 익은 것을 처리한다 — 시계가 따로 돌지 않고
// 사람이 서버를 두드릴 때 밀린 것이 따라잡히는, 이 판의 방식이다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { MADE_NO, landsToOwner, whyNotTake, type MadeDoc } from '../../shared/rules/made'
import { MAX_CARRIED_ROBOTS, ROBOTS_PER_ROOM, ROBOTS_PER_TEAM, type PendingResearch } from '../../shared/rules/occupy'
import type { TileId } from '../../shared/rules/board'
import type { TeamId } from '../../shared/rules/v2'
import type { GameDoc, PawnDoc } from '../../shared/model'
import { gameRef, nowOf, requireUid } from './index'
import { drawForTeam } from './card'
import { note } from './records'
import { refreshViews } from './views'

const db = getFirestore()

export const madeOf = (gameId: string) => gameRef(gameId).collection('made')
const robotsOf = (gameId: string) => gameRef(gameId).collection('robots')
const hiddenOf = (gameId: string) => gameRef(gameId).collection('secret').doc('phase')

/** 걸어 둔 연구 하나. 규칙이 보는 것에 **익는 시각**을 더한 것이다. */
export interface Brewing extends PendingResearch {
  doneAtMs: number
}

interface RobotRow {
  id: string
  team: TeamId
  tileId: TileId
  carriedBy: string | null
}

/** 그 팀·그 방이 로봇을 더 받을 수 있는가. 한도는 규칙 쪽 값이다. */
async function roomFor(gameId: string, team: TeamId, tileId: TileId): Promise<boolean> {
  const bots = await robotsOf(gameId).get()
  const rows = bots.docs.map((d) => d.data() as RobotRow)
  if (rows.filter((r) => r.team === team).length >= ROBOTS_PER_TEAM) return false
  return rows.filter((r) => r.tileId === tileId).length < ROBOTS_PER_ROOM
}

/** 로봇 하나를 낸다. 들 수 있으면 그 사람이 들고 간다. */
async function bornFor(
  gameId: string,
  team: TeamId,
  tileId: TileId,
  holder: string | null,
): Promise<string> {
  const id = `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  let carriedBy: string | null = null
  if (holder) {
    const bots = await robotsOf(gameId).get()
    const held = bots.docs.filter((d) => (d.data() as RobotRow).carriedBy === holder).length
    carriedBy = held < MAX_CARRIED_ROBOTS ? holder : null
  }
  await robotsOf(gameId).doc(id).set({ id, team, tileId, carriedBy })
  return id
}

/**
 * 연구 하나가 끝났다. **팀의 연구 단계를 올리고 카드를 한 장 준다.**
 *
 * 받은 쪽에게 붙는다. 남이 두고 간 것을 주워 가면 주운 팀의 단계가
 * 오른다 — 로봇이 그 팀 것이 되는 것과 같은 이치다. 누가 만들었는지는
 * 기록에 따로 남는다.
 */
export async function researchTierUp(gameId: string, team: TeamId, playerId: string, day: number) {
  const ref = gameRef(gameId).collection('teams').doc(team)
  const snap = await ref.get()
  const tier = ((snap.data()?.researchTier as number | undefined) ?? 0) + 1
  await ref.update({ researchTier: tier })
  // 손패가 차 있으면 그대로 사라진다
  await drawForTeam(gameId, team, playerId, day)
}

/**
 * 익은 연구를 처리한다. **아무 때나 불러도 된다.**
 *
 * 페이즈가 닫혀 있으면 아무것도 안 한다 — 안 익은 연구는 닫힐 때
 * 규칙이 이미 버렸고, 익은 것은 페이즈 안에서만 놓인다.
 */
export async function landResearch(gameId: string): Promise<void> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) return
  const game = snap.data() as GameDoc
  if (game.phase !== 'running' || !game.phaseNow?.open) return
  const nowMs = nowOf(game)

  const hidden = await hiddenOf(gameId).get()
  const rows = ((hidden.data()?.pendingResearch ?? []) as Brewing[]).filter(
    (r) => r && typeof r.doneAtMs === 'number' && r.tileId,
  )
  const ripe = rows.filter((r) => r.doneAtMs <= nowMs)
  if (ripe.length === 0) return

  for (const r of ripe) {
    const pawn = (await gameRef(gameId).collection('pawns').doc(r.playerId).get()).data() as PawnDoc | undefined
    const team = pawn?.team
    // 본인이 그 연구실에 서 있으면 바로 받는다
    if (pawn && team && landsToOwner(pawn.tileId, r.tileId)) {
      if (await roomFor(gameId, team, r.tileId)) {
        const id = await bornFor(gameId, team, r.tileId, r.playerId)
        await note(gameId, 'robotBorn', nowMs, { id: r.playerId, team }, {
          tileId: r.tileId,
          subjectId: id,
          ownerId: r.playerId,
        })
        await researchTierUp(gameId, team, r.playerId, game.phaseNow.day)
        continue
      }
      // 한도가 찼으면 받지 못한다. 물건은 그대로 놓인다
    }
    // 못 받았다. **주인이 없어진다** — 먼저 온 사람이 가진다
    const doc: MadeDoc = {
      tileId: r.tileId,
      byPlayerId: r.playerId,
      byTeam: team ?? ('A' as TeamId),
      atMs: nowMs,
    }
    await madeOf(gameId).add(doc)
  }

  const left = rows.filter((r) => r.doneAtMs > nowMs)
  await hiddenOf(gameId).update({ pendingResearch: left })
  await refreshViews(gameId)
}

/**
 * 놓인 완성품을 가져간다. **먼저 온 사람이 가진다 — 누구든.**
 *
 * 팀을 안 본다. 남의 팀이 주워 가면 그 팀 로봇이 된다 — 연구실을
 * 비우면 남 좋은 일을 하는 셈이고, 그래서 연구실은 지킬 이유가 있다.
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

  const bots = (await robotsOf(gameId).get()).docs.map((d) => d.data() as RobotRow)
  const ref = madeOf(gameId).doc(madeId)

  const made = await db.runTransaction<MadeDoc>(async (tx) => {
    const d = await tx.get(ref)
    if (!d.exists) throw new HttpsError('not-found', '그런 완성품이 없다.')
    const m = d.data() as MadeDoc
    const no = whyNotTake({
      phaseOpen: game.phaseNow?.open === true,
      here: pawn.tileId,
      tileId: m.tileId,
      teamRobots: bots.filter((r) => r.team === pawn.team).length,
      teamCap: ROBOTS_PER_TEAM,
      roomRobots: bots.filter((r) => r.tileId === m.tileId).length,
      roomCap: ROBOTS_PER_ROOM,
    })
    if (no) throw new HttpsError('failed-precondition', `${MADE_NO[no]}.`)
    // **먼저 가져간 사람만 가진다.** 둘이 같은 것을 노리면 여기서 갈린다
    tx.delete(ref)
    return m
  })

  const id = await bornFor(gameId, pawn.team, made.tileId, uid)
  await note(gameId, 'robotBorn', nowMs, { id: uid, team: pawn.team }, {
    tileId: made.tileId,
    subjectId: id,
    // **만든 사람은 따로 남긴다.** 남의 것을 주워 간 판이 기록에 보여야 한다
    ownerId: made.byPlayerId,
  })
  await researchTierUp(gameId, pawn.team, uid, game.phaseNow?.day ?? game.day)
  await refreshViews(gameId)
  return {
    took: true,
    mine: made.byPlayerId === uid,
    said: made.byPlayerId === uid ? '연구한 것을 받았다.' : '남이 두고 간 것을 가져갔다.',
  }
})
