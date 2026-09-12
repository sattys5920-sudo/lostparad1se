// QA용 — 열넷을 앉혀 둔다.
//
// 닷새를 한 번 굴려 보려면 사람이 열넷 있어야 한다. 혼자 확인하려고
// 매번 열네 번 가입할 수는 없다.
//
// **운영자만, 로비에서만.** 판이 시작한 뒤에 부르면 그 판이 망가진다.
// 비밀번호는 부르는 쪽이 정한다 — 여기서 뻔한 값을 박아 두면 QA
// 계정이 곧 뒷문이 된다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TOTAL_SEATS, openTeams } from '../../shared/rules/lobby'
import { TEAM_SIZES, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, SeatEntry } from '../../shared/model'
import { createAccount } from './account'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 이름은 그냥 알아보기 쉬우면 된다. 게임 속 문장이 아니다. */
const NAMES = [
  '가온', '나래', '다솜', '라온', '마루', '바다', '새롬',
  '아름', '자람', '차오', '카린', '타래', '파랑', '하람',
]

/** 아이디는 자리 번호 그대로다 — 누구로 들어갈지 바로 안다. */
const idOf = (i: number) => `qa${String(i + 1).padStart(2, '0')}`

export const seedPlayers = onCall<{ gameId: string; password: string; leaveSeats?: number }>(async (req) => {
  requireUid(req.auth)
  if (req.auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')

  const password = String(req.data.password ?? '')
  if (password.length < 8) throw new HttpsError('invalid-argument', '비밀번호는 8자 이상으로 정해라.')

  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if ((snap.data() as GameDoc).phase !== 'lobby') {
    throw new HttpsError('failed-precondition', '이미 시작한 판이다. 로비에서만 채울 수 있다.')
  }

  // 몇 자리를 비워 둘지. 기본은 하나 — 운영자가 직접 앉아 본다
  const leave = Math.max(0, Math.min(TOTAL_SEATS, Math.floor(Number(req.data.leaveSeats ?? 1))))
  const want = TOTAL_SEATS - leave

  // 계정은 트랜잭션 밖에서 만든다. 해시 열넷을 한 트랜잭션에 넣으면
  // 시간이 오래 걸려 그대로 터진다
  const made: { uid: string; name: string }[] = []
  for (let i = 0; i < want; i++) {
    made.push({ uid: await createAccount(idOf(i), password, NAMES[i]), name: NAMES[i] })
  }

  const seated = await db.runTransaction(async (tx) => {
    const now = (await tx.get(ref)).data() as GameDoc
    if (now.phase !== 'lobby') throw new HttpsError('failed-precondition', '그새 시작했다.')
    const seats = [...now.seats]
    for (const p of made) {
      if (seats.some((s) => s.playerId === p.uid)) continue
      const team = pickTeam(seats)
      if (!team) break
      const seat: SeatEntry = { playerId: p.uid, name: p.name, team }
      seats.push(seat)
    }
    tx.update(ref, { seats })
    return seats.length
  })

  return { seated, accounts: made.length, firstId: idOf(0), lastId: idOf(want - 1) }
})

/** 빈 팀 중 제일 덜 찬 곳. 봇끼리는 고르게 퍼지는 편이 확인하기 좋다. */
function pickTeam(seats: readonly SeatEntry[]): TeamId | undefined {
  const open = openTeams(seats)
  if (open.length === 0) return undefined
  return open.reduce((best, t) => {
    const n = (x: TeamId) => seats.filter((s) => s.team === x).length / TEAM_SIZES[x]
    return n(t) < n(best) ? t : best
  }, open[0])
}
