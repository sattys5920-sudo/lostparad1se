// QA — 봇 열넷이 실제 API 로 나흘을 돈다. 운영자도 봇이다.
//
//   npx vite-node scripts/qa-bots.ts                     배속 60, 나흘, 기본 성향
//   SPEED=240 DAYS=1 npx vite-node scripts/qa-bots.ts    빠르게 하루
//   ABSENT=2 …                                           운영자가 정산을 2시간 늦게 넘긴다
//   PAUSE=2:12:2 …                                       DAY 2 12:00 부터 2시간 아무도 안 두드린다(밀린 처리)
//   MANUAL_CLOSE=0 …                                     페이즈를 운영자가 안 닫는다(전부 자동 종료)
//   TAG=r1 OUT=/tmp/claude-0/qa …                        판 이름 · 기록 폴더
//
// 성향(열넷에 골고루): hard 열심히 · normal 보통 · daily 하루 한 번 접속 · quitter 중간 이탈.
// 봇은 자기 view 문서(본인만 읽는다)와 판 문서만 보고 움직인다 — 화면이 보는 것과 같다.
//
// 기록(OUT/{TAG}/): events.jsonl(모든 호출과 오류) · summary.json(끝난 뒤 집계) ·
// mem.jsonl(에뮬레이터 메모리) · invariants.jsonl(페이즈 종료마다 불변 조건)
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'

import { gameNow, dayHourMs, type DevClock } from '../shared/rules/clock'
import { timedEvents } from '../shared/rules/lobby'
import { STARTING_TEAM_SIZES, TOTAL_DAYS, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { ROAM_TO, START_TILE, TILE_IDS, type TileId } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { BOARDS } from '../shared/rules/errand'
import { VENDINGS } from '../shared/rules/shop'
import { CROPS } from '../shared/rules/crop'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

const SPEED = Number(process.env.SPEED ?? 60)
const DAYS = Number(process.env.DAYS ?? TOTAL_DAYS)
const TAG = process.env.TAG ?? `r${Date.now().toString(36).slice(-4)}`
const OUT = `${process.env.OUT ?? '/tmp/claude-0/qa'}/${TAG}`
const ABSENT_H = Number(process.env.ABSENT ?? 0)
const MANUAL_CLOSE = (process.env.MANUAL_CLOSE ?? '1') !== '0'
const PAUSE = process.env.PAUSE ? process.env.PAUSE.split(':').map(Number) : null
const GAME = `qa${TAG}`
/** 게임 시작 — 3월 2일 08:00 서울 */
const START = new Date('2026-03-02T08:00:00+09:00').getTime()
/** 하루에 여는 페이즈(시각). 각각 한 시간 */
const PHASE_HOURS = [9, 11, 14, 16]
const BALLOT_OPEN_H = 18
const BALLOT_CLOSE_H = 20

mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
let clock: DevClock = { anchorRealMs: 0, anchorGameMs: 0, speed: 1 }
const gnow = () => gameNow(clock)
const seoul = (ms: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
const hourOf = (ms: number) => Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date(ms)).replace(/\D/g, '')) % 24

function log(kind: string, data: Record<string, unknown>): void {
  appendFileSync(`${OUT}/events.jsonl`, JSON.stringify({ real: Date.now() - t0, game: gnow(), at: seoul(gnow()), kind, ...data }) + '\n')
}
const errors: { at: string; who: string; call: string; msg: string }[] = []
const expectedRefusal = (msg: string) => /없다|못 |안 된다|없어|모자라|이미|아직|걷는 중|서야|닫혀|닫힌|잠겨|열리지|받을 수|끝났|지금은|지워진|수 없다|한도|차 있다|찼다|한 번에|누가 |거기|바꿀 수|겹|다른 방|같은 방|먼저|마감|오늘 표는/.test(msg)

// ── 에뮬레이터 ────────────────────────────────────────────────────
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
async function call(who: string, n: string, tk: string, d: unknown): Promise<Res> {
  const started = Date.now()
  try {
    const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }), signal: AbortSignal.timeout(60_000) })
    const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
    const ms = Date.now() - started
    if (j.error) {
      const unexpected = !expectedRefusal(j.error.message) || j.error.status === 'INTERNAL' || j.error.status === 'UNKNOWN'
      log('refuse', { who, call: n, code: j.error.status, msg: j.error.message, ms, unexpected })
      if (unexpected) errors.push({ at: seoul(gnow()), who, call: n, msg: `${j.error.status} ${j.error.message}` })
      return { ok: false, code: j.error.status, message: j.error.message }
    }
    log('call', { who, call: n, ms })
    if (ms > 8000) errors.push({ at: seoul(gnow()), who, call: n, msg: `느림 ${ms}ms` })
    return { ok: true, data: j.result ?? {} }
  } catch (e) {
    log('net', { who, call: n, msg: (e as Error).message })
    errors.push({ at: seoul(gnow()), who, call: n, msg: `망 ${(e as Error).message}` })
    return { ok: false, code: 'NET', message: (e as Error).message }
  }
}
async function must(who: string, n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(who, n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}
async function doc(path: string, tk?: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}
async function col(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let token: string | undefined
  do {
    const r = await fetch(`${FS}/${path}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: ADMIN })
    if (!r.ok) return out
    const j = (await r.json()) as { documents?: { name: string; fields?: unknown }[]; nextPageToken?: string }
    for (const d of j.documents ?? []) out.push({ _id: d.name.split('/').pop(), ...(plain({ fields: d.fields ?? {} }) as Record<string, unknown>) })
    token = j.nextPageToken
  } while (token)
  return out
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]
const cellKey = (c: { x: number; y: number }) => `${c.x},${c.y}`
const beside = (c: { x: number; y: number }) => [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]

// ── 봇 ────────────────────────────────────────────────────────────
type Persona = 'hard' | 'normal' | 'daily' | 'quitter'
const PERSONAS: Persona[] = ['hard', 'hard', 'hard', 'hard', 'normal', 'normal', 'normal', 'normal', 'normal', 'daily', 'daily', 'daily', 'quitter', 'quitter']
const TICK_MS: Record<Persona, number> = { hard: 2000, normal: 5000, daily: 3000, quitter: 4000 }

interface Bot {
  i: number
  name: string
  uid: string
  token: string
  team: TeamId
  persona: Persona
  votedDay: number
  ballotDay: number
  errand: null | { id: string; from: TileId; to: TileId; cell: { x: number; y: number } | null; carrying: boolean }
  online: boolean
}
interface View {
  visiblePawns?: { playerId: string; tileId: string | null; at: { x: number; y: number } | null; name?: string }[]
  slipPapers?: { id: string; x: number; y: number }[]
  quizzesHere?: { id: string; x: number; y: number }[]
  myQuizzes?: { id: string; kind: string; choices: string[] }[]
  mySlips?: { id: string; read: boolean }[]
  potsHere?: { i: number; cell: { x: number; y: number }; canPick: boolean }[]
  errandsHere?: { id: string; from: string; to: string }[]
  myErrand?: { id: string; from: string; to: string; cell: { x: number; y: number } | null; carrying: boolean } | null
  myBallot?: string | null
}
interface Game {
  phase: string
  day: number
  clock?: DevClock
  startedAtMs?: number
  phaseNow?: { no: number; open: boolean; endsAtMs: number | null }
  phaseDone?: number
  invisibleId?: string | null
  invisibleByDay?: Record<string, string | null>
  ballot?: { day: number; open: boolean }
  seats: { playerId: string; name: string; team: TeamId | null }[]
}

let game: Game | null = null
let paused = false

function activeNow(b: Bot, g: Game): boolean {
  if (paused) return false
  const h = hourOf(gnow())
  if (b.persona === 'daily') return h >= 12 && h < 13
  if (b.persona === 'quitter') return !(g.day > 2 || (g.day === 2 && h >= 12))
  return true
}

async function botTick(b: Bot, g: Game): Promise<void> {
  const who = b.name
  const on = activeNow(b, g)
  if (on !== b.online) {
    b.online = on
    log('presence', { who, online: on })
  }
  if (!on) return
  await call(who, 'tick', b.token, { gameId: GAME })
  const v = (await doc(`games/${GAME}/views/${b.uid}`, b.token)) as View | null
  if (!v) return
  const me = v.visiblePawns?.find((p) => p.playerId === b.uid)
  const here = (me?.tileId ?? null) as TileId | null
  const at = me?.at ?? null
  const phaseOpen = g.phaseNow?.open === true && (g.phaseNow.endsAtMs ?? Infinity) > gnow()
  const taken = new Set((v.visiblePawns ?? []).filter((p) => p.playerId !== b.uid && p.at).map((p) => cellKey(p.at as { x: number; y: number })))
  const freeCells = here ? dropCellsIn(here).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(cellKey(c))) : []
  const standNear = async (target: { x: number; y: number }) => {
    const spot = beside(target).find((c) => freeCells.some((f) => f.x === c.x && f.y === c.y)) ?? null
    if (!spot) return false
    const r = await call(who, 'standAt', b.token, { gameId: GAME, x: spot.x, y: spot.y })
    return r.ok && (r.data as { ok?: boolean }).ok !== false
  }

  // 투표 — 열려 있으면 오늘 한 번 (마감 전에 가끔 바꾼다)
  if (g.ballot?.open && g.ballot.day === g.day && (b.ballotDay !== g.day || Math.random() < 0.05)) {
    const others = g.seats.filter((s) => s.playerId !== b.uid && s.playerId !== g.invisibleId)
    if (others.length) {
      const r = await call(who, 'castBallot', b.token, { gameId: GAME, targetId: pick(others).playerId })
      if (r.ok) b.ballotDay = g.day
    }
  }

  if (here === null) return // 걷는 중

  if (phaseOpen) {
    const r = Math.random() * 0.8
    if (r < 0.35) {
      const to = pick(ROAM_TO[here] ?? [])
      if (to) await call(who, 'phaseAct', b.token, { gameId: GAME, kind: 'move', targetTile: to })
    } else if (r < 0.55) {
      await call(who, 'phaseAct', b.token, { gameId: GAME, kind: 'plant' })
    } else if (r < 0.65 && freeCells.length) {
      const c = pick(freeCells)
      await call(who, 'standAt', b.token, { gameId: GAME, x: c.x, y: c.y })
    } else if (r < 0.75) {
      await call(who, 'radio', b.token, { gameId: GAME, text: `${b.name} 페이즈 ${g.phaseNow?.no} 여기 ${here}`, channel: Math.random() < 0.3 ? 'all' : 'team' })
    }
    return
  }

  // ── 자유 시간 ──
  // 심부름 이어 하기
  if (v.myErrand) {
    const e = v.myErrand
    if (!e.carrying) {
      if (here !== e.from) { await call(who, 'roamTo', b.token, { gameId: GAME, tileId: e.from }); return }
      if (e.cell && (await standNear(e.cell))) await call(who, 'pickUpThing', b.token, { gameId: GAME })
      return
    }
    if (here !== e.to) { await call(who, 'roamTo', b.token, { gameId: GAME, tileId: e.to }); return }
    await call(who, 'dropThing', b.token, { gameId: GAME })
    return
  }
  const r = Math.random()
  if (v.errandsHere?.length && r < 0.6) {
    await call(who, 'takeErrand', b.token, { gameId: GAME, errandId: pick(v.errandsHere).id })
    return
  }
  if (v.slipPapers?.length && r < 0.5) {
    const s = pick(v.slipPapers)
    if (await standNear(s)) {
      const t = await call(who, 'takeSlip', b.token, { gameId: GAME, slipId: s.id })
      if (t.ok) await call(who, 'readSlip', b.token, { gameId: GAME, slipId: s.id })
    }
    return
  }
  if (v.mySlips?.length && r < 0.15) {
    const s = pick(v.mySlips)
    if (!s.read) await call(who, 'readSlip', b.token, { gameId: GAME, slipId: s.id })
    // 넘기는 것은 거래로만이다 — 봇은 읽거나 내려놓는다
    else await call(who, 'dropSlip', b.token, { gameId: GAME, slipId: s.id })
    return
  }
  if (v.quizzesHere?.length && r < 0.5) {
    const q = pick(v.quizzesHere)
    if (await standNear(q)) {
      const t = await call(who, 'takeQuiz', b.token, { gameId: GAME, paperId: q.id })
      if (t.ok) {
        const mine = (await doc(`games/${GAME}/views/${b.uid}`, b.token)) as View | null
        const paper = mine?.myQuizzes?.find((x) => x.id === q.id)
        const given = paper?.kind === 'choice' && paper.choices.length ? pick(paper.choices) : pick(['한 달', '두 달', '눈', '모른다'])
        await call(who, 'answerQuiz', b.token, { gameId: GAME, paperId: q.id, given })
      }
    }
    return
  }
  const ripe = (v.potsHere ?? []).filter((p) => p.canPick)
  if (ripe.length && r < 0.6) {
    const p = pick(ripe)
    if (await standNear(p.cell)) await call(who, 'harvestPot', b.token, { gameId: GAME, pot: p.i })
    return
  }
  if (r < 0.2) {
    const to = pick(ROAM_TO[here] ?? [])
    if (to) await call(who, 'roamTo', b.token, { gameId: GAME, tileId: to })
    return
  }
  if (r < 0.4 && freeCells.length) {
    const c = pick(freeCells)
    await call(who, 'standAt', b.token, { gameId: GAME, x: c.x, y: c.y })
    return
  }
  if (r < 0.5) {
    await call(who, 'say', b.token, { gameId: GAME, text: `${b.name}: ${pick(['여기 뭐 있어?', '같이 갈래', '3층으로', 'ㅇㅇ', '누가 깃발 꽂았어'])}` })
    return
  }
  if (r < 0.58) {
    await call(who, 'radio', b.token, { gameId: GAME, text: `${pick(g.seats).name} 어디야`, channel: Math.random() < 0.3 ? 'all' : 'team' })
    return
  }
  if (r < 0.66 && b.votedDay !== g.day) {
    const near = (v.visiblePawns ?? []).filter((p) => p.playerId !== b.uid && p.tileId === here && p.at && at && Math.abs(p.at.x - at.x) + Math.abs(p.at.y - at.y) === 1)
    if (near.length) {
      const t = await call(who, 'castVote', b.token, { gameId: GAME, targetId: pick(near).playerId, kind: pick(['trust', 'liking']) })
      if (t.ok) b.votedDay = g.day
    }
    return
  }
  if (r < 0.72) {
    // 자판기 — 복도 자판기 옆에 서서 산다
    const vend = pick(VENDINGS)
    const spot = beside(vend.cell)[0]
    const s = await call(who, 'standAt', b.token, { gameId: GAME, x: spot.x, y: spot.y })
    if (s.ok && (s.data as { ok?: boolean }).ok !== false) await call(who, 'buyShopItem', b.token, { gameId: GAME, itemId: pick(['whistle', 'flag', 'paper', 'lock']) })
    return
  }
  if (r < 0.78) {
    // 게시판 옆으로 — 심부름을 본다
    const board = pick(BOARDS)
    const spot = beside(board.cell)[0]
    await call(who, 'standAt', b.token, { gameId: GAME, x: spot.x, y: spot.y })
  }
}

// ── 운영자 ────────────────────────────────────────────────────────
interface Admin {
  token: string
  openedToday: Set<string>
  ballotOpenedDay: number
  ballotClosedDay: number
  seededDay: number
  lastPhaseDone: number
  closedByHand: number
  autoClosed: number
  pushes: { kind: string; day: number; due: number; at: number }[]
}

async function seedDay(a: Admin, day: number): Promise<void> {
  const rooms = TILE_IDS.filter((t) => t !== START_TILE)
  for (let i = 0; i < 3; i++) {
    await call('host', 'hostPostErrand', a.token, { gameId: GAME, specId: pick(['beaker', 'broom', 'tray', 'firstAid', 'sheet', 'mic']), boardId: pick(BOARDS).id, to: pick(rooms) })
  }
  const garden = await call('host', 'hostGarden', a.token, { gameId: GAME })
  const pots = ((garden.data as { pots?: { i: number; stage: string }[] } | undefined)?.pots ?? [])
  for (let i = 0; i < 4; i++) if ((pots.find((p) => p.i === i)?.stage ?? 'empty') === 'empty') await call('host', 'hostPlant', a.token, { gameId: GAME, pot: i, cropId: pick(CROPS).id })
  await call('host', 'hostScatterRandom', a.token, { gameId: GAME, n: 6 })
  for (let i = 0; i < 3; i++) {
    const room = pick(rooms)
    const cell = pick(dropCellsIn(room).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y)))
    await call('host', 'hostDrop', a.token, { gameId: GAME, kind: 'quiz', x: cell.x, y: cell.y, quiz: { kind: 'short', prompt: `DAY ${day} 문제 ${i}`, answers: ['두 달'], explain: '' } })
  }
  a.seededDay = day
  log('seed', { who: 'host', day })
}

async function adminTick(a: Admin, g: Game): Promise<void> {
  if (paused) return
  const now = gnow()
  const h = hourOf(now)
  const dayKey = (x: number) => `${g.day}:${x}`
  if (a.seededDay !== g.day) await seedDay(a, g.day)

  // 페이즈 열기 — 그 시각에, 하루 넷
  if (!g.phaseNow?.open && PHASE_HOURS.includes(h) && !a.openedToday.has(dayKey(h)) && g.day <= DAYS) {
    const r = await call('host', 'openPhase', a.token, { gameId: GAME })
    // 망이 끊겨 못 열었으면 다음 바퀴에 다시 연다 — 규칙으로 거절됐으면 그 시각은 접는다
    if (r.ok || r.code !== 'NET') a.openedToday.add(dayKey(h))
    if (r.ok) log('phaseOpen', { who: 'host', no: (r.data as { no: number }).no })
  }
  // 홀수 페이즈는 운영자가 50분에 닫고, 짝수는 한 시간 지나 저절로 닫히는지 본다
  if (g.phaseNow?.open && MANUAL_CLOSE && g.phaseNow.no % 2 === 1 && g.phaseNow.endsAtMs && now >= g.phaseNow.endsAtMs - 10 * 60_000) {
    const r = await call('host', 'closePhase', a.token, { gameId: GAME })
    if (r.ok && !(r.data as { alreadyClosed?: boolean }).alreadyClosed) {
      a.closedByHand += 1
      log('phaseClose', { who: 'host', by: 'hand', no: (r.data as { no: number }).no })
    }
  }
  // 투표 — 18시 열고 20시 닫는다
  if (g.day < TOTAL_DAYS && h >= BALLOT_OPEN_H && h < BALLOT_CLOSE_H && a.ballotOpenedDay !== g.day) {
    a.ballotOpenedDay = g.day
    await call('host', 'hostOpenBallot', a.token, { gameId: GAME })
  }
  if (g.ballot?.open && h >= BALLOT_CLOSE_H && a.ballotClosedDay !== g.day) {
    a.ballotClosedDay = g.day
    await call('host', 'hostCloseBallot', a.token, { gameId: GAME })
  }
  // 달력 — 때가 되면 넘긴다(운영자가 부재면 ABSENT 시간 늦게)
  const next = (await call('host', 'peekDay', a.token, { gameId: GAME })).data?.next as { kind: string; day: number } | null | undefined
  if (next) {
    const due = timedEvents(g.startedAtMs ?? START).find((e) => e.kind === next.kind && e.day === next.day)?.dueAtMs ?? Infinity
    if (now >= due + ABSENT_H * 3_600_000) {
      const r = await call('host', 'pushDay', a.token, { gameId: GAME })
      if (r.ok) {
        a.pushes.push({ kind: next.kind, day: next.day, due, at: now })
        log('pushDay', { who: 'host', kind: next.kind, day: next.day, lateMin: Math.round((now - due) / 60_000) })
      }
    }
  }
}

// ── 불변 조건(간단판) — 페이즈가 닫힐 때마다 ──────────────────────
async function invariants(g: Game, label: string): Promise<void> {
  const pawns = await col(`games/${GAME}/pawns`)
  const teams = await col(`games/${GAME}/teams`)
  const tiles = await col(`games/${GAME}/tiles`)
  const bad: string[] = []
  const seen = new Map<string, string>()
  for (const p of pawns) {
    const at = p.at as { x: number; y: number } | null
    const tile = p.tileId as string | null
    const walking = tile === null && Array.isArray(p.path) && (p.path as unknown[]).length > 0
    if (tile === null && !walking) bad.push(`${p._id}: 방도 없고 걷지도 않는다`)
    if (at) {
      const k = `${at.x},${at.y}`
      if (seen.has(k) && tile !== null) bad.push(`${p._id}: 한 칸에 둘(${seen.get(k)})`)
      seen.set(k, String(p._id))
      if (isBlockedCell(at.x, at.y) || isFixture(at.x, at.y)) bad.push(`${p._id}: 기물 위 ${k}`)
    }
  }
  for (const t of teams) {
    const r = (t.resources ?? {}) as { money?: number; knowledge?: number }
    if ((r.money ?? 0) < 0 || (r.knowledge ?? 0) < 0 || ((t.phaseTokens as number) ?? 0) < 0) bad.push(`${t._id}: 음수 ${JSON.stringify({ ...r, tokens: t.phaseTokens })}`)
  }
  for (const t of tiles) if (t.ownerTeam != null && !['A', 'B', 'C', 'D'].includes(String(t.ownerTeam))) bad.push(`${t._id}: 주인 ${String(t.ownerTeam)}`)
  const server = await call('host', 'hostInvariants', admin.token, { gameId: GAME })
  appendFileSync(`${OUT}/invariants.jsonl`, JSON.stringify({ at: seoul(gnow()), label, day: g.day, bad, server: server.ok ? server.data : server.message }) + '\n')
  if (bad.length) errors.push({ at: seoul(gnow()), who: 'invariant', call: label, msg: bad.join(' | ') })
}

function memSample(): void {
  try {
    const out = execSync("ps -eo rss,args | grep -E 'functions|firestore|emulator' | grep -v grep | awk '{s+=$1} END {print s}'", { encoding: 'utf8' }).trim()
    appendFileSync(`${OUT}/mem.jsonl`, JSON.stringify({ real: Date.now() - t0, at: seoul(gnow()), rssKb: Number(out) }) + '\n')
  } catch { /* 없어도 된다 */ }
}

let admin: Admin
async function main(): Promise<void> {
  writeFileSync(`${OUT}/events.jsonl`, '')
  writeFileSync(`${OUT}/invariants.jsonl`, '')
  writeFileSync(`${OUT}/mem.jsonl`, '')
  console.log(`판 ${GAME} · 배속 ${SPEED} · ${DAYS}일 · 기록 ${OUT}`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  admin = { token: (await auth(he)).token, openedToday: new Set(), ballotOpenedDay: 0, ballotClosedDay: 0, seededDay: 0, lastPhaseDone: 0, closedByHand: 0, autoClosed: 0, pushes: [] }
  await must('host', 'createGame', admin.token, { gameId: GAME, seed: TAG })
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  const bots: Bot[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`b${i}-${GAME}@x.test`))
    const name = `봇${String(i + 1).padStart(2, '0')}`
    await must(name, 'joinGame', a.token, { gameId: GAME, name, team: want[i] })
    bots.push({ i, name, ...a, team: want[i], persona: PERSONAS[i], votedDay: 0, ballotDay: 0, errand: null, online: false })
  }
  await must('host', 'assignAll', admin.token, { gameId: GAME })
  // 시작 전 — 교실 밖으로 못 나가는지 · 행동이 막히는지
  const pre = await call(bots[0].name, 'roamTo', bots[0].token, { gameId: GAME, tileId: pick(ROAM_TO[START_TILE]) })
  const preVote = await call(bots[0].name, 'castVote', bots[0].token, { gameId: GAME, targetId: bots[1].uid, kind: 'trust' })
  log('preStart', { roamRefused: !pre.ok, voteRefused: !preVote.ok, roam: pre.message, vote: preVote.message })
  await must('host', 'startGame', admin.token, { gameId: GAME, startAtMs: START })
  await must('host', 'setDevClock', admin.token, { gameId: GAME, anchorGameMs: START, speed: SPEED })
  game = (await doc(`games/${GAME}`)) as Game
  clock = game.clock as DevClock
  console.log(`시작 ${seoul(START)} → 끝까지 실제 약 ${Math.round((DAYS * 24 * 60) / SPEED)}분`)

  let lastMem = 0
  let pausedUntil = 0
  // 끝 — 판이 끝났거나, 시험 일수를 넘겼거나, 실제 시간이 예상의 세 배를 넘었다(멈춤 감지)
  const realCap = t0 + Math.max(5, (DAYS * 24 * 60) / SPEED) * 3 * 60_000
  const over = () => !game || game.phase === 'finished' || game.day > DAYS || Date.now() > realCap
  const loops = bots.map(async (b) => {
    while (!over()) {
      try { await botTick(b, game) } catch (e) { errors.push({ at: seoul(gnow()), who: b.name, call: 'tick', msg: (e as Error).message }) }
      await sleep(TICK_MS[b.persona] * (0.7 + Math.random() * 0.6))
    }
  })
  const adminLoop = (async () => {
    while (!over()) {
      try {
        game = (await doc(`games/${GAME}`)) as Game
        if (game.clock) clock = game.clock as DevClock
        // 밀린 처리 — 그 시각부터 정해진 시간 동안 아무도 안 두드린다
        if (PAUSE && !paused && pausedUntil === 0 && game.day === PAUSE[0] && hourOf(gnow()) >= PAUSE[1]) {
          paused = true
          pausedUntil = gnow() + PAUSE[2] * 3_600_000
          log('pause', { who: 'qa', until: seoul(pausedUntil) })
        }
        if (paused && gnow() >= pausedUntil) {
          paused = false
          log('resume', { who: 'qa' })
          const before = await col(`games/${GAME}/schedule`)
          await call('host', 'tick', admin.token, { gameId: GAME })
          const after = await col(`games/${GAME}/schedule`)
          const caught = after.filter((s) => s.doneAtMs !== null && before.find((b) => b._id === s._id)?.doneAtMs === null).map((s) => ({ kind: s.kind, day: (s.payload as { day?: number })?.day, pushedAtMs: s.pushedAtMs }))
          log('caughtUp', { who: 'qa', items: caught })
        }
        if ((game.phaseDone ?? 0) > admin.lastPhaseDone) {
          const no = game.phaseDone ?? 0
          admin.lastPhaseDone = no
          const wasHand = admin.closedByHand
          await sleep(500)
          if (admin.closedByHand === wasHand) { admin.autoClosed += 1; log('phaseClose', { who: 'server', by: 'auto', no }) }
          await invariants(game, `페이즈 ${no} 종료`)
        }
        await adminTick(admin, game)
        if (Date.now() - lastMem > 30_000) { lastMem = Date.now(); memSample() }
      } catch (e) { errors.push({ at: seoul(gnow()), who: 'host', call: 'loop', msg: (e as Error).message }) }
      await sleep(2000)
    }
  })()
  await Promise.all([...loops, adminLoop])

  // ── 끝 — 집계 ──
  const g = (await doc(`games/${GAME}`)) as Game
  const phaseLog = await col(`games/${GAME}/secret/phaseLog/items`)
  const missionDays = await col(`games/${GAME}/secret/missionDays/items`)
  const ballotDays = await col(`games/${GAME}/secret/ballotDays/items`)
  const schedule = await col(`games/${GAME}/schedule`)
  const frags = await call('host', 'releasedFragments', bots[0].token, { gameId: GAME })
  const ending = await call('host', 'hostBroadcastEnding', admin.token, { gameId: GAME, mode: 'all' })
  const mission4 = await call('host', 'hostMissionDay', admin.token, { gameId: GAME, day: TOTAL_DAYS })
  const unexpected = errors.filter((e) => !/느림/.test(e.msg))
  const summary = {
    game: GAME, speed: SPEED, days: DAYS, realMin: Math.round((Date.now() - t0) / 60_000), phase: g.phase, day: g.day,
    phases: phaseLog.length, closedByHand: admin.closedByHand, autoClosed: admin.autoClosed,
    missionDaysJudged: missionDays.map((d) => d.day).sort(),
    ballotDays: ballotDays.map((d) => ({ day: d.day, invisibleId: d.invisibleId, reason: d.reason })),
    invisibleByDay: g.invisibleByDay,
    scheduleUndone: schedule.filter((s) => s.doneAtMs === null).map((s) => `${s.kind}:${(s.payload as { day?: number })?.day}`),
    scheduleOrder: schedule.filter((s) => s.doneAtMs !== null).sort((a, b) => Number(a.doneAtMs) - Number(b.doneAtMs)).map((s) => `${s.kind}:${(s.payload as { day?: number })?.day}`),
    pushes: admin.pushes.map((p) => ({ ...p, lateMin: Math.round((p.at - p.due) / 60_000) })),
    fragmentsReleased: frags.ok ? (frags.data as { days?: number[] }).days : frags.message,
    endings: ending.ok ? ending.data : ending.message,
    missionDay4Rows: mission4.ok ? ((mission4.data as { rows?: unknown[] }).rows ?? []).length : mission4.message,
    errors: unexpected.length, slow: errors.length - unexpected.length,
    errorSample: unexpected.slice(0, 40),
  }
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

void main().catch((e) => { console.error(e); process.exit(1) })
