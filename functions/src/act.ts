// 토큰을 쓰는 행동 — 연구 · 탐색 · 생산 · 견제.
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
  STUDY_YIELD,
  checkStand,
  ownerLookup,
  type ActionKind,
} from '../../shared/rules/actions'
import { gain, type TileState } from '../../shared/rules/resources'
import { spendToken } from '../../shared/rules/tokens'
import { type Resource, type TeamId } from '../../shared/rules/v2'
import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import type { TeamDoc, TokenStateDoc } from '../../shared/model'
import { refreshViews } from './views'
import { freshNow, myPawn, requireAwake, tileStates } from './turn'
import { gameRef, requireUid } from './index'

const db = getFirestore()

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
  /** 토큰을 몇 개 쓸 것인가. 공짜로 하는 경우 0을 넘긴다. */
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

// ── 공부 ────────────────────────────────────────────────────────

/**
 * 우리 땅 위에서 지식을 번다. **생산의 짝이다.**
 *
 * 전에는 지식이 탐색과 문제지에서만 나왔다. 연구가 연구실 하나로
 * 몰리면서 지식이 판의 목줄이 되었는데, 버는 길이 운(탐색)과
 * 문제지뿐이면 연구실을 못 쥔 팀은 손쓸 방법이 없다.
 */
export const study = onCall<{ gameId: string; tileId: TileId }>(async (req) => {
  const uid = requireUid(req.auth)
  const { gameId, tileId } = req.data
  const c = await begin(gameId, uid, 'study', tileId)

  const batch = commit(gameId, c.team, c.spentBox, gain(c.teamDoc.resources, STUDY_YIELD), {
    atMs: c.nowMs,
    day: c.day,
    kind: 'study',
    team: c.team,
    playerId: uid,
    tileId,
    detail: { got: STUDY_YIELD },
  })
  await batch.commit()
  await refreshViews(gameId)
  return { got: STUDY_YIELD }
})
