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

import type { AvatarLook } from '../../shared/look'
import { sweepAllLobbies } from './seats'

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

/**
 * 그 계정이 만들어 둔 캐릭터. 없으면 null.
 *
 * 자리에 앉을 때 서버가 이것을 꺼내 명단에 적는다. **화면이 보내 주는
 * 것을 받지 않는다** — 받으면 남의 얼굴로 앉을 수 있다.
 *
 * 모양은 보지 않고 그대로 옮긴다. 목록 길이를 아는 것은 그림 그리는
 * 쪽이고, 범위를 벗어난 값은 화면이 normalizeLook 으로 접어 넣는다.
 */
export async function lookOfAccount(accountId: string | undefined): Promise<AvatarLook | null> {
  if (!accountId) return null
  const snap = await accountRef(accountId).get()
  if (!snap.exists) return null
  const avatar = (snap.data() as { avatar?: unknown }).avatar
  return avatar && typeof avatar === 'object' ? (avatar as AvatarLook) : null
}

/**
 * uid 로 여러 계정의 얼굴을 한 번에 꺼낸다.
 *
 * **uid 는 아이디를 해시한 것이라 거꾸로 못 푼다.** 그래서 계정을
 * 통째로 훑고 uidOf 로 맞춰 본다 — 한 학교 규모라 훑어도 된다.
 * uid→계정 색인을 따로 두면 계정을 지울 때 한쪽만 늙는다.
 *
 * 명단에 적힌 얼굴이 비어 있거나 낡았을 때 다시 읽는 데 쓴다. 자리에
 * 앉을 때 한 번 찍어 두는 것만으로는, **앉고 나서 얼굴을 만든 사람**이
 * 영영 점으로 남는다.
 */
export async function looksByUid(uids: readonly string[]): Promise<Record<string, AvatarLook | null>> {
  const want = new Set(uids)
  if (want.size === 0) return {}
  const out: Record<string, AvatarLook | null> = {}
  const snap = await db.collection('schoolSessions/live/accounts').get()
  for (const d of snap.docs) {
    const uid = uidOf(d.id)
    if (!want.has(uid)) continue
    const avatar = (d.data() as { avatar?: unknown }).avatar
    out[uid] = avatar && typeof avatar === 'object' ? (avatar as AvatarLook) : null
  }
  return out
}

/**
 * 그 계정의 캐릭터를 바꿔 끼운다. **QA 전용이다.**
 *
 * 열넷을 앉혀 놓고 화면을 보려면 열넷이 서로 달라 보여야 한다. 사람이
 * 쓰는 길(saveCharacter)은 본인 증표를 보지만, 이쪽은 운영자가 QA
 * 계정을 만들면서 함께 찍어 두는 것이라 증표를 볼 것이 없다.
 */
export async function setAccountLook(rawId: string, avatar: AvatarLook): Promise<void> {
  await accountRef(normalizeId(rawId)).set({ avatar }, { merge: true })
}

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

// ── 운영자: 가입 데이터 ─────────────────────────────────────────
//
// **판과 가입은 따로다.** 계정을 지워도 명단(seats)은 안 건드린다 —
// 이름·팀·얼굴은 판이 제 안에 베껴 들고 있어서, 지난 판의 기록은
// 그대로 남는다. 지워지는 것은 「그 아이디로 다시 들어오는 길」뿐이다.
//
// uid 는 아이디를 해시한 값이라, 같은 아이디로 다시 가입하면 **같은
// uid** 가 나온다. 잘못 지웠으면 그 아이디로 다시 가입하면 자리로
// 돌아간다 — 비밀번호는 새로 정한 것이 된다.

/** 운영자만. 화면이 하는 말을 믿지 않는다. */
function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): void {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  if (auth.token?.admin !== true) throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
}

/** 지금 돌고 있는 판에 앉아 있는 uid 들. 지우기 전에 보여 준다. */
async function seatedNow(): Promise<Set<string>> {
  const out = new Set<string>()
  const games = await db.collection('games').get()
  for (const g of games.docs) {
    const d = g.data() as { phase?: string; seats?: { playerId?: string }[] }
    if (d.phase !== 'running') continue
    for (const s of d.seats ?? []) if (s.playerId) out.add(s.playerId)
  }
  return out
}

/** 계정이 살아 있는 uid 전부. 주인 없는 자리를 가려낼 때 쓴다. */
export async function accountUids(): Promise<Set<string>> {
  const snap = await db.collection('schoolSessions/live/accounts').get()
  return new Set(snap.docs.map((d) => uidOf(d.id)))
}

/**
 * 가입한 계정을 전부 편다. 운영자만.
 *
 * **소금과 해시는 안 나온다.** 다른 문서(auth/secret)에 있고 그쪽은
 * 서버만 읽는다. 여기서 나가는 것은 아이디·이름·가입 시각과, 얼굴을
 * 만들었는지, 지금 돌고 있는 판에 앉아 있는지뿐이다.
 */
export const hostAccounts = onCall(async (req) => {
  requireHost(req.auth)
  const [snap, seated] = await Promise.all([
    db.collection('schoolSessions/live/accounts').get(),
    seatedNow(),
  ])
  const rows = snap.docs.map((d) => {
    const r = d.data() as AccountDoc & { createdAtMs?: number }
    const uid = uidOf(d.id)
    return {
      id: d.id,
      nickname: typeof r.nickname === 'string' ? r.nickname : '',
      createdAtMs: typeof r.createdAtMs === 'number' ? r.createdAtMs : 0,
      face: r.avatar != null,
      playing: seated.has(uid),
    }
  })
  rows.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
  // 내 계정은 지울 수 없다. 화면이 미리 잠그도록 누구인지 알려 준다
  return { rows, me: normalizeId(String(req.auth?.token?.accountId ?? '')) }
})

/**
 * 고른 계정을 지운다. 운영자만.
 *
 * 세 가지를 같이 지운다 — 계정 문서, 그 아래 비밀번호 문서, 그리고
 * 로그인 자체(Firebase 사용자). **계정 문서만 지우면 증표가 살아
 * 있어서** 이미 로그인해 둔 브라우저는 한동안 그대로 논다.
 *
 * 자기 자신은 못 지운다. 운영자가 제 계정을 지우고 나면 관리자 화면에
 * 다시 들어올 길이 없다.
 */
export const hostDeleteAccounts = onCall<{ ids: string[] }>(async (req) => {
  requireHost(req.auth)
  const mine = normalizeId(String(req.auth?.token?.accountId ?? ''))
  const ids = [...new Set((req.data.ids ?? []).map(normalizeId))].filter((x) => x.length > 0)
  if (ids.length === 0) throw new HttpsError('invalid-argument', '지울 것을 고르지 않았다.')

  const gone: string[] = []
  const kept: { id: string; why: string }[] = []
  for (const id of ids) {
    if (id === mine) {
      kept.push({ id, why: '내 계정이다' })
      continue
    }
    const snap = await accountRef(id).get()
    if (!snap.exists) {
      kept.push({ id, why: '그런 아이디가 없다' })
      continue
    }
    await secretRef(id).delete()
    await accountRef(id).delete()
    // 남은 로그인 증표까지 끊는다. 없으면 그냥 넘어간다
    await getAuth()
      .deleteUser(uidOf(id))
      .catch(() => undefined)
    gone.push(id)
  }
  // **지운 사람이 앉아 있던 자리를 비운다.** 안 그러면 로비가 유령으로
  // 차서, 새로 가입한 사람이 「자리가 없다」를 듣는다. 시작한 판은
  // 안 건드린다 — 거기서 자리를 빼면 말도 점수도 주인을 잃는다
  const freed = gone.length > 0 ? await sweepAllLobbies() : []
  return { gone, kept, freed }
})
