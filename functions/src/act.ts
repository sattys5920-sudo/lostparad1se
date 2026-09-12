// 토큰을 쓰는 행동 — 짓기 · 개조 · 연구 · 탐색 · 생산 · 견제.
//
// 다섯 가지가 매번 같은 순서로 확인된다.
//
//   1. 판을 따라잡는다
//   2. 발이 묶였는가
//   3. 서 있는 자리가 맞는가 (행동마다 다르다)
//   4. 토큰이 있는가 — 팀 상자와 그 사람 하루 몫을 둘 다 본다
//   5. 자원이 있는가
//
// 토큰은 **행동이 성립할 때** 뺀다. 자리가 틀렸거나 자원이 모자라면
// 아무것도 빠지지 않는다. 깃발만 다르다 — 그쪽은 꽂는 순간 토큰을
// 쓰고 자원은 성공할 때 낸다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import {
  ACTION_TOKEN_COST,
  PRODUCE_YIELD,
  SABOTAGE_COST,
  checkSabotage,
  checkStand,
  ownerLookup,
  researchCost,
  scoutAlreadyToday,
  scoutYield,
  type ActionKind,
} from '../../shared/rules/actions'
import { build, canPay, gain, pay, upgrade, type TileState } from '../../shared/rules/buildings'
import { spendToken } from '../../shared/rules/tokens'
import { rngFrom } from '../../shared/missions/assign'
import {
  SABOTAGE_REAL_HOURS,
  type BuildingKind,
  type Resource,
  type SabotageKind,
  type TeamId,
} from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import type { SabotageDoc, TeamDoc, TokenStateDoc } from '../../shared/model'
import { refreshViews } from './views'
import { drawForTeam, takePending } from './card'
import { freshNow, myPawn, requireAwake, tileStates } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()
const HOUR_MS = 3_600_000

const STAND_MESSAGE: Record<string, string> = {
  walking: '걷는 중이다.',
  notThere: '그 칸에 서 있어야 한다.',
  notOurTile: '우리 칸이 아니다.',
  notOurZone: '우리 땅에서만 할 수 있다.',
  ourTile: '우리 칸이다.',
  notEnemyTile: '남의 칸이 아니다.',
}

/**
 * 자리·규칙·토큰·자원을 한 번에 본다. 하나라도 어긋나면 아무것도 빠지지
 * 않는다.
 *
 * precheck는 **토큰을 세기 전에** 돈다. 순서가 중요하다 — 뒤에 두면
 * 「오늘 이미 뒤진 칸이다」를 말해야 할 자리에서 「토큰이 모자라다」가
 * 나온다. 거절 사유가 틀리면 플레이어는 엉뚱한 것을 고치려 든다.
 */
async function begin(
  gameId: string,
  uid: string,
  kind: ActionKind,
  targetTile: TileId,
  precheck?: (c: { day: number; team: TeamId; tiles: TileState[] }) => Promise<void> | void,
  /** 토큰을 몇 개 쓸 것인가. 급조처럼 공짜인 경우 0을 넘긴다. */
  tokenCost?: number,
): Promise<{
  nowMs: number
  day: number
  team: TeamId
  tiles: TileState[]
  teamDoc: TeamDoc
  box: TokenStateDoc
  spentBox: TokenStateDoc
}> {
  const { game, nowMs } = await freshNow(gameId)
  if (!TILE_BY_ID[targetTile]) throw new HttpsError('invalid-argument', '그런 칸은 없다.')

  const ref = gameRef(gameId)
  const pawn = await myPawn(gameId, uid)
  requireAwake(pawn, nowMs)

  const [tileSnap, teamSnap, boxSnap] = await Promise.all([
    ref.collection('tiles').get(),
    ref.collection('teams').doc(pawn.team).get(),
    ref.collection('secret').doc('tokens').collection('items').doc(pawn.team).get(),
  ])
  const tiles = tileStates(tileSnap.docs)
  const stand = checkStand({ kind, standingOn: pawn.tileId, targetTile, team: pawn.team, ownerOf: ownerLookup(tiles) })
  if (!stand.ok) throw new HttpsError('failed-precondition', STAND_MESSAGE[stand.reason as string] ?? '자리가 아니다.')

  if (precheck) await precheck({ day: game.day, team: pawn.team, tiles })

  const box = boxSnap.data() as TokenStateDoc
  const spent = spendToken(box, uid, tokenCost ?? ACTION_TOKEN_COST[kind])
  if (!spent.ok) {
    throw new HttpsError(
      'failed-precondition',
      spent.reason === 'playerDailyLimit' ? '오늘 쓸 수 있는 몫을 다 썼다.' : '토큰이 모자라다.',
    )
  }

  return {
    nowMs,
    day: game.day,
    team: pawn.team,
    tiles,
    teamDoc: teamSnap.data() as TeamDoc,
    box,
    spentBox: spent.state,
  }
}

/** 토큰과 자원을 함께 적고 기록을 남긴다. */
function commit(
  gameId: string,
  team: TeamId,
  spentBox: TokenStateDoc,
  resources: Record<Resource, number>,
  event: Record<string, unknown>,
): FirebaseFirestore.WriteBatch {
  const ref = gameRef(gameId)
  const batch = db.batch()
  batch.set(ref.collection('secret').doc('tokens').collection('items').doc(team), spentBox)
  batch.update(ref.collection('teams').doc(team), { tokens: spentBox.tokens, resources })
  batch.set(ref.collection('events').doc(), event)
  return batch
}

// ── 짓기와 개조 ─────────────────────────────────────────────────

export const buildOn = onCall<{ gameId: string; tileId: TileId; kind: BuildingKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId, kind } = req.data
  // 급조가 걸려 있으면 값이 절반이고 토큰이 들지 않는다. 짓기 전에 본다
  const quick = await takePending(gameId, (await myPawn(gameId, uid)).team, 'quickBuild')
  const c = await begin(gameId, uid, 'build', tileId, undefined, quick ? 0 : undefined)
  const tile = c.tiles.find((t) => t.tileId === tileId) as TileState

  const pawn = await myPawn(gameId, uid)
  const out = build({
    tile,
    team: c.team,
    kind,
    resources: c.teamDoc.resources,
    treasurer: pawn.title === 'treasurer',
    quickBuild: quick,
  })
  if (!out.ok) {
    const why: Record<string, string> = {
      baseTile: '기지에는 못 짓는다.',
      notOurTile: '우리 칸이 아니다.',
      alreadyHere: '이미 그 건물이 있다.',
      noSlot: '자리가 없다.',
      cannotAfford: '자원이 모자라다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '지을 수 없다.')
  }

  const batch = commit(gameId, c.team, c.spentBox, out.resources, {
    atMs: c.nowMs,
    day: c.day,
    kind: 'build',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { building: kind, cost: out.cost },
  })
  batch.update(gameRef(gameId).collection('tiles').doc(tileId), {
    buildings: [...tile.buildings, { kind, level: 1 }],
  })
  await batch.commit()
  await refreshViews(gameId)
  return { built: kind, cost: out.cost }
})

export const upgradeOn = onCall<{ gameId: string; tileId: TileId; kind: BuildingKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId, kind } = req.data
  const c = await begin(gameId, uid, 'build', tileId)
  const tile = c.tiles.find((t) => t.tileId === tileId) as TileState

  const pawn = await myPawn(gameId, uid)
  const out = upgrade({ tile, team: c.team, kind, resources: c.teamDoc.resources, treasurer: pawn.title === 'treasurer' })
  if (!out.ok) {
    const why: Record<string, string> = {
      notOurTile: '우리 칸이 아니다.',
      notBuilt: '그 건물이 없다.',
      maxLevel: '더 올릴 수 없다.',
      cannotAfford: '자원이 모자라다.',
    }
    throw new HttpsError('failed-precondition', why[out.reason as string] ?? '개조할 수 없다.')
  }

  const batch = commit(gameId, c.team, c.spentBox, out.resources, {
    atMs: c.nowMs,
    day: c.day,
    kind: 'upgrade',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { building: kind, cost: out.cost },
  })
  batch.update(gameRef(gameId).collection('tiles').doc(tileId), {
    buildings: tile.buildings.map((b) => (b.kind === kind ? { ...b, level: b.level + 1 } : b)),
  })
  await batch.commit()
  await refreshViews(gameId)
  return { upgraded: kind, cost: out.cost }
})

// ── 연구 ────────────────────────────────────────────────────────

/** 우리 땅 어디서나. 단계가 오를수록 비싸진다. */
export const research = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const c = await begin(gameId, uid, 'research', tileId)

  const cost = researchCost(c.teamDoc.researchTier)
  const left = pay(c.teamDoc.resources, cost)
  if (!left) throw new HttpsError('failed-precondition', '지식이 모자라다.')

  const tier = c.teamDoc.researchTier + 1
  const batch = commit(gameId, c.team, c.spentBox, left, {
    atMs: c.nowMs,
    day: c.day,
    kind: 'research',
    team: c.team,
    playerId: uid,
    detail: { tier, cost },
  })
  batch.update(gameRef(gameId).collection('teams').doc(c.team), { researchTier: tier })
  await batch.commit()
  // 연구는 카드 한 장을 준다. 손패가 차 있으면 그대로 사라진다
  const card = await drawForTeam(gameId, c.team, uid, c.day)
  await refreshViews(gameId)
  return { tier, cost, card }
})

// ── 탐색 ────────────────────────────────────────────────────────

/**
 * 남의 칸이나 빈 칸을 뒤진다.
 *
 * 무엇이 나오는지는 무작위지만 **씨앗이 팀·칸·날짜다.** 눌러 보고
 * 마음에 안 들어 다시 누르는 일이 없다 — 같은 칸 같은 날은 같은 답이고,
 * 애초에 하루 한 번뿐이다.
 */
export const scout = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const ref = gameRef(gameId)
  const c = await begin(gameId, uid, 'scout', tileId, async ({ day, team }) => {
    const doneSnap = await ref.collection('secret').doc('scouts').collection('items').get()
    const done = doneSnap.docs
      .map((d) => d.data() as { team: TeamId; tileId: TileId; day: number })
      .filter((d) => d.day === day)
    if (scoutAlreadyToday(done, team, tileId)) {
      throw new HttpsError('failed-precondition', '오늘 이미 뒤진 칸이다.')
    }
  })

  const got = scoutYield(rngFrom(`${gameId}:${c.team}:${tileId}:${c.day}`)())
  const batch = commit(gameId, c.team, c.spentBox, gain(c.teamDoc.resources, got), {
    atMs: c.nowMs,
    day: c.day,
    kind: 'scout',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { got },
  })
  batch.set(ref.collection('secret').doc('scouts').collection('items').doc(`${c.team}-${tileId}-${c.day}`), {
    team: c.team,
    tileId,
    day: c.day,
  })
  await batch.commit()
  await refreshViews(gameId)
  return { got }
})

// ── 생산 ────────────────────────────────────────────────────────

/** 우리 땅에서 돈을 만든다. 건물 생산과 달리 사람이 직접 한다. */
export const produce = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const c = await begin(gameId, uid, 'produce', tileId)

  const batch = commit(gameId, c.team, c.spentBox, gain(c.teamDoc.resources, PRODUCE_YIELD), {
    atMs: c.nowMs,
    day: c.day,
    kind: 'produce',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { got: PRODUCE_YIELD },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { got: PRODUCE_YIELD }
})

// ── 견제 ────────────────────────────────────────────────────────

/**
 * 남의 칸에 서서 그 팀을 방해한다. 영향력을 낸다.
 *
 * 걸린 견제는 공개다 — 누가 걸었는지까지 보인다. 익명이 아니다.
 */
export const sabotage = onCall<{ gameId: string; tileId: TileId; kind: SabotageKind }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId, kind } = req.data
  const c = await begin(gameId, uid, 'sabotage', tileId)

  const targetTeam = c.tiles.find((t) => t.tileId === tileId)?.ownerTeam
  if (!targetTeam) throw new HttpsError('failed-precondition', '주인 없는 칸이다.')

  const out = checkSabotage({ kind, targetTeam, team: c.team, resources: c.teamDoc.resources })
  if (!out.ok) {
    throw new HttpsError('failed-precondition', out.reason === 'ownTeam' ? '우리 팀이다.' : '영향력이 모자라다.')
  }
  if (!canPay(c.teamDoc.resources, SABOTAGE_COST)) {
    throw new HttpsError('failed-precondition', '영향력이 모자라다.')
  }

  const hours = SABOTAGE_REAL_HOURS[kind]
  const doc: SabotageDoc = {
    kind,
    fromTeam: c.team,
    targetTeam,
    // 생산 감소만 시간이 아니라 「다음 정산 한 번」이다
    expiresRealMs: hours === 'nextSettlement' ? null : Date.now() + hours * HOUR_MS,
    consumed: false,
  }
  const batch = commit(gameId, c.team, c.spentBox, pay(c.teamDoc.resources, SABOTAGE_COST) as Record<Resource, number>, {
    atMs: c.nowMs,
    day: c.day,
    kind: 'sabotage',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { sabotage: kind, targetTeam },
  })
  batch.set(gameRef(gameId).collection('sabotages').doc(), doc)
  await batch.commit()
  await refreshViews(gameId)
  return { kind, targetTeam }
})
