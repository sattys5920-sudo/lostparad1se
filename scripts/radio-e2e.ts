// 무전 — 팀 채널 · 전원 채널 · 운영자 엿듣기.
//
//   - 팀 채널 줄은 그 팀에게만 · 전원 채널 줄은 열넷 모두에게
//   - 지워진 사람은 무전으로 말할 수 없다 — 전원 · 분단 채널 모두(듣기는 한다)
//   - 운영자는 다섯 채널 목록과 한 채널의 줄을 본다 · 참가자는 못 본다
//   - 줄이 300 넘게 쌓여도 처음 켠 사람은 최근 줄을 받는다
//
//   npx vite-node scripts/radio-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'

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


const GAME = `rad${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
type Line = { playerId: string; text: string; team: string }

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'rad' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })

  const a = people[0]
  const mate = people.find((p) => p !== a && p.team === a.team)!
  const other = people.find((p) => p.team !== a.team)!
  const lines = async (p: { token: string }, channel: 'team' | 'all', sinceMs = 0) =>
    ((await must('radioLines', p.token, { gameId: GAME, sinceMs, channel })).lines as Line[])

  console.log('\n── 팀 채널 ──')
  await must('radio', a.token, { gameId: GAME, text: '팀에게만', channel: 'team' })
  check((await lines(mate, 'team')).some((l) => l.text === '팀에게만'), '같은 팀은 듣는다')
  check(!(await lines(other, 'team')).some((l) => l.text === '팀에게만'), '다른 팀은 못 듣는다')
  check(!(await lines(other, 'all')).some((l) => l.text === '팀에게만'), '전원 채널에도 안 섞인다')

  console.log('\n── 전원 채널 ──')
  await must('radio', a.token, { gameId: GAME, text: '모두에게', channel: 'all' })
  check((await lines(other, 'all')).some((l) => l.text === '모두에게'), '다른 팀도 듣는다')
  check(!(await lines(mate, 'team')).some((l) => l.text === '모두에게'), '팀 채널에는 안 섞인다')
  const here = (await must('radioLines', other.token, { gameId: GAME, channel: 'all' })).here as number
  check(here >= 1, '전원 채널의 수신 수는 팀을 가리지 않는다 — 다른 팀 사람이 센다', String(here))

  console.log('\n── 지워진 사람 ──')
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=invisibleId`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { invisibleId: { stringValue: other.uid } } }),
  })
  const refused = await call('radio', other.token, { gameId: GAME, text: '나야', channel: 'all' })
  check(!refused.ok && /말할 수 없다/.test(refused.message ?? ''), '전원 채널에 말할 수 없다', refused.message)
  check((await lines(other, 'all')).some((l) => l.text === '모두에게'), '듣기는 한다')
  // 지워진 동안에는 분단 채널에도 말할 수 없다(radio.ts). 듣기만 한다
  const teamNo = await call('radio', other.token, { gameId: GAME, text: '분단에도 안 된다', channel: 'team' })
  check(!teamNo.ok, '분단 채널에도 말할 수 없다', teamNo.ok ? '말해졌다' : teamNo.message)

  console.log('\n── 운영자 ──')
  const ov = (await must('hostRadioOverview', host, { gameId: GAME })).channels as { channel: string; lines: number }[]
  check(ov.length === 5, '채널 다섯', ov.map((c) => `${c.channel}:${c.lines}`).join(' '))
  check(ov.find((c) => c.channel === 'ALL')?.lines === 1, '전원 채널 한 줄')
  const hl = (await must('hostRadioLines', host, { gameId: GAME, channel: a.team })).lines as Line[]
  check(hl.some((l) => l.text === '팀에게만'), '운영자는 팀 채널 줄을 본다')
  const peek = await call('hostRadioOverview', a.token, { gameId: GAME })
  check(!peek.ok, '참가자는 운영자 목록을 못 본다', peek.code)
  const peek2 = await call('hostRadioLines', a.token, { gameId: GAME, channel: other.team })
  check(!peek2.ok, '참가자는 남의 팀 줄을 못 본다', peek2.code)

  console.log('\n── 줄이 많이 쌓였을 때 ──')
  for (let i = 0; i < 305; i += 1) await must('radio', mate.token, { gameId: GAME, text: `줄${i}`, channel: 'all' })
  const got = await lines(a, 'all')
  check(got.length === 300, '처음 켜면 300줄', String(got.length))
  check(got[got.length - 1]?.text === '줄304', '마지막 줄이 가장 최근 줄이다', got[got.length - 1]?.text)
  check(got.every((l, i) => i === 0 || l.text !== got[i - 1].text), '순서가 뒤집히지 않았다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
