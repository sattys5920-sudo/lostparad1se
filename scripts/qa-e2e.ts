// QA용 채우기.
//
// 확인할 것: 운영자만 되는가, 로비에서만 되는가, 만든 계정으로 진짜
// 로그인이 되는가. 마지막이 핵심이다 — 자리만 채우고 못 들어가면
// 확인해 볼 수가 없다.
//
//   npx vite-node scripts/qa-e2e.ts
import { TOTAL_SEATS } from '../shared/rules/lobby'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const CODE = process.env.HOST_CODE ?? 'test-host-code'
const QA_PW = 'qa-password-1'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function exchange(customToken: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })
  return ((await r.json()) as { idToken: string }).idToken
}

const GAME = `qa${Date.now()}`

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 채비 ──`)
  await fetch(`${FS}/hostGate/state`, { method: 'DELETE', headers: ADMIN })
  const plain = await auth(await signUp(`p-${GAME}@x.test`))
  check(true, '평범한 계정')

  console.log('\n── 운영자가 아니면 ──')
  check((await call('seedPlayers', plain.token, { gameId: GAME, password: QA_PW })).code === 'PERMISSION_DENIED', '못 채운다')

  const got = await call('claimHost', plain.token, { code: CODE })
  const host = await exchange(got.data?.token as string)
  await call('createGame', host, { gameId: GAME })
  check(true, '판을 만들었다')

  console.log('\n── 약한 비밀번호 ──')
  check((await call('seedPlayers', host, { gameId: GAME, password: 'short' })).code === 'INVALID_ARGUMENT', '8자 미만은 거절')

  console.log('\n── 채우기 ──')
  const r = await call('seedPlayers', host, { gameId: GAME, password: QA_PW })
  check(r.ok, '채웠다', r.message)
  check(r.data?.seated === TOTAL_SEATS - 1, `한 자리 남기고 ${TOTAL_SEATS - 1}명`, String(r.data?.seated))

  // 두 번 불러도 늘어나지 않아야 한다
  const again = await call('seedPlayers', host, { gameId: GAME, password: QA_PW })
  check(again.data?.seated === TOTAL_SEATS - 1, '두 번 불러도 그대로다', String(again.data?.seated))

  console.log('\n── 진짜 들어가지는가 ──')
  const login = await call('logInAccount', '', { id: 'qa01', password: QA_PW })
  check(login.ok, 'qa01 로 로그인된다', login.message)
  const bad = await call('logInAccount', '', { id: 'qa01', password: 'wrong-password' })
  check(bad.code === 'PERMISSION_DENIED', '틀린 비밀번호는 막힌다')

  console.log('\n── 팀이 고르게 퍼졌는가 ──')
  const g = await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })
  const doc = (await g.json()) as { fields: { seats: { arrayValue: { values: { mapValue: { fields: { team: { stringValue: string } } } }[] } } } }
  const teams = doc.fields.seats.arrayValue.values.map((v) => v.mapValue.fields.team.stringValue)
  const counts = ['A', 'B', 'C', 'D'].map((t) => teams.filter((x) => x === t).length)
  check(Math.max(...counts) - Math.min(...counts) <= 1, '한 팀에 몰리지 않았다', counts.join('/'))

  console.log('\n── 시작한 뒤에는 ──')
  const me = await auth(await signUp(`last-${GAME}@x.test`))
  await call('joinGame', me.token, { gameId: GAME, name: '나' })
  await call('startGame', host, { gameId: GAME, startAtMs: Date.UTC(2026, 2, 1, 23, 0, 0) })
  check((await call('seedPlayers', host, { gameId: GAME, password: QA_PW })).code === 'FAILED_PRECONDITION', '시작한 판은 못 채운다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
