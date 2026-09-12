// 계정 — 가입과 로그인, 그리고 **진짜 로그인 증표**.
//
// 왜 서버로 옮겼는가.
//
// 전에는 브라우저가 비밀번호를 해시해 Firestore의 해시와 비교했다.
// 원문을 보내지 않는다는 점은 좋았지만, 그 검사를 **브라우저가** 했다.
// 해시 문서는 규칙이 누구에게나 열어 두었으므로, 개발자도구를 열 줄
// 아는 사람은 비교를 통째로 건너뛰고 남의 계정으로 들어갈 수 있었다.
//
// 게임 쪽 누출 방지는 전부 request.auth.uid 위에 서 있다. 그 uid가
// 아무나 만들 수 있는 것이면 규칙도 views도 의미가 없다. 그래서
// 비밀번호 검사를 서버로 옮기고, 통과한 사람에게만 Firebase 로그인
// 증표(custom token)를 만들어 준다.
//
// 비밀번호는 TLS 위로 서버까지만 간다. 저장은 여전히 소금 + PBKDF2
// 해시뿐이고 원문은 어디에도 남지 않는다.
import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const db = getFirestore()
const pbkdf2Async = promisify(pbkdf2)

/** 화면 쪽과 **같은 값이어야 한다.** 다르면 예전 계정이 못 들어온다. */
const ITERATIONS = 120_000
const ID_RE = /^[a-z0-9_-]{3,16}$/
const MIN_PASSWORD = 6

const accountRef = (id: string) => db.doc(`schoolSessions/live/accounts/${id}`)
const secretRef = (id: string) => db.doc(`schoolSessions/live/accounts/${id}/auth/secret`)

const normalizeId = (raw: string) => String(raw ?? '').trim().toLowerCase()

async function hashPassword(password: string, salt: string): Promise<string> {
  const bits = await pbkdf2Async(password, salt, ITERATIONS, 32, 'sha256')
  return bits.toString('hex')
}

/** 길이가 달라도 시간이 새지 않게 한 번 더 해시해 비교한다. */
function sameHash(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Firebase uid는 계정 아이디에서 만든다.
 *
 * 아이디를 그대로 쓰지 않는 이유: uid가 게임 문서의 열쇠로 여기저기
 * 쓰이는데, 아이디는 사람이 고른 말이라 나중에 바꾸고 싶어질 수 있다.
 * 되돌릴 수 없는 해시로 한 겹 덮어 두면 그때 갈아탈 자리가 남는다.
 */
function uidOf(id: string): string {
  return `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
}

/**
 * 그 계정에 붙어 있던 표시를 이어서 들고 간다.
 *
 * createCustomToken의 두 번째 인자는 토큰의 클레임을 **덮어쓴다.**
 * 운영자 표시를 계정에 달아 두어도 로그인할 때마다 사라진다. 그래서
 * 여기서 읽어다 다시 실어 준다 — 계정이 아직 없으면(첫 로그인)
 * 붙어 있던 것도 없다.
 */
async function carriedClaims(uid: string): Promise<Record<string, unknown>> {
  try {
    const user = await getAuth().getUser(uid)
    const claims = (user.customClaims ?? {}) as Record<string, unknown>
    return claims.admin === true ? { admin: true } : {}
  } catch {
    return {}
  }
}

/**
 * 로그인 증표를 만든다.
 *
 * 이걸 하려면 함수를 돌리는 서비스 계정이 **자기 이름으로 서명**할 수
 * 있어야 한다(iam.serviceAccountTokenCreator). 에뮬레이터는 서명을 하지
 * 않으니 여기서는 절대 안 걸리고, 올린 뒤 첫 가입에서 터진다.
 *
 * 그냥 두면 화면에 `INTERNAL` 넉 자만 뜬다. 읽는 사람은 무엇이
 * 잘못됐는지 알 수 없고, 정작 필요한 조치는 권한 한 줄을 주는 것이다.
 * 그래서 서버 로그에 원문을 남기고, 화면에는 무엇을 해야 하는지 적어
 * 보낸다 — 비밀이 아니라 설정 실수다.
 */
export async function mintToken(uid: string, claims: Record<string, unknown>): Promise<string> {
  try {
    return await getAuth().createCustomToken(uid, claims)
  } catch (e) {
    const raw = (e as Error).message ?? ''
    console.error('createCustomToken 실패', raw)
    if (/signBlob|iam\.serviceAccounts|TokenCreator|PERMISSION_DENIED/i.test(raw)) {
      throw new HttpsError(
        'failed-precondition',
        '서버가 로그인 증표를 만들지 못했다. 함수를 돌리는 서비스 계정에 ' +
          'roles/iam.serviceAccountTokenCreator 권한이 필요하다.',
      )
    }
    throw new HttpsError('internal', `로그인 증표를 만들지 못했다: ${raw}`)
  }
}

function check(id: string, password: string): void {
  if (!ID_RE.test(id)) throw new HttpsError('invalid-argument', '아이디는 영문 소문자·숫자·_·- 로 3~16자여야 한다.')
  if (String(password ?? '').length < MIN_PASSWORD) {
    throw new HttpsError('invalid-argument', `비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다.`)
  }
}

interface AccountDoc {
  nickname?: string
  avatar?: unknown
  /** 예전 모양. 계정 문서 안에 해시가 있던 시절. */
  salt?: string
  hash?: string
}

/**
 * 계정 하나를 만든다. 이미 있으면 그대로 둔다.
 *
 * 가입과 QA용 채우기가 같은 길을 쓰게 하려고 꺼내 둔다. 두 벌이 되면
 * 한쪽만 고쳐서 QA 계정만 못 들어오는 날이 온다.
 */
export async function createAccount(rawId: string, password: string, nickname = ''): Promise<string> {
  const id = normalizeId(rawId)
  check(id, password)
  const salt = randomBytes(16).toString('hex')
  const hash = await hashPassword(password, salt)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef(id))
    if (snap.exists) return
    tx.set(accountRef(id), { nickname, avatar: null, createdAtMs: Date.now() })
    tx.set(secretRef(id), { salt, hash })
  })
  return uidOf(id)
}

/** 가입. 같은 아이디가 있으면 거절한다 — 트랜잭션 안에서 본다. */
export const signUpAccount = onCall<{ id: string; password: string }>(async (req) => {
  const id = normalizeId(req.data.id)
  check(id, req.data.password)

  const salt = randomBytes(16).toString('hex')
  const hash = await hashPassword(req.data.password, salt)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef(id))
    if (snap.exists) throw new HttpsError('already-exists', '이미 있는 아이디다.')
    tx.set(accountRef(id), { nickname: '', avatar: null, createdAtMs: Date.now() })
    tx.set(secretRef(id), { salt, hash })
  })

  const uid = uidOf(id)
  return {
    id,
    uid,
    token: await mintToken(uid, { accountId: id, ...(await carriedClaims(uid)) }),
    nickname: '',
    avatar: null,
  }
})

/**
 * 로그인. 아이디가 없을 때와 비밀번호가 틀렸을 때를 같은 말로 돌려준다.
 *
 * 통과하면 Firebase 로그인 증표를 만들어 준다. 게임의 모든 규칙이
 * 이 증표의 uid를 본다.
 */
export const logInAccount = onCall<{ id: string; password: string }>(async (req) => {
  const id = normalizeId(req.data.id)
  const wrong = new HttpsError('permission-denied', '아이디나 비밀번호가 맞지 않는다.')
  if (!ID_RE.test(id) || String(req.data.password ?? '').length < MIN_PASSWORD) throw wrong

  const snap = await accountRef(id).get()
  if (!snap.exists) throw wrong
  const record = snap.data() as AccountDoc

  // 예전에 가입한 계정은 해시가 계정 문서 안에 있다
  const secretSnap = await secretRef(id).get()
  const secret = secretSnap.exists
    ? (secretSnap.data() as { salt: string; hash: string })
    : record.salt && record.hash
      ? { salt: record.salt, hash: record.hash }
      : null
  if (!secret) throw wrong
  if (!sameHash(await hashPassword(req.data.password, secret.salt), secret.hash)) throw wrong

  // 예전 모양이면 조용히 옮겨 둔다
  if (!secretSnap.exists) {
    await secretRef(id).set(secret)
    await accountRef(id).update({ salt: null, hash: null })
  }

  const uid = uidOf(id)
  return {
    id,
    uid,
    token: await mintToken(uid, { accountId: id, ...(await carriedClaims(uid)) }),
    nickname: record.nickname ?? '',
    avatar: record.avatar ?? null,
  }
})

/** 닉네임과 모습. 로그인한 본인 것만 고친다. */
export const saveCharacter = onCall<{ nickname: string; avatar: unknown }>(async (req) => {
  const accountId = req.auth?.token?.accountId as string | undefined
  if (!accountId) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  const nickname = String(req.data.nickname ?? '').trim()
  if (nickname.length === 0 || nickname.length > 12) {
    throw new HttpsError('invalid-argument', '이름은 1~12자다.')
  }
  await accountRef(accountId).update({ nickname, avatar: req.data.avatar ?? null })
  return { nickname }
})
