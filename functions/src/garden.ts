// 화분 — 씨앗을 집고, 심고, 기다리고, 딴다.
//
// 정원에 화분 여덟과 씨앗 상자 하나가 있다. 상자는 입구에, 화분은
// 안쪽에 있어서 씨앗을 집고 걸어 들어가는 것이 한 번의 일이 된다.
//
// ## 무엇이 자랄지는 아무도 모른다
//
// 심는 순간 서버가 작물과 자랄 시간을 뽑는다. **둘 다 안 보낸다** —
// 흙만 보이는 동안에는 심은 사람도 무엇을 심었는지 모르고, 언제
// 열매가 될지는 끝까지 모른다. 알 수 있으면 화분 앞에 설 이유가
// 없어지고, 그러면 정원에 오갈 이유도 없어진다.
//
// 싹이 나면 이름이 보인다(nameShows). 그때부터는 그 방에 선 사람
// 누구에게나 보인다 — 화분은 방 안에 놓인 물건이지 내 주머니가 아니다.
//
// ## 딴 사람이 가진다
//
// 심은 사람만 딸 수 있게 두지 않았다. 정원은 아무도 차지할 수 없는
// 방이고 화분은 거기 놓여 있다 — 열매가 달린 것을 보고도 못 따면
// 그건 남의 밭이지 학교 정원이 아니다. 대신 **싹이 나야 이름이
// 보이므로**, 무엇을 노리고 지킬지는 그때부터의 일이다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  CROP_BY_ID,
  GARDEN_TILE,
  HARVEST_LIMIT,
  POT_CELLS,
  SEED_BOX_CELL,
  SEED_LIMIT,
  growHoursOf,
  nameShows,
  pickCrop,
  stageOf,
  type PotStage,
} from '../../shared/rules/crop'
import type { Cell, TileId } from '../../shared/rules/board'
import type { PawnDoc } from '../../shared/model'
import { freshNow, myPawn } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const potsOf = (gameId: string) => gameRef(gameId).collection('pots')
/** 판 전체에서 무엇이 몇 번 나왔나. **「그 애가 심은 것」을 세는 자리다.** */
const tallyRef = (gameId: string) => gameRef(gameId).collection('secret').doc('garden')

const HOUR_MS = 3_600_000

/** 화분 한 자리. 비어 있으면 cropId 가 null 이다. */
export interface PotDoc {
  cropId: string | null
  /** 심은 사람. **어느 몫에도 안 실린다** — 누가 심었는지는 보이지 않는다. */
  byPlayerId: string | null
  plantedMs: number | null
  /** 뽑아 둔 자랄 시간. 이것도 안 실린다 */
  growMs: number | null
  /** 「그 애가 심은 것」 알림을 이미 냈는가. */
  toldHers: boolean
}

const EMPTY_POT: PotDoc = { cropId: null, byPlayerId: null, plantedMs: null, growMs: null, toldHers: false }

/** 지금 그 화분이 어느 단계인가. **시간만 본다.** */
export function stageNow(pot: PotDoc, nowMs: number): PotStage {
  if (pot.cropId === null || pot.plantedMs === null || pot.growMs === null) return 'empty'
  const spec = CROP_BY_ID[pot.cropId]
  if (!spec) return 'empty'
  const grown = Math.max(0, nowMs - pot.plantedMs)
  const sinceFruit = Math.max(0, grown - pot.growMs)
  return stageOf(grown, pot.growMs, sinceFruit, spec.witherHours * HOUR_MS)
}

/**
 * 씨앗 하나로 뽑는 값. **같은 씨앗이면 같은 값이다.**
 *
 * 판 아이디와 화분 번호와 심은 시각을 섞는다 — 다시 돌려 보면 같은
 * 것이 나오고, 옆 화분과는 다르다.
 */
function rollOf(seed: string, salt: number): number {
  let n = 2166136261
  for (const ch of `${seed}:${salt}`) {
    n ^= ch.charCodeAt(0)
    n = Math.imul(n, 16777619)
  }
  return ((n >>> 0) % 100_000) / 100_000
}

const near = (a: Cell | null | undefined, b: Cell): boolean =>
  a != null && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1

/** 정원에 서 있는가. 방까지만 본다 — 자리는 각 단추가 따로 잰다 */
function requireGarden(p: PawnDoc): void {
  if (p.tileId !== (GARDEN_TILE as TileId)) throw new HttpsError('failed-precondition', '정원에 가야 있다.')
}

/** 판을 차릴 때 화분 여덟을 놓는다. 비어 있는 채로 시작한다. */
export async function seedGarden(gameId: string): Promise<void> {
  const batch = db.batch()
  for (let i = 0; i < POT_CELLS.length; i++) batch.set(potsOf(gameId).doc(String(i)), EMPTY_POT)
  batch.set(tallyRef(gameId), { used: {} })
  await batch.commit()
}

/**
 * 싹이 난 「그 애가 심은 것」을 알린다. **그 방에 선 사람에게만.**
 *
 * 시드는 것은 여기서 안 건드린다 — 시간으로 계산하면 나오는 값이라
 * 문서를 고칠 일이 없다. 화분을 비우는 것은 사람이 한다(치우기).
 */
export async function sweepGarden(gameId: string, nowMs: number): Promise<boolean> {
  const snap = await potsOf(gameId).where('toldHers', '==', false).get()
  const hers = snap.docs.filter((d) => {
    const pot = d.data() as PotDoc
    return pot.cropId === 'hers' && nameShows(stageNow(pot, nowMs))
  })
  if (hers.length === 0) return false

  const pawns = await gameRef(gameId).collection('pawns').get()
  const here = pawns.docs.filter((d) => (d.data() as PawnDoc).tileId === (GARDEN_TILE as TileId))
  const batch = db.batch()
  for (const d of hers) {
    batch.update(d.ref, { toldHers: true })
    for (const p of here) {
      batch.set(gameRef(gameId).collection('notices').doc(), {
        toPlayerId: p.id,
        text: `화분 하나에 못 보던 싹이 났다. ${CROP_BY_ID.hers.name}이다.`,
        atMs: nowMs,
      })
    }
  }
  await batch.commit()
  return true
}

// ── 사람 ────────────────────────────────────────────────────────

/** 씨앗 상자에서 하나 집는다. 값은 없다. */
export const takeSeed = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  await freshNow(gameId)
  const p = await myPawn(gameId, uid)
  requireGarden(p)
  if (!near((p.at ?? null) as Cell | null, SEED_BOX_CELL)) {
    throw new HttpsError('failed-precondition', '씨앗 상자 앞에 서야 집는다.')
  }
  if ((p.seeds ?? 0) >= SEED_LIMIT) {
    throw new HttpsError('failed-precondition', `씨앗은 ${SEED_LIMIT}개까지 쥔다.`)
  }
  await gameRef(gameId).collection('pawns').doc(uid).update({ seeds: FieldValue.increment(1) })
  await refreshViews(gameId)
  return { seeds: (p.seeds ?? 0) + 1 }
})

/**
 * 빈 화분에 씨앗을 심는다.
 *
 * **무엇이 될지는 여기서 정해지고 아무에게도 안 간다.** 뽑기는
 * 트랜잭션 안에서 한다 — 둘이 같은 화분을 동시에 누르면 하나만 심긴다.
 */
export const plantSeed = onCall<{ gameId: string; pot: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const i = Math.floor(Number(req.data.pot))
  if (!Number.isFinite(i) || i < 0 || i >= POT_CELLS.length) {
    throw new HttpsError('invalid-argument', '그런 화분이 없다.')
  }
  const { nowMs } = await freshNow(gameId)
  const p = await myPawn(gameId, uid)
  requireGarden(p)
  if (!near((p.at ?? null) as Cell | null, POT_CELLS[i])) {
    throw new HttpsError('failed-precondition', '그 화분 앞에 서야 심는다.')
  }
  if ((p.seeds ?? 0) < 1) throw new HttpsError('failed-precondition', '씨앗이 없다. 상자에서 집어 온다.')

  await db.runTransaction(async (tx) => {
    const ref = potsOf(gameId).doc(String(i))
    const mine = gameRef(gameId).collection('pawns').doc(uid)
    const [potSnap, tallySnap, pawnSnap] = await Promise.all([tx.get(ref), tx.get(tallyRef(gameId)), tx.get(mine)])
    const pot = (potSnap.data() as PotDoc | undefined) ?? EMPTY_POT
    if (stageNow(pot, nowMs) !== 'empty') throw new HttpsError('failed-precondition', '이미 무언가 심겨 있다.')
    if (((pawnSnap.data() as PawnDoc | undefined)?.seeds ?? 0) < 1) {
      throw new HttpsError('failed-precondition', '씨앗이 없다.')
    }
    const used = ((tallySnap.data() as { used?: Record<string, number> } | undefined)?.used ?? {}) as Record<
      string,
      number
    >
    const seed = `${gameId}:${i}:${nowMs}`
    const spec = pickCrop(rollOf(seed, 1), used)
    const growMs = growHoursOf(spec, rollOf(seed, 2)) * HOUR_MS
    tx.set(ref, { cropId: spec.id, byPlayerId: uid, plantedMs: nowMs, growMs, toldHers: false })
    tx.set(tallyRef(gameId), { used: { ...used, [spec.id]: (used[spec.id] ?? 0) + 1 } })
    tx.update(mine, { seeds: FieldValue.increment(-1) })
  })
  await refreshViews(gameId)
  // **무엇을 심었는지는 안 돌려준다.** 흙을 보고 기다리는 것이 이 일이다
  return { planted: i }
})

/** 열매를 딴다. **딴 사람이 가진다** — 심은 사람인지는 안 본다. */
export const harvestPot = onCall<{ gameId: string; pot: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const i = Math.floor(Number(req.data.pot))
  if (!Number.isFinite(i) || i < 0 || i >= POT_CELLS.length) {
    throw new HttpsError('invalid-argument', '그런 화분이 없다.')
  }
  const { nowMs } = await freshNow(gameId)
  const p = await myPawn(gameId, uid)
  requireGarden(p)
  if (!near((p.at ?? null) as Cell | null, POT_CELLS[i])) {
    throw new HttpsError('failed-precondition', '그 화분 앞에 서야 딴다.')
  }

  let got = ''
  await db.runTransaction(async (tx) => {
    const ref = potsOf(gameId).doc(String(i))
    const mine = gameRef(gameId).collection('pawns').doc(uid)
    const [potSnap, pawnSnap] = await Promise.all([tx.get(ref), tx.get(mine)])
    const pot = (potSnap.data() as PotDoc | undefined) ?? EMPTY_POT
    const stage = stageNow(pot, nowMs)
    if (stage === 'withered') throw new HttpsError('failed-precondition', '시들었다. 치우고 다시 심는다.')
    if (stage !== 'fruit') throw new HttpsError('failed-precondition', '아직 열매가 아니다.')
    const bag = ((pawnSnap.data() as PawnDoc | undefined)?.crops ?? {}) as Record<string, number>
    const held = Object.values(bag).reduce((a, n) => a + n, 0)
    if (held >= HARVEST_LIMIT) {
      throw new HttpsError('failed-precondition', `${HARVEST_LIMIT}개까지만 들고 다닌다.`)
    }
    const cropId = pot.cropId as string
    got = CROP_BY_ID[cropId]?.name ?? cropId
    tx.set(ref, EMPTY_POT)
    tx.update(mine, { [`crops.${cropId}`]: FieldValue.increment(1) })
  })
  await refreshViews(gameId)
  return { got }
})

/** 시든 것을 치운다. 비워야 다음 씨앗이 들어간다. */
export const clearPot = onCall<{ gameId: string; pot: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const i = Math.floor(Number(req.data.pot))
  if (!Number.isFinite(i) || i < 0 || i >= POT_CELLS.length) {
    throw new HttpsError('invalid-argument', '그런 화분이 없다.')
  }
  const { nowMs } = await freshNow(gameId)
  const p = await myPawn(gameId, uid)
  requireGarden(p)
  if (!near((p.at ?? null) as Cell | null, POT_CELLS[i])) {
    throw new HttpsError('failed-precondition', '그 화분 앞에 서야 치운다.')
  }
  const ref = potsOf(gameId).doc(String(i))
  const pot = ((await ref.get()).data() as PotDoc | undefined) ?? EMPTY_POT
  if (stageNow(pot, nowMs) !== 'withered') throw new HttpsError('failed-precondition', '치울 것이 없다.')
  await ref.set(EMPTY_POT)
  await refreshViews(gameId)
  return { cleared: i }
})

/** 투영이 읽어 가는 화분 여덟. **단계까지만 나간다.** */
export async function gardenWorld(gameId: string): Promise<{ pots: (PotDoc & { i: number })[] }> {
  const snap = await potsOf(gameId).get()
  const pots = POT_CELLS.map((_, i) => {
    const d = snap.docs.find((x) => x.id === String(i))
    return { ...((d?.data() as PotDoc | undefined) ?? EMPTY_POT), i }
  })
  return { pots }
}
