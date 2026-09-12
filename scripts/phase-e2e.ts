// 페이즈를 진짜 서버로.
//
// 확인할 것은 셋이다.
//
//   자유 시간에 아무리 멀리 가도 **전선은 안 움직인다** — 페이즈가
//     열리면 제자리로 돌아온다
//   남이 무엇을 골랐는지 새지 않는다
//   머릿수가 많은 팀이 방을 가져가고, 동점이면 안 바뀐다
//
//   HOST_CODE=... npx vite-node scripts/phase-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { ROOM_KIND, capacityOf } from '../shared/rules/occupy'

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
function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return o.doubleValue
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plain)
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
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
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}

const GAME = `ph${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const ownerOfTile = async (id: string) =>
  ((await getAll(`games/${GAME}/tiles`)).find((t) => t.id === id)?.d.ownerTeam ?? null) as string | null

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'phase' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  check(true, '판이 시작했다')

  console.log('\n── 주장 ──')
  const started = await pawnsNow()
  const caps = Object.values(started).filter((p) => p.captain === true)
  check(caps.length === 2, '세 명뿐인 두 팀에만 주장이 있다', `${caps.length}명`)
  check(Object.values(started).every((p) => p.postTile === p.tileId), '전투 자리가 선 자리와 같게 시작한다')

  console.log('\n── 자유 시간은 전선을 못 옮긴다 ──')
  const a0 = A[0]
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'classroom' })
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'library' })
  let now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'library', '자유 시간에는 즉시 걸어 다닌다', String(now.tileId))
  check(now.postTile === 'baseA', '**전선은 그대로다**', String(now.postTile))

  const far = await call('roamTo', a0.token, { gameId: GAME, tileId: 'baseB' })
  check(far.code === 'FAILED_PRECONDITION', '옆방이 아니면 못 간다', far.message)

  console.log('\n── 페이즈를 열면 제자리로 ──')
  const opened = await must('openPhase', host, { gameId: GAME })
  check(opened.no === 1, '첫 페이즈가 열렸다', `${opened.no}번`)
  now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'baseA', '돌아다니던 사람이 제자리로 돌아왔다', String(now.tileId))
  check(Number(opened.returned) === 1, '돌아온 사람 수를 센다', `${opened.returned}명`)

  const roamNow = await call('roamTo', a0.token, { gameId: GAME, tileId: 'classroom' })
  check(roamNow.code === 'FAILED_PRECONDITION', '페이즈 중에는 함부로 못 움직인다')

  console.log('\n── 고른 것이 새는가 ──')
  await must('submitAction', a0.token, { gameId: GAME, kind: 'move', targetTile: 'classroom' })
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/actions/items`, { headers: { Authorization: `Bearer ${B[0].token}` } })
  check(asPlayer.status === 403, '남이 무엇을 골랐는지 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/actions/items`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 못 읽는다', String(asHost.status))
  const ready = await must('phaseReady', B[0].token, { gameId: GAME })
  check(ready.submitted === 1 && ready.total === TOTAL_SEATS, '몇 명이 냈는지만 알려 준다', `${ready.submitted}/${ready.total}`)
  check(!JSON.stringify(ready).includes('classroom'), '무엇을 골랐는지는 안 나간다')

  console.log('\n── 닫으면 한꺼번에 ──')
  // **주인 없는 칸으로 간다.** 교실은 A 기지에 붙어 있어 처음부터 A 것이라,
  // 거기서 이겨 봐야 아무것도 확인하지 못한다. 도서관은 어느 기지에도
  // 안 붙어 있어 비어 있다
  check((await ownerOfTile('library')) === null, '도서관은 처음에 주인이 없다', String(await ownerOfTile('library')))

  await must('submitAction', A[1].token, { gameId: GAME, kind: 'move', targetTile: 'classroom' })
  await must('submitAction', B[0].token, { gameId: GAME, kind: 'move', targetTile: 'artRoom' })
  await must('submitAction', B[1].token, { gameId: GAME, kind: 'move', targetTile: 'artRoom' })
  const closed = await must('closePhase', host, { gameId: GAME })
  check(Number(closed.no) === 1, '1번 페이즈가 닫혔다')
  const moved = await pawnsNow()
  check(moved[a0.uid].postTile === 'classroom', '전선이 옮겨졌다', String(moved[a0.uid].postTile))

  console.log('\n── 머릿수가 많은 팀이 가져간다 ──')
  await must('openPhase', host, { gameId: GAME })
  await must('submitAction', a0.token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  await must('submitAction', A[1].token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  await must('submitAction', B[0].token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', 'A 둘이 B 하나를 이겼다', String(await ownerOfTile('library')))
  const log2 = await getAll(`games/${GAME}/phaseLog`)
  check(JSON.stringify(log2).includes('captured'), '점령이 로그에 남았다')

  console.log('\n── 동점이면 안 바뀐다 ──')
  await must('openPhase', host, { gameId: GAME })
  await must('submitAction', B[1].token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', '2대2가 되어도 주인이 그대로다')

  console.log('\n── 아무도 없어도 주인은 남는다 ──')
  await must('openPhase', host, { gameId: GAME })
  await must('submitAction', a0.token, { gameId: GAME, kind: 'move', targetTile: 'classroom' })
  await must('submitAction', A[1].token, { gameId: GAME, kind: 'move', targetTile: 'classroom' })
  await must('submitAction', B[0].token, { gameId: GAME, kind: 'move', targetTile: 'artRoom' })
  await must('submitAction', B[1].token, { gameId: GAME, kind: 'move', targetTile: 'artRoom' })
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', '다 빠져나가도 A 것으로 남는다')

  console.log('\n── 주장은 둘로 센다 ──')
  // C 주장 하나가 자기 기지 옆 칸에서 A 하나와 맞선다
  const cap = C.find((p) => (started[p.uid] as { captain?: boolean }).captain === true)
  check(cap !== undefined, '주장을 찾았다')

  console.log('\n── 좁은 방은 둘까지 ──')
  const narrow = Object.entries(ROOM_KIND).find(([, k]) => k === 'narrow')?.[0] as string
  check(capacityOf(narrow) === 2, `${narrow}은 정원 2다`)

  console.log('\n── 페이즈가 아니면 못 낸다 ──')
  const late = await call('submitAction', a0.token, { gameId: GAME, kind: 'disguise' })
  check(late.code === 'FAILED_PRECONDITION', '닫힌 뒤에는 못 낸다', late.message)
  const notHost = await call('openPhase', a0.token, { gameId: GAME })
  check(notHost.code === 'PERMISSION_DENIED', '운영자만 페이즈를 연다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
