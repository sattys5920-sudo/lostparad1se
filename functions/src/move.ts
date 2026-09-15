// 도착 예정 치우기.
//
// **여기 있던 걷기와 등교 예약은 없앴다.** 칸마다 15분씩 여러 칸을
// 걸어가는 규칙이었는데, 복도가 생기고 계단이 문이 된 뒤로는 어느
// 방이든 한 걸음이라 「여러 칸」이 없어졌다. 자유 시간 걸음(roamTo)은
// 공짜에 즉시고, 페이즈 걸음은 phaseAct 가 맡는다.
//
// 남은 것은 이것 하나다 — 페이즈가 열릴 때 옛 도착 예정을 걷어내는 일.
import { getFirestore } from 'firebase-admin/firestore'

import { type ScheduleDoc } from '../../shared/model'
import { gameRef } from './index'

const db = getFirestore()

/** 그 사람의 아직 안 온 도착 예정을 지운다. 길을 바꾸면 옛 길은 없던 것이다. */
export async function clearArrivals(gameId: string, playerId: string): Promise<void> {
  const snap = await gameRef(gameId)
    .collection('schedule')
    .where('kind', '==', 'arrive')
    .get()
  const batch = db.batch()
  for (const d of snap.docs) {
    const s = d.data() as ScheduleDoc
    if (s.doneAtMs !== null) continue
    if ((s.payload as { playerId?: string }).playerId !== playerId) continue
    batch.delete(d.ref)
  }
  await batch.commit()
}
