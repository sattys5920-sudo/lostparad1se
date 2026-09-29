// 투명인간은 칸을 차지하지 않는다.
//
//   - 남에게 안 보이는 사람이 칸을 막으면, 그 칸에 서려다 튕긴 사람이
//     거기 누가 있는지 알게 된다 — 그래서 투명인간 칸에도 선다(누가 서 있다 X)
//   - 판의 불변 검사(hostInvariants)가 그 겹침을 어긋남으로 세지 않는다
//   - 투명이 풀리면(운영자가 풀거나 · 다음 투표가 열리면) 겹친 투명인간을
//     가까운 빈 칸으로 비켜 세운다 — 한 칸에 둘이 남지 않는다
//
//   npx vite-node scripts/ghost-cell-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
function plain(v: any): any {
  if (v === null || typeof v !== 'object') return v
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(plain)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]))
  if ('fields' in v) return Object.fromEntries(Object.entries(v.fields).map(([k, x]) => [k, plain(x)]))
  return v
}
async function signUp(e: string) { await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e }
async function setAdmin(e: string) {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string) {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }; return { uid: j.localId, token: j.idToken }
}
async function call(n: string, tk: string, d: unknown): Promise<any> {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as any
  return j.error ? { ok: false, code: j.error.status, message: j.error.message } : { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown) { const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data }
import { roomOfCell } from '../shared/rules/board'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const GAME = `gh${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
async function getDoc(path: string) { return plain(await (await fetch(`${FS}/${path}`, { headers: ADMIN })).json()) as Record<string, any> }
type At = { x: number; y: number }
const atOf = async (uid: string) => (await getDoc(`games/${GAME}/pawns/${uid}`)).at as At
const same = (a: At | null, b: At | null) => !!a && !!b && a.x === b.x && a.y === b.y
async function stacked(): Promise<string[]> {
  const r = await fetch(`${FS}/games/${GAME}/pawns?pageSize=300`, { headers: ADMIN })
  const docs = ((await r.json()) as { documents?: unknown[] }).documents ?? []
  const seen = new Map<string, number>()
  for (const d of docs.map(plain) as { tileId: string | null; at: At | null }[]) {
    if (d.tileId !== null && d.at) seen.set(`${d.at.x},${d.at.y}`, (seen.get(`${d.at.x},${d.at.y}`) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`)
}
async function ghostOn(uid: string) {
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=invisibleId`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { invisibleId: { stringValue: uid } } }),
  })
}

async function main() {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'gh' })
  const people: { uid: string; token: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`)); people.push(a)
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const [X, Y, Z] = people

  console.log('\n── 투명인간 칸에 선다 ──')
  const xAt = await atOf(X.uid)
  await ghostOn(X.uid)
  const r = await call('standAt', Y.token, { gameId: GAME, x: xAt.x, y: xAt.y })
  check(r.ok && r.data.ok !== false, '투명인간이 선 칸에 설 수 있다 — 「누가 서 있다」로 튕기지 않는다', JSON.stringify(r.data ?? r.message))
  check(same(await atOf(Y.uid), xAt), '선 사람은 그 칸에 적혔다', JSON.stringify(await atOf(Y.uid)))
  const inv = (await must('hostInvariants', host, { gameId: GAME })) as { violations?: { kind: string }[] }
  const shared = (inv.violations ?? []).filter((i) => i.kind === 'cellShared')
  check(shared.length === 0, '불변 검사가 투명인간 겹침을 어긋남으로 안 센다', JSON.stringify(shared))

  console.log('\n── 운영자가 투명을 풀면 비켜 선다 ──')
  await must('clearInvisible', host, { gameId: GAME, reason: 'e2e' })
  const xAfter = await atOf(X.uid)
  check(!same(xAfter, xAt), '풀린 사람은 다른 칸으로 옮겨졌다', `${JSON.stringify(xAt)} → ${JSON.stringify(xAfter)}`)
  check(roomOfCell(xAfter.x, xAfter.y) === roomOfCell(xAt.x, xAt.y), '같은 방 안의 칸이다')
  check(same(await atOf(Y.uid), xAt), '먼저 선 사람은 그 자리 그대로다')
  check((await stacked()).length === 0, '판 전체에 한 칸에 둘이 선 곳이 없다', (await stacked()).join(' '))

  console.log('\n── 다음 투표가 열리면 비켜 선다 ──')
  const x2 = await atOf(X.uid)
  await ghostOn(X.uid)
  const r2 = await call('standAt', Z.token, { gameId: GAME, x: x2.x, y: x2.y })
  check(r2.ok && r2.data.ok !== false, '다시 투명해진 사람 칸에도 선다', JSON.stringify(r2.data ?? r2.message))
  await must('hostOpenBallot', host, { gameId: GAME })
  const g = await getDoc(`games/${GAME}`)
  check(!g.invisibleId, '투표가 열리면서 투명이 풀렸다')
  check(!same(await atOf(X.uid), x2), '풀린 사람은 다른 칸으로 옮겨졌다', JSON.stringify(await atOf(X.uid)))
  check((await stacked()).length === 0, '판 전체에 한 칸에 둘이 선 곳이 없다', (await stacked()).join(' '))

  console.log('\n── 안 겹쳤으면 안 옮긴다 ──')
  const x3 = await atOf(X.uid)
  await ghostOn(X.uid)
  await must('clearInvisible', host, { gameId: GAME, reason: 'e2e' })
  check(same(await atOf(X.uid), x3), '아무도 그 칸에 안 섰으면 그 자리 그대로다')

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
