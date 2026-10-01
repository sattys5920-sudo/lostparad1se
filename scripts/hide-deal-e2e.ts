// 배정 숨기기 — 분단 · 역할을 미리 정해 두고 화면에는 안 보이다가 「연습 끝 · DAY 1 시작」에서 학생증으로 공개한다
//
//   npx vite-node scripts/hide-deal-e2e.ts
import { createHash } from 'node:crypto'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `hd${TAG}`
const PW = 'hdpass1234'
const QA = `qahd${TAG}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
const no = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message)
async function tok(id: string, password = PW): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const str = (v: unknown) => (v as { stringValue?: string })?.stringValue ?? null

async function doc(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
const num = (v: unknown) => Number((v as { integerValue?: string })?.integerValue ?? NaN)
const bool = (v: unknown) => (v as { booleanValue?: boolean })?.booleanValue ?? null
type Seat = { playerId: string | null; team: string | null; dealtAtMs: number }
async function seatsOf(): Promise<Seat[]> {
  const f = await doc(`games/${GAME}`)
  const rows = (f.seats as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue?.values ?? []
  return rows.map((r) => {
    const x = r.mapValue?.fields ?? {}
    return { playerId: str(x.playerId), team: str(x.team), dealtAtMs: num(x.dealtAtMs) }
  })
}

async function main(): Promise<void> {
  const email = `host-${TAG}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const host = ((await inn.json()) as { idToken: string }).idToken
  await call('createGame', host, { gameId: GAME, seed: 'hd' })

  const aId = `ha${TAG}`
  await call('signUpAccount', null, { id: aId, password: PW })
  const tkA = await tok(aId)
  await call('joinGame', tkA, { gameId: GAME, name: '숨긴쪽' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  const a = uidOf(aId)

  console.log('\n── 로비: 숨기기 켜고 배정 ──')
  check((await no(call('hostSetHideDeal', tkA, { gameId: GAME, on: true }))) !== '', '참가자는 못 켠다')
  await call('hostSetHideDeal', host, { gameId: GAME, on: true })
  check(bool((await doc(`games/${GAME}`)).hideDeal) === true, '숨기기가 켜진다')
  await call('assignAll', host, { gameId: GAME })
  check((await seatsOf()).every((s) => s.team !== null), '배정은 그대로 된다(서버에는 분단이 있다)')
  check((await no(call('myPaper', tkA, { gameId: GAME }))).includes('배정되지 않았다'), '**「나」 탭은 「배정 전」이다 — 역할이 안 온다**')

  console.log('\n── 연습 ──')
  await call('startGame', host, { gameId: GAME, startAtMs: START, practice: true })
  const g1 = await doc(`games/${GAME}`)
  check(bool(g1.practice) === true && bool(g1.hideDeal) === true, '연습으로 서도 숨긴 채다')
  check((await no(call('myPaper', tkA, { gameId: GAME }))).includes('배정되지 않았다'), '연습 중에도 역할이 안 온다')

  console.log('\n── 연습 끝 · DAY 1 시작 ──')
  const ended = await call('hostEndPractice', host, { gameId: GAME })
  const g2 = await doc(`games/${GAME}`)
  const started = num(g2.startedAtMs)
  check(bool(g2.hideDeal) === false && bool(g2.practice) === false, '**숨기기가 풀린다**')
  const mine = (await seatsOf()).find((s) => s.playerId === a)
  check(!!mine && mine.dealtAtMs >= started && mine.dealtAtMs === Number(ended.startedAtMs), '**배정 시각이 DAY 1 시작으로 새로 찍힌다 — 학생증 팝업이 뜬다**', `${mine?.dealtAtMs} vs ${started}`)
  const paper = await call('myPaper', tkA, { gameId: GAME })
  check(typeof paper.roleName === 'string' && paper.roleName.length > 0, '이제 역할이 온다', String(paper.roleName))
  check((await no(call('hostSetHideDeal', host, { gameId: GAME, on: true }))).includes('시작 전이나 연습'), '판이 돌면(연습 아님) 다시 숨길 수 없다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
