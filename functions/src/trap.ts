// 덫 — 기술실 제조기.
//
// **규칙은 rules/trap 에, 판정은 여기에.** 맡기기와 찾기 두 문이고,
// 놓는 것은 useItem('trap') 이, 밟는 것은 standAt 이 한다 — 걸음이
// 오는 문이 거기라서다.
//
// 제조기 문서는 **번호가 곧 아이디다**(jobs/0·1·2). 한 제조기에 한
// 건 — 문서가 있으면 돌고 있는 것이고, 없으면 빈 것이다. 동시에 둘이
// 맡기면 트랜잭션이 한쪽을 거절한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { putItem, type Satchel } from '../../shared/rules/items'
import { MAKERS, TECH_TILE, TRAP_MAKE_MINUTES, TRAP_TOKEN_COST, beside, trapsPerToken } from '../../shared/rules/trap'
import type { Cell } from '../../shared/rules/board'
import type { PawnDoc, TeamDoc, TileDoc } from '../../shared/model'
import type { TeamId } from '../../shared/rules/v2'
import { freshNow } from './turn'
import { refreshViews } from './views'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 제조기에 걸린 한 건. 찾으면 문서가 사라진다. */
export interface TrapJobDoc {
  team: TeamId
  byPlayerId: string
  /** 나올 덫 수. 맡길 때 정해진다 — 그 뒤 기술실 주인이 바뀌어도 그대로 */
  count: number
  readyAtMs: number
  phaseNo: number
  atMs: number
}

/** 복도에 놓인 덫. **어떤 투영에도 안 실린다.** */
export interface TrapSetDoc {
  x: number
  y: number
  team: TeamId
  byPlayerId: string
  atMs: number
}

const jobsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('traps').collection('jobs')
export const trapsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('traps').collection('set')

async function myPawn(gameId: string, uid: string): Promise<PawnDoc> {
  const snap = await gameRef(gameId).collection('pawns').doc(uid).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '이 판에 없는 사람이다.')
  return snap.data() as PawnDoc
}

/** 기술실 안, 그 제조기 옆에 서 있어야 한다. 화면이 보내는 번호를 믿지 않는다 */
function mustBeAtMaker(pawn: PawnDoc, maker: number): void {
  const spot = MAKERS[maker]
  if (!spot) throw new HttpsError('invalid-argument', '그런 제조기는 없다.')
  if (pawn.tileId !== TECH_TILE) throw new HttpsError('failed-precondition', '기술실에서만 만든다.')
  if (!beside((pawn.at ?? null) as Cell | null, spot.cell)) {
    throw new HttpsError('failed-precondition', '제조기 옆에 서야 한다.')
  }
}

/**
 * 맡긴다. 팀 토큰 1 — 기술실을 쥔 팀이면 2개, 아니면 1개가 나온다.
 *
 * **토큰을 빼는 것과 건을 거는 것이 한 트랜잭션이다.** 둘이 같은
 * 제조기에 동시에 맡기면 한쪽만 걸리고 한쪽만 낸다.
 */
export const commissionTrap = onCall<{ gameId: string; maker: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const maker = Math.floor(Number(req.data.maker))
  const { game, nowMs } = await freshNow(gameId)
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈에만 만들 수 있다.')
  const phaseNo = game.phaseNow.no

  const pawn = await myPawn(gameId, uid)
  mustBeAtMaker(pawn, maker)
  const team = pawn.team as TeamId

  const ref = gameRef(gameId)
  const jobRef = jobsOf(gameId).doc(String(maker))
  const teamRef = ref.collection('teams').doc(team)
  const techRef = ref.collection('tiles').doc(TECH_TILE)

  const count = await db.runTransaction(async (tx) => {
    const [job, teamSnap, tech] = await Promise.all([tx.get(jobRef), tx.get(teamRef), tx.get(techRef)])
    // 한 제조기에 한 건. 다 됐는데 안 찾아간 것도 자리를 차지한다
    if (job.exists) throw new HttpsError('failed-precondition', '이 제조기는 돌고 있다.')
    const held = (teamSnap.data() as TeamDoc).phaseTokens ?? 0
    if (held < TRAP_TOKEN_COST) throw new HttpsError('failed-precondition', '팀 토큰이 모자라다.')
    const ownsTech = ((tech.data() as TileDoc | undefined)?.ownerTeam ?? null) === team
    const n = trapsPerToken(ownsTech)
    tx.update(teamRef, { phaseTokens: held - TRAP_TOKEN_COST })
    const doc: TrapJobDoc = {
      team,
      byPlayerId: uid,
      count: n,
      readyAtMs: nowMs + TRAP_MAKE_MINUTES * 60_000,
      phaseNo,
      atMs: nowMs,
    }
    tx.set(jobRef, doc)
    return n
  })
  await refreshViews(gameId)
  return { maker, count, readyAtMs: nowMs + TRAP_MAKE_MINUTES * 60_000 }
})

/** 찾는다. **맡긴 사람만**, 다 된 뒤에, 그 페이즈 안에. */
export const takeTrap = onCall<{ gameId: string; maker: number }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId } = req.data
  const maker = Math.floor(Number(req.data.maker))
  const { game, nowMs } = await freshNow(gameId)
  if (!game.phaseNow?.open) throw new HttpsError('failed-precondition', '페이즈가 닫혔다. 맡긴 것은 사라졌다.')

  const pawn = await myPawn(gameId, uid)
  mustBeAtMaker(pawn, maker)

  const jobRef = jobsOf(gameId).doc(String(maker))
  const meRef = gameRef(gameId).collection('pawns').doc(uid)
  const got = await db.runTransaction(async (tx) => {
    const [job, me] = await Promise.all([tx.get(jobRef), tx.get(meRef)])
    if (!job.exists) throw new HttpsError('failed-precondition', '이 제조기에는 맡긴 것이 없다.')
    const j = job.data() as TrapJobDoc
    // 남의 것은 있는지조차 같은 말로 막는다 — 누가 맡겼는지 안 새게
    if (j.byPlayerId !== uid) throw new HttpsError('failed-precondition', '네가 맡긴 것이 아니다.')
    if (j.phaseNo !== game.phaseNow?.no) throw new HttpsError('failed-precondition', '지난 페이즈 것이다. 사라졌다.')
    if (nowMs < j.readyAtMs) {
      const left = Math.ceil((j.readyAtMs - nowMs) / 60_000)
      throw new HttpsError('failed-precondition', `아직 만드는 중이다. ${left}분 남았다.`)
    }
    const bag = (me.data() as { items?: Satchel }).items
    tx.update(meRef, { items: putItem(bag, 'trap', j.count) })
    tx.delete(jobRef)
    return j.count
  })
  await refreshViews(gameId)
  return { maker, got }
})

/** 페이즈가 닫히면 안 찾아간 것은 사라진다. closePhase 가 부른다. */
export async function clearTrapJobs(gameId: string): Promise<number> {
  const snap = await jobsOf(gameId).get()
  if (snap.empty) return 0
  const batch = db.batch()
  for (const d of snap.docs) batch.delete(d.ref)
  await batch.commit()
  return snap.size
}

/** 투영이 들고 갈 제조기 상태. 덫 자체(set)는 여기 없다 — 아무에게도 안 간다 */
export async function trapWorld(gameId: string): Promise<{ jobs: (TrapJobDoc & { i: number })[] }> {
  const snap = await jobsOf(gameId).get()
  return { jobs: snap.docs.map((d) => ({ i: Number(d.id), ...(d.data() as TrapJobDoc) })) }
}

/**
 * 걸음이 지난 칸들 중 **다른 팀 덫**이 놓인 첫 칸. 없으면 null.
 *
 * standAt 이 부른다. 찾으면 그 덫을 지우고 그 칸을 돌려준다 — 걸린
 * 사람은 거기 선 것으로 적힌다. 우리 팀 덫은 그냥 지나간다.
 */
export async function springTrap(gameId: string, team: TeamId, path: readonly Cell[]): Promise<Cell | null> {
  if (path.length === 0) return null
  const snap = await trapsOf(gameId).get()
  if (snap.empty) return null
  const byCell = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  for (const d of snap.docs) {
    const t = d.data() as TrapSetDoc
    if (t.team !== team) byCell.set(`${t.x},${t.y}`, d)
  }
  for (const c of path) {
    const hit = byCell.get(`${c.x},${c.y}`)
    if (hit) {
      await hit.ref.delete()
      return { x: c.x, y: c.y }
    }
  }
  return null
}
