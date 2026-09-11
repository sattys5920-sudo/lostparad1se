// 계정 — 가입하고, 로그인하고, 그 계정에 캐릭터를 붙여 둔다.
//
// 인증 서버를 따로 두지 않고 Firestore에 계정 문서를 직접 만든다. 그래서
// 비밀번호를 그대로 적어 두면 문서를 열어 본 사람이 곧바로 남의 계정으로
// 들어올 수 있다. 비밀번호는 절대 보내지 않고, 계정마다 다른 소금을 섞어
// PBKDF2로 늘린 해시만 올린다.
//
// 해시는 계정 문서가 아니라 그 아래 따로 둔 문서에 넣는다.
//
//   accounts/{id}            닉네임·아바타 — 목록으로 훑을 수 있다
//   accounts/{id}/auth/secret  소금·해시 — 아이디를 정확히 알아야 한 건 읽는다
//
// 이렇게 갈라 두면 진행자가 가입자 목록을 펴 보고 정리할 수 있으면서도,
// 목록 한 번에 모든 해시가 딸려 나오지는 않는다.
//
// 이 방식의 한계는 분명히 해 둔다 — 아이디를 아는 사람이 그 계정의 해시
// 한 건을 읽어 가는 것까지는 막지 못한다. 친구들끼리 하는 비공개 판이라는
// 전제 위에 서 있다.
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeLook } from './char/look'
import type { AvatarLook } from './types'

/** 아이디에 허용하는 글자. 문서 id로 그대로 쓰므로 좁게 잡는다. */
const ID_RE = /^[a-z0-9_-]{3,16}$/
const MIN_PASSWORD = 6
const ITERATIONS = 120_000

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

interface SecretDoc {
  salt: string
  hash: string
}

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

function accountsCol() {
  return collection(requireDb(), 'schoolSessions', 'live', 'accounts')
}

function accountRef(id: string) {
  return doc(accountsCol(), id)
}

/** 소금과 해시가 사는 곳. 계정 문서와 따로 둬 목록에 딸려 나오지 않게 한다. */
function secretRef(id: string) {
  return doc(accountsCol(), id, 'auth', 'secret')
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

function randomSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
}

/**
 * 비밀번호를 해시로 바꾼다. 브라우저 안에서만 하고, 원문은 어디에도
 * 보내지 않는다. crypto.subtle은 https나 localhost에서만 쓸 수 있다.
 */
async function hashPassword(password: string, salt: string): Promise<string> {
  if (!crypto.subtle) throw new Error('이 브라우저에서는 로그인을 쓸 수 없다. https로 열어라.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return hex(bits)
}

/** 길이가 같은 두 글자열을 끝까지 비교한다 — 어디서 틀렸는지 시간으로 새지 않게. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function normalizeId(raw: string): string {
  return raw.trim().toLowerCase()
}

function checkCredentials(id: string, password: string): void {
  if (!ID_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·_·- 로 3~16자여야 한다.')
  if (password.length < MIN_PASSWORD) throw new Error(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 한다.`)
}

function accountFrom(id: string, record: AccountDoc): Account {
  return {
    id,
    nickname: typeof record.nickname === 'string' ? record.nickname : '',
    avatar: record.avatar ? normalizeLook(record.avatar) : null,
  }
}

/** 가입. 이미 있는 아이디면 거절한다 — 남의 계정을 덮어쓰지 못하게 트랜잭션 안에서 본다. */
export async function signUp(rawId: string, password: string): Promise<Account> {
  const id = normalizeId(rawId)
  checkCredentials(id, password)
  const salt = randomSalt()
  const hash = await hashPassword(password, salt)
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(accountRef(id))
    if (snap.exists()) throw new Error('이미 있는 아이디다.')
    tx.set(accountRef(id), { nickname: '', avatar: null, createdAtMs: Date.now() })
    tx.set(secretRef(id), { salt, hash })
  })
  return { id, nickname: '', avatar: null }
}

/**
 * 그 계정의 소금과 해시를 꺼낸다. 예전에 가입한 계정은 계정 문서 안에
 * 들어 있으므로 거기서도 찾아본다.
 */
async function readSecret(id: string, record: AccountDoc): Promise<SecretDoc | null> {
  const snap = await getDoc(secretRef(id))
  if (snap.exists()) return snap.data() as SecretDoc
  if (record.salt && record.hash) return { salt: record.salt, hash: record.hash }
  return null
}

/** 예전 모양으로 가입한 계정을 들어올 때 조용히 옮겨 둔다. */
async function migrateSecret(id: string, secret: SecretDoc): Promise<void> {
  await setDoc(secretRef(id), secret)
  await updateDoc(accountRef(id), { salt: deleteField(), hash: deleteField() })
}

/** 로그인. 아이디가 없을 때와 비밀번호가 틀렸을 때를 같은 말로 돌려준다. */
export async function logIn(rawId: string, password: string): Promise<Account> {
  const id = normalizeId(rawId)
  const wrong = new Error('아이디나 비밀번호가 맞지 않는다.')
  if (!ID_RE.test(id) || password.length < MIN_PASSWORD) throw wrong
  const snap = await getDoc(accountRef(id))
  if (!snap.exists()) throw wrong
  const record = snap.data() as AccountDoc
  const secret = await readSecret(id, record)
  if (!secret) throw wrong
  if (!sameHash(await hashPassword(password, secret.salt), secret.hash)) throw wrong
  if (record.salt || record.hash) await migrateSecret(id, secret).catch(() => {})
  return accountFrom(id, record)
}

/** 계정에 붙은 닉네임과 모습을 갱신한다. 비밀번호 쪽은 건드리지 않는다. */
export async function saveAccountCharacter(id: string, nickname: string, avatar: AvatarLook): Promise<void> {
  await setDoc(accountRef(id), { nickname, avatar }, { merge: true })
}

// ── 진행자용 ────────────────────────────────────────────────────

/** 가입한 계정을 전부 펴 본다. 소금·해시는 다른 문서에 있어 딸려 나오지 않는다. */
export async function listAccounts(): Promise<AccountSummary[]> {
  const snap = await getDocs(accountsCol())
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
 * 계정 하나를 지운다. 비밀번호 문서를 먼저 지우고 계정 문서를 지운다 —
 * 중간에 끊겨도 로그인할 수 없는 껍데기가 남을 뿐, 비밀번호만 남지는 않는다.
 */
export async function deleteAccount(rawId: string): Promise<void> {
  const id = normalizeId(rawId)
  if (!ID_RE.test(id)) throw new Error('그런 아이디는 없다.')
  await deleteDoc(secretRef(id)).catch(() => {})
  await deleteDoc(accountRef(id))
}
