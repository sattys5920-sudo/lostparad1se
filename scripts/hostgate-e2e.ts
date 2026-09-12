// 운영자 코드.
//
// 확인할 것 셋.
//
//   틀린 코드로는 안 된다. 두들기면 잠긴다
//   맞히면 판을 만들 수 있다 — 표시만 붙고 증표가 그대로면 소용없다
//   코드가 서버에 없으면 아무도 못 들어간다. 열려 버리는 쪽이 최악이다
//
//   HOST_CODE=... npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/hostgate-e2e.ts
import { HOST_GATE_MAX_MISSES } from '../shared/rules/v2'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
/** 에뮬레이터를 띄운 쪽과 같은 값이어야 한다. */
const CODE = process.env.HOST_CODE ?? 'test-host-code'

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
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
/** 커스텀 증표를 진짜 로그인 증표로 바꾼다. 화면이 하는 일과 같다. */
async function exchange(customToken: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string }
  return j.idToken
}
/** 잠금 카운터를 지운다. 판마다 새로 시작해야 서로 간섭하지 않는다. */
async function resetGate(): Promise<void> {
  await fetch(`${FS}/hostGate/state`, { method: 'DELETE', headers: ADMIN })
}

const GAME = `hg${Date.now()}`

async function main(): Promise<void> {
  console.log(`코드 「${CODE}」\n── 채비 ──`)
  await resetGate()
  const me = await auth(await signUp(`hg-${GAME}@x.test`))
  check(true, '평범한 계정으로 들어왔다')

  console.log('\n── 코드 없이는 ──')
  const noHost = await call('createGame', me.token, { gameId: GAME })
  check(noHost.code === 'PERMISSION_DENIED', '판을 못 만든다', noHost.message)

  console.log('\n── 틀린 코드 ──')
  const wrong = await call('claimHost', me.token, { code: '아무거나' })
  check(wrong.code === 'PERMISSION_DENIED', '거절한다', wrong.message)
  check(!JSON.stringify(wrong).includes(CODE), '거절 응답에 코드가 없다')

  // 길이가 같고 한 글자만 다른 것도 막아야 한다
  const near = CODE.slice(0, -1) + (CODE.endsWith('1') ? '2' : '1')
  check((await call('claimHost', me.token, { code: near })).code === 'PERMISSION_DENIED', '한 글자만 달라도 거절')

  console.log('\n── 두들기면 잠근다 ──')
  let locked = ''
  for (let i = 0; i < HOST_GATE_MAX_MISSES + 2; i++) {
    const r = await call('claimHost', me.token, { code: `틀림${i}` })
    if (r.code === 'RESOURCE_EXHAUSTED') { locked = r.message ?? ''; break }
  }
  check(locked !== '', `${HOST_GATE_MAX_MISSES}번 틀리면 잠긴다`, locked)
  // 잠긴 동안에는 **맞는 코드도** 안 통해야 한다. 아니면 세는 의미가 없다
  check((await call('claimHost', me.token, { code: CODE })).code === 'RESOURCE_EXHAUSTED', '잠긴 동안에는 맞는 코드도 안 통한다')

  console.log('\n── 맞히면 ──')
  await resetGate()
  const got = await call('claimHost', me.token, { code: CODE })
  check(got.ok, '통과한다', got.message)
  check(typeof got.data?.token === 'string', '새 증표를 준다')

  // 옛 증표로는 여전히 안 된다 — 표시는 증표 안에 있다
  check((await call('createGame', me.token, { gameId: `${GAME}old` })).code === 'PERMISSION_DENIED', '옛 증표로는 아직 못 만든다')

  const hostToken = await exchange(got.data?.token as string)
  const made = await call('createGame', hostToken, { gameId: GAME })
  check(made.ok, '새 증표로는 판을 만든다', made.message)

  console.log('\n── 센 것이 지워졌는가 ──')
  const gate = await fetch(`${FS}/hostGate/state`, { headers: ADMIN })
  const body = gate.ok ? await gate.text() : ''
  check(!body.includes(CODE), '잠금 문서에 코드가 없다')
  const asPlayer = await fetch(`${FS}/hostGate/state`, { headers: { Authorization: `Bearer ${me.token}` } })
  check(asPlayer.status === 403, '잠금 문서는 아무도 못 읽는다', String(asPlayer.status))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
