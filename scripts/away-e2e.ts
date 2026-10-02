// 앱을 끈 사람 — 5 분 넘게 신호가 없으면 남의 맵에서 사라지고 칸을 안 막는다. 정원에는 센다
//
//   npx vite-node scripts/away-e2e.ts   (에뮬레이터가 떠 있어야 한다)
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



import { START_TILE } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'
import { AWAY_MS } from '../shared/rules/online'

const GAME = `away${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function pawnOf(uid: string): Promise<{ tileId: string | null; at: { x: number; y: number } | null }> {
  const d = plain(await (await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })).json()) as { tileId?: string | null; at?: { x: number; y: number } | null }
  return { tileId: d.tileId ?? null, at: d.at ?? null }
}
async function viewOf(uid: string): Promise<{ visibleIds?: string[]; roomCounts?: Record<string, number> }> {
  return plain(await (await fetch(`${FS}/games/${GAME}/views/${uid}`, { headers: ADMIN })).json()) as never
}
async function setSeen(uid: string, ms: number): Promise<void> {
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=seenMs`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { seenMs: { integerValue: String(ms) } } }),
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'away' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const [gone, walker, watcher, never] = people

  console.log('\n── 켜 있는 동안 ──')
  const first = await must('ping', gone.token, { gameId: GAME })
  check(first.ok === true && first.back === false, '처음 신호는 「돌아왔다」가 아니다', JSON.stringify(first))
  await must('ping', watcher.token, { gameId: GAME })

  console.log('\n── 6 분째 안 켰다 ──')
  await setSeen(gone.uid, Date.now() - AWAY_MS - 60_000)
  const goneAt = (await pawnOf(gone.uid)).at as { x: number; y: number }
  // 누가 한 번 움직이면 화면 몫이 다시 쓰인다
  const wAt = (await pawnOf(watcher.uid)).at as { x: number; y: number }
  await must('standAt', watcher.token, { gameId: GAME, x: wAt.x, y: wAt.y, via: [wAt] })
  await sleep(2500)
  let v = await viewOf(watcher.uid)
  check(!(v.visibleIds ?? []).includes(gone.uid), '남의 맵에서 사라졌다')
  check((v.visibleIds ?? []).includes(never.uid), '신호를 한 번도 안 보낸 사람(옛 화면)은 그대로 보인다')
  check((v.roomCounts?.[START_TILE] ?? 0) === 14, '방 정원(머릿수)에는 그대로 센다', String(v.roomCounts?.[START_TILE]))
  const self = await viewOf(gone.uid)
  check((self.visibleIds ?? []).includes(gone.uid), '본인 화면에는 제 말이 있다')

  console.log('\n── 사라진 사람의 칸은 막지 않는다 ──')
  const onIt = await must('standAt', walker.token, { gameId: GAME, x: goneAt.x, y: goneAt.y })
  check(onIt.ok === true, '그 칸으로 걸어 들어갈 수 있다', JSON.stringify(onIt))
  // 켜 있는 사람의 칸은 여전히 막는다
  const wNow = (await pawnOf(watcher.uid)).at as { x: number; y: number }
  const blocked = await must('standAt', walker.token, { gameId: GAME, x: wNow.x, y: wNow.y })
  check(blocked.ok === false && blocked.code === 'occupied', '켜 있는 사람의 칸은 그대로 막힌다', JSON.stringify(blocked))

  console.log('\n── 다시 켜면 돌아온다 ──')
  const back = await must('ping', gone.token, { gameId: GAME })
  check(back.back === true, '「돌아왔다」로 답한다', JSON.stringify(back))
  const gNow = (await pawnOf(gone.uid)).at as { x: number; y: number }
  const kNow = (await pawnOf(walker.uid)).at as { x: number; y: number }
  check(!(gNow.x === kNow.x && gNow.y === kNow.y), '누가 내 칸에 서 있었으면 옆 빈 칸으로 비켜 선다', `${JSON.stringify(gNow)} vs ${JSON.stringify(kNow)}`)
  await sleep(2500)
  v = await viewOf(watcher.uid)
  check((v.visibleIds ?? []).includes(gone.uid), '남의 맵에 다시 그려진다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
