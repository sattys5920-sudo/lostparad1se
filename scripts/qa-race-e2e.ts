// QA 4 — 동시성. **같은 것을 두 손이 같은 순간에 잡으면 한 손만 잡는다.**
//
// 경주마다 전제를 새로 깔고, 경쟁하는 요청을 한 틱에 같이 쏘고(Promise.all),
// 끝나면 **딱 한쪽만 이겼고 진 쪽은 한국어로 거절당했는지**와 문서 상태가
// 맞는지를 운영자 열쇠(REST)로 센다. 기본 100번씩.
//
//   1  같은 칸에 둘이 standAt            → 한 사람만 선다 · 한 칸에 둘이 없다
//   2  같은 쪽지에 둘이 takeSlip          → heldBy 하나 · slipTake 한 줄
//   3  같은 심부름에 둘이 dropThing       → doneBy 하나 · 돈 한 번 · errandDone 한 줄
//   4a 같은 종이에 둘이 takeQuiz          → heldBy 하나 · quizTake 한 줄
//   4b 든 사람이 answerQuiz 를 둘 동시에  → solvedBy 하나 · 지식 +1 한 번 · quizSolved 한 줄
//   5  같은 화분에 둘이 harvestPot        → 화분 빈다 · 작물 +1 한 번 · potHarvest 한 줄
//   6a 받는 쪽이 answerDeal 둘 동시에     → 한 번만 열린다
//   6b 둘이 readyDeal 동시에              → **둘 다** 된다 · settling
//   6c 둘이 settleDeal 동시에             → 한 번만 먹는다 · 금고 한 번 · trade 한 줄
//   6d 둘이 같은 셋째에게 askDeal 동시에  → 한 사람에 살아 있는 거래 하나
//   6e 한 사람이 askDeal 둘 동시에        → 하나만 생긴다
//   7a 팀 토큰 1 · 두 팀원이 move 동시에  → 하나만 · 토큰 0 · 음수 없음
//   7b 한 사람이 move 둘 동시에           → 하나만 · 토큰 하나만 든다
//   8a 좁은 방(정원 2)에 한 자리 남았을 때 둘이 move → 하나만
//   8b 자유 시간 roamTo 는 정원이 없다    → 둘 다 들어가되 서로 다른 칸
//   9  둘이 castBallot 동시에             → 둘 다 · 표 두 장
//
//   npx vite-node scripts/qa-race-e2e.ts [1 2 4a ...]     N=100 (환경변수로 바꾼다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { START_TILE, canStandAt, roomOfCell, type TileId } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { POT_CELLS, GARDEN_TILE } from '../shared/rules/crop'
import { BOARDS } from '../shared/rules/errand'
import { capacityOf } from '../shared/rules/occupy'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const JSONH = { 'Content-Type': 'application/json' }

const N = Math.max(1, Number(process.env.N ?? 100))
const ONLY = new Set(process.argv.slice(2))
const wants = (id: string) => ONLY.size === 0 || ONLY.has(id) || ONLY.has(id.replace(/[a-z]$/, ''))

// ── Firestore REST ───────────────────────────────────────────────

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
/** 값을 Firestore 포장으로. 시험이 문서를 심을 때 쓴다 */
function enc(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
}
type Doc = { id: string; d: Record<string, unknown> }
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}
/**
 * 시험 준비용 쓰기. **에뮬레이터가 붐비면 409(Transaction lock timeout)를 던진다** —
 * 서버 트랜잭션이 같은 문서를 잡고 있을 때다. 재는 것이 아니라 깔아 두는
 * 일이므로 몇 번 다시 한다. 그래도 안 되면 그때 멈춘다
 */
async function write(label: string, path: string, init: RequestInit): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${FS}/${path}`, init)
    if (r.ok) return
    const text = await r.text()
    if (r.status === 409 && attempt < 8) { await new Promise((f) => setTimeout(f, 100 * (attempt + 1))); continue }
    throw new Error(`${label} ${path}: ${r.status} ${text}`)
  }
}
/** 있는 문서면 그 칸만 고치고, 없으면 만든다 */
async function patchDoc(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
  await write('PATCH', `${path}?${mask}`, {
    method: 'PATCH', headers: { ...JSONH, ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
}
/** 문서를 통째로 쓴다(덮어쓴다) */
async function putDoc(path: string, fields: Record<string, unknown>): Promise<void> {
  await write('PUT', path, {
    method: 'PATCH', headers: { ...JSONH, ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
}
async function deleteDoc(path: string): Promise<void> {
  await write('DELETE', path, { method: 'DELETE', headers: ADMIN })
}
async function listAll(path: string): Promise<Doc[]> {
  const out: Doc[] = []
  let token: string | undefined
  for (;;) {
    const r = await fetch(`${FS}/${path}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: ADMIN })
    if (!r.ok) return out
    const j = (await r.json()) as { documents?: { name: string }[]; nextPageToken?: string }
    for (const doc of j.documents ?? []) out.push({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> })
    if (!j.nextPageToken) return out
    token = j.nextPageToken
  }
}
/** 한 컬렉션을 조건으로 센다. 기록이 300줄을 넘어도 전부 본다 */
async function query(parent: string, collectionId: string, where: [string, unknown][]): Promise<Doc[]> {
  const filters = where.map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }))
  const r = await fetch(`${FS}/${parent}:runQuery`, {
    method: 'POST', headers: { ...JSONH, ...ADMIN },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } },
      },
    }),
  })
  if (!r.ok) throw new Error(`runQuery ${parent}/${collectionId}: ${r.status} ${await r.text()}`)
  const rows = (await r.json()) as { document?: { name: string } }[]
  return rows.filter((x) => x.document).map((x) => ({ id: (x.document as { name: string }).name.split('/').pop() as string, d: plain(x.document) as Record<string, unknown> }))
}

// ── 계정 · 콜러블 ────────────────────────────────────────────────

async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { ...JSONH, ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { ...JSONH, ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data: Record<string, unknown>; code?: string; message?: string }
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  try {
    const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }) })
    const text = await r.text()
    let j: { result?: Record<string, unknown>; error?: { status: string; message: string } }
    try { j = JSON.parse(text) } catch { return { ok: false, data: {}, code: `HTTP ${r.status}`, message: text.slice(0, 120) } }
    if (j.error) return { ok: false, data: {}, code: j.error.status, message: j.error.message }
    return { ok: true, data: j.result ?? {} }
  } catch (e) {
    return { ok: false, data: {}, code: 'FETCH', message: String(e) }
  }
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data
}
/** 같은 틱에 같이 쏜다. fetch 를 먼저 다 만들어 두고 기다린다 */
const race = (...reqs: (() => Promise<Res>)[]): Promise<Res[]> => Promise.all(reqs.map((f) => f()))

const korean = (s: unknown): boolean => typeof s === 'string' && /[가-힣]/.test(s)

// ── 판 ───────────────────────────────────────────────────────────

interface Person { uid: string; token: string; team: TeamId; email: string; i: number }
interface Game { id: string; host: string; people: Person[]; hostEmail: string }
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function setupGame(tag: string): Promise<Game> {
  const id = `rc${tag}${Date.now().toString(36)}`
  console.log(`\n판 ${id} 세우기`)
  const hostEmail = await signUp(`h-${id}@x.test`)
  await setAdmin(hostEmail)
  const host = (await auth(hostEmail)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: id, seed: 'race' })
  const people: Person[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const email = await signUp(`p${i}-${id}@x.test`)
    const a = await auth(email)
    people.push({ ...a, team: want[i], email, i })
    await must('joinGame', a.token, { gameId: id, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: id })
  await must('startGame', host, { gameId: id, startAtMs: START })
  await must('setDevClock', host, { gameId: id, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  return { id, host, people, hostEmail }
}
/** 오래 돌면 증표가 식는다. 경주마다 새로 받는다 */
async function refresh(g: Game): Promise<void> {
  g.host = (await auth(g.hostEmail)).token
  for (const p of g.people) p.token = (await auth(p.email)).token
}
const byTeam = (g: Game, t: TeamId): Person[] => g.people.filter((p) => p.team === t)

interface Pawn { id: string; tileId: string | null; at: { x: number; y: number } | null; team: string; path?: string[]; crops?: Record<string, number> }
async function pawns(g: Game): Promise<Pawn[]> {
  return (await listAll(`games/${g.id}/pawns`)).map((x) => ({
    id: x.id,
    tileId: (x.d.tileId ?? null) as string | null,
    at: (x.d.at ?? null) as { x: number; y: number } | null,
    team: String(x.d.team),
    path: (x.d.path ?? []) as string[],
    crops: (x.d.crops ?? {}) as Record<string, number>,
  }))
}
/** 방에 있는 사람 중 한 칸에 둘 이상인 칸 */
function stacked(rows: Pawn[]): string[] {
  const seen = new Map<string, number>()
  for (const p of rows) if (p.tileId !== null && p.at) seen.set(`${p.at.x},${p.at.y}`, (seen.get(`${p.at.x},${p.at.y}`) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`)
}
/** 방으로 옮겨 놓는다(서버가 방을 옮길 때와 같이 칸을 비운다). 시험 준비용 */
async function putIn(g: Game, uid: string, tileId: string): Promise<void> {
  await patchDoc(`games/${g.id}/pawns/${uid}`, { tileId, postTile: tileId, arriveAtMs: null, at: null, path: [] })
}
/** 서버를 거쳐 칸에 세운다. 못 서면 멈춘다 */
async function stand(g: Game, p: Person, x: number, y: number): Promise<void> {
  const r = await must('standAt', p.token, { gameId: g.id, x, y })
  if (r.ok !== true) throw new Error(`standAt ${x},${y} 안 섰다: ${String(r.code ?? '')} ${String(r.why ?? '')}`)
}
/** 그 칸 둘레에서 설 수 있는 칸들. 같은 방 안, 기물·가구 아닌 곳 */
function around(spot: { x: number; y: number }, room: TileId): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
    const c = { x: spot.x + dx, y: spot.y + dy }
    if (canStandAt(c.x, c.y) && roomOfCell(c.x, c.y) === room && !isFixture(c.x, c.y) && !isBlockedCell(c.x, c.y)) out.push(c)
  }
  return out
}
/** 위·아래·양옆 — 거래의 「닿았다」(cellsTouch)는 이 넷만 친다 */
const orthoAround = (spot: { x: number; y: number }, room: TileId) => around(spot, room).filter((c) => Math.abs(c.x - spot.x) + Math.abs(c.y - spot.y) === 1)
/** 방 안에서 물건을 놓을 칸 하나 — 옆에 둘이 나란히 설 수 있는 곳. 가구 칸은 뺀다 */
function spotIn(room: TileId): { spot: { x: number; y: number }; sides: { x: number; y: number }[] } {
  for (const c of dropCellsIn(room)) {
    if (isBlockedCell(c.x, c.y)) continue
    const sides = orthoAround(c, room)
    if (sides.length >= 2) return { spot: c, sides }
  }
  throw new Error(`${room} 안에 놓을 칸이 없다`)
}
/** 둘을 한 물건 옆에 나란히 세운다 */
async function besideBoth(g: Game, room: TileId, spot: { x: number; y: number }, a: Person, b: Person): Promise<void> {
  const cells = orthoAround(spot, room)
  if (cells.length < 2) throw new Error(`${room} ${spot.x},${spot.y} 옆에 설 자리가 둘이 없다`)
  await putIn(g, a.uid, room)
  await putIn(g, b.uid, room)
  await stand(g, a, cells[0].x, cells[0].y)
  await stand(g, b, cells[1].x, cells[1].y)
}
const teamDoc = async (g: Game, t: string) => (await getDoc(`games/${g.id}/teams/${t}`)) ?? {}
const purse = async (g: Game, t: string): Promise<{ money: number; knowledge: number }> => {
  const r = ((await teamDoc(g, t)).resources ?? {}) as Record<string, number>
  return { money: Number(r.money ?? 0), knowledge: Number(r.knowledge ?? 0) }
}
/** 그 사람 돈. **돈은 사람 것이다** — 말 문서의 money */
const cash = async (g: Game, uid: string): Promise<{ money: number }> =>
  ({ money: Number(((await getDoc(`games/${g.id}/pawns/${uid}`)) as Record<string, unknown> | null)?.money ?? 0) })
const tokensOf = async (g: Game, t: string): Promise<number> => Number((await teamDoc(g, t)).phaseTokens ?? 0)
const records = (g: Game, kind: string, extra: [string, unknown][] = []) =>
  query(`games/${g.id}/secret/records`, 'items', [['kind', kind], ...extra])
const events = (g: Game, kind: string) => query(`games/${g.id}`, 'events', [['kind', kind]])
/** 운영자 로그(secret/qa/log). 누가 · 어디서가 실린 줄은 공개 events 가 아니라 여기 있다 */
const qaRows = (g: Game, kind: string) => query(`games/${g.id}/secret/qa`, 'log', [['kind', kind]])
const nowMs = async (g: Game): Promise<number> => Number((await must('clockNow', g.host, { gameId: g.id })).nowMs)

// ── 경주 틀 ──────────────────────────────────────────────────────

type Outcome = 'won' | 'lost' | 'bad'
interface Round { outcomes: Outcome[]; consistent: boolean; notes: string[] }
interface Tally { wins: number; losses: number; bothWon: number; bothLost: number; inconsistent: number; unclear: number; refusals: Map<string, number>; problems: string[] }
const tallies: { id: string; label: string; expect: 1 | 'all'; t: Tally }[] = []

/** 판정. 던진 오류는 한국어면 「졌다」, 아니면 「알 수 없다」 */
function judge(r: Res, won: (d: Record<string, unknown>) => boolean, lostSoft?: (d: Record<string, unknown>) => boolean): [Outcome, string] {
  if (r.ok) {
    if (won(r.data)) return ['won', '']
    if (lostSoft && lostSoft(r.data)) return ['lost', String(r.data.why ?? r.data.code ?? 'soft')]
    return ['bad', `ok but ${JSON.stringify(r.data).slice(0, 80)}`]
  }
  return korean(r.message) ? ['lost', String(r.message)] : ['bad', `${r.code} ${r.message}`]
}
const thrown = (r: Res): [Outcome, string] => judge(r, () => true)

async function runCase(id: string, label: string, expect: 1 | 'all', n: number, round: (i: number) => Promise<Round>): Promise<void> {
  if (!wants(id)) return
  const t: Tally = { wins: 0, losses: 0, bothWon: 0, bothLost: 0, inconsistent: 0, unclear: 0, refusals: new Map(), problems: [] }
  tallies.push({ id, label, expect, t })
  process.stdout.write(`\n[${id}] ${label} × ${n}\n  `)
  for (let i = 0; i < n; i++) {
    let out: Round
    try {
      out = await round(i)
    } catch (e) {
      out = { outcomes: ['bad'], consistent: false, notes: [`throw: ${String(e).slice(0, 160)}`] }
    }
    const won = out.outcomes.filter((o) => o === 'won').length
    const lost = out.outcomes.filter((o) => o === 'lost').length
    const bad = out.outcomes.filter((o) => o === 'bad').length
    if (bad > 0) t.unclear += 1
    if (expect === 1) {
      if (won === 1 && lost === out.outcomes.length - 1) { t.wins += 1; t.losses += lost }
      else if (won > 1) t.bothWon += 1
      else if (won === 0) t.bothLost += 1
    } else {
      if (won === out.outcomes.length) t.wins += 1
      else t.bothLost += 1
    }
    if (!out.consistent) t.inconsistent += 1
    for (const note of out.notes) {
      if (note.startsWith('refusal:')) t.refusals.set(note.slice(8), (t.refusals.get(note.slice(8)) ?? 0) + 1)
      else if (t.problems.length < 8) t.problems.push(`#${i} ${note}`)
    }
    const ok = out.consistent && bad === 0 && (expect === 1 ? won === 1 : won === out.outcomes.length)
    process.stdout.write(ok ? '.' : 'X')
    if ((i + 1) % 50 === 0 && i + 1 < n) process.stdout.write('\n  ')
  }
  process.stdout.write('\n')
  console.log(`  ${id} · wins ${t.wins} / losses ${t.losses} / both-won ${t.bothWon} / both-lost ${t.bothLost} / inconsistent ${t.inconsistent}${t.unclear ? ` / unclear ${t.unclear}` : ''}`)
  for (const [msg, c] of t.refusals) console.log(`    거절: 「${msg}」 ×${c}`)
  for (const p of t.problems) console.log(`    ! ${p}`)
}

/** 결과 하나를 노트에 싣는다 */
function noteOf(o: [Outcome, string]): string[] {
  if (o[0] === 'lost') return [`refusal:${o[1]}`]
  if (o[0] === 'bad') return [`unclear: ${o[1]}`]
  return []
}

// ── 자유 시간 경주 ──────────────────────────────────────────────

async function freeTimeCases(): Promise<void> {
  const ids = ['1', '2', '3', '4a', '4b', '5', '6a', '6b', '6c', '6d', '6e', '9']
  if (!ids.some(wants)) return
  const g = await setupGame('f')
  const A = byTeam(g, 'A'), B = byTeam(g, 'B'), C = byTeam(g, 'C'), D = byTeam(g, 'D')

  // 1 · 같은 칸에 둘이 standAt
  await refresh(g)
  await runCase('1', '같은 칸에 두 사람이 standAt', 1, N, async (i) => {
    const [a, b] = [A[0], A[1]]
    const taken = new Set(START_CELLS.map((c) => `${c.x},${c.y}`))
    const free = dropCellsIn(START_TILE).filter((c) => !isBlockedCell(c.x, c.y) && !taken.has(`${c.x},${c.y}`))
    const before = await pawns(g)
    const occupied = new Set(before.filter((p) => p.tileId !== null && p.at).map((p) => `${p.at!.x},${p.at!.y}`))
    const spot = free.filter((c) => !occupied.has(`${c.x},${c.y}`))[i % 7]
    const homeA = before.find((p) => p.id === a.uid)!.at
    const homeB = before.find((p) => p.id === b.uid)!.at
    const [ra, rb] = await race(
      () => call('standAt', a.token, { gameId: g.id, x: spot.x, y: spot.y }),
      () => call('standAt', b.token, { gameId: g.id, x: spot.x, y: spot.y }),
    )
    const soft = (d: Record<string, unknown>) => d.ok === false && d.code === 'occupied' && korean(d.why)
    const oa = judge(ra, (d) => d.ok === true, soft)
    const ob = judge(rb, (d) => d.ok === true, soft)
    const after = await pawns(g)
    const on = after.filter((p) => p.tileId !== null && p.at?.x === spot.x && p.at?.y === spot.y)
    const notes = [...noteOf(oa), ...noteOf(ob)]
    let consistent = on.length === 1 && stacked(after).length === 0
    if (on.length !== 1) notes.push(`그 칸에 ${on.length}명`)
    if (stacked(after).length > 0) notes.push(`겹친 칸 ${stacked(after).join(' ')}`)
    // 진 쪽은 제자리다
    const loser = oa[0] === 'won' ? b : a
    const loserHome = oa[0] === 'won' ? homeB : homeA
    const lAt = after.find((p) => p.id === loser.uid)!.at
    if (oa[0] !== ob[0] && !(lAt?.x === loserHome?.x && lAt?.y === loserHome?.y)) { consistent = false; notes.push('진 쪽이 제자리가 아니다') }
    // 이긴 쪽을 제자리로 — 다음 경주를 위해
    const winner = oa[0] === 'won' ? a : ob[0] === 'won' ? b : null
    const winnerHome = oa[0] === 'won' ? homeA : homeB
    if (winner && winnerHome) await must('standAt', winner.token, { gameId: g.id, x: winnerHome.x, y: winnerHome.y })
    return { outcomes: [oa[0], ob[0]], consistent, notes }
  })

  // 2 · 같은 쪽지에 둘이 takeSlip
  if (wants('2')) {
    await refresh(g)
    const room: TileId = 'library'
    const { spot } = spotIn(room)
    const [a, b] = [A[2], A[3]]
    await besideBoth(g, room, spot, a, b)
    await runCase('2', '같은 쪽지에 두 사람이 takeSlip', 1, N, async (i) => {
      const slipId = `rcslip${i}`
      await putDoc(`games/${g.id}/secret/slips/items/${slipId}`, {
        textId: '', text: '경주용 쪽지', subjectId: a.uid, tileId: null, x: spot.x, y: spot.y,
        heldBy: null, readBy: [], tornBy: null, tornAt: null, atMs: 0,
      })
      const [ra, rb] = await race(
        () => call('takeSlip', a.token, { gameId: g.id, slipId }),
        () => call('takeSlip', b.token, { gameId: g.id, slipId }),
      )
      const oa = thrown(ra), ob = thrown(rb)
      const doc = (await getDoc(`games/${g.id}/secret/slips/items/${slipId}`)) ?? {}
      const winner = oa[0] === 'won' ? a.uid : ob[0] === 'won' ? b.uid : null
      const took = await records(g, 'slipTake', [['subjectId', slipId]])
      const notes = [...noteOf(oa), ...noteOf(ob)]
      let consistent = true
      if (doc.heldBy !== winner) { consistent = false; notes.push(`heldBy=${String(doc.heldBy)} 이긴 쪽=${String(winner)}`) }
      if (doc.x !== null || doc.y !== null) { consistent = false; notes.push('바닥 칸이 안 비었다') }
      if (took.length !== (winner ? 1 : 0)) { consistent = false; notes.push(`slipTake ${took.length}줄`) }
      return { outcomes: [oa[0], ob[0]], consistent, notes }
    })
  }

  // 3 · 같은 심부름에 둘이 dropThing
  if (wants('3')) {
    await refresh(g)
    const board = BOARDS.find((x) => x.id === 'f1w')!
    const [a, b] = [B[0], C[0]]
    await putIn(g, a.uid, 'annex')
    await putIn(g, b.uid, 'annex')
    let doneBefore = (await qaRows(g, 'errandDone')).length
    await runCase('3', '같은 심부름을 둘이 dropThing(먼저 놓는 사람)', 1, N, async () => {
      const posted = await must('hostPostErrand', g.host, { gameId: g.id, specId: 'beaker', boardId: board.id, to: 'annex' })
      const errandId = String(posted.posted)
      const t = await nowMs(g)
      await patchDoc(`games/${g.id}/errands/${errandId}`, { takers: { [a.uid]: { tookMs: t, carrying: true }, [b.uid]: { tookMs: t, carrying: true } } })
      // **심부름 보상은 사람에게 바로 간다** — 분단 금고가 아니라 그 사람 돈이다
      const [pa, pb] = [await cash(g, a.uid), await cash(g, b.uid)]
      const [ra, rb] = await race(
        () => call('dropThing', a.token, { gameId: g.id }),
        () => call('dropThing', b.token, { gameId: g.id }),
      )
      const oa = judge(ra, (d) => d.done === true), ob = judge(rb, (d) => d.done === true)
      const doc = (await getDoc(`games/${g.id}/errands/${errandId}`)) ?? {}
      const winner = oa[0] === 'won' ? a : ob[0] === 'won' ? b : null
      const coins = Number((oa[0] === 'won' ? ra : rb).data.coins ?? 0)
      const [qa, qb] = [await cash(g, a.uid), await cash(g, b.uid)]
      const done = await records(g, 'errandDone', [['subjectId', errandId]])
      const ev = (await qaRows(g, 'errandDone')).length
      const notes = [...noteOf(oa), ...noteOf(ob)]
      let consistent = true
      if (doc.doneBy !== (winner?.uid ?? null)) { consistent = false; notes.push(`doneBy=${String(doc.doneBy)}`) }
      const gainA = qa.money - pa.money, gainB = qb.money - pb.money
      const wantA = winner === a ? coins : 0, wantB = winner === b ? coins : 0
      if (gainA !== wantA || gainB !== wantB) { consistent = false; notes.push(`돈 ${a.team}+${gainA} ${b.team}+${gainB} (바란 ${wantA}/${wantB})`) }
      if (done.length !== (winner ? 1 : 0)) { consistent = false; notes.push(`errandDone 기록 ${done.length}줄`) }
      if (ev !== doneBefore + (winner ? 1 : 0)) { consistent = false; notes.push(`errandDone 이벤트 ${ev - doneBefore}줄`) }
      doneBefore = ev
      // 같은 심부름은 하루 한 번 — 문서를 지워 다음 경주가 다시 붙인다
      await deleteDoc(`games/${g.id}/errands/${errandId}`)
      return { outcomes: [oa[0], ob[0]], consistent, notes }
    })
  }

  // 4 · 문제 종이 — 줍기 경주, 그리고 든 사람의 답 둘
  if (wants('4a') || wants('4b')) {
    await refresh(g)
    const room: TileId = 'artRoom'
    const { spot } = spotIn(room)
    const [a, b] = [B[1], B[2]]
    await besideBoth(g, room, spot, a, b)
    const ANSWER = '사과'
    const quizId = String((await must('hostQuizUpsert', g.host, { gameId: g.id, quiz: { kind: 'short', prompt: '경주용 문제', choices: [], answers: [ANSWER], explain: '' } })).id)
    const plant = async (i: number): Promise<string> => {
      const paperId = `rcq${i}`
      await putDoc(`games/${g.id}/secret/quiz/floor/${paperId}`, { quizId, x: spot.x, y: spot.y, heldBy: null, wrongBy: [], solvedBy: null, solvedTeam: null, atMs: 0 })
      return paperId
    }
    await runCase('4a', '같은 문제 종이에 두 사람이 takeQuiz', 1, N, async (i) => {
      const paperId = await plant(i)
      const [ra, rb] = await race(
        () => call('takeQuiz', a.token, { gameId: g.id, paperId }),
        () => call('takeQuiz', b.token, { gameId: g.id, paperId }),
      )
      const oa = thrown(ra), ob = thrown(rb)
      const doc = (await getDoc(`games/${g.id}/secret/quiz/floor/${paperId}`)) ?? {}
      const winner = oa[0] === 'won' ? a.uid : ob[0] === 'won' ? b.uid : null
      const took = await records(g, 'quizTake', [['subjectId', paperId]])
      const notes = [...noteOf(oa), ...noteOf(ob)]
      let consistent = true
      if (doc.heldBy !== winner) { consistent = false; notes.push(`heldBy=${String(doc.heldBy)}`) }
      if (took.length !== (winner ? 1 : 0)) { consistent = false; notes.push(`quizTake ${took.length}줄`) }
      return { outcomes: [oa[0], ob[0]], consistent, notes }
    })
    await runCase('4b', '든 사람이 정답 answerQuiz 를 둘 동시에', 1, N, async (i) => {
      const paperId = await plant(1000 + i)
      await patchDoc(`games/${g.id}/secret/quiz/floor/${paperId}`, { heldBy: a.uid })
      const before = await purse(g, a.team)
      const [r1, r2] = await race(
        () => call('answerQuiz', a.token, { gameId: g.id, paperId, given: ANSWER }),
        () => call('answerQuiz', a.token, { gameId: g.id, paperId, given: ANSWER }),
      )
      const o1 = judge(r1, (d) => d.correct === true), o2 = judge(r2, (d) => d.correct === true)
      const doc = (await getDoc(`games/${g.id}/secret/quiz/floor/${paperId}`)) ?? {}
      const after = await purse(g, a.team)
      const solved = await records(g, 'quizSolved', [['subjectId', paperId]])
      const won = [o1, o2].filter((o) => o[0] === 'won').length
      const notes = [...noteOf(o1), ...noteOf(o2)]
      let consistent = true
      if (doc.solvedBy !== (won > 0 ? a.uid : null)) { consistent = false; notes.push(`solvedBy=${String(doc.solvedBy)}`) }
      if (after.knowledge - before.knowledge !== (won > 0 ? 1 : 0)) { consistent = false; notes.push(`지식 +${after.knowledge - before.knowledge}`) }
      if (solved.length !== (won > 0 ? 1 : 0)) { consistent = false; notes.push(`quizSolved ${solved.length}줄`) }
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
  }

  // 5 · 같은 화분에 둘이 harvestPot
  if (wants('5')) {
    await refresh(g)
    const [a, b] = [B[3], C[1]]
    const pot = POT_CELLS[0]
    await putIn(g, a.uid, GARDEN_TILE)
    await putIn(g, b.uid, GARDEN_TILE)
    await stand(g, a, pot.x, pot.y + 1)
    await stand(g, b, pot.x, pot.y - 1)
    const H = 3_600_000
    let pickedBefore = (await records(g, 'potHarvest', [['subjectId', '0:corn']])).length
    await runCase('5', '같은 화분(열매)에 두 사람이 harvestPot', 1, N, async () => {
      await patchDoc(`games/${g.id}/pawns/${a.uid}`, { crops: {} })
      await patchDoc(`games/${g.id}/pawns/${b.uid}`, { crops: {} })
      const t = await nowMs(g)
      await putDoc(`games/${g.id}/pots/0`, { cropId: 'corn', plantedMs: t - H - 60_000, growMs: H, toldHers: false })
      const [ra, rb] = await race(
        () => call('harvestPot', a.token, { gameId: g.id, pot: 0 }),
        () => call('harvestPot', b.token, { gameId: g.id, pot: 0 }),
      )
      const oa = judge(ra, (d) => typeof d.got === 'string'), ob = judge(rb, (d) => typeof d.got === 'string')
      const doc = (await getDoc(`games/${g.id}/pots/0`)) ?? {}
      const rows = await pawns(g)
      const held = [a.uid, b.uid].reduce((n, id) => n + Number(rows.find((p) => p.id === id)?.crops?.corn ?? 0), 0)
      const picked = await records(g, 'potHarvest', [['subjectId', '0:corn']])
      const won = [oa, ob].filter((o) => o[0] === 'won').length
      const notes = [...noteOf(oa), ...noteOf(ob)]
      let consistent = true
      if (doc.cropId !== null) { consistent = false; notes.push(`화분이 안 비었다 ${String(doc.cropId)}`) }
      if (held !== won) { consistent = false; notes.push(`손에 든 옥수수 ${held} (이긴 ${won})`) }
      if (picked.length !== pickedBefore + won) { consistent = false; notes.push(`potHarvest 기록 +${picked.length - pickedBefore} (이긴 ${won})`) }
      pickedBefore = picked.length
      return { outcomes: [oa[0], ob[0]], consistent, notes }
    })
  }

  // 6 · 거래
  if (['6a', '6b', '6c', '6d', '6e'].some(wants)) {
    await refresh(g)
    const [p, q] = [C[2], D[0]]
    const room: TileId = 'gym'
    const { spot: yours, sides } = spotIn(room)
    const mine = sides[0]
    await putIn(g, p.uid, room)
    await putIn(g, q.uid, room)
    await stand(g, p, mine.x, mine.y)
    await stand(g, q, yours.x, yours.y)
    for (const t of ['C', 'D']) await patchDoc(`games/${g.id}/teams/${t}`, { resources: { money: 500, knowledge: 500 } })
    const dealDoc = async (id: string) => (await getDoc(`games/${g.id}/deals/${id}`)) ?? {}
    const openDeal = async (): Promise<string> => {
      const asked = await must('askDeal', p.token, { gameId: g.id, toPlayerId: q.uid })
      return String(asked.id)
    }
    const accept = (id: string) => must('answerDeal', q.token, { gameId: g.id, dealId: id, accept: true })
    const stakeBoth = async (id: string) => {
      await must('stakeDeal', p.token, { gameId: g.id, dealId: id, stake: { money: 1 } })
      await must('stakeDeal', q.token, { gameId: g.id, dealId: id, stake: { knowledge: 1 } })
    }
    const readyBoth = async (id: string) => {
      await must('readyDeal', p.token, { gameId: g.id, dealId: id, ready: true })
      await must('readyDeal', q.token, { gameId: g.id, dealId: id, ready: true })
    }

    await runCase('6a', '받는 쪽이 answerDeal(수락)을 둘 동시에', 1, N, async () => {
      const id = await openDeal()
      const [r1, r2] = await race(
        () => call('answerDeal', q.token, { gameId: g.id, dealId: id, accept: true }),
        () => call('answerDeal', q.token, { gameId: g.id, dealId: id, accept: true }),
      )
      const o1 = judge(r1, (d) => d.open === true), o2 = judge(r2, (d) => d.open === true)
      const d = await dealDoc(id)
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = d.status === 'open'
      if (!consistent) notes.push(`status=${String(d.status)}`)
      await must('cancelDeal', p.token, { gameId: g.id, dealId: id })
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })

    await runCase('6b', '둘이 readyDeal 을 동시에 — 둘 다 되고 세기 시작한다', 'all', N, async () => {
      const id = await openDeal()
      await accept(id)
      await stakeBoth(id)
      const [r1, r2] = await race(
        () => call('readyDeal', p.token, { gameId: g.id, dealId: id, ready: true }),
        () => call('readyDeal', q.token, { gameId: g.id, dealId: id, ready: true }),
      )
      const o1 = judge(r1, (d) => d.ok === true), o2 = judge(r2, (d) => d.ok === true)
      const d = await dealDoc(id)
      const a = (d.a ?? {}) as Record<string, unknown>, b = (d.b ?? {}) as Record<string, unknown>
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = d.status === 'settling' && a.ready === true && b.ready === true && typeof d.settleAtMs === 'number'
      if (!consistent) notes.push(`status=${String(d.status)} a.ready=${String(a.ready)} b.ready=${String(b.ready)} settleAtMs=${String(d.settleAtMs)}`)
      await must('cancelDeal', p.token, { gameId: g.id, dealId: id })
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })

    let tradesBefore = (await records(g, 'trade', [['actorId', p.uid]])).length
    let acceptedBefore = (await events(g, 'tradeAccepted')).length
    await runCase('6c', '둘이 settleDeal 을 동시에 — 한 번만 먹는다', 1, N, async () => {
      const id = await openDeal()
      await accept(id)
      await stakeBoth(id)
      await readyBoth(id)
      // 세던 시각을 지나게 한다
      await patchDoc(`games/${g.id}/deals/${id}`, { settleAtMs: 0 })
      const [pc, pd] = [await purse(g, 'C'), await purse(g, 'D')]
      const [r1, r2] = await race(
        () => call('settleDeal', p.token, { gameId: g.id, dealId: id }),
        () => call('settleDeal', q.token, { gameId: g.id, dealId: id }),
      )
      // 이미 끝난 판에 「끝났다」로 답하는 것은 설계다(already) — 먹은 쪽만 이긴 것으로 센다
      const j = (r: Res) => judge(r, (d) => d.ok === true && d.already !== true, (d) => d.ok === true && d.already === true)
      const o1 = j(r1), o2 = j(r2)
      const d = await dealDoc(id)
      const [qc, qd] = [await purse(g, 'C'), await purse(g, 'D')]
      const trades = (await records(g, 'trade', [['actorId', p.uid]])).length
      const accepted = (await events(g, 'tradeAccepted')).length
      const won = [o1, o2].filter((o) => o[0] === 'won').length
      const notes = [...noteOf(o1), ...noteOf(o2)]
      let consistent = true
      if (d.status !== 'done') { consistent = false; notes.push(`status=${String(d.status)}`) }
      const moved = qc.money === pc.money - won && qc.knowledge === pc.knowledge + won && qd.money === pd.money + won && qd.knowledge === pd.knowledge - won
      if (!moved) { consistent = false; notes.push(`금고 C ${pc.money}/${pc.knowledge}→${qc.money}/${qc.knowledge} D ${pd.money}/${pd.knowledge}→${qd.money}/${qd.knowledge}`) }
      if (trades !== tradesBefore + won) { consistent = false; notes.push(`trade 기록 +${trades - tradesBefore}`) }
      if (accepted !== acceptedBefore + won) { consistent = false; notes.push(`tradeAccepted 이벤트 +${accepted - acceptedBefore}`) }
      tradesBefore = trades
      acceptedBefore = accepted
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })

    // 6d · 두 사람이 같은 셋째에게 동시에 청한다
    const third = D[1]
    const [u, v] = [A[0], A[1]]
    const room2: TileId = 'cafeteria'
    const spot2 = spotIn(room2).spot
    await besideBoth(g, room2, spot2, u, v)
    await putIn(g, third.uid, room2)
    await stand(g, third, spot2.x, spot2.y)
    const liveWith = async (uid: string): Promise<Doc[]> => {
      const [asA, asB] = await Promise.all([query(`games/${g.id}`, 'deals', [['aId', uid]]), query(`games/${g.id}`, 'deals', [['bId', uid]])])
      return [...asA, ...asB].filter((d) => ['asking', 'open', 'settling'].includes(String(d.d.status)))
    }
    const closeAll = async (uid: string) => {
      for (const d of await liveWith(uid)) await patchDoc(`games/${g.id}/deals/${d.id}`, { status: 'gone', why: '시험이 접었다.' })
    }
    await runCase('6d', '두 사람이 같은 셋째에게 askDeal 을 동시에', 1, N, async () => {
      const [r1, r2] = await race(
        () => call('askDeal', u.token, { gameId: g.id, toPlayerId: third.uid }),
        () => call('askDeal', v.token, { gameId: g.id, toPlayerId: third.uid }),
      )
      const o1 = judge(r1, (d) => typeof d.id === 'string'), o2 = judge(r2, (d) => typeof d.id === 'string')
      const live = await liveWith(third.uid)
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = live.length <= 1
      if (!consistent) notes.push(`셋째에게 살아 있는 거래 ${live.length}개`)
      await closeAll(third.uid)
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
    await runCase('6e', '한 사람이 같은 상대에게 askDeal 을 둘 동시에', 1, N, async () => {
      const [r1, r2] = await race(
        () => call('askDeal', u.token, { gameId: g.id, toPlayerId: third.uid }),
        () => call('askDeal', u.token, { gameId: g.id, toPlayerId: third.uid }),
      )
      const o1 = judge(r1, (d) => typeof d.id === 'string'), o2 = judge(r2, (d) => typeof d.id === 'string')
      const live = await liveWith(u.uid)
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = live.length <= 1
      if (!consistent) notes.push(`청한 사람에게 살아 있는 거래 ${live.length}개`)
      await closeAll(third.uid)
      await closeAll(u.uid)
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
  }

  // 9 · 둘이 castBallot 동시에 — 둘 다 된다
  if (wants('9')) {
    await refresh(g)
    await runCase('9', '두 사람이 castBallot 을 동시에 — 둘 다 적힌다', 'all', N, async (i) => {
      for (const d of await listAll(`games/${g.id}/secret/ballots/items`)) await deleteDoc(`games/${g.id}/secret/ballots/items/${d.id}`)
      const a = g.people[(2 * i) % TOTAL_SEATS], b = g.people[(2 * i + 1) % TOTAL_SEATS]
      const target = g.people.find((x) => x.uid !== a.uid && x.uid !== b.uid) as Person
      const [r1, r2] = await race(
        () => call('castBallot', a.token, { gameId: g.id, targetId: target.uid }),
        () => call('castBallot', b.token, { gameId: g.id, targetId: target.uid }),
      )
      const o1 = judge(r1, (d) => d.targetId === target.uid), o2 = judge(r2, (d) => d.targetId === target.uid)
      const rows = await listAll(`games/${g.id}/secret/ballots/items`)
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = rows.length === 2 && rows.every((r) => r.d.targetId === target.uid)
      if (!consistent) notes.push(`표 ${rows.length}장`)
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
  }
}

// ── 페이즈 경주 ──────────────────────────────────────────────────

async function phaseCases(): Promise<void> {
  const ids = ['7a', '7b', '8a', '8b']
  if (!ids.some(wants)) return
  const g = await setupGame('p')
  const A = byTeam(g, 'A'), B = byTeam(g, 'B'), C = byTeam(g, 'C')
  const narrow: TileId = 'cafeteria'
  const cap = capacityOf(narrow)

  // 8b · 자유 시간 roamTo 는 정원을 안 본다 — 둘 다 들어가되 다른 칸
  if (wants('8b')) {
    await refresh(g)
    await must('roamTo', C[0].token, { gameId: g.id, tileId: narrow })
    await runCase('8b', `자유 시간에 정원 ${cap} 인 방으로 둘이 roamTo — 정원 없이 둘 다, 서로 다른 칸`, 'all', N, async () => {
      const [y, z] = [B[0], B[1]]
      const [r1, r2] = await race(
        () => call('roamTo', y.token, { gameId: g.id, tileId: narrow }),
        () => call('roamTo', z.token, { gameId: g.id, tileId: narrow }),
      )
      const o1 = judge(r1, (d) => d.tileId === narrow && d.at != null), o2 = judge(r2, (d) => d.tileId === narrow && d.at != null)
      const rows = await pawns(g)
      const inRoom = rows.filter((p) => p.tileId === narrow)
      const notes = [...noteOf(o1), ...noteOf(o2)]
      const consistent = stacked(rows).length === 0 && inRoom.every((p) => p.at !== null) && inRoom.length === 3
      if (!consistent) notes.push(`방 안 ${inRoom.length}명 겹침 ${stacked(rows).join(' ')}`)
      for (const w of [y, z]) await must('roamTo', w.token, { gameId: g.id, tileId: START_TILE })
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
  }

  await refresh(g)
  await must('openPhase', g.host, { gameId: g.id })
  /** 걷기 예약을 지우고 둘을 제자리에 세운다 — 다음 경주의 전제 */
  const reset = async (who: Person[], team: TeamId, tokens: number) => {
    for (const d of await query(`games/${g.id}`, 'schedule', [['kind', 'arrive']])) await deleteDoc(`games/${g.id}/schedule/${d.id}`)
    for (const p of who) await patchDoc(`games/${g.id}/pawns/${p.uid}`, { tileId: START_TILE, arriveAtMs: null, path: [], fromTile: null })
    await patchDoc(`games/${g.id}/teams/${team}`, { phaseTokens: tokens })
  }
  const walking = (rows: Pawn[], ids: string[]) => rows.filter((p) => ids.includes(p.id) && p.tileId === null).length

  await runCase('7a', '팀 토큰이 1인데 두 팀원이 move 를 동시에', 1, N, async () => {
    const [a, b] = [A[0], A[1]]
    await reset([a, b], 'A', 1)
    const [r1, r2] = await race(
      () => call('phaseAct', a.token, { gameId: g.id, kind: 'move', targetTile: 'artRoom' }),
      () => call('phaseAct', b.token, { gameId: g.id, kind: 'move', targetTile: 'artRoom' }),
    )
    const o1 = judge(r1, (d) => d.walking === true), o2 = judge(r2, (d) => d.walking === true)
    const tokens = await tokensOf(g, 'A')
    const rows = await pawns(g)
    const won = [o1, o2].filter((o) => o[0] === 'won').length
    const notes = [...noteOf(o1), ...noteOf(o2)]
    let consistent = true
    if (tokens !== 1 - won || tokens < 0) { consistent = false; notes.push(`팀 토큰 ${tokens}`) }
    if (walking(rows, [a.uid, b.uid]) !== won) { consistent = false; notes.push(`걷는 사람 ${walking(rows, [a.uid, b.uid])}명`) }
    return { outcomes: [o1[0], o2[0]], consistent, notes }
  })

  await runCase('7b', '한 사람이 move 를 둘 동시에 (토큰 2)', 1, N, async () => {
    const a = A[0]
    await reset([a, A[1]], 'A', 2)
    const [r1, r2] = await race(
      () => call('phaseAct', a.token, { gameId: g.id, kind: 'move', targetTile: 'artRoom' }),
      () => call('phaseAct', a.token, { gameId: g.id, kind: 'move', targetTile: 'scienceRoom' }),
    )
    const o1 = judge(r1, (d) => d.walking === true), o2 = judge(r2, (d) => d.walking === true)
    const tokens = await tokensOf(g, 'A')
    const rows = await pawns(g)
    const won = [o1, o2].filter((o) => o[0] === 'won').length
    const me = rows.find((p) => p.id === a.uid)!
    const notes = [...noteOf(o1), ...noteOf(o2)]
    let consistent = true
    if (tokens !== 2 - won) { consistent = false; notes.push(`팀 토큰 ${tokens} (바란 ${2 - won})`) }
    if ((me.path ?? []).length !== (won > 0 ? 1 : 0)) { consistent = false; notes.push(`path=${JSON.stringify(me.path)}`) }
    return { outcomes: [o1[0], o2[0]], consistent, notes }
  })

  if (wants('8a')) {
    await patchDoc(`games/${g.id}/pawns/${C[0].uid}`, { tileId: narrow, arriveAtMs: null, path: [] })
    await runCase('8a', `정원 ${cap} 인 방에 한 자리 남았을 때 둘이 move 를 동시에`, 1, N, async () => {
      const [a, b] = [B[0], B[1]]
      await reset([a, b], 'B', 6)
      const [r1, r2] = await race(
        () => call('phaseAct', a.token, { gameId: g.id, kind: 'move', targetTile: narrow }),
        () => call('phaseAct', b.token, { gameId: g.id, kind: 'move', targetTile: narrow }),
      )
      const o1 = judge(r1, (d) => d.walking === true), o2 = judge(r2, (d) => d.walking === true)
      const rows = await pawns(g)
      const heading = rows.filter((p) => p.tileId === narrow || (p.path ?? []).includes(narrow)).length
      const tokens = await tokensOf(g, 'B')
      const won = [o1, o2].filter((o) => o[0] === 'won').length
      const notes = [...noteOf(o1), ...noteOf(o2)]
      let consistent = true
      if (heading > cap) { consistent = false; notes.push(`방으로 ${heading}명 (정원 ${cap})`) }
      if (tokens !== 6 - won) { consistent = false; notes.push(`팀 토큰 ${tokens}`) }
      return { outcomes: [o1[0], o2[0]], consistent, notes }
    })
  }
  await must('closePhase', g.host, { gameId: g.id })
}

async function main(): Promise<void> {
  console.log(`동시성 경주 — 경주마다 ${N}번`)
  await freeTimeCases()
  await phaseCases()

  console.log('\n── 결과 ──')
  let bad = 0
  for (const { id, label, expect, t } of tallies) {
    const flaw = t.bothWon + t.bothLost + t.inconsistent + t.unclear
    bad += flaw
    console.log(`${flaw === 0 ? '  ✓' : '  ✗'} [${id}] ${label} — ${expect === 1 ? '하나만' : '둘 다'} · wins ${t.wins} / losses ${t.losses} / both-won ${t.bothWon} / both-lost ${t.bothLost} / inconsistent ${t.inconsistent}${t.unclear ? ` / unclear ${t.unclear}` : ''}`)
  }
  console.log(bad === 0 ? '\n전부 통과' : `\n문제 ${bad}건`)
  if (bad > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
