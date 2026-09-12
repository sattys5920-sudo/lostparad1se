// 계정 — 가입하고, 로그인하고, 그 계정에 캐릭터를 붙여 둔다.
//
// 비밀번호 검사는 **서버가 한다.** 전에는 브라우저가 Firestore의 해시를
// 읽어 와 직접 비교했다. 원문을 보내지 않는 건 좋았지만, 검사하는 쪽이
// 브라우저라 개발자도구로 건너뛰면 남의 계정으로 들어갈 수 있었다.
//
// 게임의 누출 방지는 전부 로그인 증표(uid) 위에 서 있다. 그 증표를
// 아무나 만들 수 있으면 규칙도 views도 의미가 없다. 그래서 옮겼다.
//
// 저장은 그대로다 — 계정마다 다른 소금을 섞은 PBKDF2 해시뿐이고 원문은
// 어디에도 남지 않는다. 다만 이제 해시는 서버만 읽는다.
//
//   accounts/{id}              닉네임·아바타 — 진행자가 목록으로 훑는다
//   accounts/{id}/auth/secret  소금·해시 — **서버 전용**
import { signInWithCustomToken, signOut } from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  type Firestore,
} from 'firebase/firestore'
import { auth, callServer, db } from '../firebase'
import { normalizeLook } from './char/look'
import type { AvatarLook } from './types'

/** 아이디에 허용하는 글자. 문서 id로 그대로 쓰므로 좁게 잡는다. */
const ID_RE = /^[a-z0-9_-]{3,16}$/
const MIN_PASSWORD = 6

export interface Account {
  id: string
  nickname: string
  avatar: AvatarLook | null
}

/** 진행자 화면에 펴 보이는 한 줄. 비밀번호에 관한 것은 들어 있지 않다. */
export interface AccountSummary {
  id: string
  nickname: string
  createdAtMs: number
}

interface AccountDoc {
  nickname: string
  avatar: AvatarLook | null
  createdAtMs: number
  /** 예전 저장 모양 — 해시가 계정 문서 안에 있던 시절의 값 */
  salt?: string
  hash?: string
}

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

/**
 * Firestore가 규칙으로 막으면 "false for 'create' @ L41" 같은 말이 그대로
 * 화면에 뜬다. 읽는 사람은 무엇을 해야 할지 알 수 없고, 정작 필요한 조치는
 * 콘솔에 규칙을 다시 붙여넣는 것이다. 그 말을 대신 띄운다.
 */
function friendly(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: string })?.code
  if (code === 'permission-denied' || /permission|false for/i.test(raw)) {
    return new Error('서버가 요청을 막았다. 관리자가 Firestore 규칙을 최신으로 올려야 한다.')
  }
  if (code === 'unavailable' || /offline|network/i.test(raw)) {
    return new Error('서버에 닿지 못했다. 연결을 확인해라.')
  }
  return e instanceof Error ? e : new Error(raw)
}

function accountsCol() {
  return collection(requireDb(), 'schoolSessions', 'live', 'accounts')
}

function accountRef(id: string) {
  return doc(accountsCol(), id)
}

export function normalizeId(raw: string): string {
  return raw.trim().toLowerCase()
}

function checkCredentials(id: string, password: string): void {
  if (!ID_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·_·- 로 3~16자여야 한다.')
  if (password.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다.`)
}

/**
 * 가입과 로그인은 **서버가 한다.**
 *
 * 전에는 브라우저가 해시를 비교했다. 원문을 보내지 않는 건 좋았지만,
 * 해시 문서를 누구나 읽을 수 있어서 개발자도구로 비교를 건너뛰면
 * 남의 계정으로 들어갈 수 있었다. 게임의 누출 방지가 전부 로그인
 * 증표(uid) 위에 서 있으니, 그 증표를 아무나 만들 수 있으면 규칙도
 * views도 의미가 없다.
 *
 * 이제 비밀번호는 TLS 위로 서버까지만 가고, 저장은 여전히 소금 +
 * PBKDF2 해시뿐이다. 통과하면 서버가 Firebase 로그인 증표를 만들어
 * 주고 여기서 그걸로 로그인한다.
 */
interface AuthReply {
  id: string
  uid: string
  token: string
  nickname: string
  avatar: unknown
}

async function enter(reply: AuthReply): Promise<Account> {
  if (!auth) throw new Error('서버에 연결되어 있지 않다.')
  await signInWithCustomToken(auth, reply.token)
  return {
    id: reply.id,
    nickname: reply.nickname ?? '',
    avatar: reply.avatar ? normalizeLook(reply.avatar as Parameters<typeof normalizeLook>[0]) : null,
  }
}

export async function signUp(rawId: string, password: string): Promise<Account> {
  const id = normalizeId(rawId)
  checkCredentials(id, password)
  return enter(await callServer<AuthReply>('signUpAccount', { id, password }))
}

export async function logIn(rawId: string, password: string): Promise<Account> {
  const id = normalizeId(rawId)
  const wrong = new Error('아이디나 비밀번호가 맞지 않는다.')
  if (!ID_RE.test(id) || password.length < MIN_PASSWORD) throw wrong
  return enter(await callServer<AuthReply>('logInAccount', { id, password }))
}

/**
 * 운영자 코드를 맞히면 운영자가 된다.
 *
 * 표시만 붙여서는 안 된다. 지금 들고 있는 증표에는 그 표시가 없고,
 * 증표를 새로 고쳐도 안 붙는다(만들 때 실은 클레임이 덮어쓴다).
 * 그래서 서버가 새 증표를 만들어 주고 그걸로 다시 들어간다.
 */
export async function claimHost(code: string): Promise<void> {
  if (!auth) throw new Error('서버에 연결되어 있지 않다.')
  const reply = await callServer<{ token: string }>('claimHost', { code: code.trim() })
  await signInWithCustomToken(auth, reply.token)
}

/** 지금 이 사람이 운영자인가. 증표 안에 적혀 온다. */
export async function amHost(): Promise<boolean> {
  const user = auth?.currentUser
  if (!user) return false
  const res = await user.getIdTokenResult()
  return res.claims.admin === true
}

/** 지금 로그인한 사람의 Firebase uid. 게임 문서의 열쇠다. */
export function myUid(): string | null {
  return auth?.currentUser?.uid ?? null
}

export async function logOut(): Promise<void> {
  if (auth) await signOut(auth)
}

/** 계정에 붙은 닉네임과 모습을 갱신한다. 비밀번호 쪽은 건드리지 않는다. */
export async function saveAccountCharacter(_id: string, nickname: string, avatar: AvatarLook): Promise<void> {
  // 서버가 로그인한 본인 계정에만 적는다. 아이디를 받지 않는 이유는
  // 남의 계정 이름을 넣어 보내는 길을 아예 두지 않기 위해서다
  await callServer('saveCharacter', { nickname, avatar })
}

// ── 진행자용 ────────────────────────────────────────────────────

/** 가입한 계정을 전부 펴 본다. 소금·해시는 다른 문서에 있어 딸려 나오지 않는다. */
export async function listAccounts(): Promise<AccountSummary[]> {
  const snap = await getDocs(accountsCol()).catch((e) => {
    throw friendly(e)
  })
  return snap.docs
    .map((d) => {
      const r = d.data() as AccountDoc
      return {
        id: d.id,
        nickname: typeof r.nickname === 'string' ? r.nickname : '',
        createdAtMs: typeof r.createdAtMs === 'number' ? r.createdAtMs : 0,
      }
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
}

/**
 * 계정 하나를 지운다.
 *
 * 비밀번호 문서는 이제 서버만 읽고 쓰므로 여기서 못 지운다. 계정
 * 문서를 지우면 로그인이 막히고, 남은 해시 문서는 아무 열쇠도 열지
 * 못하는 조각이 된다.
 */
export async function deleteAccount(rawId: string): Promise<void> {
  const id = normalizeId(rawId)
  if (!ID_RE.test(id)) throw new Error('그런 아이디는 없다.')
  await deleteDoc(accountRef(id)).catch((e) => {
    throw friendly(e)
  })
}
