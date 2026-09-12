// 운영자 코드.
//
// 판을 만들 수 있는 사람은 한 명뿐인데, 그 한 명을 정하는 통로가
// 없었다. 에뮬레이터에서는 스크립트로 표시를 심었지만 실제로 올린
// 뒤에는 그럴 수가 없다.
//
// 코드는 **저장소에 없다.** 배포할 때 환경변수로 들어간다. 여기 적어
// 두면 깃허브를 보는 누구나 운영자가 된다.
//
// 그리고 코드는 짧다. 짧은 코드는 두들겨 볼 수 있다는 뜻이라, 틀린
// 횟수를 세서 잠근다. 세는 곳은 사람별이 아니라 **판 전체**다 —
// 계정은 얼마든지 새로 만들 수 있으니 사람별로 세면 아무것도 못 막는다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { timingSafeEqual } from 'node:crypto'

import { HOST_GATE_LOCK_MS, HOST_GATE_MAX_MISSES, HOST_GATE_MIN_CODE } from '../../shared/rules/v2'
import { mintToken } from './account'
import { requireUid } from './index'

const db = getFirestore()

/** 규칙이 열어 주지 않는 자리다. 서버만 읽고 쓴다. */
const gateRef = () => db.doc('hostGate/state')

interface GateDoc {
  /** 잠금 창이 열린 시각. */
  windowFromMs: number
  /** 그 창 안에서 틀린 횟수. */
  misses: number
}

/**
 * 길이가 다르면 timingSafeEqual이 던진다. 길이 자체가 새는 것은
 * 어쩔 수 없지만, 맞는 글자 수가 새지는 않게 한다.
 */
function sameCode(given: string, want: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(want, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * 코드를 맞히면 운영자가 된다.
 *
 * 표시를 붙이는 것만으로는 부족하다. 지금 들고 있는 증표에는 그
 * 표시가 없어서, 새로 만들어 돌려준다 — 화면은 이걸로 다시 로그인한다.
 * (createCustomToken의 클레임은 덮어쓰기라 갱신만으로는 안 붙는다.)
 */
export const claimHost = onCall<{ code: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const want = String(process.env.HOST_CODE ?? '')

  // 코드가 안 심겼는데 아무나 통과시키면 최악이다. 차라리 아무도 못 들어간다
  if (want.length < HOST_GATE_MIN_CODE) {
    throw new HttpsError('failed-precondition', '운영자 코드가 서버에 없다. 배포 설정을 확인해야 한다.')
  }

  const now = Date.now()
  const gate = ((await gateRef().get()).data() as GateDoc | undefined) ?? { windowFromMs: 0, misses: 0 }
  // 창이 지났으면 처음부터 다시 센다
  const fresh = now - gate.windowFromMs > HOST_GATE_LOCK_MS
  const misses = fresh ? 0 : gate.misses

  if (misses >= HOST_GATE_MAX_MISSES) {
    const leftMs = HOST_GATE_LOCK_MS - (now - gate.windowFromMs)
    throw new HttpsError('resource-exhausted', `너무 많이 틀렸다. ${Math.ceil(leftMs / 60000)}분 뒤에 다시.`)
  }

  if (!sameCode(String(req.data.code ?? ''), want)) {
    await gateRef().set({ windowFromMs: fresh ? now : gate.windowFromMs, misses: misses + 1 })
    throw new HttpsError('permission-denied', '코드가 다르다.')
  }

  // 맞혔으니 센 것을 지운다. 다음 사람이 남은 횟수를 물려받을 이유가 없다
  await gateRef().set({ windowFromMs: 0, misses: 0 })

  const user = await getAuth().getUser(uid)
  await getAuth().setCustomUserClaims(uid, { ...(user.customClaims ?? {}), admin: true })

  const accountId = (req.auth?.token as Record<string, unknown> | undefined)?.accountId
  return {
    admin: true,
    token: await mintToken(uid, {
      ...(typeof accountId === 'string' ? { accountId } : {}),
      admin: true,
    }),
  }
})
