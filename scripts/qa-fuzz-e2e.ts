// QA 8 — 이상한 입력. 진짜 콜러블에 이상한 것을 넣어 보고 서버가 어떻게 답하는지 본다.
//
//   - 거절은 HttpsError 다. 코드가 정해진 것이고, 말은 짧은 한국어 한 문장이다
//   - 말에 스택 · 파일 경로 · 내부 아이디 · 남의 자료가 없다
//   - 거절당한 요청은 판을 바꾸지 않는다(ADMIN REST 로 앞뒤를 비교한다)
//   - 글 칸: 300자 넘게 · 이모지만 · 공백만 · 제어 문자 · <script> · RTL/폭 없는 글자 · NUL
//   - API 오용: 남의 아이디 · 없는 방/칸 · 음수 · 소수 · NaN · 찢긴 쪽지 · 닫힌 페이즈 · 시작 전 ·
//     없는 판 · 앉지 않은 판 · 빠진/남는/틀린 형 · __proto__ 열쇠
//   - 같은 요청 열 번 — 두 번 빠지는 것도, 두 줄 남는 것도 없다
//   - 운영자 콜러블을 참가자가 부르면 전부 PERMISSION_DENIED
//
//   npx vite-node scripts/qa-fuzz-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { readFileSync } from 'node:fs'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { START_TILE, TILE_IDS, canRoamTo, roomOfCell, type TileId } from '../shared/rules/board'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { isFixture, FIXTURE_CELLS } from '../shared/rules/fixtures'
import { dropCellsIn } from '../shared/rules/quiz'
import { SHOP_ITEMS } from '../shared/rules/shop'

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
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string; status: number; raw: string }
/** 콜러블 하나. body 를 통째로 줄 수도 있다(형이 틀린 요청을 보내려고). */
/** 부하가 큰 기계에서 연결이 끊기면 한 번 더 — 서버의 답이 아니라 회선의 일이다 */
async function fetchRetry(url: string, init: RequestInit, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) })
      // 5xx 인데 콜러블 오류 봉투가 아니면 워커가 죽은 것이다(부하) — 한 번 더 두드린다
      if (r.status >= 500 && i < tries - 1) {
        const t = await r.clone().text()
        if (!t.includes('"error"')) { await new Promise((f) => setTimeout(f, 2000)); continue }
      }
      return r
    } catch (e) { if (i >= tries - 1) throw e }
  }
}
async function callRaw(n: string, tk: string | null, body: string): Promise<Res> {
  const r = await fetchRetry(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body })
  const raw = await r.text()
  try {
    const j = JSON.parse(raw) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
    if (j.error) return { ok: false, code: j.error.status, message: j.error.message, status: r.status, raw }
    return { ok: true, data: j.result ?? {}, status: r.status, raw }
  } catch {
    return { ok: false, code: 'NOT_JSON', message: raw.slice(0, 200), status: r.status, raw }
  }
}
const call = (n: string, tk: string, d: unknown): Promise<Res> => callRaw(n, tk, JSON.stringify({ data: d }))
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
/** ADMIN 으로 문서 칸 몇 개를 덮어쓴다(시험 판을 짜는 데만). */
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
      : typeof v === 'boolean' ? { booleanValue: v }
        : v === null ? { nullValue: null }
          : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
            : { stringValue: String(v) }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`patch 실패 ${path}: ${r.status} ${await r.text()}`)
}

// ── 판 ─────────────────────────────────────────────────────────

const GAME = `fz${Date.now()}`
/** 시작 안 한 판. 「시작 전」과 「앉지 않은 판」을 보는 데 쓴다 */
const LOBBY = `fzlb${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

type P = { uid: string; token: string; team: TeamId; name: string }
const people: P[] = []
let host = ''
let hostUid = ''

/** 거절로 치는 코드. INTERNAL · UNKNOWN · NOT_JSON 은 서버가 터진 것이다 */
const REJECT_CODES = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'NOT_FOUND', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'ALREADY_EXISTS'])
/** 짧은 한국어 한 문장인가. 스택 · 경로 · 남의 아이디 · undefined 가 섞이면 아니다 */
function cleanMessage(m: unknown): boolean {
  if (typeof m !== 'string' || m.length === 0 || m.length > 100) return false
  if (!/[가-힣]/.test(m)) return false
  if (/\n|\bat\b|node_modules|functions\/|\.ts\b|\.js\b|Error|undefined|\bnull\b|NaN|\[object|acct_|games\//.test(m)) return false
  if (people.some((p) => m.includes(p.uid)) || (hostUid && m.includes(hostUid))) return false
  return true
}
let observed = 0
/**
 * **보고만.** 고칠 수 없는 파일(phase.ts · index.ts · use.ts · 프레임워크)의 틈이다 —
 * 실패로 세지 않고 △ 로 남긴다. 고쳐지면 ✓ 로 바뀐다.
 */
function observe(ok: boolean, label: string, detail = ''): void {
  if (!ok) observed += 1
  console.log(`${ok ? '  ✓' : '  △'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const isReject = (r: Res): boolean => !r.ok && REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message)
/** 거절이고, 말이 깨끗하다 */
function rejects(r: Res, label: string, code?: string): void {
  const ok = !r.ok && REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message) && (code === undefined || r.code === code)
  check(ok, label, `${r.status} ${r.code} ${String(r.message).slice(0, 80)}`)
}

/** 판의 상태 한 벌. 거절 전후로 같아야 한다 — 시계 · 따라잡기 표시 · views · 무전 맥박은 뺀다 */
const STATE_COLS = ['pawns', 'teams', 'tiles', 'events', 'pots', 'deals', 'transfers', 'arcadeRooms', 'errands', 'notices',
  'secret/votes/items', 'secret/chat/items', 'secret/radio/items', 'secret/slips/items', 'secret/quiz/floor', 'secret/quiz/bank',
  'secret/ballots/items', 'secret/records/items', 'secret/traps/jobs', 'secret/traps/set', 'secret/phase/items', 'secret/cells/items', 'secret/erased/items']
type Snap = Record<string, Record<string, unknown>>
async function snapshot(): Promise<Snap> {
  const out: Snap = {}
  const g = (await getDoc(`games/${GAME}`)) ?? {}
  delete g.clock; delete g.caughtUpToMs; delete g.startedRealMs; delete g.missionJudgedThrough
  out.game = { doc: g }
  await Promise.all(STATE_COLS.map(async (c) => {
    const rows = await getAll(`games/${GAME}/${c}`)
    out[c] = Object.fromEntries(rows.map((r) => { const d = { ...r.d }; delete d.radioAtMs; return [r.id, d] }))
  }))
  return out
}
/** 열쇠 순서에 안 흔들리는 직렬화 — PATCH 가 칸 순서를 바꿔도 같은 문서는 같다 */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
}
function diff(a: Snap, b: Snap): string[] {
  const out: string[] = []
  for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[c] ?? {}, y = b[c] ?? {}
    for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const sx = x[id] === undefined ? undefined : canon(x[id]), sy = y[id] === undefined ? undefined : canon(y[id])
      if (sx === sy) continue
      const dx = (x[id] ?? {}) as Record<string, unknown>, dy = (y[id] ?? {}) as Record<string, unknown>
      const keys = [...new Set([...Object.keys(dx), ...Object.keys(dy)])].filter((k) => canon(dx[k]) !== canon(dy[k]))
      out.push(`${c}/${id}${sx === undefined ? ' 생김' : sy === undefined ? ' 사라짐' : ` 바뀜(${keys.join(',')})`}`)
    }
  }
  return out
}
/** 거절당한 요청 뒤에 판이 그대로인가 */
async function unchanged(before: Snap, label: string): Promise<Snap> {
  const after = await snapshot()
  const d = diff(before, after)
  check(d.length === 0, label, d.slice(0, 4).join(' · '))
  return after
}

const pawnOf = async (uid: string) => (await getDoc(`games/${GAME}/pawns/${uid}`)) as Record<string, unknown>
const teamOf = async (t: TeamId) => (await getDoc(`games/${GAME}/teams/${t}`)) as { resources: { money: number }; phaseTokens: number }

/** 교실의 빈 칸 — 시작 칸도 물건 칸도 아닌 */
function freeCellsInStart(): { x: number; y: number }[] {
  const taken = new Set(START_CELLS.map((c) => `${c.x},${c.y}`))
  return dropCellsIn(START_TILE).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(`${c.x},${c.y}`))
}

/** 서버가 이름에서 벗겨 내는 글자들 — 제어 문자 · 폭 없는 글자 · 방향 제어 · BOM */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g
/**
 * 앉은 뒤 자리가 빠졌으면 다시 앉힌다. 같은 에뮬레이터에서 다른 시험이
 * hostDeleteAccounts 를 부르면 sweepAllLobbies 가 **계정 없는 uid 의 자리를 전부**
 * 비운다 — 이메일로 만든 시험 계정은 계정 문서가 없어서 휩쓸린다.
 */
async function reseat(gameId: string, ps: P[]): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const g = (await getDoc(`games/${gameId}`)) as { seats: { playerId: string }[] }
    const missing = ps.filter((p) => !g.seats.some((s) => s.playerId === p.uid))
    if (missing.length === 0) return
    for (const p of missing) await must('joinGame', p.token, { gameId, name: p.name, team: p.team })
  }
}
const LONG = '가'.repeat(301)
const TEXTS: [string, string][] = [
  ['300자 넘게', LONG],
  ['이모지만', '😀🙃😱'],
  ['공백만', '   \t  '],
  ['제어 문자', '\u0001\u0002\u0007안녕'],
  ['NUL 바이트', 'a\u0000b'],
  ['<script>', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
  ['RTL · 폭 없는 글자', '‮뒤집힌​‍글⁦자﻿'],
  ['폭 없는 글자만', '​​‍﻿'],
]

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const h = await auth(he); host = h.token; hostUid = h.uid
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'fuzz' })
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${i}` })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await reseat(GAME, people)
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  // 시작 안 한 판 하나 — 사람 하나만 앉힌다
  await must('createGame', host, { gameId: LOBBY, seed: 'lobby' })
  const lobbyGuy = await auth(await signUp(`lb-${GAME}@x.test`))
  await must('joinGame', lobbyGuy.token, { gameId: LOBBY, name: '로비', team: 'A' })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const [me, mate] = A
  const you = B[0]
  check(people.length === 14, '열넷이 앉아 판이 돌고 있다')

  // ── 글 칸 ──
  console.log('\n── 글 칸 — 말(say) · 무전(radio) ──')
  let snap = await snapshot()
  for (const [label, text] of TEXTS) {
    const r = await call('say', me.token, { gameId: GAME, text })
    if (r.ok) {
      // 받아들였으면 **그대로** 저장돼야 한다 — 짤리거나 바뀌면 화면이 보낸 것과 다른 말이 남는다
      const rows = await getAll(`games/${GAME}/secret/chat/items`)
      const stored = rows.find((x) => x.d.text === text.trim())
      check(stored !== undefined && (text.trim().length <= 60), `say ${label}: 받아들였고 그대로 저장됐다`, `${text.trim().length}자`)
      snap = await snapshot()
    } else {
      rejects(r, `say ${label}: 거절`)
      snap = await unchanged(snap, `say ${label}: 판이 그대로다`)
    }
    const r2 = await call('radio', me.token, { gameId: GAME, text })
    if (r2.ok) {
      const rows = await getAll(`games/${GAME}/secret/radio/items`)
      check(rows.some((x) => x.d.text === text.trim()) && text.trim().length <= 300, `radio ${label}: 받아들였고 그대로 저장됐다`)
      snap = await snapshot()
    } else {
      rejects(r2, `radio ${label}: 거절`)
      snap = await unchanged(snap, `radio ${label}: 판이 그대로다`)
    }
  }
  // 같은 방 사람이 받는 줄에 원문이 그대로 오는가 — 화면은 React 텍스트 노드로만 그린다(dangerouslySetInnerHTML 없음)
  const heard = await must('chatLines', mate.token, { gameId: GAME })
  const lines = (heard.lines as { text: string }[]).map((l) => l.text)
  check(lines.includes('<script>alert(1)</script><img src=x onerror=alert(1)>'), '같은 방 사람에게 <script> 원문이 글자로 온다(실행되지 않는다 — 텍스트 노드)')
  // sinceMs 가 이상해도 목록이 터지지 않는다
  for (const since of ['abc', NaN, Infinity, -1, 1e300, {}, [], null]) {
    const r = await call('chatLines', mate.token, { gameId: GAME, sinceMs: since })
    const r2 = await call('radioLines', mate.token, { gameId: GAME, sinceMs: since, channel: 'team' })
    check(r.ok || (REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message)), `chatLines sinceMs=${JSON.stringify(since) ?? String(since)} 가 터지지 않는다`, `${r.code ?? 'ok'} ${r.message ?? ''}`)
    check(r2.ok || (REJECT_CODES.has(r2.code ?? '') && cleanMessage(r2.message)), `radioLines sinceMs=${JSON.stringify(since) ?? String(since)} 가 터지지 않는다`, `${r2.code ?? 'ok'} ${r2.message ?? ''}`)
  }
  for (const ch of ['ALL', 'TEAM', 42, {}, '__proto__']) {
    const r = await call('radioLines', mate.token, { gameId: GAME, channel: ch })
    check(r.ok && r.data?.channel === 'team', `radioLines channel=${JSON.stringify(ch)} 은 팀 채널로 읽힌다`, `${r.code ?? ''} ${String(r.data?.channel)}`)
  }

  console.log('\n── 글 칸 — 이름(joinGame) ──')
  const NAMES: [string, string, 'accept' | 'reject' | 'either'][] = [
    ['13자', '가'.repeat(13), 'reject'],
    ['공백만', '     ', 'reject'],
    ['이모지만', '😀😀', 'accept'],
    ['<script>', '<script>', 'accept'],
    ['NUL', 'a\u0000b', 'either'],
    ['폭 없는 글자만', '​​﻿', 'reject'],
    ['RTL 제어만', '‮‭', 'reject'],
    ['제어 문자만', '\u0001\u0002', 'reject'],
  ]
  for (const [label, name, want] of NAMES) {
    const r = await call('joinGame', lobbyGuy.token, { gameId: LOBBY, name })
    const seat = ((await getDoc(`games/${LOBBY}`)) as { seats: { name: string }[] }).seats[0]
    if (want === 'reject') {
      rejects(r, `joinGame 이름 ${label}: 거절`)
      check(seat.name === '로비', `joinGame 이름 ${label}: 자리 이름이 안 바뀌었다`, JSON.stringify(seat.name))
    } else if (want === 'accept') {
      check(r.ok && seat.name === name, `joinGame 이름 ${label}: 받아들였고 그대로 적혔다`, `${r.code ?? ''} ${JSON.stringify(seat.name)}`)
    } else {
      check(r.ok ? seat.name === name.replace(INVISIBLE, '').trim() : isReject(r), `joinGame 이름 ${label}: 거절이거나 보이지 않는 글자만 벗겨 적힌다`, `${r.code ?? 'ok'} ${JSON.stringify(seat.name)}`)
    }
    if (r.ok) await must('joinGame', lobbyGuy.token, { gameId: LOBBY, name: '로비' })
  }
  for (const name of [123, null, {}, ['가'], true]) {
    const r = await call('joinGame', lobbyGuy.token, { gameId: LOBBY, name })
    check(!r.ok ? REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message) : false, `joinGame 이름이 ${JSON.stringify(name)} (문자열 아님): 거절`, `${r.status} ${r.code} ${r.message}`)
  }

  console.log('\n── 글 칸 — 계정(signUpAccount · saveCharacter) ──')
  const acct = `fz${Date.now().toString(36)}`
  const su = await call('signUpAccount', '', { id: acct, password: 'password' })
  check(su.ok && typeof su.data?.token === 'string', '계정을 만들면 증표가 온다', su.code)
  let acctToken: string | null = null
  if (su.ok) {
    const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: su.data?.token, returnSecureToken: true }) })
    const j = (await r.json()) as { idToken?: string }
    acctToken = j.idToken ?? null
    check(acctToken !== null, '증표로 로그인이 된다', JSON.stringify(j).slice(0, 80))
  }
  const ctor = await call('signUpAccount', '', { id: 'constructor', password: 'password' })
  check(ctor.ok || ctor.code === 'ALREADY_EXISTS' || isReject(ctor), 'signUpAccount id=constructor: 터지지 않는다(uid 는 해시라 열쇠로 안 쓰인다)', `${ctor.code ?? 'ok'}`)
  for (const id of ['__proto__', 'a/b/c', '..', 'A B', 'x'.repeat(17), '']) {
    const r = await call('signUpAccount', '', { id, password: 'password' })
    rejects(r, `signUpAccount id=${JSON.stringify(id)}: 거절`)
  }
  rejects(await call('signUpAccount', '', { id: `fz${Date.now().toString(36)}x`, password: '12345' }), 'signUpAccount 짧은 비밀번호: 거절')
  rejects(await call('signUpAccount', '', { id: `fz${Date.now().toString(36)}y`, password: 12345678 }), 'signUpAccount 비밀번호가 숫자형: 거절')
  rejects(await call('logInAccount', '', { id: acct, password: 'wrong-password' }), 'logInAccount 틀린 비밀번호: 거절', 'PERMISSION_DENIED')
  rejects(await call('logInAccount', '', {}), 'logInAccount 빈 요청: 거절', 'PERMISSION_DENIED')
  if (acctToken) {
    for (const [label, nickname, want] of NAMES) {
      const r = await call('saveCharacter', acctToken, { nickname, avatar: null })
      const doc = (await getDoc(`schoolSessions/live/accounts/${acct}`)) as { nickname: string }
      if (want === 'reject') {
        rejects(r, `saveCharacter 이름 ${label}: 거절`)
        check(doc.nickname !== nickname, `saveCharacter 이름 ${label}: 안 적혔다`, JSON.stringify(doc.nickname))
      } else if (want === 'accept') check(r.ok && doc.nickname === nickname, `saveCharacter 이름 ${label}: 그대로 적혔다`, `${r.code ?? ''}`)
      else check(r.ok ? doc.nickname === nickname.replace(INVISIBLE, '').trim() : isReject(r), `saveCharacter 이름 ${label}: 거절이거나 보이지 않는 글자만 벗겨 적힌다`, `${r.code ?? 'ok'} ${JSON.stringify(doc.nickname)}`)
    }
    // 모습(avatar)은 서버가 모양을 안 본다 — 그래도 터지지 않아야 하고 남의 계정에 안 적혀야 한다
    const big = await call('saveCharacter', acctToken, { nickname: '봇', avatar: { __proto__: { admin: true }, constructor: 1, deep: { a: { b: { c: 'x'.repeat(5000) } } } } })
    check(big.ok || (REJECT_CODES.has(big.code ?? '') && cleanMessage(big.message)), 'saveCharacter 이상한 avatar 가 터지지 않는다', `${big.code ?? 'ok'} ${big.message ?? ''}`)
  }
  rejects(await call('saveCharacter', me.token, { nickname: '봇', avatar: null }), '계정 없는 증표로 saveCharacter: 거절', 'UNAUTHENTICATED')

  console.log('\n── 글 칸 — 공지(hostNotice) · 빈 종이(useItem paper) · 답(answerQuiz) ──')
  for (const [label, text] of TEXTS) {
    const r = await call('hostNotice', host, { gameId: GAME, text })
    if (r.ok) check(text.trim().length > 0 && text.trim().length <= 300, `hostNotice ${label}: 받아들였다(길이 안)`)
    else rejects(r, `hostNotice ${label}: 거절`)
  }
  rejects(await call('hostNotice', me.token, { gameId: GAME, text: '안녕' }), '참가자의 hostNotice: 거절', 'PERMISSION_DENIED')
  // 빈 종이 셋을 준다 — 손으로 적는 유일한 글 칸이다
  await patch(`games/${GAME}/pawns/${me.uid}`, { items: { paper: 3 } })
  snap = await snapshot()
  for (const [label, text] of TEXTS) {
    const r = await call('useItem', me.token, { gameId: GAME, kind: 'paper', text })
    if (r.ok) {
      const rows = await getAll(`games/${GAME}/secret/slips/items`)
      const expect = text.trim().slice(0, 300)
      const stored = rows.find((x) => x.d.writtenBy === me.uid && x.d.text === expect)
      check(stored !== undefined, `useItem paper ${label}: 받아들였고 그대로(300자까지) 저장됐다`, JSON.stringify(expect.slice(0, 30)))
      await patch(`games/${GAME}/pawns/${me.uid}`, { items: { paper: 3 } })
      snap = await snapshot()
    } else {
      rejects(r, `useItem paper ${label}: 거절`)
      snap = await unchanged(snap, `useItem paper ${label}: 판이 그대로다`)
    }
  }
  // 물건 종류에 원형 열쇠 — 주머니에 물건이 있을 때 ITEM_BY_KIND['constructor'] 가 함수로 잡힌다
  const proto = await call('useItem', me.token, { gameId: GAME, kind: 'constructor' })
  const bagAfter = ((await pawnOf(me.uid)).items ?? {}) as Record<string, unknown>
  observe(isReject(proto), '[use.ts] useItem kind=constructor: 거절', `${proto.code ?? 'ok'} ${proto.message ?? JSON.stringify(proto.data)}`)
  observe(Object.keys(bagAfter).every((k) => k === 'paper'), '[use.ts] useItem kind=constructor: 주머니가 더러워지지 않았다', JSON.stringify(bagAfter))
  for (const kind of ['toString', '__proto__', 'hasOwnProperty']) {
    observe(isReject(await call('useItem', me.token, { gameId: GAME, kind })), `[use.ts] useItem kind=${JSON.stringify(kind)}: 거절`)
  }
  for (const kind of [42, null, {}, 'nope']) rejects(await call('useItem', me.token, { gameId: GAME, kind }), `useItem kind=${JSON.stringify(kind)}: 거절`)
  await patch(`games/${GAME}/pawns/${me.uid}`, { items: {} })

  // ── API 오용 ──
  console.log('\n── API 오용 — 표 · 쪽지 · 거래 · 화분 · 자판기 ──')
  snap = await snapshot()
  rejects(await call('castVote', me.token, { gameId: GAME, targetId: me.uid, kind: 'trust' }), 'castVote 나에게')
  rejects(await call('castVote', me.token, { gameId: GAME, targetId: 'nobody', kind: 'trust' }), 'castVote 없는 사람', 'NOT_FOUND')
  rejects(await call('castVote', me.token, { gameId: GAME, targetId: you.uid, kind: '좋아요' }), 'castVote 없는 표', 'INVALID_ARGUMENT')
  rejects(await call('castVote', me.token, { gameId: GAME, targetId: you.uid }), 'castVote kind 빠짐', 'INVALID_ARGUMENT')
  for (const t of [undefined, 42, null, {}, [], '', 'a/b']) rejects(await call('castVote', me.token, { gameId: GAME, targetId: t, kind: 'trust' }), `castVote targetId=${JSON.stringify(t) ?? 'undefined'}`)
  // 지워진 사람에게는 못 준다
  await patch(`games/${GAME}`, { invisibleId: you.uid })
  rejects(await call('castVote', me.token, { gameId: GAME, targetId: you.uid, kind: 'trust' }), 'castVote 지워진 사람에게', 'FAILED_PRECONDITION')
  await patch(`games/${GAME}`, { invisibleId: null })
  snap = await unchanged(snap, '표 오용 뒤 판이 그대로다')

  rejects(await call('castBallot', me.token, { gameId: GAME, targetId: me.uid }), 'castBallot 나를')
  rejects(await call('castBallot', me.token, { gameId: GAME, targetId: 'nobody' }), 'castBallot 없는 사람', 'INVALID_ARGUMENT')
  for (const t of [undefined, 42, null, {}, '']) rejects(await call('castBallot', me.token, { gameId: GAME, targetId: t }), `castBallot targetId=${JSON.stringify(t) ?? 'undefined'}`)
  rejects(await call('castBallot', host, { gameId: GAME, targetId: me.uid }), '앉지 않은 사람(운영자)의 castBallot', 'PERMISSION_DENIED')
  snap = await unchanged(snap, '투명인간 투표 오용 뒤 판이 그대로다')

  // 쪽지 — 운영자 메모 한 장을 교실 바닥에 놓고 me 가 줍는다
  const memo = await must('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: START_TILE, text: '시험용 메모' })
  void memo
  const slipId = (await getAll(`games/${GAME}/secret/slips/items`)).find((s) => s.d.text === '시험용 메모')?.id as string
  check(typeof slipId === 'string', '메모 한 장이 바닥에 놓였다')
  snap = await snapshot()
  rejects(await call('readSlip', you.token, { gameId: GAME, slipId }), '안 든 쪽지 readSlip', 'PERMISSION_DENIED')
  rejects(await call('dropSlip', you.token, { gameId: GAME, slipId }), '안 든 쪽지 dropSlip', 'PERMISSION_DENIED')
  for (const id of ['nope', '', undefined, 42, null, {}, 'a/b', '__proto__']) {
    for (const fn of ['takeSlip', 'readSlip', 'dropSlip', 'tearSlipHere']) rejects(await call(fn, me.token, { gameId: GAME, slipId: id }), `${fn} slipId=${JSON.stringify(id) ?? 'undefined'}`)
  }
  snap = await unchanged(snap, '쪽지 오용 뒤 판이 그대로다')
  // 줍고 찢는다 — 찢긴 것은 누구도 못 줍고 못 읽는다
  await must('takeSlip', me.token, { gameId: GAME, slipId })
  await must('dropSlip', me.token, { gameId: GAME, slipId })
  await must('tearSlipHere', me.token, { gameId: GAME, slipId })
  snap = await snapshot()
  rejects(await call('takeSlip', you.token, { gameId: GAME, slipId }), '찢긴 쪽지 takeSlip')
  rejects(await call('readSlip', me.token, { gameId: GAME, slipId }), '찢긴 쪽지 readSlip(찢은 사람)')
  rejects(await call('tearSlipHere', me.token, { gameId: GAME, slipId }), '찢긴 쪽지 tearSlipHere 두 번')
  rejects(await call('dropSlip', me.token, { gameId: GAME, slipId }), '찢긴 쪽지 dropSlip')
  snap = await unchanged(snap, '찢긴 쪽지 오용 뒤 판이 그대로다')

  // 거래 — 옆 칸에 세우고 연다
  const free = freeCellsInStart()
  const pairCell = (() => {
    for (const c of free) { const n = free.find((d) => d.x === c.x + 1 && d.y === c.y); if (n) return [c, n] }
    throw new Error('교실에 나란한 빈 칸이 없다')
  })()
  await must('standAt', me.token, { gameId: GAME, x: pairCell[0].x, y: pairCell[0].y })
  await must('standAt', you.token, { gameId: GAME, x: pairCell[1].x, y: pairCell[1].y })
  rejects(await call('askDeal', me.token, { gameId: GAME, toPlayerId: me.uid }), 'askDeal 나에게', 'INVALID_ARGUMENT')
  rejects(await call('askDeal', me.token, { gameId: GAME, toPlayerId: 'nobody' }), 'askDeal 없는 사람', 'NOT_FOUND')
  rejects(await call('askDeal', me.token, { gameId: GAME, toPlayerId: mate.uid }), 'askDeal 멀리 있는 사람', 'FAILED_PRECONDITION')
  for (const t of [undefined, 42, null, {}, '', 'a/b']) rejects(await call('askDeal', me.token, { gameId: GAME, toPlayerId: t }), `askDeal toPlayerId=${JSON.stringify(t) ?? 'undefined'}`)
  for (const t of [undefined, 42, null, {}, '', 'a/b']) rejects(await call('askTransfer', me.token, { gameId: GAME, toPlayerId: t }), `askTransfer toPlayerId=${JSON.stringify(t) ?? 'undefined'}`)
  for (const id of [undefined, '', 'a/b', {}, 42]) {
    rejects(await call('answerDeal', me.token, { gameId: GAME, dealId: id, accept: true }), `answerDeal dealId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: {} }), `stakeDeal dealId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('readyDeal', me.token, { gameId: GAME, dealId: id, ready: true }), `readyDeal dealId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('settleDeal', me.token, { gameId: GAME, dealId: id }), `settleDeal dealId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('answerTransfer', me.token, { gameId: GAME, askId: id, accept: true }), `answerTransfer askId=${JSON.stringify(id) ?? 'undefined'}`)
  }
  const asked = await must('askDeal', me.token, { gameId: GAME, toPlayerId: you.uid })
  const dealId = asked.id as string
  rejects(await call('answerDeal', me.token, { gameId: GAME, dealId, accept: true }), '청한 쪽이 answerDeal', 'PERMISSION_DENIED')
  rejects(await call('answerDeal', mate.token, { gameId: GAME, dealId, accept: true }), '남의 거래를 answerDeal', 'PERMISSION_DENIED')
  await must('answerDeal', you.token, { gameId: GAME, dealId, accept: true })
  snap = await snapshot()
  rejects(await call('stakeDeal', mate.token, { gameId: GAME, dealId, stake: {} }), '남의 거래에 stakeDeal', 'PERMISSION_DENIED')
  rejects(await call('stakeDeal', me.token, { gameId: GAME, dealId, stake: { money: 1e12 } }), 'stakeDeal 없는 돈 1e12', 'FAILED_PRECONDITION')
  rejects(await call('stakeDeal', me.token, { gameId: GAME, dealId, stake: { slips: 1 } }), 'stakeDeal 없는 쪽지', 'FAILED_PRECONDITION')
  rejects(await call('stakeDeal', me.token, { gameId: GAME, dealId, stake: { items: { whistle: 1 } } }), 'stakeDeal 없는 물건', 'FAILED_PRECONDITION')
  rejects(await call('readyDeal', me.token, { gameId: GAME, dealId, ready: true }), '빈 탁자에 readyDeal', 'FAILED_PRECONDITION')
  rejects(await call('settleDeal', me.token, { gameId: GAME, dealId }), '안 익은 거래 settleDeal', 'FAILED_PRECONDITION')
  snap = await unchanged(snap, '거래 오용 뒤 판이 그대로다')
  for (const stake of [{ money: -5, knowledge: -1, slips: -3, robots: -9 }, { money: 1.7 }, { money: NaN }, { money: 'abc' }, 'string', 42, null, [], { items: { __proto__: { whistle: 3 }, constructor: 2, toString: 1 } }, { __proto__: { money: 100 } }]) {
    const r = await call('stakeDeal', me.token, { gameId: GAME, dealId, stake })
    const deal = (await getDoc(`games/${GAME}/deals/${dealId}`)) as { a: { stake: { money: number; knowledge: number; slips: number; robots: number; items: Record<string, number> } } }
    const s = deal.a.stake
    const clean = [s.money, s.knowledge, s.slips, s.robots].every((n) => Number.isInteger(n) && n >= 0) && Object.values(s.items ?? {}).every((n) => Number.isInteger(n) && n > 0) && !Object.prototype.hasOwnProperty.call(s.items ?? {}, 'constructor')
    check((r.ok || (REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message))) && clean, `stakeDeal stake=${JSON.stringify(stake) ?? 'string'}: 음수 · 소수 · 원형 열쇠가 안 남는다`, `${r.code ?? 'ok'} ${JSON.stringify(s)}`)
  }
  await must('cancelDeal', me.token, { gameId: GAME, dealId })

  snap = await snapshot()
  for (const pot of [-1, 999, NaN, 1.5, '2', {}, null, undefined, 1e18]) {
    rejects(await call('harvestPot', me.token, { gameId: GAME, pot }), `harvestPot pot=${JSON.stringify(pot) ?? 'undefined'}`)
  }
  for (const crop of [-1, 999, NaN, 'constructor', '__proto__', 'toString', {}, null, undefined]) rejects(await call('sellCrop', me.token, { gameId: GAME, cropId: crop }), `sellCrop cropId=${JSON.stringify(crop) ?? 'undefined'}`)
  for (const item of [-1, 999, NaN, 'constructor', '__proto__', {}, null, undefined, SHOP_ITEMS[0].id]) rejects(await call('buyShopItem', me.token, { gameId: GAME, itemId: item }), `buyShopItem itemId=${JSON.stringify(item) ?? 'undefined'} (기계 앞 아님 · 돈 없음)`)
  for (const maker of [-1, 99, NaN, 'a', {}]) {
    rejects(await call('commissionTrap', me.token, { gameId: GAME, maker }), `commissionTrap maker=${JSON.stringify(maker)}`)
    rejects(await call('takeTrap', me.token, { gameId: GAME, maker }), `takeTrap maker=${JSON.stringify(maker)}`)
  }
  for (const id of ['nope', '', undefined, 'a/b', {}, 42]) {
    rejects(await call('takeErrand', me.token, { gameId: GAME, errandId: id }), `takeErrand errandId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('takeQuiz', me.token, { gameId: GAME, paperId: id }), `takeQuiz paperId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('answerQuiz', me.token, { gameId: GAME, paperId: id, given: '답' }), `answerQuiz paperId=${JSON.stringify(id) ?? 'undefined'}`)
    observe(isReject(await call('takeMade', me.token, { gameId: GAME, madeId: id })), `[made.ts] takeMade madeId=${JSON.stringify(id) ?? 'undefined'}`)
  }
  rejects(await call('answerQuiz', me.token, { gameId: GAME, paperId: 'x', given: 42 }), 'answerQuiz given 이 숫자', 'INVALID_ARGUMENT')
  rejects(await call('pickUpThing', me.token, { gameId: GAME }), '받은 것 없이 pickUpThing', 'FAILED_PRECONDITION')
  rejects(await call('dropThing', me.token, { gameId: GAME }), '받은 것 없이 dropThing', 'FAILED_PRECONDITION')
  rejects(await call('giveUpErrand', me.token, { gameId: GAME }), '받은 것 없이 giveUpErrand', 'FAILED_PRECONDITION')
  rejects(await call('chooseImportant', me.token, { gameId: GAME, targetId: 'nobody' }), 'chooseImportant 없는 사람 (DAY 1)')
  for (const t of [undefined, 42, null, {}, '', 'a/b']) {
    const r = await call('chooseImportant', me.token, { gameId: GAME, targetId: t })
    observe(isReject(r), `[choice.ts] chooseImportant targetId=${JSON.stringify(t) ?? 'undefined'} (DAY 1)`, `${r.status} ${r.code} ${r.message}`)
  }
  for (const c of [undefined, 42, null, 'everything', '__proto__']) rejects(await call('chooseDay4', me.token, { gameId: GAME, choice: c }), `chooseDay4 choice=${JSON.stringify(c) ?? 'undefined'}`)
  for (const d of [99, -1, 0, NaN, '2', 1.5, {}, null, undefined]) rejects(await call('fragmentOfDay', me.token, { gameId: GAME, day: d }), `fragmentOfDay day=${JSON.stringify(d) ?? 'undefined'}`)
  for (const d of [NaN, -1, 0, 'x', 1.5, {}]) rejects(await call('seenMissionDay', me.token, { gameId: GAME, day: d }), `seenMissionDay day=${JSON.stringify(d)}`, 'INVALID_ARGUMENT')
  const mm = await call('markMorning', me.token, { gameId: GAME, read: ['x', 99, -1, 1.5, null], skipped: 'abc' })
  check(mm.ok && JSON.stringify(mm.data?.readDays) === '[]', 'markMorning 이상한 날은 다 걸러진다', JSON.stringify(mm.data))
  rejects(await call('pushSubscribe', me.token, { gameId: GAME, sub: { endpoint: 'http://x', keys: {} } }), 'pushSubscribe 이상한 구독', 'INVALID_ARGUMENT')
  const ns = await call('setNotifySettings', me.token, { gameId: GAME, settings: { __proto__: { all: true }, weird: 1, tag: 'yes' } })
  check(ns.ok || (REJECT_CODES.has(ns.code ?? '') && cleanMessage(ns.message)), 'setNotifySettings 이상한 값이 터지지 않는다', `${ns.code ?? 'ok'} ${JSON.stringify(ns.data ?? ns.message)}`)
  for (const g of ['constructor', '__proto__', 'nope', 42, {}, null, undefined]) rejects(await call('arcadeOpen', me.token, { gameId: GAME, game: g }), `arcadeOpen game=${JSON.stringify(g) ?? 'undefined'}`)
  for (const id of ['nope', '', undefined, 'a/b', {}]) {
    rejects(await call('arcadeTick', me.token, { gameId: GAME, roomId: id }), `arcadeTick roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeLeave', me.token, { gameId: GAME, roomId: id }), `arcadeLeave roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeBegin', me.token, { gameId: GAME, roomId: id }), `arcadeBegin roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeAnswer', me.token, { gameId: GAME, roomId: id, accept: false }), `arcadeAnswer roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeSubmit', me.token, { gameId: GAME, roomId: id, log: [] }), `arcadeSubmit roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadePlay', me.token, { gameId: GAME, roomId: id, move: { __proto__: { round: 1 } } }), `arcadePlay roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeMove', me.token, { gameId: GAME, roomId: id, n: -1 }), `arcadeMove roomId=${JSON.stringify(id) ?? 'undefined'}`)
    rejects(await call('arcadeInvite', me.token, { gameId: GAME, roomId: id, playerId: you.uid }), `arcadeInvite roomId=${JSON.stringify(id) ?? 'undefined'}`)
  }
  rejects(await call('arcadePick', me.token, { gameId: GAME, roomId: 'x', pick: 'lizard' }), 'arcadePick 없는 손', 'INVALID_ARGUMENT')
  rejects(await call('arcadeInvite', me.token, { gameId: GAME, roomId: 'x', playerId: me.uid }), 'arcadeInvite 나를', 'INVALID_ARGUMENT')
  snap = await unchanged(snap, '오용 한 묶음 뒤 판이 그대로다')

  console.log('\n── 서기(standAt) · 방 옮기기(roamTo) ──')
  const meBefore = (await pawnOf(me.uid)).at
  const fixture = [...FIXTURE_CELLS][0].split(',').map(Number)
  const blockedInStart = dropCellsIn(START_TILE).find((c) => isBlockedCell(c.x, c.y))
  const softNo = async (label: string, args: Record<string, unknown>) => {
    const r = await call('standAt', me.token, { gameId: GAME, ...args })
    const at = (await pawnOf(me.uid)).at as { x: number; y: number }
    const refused = !r.ok ? REJECT_CODES.has(r.code ?? '') && cleanMessage(r.message) : r.data?.ok === false && cleanMessage(r.data?.why)
    check(refused && at.x === (meBefore as { x: number }).x && at.y === (meBefore as { y: number }).y, `standAt ${label}: 거절 · 제자리`, `${r.code ?? 'ok'} ${r.message ?? JSON.stringify(r.data)}`)
  }
  await softNo('벽(0,0)', { x: 0, y: 0 })
  await softNo('지도 밖(1e9, -5)', { x: 1e9, y: -5 })
  await softNo('NaN', { x: NaN, y: 'a' })
  await softNo('빠짐', {})
  await softNo('문자열', { x: 'x', y: 'y' })
  await softNo('물건 칸(기물)', { x: fixture[0], y: fixture[1] })
  if (blockedInStart) await softNo('가구 칸', { x: blockedInStart.x, y: blockedInStart.y })
  else check(false, '교실에 가구 칸이 없어 검사 못 함')
  await softNo('남의 방 칸', (() => { const other = TILE_IDS.find((t) => t !== START_TILE) as TileId; const c = dropCellsIn(other)[0]; return { x: c.x, y: c.y } })())
  await softNo('남이 선 칸', { x: pairCell[1].x, y: pairCell[1].y })
  const hugeVia = await call('standAt', me.token, { gameId: GAME, x: pairCell[0].x, y: pairCell[0].y, via: Array.from({ length: 5000 }, () => ({ x: 'a', y: null })) })
  check(hugeVia.ok, 'standAt 제자리 + 쓰레기 via 5000개: 터지지 않는다', `${hugeVia.code ?? ''} ${hugeVia.message ?? ''}`)
  snap = await snapshot()
  rejects(await call('roamTo', me.token, { gameId: GAME, tileId: 'nowhere' }), 'roamTo 없는 방', 'INVALID_ARGUMENT')
  rejects(await call('roamTo', me.token, { gameId: GAME, tileId: START_TILE }), 'roamTo 지금 방', 'FAILED_PRECONDITION')
  for (const t of [undefined, 42, {}, null, '']) rejects(await call('roamTo', me.token, { gameId: GAME, tileId: t, at: { x: 'a' } }), `roamTo tileId=${JSON.stringify(t) ?? 'undefined'}`)
  for (const t of ['constructor', '__proto__', 'toString']) {
    const r = await call('roamTo', me.token, { gameId: GAME, tileId: t, at: { x: 'a' } })
    observe(isReject(r), `[phase.ts] roamTo tileId=${JSON.stringify(t)}`, `${r.status} ${r.code} ${r.message}`)
  }
  const far = TILE_IDS.find((t) => t !== START_TILE && !canRoamTo(START_TILE, t))
  if (far) rejects(await call('roamTo', me.token, { gameId: GAME, tileId: far }), `roamTo 복도가 안 이어진 방(${far})`, 'FAILED_PRECONDITION')
  snap = await unchanged(snap, 'standAt · roamTo 오용 뒤 판이 그대로다')

  console.log('\n── 시작 전 · 앉지 않은 판 · 없는 판 · 형이 틀린 요청 ──')
  const lobbySnap = await getDoc(`games/${LOBBY}`)
  for (const [fn, args] of [
    ['roamTo', { tileId: 'gym' }], ['standAt', { x: 19, y: 23 }], ['castVote', { targetId: 'x', kind: 'trust' }], ['askDeal', { toPlayerId: 'x' }],
    ['phaseAct', { kind: 'move', targetTile: 'gym' }], ['castBallot', { targetId: 'x' }], ['radio', { text: '안녕' }], ['takeSlip', { slipId: 'x' }],
    ['harvestPot', { pot: 0 }], ['buyShopItem', { itemId: SHOP_ITEMS[0].id }], ['useItem', { kind: 'paper', text: '안녕' }],
    ['commissionTrap', { maker: 0 }], ['takeErrand', { errandId: 'x' }], ['arcadeOpen', { game: 'updown' }], ['phaseNow', {}], ['dealNow', {}],
  ] as [string, Record<string, unknown>][]) {
    rejects(await call(fn, lobbyGuy.token, { gameId: LOBBY, ...args }), `시작 전 ${fn}`)
  }
  check(JSON.stringify(await getDoc(`games/${LOBBY}`)) === JSON.stringify(lobbySnap), '시작 전 요청들이 로비 판을 안 바꿨다')
  // 시작 전에도 말은 한다 — 앉은 사람만
  check((await call('say', lobbyGuy.token, { gameId: LOBBY, text: '시작 전 말' })).ok, '시작 전에도 앉은 사람은 say 가 된다')
  rejects(await call('say', me.token, { gameId: LOBBY, text: '남의 판' }), '앉지 않은 판(로비)에 say', 'FAILED_PRECONDITION')
  rejects(await call('chatLines', me.token, { gameId: LOBBY }), '앉지 않은 판(로비)의 chatLines', 'FAILED_PRECONDITION')
  rejects(await call('myPaper', me.token, { gameId: LOBBY }), '앉지 않은 판의 myPaper', 'PERMISSION_DENIED')
  // 돌고 있는 판에 앉지 않은 사람(운영자 uid · 로비 사람)
  for (const tk of [host, lobbyGuy.token]) {
    for (const [fn, args] of [['say', { text: '안녕' }], ['radio', { text: '안녕' }], ['castVote', { targetId: me.uid, kind: 'trust' }], ['castBallot', { targetId: me.uid }],
      ['roamTo', { tileId: 'gym' }], ['standAt', { x: 19, y: 23 }], ['askDeal', { toPlayerId: me.uid }], ['takeSlip', { slipId: 'x' }], ['phaseAct', { kind: 'move', targetTile: 'gym' }],
      ['myPaper', {}], ['radioLines', {}], ['chatLines', {}], ['harvestPot', { pot: 0 }], ['useItem', { kind: 'eraser' }]] as [string, Record<string, unknown>][]) {
      rejects(await call(fn, tk, { gameId: GAME, ...args }), `앉지 않은 사람의 ${fn}`)
    }
  }
  snap = await snapshot()
  const GAME_FNS = ['say', 'castVote', 'phaseNow', 'myPaper', 'clockNow', 'tick', 'chatLines', 'fragmentOfDay', 'releasedFragments', 'finalNoteText']
  for (const gid of ['no-such-game', 'games', undefined, 42, {}, null, 'x'.repeat(2000)]) {
    for (const fn of GAME_FNS) rejects(await call(fn, me.token, { gameId: gid, text: '안녕', targetId: you.uid, kind: 'trust', day: 1 }), `${fn} gameId=${JSON.stringify(gid) ?? 'undefined'}`)
  }
  for (const gid of [[], '', 'a/b', 'a/b/c', '__proto__', '.', '..']) {
    const rs = await Promise.all(GAME_FNS.map((fn) => call(fn, me.token, { gameId: gid, text: '안녕', targetId: you.uid, kind: 'trust', day: 1 })))
    observe(rs.every(isReject), `[index.ts] gameId=${JSON.stringify(gid)} — 열 콜러블이 「그런 판이 없다」로 답한다`, rs.filter((r) => !isReject(r)).map((r) => `${r.status} ${r.code}`).join(' ') || '')
  }
  const BODY_FNS = ['say', 'castVote', 'standAt', 'phaseAct', 'myPaper']
  for (const body of ['{"data":"string"}', '{"data":[1,2]}', '{"data":42}', '{"data":{"gameId":{"__proto__":{"x":1}}}}']) {
    for (const fn of BODY_FNS) rejects(await callRaw(fn, me.token, body), `${fn} body=${body}`)
  }
  // 원형 열쇠가 섞인 정상 요청 — 그냥 정상 요청이다(say 는 통하고, 나머지는 빠진 칸 때문에 거절)
  const protoBody = `{"data":{"gameId":"${GAME}","__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"text":"안녕","extra":{"a":[1,2,3]}}}`
  for (const fn of BODY_FNS) {
    const r = await callRaw(fn, me.token, protoBody)
    check(r.ok ? fn === 'say' || fn === 'myPaper' : isReject(r), `${fn} __proto__ · constructor 열쇠가 섞인 요청: 터지지 않는다`, `${r.status} ${r.code ?? 'ok'} ${String(r.message ?? '').slice(0, 60)}`)
  }
  const gameDoc = (await getDoc(`games/${GAME}`)) as Record<string, unknown>
  check(!Object.prototype.hasOwnProperty.call(gameDoc, 'admin') && !Object.prototype.hasOwnProperty.call(gameDoc, '__proto__') && !Object.prototype.hasOwnProperty.call(gameDoc, 'extra'), '__proto__ · 남는 칸이 판 문서에 안 남았다')
  snap = await snapshot()
  // 아래는 프레임워크(firebase-functions · body-parser)와 index.ts 몫 — 보고만
  const nullRs = await Promise.all(BODY_FNS.map((fn) => callRaw(fn, me.token, '{"data":null}')))
  observe(nullRs.every(isReject), '[모든 콜러블] body={"data":null} — 한국어로 거절한다(req.data 가 null 이면 구조 분해가 터진다)', nullRs.map((r) => `${r.status} ${r.code}`).join(' '))
  const emptyRs = await Promise.all(BODY_FNS.map((fn) => callRaw(fn, me.token, '{}')))
  observe(emptyRs.every(isReject), '[프레임워크] body={} — 한국어로 거절한다', emptyRs.map((r) => `${r.status} ${r.code} ${r.message}`)[0])
  const notJson = await callRaw('say', me.token, 'not json')
  observe(notJson.status >= 400 && !/\bat |node_modules|\.js/.test(notJson.raw), '[프레임워크] JSON 이 아닌 본문: 스택 · 경로가 응답에 없다', `${notJson.status} ${notJson.raw.slice(0, 80).replace(/\n/g, ' ')}`)
  const noAuth = await callRaw('say', null, JSON.stringify({ data: { gameId: GAME, text: '안녕' } }))
  rejects(noAuth, '증표 없이 say', 'UNAUTHENTICATED')
  const bogus = await callRaw('say', 'bogus.token.value', JSON.stringify({ data: { gameId: GAME, text: '안녕' } }))
  observe(isReject(bogus), '[프레임워크] 가짜 증표로 say — 한국어로 거절한다', `${bogus.status} ${bogus.code} ${bogus.message}`)
  snap = await unchanged(snap, '없는 판 · 틀린 형 뒤 판이 그대로다')

  // ── 같은 요청 열 번 ──
  console.log('\n── 같은 요청 열 번 ──')
  const chatBefore = (await getAll(`games/${GAME}/secret/chat/items`)).length
  const radioBefore = (await getAll(`games/${GAME}/secret/radio/items`)).length
  const tenSay = await Promise.all(Array.from({ length: 10 }, () => call('say', me.token, { gameId: GAME, text: '같은 말' })))
  const tenRadio = await Promise.all(Array.from({ length: 10 }, () => call('radio', me.token, { gameId: GAME, text: '같은 무전' })))
  check(tenSay.every((r) => r.ok) && (await getAll(`games/${GAME}/secret/chat/items`)).length === chatBefore + 10, 'say ×10(동시): 열 줄 남는다 — 더도 덜도 없이')
  check(tenRadio.every((r) => r.ok) && (await getAll(`games/${GAME}/secret/radio/items`)).length === radioBefore + 10, 'radio ×10(동시): 열 줄 남는다')

  // 표 — 같은 사람에게 열 번 동시에. 하루 한 장이라 **한 장만** 남아야 한다
  const votesBefore = (await getAll(`games/${GAME}/secret/votes/items`)).length
  const voter = A[2]
  const tenVote = await Promise.all(Array.from({ length: 10 }, () => call('castVote', voter.token, { gameId: GAME, targetId: you.uid, kind: 'trust' })))
  const votesAfter = (await getAll(`games/${GAME}/secret/votes/items`)).filter((v) => v.d.voterId === voter.uid)
  const voteOks = tenVote.filter((r) => r.ok).length
  check(voteOks === 1, 'castVote ×10(동시, 같은 사람): 한 번만 성공한다', `${voteOks}번 성공 · ${tenVote.filter((r) => !r.ok).map((r) => r.message)[0] ?? ''}`)
  check(votesAfter.length === 1 && (await getAll(`games/${GAME}/secret/votes/items`)).length === votesBefore + 1, 'castVote ×10: 표 문서가 한 장이다', `${votesAfter.length}장`)
  const tenVoteSeq: Res[] = []
  for (let i = 0; i < 10; i++) tenVoteSeq.push(await call('castVote', voter.token, { gameId: GAME, targetId: you.uid, kind: 'trust' }))
  check(tenVoteSeq.every((r) => !r.ok && r.message === '오늘은 이미 던졌다.'), 'castVote ×10(차례로): 전부 「오늘은 이미 던졌다」', tenVoteSeq[0].message)
  check((await getAll(`games/${GAME}/secret/votes/items`)).filter((v) => v.d.voterId === voter.uid).length === 1, 'castVote 차례로 열 번 뒤에도 한 장')

  // 쪽지 — 메모 한 장을 놓고 둘이 동시에 열 번 줍는다. 한 사람만 갖는다
  await must('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: START_TILE, text: '경주 메모' })
  const race = (await getAll(`games/${GAME}/secret/slips/items`)).find((s) => s.d.text === '경주 메모')?.id as string
  const tenTake = await Promise.all(Array.from({ length: 10 }, (_, i) => call('takeSlip', (i % 2 ? mate : A[3]).token, { gameId: GAME, slipId: race })))
  const raceDoc = (await getDoc(`games/${GAME}/secret/slips/items/${race}`)) as { heldBy: string | null }
  const takeOks = tenTake.filter((r) => r.ok).length
  check(takeOks === 1 && (raceDoc.heldBy === mate.uid || raceDoc.heldBy === A[3].uid), 'takeSlip ×10(둘이 동시에): 한 번만 성공 · 한 사람 손에', `${takeOks}번 · ${tenTake.find((r) => !r.ok)?.message ?? ''}`)
  const takeRecords = (await getAll(`games/${GAME}/secret/records/items`)).filter((r) => r.d.kind === 'slipTake' && r.d.subjectId === race)
  check(takeRecords.length === 1, 'takeSlip ×10: 주운 기록이 한 줄', `${takeRecords.length}줄`)

  // 자판기 — 돈이 없는 채로 열 번. 한 번도 안 팔리고 금고가 그대로다
  await patch(`games/${GAME}/pawns/${A[3].uid}`, { tileId: 'centralPlaza' })
  // 기계 앞에 세운다 — 2층 복도 기계 옆 칸(복도 칸은 어느 방에도 안 속해서 standAt 이 받는다)
  const vend = { x: 32, y: 31 }
  const beside = [{ x: vend.x - 1, y: vend.y }, { x: vend.x + 1, y: vend.y }, { x: vend.x, y: vend.y - 1 }, { x: vend.x, y: vend.y + 1 }]
  let stood = false
  for (const c of beside) { if ((await call('standAt', A[3].token, { gameId: GAME, x: c.x, y: c.y })).ok) { stood = true; break } }
  check(stood, '자판기 앞에 섰다')
  const teamBefore = await teamOf('A')
  const eventsBefore = (await getAll(`games/${GAME}/events`)).length
  const tenBuy = await Promise.all(Array.from({ length: 10 }, () => call('buyShopItem', A[3].token, { gameId: GAME, itemId: SHOP_ITEMS[0].id })))
  const teamAfter = await teamOf('A')
  check(tenBuy.every((r) => !r.ok && r.message === '돈이 모자라다.'), 'buyShopItem ×10(돈 없음): 전부 「돈이 모자라다」', tenBuy.map((r) => r.message)[0])
  check(teamBefore.resources.money === teamAfter.resources.money && (await getAll(`games/${GAME}/events`)).length === eventsBefore, 'buyShopItem ×10: 금고도 기록도 그대로', `${teamBefore.resources.money}→${teamAfter.resources.money}`)
  check(JSON.stringify((await pawnOf(A[3].uid)).items ?? {}) === '{}', 'buyShopItem ×10: 주머니에 물건이 안 생겼다')
  // 돈을 딱 한 개 값만 주고 열 번 — 하나만 팔린다
  const price = (SHOP_ITEMS[0].cost as { money: number }).money
  await patch(`games/${GAME}/teams/A`, { resources: { money: price, knowledge: 0 } })
  const tenBuy2 = await Promise.all(Array.from({ length: 10 }, () => call('buyShopItem', A[3].token, { gameId: GAME, itemId: SHOP_ITEMS[0].id })))
  const bought = tenBuy2.filter((r) => r.ok).length
  const teamAfter2 = await teamOf('A')
  const bag2 = ((await pawnOf(A[3].uid)).items ?? {}) as Record<string, number>
  check(bought === 1 && teamAfter2.resources.money === 0 && (bag2[SHOP_ITEMS[0].id] ?? 0) === 1, 'buyShopItem ×10(한 개 값만): 하나만 팔리고 두 번 빠지지 않는다', `${bought}번 · 돈 ${teamAfter2.resources.money} · 주머니 ${JSON.stringify(bag2)}`)
  await patch(`games/${GAME}/pawns/${A[3].uid}`, { items: {} })

  // ── 운영자 콜러블을 참가자가 ──
  console.log('\n── 운영자 콜러블 — 참가자가 부르면 전부 PERMISSION_DENIED ──')
  const indexSrc = readFileSync(new URL('../functions/src/index.ts', import.meta.url), 'utf8')
  const exported = new Set<string>()
  for (const m of indexSrc.matchAll(/export\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) { const t = n.trim(); if (t) exported.add(t) }
  for (const m of indexSrc.matchAll(/export const (\w+)/g)) exported.add(m[1])
  const hostNamed = [...exported].filter((n) => /^host[A-Z]/.test(n) && n !== 'hostEnter')
  // 이름에 host 가 없는 운영자 문들
  const hostAlso = ['assignAll', 'createGame', 'refreshFaces', 'resetGame', 'startGame', 'pushDay', 'peekDay', 'setDevClock', 'seedPlayers', 'openPhase', 'closePhase', 'clearInvisible', 'noticeTemplates', 'sweepSeats']
  const hostFns = [...new Set([...hostNamed, ...hostAlso])].filter((n) => exported.has(n))
  check(hostFns.length >= 40, `운영자 콜러블 ${hostFns.length}개를 찾았다`, hostFns.join(' '))
  snap = await snapshot()
  for (const fn of hostFns) {
    const r = await call(fn, me.token, { gameId: GAME, day: 1, pot: 0, cropId: 'corn', reason: '까닭', text: '안녕', toPlayerId: me.uid, playerId: me.uid, playerIds: [me.uid], noteId: 'r01-p1-role', tileId: 'gym', n: 1, id: 'x', ids: ['x'], quiz: { kind: 'short', prompt: '?', answers: ['a'] }, slipId: 'x', paperId: 'x', specId: 'x', boardId: 'f1w', to: 'gym', channel: 'A', open: true, status: 'met', anchorGameMs: 0, speed: 1, password: 'password', kind: 'memo', seed: 'x', startAtMs: 0 })
    check(!r.ok && r.code === 'PERMISSION_DENIED' && cleanMessage(r.message), `참가자의 ${fn}`, `${r.code} ${r.message}`)
  }
  // 로비에서 못 부르는 것들도 로비 사람에게 막힌다
  for (const fn of hostFns) {
    const r = await call(fn, lobbyGuy.token, { gameId: LOBBY })
    if (r.code !== 'PERMISSION_DENIED') check(false, `로비 사람의 ${fn}`, `${r.code} ${r.message}`)
  }
  snap = await unchanged(snap, '운영자 콜러블을 참가자가 두드린 뒤 판이 그대로다')

  // ── 페이즈 ──
  console.log('\n── 닫힌 페이즈 · 열린 페이즈 ──')
  snap = await snapshot()
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: 'gym' }), '닫힌 페이즈에 phaseAct move', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'hack' }), 'phaseAct 없는 행동', 'INVALID_ARGUMENT')
  for (const k of [undefined, 42, null, {}, '__proto__', 'constructor']) rejects(await call('phaseAct', me.token, { gameId: GAME, kind: k }), `phaseAct kind=${JSON.stringify(k) ?? 'undefined'}`)
  rejects(await call('commissionTrap', me.token, { gameId: GAME, maker: 0 }), '닫힌 페이즈에 commissionTrap', 'FAILED_PRECONDITION')
  snap = await unchanged(snap, '닫힌 페이즈 오용 뒤 판이 그대로다')
  const closed = await call('closePhase', host, { gameId: GAME })
  check(closed.ok || isReject(closed), '열린 것이 없는데 closePhase — 조용히 지나가거나 한국어로 거절', `${closed.code ?? 'ok'} ${closed.message ?? ''}`)
  await must('openPhase', host, { gameId: GAME })
  rejects(await call('openPhase', host, { gameId: GAME }), '열린 채로 openPhase 두 번', 'FAILED_PRECONDITION')
  const tokens0 = (await teamOf('A')).phaseTokens
  snap = await snapshot()
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: 'nowhere' }), 'phaseAct move 없는 방', 'FAILED_PRECONDITION')
  for (const t of [undefined, 42, {}, '', null]) rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: t }), `phaseAct move targetTile=${JSON.stringify(t) ?? 'undefined'}`)
  // 원형 열쇠는 TILE_BY_ID 첨자 검사를 지나 규칙(sameHall 의 y.has)에서 터진다 — phase.ts 몫
  for (const t of ['constructor', '__proto__', 'toString']) {
    const r = await call('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: t })
    observe(isReject(r), `[phase.ts] phaseAct move targetTile=${JSON.stringify(t)}`, `${r.status} ${r.code} ${r.message}`)
  }
  if (far) rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: far }), `phaseAct move 안 이어진 방(${far})`, 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'research' }), '연구실 밖에서 research', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'summon', targetPlayer: you.uid }), '남의 팀을 summon', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'summon', targetPlayer: 'nobody' }), '없는 사람을 summon', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'smashRobot', targetRobot: 'nope' }), '없는 로봇 smashRobot', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'plant', targetTeam: 'Z' }), '없는 팀 깃발 plant', 'FAILED_PRECONDITION')
  rejects(await call('phaseAct', me.token, { gameId: GAME, kind: 'pull' }), '뽑을 것 없는 pull', 'FAILED_PRECONDITION')
  // 페이즈 중에는 자유 시간의 일이 막힌다
  rejects(await call('roamTo', me.token, { gameId: GAME, tileId: 'gym' }), '페이즈 중 roamTo', 'FAILED_PRECONDITION')
  rejects(await call('harvestPot', me.token, { gameId: GAME, pot: 0 }), '페이즈 중 harvestPot', 'FAILED_PRECONDITION')
  rejects(await call('buyShopItem', A[3].token, { gameId: GAME, itemId: SHOP_ITEMS[0].id }), '페이즈 중 buyShopItem', 'FAILED_PRECONDITION')
  rejects(await call('takeErrand', me.token, { gameId: GAME, errandId: 'x' }), '페이즈 중 takeErrand', 'FAILED_PRECONDITION')
  rejects(await call('takeQuiz', me.token, { gameId: GAME, paperId: 'x' }), '페이즈 중 takeQuiz', 'FAILED_PRECONDITION')
  rejects(await call('askTransfer', me.token, { gameId: GAME, toPlayerId: you.uid }), '페이즈 중 askTransfer', 'FAILED_PRECONDITION')
  check((await teamOf('A')).phaseTokens === tokens0, '거절된 페이즈 행동에 토큰이 안 들었다')
  snap = await unchanged(snap, '열린 페이즈 오용 뒤 판이 그대로다')
  // 이동 열 번 — 한 걸음만 들고 나머지는 「걷는 중」
  const target = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE, t)) as TileId
  // 이동은 판 전체를 읽는 트랜잭션이라 동시 열 개는 에뮬레이터가 잠금 시간을 넘긴다(부하 큰 기계) — 셋만 동시에, 나머지는 차례로
  const burst = await Promise.all(Array.from({ length: 3 }, () => call('phaseAct', mate.token, { gameId: GAME, kind: 'move', targetTile: target })))
  const tenMove: Res[] = [...burst]
  for (let i = 0; i < 7; i++) tenMove.push(await call('phaseAct', mate.token, { gameId: GAME, kind: 'move', targetTile: target }))
  const moveOks = tenMove.filter((r) => r.ok).length
  const tokens1 = (await teamOf('A')).phaseTokens
  check(moveOks === 1, 'phaseAct move ×10(셋 동시 + 일곱 차례로): 한 번만 걸음이 된다', `${moveOks}번 · ${tenMove.find((r) => !r.ok)?.message ?? ''}`)
  check(tenMove.filter((r) => !r.ok).every((r) => cleanMessage(r.message)), 'phaseAct move ×10: 나머지는 깨끗하게 거절(걷는 중)', tenMove.find((r) => !r.ok)?.message ?? '')
  check(tokens0 - tokens1 === moveOks, 'phaseAct move ×10: 토큰이 성공한 수만큼만 빠졌다', `${tokens0}→${tokens1}`)
  await must('closePhase', host, { gameId: GAME })

  console.log('\n── 표를 센 뒤의 castBallot ──')
  // 투명인간 투표의 「열림」은 게임 문서의 ballot.open(+ballot.day) 이다 — 운영자가 hostOpenBallot 으로 연다(ballotGate.ts).
  // 열기 전에는 못 적고, 그날 정산을 넘기면(pushDay settlement) 다시 닫힌다
  rejects(await call('castBallot', me.token, { gameId: GAME, targetId: you.uid }), '열기 전 castBallot', 'FAILED_PRECONDITION')
  rejects(await call('hostOpenBallot', me.token, { gameId: GAME }), '참가자의 hostOpenBallot', 'PERMISSION_DENIED')
  await must('hostOpenBallot', host, { gameId: GAME })
  const okBallot = await call('castBallot', me.token, { gameId: GAME, targetId: you.uid })
  check(okBallot.ok, '운영자가 연 뒤에는 castBallot 이 된다', okBallot.message)
  for (let i = 0; i < 20; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { pushed: { kind: string; day: number } | null }
    if (!r.pushed || (r.pushed.kind === 'settlement' && r.pushed.day === 1)) break
  }
  rejects(await call('castBallot', me.token, { gameId: GAME, targetId: mate.uid }), '표를 센 뒤 castBallot', 'FAILED_PRECONDITION')
  const myBallot = (await getDoc(`games/${GAME}/secret/ballots/items/d1:${me.uid}`)) as { targetId: string }
  check(myBallot.targetId === you.uid, '센 뒤에는 표가 안 바뀐다')

  if (observed > 0) console.log(`\n보고만(△) ${observed}건 — 고칠 수 없는 파일 · 프레임워크 몫`)
  // 맨 끝에 본다 — 없는 함수를 부르면 에뮬레이터(한 워커 모드)가 뒤따르는 호출을 흘린다
  // 쪽지를 그냥 건네는 길은 없다 — 넘기는 것은 거래뿐이다
  const noGive = await fetch(`${FN}/giveSlip`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.token}` }, body: JSON.stringify({ data: { gameId: GAME, slipId: 'x', toPlayerId: 'y' } }) })
  check(!noGive.ok, 'giveSlip 은 없다 — 쪽지는 거래로만 넘긴다', String(noGive.status))

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
