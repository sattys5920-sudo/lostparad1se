// 카드 — 뽑기와 내기.
//
// 손패는 팀 것이다. 네 장까지 쥐고, 차 있으면 뽑은 카드가 그대로
// 사라진다 — 무엇을 버릴지 고르게 하지 않는다. 손패를 비워 두지 않으면
// 손해라는 것이 규칙의 압력이다.
//
// 손패 **내용**은 secret에 있고 팀 문서에는 장수만 있다. 무엇을 쥐고
// 있는지 알면 봉쇄도 기습도 읽힌다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { CARD_BY_KIND, HAND_LIMIT, type CardKind, type TeamId } from '../../shared/rules/v2'
import { cardEffect, checkPlay, drawCard, playCard } from '../../shared/rules/cards'
import { gain } from '../../shared/rules/buildings'
import { applyInfluence } from '../../shared/rules/votes'
import { rngFrom } from '../../shared/missions/assign'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import type { CardDoc, PawnDoc, TeamDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const handsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('hands').collection('items')
const pendingOf = (gameId: string) => gameRef(gameId).collection('secret').doc('pending').collection('items')

/** 우리 팀 손패. 카드 id와 종류만. */
async function handOf(gameId: string, team: TeamId): Promise<{ id: string; kind: CardKind }[]> {
  const snap = await handsOf(gameId).where('team', '==', team).get()
  return snap.docs.map((d) => ({ id: d.id, kind: (d.data() as CardDoc).kind }))
}

/**
 * 한 장 뽑아 손패에 넣는다.
 *
 * 무엇이 나오는지는 씨앗이 판·팀·뽑은 횟수라 되돌려 뽑을 수 없다.
 * 손패가 네 장이면 뽑은 카드가 그대로 사라진다.
 *
 * 연구가 부른다. 카드 뽑기 자체에는 토큰이 들지 않는다 — 연구 쪽에서
 * 이미 냈다.
 */
export async function drawForTeam(
  gameId: string,
  team: TeamId,
  byId: string,
  day: number,
): Promise<{ drawn: CardKind; discarded: boolean; handCount: number }> {
  const hand = await handOf(gameId, team)
  const countRef = pendingOf(gameId).doc(`draws-${team}`)
  const drawnSoFar = ((await countRef.get()).data() as { n?: number } | undefined)?.n ?? 0

  const out = drawCard(
    hand.map((c) => c.kind),
    rngFrom(`${gameId}:${team}:draw:${drawnSoFar}`)(),
  )

  const batch = db.batch()
  batch.set(countRef, { n: drawnSoFar + 1 })
  if (!out.discarded) {
    batch.set(handsOf(gameId).doc(), { team, kind: out.drawn, day })
    batch.update(gameRef(gameId).collection('teams').doc(team), { handCount: hand.length + 1 })
  }
  batch.set(gameRef(gameId).collection('events').doc(), {
    atMs: Date.now(),
    day,
    kind: 'cardDrawn',
    team,
    playerId: byId,
    // 무엇을 뽑았는지는 기록에 안 남긴다. 기록은 모두가 읽는다
    detail: { discarded: out.discarded },
  })
  await batch.commit()
  // 무엇이었는지는 뽑은 팀만 안다
  return { drawn: out.drawn, discarded: out.discarded, handCount: out.discarded ? hand.length : hand.length + 1 }
}

const PLAY_REFUSAL: Record<string, string> = {
  notInHand: '그 카드가 손패에 없다.',
  needsTeam: '대상 팀을 골라야 한다.',
  needsTile: '대상 칸을 골라야 한다.',
  needsPawn: '대상 말을 골라야 한다.',
  ownTeam: '우리 팀에는 못 쓴다.',
}

/**
 * 한 장 낸다.
 *
 * 지속 시간의 기준이 카드마다 다르다. 보강·밀서는 실제 시계, 봉쇄·잠복은
 * 게임 시계다 — 소등 동안 깃발이 멈춰 있으니 봉쇄도 같이 멈춰야 앞뒤가
 * 맞는다. 그 계산은 cardEffect가 하고 여기서는 받아 적는다.
 */
export const playOne = onCall<{
  gameId: string
  kind: CardKind
  targetTeam?: TeamId
  targetTile?: TileId
  targetPawn?: string
}>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, kind } = req.data
  if (!CARD_BY_KIND[kind]) throw new HttpsError('invalid-argument', '그런 카드는 없다.')
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  const hand = await handOf(gameId, pawn.team)
  const input = {
    kind,
    team: pawn.team,
    nowMs,
    realNowMs: Date.now(),
    targetTeam: req.data.targetTeam,
    targetTile: req.data.targetTile,
    targetPawn: req.data.targetPawn,
  }
  const okPlay = checkPlay(hand.map((c) => c.kind), input)
  if (!okPlay.ok) throw new HttpsError('failed-precondition', PLAY_REFUSAL[okPlay.reason as string] ?? '낼 수 없다.')
  if (req.data.targetTile && !TILE_BY_ID[req.data.targetTile]) {
    throw new HttpsError('invalid-argument', '그런 칸은 없다.')
  }

  const effect = cardEffect(input)
  const card = hand.find((c) => c.kind === kind) as { id: string }
  const left = playCard(hand.map((c) => c.kind), kind) as CardKind[]

  const batch = db.batch()
  batch.delete(handsOf(gameId).doc(card.id))
  batch.update(ref.collection('teams').doc(pawn.team), { handCount: left.length })

  // 자원이 바로 들어온다
  if (effect.gain) {
    const team = (await ref.collection('teams').doc(pawn.team).get()).data() as TeamDoc
    batch.update(ref.collection('teams').doc(pawn.team), { resources: gain(team.resources, effect.gain) })
  }

  // 대상 팀 영향력이 깎인다
  if (effect.influenceHit) {
    const t = effect.influenceHit.team
    const doc = (await ref.collection('teams').doc(t).get()).data() as TeamDoc
    batch.update(ref.collection('teams').doc(t), {
      resources: { ...doc.resources, influence: applyInfluence(doc.resources.influence, -effect.influenceHit.amount) },
    })
  }

  // 칸에 붙는 것 — 보강과 봉쇄
  if (effect.tile) {
    const patch: Record<string, unknown> = {}
    if (effect.tile.reinforce !== undefined) patch.reinforcedBy = effect.tile.reinforce
    if (effect.tile.untilRealMs !== undefined) patch.reinforcedUntilRealMs = effect.tile.untilRealMs
    if (effect.tile.blockedUntilMs !== undefined) patch.blockedUntilMs = effect.tile.blockedUntilMs
    if (Object.keys(patch).length > 0) batch.update(ref.collection('tiles').doc(effect.tile.tileId), patch)
  }

  // 말에 붙는 것 — 잠복과 강행군
  if (effect.pawn) {
    const target = (await ref.collection('pawns').doc(effect.pawn.playerId).get()).data() as PawnDoc | undefined
    if (!target) throw new HttpsError('not-found', '그런 말이 없다.')
    if (effect.pawn.hiddenUntilMs !== undefined) {
      batch.update(ref.collection('pawns').doc(effect.pawn.playerId), { hiddenUntilMs: effect.pawn.hiddenUntilMs })
    }
  }

  // 다음 한 번만 걸리는 표시 — 기습 · 급조 · 협정서
  if (effect.pending) {
    batch.set(pendingOf(gameId).doc(`${pawn.team}-${effect.pending}`), {
      team: pawn.team,
      kind: effect.pending,
      setAtMs: nowMs,
    })
  }

  // 가짜 깃발. **이 사실은 secret에만 적는다** — 다른 팀에게는 진짜와
  // 네트워크 응답으로도 구분되지 않는다
  if (effect.fakeFlag && effect.tile) {
    batch.set(ref.collection('secret').doc('flagTruth').collection('items').doc(effect.tile.tileId), {
      team: pawn.team,
      fake: true,
    })
  }

  // 밀서 — 비밀 대화방
  if (effect.roomUntilRealMs && req.data.targetTeam) {
    batch.set(ref.collection('secret').doc('rooms').collection('items').doc(), {
      teams: [pawn.team, req.data.targetTeam].sort(),
      untilRealMs: effect.roomUntilRealMs,
    })
  }

  batch.set(ref.collection('events').doc(), {
    atMs: nowMs,
    day: game.day,
    kind: 'cardPlayed',
    team: pawn.team,
    playerId: uid,
    ...(effect.tile ? { tileId: effect.tile.tileId } : {}),
    // 가짜 깃발만은 어떤 카드였는지 남기지 않는다. 기록을 보면 들킨다
    detail: effect.fakeFlag ? {} : { card: kind, targetTeam: req.data.targetTeam ?? null },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { played: kind, handCount: left.length }
})

// ── 다음 한 번만 걸리는 표시 ────────────────────────────────────

/**
 * 걸려 있으면 true를 돌려주고 **그 자리에서 지운다.**
 *
 * 기습·급조·협정서는 「다음 한 번」이다. 쓰고 나서 지우는 것을 잊으면
 * 한 장으로 닷새를 쓴다.
 */
export async function takePending(
  gameId: string,
  team: TeamId,
  kind: 'ambush' | 'quickBuild' | 'accord',
): Promise<boolean> {
  const ref = pendingOf(gameId).doc(`${team}-${kind}`)
  const snap = await ref.get()
  if (!snap.exists) return false
  await ref.delete()
  return true
}

export { HAND_LIMIT }