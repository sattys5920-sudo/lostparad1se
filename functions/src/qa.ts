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
import { TILES } from '../../shared/rules/board'
import { STARTING_TEAM_SIZES, type TeamId } from '../../shared/rules/v2'
import type { GameDoc, SeatEntry } from '../../shared/model'
import type { AvatarLook } from '../../shared/look'
import { createAccount, setAccountLook } from './account'
import { readRoster, settleRoster } from './lobby'
import { gameRef, requireUid } from './index'

const db = getFirestore()

/** 이름은 그냥 알아보기 쉬우면 된다. 게임 속 문장이 아니다. */
const NAMES = [
  '가온', '나래', '다솜', '라온', '마루', '바다', '새롬',
  '아름', '자람', '차오', '카린', '타래', '파랑', '하람',
]

/** 아이디는 자리 번호 그대로다 — 누구로 들어갈지 바로 안다. */
const idOf = (i: number) => `qa${String(i + 1).padStart(2, '0')}`

/**
 * 열넷을 서로 달라 보이게 한다.
 *
 * 자리 번호로 짜므로 qa07 은 늘 같은 얼굴이다 — 판을 다시 차려도
 * 어제 보던 애가 그 애다.
 *
 * **숫자가 목록보다 커도 된다.** 화면이 normalizeLook 으로 접어 넣는다.
 * 목록 길이를 여기 적어 두면 머리 모양이 하나 늘 때마다 두 곳을 고쳐야
 * 하고, 한 곳을 잊으면 QA 얼굴만 조용히 틀어진다.
 */
function qaLook(i: number): AvatarLook {
  const set = i % 2 === 0 ? 'F' : 'M'
  return {
    styleSet: set,
    hairStyle: `${set}${String((i * 3) % 15).padStart(2, '0')}`,
    hairColor: (i * 5) % 9,
    expression: (i * 2) % 6,
    outfit: i % 6,
    wearStyle: i % 3,
    bottom: set === 'F' ? i % 2 : 0,
    neckwear: (i + 1) % 3,
  }
}

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
  const made: { uid: string; name: string; look: AvatarLook }[] = []
  for (let i = 0; i < want; i++) {
    const look = qaLook(i)
    const uid = await createAccount(idOf(i), password, NAMES[i])
    // 이미 있던 계정에도 덮어쓴다. QA 계정은 한 에뮬레이터 안에서
    // 판을 넘어 살아남는데, 그러면 처음 만든 판의 얼굴만 남는다
    await setAccountLook(idOf(i), look)
    made.push({ uid, name: NAMES[i], look })
  }

  const seated = await db.runTransaction(async (tx) => {
    // 읽기가 먼저다. 트랜잭션은 쓰기 뒤에 읽을 수 없다
    const [gameSnap, hadRoster] = await Promise.all([tx.get(ref), readRoster(tx, req.data.gameId)])
    const now = gameSnap.data() as GameDoc
    if (now.phase !== 'lobby') throw new HttpsError('failed-precondition', '그새 시작했다.')
    const seats = [...now.seats]
    for (const p of made) {
      if (seats.some((s) => s.playerId === p.uid)) continue
      const team = pickTeam(seats)
      if (!team) break
      const seat: SeatEntry = { playerId: p.uid, name: p.name, team, look: p.look }
      seats.push(seat)
    }
    tx.update(ref, { seats })
    // 봇으로 채워도 열넷이면 역할이 나뉜다. 사람이 앉을 때와 같은 길이다
    settleRoster(tx, req.data.gameId, hadRoster, seats, now.seed)
    return seats.length
  })

  return { seated, accounts: made.length, firstId: idOf(0), lastId: idOf(want - 1) }
})

/** 빈 팀 중 제일 덜 찬 곳. 봇끼리는 고르게 퍼지는 편이 확인하기 좋다. */
function pickTeam(seats: readonly SeatEntry[]): TeamId | undefined {
  const open = openTeams(seats)
  if (open.length === 0) return undefined
  return open.reduce((best, t) => {
    const n = (x: TeamId) => seats.filter((s) => s.team === x).length / STARTING_TEAM_SIZES[x]
    return n(t) < n(best) ? t : best
  }, open[0])
}

/**
 * 핵심 칸을 전부 연다. **시험용이다.**
 *
 * 본래는 A의 기록이 날마다 두 칸씩 열어 준다(CORE_OPENING). 닷새를
 * 기다리지 않고 확인하려면 그 문을 미리 열어야 한다 — 열리지 않은
 * 핵심에는 깃발을 못 꽂아서, 점령전의 절반이 잠겨 있는 셈이 된다.
 *
 * **규칙을 바꾸지 않는다.** openedTiles 에 넣어 줄 뿐이라, 아침마다
 * 도는 정산이 그날 몫을 또 넣어도 겹칠 뿐 아무 일도 안 일어난다.
 * 되돌리려면 판을 새로 만든다.
 */
export const openAllTiles = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  if (req.auth?.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')

  const ref = gameRef(req.data.gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')

  const all = TILES.filter((t) => t.tier === 'core' || t.tier === 'plaza').map((t) => t.id)
  const now = (snap.data() as GameDoc).openedTiles ?? []
  const openedTiles = [...new Set([...now, ...all])]
  await ref.update({ openedTiles })
  return { openedTiles, added: openedTiles.length - now.length }
})
