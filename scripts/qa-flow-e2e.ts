// QA 3 — 흐름 검사. **판이 넘어가는 순서대로 한 대본에서 걷는다.**
//
//   시작 전 → 자유 시간 → 페이즈 → 페이즈 종료(저절로) → 투표(문 · 동률 · 지워진 하루)
//
// 서버가 지금 지키는 규칙을 그대로 참으로 두고 본다.
//
//   1  페이즈가 열려도 아무도 안 옮긴다 — 선 자리에서 시작한다(returned: 0)
//   2  endsAtMs 가 지나면 누가 두드리든(tick · 아무 행동) 그 시각으로 저절로 닫힌다
//   3  투명인간 투표는 운영자가 열어야 적고(hostOpenBallot), 닫는 순간 센다(hostCloseBallot).
//      안 닫고 날을 넘기면 정산이 센다
//
// 검사마다 걸린 시간(ms)을 같이 찍고, 끝에 느린 것부터 늘어놓는다.
//
//   npx vite-node scripts/qa-flow-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { ADJACENCY, START_TILE, TILE_IDS, canRoamTo, roomOfCell, type Cell, type TileId } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { ACT_COST, MOVE_MINUTES, capacityOf } from '../shared/rules/occupy'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const JSONH = { 'Content-Type': 'application/json' }

// ── 검사 · 시간표 ────────────────────────────────────────────────

let failures = 0
const timeline: { label: string; ok: boolean; ms: number; section: string }[] = []
let section = '준비'
let mark = Date.now()
function head(title: string): void {
  section = title
  console.log(`\n── ${title} ──`)
  mark = Date.now()
}
function check(ok: boolean, label: string, detail = ''): void {
  const now = Date.now()
  const ms = now - mark
  mark = now
  if (!ok) failures += 1
  timeline.push({ label, ok, ms, section })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}  (${ms}ms)`)
}
const korean = (s: unknown): boolean => /[가-힣]/.test(String(s ?? ''))
/** 거절 문구에 내부가 새는가 — 스택 · 영어 오류 · 문서 경로 */
const leaky = (s: unknown): boolean => /Error|undefined|null|at \w+\.|firestore|\/games\//i.test(String(s ?? ''))
/** 거절 문구 모음 — 끝에 표로 낸다 */
const refusals: { where: string; code: string; message: string }[] = []
function refused(where: string, r: Res): void {
  refusals.push({ where, code: String(r.code ?? (r.ok ? 'ok' : '?')), message: String(r.message ?? '') })
}

// ── Firestore REST ───────────────────────────────────────────────

function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return o.doubleValue
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('timestampValue' in o) return o.timestampValue
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
/** 문서 하나. 누구 열쇠로 읽는지를 고른다 — 참가자 증표로 읽으면 규칙(firestore.rules)을 거친다 */
async function getDoc(path: string, headers: Record<string, string> = ADMIN): Promise<{ status: number; d: Record<string, unknown> | null; text: string }> {
  const r = await fetch(`${FS}/${path}`, { headers })
  const text = await r.text()
  if (!r.ok) return { status: r.status, d: null, text }
  return { status: r.status, d: plain(JSON.parse(text)) as Record<string, unknown>, text }
}
const asPlayer = (tk: string) => ({ Authorization: `Bearer ${tk}` })

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
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
/**
 * 콜러블 하나. **답이 안 오면 여기서 끊는다** — 에뮬레이터가 붐빌 때(다른 대본들이
 * 같이 돌 때) 서버는 일을 끝냈는데 답이 안 돌아오는 일이 있었다. 그냥 두면 대본이
 * 영영 기다린다. 시간을 재는 대본이라 어디서 얼마나 걸렸는지가 보여야 한다
 */
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 180_000)
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  const began = Date.now()
  let r: Response
  try {
    r = await fetch(`${FN}/${name}`, {
      method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (e) {
    throw new Error(`${name}: ${Math.round((Date.now() - began) / 1000)}초 동안 답이 없다 (${String((e as Error).name)})`)
  }
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}

// ── 판 ──────────────────────────────────────────────────────────

const GAME = `fl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000

interface Person { i: number; uid: string; token: string; team: TeamId }
interface PawnRow { tileId: TileId | null; at: Cell | null; team: TeamId; arriveAtMs?: number | null; votedToday?: boolean }

const pawnsNow = async (): Promise<Record<string, PawnRow>> =>
  Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d as unknown as PawnRow]))
const gameNow = async () => (await getDoc(`games/${GAME}`)).d ?? {}
const teamNow = async (t: TeamId) => (await getDoc(`games/${GAME}/teams/${t}`)).d ?? {}
const same = (a: Cell | null | undefined, b: Cell | null | undefined): boolean => !!a && !!b && a.x === b.x && a.y === b.y
const key = (c: Cell | null | undefined) => (c ? `${c.x},${c.y}` : 'null')
const spot = (p: PawnRow | undefined) => `${p?.tileId ?? 'null'}@${key(p?.at)}`
const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
/** 옆 방(계단은 방이 아니다). 페이즈 걸음이면 정원이 남은 방만 */
async function nextRoomOf(here: TileId, forPhase = false): Promise<TileId> {
  // 교실(열넷이 모이는 곳)과 좁은 방은 뒤로 — 넓은 방부터
  const rooms = ADJACENCY[here]
    .filter((t) => TILE_IDS.includes(t))
    .sort((a, b) => Number(a === START_TILE) - Number(b === START_TILE) || capacityOf(b) - capacityOf(a))
  if (!forPhase) return rooms[0]
  const pz = await pawnsNow()
  const load = (t: TileId) => Object.values(pz).filter((p) => p.tileId === t).length
  return rooms.find((t) => load(t) < capacityOf(t)) ?? rooms[0]
}

/** 그 방에서 설 수 있는 칸 — 가구 · 기물 · 지금 남이 선 칸을 뺀다 */
async function freeCellsIn(room: TileId, except: string): Promise<Cell[]> {
  const pz = await pawnsNow()
  const taken = new Set(Object.entries(pz).filter(([id, p]) => id !== except && p.tileId !== null && p.at).map(([, p]) => key(p.at)))
  return dropCellsIn(room).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(key(c)))
}
/** 서 있는 칸에서 이어지는 걸음 n 개 — 한 칸씩, 되돌아가도 된다(막다른 곳에서) */
function walkOf(from: Cell, free: readonly Cell[], n: number): Cell[] {
  const ok = new Set(free.map(key))
  const seen = new Set<string>([key(from)])
  const path: Cell[] = [from]
  let cur = from
  for (let i = 0; i < n; i++) {
    const around = [
      { x: cur.x + 1, y: cur.y }, { x: cur.x - 1, y: cur.y }, { x: cur.x, y: cur.y + 1 }, { x: cur.x, y: cur.y - 1 },
    ].filter((c) => ok.has(key(c)))
    const fresh = around.find((c) => !seen.has(key(c)))
    const next = fresh ?? (path.length >= 2 ? path[path.length - 2] : around[0])
    if (!next) break
    seen.add(key(next))
    path.push(next)
    cur = next
  }
  return path.slice(1)
}
/** 그 방으로 걸어간다. 이미 거기면 그대로 둔다(roamTo 는 「이미 그 방이다」로 거절한다) */
async function goTo(p: Person, room: TileId): Promise<void> {
  if ((await pawnsNow())[p.uid]?.tileId === room) return
  await must('roamTo', p.token, { gameId: GAME, tileId: room })
}
/** 확실히 칸에 세운다. 못 서면 던진다 — 엉뚱한 칸에서 뒤를 재면 안 된다 */
async function stand(tk: string, c: Cell): Promise<void> {
  const r = await must('standAt', tk, { gameId: GAME, x: c.x, y: c.y })
  if (r.ok !== true) throw new Error(`standAt ${key(c)} 안 섰다: ${String(r.code ?? '')} ${String(r.why ?? '')}`)
}
/** 둘을 같은 방의 **바로 옆 칸**에 세운다 */
async function sideBySide(a: Person, b: Person, room: TileId): Promise<{ a: Cell; b: Cell }> {
  const free = await freeCellsIn(room, a.uid)
  const ok = new Set(free.map(key))
  const pz = await pawnsNow()
  const bAt = pz[b.uid]?.at ?? null
  for (const c of free) {
    const right = { x: c.x + 1, y: c.y }
    if (!ok.has(key(right)) && !same(right, bAt)) continue
    await stand(a.token, c)
    await stand(b.token, right)
    return { a: c, b: right }
  }
  throw new Error(`${room} 안에 나란히 설 빈 칸이 없다`)
}

async function main(): Promise<void> {
  const t0 = Date.now()
  console.log(`판 ${GAME}`)
  head('판 세우기')
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'flow' })
  const people: Person[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ i, ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  const byId = new Map(people.map((p) => [p.uid, p]))
  const P = (i: number) => people[i]
  const clock = async (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  check(people.length === TOTAL_SEATS, `열넷이 앉았다`, `${people.length}`)

  // ════════════════════════════════════════════════════════════════
  head('시작 전 → 자유 시간')
  {
    const g = await gameNow()
    const seats = (g.seats as unknown[]) ?? []
    const pawns = await getAll(`games/${GAME}/pawns`)
    check(g.phase === 'lobby' && seats.length === 14, '시작 전: 자리 열넷이 찼고 아직 로비다', `phase=${g.phase} seats=${seats.length} pawns=${pawns.length}`)
    const early = await call('chatLines', P(1).token, { gameId: GAME, sinceMs: 0 })
    check(early.ok && early.data?.here === START_TILE && early.data?.stay === 'lobby', '시작 전에는 서버가 열넷을 2-3 교실로 친다(chatLines.here)', `${String(early.data?.here)} · ${String(early.data?.stay)}`)

    const roam = await call('roamTo', P(0).token, { gameId: GAME, tileId: 'scienceRoom' })
    refused('시작 전 roamTo', roam)
    check(!roam.ok && korean(roam.message), '시작 전 roamTo 는 거절된다(한국어)', `${roam.code} ${roam.message}`)

    // standAt — 말(pawns)은 startGame 에 놓인다. 시작 전 교실 안 걸음은 화면이 live/{uid} 에 직접 적는다
    const c0 = START_CELLS[0]
    const st = await call('standAt', P(0).token, { gameId: GAME, x: c0.x, y: c0.y })
    refused('시작 전 standAt', st)
    check(!st.ok ? korean(st.message) : true, `시작 전 standAt(교실 안 ${key(c0)}) — 서버 답을 기록한다`, st.ok ? `ok ${JSON.stringify(st.data)}` : `${st.code} ${st.message}`)
    const liveW = await fetch(`${FS}/games/${GAME}/live/${P(0).uid}`, {
      method: 'PATCH', headers: { ...JSONH, ...asPlayer(P(0).token) },
      body: JSON.stringify({ fields: { x: { integerValue: String(c0.x) }, y: { integerValue: String(c0.y) }, tileId: { stringValue: START_TILE } } }),
    })
    const liveR = await getDoc(`games/${GAME}/live/${P(0).uid}`, asPlayer(P(1).token))
    check(liveW.ok && liveR.status === 200 && Number(liveR.d?.x) === c0.x, '시작 전 교실 안 자리는 live/{uid} 에 직접 적고, 남도 읽는다(규칙)', `write ${liveW.status} · read ${liveR.status}`)

    const said = await call('say', P(0).token, { gameId: GAME, text: '시작 전 한마디' })
    const heard = await call('chatLines', P(1).token, { gameId: GAME, sinceMs: 0 })
    const lines = (heard.data?.lines as { text: string; playerId: string }[]) ?? []
    check(said.ok && lines.some((l) => l.text === '시작 전 한마디' && l.playerId === P(0).uid), '시작 전 say 가 되고 chatLines 로 돌아온다', said.ok ? `${lines.length}줄` : `${said.code} ${said.message}`)

    for (const [name, data] of [
      ['castVote', { gameId: GAME, targetId: P(1).uid, kind: 'trust' }],
      ['askDeal', { gameId: GAME, toPlayerId: P(1).uid }],
      ['phaseAct', { gameId: GAME, kind: 'plant' }],
      ['castBallot', { gameId: GAME, targetId: P(1).uid }],
      ['takeErrand', { gameId: GAME, errandId: 'nope' }],
      ['buyShopItem', { gameId: GAME, itemId: 'paper' }],
    ] as const) {
      const r = await call(name, P(0).token, data)
      refused(`시작 전 ${name}`, r)
      check(!r.ok && korean(r.message) && !leaky(r.message), `시작 전 ${name} 은 한국어로 거절된다`, `${r.code} ${r.message}`)
    }
  }

  // ── startGame ──
  {
    // P(13) 은 여기까지 아무 호출도 안 했다(joinGame 뿐) — 「늦게 접속한 사람」
    await must('startGame', host, { gameId: GAME, startAtMs: START })
    await clock(dayHourMs(START, 1, 10))
    const views = await Promise.all(people.map((p) => getDoc(`games/${GAME}/views/${p.uid}`, asPlayer(p.token))))
    const states = await Promise.all(people.map(async (p) => {
      const ph = await must('phaseNow', p.token, { gameId: GAME })
      const ck = await must('clockNow', p.token, { gameId: GAME })
      return `open=${ph.open} no=${ph.no} day=${ck.day}`
    }))
    const shape = views.map((v) => `${v.status}:${(v.d?.visiblePawns as unknown[] | undefined)?.length}:${v.d?.updatedAtMs}:${JSON.stringify(v.d?.visibleTiles)}`)
    check(views.every((v) => v.status === 200), '시작 직후 열넷 모두 제 views/{uid} 를 읽는다(제 증표)', views.map((v) => v.status).join(' '))
    const seenCount = ((views[0].d?.visiblePawns as unknown[] | undefined) ?? []).length
    check(new Set(shape).size === 1 && seenCount === 14, '열넷의 화면 문서가 같다 — visiblePawns 14 · 같은 갱신 시각 · 같은 방', shape[0])
    check(new Set(states).size === 1 && states[0].includes('open=false') && states[0].includes('day=1'), '열넷이 같은 날 · 같은 페이즈 상태를 본다', states[0])
    check(shape[13] === shape[0] && states[13] === states[0], '시작 뒤에 처음 들어온 사람(늦은 접속)도 같은 상태다', shape[13])
    const late = await auth(await signUp(`late-${GAME}@x.test`))
    const join = await call('joinGame', late.token, { gameId: GAME, name: '늦둥이' })
    refused('시작 뒤 joinGame', join)
    check(!join.ok && korean(join.message), '시작 뒤에 온 열다섯째는 자리를 못 받는다', `${join.code} ${join.message}`)
    const own = await getDoc(`games/${GAME}/views/${P(0).uid}`, asPlayer(P(1).token))
    check(own.status === 403, '남의 views 는 못 읽는다', String(own.status))
  }

  // ════════════════════════════════════════════════════════════════
  head('자유 시간 중 — 걸음')
  const A = P(0)
  const B = P(1)
  // 2-3 교실에서 곧장 갈 수 있는 방 가운데 설 칸이 가장 많은 방
  // 옆에 넓은 방이 있는 넓은 방만 — 옥상(정원 2 · 이웃 없음) · 연구실(이웃 없음)은 뺀다
  const reach = TILE_IDS.filter((t) => t !== START_TILE && canRoamTo(START_TILE, t) && capacityOf(t) >= 6
    && ADJACENCY[t].some((x) => TILE_IDS.includes(x) && x !== START_TILE && capacityOf(x) >= 6))
  const roomA = [...reach].sort((x, y) => dropCellsIn(y).length - dropCellsIn(x).length)[0]
  {
    const went = await must('roamTo', A.token, { gameId: GAME, tileId: roomA })
    let cur = went.at as Cell
    check(went.tileId === roomA && !!cur && roomOfCell(cur.x, cur.y) === roomA, `A 가 ${roomA} 에 들어섰다`, `${key(cur)}`)
    const path = walkOf(cur, await freeCellsIn(roomA, A.uid), 20)
    let okAll = 0
    let placed = 0
    let steps = 0
    let firstBad = ''
    for (const c of path) {
      const r = await call('standAt', A.token, { gameId: GAME, x: c.x, y: c.y })
      const at = (await pawnsNow())[A.uid].at as Cell
      const okNow = r.ok && r.data?.ok === true
      if (okNow) okAll += 1
      if (same(at, c)) placed += 1
      if (manhattan(at, cur) === 1) steps += 1
      if ((!okNow || !same(at, c)) && !firstBad) firstBad = `${key(cur)}→${key(c)}: ${r.ok ? JSON.stringify(r.data) : r.message} 서버=${key(at)}`
      cur = at
    }
    check(path.length === 20, '방 안에 이어지는 스무 걸음을 골랐다', `${path.length}걸음`)
    check(okAll === path.length, `스무 걸음 모두 ok:true`, `${okAll}/${path.length} ${firstBad}`)
    check(placed === path.length, '걸음마다 서버 칸이 요청한 칸과 같다 — 되돌림 없음', `${placed}/${path.length}`)
    check(steps === path.length, '걸음마다 서버 칸 사이 거리가 1 — 순간이동 없음', `${steps}/${path.length}`)

    // 경쟁 도착 — B 가 A 가 딛으려는 칸에 먼저 선다
    await must('roamTo', B.token, { gameId: GAME, tileId: roomA })
    const aWas = (await pawnsNow())[A.uid].at as Cell
    const free = await freeCellsIn(roomA, A.uid)
    const target = free.find((c) => manhattan(c, aWas) === 1) as Cell
    const bFirst = await must('standAt', B.token, { gameId: GAME, x: target.x, y: target.y })
    const aThen = await must('standAt', A.token, { gameId: GAME, x: target.x, y: target.y })
    const aNow = (await pawnsNow())[A.uid].at as Cell
    check(bFirst.ok === true, `B 가 먼저 ${key(target)} 에 섰다`)
    check(aThen.ok === false && aThen.code === 'occupied', 'A 의 걸음은 occupied 로 거절된다', `${String(aThen.code)} ${String(aThen.why)}`)
    check(same(aThen.at as Cell, aWas), '거절 답의 at 은 A 의 원래 칸이다', `${key(aThen.at as Cell)} = ${key(aWas)}`)
    check(same(aNow, aWas), 'A 의 서버 칸은 그대로다', key(aNow))
  }

  // ── 방 바꾸기 ──
  const roomB = await nextRoomOf(roomA)
  {
    const r = await must('roamTo', A.token, { gameId: GAME, tileId: roomB })
    const at = r.at as Cell | null
    const p = (await pawnsNow())[A.uid]
    check(r.tileId === roomB && at !== null && roomOfCell(at.x, at.y) === roomB, `roamTo ${roomA}→${roomB}: 답의 tileId 가 새 방이고 at 이 그 방 안이다`, `${String(r.tileId)}@${key(at)}`)
    check(p.tileId === roomB && p.at !== null && same(p.at, at), '말 문서도 같다 — at 이 null 이 아니다', spot(p))
  }

  // ════════════════════════════════════════════════════════════════
  head('자유 시간 중 — 옆 칸 행동')
  {
    await must('roamTo', B.token, { gameId: GAME, tileId: roomB })
    const seats = await sideBySide(A, B, roomB)
    const asked = await call('askDeal', A.token, { gameId: GAME, toPlayerId: B.uid })
    check(asked.ok, '옆 칸이면 askDeal 이 된다', asked.ok ? String(asked.data?.id) : `${asked.code} ${asked.message}`)
    if (asked.ok) await must('cancelDeal', A.token, { gameId: GAME, dealId: String(asked.data?.id) })
    const gone = (await getAll(`games/${GAME}/deals`)).find((d) => d.id === String(asked.data?.id))
    check(gone?.d.status === 'gone', '물리면 거래가 gone 이다', String(gone?.d.status))

    // B 를 두 칸 떨어진 곳으로
    const free = await freeCellsIn(roomB, B.uid)
    const far = free.find((c) => manhattan(c, seats.a) === 2 && !same(c, seats.b)) ?? free.find((c) => manhattan(c, seats.a) >= 2) as Cell
    await stand(B.token, far)
    const apart = await call('askDeal', A.token, { gameId: GAME, toPlayerId: B.uid })
    refused('떨어진 askDeal', apart)
    check(!apart.ok && korean(apart.message), `두 칸(${manhattan(far, seats.a)}) 떨어지면 askDeal 이 거절된다`, `${apart.code} ${apart.message}`)

    // castVote — **옆 칸에만** 준다(vote.ts · cellsTouch). 같은 방이어도 두 칸 떨어지면 안 된다
    const voteApart = await call('castVote', A.token, { gameId: GAME, targetId: B.uid, kind: 'trust' })
    refused('떨어진 castVote', voteApart)
    check(!voteApart.ok && korean(voteApart.message), `castVote 는 같은 방이어도 떨어져 있으면(${manhattan(far, seats.a)}칸) 거절된다`, `${voteApart.code} ${voteApart.message}`)
    await sideBySide(A, B, roomB)
    const voteNext = await call('castVote', A.token, { gameId: GAME, targetId: B.uid, kind: 'trust' })
    check(voteNext.ok, 'castVote 는 옆 칸이면 된다', voteNext.ok ? JSON.stringify(voteNext.data) : `${voteNext.code} ${voteNext.message}`)
    const C = P(2)
    await must('roamTo', C.token, { gameId: GAME, tileId: roomB })
    await must('roamTo', B.token, { gameId: GAME, tileId: roomA })
    const voteOther = await call('castVote', C.token, { gameId: GAME, targetId: B.uid, kind: 'trust' })
    refused('다른 방 castVote', voteOther)
    check(!voteOther.ok && korean(voteOther.message), 'castVote 는 다른 방이면 거절된다', `${voteOther.code} ${voteOther.message}`)
    await must('roamTo', B.token, { gameId: GAME, tileId: roomB })

    // 동시에 서로 청한다
    await sideBySide(A, B, roomB)
    const both = await Promise.all([
      call('askDeal', A.token, { gameId: GAME, toPlayerId: B.uid }),
      call('askDeal', B.token, { gameId: GAME, toPlayerId: A.uid }),
    ])
    const LIVE = ['asking', 'open', 'settling']
    const live = (await getAll(`games/${GAME}/deals`)).filter((d) => LIVE.includes(String(d.d.status)) && [A.uid, B.uid].includes(String(d.d.aId)))
    const ids = new Set(both.filter((r) => r.ok).map((r) => String(r.data?.id)))
    check(live.length === 1, 'A→B · B→A 를 같은 순간에 청해도 살아 있는 거래는 하나다', `${live.length}개 · 답 ${both.map((r) => (r.ok ? 'ok' : r.code)).join('/')}`)
    check(ids.size <= 1 && both.filter((r) => r.ok).length >= 1, '한쪽은 거절되거나 같은 거래다 — 둘이 생기지 않는다', both.map((r) => (r.ok ? String(r.data?.id) : String(r.message))).join(' · '))
    for (const d of live) await must('cancelDeal', byId.get(String(d.d.aId))!.token, { gameId: GAME, dealId: d.id })
  }

  // ════════════════════════════════════════════════════════════════
  head('자유 시간 → 페이즈')
  const rooms4 = reach.slice(0, 4)
  const offline = P(13)
  const mover = P(4)
  const planter = P(6)
  const walker = P(8)
  let opened: Record<string, unknown> = {}
  let atOpen: Record<string, PawnRow> = {}
  {
    // 넷씩 흩어 놓는다. P(10)~P(13) 은 교실에 그대로 — P(13) 은 끝까지 안 건드린다
    for (let i = 2; i < 10; i++) await goTo(P(i), rooms4[(i - 2) % 4])
    const before = await pawnsNow()
    const roomsUsed = new Set(Object.values(before).map((p) => p.tileId))
    check(roomsUsed.size >= 4 && Object.values(before).every((p) => p.tileId !== null && p.at !== null), `열넷이 ${roomsUsed.size}개 방에 흩어져 있고 모두 칸이 있다`, [...roomsUsed].join(' '))

    const T0 = dayHourMs(START, 1, 10)
    await clock(T0)
    opened = await must('openPhase', host, { gameId: GAME })
    atOpen = await pawnsNow()
    const moved = people.filter((p) => spot(before[p.uid]) !== spot(atOpen[p.uid])).map((p) => `봇${p.i} ${spot(before[p.uid])}→${spot(atOpen[p.uid])}`)
    check(Number(opened.returned) === 0, 'openPhase 가 아무도 안 옮긴다 — returned 0', `${opened.returned}`)
    check(moved.length === 0, '열넷의 tileId · at 이 열기 전과 똑같다', moved.join(' · ') || '14/14 같다')
    // 배속 1 이라 setDevClock 과 openPhase 사이에도 게임 시계가 실제로 흐른다 — 몇 초 안이면 같은 시각으로 친다
    const drift = Number(opened.endsAtMs) - (T0 + 60 * M)
    check(drift >= 0 && drift < 10_000, '끝나는 시각이 한 시간 뒤다(호출 사이에 흐른 몇 초까지)', `${(Number(opened.endsAtMs) - T0) / M}분 (+${drift}ms)`)

    // 자유 시간 전용 행동은 막힌다
    for (const [name, data] of [
      ['roamTo', { gameId: GAME, tileId: START_TILE }],
      ['takeErrand', { gameId: GAME, errandId: 'nope' }],
      ['pickUpThing', { gameId: GAME }],
      ['harvestPot', { gameId: GAME, pot: 0 }],
      ['buyShopItem', { gameId: GAME, itemId: 'paper' }],
    ] as const) {
      const r = await call(name, P(2).token, data)
      refused(`페이즈 중 ${name}`, r)
      check(!r.ok && /페이즈|자유/.test(String(r.message)), `페이즈 중 ${name} 은 거절된다(페이즈/자유 시간)`, `${r.code} ${r.message}`)
    }

    // 페이즈 행동은 된다 — 옆방으로 걷기(토큰 1) · 깃발
    const here = atOpen[mover.uid].tileId as TileId
    const to = await nextRoomOf(here, true)
    const tokensBefore = Number((await teamNow(mover.team)).phaseTokens)
    const step = await call('phaseAct', mover.token, { gameId: GAME, kind: 'move', targetTile: to })
    const tokensAfter = Number((await teamNow(mover.team)).phaseTokens)
    check(step.ok && step.data?.walking === true, `phaseAct move ${here}→${to} 가 된다(걷기 시작)`, step.ok ? JSON.stringify(step.data) : `${step.code} ${step.message}`)
    check(tokensAfter === tokensBefore - ACT_COST.move, `팀 ${mover.team} 상자에서 토큰 ${ACT_COST.move}개가 빠진다`, `${tokensBefore} → ${tokensAfter}`)
    const pRoom = atOpen[planter.uid].tileId as TileId
    const plant = await call('phaseAct', planter.token, { gameId: GAME, kind: 'plant' })
    const flags = ((await getDoc(`games/${GAME}/secret/flags`)).d?.tiles as Record<string, Record<string, number>> | undefined) ?? {}
    check(plant.ok && flags[pRoom]?.[planter.team] === 1, `phaseAct plant 가 ${pRoom} 에 ${planter.team} 깃발 하나를 꽂는다`, plant.ok ? JSON.stringify(flags[pRoom]) : `${plant.code} ${plant.message}`)

    // 걷던 사람이 도착하게 시계를 민다
    await clock(T0 + (MOVE_MINUTES + 1) * M)
    await must('tick', host, { gameId: GAME })
    const m = (await pawnsNow())[mover.uid]
    check(m.tileId === to && m.at !== null, `${MOVE_MINUTES}분 뒤 옆방에 도착했다`, spot(m))
    const off = (await pawnsNow())[offline.uid]
    check(spot(off) === spot(atOpen[offline.uid]), '한 번도 안 두드린 사람(offline)은 열린 뒤에도 그 자리다', spot(off))
  }

  // ════════════════════════════════════════════════════════════════
  head('페이즈 종료 — 저절로')
  const no = Number(opened.no)
  const endsAt = Number(opened.endsAtMs)
  let atClose: Record<string, PawnRow> = {}
  let walkerTo: TileId = START_TILE
  {
    await clock(endsAt - 2 * M)
    const from = (await pawnsNow())[walker.uid].tileId as TileId
    walkerTo = await nextRoomOf(from, true)
    const w = await call('phaseAct', walker.token, { gameId: GAME, kind: 'move', targetTile: walkerTo })
    const wp = (await pawnsNow())[walker.uid]
    const lateBy = Number(wp.arriveAtMs) - (endsAt + (MOVE_MINUTES - 2) * M)
    check(w.ok && wp.tileId === null && lateBy >= 0 && lateBy < 10_000, `끝나기 2분 전에 걷기 시작 — 도착은 끝난 뒤(${MOVE_MINUTES - 2}분 뒤)`, w.ok ? `${from}→${walkerTo} arrive=+${(Number(wp.arriveAtMs) - endsAt) / M}분` : `${w.code} ${w.message}`)

    await clock(endsAt + 1000)
    const ticked = await call('tick', P(10).token, { gameId: GAME })
    const g = await gameNow()
    const pn = g.phaseNow as { open: boolean; no: number; endsAtMs: number }
    atClose = await pawnsNow()
    check(ticked.ok && pn.open === false && Number(g.phaseDone) === no, '참가자의 tick 한 번에 페이즈가 저절로 닫힌다', `open=${pn.open} phaseDone=${g.phaseDone}`)
    const log = await getDoc(`games/${GAME}/phaseLog/${no}`)
    check(log.status === 200 && Number(log.d?.atMs) === endsAt, `phaseLog/${no} 가 생기고 atMs 가 endsAtMs 다`, `${log.d?.atMs} vs ${endsAt}`)
    const wAt = atClose[walker.uid]
    const caps = await getAll(`games/${GAME}/captures`)
    const standingWalker = caps.filter((c) => ((c.d.standing as string[]) ?? []).includes(walker.uid)).map((c) => c.id)
    check(wAt.tileId === null, '닫히는 순간 걷던 사람은 어느 방에도 없다(tileId null)', spot(wAt))
    check(standingWalker.length === 0 && !JSON.stringify(log.d?.lines).includes(walker.uid), '닫힐 때 방 머릿수(captures.standing) · phaseLog 어디에도 걷던 사람이 없다', `captures ${caps.length}건`)
    check(caps.every((c) => Number(c.d.atMs) === endsAt), `판정(captures)의 시각이 모두 endsAtMs 다`, `${caps.length}건`)

    // 열넷이 같은 phaseLog 를 읽는다
    const logs = await Promise.all(people.map((p) => getDoc(`games/${GAME}/phaseLog/${no}`, asPlayer(p.token))))
    const bodies = new Set(logs.map((l) => JSON.stringify(l.d)))
    check(logs.every((l) => l.status === 200) && bodies.size === 1, `열넷 모두 phaseLog/${no} 를 읽고 내용이 똑같다`, `${logs.filter((l) => l.status === 200).length}/14 · ${bodies.size}가지`)

    // 닫힌 뒤: 걷던 사람 말고는 그 자리, 자유 시간 걸음이 된다
    const changed = people
      .filter((p) => p.uid !== walker.uid && p.uid !== mover.uid && spot(atOpen[p.uid]) !== spot(atClose[p.uid]))
      .map((p) => `봇${p.i} ${spot(atOpen[p.uid])}→${spot(atClose[p.uid])}`)
    check(changed.length === 0, '닫힌 직후 자리가 그대로다(걸어간 둘 말고)', changed.join(' · ') || '12/12 같다')
    check(spot(atClose[offline.uid]) === spot(atOpen[offline.uid]), 'offline 사람은 페이즈 내내 그 자리였다', spot(atClose[offline.uid]))
    const roamBack = await call('roamTo', P(2).token, { gameId: GAME, tileId: START_TILE })
    check(roamBack.ok, '닫힌 직후 roamTo 가 다시 된다 — 자유 시간', roamBack.ok ? String(roamBack.data?.tileId) : `${roamBack.code} ${roamBack.message}`)
    const again = await call('closePhase', host, { gameId: GAME })
    check(again.ok && again.data?.alreadyClosed === true, '이미 저절로 닫힌 뒤 운영자의 closePhase 는 alreadyClosed:true 로 답한다(오류 아님)', JSON.stringify(again.data))

    // 걷던 사람은 자유 시간에 도착한다
    await clock(endsAt + (MOVE_MINUTES + 1) * M)
    await must('tick', host, { gameId: GAME })
    const wNow = (await pawnsNow())[walker.uid]
    check(wNow.tileId === walkerTo && wNow.at !== null && roomOfCell(wNow.at.x, wNow.at.y) === walkerTo, '시계를 도착 뒤로 밀면 자유 시간에 도착한다', spot(wNow))
    const stillClosed = await must('phaseNow', walker.token, { gameId: GAME })
    check(stillClosed.open === false, '도착해도 페이즈는 닫힌 채다', JSON.stringify(stillClosed))
  }

  // ════════════════════════════════════════════════════════════════
  head('투표 — 문 · 동률 (DAY 1)')
  const T1 = people.find((p) => p.i !== 0) as Person
  const T2 = people.find((p) => p.i !== 0 && p.uid !== T1.uid) as Person
  {
    const early = await call('castBallot', P(0).token, { gameId: GAME, targetId: T1.uid })
    refused('열기 전 castBallot', early)
    check(!early.ok && early.message === '아직 투표가 열리지 않았다.', '열기 전 castBallot 은 「아직 투표가 열리지 않았다.」', `${early.code} ${early.message}`)
    const notHost = await call('hostOpenBallot', P(0).token, { gameId: GAME })
    check(notHost.code === 'PERMISSION_DENIED', '참가자의 hostOpenBallot 은 PERMISSION_DENIED', `${notHost.code} ${notHost.message}`)
    const op = await must('hostOpenBallot', host, { gameId: GAME })
    const g1 = await gameNow()
    check(op.open === true && (g1.ballot as { open: boolean; day: number })?.open === true && Number(op.day) === 1, '운영자가 열면 ballot.open 이 참이다', JSON.stringify(g1.ballot))

    // 봇0 은 먼저 T2 를 적고 나중에 T1 로 바꾼다. 짝수 → T1, 홀수 → T2 (자기면 반대쪽) — 7:7 동률
    await must('castBallot', P(0).token, { gameId: GAME, targetId: T2.uid })
    const pickFor = (p: Person) => {
      const want = p.i % 2 === 0 ? T1 : T2
      return want.uid === p.uid ? (want === T1 ? T2 : T1) : want
    }
    const outs = await Promise.all(people.map((p) => call('castBallot', p.token, { gameId: GAME, targetId: pickFor(p).uid })))
    check(outs.every((o) => o.ok), '열린 뒤 열넷이 모두 적는다', outs.map((o) => (o.ok ? 'ok' : o.message)).filter((x) => x !== 'ok').join(' · ') || '14/14')
    const rows = await getAll(`games/${GAME}/secret/ballots/items`)
    const mine = rows.filter((r) => r.d.voterId === P(0).uid)
    const tally = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [String(r.d.targetId)]: (m[String(r.d.targetId)] ?? 0) + 1 }), {})
    check(mine.length === 1 && mine[0].d.targetId === T1.uid, '바꾼 사람은 마지막에 적은 이름 한 장만 남는다', `${mine.length}장 → ${mine[0]?.d.targetId === T1.uid ? 'T1' : '?'}`)
    check(rows.length === 14 && tally[T1.uid] === tally[T2.uid], '열넷 장, 두 사람이 동률이다', `${tally[T1.uid]}:${tally[T2.uid]}`)
    const v0 = await getDoc(`games/${GAME}/views/${P(0).uid}`, asPlayer(P(0).token))
    check(v0.d?.myBallot === T1.uid, '본인 화면에는 제가 적은 한 줄이 온다', String(v0.d?.myBallot))

    const closed = await must('hostCloseBallot', host, { gameId: GAME })
    const d1 = await getDoc(`games/${GAME}/secret/ballotDays/items/d1`)
    const g = await gameNow()
    const byDay = (g.invisibleByDay as Record<string, string | null>) ?? {}
    check(closed.open === false && d1.status === 200 && d1.d?.invisibleId === null && String(d1.d?.reason) === 'tie', '닫으면 그 자리에서 센다 — ballotDays/d1 이 동률(tie)로 남는다', JSON.stringify(d1.d))
    check('2' in byDay && byDay['2'] === null, 'invisibleByDay[2] 가 null 이다', JSON.stringify(byDay))
    check((g.ballot as { open: boolean }).open === false && g.invisibleId == null, 'ballot.open 이 거짓이고 지워진 사람은 없다', `open=${(g.ballot as { open: boolean }).open} invisibleId=${g.invisibleId}`)
    const late = await call('castBallot', P(3).token, { gameId: GAME, targetId: T1.uid })
    refused('센 뒤 castBallot', late)
    check(!late.ok && korean(late.message), '센 뒤에는 더 못 적는다', `${late.code} ${late.message}`)
    const reopen = await call('hostOpenBallot', host, { gameId: GAME })
    refused('센 날 hostOpenBallot', reopen)
    check(!reopen.ok && korean(reopen.message), '이미 센 날은 다시 못 연다', `${reopen.code} ${reopen.message}`)
  }

  // ════════════════════════════════════════════════════════════════
  head('투표 — 정해진 사람 (DAY 2 → 3)')
  const X = people.find((p) => p.team === 'B') as Person
  const Y = people.find((p) => p.uid !== X.uid && p.team === 'B') as Person
  {
    const s1 = await must('pushDay', host, { gameId: GAME })
    const s2 = await must('pushDay', host, { gameId: GAME })
    const g2 = await gameNow()
    check((s1.pushed as { kind: string })?.kind === 'settlement' && (s2.pushed as { kind: string; day: number })?.kind === 'dayStart' && g2.day === 2, '정산 → 아침을 넘겨 DAY 2 다', `${JSON.stringify(s1.pushed)} ${JSON.stringify(s2.pushed)} day=${g2.day}`)
    check(g2.invisibleId == null, 'DAY 2 에 지워진 사람은 없다(동률)', String(g2.invisibleId))
    await clock(dayHourMs(START, 2, 10))

    await must('hostOpenBallot', host, { gameId: GAME })
    const outs = await Promise.all(people.map((p) => call('castBallot', p.token, { gameId: GAME, targetId: p.uid === X.uid ? T1.uid : X.uid })))
    check(outs.every((o) => o.ok), `열넷이 적는다 — 열셋이 봇${X.i}(X) 를`, outs.filter((o) => !o.ok).map((o) => o.message).join(' · ') || '14/14')
    const closed = await must('hostCloseBallot', host, { gameId: GAME })
    const d2 = await getDoc(`games/${GAME}/secret/ballotDays/items/d2`)
    const gAfter = await gameNow()
    const byDay = (gAfter.invisibleByDay as Record<string, string | null>) ?? {}
    check(closed.open === false && d2.d?.invisibleId === X.uid && String(d2.d?.reason) === 'picked', '닫으면 X 가 뽑힌다(picked)', JSON.stringify(d2.d))
    check(byDay['3'] === X.uid, 'invisibleByDay[3] === X', JSON.stringify(byDay))
    // **닫는 그 자리에서 지워진다.** 발표부터 다음 투표가 열릴 때까지가 투명인간이다
    check(gAfter.invisibleId === X.uid && gAfter.invisibleTeam === X.team, '닫은 직후(DAY 2)부터 X 가 지워진다 — 발표 즉시', `invisibleId=${gAfter.invisibleId === X.uid ? 'X' : String(gAfter.invisibleId)} invisibleTeam=${String(gAfter.invisibleTeam)}`)

    const s3 = await must('pushDay', host, { gameId: GAME })
    const s4 = await must('pushDay', host, { gameId: GAME })
    const g3 = await gameNow()
    check((s3.pushed as { kind: string })?.kind === 'settlement' && (s4.pushed as { kind: string })?.kind === 'dayStart' && g3.day === 3, 'DAY 3 아침을 넘겼다', `day=${g3.day}`)
    check(g3.invisibleId === X.uid && g3.invisibleTeam === X.team, 'DAY 3 의 game.invisibleId === X', `${String(g3.invisibleId)} (${String(g3.invisibleTeam)})`)
    await clock(dayHourMs(START, 3, 10))
    await must('tick', host, { gameId: GAME })

    // X 와 Y 를 같은 방 옆 칸에 세운다 — 마주 서야 거절이 「안 보여서」인 것이 드러난다
    const room = rooms4[1]
    for (const p of [X, Y, P(0)]) await goTo(p, room)
    await sideBySide(X, Y, room)
    const seen = await Promise.all([Y, P(0), P(10)].map(async (p) => {
      const v = (await getDoc(`games/${GAME}/views/${p.uid}`, asPlayer(p.token))).d ?? {}
      const ids = ((v.visiblePawns as { playerId: string }[]) ?? []).map((q) => q.playerId)
      return { who: p, hasX: ids.includes(X.uid) || ((v.visibleIds as string[]) ?? []).includes(X.uid), text: JSON.stringify(v).includes(X.uid) }
    }))
    check(seen.every((s) => !s.hasX), '같은 방 · 같은 팀 · 다른 팀 누구의 visiblePawns/visibleIds 에도 X 가 없다', seen.map((s) => `봇${s.who.i}:${s.hasX ? 'X보임' : '없음'}`).join(' '))
    check(seen.every((s) => !s.text), '화면 문서 어디에도 X 의 아이디가 없다(tileId · at 도)', seen.map((s) => `봇${s.who.i}:${s.text ? '샌다' : '없음'}`).join(' '))
    const mineView = (await getDoc(`games/${GAME}/views/${X.uid}`, asPlayer(X.token))).d ?? {}
    check(((mineView.visiblePawns as { playerId: string }[]) ?? []).some((q) => q.playerId === X.uid), 'X 본인 화면에는 제 말이 있다')

    const dealOut = await call('askDeal', X.token, { gameId: GAME, toPlayerId: Y.uid })
    refused('X askDeal', dealOut)
    check(!dealOut.ok && /보이지 않는/.test(String(dealOut.message)), 'X 의 askDeal 은 「보이지 않는 동안에는 …」로 거절된다', `${dealOut.code} ${dealOut.message}`)
    const dealIn = await call('askDeal', Y.token, { gameId: GAME, toPlayerId: X.uid })
    refused('X에게 askDeal', dealIn)
    check(!dealIn.ok && korean(dealIn.message), 'X 에게 거는 askDeal 도 거절된다', `${dealIn.code} ${dealIn.message}`)
    const slip = await call('giveSlip', X.token, { gameId: GAME, slipId: 'nope', toPlayerId: Y.uid })
    refused('X giveSlip', slip)
    check(!slip.ok && /보이지 않는/.test(String(slip.message)), 'X 의 giveSlip 은 투명인간 문구로 거절된다', `${slip.code} ${slip.message}`)
    const voteIn = await call('castVote', Y.token, { gameId: GAME, targetId: X.uid, kind: 'trust' })
    refused('X에게 castVote', voteIn)
    check(!voteIn.ok && korean(voteIn.message), 'X 를 겨눈 castVote 는 거절된다', `${voteIn.code} ${voteIn.message}`)
    await must('openPhase', host, { gameId: GAME })
    const summon = await call('phaseAct', X.token, { gameId: GAME, kind: 'summon', targetPlayer: Y.uid })
    refused('X summon', summon)
    check(!summon.ok && /보이지 않는/.test(String(summon.message)), 'X 의 phaseAct summon 은 투명인간 문구로 거절된다', `${summon.code} ${summon.message}`)
    const summonAt = await call('phaseAct', Y.token, { gameId: GAME, kind: 'summon', targetPlayer: X.uid })
    refused('X를 summon', summonAt)
    check(!summonAt.ok && korean(summonAt.message), 'X 를 부르는 summon 도 거절된다', `${summonAt.code} ${summonAt.message}`)
    await must('closePhase', host, { gameId: GAME })
    const radioAll = await call('radio', X.token, { gameId: GAME, text: '들리나', channel: 'all' })
    refused('X radio all', radioAll)
    check(!radioAll.ok && korean(radioAll.message), 'X 의 전원 무전은 거절된다', `${radioAll.code} ${radioAll.message}`)
    // 무전도 마주 보고 하는 대화다 — 지워진 동안은 팀 채널도 안 된다(radio.ts)
    const radioTeam = await call('radio', X.token, { gameId: GAME, text: '팀에는', channel: 'team' })
    refused('X radio team', radioTeam)
    check(!radioTeam.ok && korean(radioTeam.message), 'X 의 팀 무전도 거절된다', `${radioTeam.code} ${radioTeam.message}`)
    const walk = await call('roamTo', X.token, { gameId: GAME, tileId: rooms4[2] })
    check(walk.ok, 'X 는 걸어 다닐 수 있다', walk.ok ? String(walk.data?.tileId) : `${walk.code} ${walk.message}`)
  }

  // ════════════════════════════════════════════════════════════════
  head('투표 — 운영자가 안 닫으면 정산이 센다 (DAY 3 → 4)')
  {
    const Z = T1
    await must('hostOpenBallot', host, { gameId: GAME })
    check((await gameNow()).invisibleId == null, '투표가 열리면 X 가 풀린다')
    const voters = people.filter((p) => p.uid !== Z.uid && p.uid !== X.uid).slice(0, 5)
    const outs = await Promise.all(voters.map((p) => call('castBallot', p.token, { gameId: GAME, targetId: Z.uid })))
    check(outs.every((o) => o.ok), `다섯이 봇${Z.i}(Z) 를 적는다`, outs.filter((o) => !o.ok).map((o) => o.message).join(' · ') || '5/5')
    const asX = await call('castBallot', P(0).token, { gameId: GAME, targetId: X.uid })
    refused('어제 지워진 사람 castBallot', asX)
    check(!asX.ok && korean(asX.message), '어제 지워진 X 는 오늘 적을 수 없다', `${asX.code} ${asX.message}`)
    const open3 = (await gameNow()).ballot as { open: boolean; day: number }
    check(open3.open === true && open3.day === 3, '안 닫은 채로 둔다', JSON.stringify(open3))

    const s5 = await must('pushDay', host, { gameId: GAME })
    const g = await gameNow()
    const d3 = await getDoc(`games/${GAME}/secret/ballotDays/items/d3`)
    const byDay = (g.invisibleByDay as Record<string, string | null>) ?? {}
    check((s5.pushed as { kind: string })?.kind === 'settlement' && d3.status === 200 && d3.d?.invisibleId === Z.uid, '정산을 넘기면 그때 센다 — ballotDays/d3 = Z', `${JSON.stringify(s5.pushed)} ${JSON.stringify(d3.d)}`)
    check((g.ballot as { open: boolean }).open === false, '세고 나면 ballot.open 이 거짓이다', JSON.stringify(g.ballot))
    check(byDay['4'] === Z.uid, 'invisibleByDay[4] === Z', JSON.stringify(byDay))
    check(g.invisibleId === Z.uid, '정산이 세면 그 자리에서 Z 가 지워진다', `invisibleId=${g.invisibleId === Z.uid ? 'Z' : g.invisibleId === X.uid ? 'X' : String(g.invisibleId)}`)

    const s6 = await must('pushDay', host, { gameId: GAME })
    const g4 = await gameNow()
    check((s6.pushed as { kind: string })?.kind === 'dayStart' && g4.day === 4 && g4.invisibleId === Z.uid && g4.invisibleId !== X.uid, 'DAY 4 — 지워진 사람이 X 에서 Z 로 바뀌었다', `day=${g4.day} invisibleId=${g4.invisibleId === Z.uid ? 'Z' : String(g4.invisibleId)}`)
    await clock(dayHourMs(START, 4, 10))
    // X 가 다시 움직인다
    await goTo(X, rooms4[1])
    await sideBySide(X, Y, rooms4[1])
    const back = await call('askDeal', X.token, { gameId: GAME, toPlayerId: Y.uid })
    check(back.ok, '다음 날 X 의 askDeal 이 다시 된다', back.ok ? String(back.data?.id) : `${back.code} ${back.message}`)
    if (back.ok) await must('cancelDeal', X.token, { gameId: GAME, dealId: String(back.data?.id) })
    const radioBack = await call('radio', X.token, { gameId: GAME, text: '돌아왔다', channel: 'all' })
    check(radioBack.ok, 'X 의 전원 무전도 다시 된다', radioBack.ok ? '' : `${radioBack.code} ${radioBack.message}`)
    const seenNow = (await getDoc(`games/${GAME}/views/${Y.uid}`, asPlayer(Y.token))).d ?? {}
    check(((seenNow.visiblePawns as { playerId: string }[]) ?? []).some((q) => q.playerId === X.uid), '같은 팀 화면에 X 가 다시 보인다')
    const lastDay = await call('hostOpenBallot', host, { gameId: GAME })
    refused('마지막 날 hostOpenBallot', lastDay)
    check(!lastDay.ok && korean(lastDay.message), '마지막 날에는 투표를 못 연다', `${lastDay.code} ${lastDay.message}`)
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n── 거절 문구 ──')
  const bad = refusals.filter((r) => r.message && (!korean(r.message) || leaky(r.message)))
  for (const r of refusals) console.log(`  ${r.where.padEnd(24)} ${r.code.padEnd(20)} ${r.message}`)
  check(bad.length === 0, '거절 문구는 전부 한국어고 내부가 새지 않는다', bad.map((r) => `${r.where}: ${r.message}`).join(' · ') || `${refusals.length}건`)

  console.log('\n── 시간표 (느린 검사부터) ──')
  const slow = [...timeline].sort((a, b) => b.ms - a.ms).slice(0, 10)
  for (const t of slow) console.log(`  ${String(t.ms).padStart(6)}ms  [${t.section}] ${t.label}`)
  const perSection = new Map<string, number>()
  for (const t of timeline) perSection.set(t.section, (perSection.get(t.section) ?? 0) + t.ms)
  console.log('  구간별:')
  for (const [s, ms] of perSection) console.log(`  ${String(ms).padStart(6)}ms  ${s}`)
  console.log(`  전체 ${Date.now() - t0}ms · 검사 ${timeline.length}건`)

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
