// 거래판의 살림 — 문서가 어디 있고, 언제 접히는가.
//
// 부르는 쪽(deals.ts의 콜러블)과 따라잡기(catchup.ts) 둘 다 이것을
// 쓴다. 살림을 콜러블 파일에 두면 따라잡기가 콜러블을 불러오게 되고,
// 그 길로 turn.ts → catchup.ts 고리가 생긴다. 살림만 따로 둔다.
import { getFirestore } from 'firebase-admin/firestore'

import { askExpired, type DealState } from '../../shared/rules/deal'
import type { PawnDoc } from '../../shared/model'
import { gameRef } from './index'

const db = getFirestore()

export const dealsOf = (gameId: string) => gameRef(gameId).collection('deals')

/** 어느 쪽지를 올렸는지. **서버만 안다** — 거래판에는 장수만 적힌다. */
export const dealSlipsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('dealSlips').collection('items')

export const slipsOf = (gameId: string) =>
  gameRef(gameId).collection('secret').doc('slips').collection('items')

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
  await dealsOf(gameId).doc(dealId).update({ status: 'gone', why })
}

/**
 * 시들거나 자리를 잃은 거래를 접는다.
 *
 * 열다섯 초가 지난 요청, 페이즈가 열린 뒤에도 남은 판, 둘 중 하나가
 * 방을 떠났거나 투명인간이 된 판이 여기서 없어진다.
 */
export async function sweepDeals(gameId: string, nowMs: number): Promise<void> {
  const ref = gameRef(gameId)
  const [snap, gameSnap, pawns] = await Promise.all([
    dealsOf(gameId).where('status', 'in', LIVE).get(),
    ref.get(),
    ref.collection('pawns').get(),
  ])
  if (snap.empty) return
  const game = gameSnap.data() as { phaseNow?: { open?: boolean }; invisibleId?: string | null }
  const where = new Map<string, string | null>()
  for (const d of pawns.docs) where.set(d.id, (d.data() as PawnDoc).tileId ?? null)

  const batch = db.batch()
  let any = false
  for (const d of snap.docs) {
    const deal = d.data() as DealDoc
    let why: string | null = null
    if (askExpired(deal, nowMs)) why = '답이 없어 사라졌다.'
    else if (game.phaseNow?.open) why = '페이즈가 열려 거래가 사라졌다.'
    else if (game.invisibleId === deal.aId || game.invisibleId === deal.bId) why = '한 사람이 사라졌다.'
    else if (where.get(deal.aId) !== deal.tileId || where.get(deal.bId) !== deal.tileId) {
      why = '한 사람이 자리를 떴다.'
    }
    if (!why) continue
    batch.update(d.ref, { status: 'gone', why })
    any = true
  }
  if (any) await batch.commit()
}
