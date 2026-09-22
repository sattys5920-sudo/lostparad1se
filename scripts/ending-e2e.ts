// 엔딩은 운영자가 적는다. 화면은 받아 적은 것만 보여 준다.
//
// 제일 중요한 확인은 둘이다. **종례 전에는 한 줄도 안 나간다.**
// 그리고 **남의 몫은 어떤 경로로도 안 나간다** — 운영자가 열넷에게
// 따로 적어도, 각자에게 가는 것은 「모두에게」와 제 몫 둘뿐이다.
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'

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
  if ('mapValue' in o) { const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}; return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)])) }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function signUp(e: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e
}
async function setAdmin(e: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }; return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}

const GAME = `end${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const ALL = '전원에게 가는 글. 닷새가 끝났다.'

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'end' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  const me = people[0]
  const other = people[7]
  check(true, '판이 시작했다')

  console.log('\n── 운영자가 적는다 ──')
  await must('hostSetEnding', host, { gameId: GAME, toPlayerId: '__all', text: ALL })
  await must('hostSetEnding', host, { gameId: GAME, toPlayerId: me.uid, text: '너는 끝까지 문 앞에 있었다.' })
  await must('hostSetEnding', host, { gameId: GAME, toPlayerId: other.uid, text: '너는 웃으면서 복도를 지났다.' })
  const rows = (await must('hostEndings', host, { gameId: GAME })) as { rows: { to: string; text: string }[] }
  check(rows.rows.length === 3, '적어 둔 것이 셋이다', `${rows.rows.length}개`)

  const notHost = await call('hostEndings', me.token, { gameId: GAME })
  check(notHost.code === 'PERMISSION_DENIED', '참가자는 남의 몫을 못 본다', notHost.code)
  const notHostWrite = await call('hostSetEnding', me.token, { gameId: GAME, toPlayerId: me.uid, text: '내가 쓴다' })
  check(notHostWrite.code === 'PERMISSION_DENIED', '참가자는 엔딩을 못 적는다', notHostWrite.code)

  console.log('\n── 종례 전에는 ──')
  await clock(dayHourMs(START, 1, 12))
  const early = await call('myEnding', me.token, { gameId: GAME })
  check(early.code === 'FAILED_PRECONDITION', 'DAY 1에는 아무것도 안 나온다', early.message)
  check(!JSON.stringify(early).includes('문 앞'), '거절 응답에도 문장이 없다')

  await clock(dayHourMs(START, 5, 20))
  await must('tick', me.token, { gameId: GAME })
  const late = await call('myEnding', me.token, { gameId: GAME })
  check(late.code === 'FAILED_PRECONDITION', 'DAY 5 저녁에도 아직이다', late.message)

  console.log('\n── 종례 뒤 ──')
  //
  // **시계가 판을 끝내지 않는다.** 달력 칸은 운영자가 하나씩 민다 —
  // 닷새치를 다 밀어야 phase 가 finished 가 된다
  await clock(dayHourMs(START, 5, 25))
  await must('tick', me.token, { gameId: GAME })
  for (let i = 0; i < 40; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { phase?: string; pushed?: string | null }
    if (r.phase === 'finished' || r.pushed === null) break
  }
  check(
    ((await must('peekDay', host, { gameId: GAME })) as { next?: unknown }) !== null,
    '달력을 끝까지 밀었다',
  )
  const mineOut = (await must('myEnding', me.token, { gameId: GAME })) as { text: string }
  check(mineOut.text.includes(ALL), '모두에게 적은 글이 온다')
  check(mineOut.text.includes('문 앞'), '내 몫이 온다')
  check(!mineOut.text.includes('복도를 지났다'), '남의 몫은 안 온다', mineOut.text)
  check(mineOut.text.indexOf(ALL) < mineOut.text.indexOf('문 앞'), '모두에게가 먼저 온다')

  const otherOut = (await must('myEnding', other.token, { gameId: GAME })) as { text: string }
  check(otherOut.text.includes('복도를 지났다') && !otherOut.text.includes('문 앞'), '사람마다 제 몫만 온다')

  const blank = people[3]
  const blankOut = (await must('myEnding', blank.token, { gameId: GAME })) as { text: string }
  check(blankOut.text === ALL, '안 적어 준 사람에게는 모두에게 것만 온다', blankOut.text)

  console.log('\n── 지우기 ──')
  await must('hostSetEnding', host, { gameId: GAME, toPlayerId: other.uid, text: '  ' })
  const gone = (await must('myEnding', other.token, { gameId: GAME })) as { text: string }
  check(gone.text === ALL, '빈 글을 넣으면 지워진다', gone.text)

  console.log('\n── 판에 없는 사람 ──')
  const outsider = await auth(await signUp(`out-${GAME}@x.test`))
  const no = await call('myEnding', outsider.token, { gameId: GAME })
  check(no.code === 'PERMISSION_DENIED', '구경꾼에게는 안 준다', no.code)
  check(!JSON.stringify(no).includes('닷새가 끝났다'), '거절 응답에 문장이 없다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
