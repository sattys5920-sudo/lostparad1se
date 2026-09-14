// 쪽지를 진짜 서버로.
//
// 확인할 것은 하나다. **적힌 것이 주워서 읽은 사람 말고는 아무에게도
// 안 간다.** 바닥에 있는 쪽지는 그 방에 선 사람에게 「한 장 있다」까지고,
// 들고만 있으면 아직 안 보이고, 넘겨주면 새 주인에게 간다.
//
// 문장 표가 번들에 안 실리는지는 check:bundle 이 따로 본다.
//
//   npx vite-node scripts/slip-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { SLIPS_PER_PHASE } from '../shared/reveal/slips'
import { stepToward } from '../shared/rules/occupy'

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

const GAME = `sl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
/** 서버만 보는 쪽지 전부. 시험이 판을 짜는 데만 쓴다. */
const allSlips = async () => await getAll(`games/${GAME}/secret/slips/items`)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'slip' })
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
  check(true, '판이 시작했다')

  console.log('\n── 페이즈가 닫히면 쪽지가 떨어진다 ──')
  check((await allSlips()).length === 0, '처음에는 한 장도 없다')
  await must('openPhase', host, { gameId: GAME })
  const closed = await must('closePhase', host, { gameId: GAME })
  check(Number(closed.slips) === SLIPS_PER_PHASE, `${SLIPS_PER_PHASE}장 떨어졌다`, `${closed.slips}장`)
  const floor = await allSlips()
  check(floor.every((s) => s.d.heldBy === null && s.d.tileId !== null), '전부 바닥에 있다')
  check(
    floor.every((s) => !String(s.d.tileId).startsWith('base')),
    '기지에는 안 떨어진다',
    floor.map((s) => s.d.tileId).join(','),
  )

  console.log('\n── 누구도 직접 못 읽는다 ──')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/slips/items`, {
    headers: { Authorization: `Bearer ${A[0].token}` },
  })
  check(asPlayer.status === 403, '쪽지 컬렉션을 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/slips/items`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 못 읽는다', String(asHost.status))

  console.log('\n── 같은 방이어야 보인다 ──')
  // 쪽지 한 장을 고르고, 그 방으로 A0 를 걸어 보낸다
  const target = floor[0]
  const goal = String(target.d.tileId)
  for (let i = 0; i < 8; i++) {
    const here = (await pawnsNow())[A[0].uid].tileId as string
    if (here === goal) break
    const next = stepToward(here, goal)
    if (!next) break
    const r = await call('roamTo', A[0].token, { gameId: GAME, tileId: next })
    if (!r.ok) break
  }
  check((await pawnsNow())[A[0].uid].tileId === goal, `${goal}까지 걸어갔다`)

  const mine = await viewOf(A[0].uid)
  const others = await viewOf(B[0].uid)
  const hereIds = ((mine.slipsHere as { id: string }[]) ?? []).map((s) => s.id)
  check(hereIds.includes(target.id), '그 방에 서니 한 장 있는 것이 보인다', `${hereIds.length}장`)
  check(!JSON.stringify(mine.slipsHere).includes(String(target.d.subjectId)), '**누구 것인지는 안 온다**')
  check(
    !((others.slipsHere as { id: string }[]) ?? []).some((s) => s.id === target.id),
    '다른 방 사람에게는 있다는 것조차 안 간다',
  )

  console.log('\n── 주워도 읽어야 보인다 ──')
  await must('takeSlip', A[0].token, { gameId: GAME, slipId: target.id })
  let held = ((await viewOf(A[0].uid)).mySlips as { id: string; read: boolean; line: string | null }[]) ?? []
  const one = held.find((s) => s.id === target.id)
  check(one !== undefined, '손에 들어왔다')
  check(one?.read === false && one?.line === null, '**들고만 있으면 문장이 안 온다**')
  check(!((await viewOf(A[0].uid)).slipsHere as unknown[]).some((s) => (s as { id: string }).id === target.id), '바닥에서 사라졌다')

  const gone = await call('takeSlip', B[0].token, { gameId: GAME, slipId: target.id })
  check(gone.code === 'FAILED_PRECONDITION', '남이 주운 것은 못 줍는다', gone.message)

  await must('readSlip', A[0].token, { gameId: GAME, slipId: target.id })
  held = ((await viewOf(A[0].uid)).mySlips as { id: string; read: boolean; line: string | null }[]) ?? []
  const read = held.find((s) => s.id === target.id)
  check(read?.read === true && typeof read?.line === 'string', '읽으니 문장이 왔다', String(read?.line))
  check(!JSON.stringify(await viewOf(B[0].uid)).includes(String(read?.line)), '**남에게는 안 간다**')

  console.log('\n── 처리: 두기 · 건네기 · 찢기 ──')
  await must('dropSlip', A[0].token, { gameId: GAME, slipId: target.id })
  check(
    ((await viewOf(A[0].uid)).slipsHere as { id: string }[]).some((s) => s.id === target.id),
    '두고 나니 다시 바닥에 있다',
  )
  await must('takeSlip', A[0].token, { gameId: GAME, slipId: target.id })

  // 같은 방으로 팀원을 부른다
  const mate = A[1]
  for (let i = 0; i < 8; i++) {
    const here = (await pawnsNow())[mate.uid].tileId as string
    if (here === goal) break
    const next = stepToward(here, goal)
    if (!next) break
    const r = await call('roamTo', mate.token, { gameId: GAME, tileId: next })
    if (!r.ok) break
  }
  const far = await call('giveSlip', A[0].token, { gameId: GAME, slipId: target.id, toPlayerId: B[0].uid })
  check(far.code === 'FAILED_PRECONDITION', '멀리 있는 사람에게는 못 건넨다', far.message)
  await must('giveSlip', A[0].token, { gameId: GAME, slipId: target.id, toPlayerId: mate.uid })
  const mateSlips = ((await viewOf(mate.uid)).mySlips as { id: string; read: boolean }[]) ?? []
  check(mateSlips.some((s) => s.id === target.id), '건네받았다')
  check(mateSlips.find((s) => s.id === target.id)?.read === false, '**받은 사람은 다시 읽어야 한다**')
  check(!((await viewOf(A[0].uid)).mySlips as unknown[]).some((s) => (s as { id: string }).id === target.id), '내 손에서는 떠났다')

  const notMine = await call('tearSlip', A[0].token, { gameId: GAME, slipId: target.id })
  check(notMine.code === 'PERMISSION_DENIED', '남의 손에 있는 것은 못 찢는다', notMine.message)

  await must('tearSlip', mate.token, { gameId: GAME, slipId: target.id })
  check(!((await viewOf(mate.uid)).mySlips as unknown[]).some((s) => (s as { id: string }).id === target.id), '찢으니 사라졌다')
  for (const p of people) {
    const j = JSON.stringify(await viewOf(p.uid))
    if (j.includes(String(read?.line))) {
      check(false, '찢긴 문장이 아직 누군가에게 간다', p.uid)
      break
    }
  }
  check(true, '**찢긴 쪽지는 아무에게도 안 간다**')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
