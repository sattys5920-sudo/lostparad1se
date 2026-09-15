// 교역과 동맹.
//
// 토큰이 들지 않는다. 대신 **받아들이는 순간** 양쪽 자원을 다시 센다 —
// 제안할 때가 아니라. 그 사이에 한쪽이 다 써 버렸으면 성립하지 않는다.
//
// 동맹은 한 번에 하나다. 먼저 깬 팀은 열두 시간 동안 새
// 동맹을 못 맺는다. DAY 4 가 열릴 때는 모든 동맹이 그냥 풀린다 — 먼저 깬
// 것이 아니므로 아무도 값을 치르지 않는다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  acceptTrade,
  breakAlliance,
  canAlly,
  canOffer,
  movePurse,
  type Purse,
  type TradeOffer,
} from '../../shared/rules/diplomacy'
import { tradeEpoch } from '../../shared/rules/diplomacy'
import { MAX_CARRIED_ROBOTS, TRADE_COST } from '../../shared/rules/occupy'
import type { Resource, TeamId } from '../../shared/rules/v2'
import { TEAMS } from '../../shared/rules/lobby'
import type { PawnDoc, TeamDoc } from '../../shared/model'
import type { TileId } from '../../shared/rules/board'
import { note, noteAll } from './records'

/** 거래로 손을 바꾼 로봇 한 기. 기록에 쓰려고 트랜잭션 밖으로 들고 나간다. */
interface RobotMove {
  robotId: string
  fromId: string
  fromTeam: TeamId
  toId: string
  toTeam: TeamId
}
import { refreshViews } from './views'
import { freshNow, myPawn, refuseIfInvisible, standingWith } from './turn'
import { takePending } from './card'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/**
 * 교역 제안과 동맹 제안은 **서버만 읽는다.**
 *
 * 네 팀이 서로의 제안을 다 볼 수 있으면 협상이 협상이 아니다. 관련된
 * 두 팀에게만 views로 깎여 간다.
 */
const tradesOf = (gameId: string) => gameRef(gameId).collection('secret').doc('trades').collection('items')
const proposalsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('alliances').collection('items')

type Bag = Partial<Record<Resource, number>>

/**
 * 사람이 들고 있는 것 — 토큰과 데리고 있는 로봇.
 *
 * 재화는 팀 금고에서 오가지만 이 둘은 **마주 선 두 사람** 사이에서만
 * 오간다. 토큰은 페이즈마다 받는 행동 횟수고 로봇은 끌고 다니는 것이라,
 * 팀 금고를 거치면 학교 반대편에서도 건넬 수 있게 된다.
 */
function cleanPurse(v: unknown): Partial<Purse> {
  const out: Partial<Purse> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of ['tokens', 'robots'] as const) {
    const n = Number((v as Record<string, unknown>)[k])
    if (!Number.isInteger(n) || n < 0) {
      if ((v as Record<string, unknown>)[k] === undefined) continue
      throw new HttpsError('invalid-argument', '수가 이상하다.')
    }
    if (n > 0) out[k] = n
  }
  return out
}

/** 숫자가 아니거나 음수면 거절한다. 화면을 믿지 않는다. */
function cleanBag(bag: unknown): Bag {
  const out: Bag = {}
  if (!bag || typeof bag !== 'object') return out
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (k !== 'money' && k !== 'knowledge') continue
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new HttpsError('invalid-argument', '자원 수가 이상하다.')
    if (n > 0) out[k] = n
  }
  return out
}

// ── 교역 ────────────────────────────────────────────────────────

/**
 * 그 팀 사람과 **마주 서야** 건넬 수 있다.
 *
 * 교역도 동맹도 팀 대 팀이지만, 말을 꺼내는 것은 사람이다. 학교
 * 반대편에서 제안이 날아오면 「뺏으려면 걸어가야 한다」가 자원에만
 * 적용되고 말에는 적용되지 않는 셈이 된다.
 */
async function requireFacing(gameId: string, uid: string, team: TeamId, what: string): Promise<void> {
  const { here } = await standingWith(gameId, uid)
  for (const [, p] of here) if (p.team === team) return
  throw new HttpsError('failed-precondition', `${team}팀 사람과 같은 자리에 서야 ${what}을 꺼낼 수 있다.`)
}

export const offerTrade = onCall<{
  gameId: string
  /** 마주 선 그 사람. 팀이 아니라 사람에게 건넨다. */
  toPlayerId: string
  give: Bag
  want: Bag
  givePurse?: Partial<Purse>
  wantPurse?: Partial<Purse>
  note?: string
}>(
  async (req) => {
    const uid = requireUid(req.auth)
    const { gameId, toPlayerId } = req.data
    const { game, nowMs } = await freshNow(gameId)
    const pawn = await myPawn(gameId, uid)
    if (pawn.tileId === null) throw new HttpsError('failed-precondition', '걷는 중이다. 도착해야 말을 꺼낸다.')
    if (toPlayerId === uid) throw new HttpsError('invalid-argument', '나에게는 못 건넨다.')

    // **마주 선 사람에게만.** 목록에서 고르는 원격 제안은 없다
    const theirSnap = await gameRef(gameId).collection('pawns').doc(toPlayerId).get()
    if (!theirSnap.exists) throw new HttpsError('not-found', '그런 사람이 없다.')
    const their = theirSnap.data() as PawnDoc
    if (their.tileId !== pawn.tileId) throw new HttpsError('failed-precondition', '같은 방에 있어야 한다.')
    refuseIfInvisible(game.invisibleId, uid, toPlayerId, '거래할')
    const toTeam = their.team

    const give = cleanBag(req.data.give)
    const want = cleanBag(req.data.want)
    const givePurse = cleanPurse(req.data.givePurse)
    const wantPurse = cleanPurse(req.data.wantPurse)
    if ((wantPurse.robots ?? 0) > MAX_CARRIED_ROBOTS) {
      throw new HttpsError('invalid-argument', `한 사람이 데리고 다니는 로봇은 ${MAX_CARRIED_ROBOTS}기까지다.`)
    }
    const ref = gameRef(gameId)

    const out = canOffer({
      fromTeam: pawn.team,
      toTeam,
      give,
      want,
      givePurse,
      wantPurse,
    })
    if (!out.ok) {
      const why: Record<string, string> = {
        ownTeam: '우리 팀이다.',
        empty: '주고받을 것이 없다.',
      }
      throw new HttpsError('failed-precondition', why[out.reason as string] ?? '보낼 수 없다.')
    }

    const doc = await tradesOf(gameId).add({
      fromTeam: pawn.team,
      toTeam,
      // **마주 선 그 사람에게만.** 팀의 아무나가 아니다
      toPlayerId,
      // 제안이 살아 있는 범위. 그 방을 뜨거나 페이즈가 바뀌면 죽는다
      tileId: pawn.tileId,
      epoch: tradeEpoch(game),
      give,
      want,
      givePurse,
      wantPurse,
      // 덧붙인 말은 판정에 쓰이지 않는다. 손으로 친 말은 세지 않는다
      note: typeof req.data.note === 'string' ? req.data.note.slice(0, 200) : '',
      byId: uid,
      createdAtMs: nowMs,
      status: 'open',
      accord: false,
    })
    await ref.collection('events').doc().set({
      atMs: nowMs,
      day: (await ref.get()).get('day'),
      kind: 'tradeProposed',
      team: pawn.team,
      playerId: uid,
      detail: { toTeam },
    })
    // 제안도 각자 몫으로 깎아 보내야 보인다. 이걸 빼먹으면 보낸
    // 사람조차 자기 제안을 못 본다
    await refreshViews(gameId)
    return { id: doc.id }
  },
)

export const respondTrade = onCall<{ gameId: string; tradeId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tradeId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  // 트랜잭션 밖에서 먼저 본다 — 안에서는 읽기 뒤에 쓸 수 없다
  const peek = await tradesOf(gameId).doc(tradeId).get()
  const accord =
    peek.exists && req.data.accept
      ? await takePending(gameId, (peek.data() as { fromTeam: TeamId }).fromTeam, 'accord')
      : false

  return db.runTransaction(async (tx) => {
    const tradeRef = tradesOf(gameId).doc(tradeId)
    const snap = await tx.get(tradeRef)
    if (!snap.exists) throw new HttpsError('not-found', '그런 제안이 없다.')
    const t = snap.data() as TradeOffer & {
      toTeam: TeamId
      fromTeam: TeamId
      toPlayerId?: string
      tileId?: string
      epoch?: string
      status: string
      byId: string
      givePurse?: Partial<Purse>
      wantPurse?: Partial<Purse>
    }
    if (t.status !== 'open') throw new HttpsError('failed-precondition', '이미 끝난 제안이다.')
    refuseIfInvisible(game.invisibleId, uid, t.byId, '거래할')
    // **마주 선 그 사람에게만 온 말이다.** 팀의 아무나가 받을 수 없다
    if (t.toPlayerId && t.toPlayerId !== uid) {
      throw new HttpsError('permission-denied', '나에게 온 제안이 아니다.')
    }
    if (!t.toPlayerId && t.toTeam !== pawn.team) {
      throw new HttpsError('permission-denied', '우리에게 온 제안이 아니다.')
    }
    // **자리를 뜨거나 페이즈가 바뀌면 그 말은 사라진 것이다.**
    // 따로 쓸어 담지 않는다 — 여기서 견주면 저절로 죽는다
    if (t.epoch && t.epoch !== tradeEpoch(game)) {
      throw new HttpsError('failed-precondition', '그 말은 이미 지나갔다.')
    }
    if (t.tileId && pawn.tileId !== t.tileId) {
      throw new HttpsError('failed-precondition', '그 자리를 떴다.')
    }

    if (!req.data.accept) {
      tx.update(tradeRef, { status: 'declined', closedAtMs: nowMs })
      tx.set(ref.collection('events').doc(), {
        atMs: nowMs,
        day: game.day,
        kind: 'tradeDeclined',
        team: pawn.team,
        detail: { fromTeam: t.fromTeam },
      })
      return { accepted: false, offerer: '', fromTeam: t.fromTeam, moved: [] as RobotMove[] }
    }

    const offerer = t.byId as string
    // 말을 꺼낸 쪽도 아직 거기 있어야 한다. 한 사람만 남은 자리에서
    // 성립하면 「마주 서서 주고받는다」가 아니게 된다
    const offererPawn = await tx.get(ref.collection('pawns').doc(offerer))
    if (!offererPawn.exists || (offererPawn.data() as PawnDoc).tileId !== pawn.tileId) {
      throw new HttpsError('failed-precondition', '상대가 그 자리를 떴다.')
    }
    const [fromSnap, toSnap, mineSnap, theirsSnap, mineBots, theirBots] = await Promise.all([
      tx.get(ref.collection('teams').doc(t.fromTeam)),
      tx.get(ref.collection('teams').doc(t.toTeam)),
      tx.get(ref.collection('pawns').doc(offerer)),
      tx.get(ref.collection('pawns').doc(uid)),
      tx.get(ref.collection('robots').where('carriedBy', '==', offerer)),
      tx.get(ref.collection('robots').where('carriedBy', '==', uid)),
    ])
    const from = fromSnap.data() as TeamDoc
    const to = toSnap.data() as TeamDoc

    // 협정서가 붙어 있으면 양쪽이 돈을 더 받는다. 보낸 쪽이 낸 카드다
    const out = acceptTrade({ ...t, accord }, from.resources, to.resources)
    if (!out.ok) {
      throw new HttpsError(
        'failed-precondition',
        out.reason === 'senderShort' ? '보낸 쪽 자원이 모자라다.' : '우리 자원이 모자라다.',
      )
    }

    // 토큰과 로봇은 사람끼리 오간다. **마주 서 있어야 한다** — 제안할
    // 때 마주 섰어도 답할 때 떨어져 있으면 손에서 손으로 건넬 수가 없다
    const givePurse = (t.givePurse ?? {}) as Partial<Purse>
    const wantPurse = (t.wantPurse ?? {}) as Partial<Purse>
    const personal =
      (givePurse.tokens ?? 0) + (givePurse.robots ?? 0) + (wantPurse.tokens ?? 0) + (wantPurse.robots ?? 0) > 0
    const mine = mineSnap.data() as PawnDoc | undefined
    const theirs = theirsSnap.data() as PawnDoc | undefined
    if (!mine || !theirs) throw new HttpsError('failed-precondition', '한쪽이 판에 없다.')
    if (personal && (mine.tileId === null || mine.tileId !== theirs.tileId)) {
      throw new HttpsError('failed-precondition', '토큰과 로봇은 같은 방에서만 건넨다.')
    }

    const moved = movePurse(
      { tokens: mine.tokens ?? 0, robots: mineBots.size },
      { tokens: theirs.tokens ?? 0, robots: theirBots.size },
      givePurse,
      wantPurse,
      // **값은 제안한 쪽이 낸다.** 거절당하면 안 낸다 — 제안만 뿌리고
      // 다니는 것을 막으려면 값이 제안 쪽에 붙되 성립할 때만이어야 한다
      TRADE_COST,
    )
    if (!moved.ok) {
      const why: Record<string, string> = {
        senderNoTokens: '보낸 쪽 토큰이 모자라다.',
        senderNoRobots: '보낸 쪽이 데리고 있는 로봇이 모자라다.',
        receiverNoTokens: '우리 토큰이 모자라다.',
        receiverNoRobots: '우리가 데리고 있는 로봇이 모자라다.',
      }
      throw new HttpsError('failed-precondition', why[moved.reason])
    }

    tx.update(ref.collection('teams').doc(t.fromTeam), { resources: out.fromResources })
    tx.update(ref.collection('teams').doc(t.toTeam), { resources: out.toResources })
    tx.update(mineSnap.ref, { tokens: moved.from.tokens })
    tx.update(theirsSnap.ref, { tokens: moved.to.tokens })
    // 로봇은 주인만 바뀐다. 팀도 함께 바뀐다 — 넘겨받은 로봇은 우리 머릿수다
    const handed: RobotMove[] = []
    for (const d of mineBots.docs.slice(0, givePurse.robots ?? 0)) {
      tx.update(d.ref, { carriedBy: uid, team: t.toTeam })
      handed.push({ robotId: d.id, fromId: offerer, fromTeam: t.fromTeam, toId: uid, toTeam: t.toTeam })
    }
    for (const d of theirBots.docs.slice(0, wantPurse.robots ?? 0)) {
      tx.update(d.ref, { carriedBy: offerer, team: t.fromTeam })
      handed.push({ robotId: d.id, fromId: uid, fromTeam: t.toTeam, toId: offerer, toTeam: t.fromTeam })
    }
    tx.update(tradeRef, { status: 'accepted', closedAtMs: nowMs })
    // 기록에 쓸 이름들을 밖으로 들고 나간다 — 트랜잭션 안에서 쓰면
    // 재시도될 때마다 같은 줄이 두 번 적힌다
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'tradeAccepted',
      team: pawn.team,
      detail: { fromTeam: t.fromTeam, give: t.give, want: t.want, accord },
    })
    return { accepted: true, offerer, fromTeam: t.fromTeam, moved: handed }
  }).then(async (r) => {
    // 거래 한 줄. **개인 미션이 이것만 본다** — 「세 팀 모두와 한 번씩」도
    // 「다른 팀과 세 번」도 여기서 나온다. 양쪽을 한 줄에 적어 두면
    // 받기만 한 사람도 거래한 것으로 세어진다
    if (r.accepted) {
      await note(gameId, 'trade', nowMs, { id: r.offerer, team: r.fromTeam }, {
        otherId: uid,
        otherTeam: pawn.team,
        tileId: (pawn.tileId ?? null) as TileId | null,
      })
      // 로봇이 손을 바꿨으면 따로 한 줄. 심부름꾼의 「내가 만든 로봇이
      // 끝날 때 다른 팀 소유」가 이 줄들을 따라간다
      await noteAll(
        gameId,
        r.moved.map((m) => ({
          kind: 'robotOwner' as const,
          atMs: nowMs,
          actorId: m.toId,
          actorTeam: m.toTeam,
          otherId: m.fromId,
          otherTeam: m.fromTeam,
          subjectId: m.robotId,
        })),
      )
    }
    await refreshViews(gameId)
    return { accepted: r.accepted }
  })
})

// ── 동맹 ────────────────────────────────────────────────────────

export const proposeAlliance = onCall<{ gameId: string; withTeam: TeamId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, withTeam } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  if (!TEAMS.includes(withTeam)) throw new HttpsError('invalid-argument', '그런 팀은 없다.')
  await requireFacing(gameId, uid, withTeam, '동맹')
  const ref = gameRef(gameId)

  const [usSnap, themSnap] = await Promise.all([
    ref.collection('teams').doc(pawn.team).get(),
    ref.collection('teams').doc(withTeam).get(),
  ])
  const us = usSnap.data() as TeamDoc
  const them = themSnap.data() as TeamDoc

  const out = canAlly({
    us: { allyTeam: us.allyTeam, lockUntilRealMs: us.allianceLockUntilRealMs ?? null },
    them: { allyTeam: them.allyTeam, lockUntilRealMs: them.allianceLockUntilRealMs ?? null },
    ourTeam: pawn.team,
    theirTeam: withTeam,
    realNowMs: Date.now(),
    lastHours: game.lastHours,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      ownTeam: '우리 팀이다.',
      alreadyAllied: '이미 동맹이 있다.',
      theyAreAllied: '그 팀은 이미 동맹이 있다.',
      locked: '아직 새 동맹을 맺을 수 없다.',
      lastHours: '마지막 여섯 시간에는 못 맺는다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '맺을 수 없다.')
  }

  // 상대가 받아들여야 성립한다. 한쪽이 누른다고 되지 않는다
  const doc = await proposalsOf(gameId).add({
    fromTeam: pawn.team,
    toTeam: withTeam,
    byId: uid,
    createdAtMs: nowMs,
    status: 'open',
  })
  await refreshViews(gameId)
  return { id: doc.id }
})

export const respondAlliance = onCall<{ gameId: string; proposalId: string; accept: boolean }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, proposalId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  const result = await db.runTransaction(async (tx) => {
    const propRef = proposalsOf(gameId).doc(proposalId)
    const snap = await tx.get(propRef)
    if (!snap.exists) throw new HttpsError('not-found', '그런 제안이 없다.')
    const p = snap.data() as { fromTeam: TeamId; toTeam: TeamId; status: string }
    if (p.status !== 'open') throw new HttpsError('failed-precondition', '이미 끝난 제안이다.')
    if (p.toTeam !== pawn.team) throw new HttpsError('permission-denied', '우리에게 온 제안이 아니다.')

    if (!req.data.accept) {
      tx.update(propRef, { status: 'declined', closedAtMs: nowMs })
      return { allied: false }
    }

    const [usSnap, themSnap] = await Promise.all([
      tx.get(ref.collection('teams').doc(p.toTeam)),
      tx.get(ref.collection('teams').doc(p.fromTeam)),
    ])
    const us = usSnap.data() as TeamDoc
    const them = themSnap.data() as TeamDoc

    // 제안한 뒤에 상황이 바뀌었을 수 있다. 여기서 다시 본다
    const ok = canAlly({
      us: { allyTeam: us.allyTeam, lockUntilRealMs: us.allianceLockUntilRealMs ?? null },
      them: { allyTeam: them.allyTeam, lockUntilRealMs: them.allianceLockUntilRealMs ?? null },
      ourTeam: p.toTeam,
      theirTeam: p.fromTeam,
      realNowMs: Date.now(),
      lastHours: game.lastHours,
    })
    if (!ok.ok) throw new HttpsError('failed-precondition', '지금은 맺을 수 없다.')

    tx.update(ref.collection('teams').doc(p.toTeam), { allyTeam: p.fromTeam })
    tx.update(ref.collection('teams').doc(p.fromTeam), { allyTeam: p.toTeam })
    tx.update(propRef, { status: 'accepted', closedAtMs: nowMs })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'allianceFormed',
      team: p.toTeam,
      detail: { with: p.fromTeam },
    })
    return { allied: true, with: p.fromTeam }
  })
  await refreshViews(gameId)
  return result
})

/** 먼저 깬다. 열두 시간 동안 새 동맹을 못 맺는다. */
export const breakAllianceNow = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const { game, nowMs } = await freshNow(gameId)
  const pawn = await myPawn(gameId, uid)
  const ref = gameRef(gameId)

  const result = await db.runTransaction(async (tx) => {
    const usRef = ref.collection('teams').doc(pawn.team)
    const usSnap = await tx.get(usRef)
    const us = usSnap.data() as TeamDoc
    if (!us.allyTeam) throw new HttpsError('failed-precondition', '동맹이 없다.')
    const themRef = ref.collection('teams').doc(us.allyTeam)
    const themSnap = await tx.get(themRef)
    const them = themSnap.data() as TeamDoc

    const out = breakAlliance(Date.now())
    tx.update(usRef, {
      allyTeam: null,
      allianceLockUntilRealMs: out.breaker.lockUntilRealMs,
    })
    // 당한 쪽은 아무것도 잃지 않고 잠기지도 않는다
    tx.update(themRef, { allyTeam: null })
    tx.set(ref.collection('events').doc(), {
      atMs: nowMs,
      day: game.day,
      kind: 'allianceBroken',
      team: pawn.team,
      detail: { with: us.allyTeam },
    })
    return { broke: us.allyTeam, theirResources: them.resources }
  })
  await refreshViews(gameId)
  return { broke: result.broke }
})
