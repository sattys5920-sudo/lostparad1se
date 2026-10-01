// 멈춤 묶기 — 여럿이 한꺼번에 멈추면 화면 다시 쓰기는 한두 번, 그래도 모든 자리가 비친다
//
//   npx vite-node scripts/views-soon-e2e.ts   (에뮬레이터가 떠 있어야 한다)
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
import { dropCellsIn } from '../shared/rules/quiz'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { TILE_IDS, canRoamTo, isHallCell, roomOfCell } from '../shared/rules/board'
import { entryCellOf, inLane } from '../shared/rules/seat'
import { isFixture } from '../shared/rules/fixtures'
import { dayHourMs } from '../shared/rules/clock'

const GAME = `soon${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function pawnAt(uid: string): Promise<{ x: number; y: number } | null> {
  const r = plain(await (await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })).json()) as { at?: { x: number; y: number } | null }
  return r.at ?? null
}

interface PawnRow { id: string; tileId: string | null; at: { x: number; y: number } | null; team: string }
async function pawnsAll(): Promise<PawnRow[]> {
  const r = await fetch(`${FS}/games/${GAME}/pawns?pageSize=300`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => {
    const d = plain(doc) as { tileId?: string | null; at?: { x: number; y: number } | null; team: string }
    return { id: doc.name.split('/').pop() as string, tileId: d.tileId ?? null, at: d.at ?? null, team: d.team }
  })
}
/** 방(또는 복도)에 선 사람 중 한 칸에 둘 이상인 칸들 */
function stacked(rows: PawnRow[]): string[] {
  const seen = new Map<string, number>()
  for (const p of rows) if (p.tileId !== null && p.at) seen.set(`${p.at.x},${p.at.y}`, (seen.get(`${p.at.x},${p.at.y}`) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`)
}
/** 선 칸이 그 사람의 방 안(또는 복도)이고 물건 칸이 아닌가 */
const fits = (p: PawnRow) =>
  p.at !== null && (roomOfCell(p.at.x, p.at.y) === p.tileId || isHallCell(p.at.x, p.at.y)) && !isBlockedCell(p.at.x, p.at.y) && !isFixture(p.at.x, p.at.y)
async function viewOf(uid: string): Promise<{ visiblePawns?: { playerId: string; at?: { x: number; y: number } | null }[] }> {
  return plain(await (await fetch(`${FS}/games/${GAME}/views/${uid}`, { headers: ADMIN })).json()) as never
}
async function ringSlots(): Promise<number[]> {
  const j = (await (await fetch(`${FS}/games/${GAME}/secret/viewsSoon/ring?pageSize=100`, { headers: ADMIN })).json()) as { documents?: unknown[] }
  return (j.documents ?? []).map((d) => (plain(d) as { slot: number }).slot)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  console.log(`판 ${GAME}`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'soon' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const taken = new Set(START_CELLS.map((x) => `${x.x},${x.y}`))
  const free = dropCellsIn(START_TILE as never).filter((x) => !isBlockedCell(x.x, x.y) && !isFixture(x.x, x.y) && !taken.has(`${x.x},${x.y}`))
  const watcher = people[13]

  console.log('\n── 여덟이 한꺼번에 멈춘다 ──')
  const before = (await ringSlots()).length
  const movers = people.slice(0, 8)
  const t0 = Date.now()
  const outs = await Promise.all(movers.map((p, i) => must('standAt', p.token, { gameId: GAME, x: free[i].x, y: free[i].y })))
  const took = Date.now() - t0
  check(outs.every((o) => o.ok === true), '여덟 모두 섰다', outs.map((o) => String(o.why ?? 'ok')).join(' '))
  const slots = (await ringSlots()).length - before
  // 에뮬레이터는 일꾼을 하나씩 깨워서 「한꺼번에」가 몇 초에 걸쳐 들어온다 — 1.5 초 칸 수만큼이 상한이다
  check(slots >= 1 && slots < 8 && slots <= Math.ceil(took / 1500) + 1, '다시 쓰기는 1.5 초 칸마다 한 번뿐이다(여덟 번이 아니다)', `${slots}번, ${took}ms`)
  await sleep(500)
  const v = await viewOf(watcher.uid)
  const seen = movers.filter((p, i) => { const q = v.visiblePawns?.find((x) => x.playerId === p.uid); return q?.at?.x === free[i].x && q?.at?.y === free[i].y }).length
  check(seen === 8, '지켜보던 사람 화면에 여덟 자리가 다 비친다', `${seen}/8`)
  for (const [i, p] of movers.entries()) {
    const mv = await viewOf(p.uid)
    const me = mv.visiblePawns?.find((x) => x.playerId === p.uid)
    if (me?.at?.x !== free[i].x || me?.at?.y !== free[i].y) check(false, `봇${i} 본인 화면`, JSON.stringify(me?.at))
  }
  check(true, '본인 화면에도 제 자리가 비친다')

  console.log('\n── 띄엄띄엄 멈추면 하나하나 비친다 ──')
  for (let k = 0; k < 3; k++) {
    const p = people[8 + k]
    const cell = free[8 + k]
    await must('standAt', p.token, { gameId: GAME, x: cell.x, y: cell.y })
    const w = await viewOf(watcher.uid)
    const q = w.visiblePawns?.find((x) => x.playerId === p.uid)
    check(q?.at?.x === cell.x && q?.at?.y === cell.y, `봇${8 + k} 의 멈춤이 대답이 올 때 이미 비쳐 있다`)
    await sleep(1800)
  }

  console.log('\n── 마지막 멈춤도 안 빠진다(바로 뒤 대답만 받은 사람) ──')
  // 한 칸 안에서 둘이 멈춘다: 먼저 온 사람이 다시 쓰고, 뒤 사람은 바로 돌아간다
  const [x1, x2] = [people[11], people[12]]
  const r1 = must('standAt', x1.token, { gameId: GAME, x: free[11].x, y: free[11].y })
  await sleep(200)
  const r2s = Date.now()
  await must('standAt', x2.token, { gameId: GAME, x: free[12].x, y: free[12].y })
  const fast = Date.now() - r2s
  await r1
  await sleep(300)
  const w2 = await viewOf(watcher.uid)
  const both = [[x1, free[11]], [x2, free[12]]].every(([p, c]) => { const q = w2.visiblePawns?.find((x) => x.playerId === (p as { uid: string }).uid); return q?.at?.x === (c as { x: number }).x && q?.at?.y === (c as { y: number }).y })
  check(both, '둘 다 비친다', `뒤 사람 대답 ${fast}ms`)

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
