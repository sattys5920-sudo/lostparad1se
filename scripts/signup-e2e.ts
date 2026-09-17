// 가입 데이터 정리를 **진짜 서버로** 확인한다.
//
// 운영자가 목록을 펴고 고른 것을 지운다. 여기서 보는 것:
// 운영자가 아니면 막히는가, 비밀번호에 관한 것이 섞여 나오지 않는가,
// 지우면 로그인까지 막히는가, 판의 명단은 그대로인가, 같은 아이디로
// 다시 가입하면 같은 uid 로 돌아오는가.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/signup-e2e.ts
import { createHash } from 'node:crypto'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const TAG = String(Date.now()).slice(-6)
const PW = 'signuppass1'
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function asPlayer(id: string, password = PW): Promise<string> {
  const custom = String((await call('logInAccount', null, { id, password })).token ?? '')
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
async function exists(path: string): Promise<boolean> {
  return (await fetch(`${FS}/${path}`, { headers: ADMIN })).ok
}

interface Row { id: string; nickname: string; face: boolean; playing: boolean }

async function main(): Promise<void> {
  // 운영자 계정 — 사람이 쓰는 문으로 만들고 표시만 붙인다
  const bossId = `boss${TAG}`
  await call('signUpAccount', null, { id: bossId, password: PW })
  // **한 번 들어와야 Auth 에 사람이 생긴다.** 증표를 만드는 것만으로는
  // 사용자 기록이 없어서, 운영자 표시를 붙일 자리가 없다
  await asPlayer(bossId)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(bossId), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await asPlayer(bossId)

  const a = `alpha${TAG}`
  const b = `beta${TAG}`
  await call('signUpAccount', null, { id: a, password: PW })
  await call('signUpAccount', null, { id: b, password: PW })
  const plain = await asPlayer(a)

  console.log('\n── 운영자만 본다 ──')
  const noList = await call('hostAccounts', plain, {}).then(() => '', (e: Error) => e.message)
  check(noList.includes('운영자만'), '가입자가 목록을 못 편다', noList)
  const noKill = await call('hostDeleteAccounts', plain, { ids: [b] }).then(() => '', (e: Error) => e.message)
  check(noKill.includes('운영자만'), '가입자가 남을 못 지운다', noKill)
  check(await exists(`schoolSessions/live/accounts/${b}`), '거절당한 계정은 그대로 있다')

  console.log('\n── 목록 ──')
  const rows = ((await call('hostAccounts', host, {})).rows ?? []) as Row[]
  const mine = rows.find((r) => r.id === a)
  check(mine !== undefined, '방금 가입한 것이 목록에 있다')
  // **비밀번호에 관한 것이 한 글자도 섞이면 안 된다**
  const leaked = JSON.stringify(rows).match(/salt|hash|password/i)
  check(leaked === null, '소금·해시가 안 딸려 나온다', leaked ? String(leaked[0]) : '')
  check(mine?.face === false, '얼굴을 안 만든 것이 보인다')

  console.log('\n── 내 것은 못 지운다 ──')
  const self = await call('hostDeleteAccounts', host, { ids: [bossId] })
  check((self.gone as string[]).length === 0, '운영자가 제 계정을 못 지운다')
  check(((self.kept as { id: string; why: string }[])[0] ?? {}).why === '내 계정이다', '까닭을 말해 준다')

  console.log('\n── 지운다 ──')
  const out = await call('hostDeleteAccounts', host, { ids: [b, `없는${TAG}`] })
  check((out.gone as string[]).includes(b), `${b} 를 지웠다`)
  check((out.kept as { id: string }[]).length === 1, '없는 아이디는 못 지웠다고 말한다')
  check(!(await exists(`schoolSessions/live/accounts/${b}`)), '계정 문서가 없다')
  check(!(await exists(`schoolSessions/live/accounts/${b}/auth/secret`)), '비밀번호 문서도 같이 없앴다')

  const back = await call('logInAccount', null, { id: b, password: PW }).then(() => '', (e: Error) => e.message)
  check(back.length > 0, '지운 계정으로는 못 들어온다', back)

  console.log('\n── 판의 명단은 안 건드린다 ──')
  const GAME = `sg${TAG}`
  await call('createGame', host, { gameId: GAME, seed: 'sg' })
  const c = `gamma${TAG}`
  await call('signUpAccount', null, { id: c, password: PW })
  await call('joinGame', await asPlayer(c), { gameId: GAME, name: '감마', team: 'A' })
  await call('hostDeleteAccounts', host, { ids: [c] })
  const g = await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })
  const seats = ((await g.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } } }
  }).fields?.seats?.arrayValue?.values ?? []
  check(seats.length === 1, '앉은 자리는 그대로 남는다', `${seats.length}자리`)

  console.log('\n── 같은 아이디로 다시 가입하면 ──')
  const again = await call('signUpAccount', null, { id: c, password: 'brandnew1' })
  check(again.uid === uidOf(c), '같은 uid 로 돌아온다 — 앉아 있던 자리로 간다', String(again.uid))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
