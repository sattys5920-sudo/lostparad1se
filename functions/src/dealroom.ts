// 거래판의 살림 — 문서가 어디 있고, 언제 접히는가.
//
// 부르는 쪽(deals.ts의 콜러블)과 따라잡기(catchup.ts) 둘 다 이것을
// 쓴다. 살림을 콜러블 파일에 두면 따라잡기가 콜러블을 불러오게 되고,
// 그 길로 turn.ts → catchup.ts 고리가 생긴다. 살림만 따로 둔다.
import { getFirestore } from 'firebase-admin/firestore'

import { askExpired, type DealState } from '../../shared/rules/deal'
import { cellsTouch, type Cell } from '../../shared/rules/board'
import type { PawnDoc } from '../../shared/model'
import { gameRef } from './index'

const db = getFirestore()

export const dealsOf = (gameId: string) => gameRef(gameId).collection('deals')

/** 어느 쪽지를 올렸는지. **서버만 안다** — 거래판에는 장수만 적힌다. */
export const dealSlipsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('dealSlips').collection('items')

export const slipsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('slips').collection('items')

/**
 * 사람마다 하나 — **마지막으로 끼어든 거래.** 문서 아이디가 사람이다.
 *
 * 「한 사람에 살아 있는 거래 하나」를 liveDealOf(질의)로만 지키면 둘이
 * 같은 순간에 청할 때 둘 다 통과한다 — 질의는 트랜잭션이 못 잡는다.
 * askDeal 이 이 문서를 트랜잭션 안에서 읽고 쓰므로 같은 사람을 두고
 * 다투는 둘 중 한쪽만 이긴다. 가리키는 거래가 접혔으면 없는 것으로
 * 친다 — 접을 때 지우지 않아도 된다. **참가자는 못 읽는다**(secret).
 */
export const dealLocksOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('dealLocks').collection('items')

export interface DealLockDoc {
  dealId: string
  atMs: number
}

/** 살아 있는 거래. 이 셋 말고는 지나간 것이다. */
export const LIVE = ['asking', 'open', 'settling']

export interface DealDoc extends DealState {
  /** 규칙이 읽기를 여는 데 쓴다. 두 사람만 이 문서를 본다. */
  aId: string
  bId: string
}

export const asDoc = (d: DealState): DealDoc => ({ ...d, aId: d.a.playerId, bId: d.b.playerId })

/** 이 사람이 지금 끼어 있는 살아 있는 거래. 한 번에 하나뿐이다. */
export async function liveDealOf(gameId: string, uid: string): Promise<string | null> {
  const [asA, asB] = await Promise.all([
    dealsOf(gameId).where('aId', '==', uid).where('status', 'in', LIVE).limit(1).get(),
    dealsOf(gameId).where('bId', '==', uid).where('status', 'in', LIVE).limit(1).get(),
  ])
  return asA.docs[0]?.id ?? asB.docs[0]?.id ?? null
}

/** 거래를 접는다. **아무것도 안 옮긴다** — 올린 것은 선언일 뿐이라 돌아갈 것이 없다. */
export async function endDeal(gameId: string, dealId: string, why: string): Promise<void> {
  // **살아 있을 때만 접는다.** 막 성립한 거래를 「서로 떨어졌다」로 덮으면
  // 물건은 오갔는데 화면에는 무산으로 보인다
  const ref = dealsOf(gameId).doc(dealId)
  await db.runTransaction(async (tx) => {
    const now = (await tx.get(ref)).data() as DealDoc | undefined
    if (!now || !LIVE.includes(now.status)) return
    tx.update(ref, { status: 'gone', why })
  })
}

/**
 * 시들거나 자리를 잃은 거래를 접는다.
 *
 * 열다섯 초가 지난 요청, 둘 중 하나가 자리를 떠났거나 투명인간이 된
 * 판이 여기서 없어진다.
 *
 * **페이즈가 열렸다는 것만으로는 안 접는다.** 마주 선 둘이 물건을
 * 주고받는 일은 점령과 같이 일어나도 이상하지 않다. 페이즈가 열릴 때
 * 다들 전선으로 옮겨 세워지므로 대개는 자리가 갈려서 접히는데, 그건
 * 자리를 잃은 것이지 페이즈라서가 아니다 — 다시 마주 서면 또 흥정한다.
 */
export async function sweepDeals(gameId: string, nowMs: number): Promise<void> {
  const ref = gameRef(gameId)
  // 열린 거래가 없으면 판과 열넷 말은 안 읽는다 — 따라잡기가 몇 초마다 여기를 지난다
  const snap = await dealsOf(gameId).where('status', 'in', LIVE).get()
  if (snap.empty) return
  const [gameSnap, pawns] = await Promise.all([ref.get(), ref.collection('pawns').get()])
  const game = gameSnap.data() as { phaseNow?: { open?: boolean }; invisibleId?: string | null }
  // 자리만 본다. **방은 안 묻는다** — 복도에서 마주 선 둘도 흥정한다
  const at = new Map<string, Cell | null>()
  for (const d of pawns.docs) at.set(d.id, (d.data() as PawnDoc).at ?? null)

  const ending: { id: string; why: string }[] = []
  for (const d of snap.docs) {
    const deal = d.data() as DealDoc
    let why: string | null = null
    if (askExpired(deal, nowMs)) why = '답이 없어 사라졌다.'
    else if (game.invisibleId === deal.aId || game.invisibleId === deal.bId) why = '한 사람이 사라졌다.'
    else if (!cellsTouch(at.get(deal.aId), at.get(deal.bId))) {
      /*
       * 마주 선 채로만 흥정한다. 한 걸음 떨어지면 탁자가 접힌다.
       *
       * **방은 안 묻는다.** 복도에서 마주 선 둘도 흥정하는데, 방을
       * 물으면 각자 마지막으로 들어간 방이 달라 곧바로 접힌다.
       */
      why = '서로 떨어졌다.'
    }
    if (!why) continue
    ending.push({ id: d.id, why })
  }
  for (const e of ending) await endDeal(gameId, e.id, e.why)
}
