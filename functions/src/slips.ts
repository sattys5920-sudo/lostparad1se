// 쪽지 — 바닥에 떨어진 종이 한 장을 줍고, 읽고, 처리한다.
//
// **적힌 것은 끝까지 secret 아래에만 둔다.** 바닥에 놓인 쪽지는 그 방에
// 선 사람에게 「한 장 있다」까지만 보이고, 문장은 주워서 읽은 사람에게만
// 간다. 문서를 통째로 내려보내고 화면에서 가리면 개발자도구로 다 보인다.
//
// 처리는 셋이다.
//
//   찢기    영영 사라진다. 내 비밀이 적힌 쪽지를 주웠을 때 할 일이다
//   두기    선 방에 놓는다. 다음에 그 방에 온 사람이 줍는다
//   건네기  마주 선 사람에게 준다. 값을 부르려면 교역에 실어 보낸다(deal.ts)
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { SLIPS_ON_FLOOR_MAX, SLIPS_PER_PHASE } from '../../shared/reveal/slips'
import { SLIP_TEXTS } from './story/slips'
import { TILES, type TileId } from '../../shared/rules/board'
import { rngFrom } from '../../shared/missions/assign'
import type { GameDoc, PawnDoc } from '../../shared/model'
import { freshNow, refuseIfInvisible } from './turn'
import { note } from './records'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/**
 * 쪽지 한 장. **secret 아래에 있다.**
 *
 * 바닥에 있으면 tileId 가 차고, 누가 들고 있으면 heldBy 가 찬다.
 * 둘 다 null 인 쪽지는 찢긴 것이다 — 지우지 않고 남겨 둔다. 누가
 * 무엇을 없앴는지가 나중에 이야기가 된다.
 */
export interface SlipDoc {
  textId: string
  /**
   * 운영자가 손으로 쓴 글. 있으면 이것이 문장이다(drop.ts).
   *
   * 뿌려지는 쪽지는 textId 로 서버 전용 표를 가리킨다. 운영자 메모는
   * 가리킬 표가 없어서 글을 그대로 담는다 — **그래도 secret 아래다.**
   * 주워서 읽은 사람에게만 간다는 규칙은 똑같다.
   */
  text?: string
  /** 누구의 비밀인가. 뿌려질 때 정해진다. 운영자 메모는 비어 있다. */
  subjectId: string
  tileId: TileId | null
  heldBy: string | null
  /** 한 번이라도 읽은 사람들. 넘겨줘도 읽은 것은 안 잊는다. */
  readBy: string[]
  tornBy: string | null
  /**
   * 찢긴 방. **조각은 그 자리에 남는다.**
   *
   * 찢으면 종이가 세상에서 사라지는 것이 아니라 조각이 된다.
   * 테이프를 가진 사람이 같은 방에 오면 붙일 수 있다(use.ts) —
   * 「영영」에 값이 붙은 예외를 하나 두는 것이다.
   */
  tornAt?: TileId | null
  atMs: number
}

const slipsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('slips').collection('items')

/** 쪽지가 떨어질 수 있는 방. 기지와 핵심 지역은 뺀다. */
const DROP_TILES: TileId[] = TILES.filter((t) => t.tier !== 'core' && t.tier !== 'plaza').map(
  (t) => t.id,
)

/**
 * 쪽지를 뿌린다. 페이즈가 닫힐 때 서버가 부른다.
 *
 * 같은 씨앗이면 같은 결과가 나오게 판 아이디와 페이즈 번호로 뽑는다 —
 * 다시 돌려 봐야 할 때 같은 판이 나와야 한다.
 */
export async function scatterSlips(gameId: string, phaseNo: number, nowMs: number): Promise<number> {
  const [seats, onFloor] = await Promise.all([
    gameRef(gameId).get(),
    slipsOf(gameId).where('tileId', '!=', null).get(),
  ])
  const game = seats.data() as GameDoc
  const room = Math.max(0, SLIPS_ON_FLOOR_MAX - onFloor.size)
  const howMany = Math.min(SLIPS_PER_PHASE, room)
  if (howMany === 0 || game.seats.length === 0) return 0

  const rng = rngFrom(`${gameId}:slips:${phaseNo}`)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T

  const batch = db.batch()
  for (let i = 0; i < howMany; i++) {
    const doc: SlipDoc = {
      textId: pick(SLIP_TEXTS).id,
      subjectId: pick(game.seats).playerId,
      tileId: pick(DROP_TILES),
      heldBy: null,
      readBy: [],
      tornBy: null,
      tornAt: null,
      atMs: nowMs,
    }
    batch.set(slipsOf(gameId).doc(), doc)
  }
  await batch.commit()
  return howMany
}

/** 지금 내가 선 방. 걷는 중이면 null 이다. */
async function whereAmI(gameId: string, uid: string): Promise<TileId | null> {
  return (await me(gameId, uid)).tileId
}

/** 나. 기록에 팀이 들어가므로 자리와 팀을 같이 가져온다. */
async function me(gameId: string, uid: string): Promise<{ tileId: TileId | null; team: PawnDoc['team'] }> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  const p = snap.data() as PawnDoc
  return { tileId: (p.tileId ?? null) as TileId | null, team: p.team }
}

/** 바닥에서 줍는다. **그 방에 서 있어야 한다.** */
export const takeSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, slipId } = req.data
  const here = await whereAmI(gameId, uid)
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')
  const { nowMs } = await freshNow(gameId)

  let subject = ''
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    const s = snap.data() as SlipDoc
    // 먼저 주운 사람만 가진다. 둘이 같은 쪽지를 노리면 여기서 갈린다
    if (s.tileId !== here) throw new HttpsError('failed-precondition', '여기 없는 쪽지다.')
    tx.update(ref, { tileId: null, heldBy: uid })
    subject = s.subjectId
  })
  await note(gameId, 'slipTake', nowMs, { id: uid, team: (await me(gameId, uid)).team }, {
    tileId: here,
    subjectId: slipId,
    ownerId: subject,
  })
  await refreshViews(gameId)
  return { slipId }
})

/**
 * 읽는다. 들고 있어야 하고, **읽은 것은 기록에 남는다.**
 *
 * 넘겨주고 나서도 읽었다는 사실은 안 사라진다. 쪽지를 돌려도 이미
 * 아는 사람은 계속 아는 것이 맞다.
 */
export const readSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, slipId } = req.data
  const { nowMs } = await freshNow(gameId)
  let first = false
  let subject = ''
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    const s = snap.data() as SlipDoc
    if (s.heldBy !== uid) throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    if (s.readBy.includes(uid)) return
    tx.update(ref, { readBy: [...s.readBy, uid] })
    first = true
    subject = s.subjectId
  })
  // 두 번째부터는 안 적는다. 「세 장을 읽는다」가 한 장을 세 번 읽어서
  // 채워지면 안 된다
  if (first) {
    await note(gameId, 'slipRead', nowMs, { id: uid, team: (await me(gameId, uid)).team }, {
      subjectId: slipId,
      ownerId: subject,
    })
  }
  await refreshViews(gameId)
  return { slipId }
})

/** 선 방에 두고 간다. 다음에 그 방에 온 사람이 줍는다. */
export const dropSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, slipId } = req.data
  const here = await whereAmI(gameId, uid)
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')

  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    if ((snap.data() as SlipDoc).heldBy !== uid) {
      throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    }
    tx.update(ref, { tileId: here, heldBy: null })
  })
  await refreshViews(gameId)
  return { tileId: here }
})

/** 찢는다. **영영 사라진다.** 내 비밀이 적힌 쪽지를 주웠을 때 할 일이다. */
export const tearSlip = onCall<{ gameId: string; slipId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, slipId } = req.data
  const { nowMs } = await freshNow(gameId)
  // **선 자리를 적어야 조각이 남는다.** 줍기·두기·건네기가 모두
  // 서 있기를 요구하는데 찢기만 걷는 중에도 됐다 — 여기서 맞춘다
  const here = await whereAmI(gameId, uid)
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')
  let subject = ''
  await db.runTransaction(async (tx) => {
    const ref = slipsOf(gameId).doc(slipId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    if ((snap.data() as SlipDoc).heldBy !== uid) {
      throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    }
    // 문서를 지우지 않는다. 누가 무엇을 없앴는지가 나중에 이야기가 된다.
    // 조각은 찢은 방에 남는다 — tileId 는 비운다(바닥의 「한 장」에
    // 안 세야 한다). 조각은 tornAt 으로 따로 센다
    tx.update(ref, { tileId: null, heldBy: null, tornBy: uid, tornAt: here, atMs: nowMs })
    subject = (snap.data() as SlipDoc).subjectId
  })
  // **누구의 쪽지를 찢었는지가 판정의 전부다.** 미화부의 「내 비밀이
  // 적힌 쪽지를 찾아 찢는다」가 ownerId 로 갈린다
  await note(gameId, 'slipTear', nowMs, { id: uid, team: (await me(gameId, uid)).team }, {
    subjectId: slipId,
    ownerId: subject,
  })
  await refreshViews(gameId)
  return { torn: true }
})

/**
 * 마주 선 사람에게 그냥 건넨다.
 *
 * 값을 부르려면 이것이 아니라 교역에 실어 보낸다(offerTrade). 여기서는
 * 대가 없이 넘기는 것만 한다 — 「그냥 가져가」가 있어야 협박이 협박이 된다.
 */
export const giveSlip = onCall<{ gameId: string; slipId: string; toPlayerId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, slipId, toPlayerId } = req.data
  if (toPlayerId === uid) throw new HttpsError('invalid-argument', '나에게는 못 건넨다.')
  const here = await whereAmI(gameId, uid)
  if (!here) throw new HttpsError('failed-precondition', '걷는 중이다.')
  // **두는 것은 되고 건네는 것은 안 된다.** 손에서 손으로 가는 일이라
  // 사람과 얽히는 행동이다 — 바닥에 두는 쪽이 유일한 통로로 남는다
  const { nowMs, game } = await freshNow(gameId)
  refuseIfInvisible(game.invisibleId, uid, toPlayerId, '건넬')

  let subject = ''
  let toTeam: PawnDoc['team'] = 'A'
  await db.runTransaction(async (tx) => {
    const slipRef = slipsOf(gameId).doc(slipId)
    const [snap, other] = await Promise.all([
      tx.get(slipRef),
      tx.get(gameRef(gameId).collection('pawns').doc(toPlayerId)),
    ])
    if (!snap.exists) throw new HttpsError('not-found', '그런 쪽지가 없다.')
    if ((snap.data() as SlipDoc).heldBy !== uid) {
      throw new HttpsError('permission-denied', '내가 들고 있는 쪽지가 아니다.')
    }
    if (!other.exists || (other.data() as PawnDoc).tileId !== here) {
      throw new HttpsError('failed-precondition', '같은 방에 있어야 건넨다.')
    }
    tx.update(slipRef, { heldBy: toPlayerId })
    subject = (snap.data() as SlipDoc).subjectId
    toTeam = (other.data() as PawnDoc).team
  })
  await note(gameId, 'slipGive', nowMs, { id: uid, team: (await me(gameId, uid)).team }, {
    otherId: toPlayerId,
    otherTeam: toTeam,
    tileId: here,
    subjectId: slipId,
    ownerId: subject,
  })
  await refreshViews(gameId)
  return { toPlayerId }
})
