// QA 도구 — 불변식 검사와 시각순 로그. 서버가 가른다.
//
//   - 갓 시작한 판은 불변식 이상이 없다
//   - 불변식을 하나씩 깨뜨리면(에뮬레이터 REST 로 문서를 직접 고쳐서) 그 종류 하나로 잡힌다
//     말 없음 · 칸 겹침 · 못 서는 칸 · 제 방 밖 칸 · 금고 음수 · 토큰 음수 ·
//     팀 로봇 초과 · 방 로봇 초과 · 쪽지 수 어긋남 · 방 주인 이상
//   - 쪽지를 뿌리고 회수하면 기대 장수가 따라 움직여 어긋남이 없다
//   - 잡힌 것은 secret/qa/violations 에 직전 로그 한 줄과 함께 남는다
//   - 참가자가 hostInvariants · hostEventLog 를 부르면 PERMISSION_DENIED
//   - 로그에 채팅 문장 · 역할 · 표의 상대가 없다 · sinceMs · kinds 가 먹는다
//
//   npx vite-node scripts/qa-invariants-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { START_TILE, TILE_IDS, canRoamTo } from '../shared/rules/board'
import { ENTRY_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { dropCellsIn } from '../shared/rules/quiz'
import { ROBOTS_PER_ROOM, ROBOTS_PER_TEAM } from '../shared/rules/occupy'
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
/** JS 값 → Firestore REST 값 */
function enc(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
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

const GAME = `qi${Date.now().toString(36).slice(-6)}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 문서의 몇 칸을 고친다(경로는 games/{GAME}/ 아래) */
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/games/${GAME}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`patch ${path}: ${r.status} ${await r.text()}`)
}
async function create(col: string, id: string, fields: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${FS}/games/${GAME}/${col}?documentId=${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`create ${col}/${id}: ${r.status} ${await r.text()}`)
}
async function remove(path: string): Promise<void> {
  await fetch(`${FS}/games/${GAME}/${path}`, { method: 'DELETE', headers: ADMIN })
}
async function read(path: string): Promise<Record<string, unknown>> {
  return plain(await (await fetch(`${FS}/games/${GAME}/${path}`, { headers: ADMIN })).json()) as Record<string, unknown>
}
async function list(path: string): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const j = (await (await fetch(`${FS}/games/${GAME}/${path}?pageSize=300`, { headers: ADMIN })).json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((d) => ({ id: d.name.split('/').pop() as string, data: plain(d) as Record<string, unknown> }))
}

interface Violation { kind: string; detail: string; lastEvent: { text: string; atMs: number } | null }
interface Inv { violations: Violation[]; history: Violation[] }
interface Row { id: string; atMs: number; day: number; kind: string; src: string; actor?: string; target?: string; text: string }
interface Log { rows: Row[]; kinds: string[]; total: number; truncated: boolean }

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'qi' })
  const people: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${i}` })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const inv = async () => (await must('hostInvariants', host, { gameId: GAME })) as unknown as Inv
  const [a, b] = people

  console.log('\n── 갓 시작한 판 ──')
  const first = await inv()
  check(first.violations.length === 0, '불변식 이상 없음', first.violations.map((v) => `${v.kind}:${v.detail}`).join(' · '))
  check(first.history.length === 0, '쌓인 기록도 없다')
  check(typeof (await read('secret/qa')).expectedSlips === 'number', '쪽지 기대 장수가 잡혔다(0)')

  /** 하나 깨뜨리고 → 그 종류 하나만 잡히는지 → 되돌린다 */
  async function breakOne(label: string, kind: string, breakIt: () => Promise<void>, fixIt: () => Promise<void>): Promise<void> {
    await breakIt()
    const out = await inv()
    const kinds = out.violations.map((v) => v.kind)
    check(kinds.length === 1 && kinds[0] === kind, `${label} → ${kind} 하나`, kinds.join(',') || '없음')
    await fixIt()
    const after = await inv()
    check(after.violations.length === 0, `${label} 되돌리면 이상 없음`, after.violations.map((v) => v.kind).join(','))
  }

  console.log('\n── 하나씩 깨뜨린다 ──')
  const aPawn = await read(`pawns/${a.uid}`)
  const bPawn = await read(`pawns/${b.uid}`)
  const aAt = aPawn.at as { x: number; y: number }
  const bAt = bPawn.at as { x: number; y: number }
  await breakOne('말이 어느 방에도 없다', 'pawnNowhere',
    () => patch(`pawns/${a.uid}`, { tileId: null, path: [], arriveAtMs: null }),
    () => patch(`pawns/${a.uid}`, { tileId: START_TILE }))
  await breakOne('둘이 한 칸에', 'cellShared',
    () => patch(`pawns/${b.uid}`, { at: aAt }),
    () => patch(`pawns/${b.uid}`, { at: bAt }))
  const desk = dropCellsIn(START_TILE as never).find((c) => isBlockedCell(c.x, c.y))
  if (desk) {
    await breakOne('책상 위에', 'cellBlocked',
      () => patch(`pawns/${a.uid}`, { at: desk }),
      () => patch(`pawns/${a.uid}`, { at: aAt }))
  } else check(false, '교실에 소품 칸이 없다 — 검사할 수 없다')
  const other = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE as never, t)) as string
  await breakOne('제 방 밖 칸에', 'pawnCellRoomMismatch',
    () => patch(`pawns/${a.uid}`, { at: ENTRY_CELLS[other] }),
    () => patch(`pawns/${a.uid}`, { at: aAt }))
  const vault = (await read('teams/A')).resources as { money: number; knowledge: number }
  await breakOne('금고 음수', 'vaultNegative',
    () => patch('teams/A', { resources: { money: -1, knowledge: vault.knowledge } }),
    () => patch('teams/A', { resources: vault }))
  const tokens = (await read('teams/B')).phaseTokens as number
  await breakOne('토큰 음수', 'tokensNegative',
    () => patch('teams/B', { phaseTokens: -2 }),
    () => patch('teams/B', { phaseTokens: tokens }))
  // 로봇 — 팀 한도는 방마다 하나씩 흩어 두고(방 한도에 안 걸리게), 방 한도는 한 방에 몰아서
  const rooms = TILE_IDS.slice(0, ROBOTS_PER_TEAM + 1)
  await breakOne('팀 로봇 초과', 'robotsOverTeam',
    async () => { for (let i = 0; i < rooms.length; i++) await create('robots', `qr${i}`, { id: `qr${i}`, team: 'C', tileId: rooms[i], carriedBy: null }) },
    async () => { for (let i = 0; i < rooms.length; i++) await remove(`robots/qr${i}`) })
  await breakOne('방 로봇 초과', 'robotsOverRoom',
    async () => { for (let i = 0; i <= ROBOTS_PER_ROOM; i++) await create('robots', `qs${i}`, { id: `qs${i}`, team: 'D', tileId: other, carriedBy: null }) },
    async () => { for (let i = 0; i <= ROBOTS_PER_ROOM; i++) await remove(`robots/qs${i}`) })
  const owner = (await read(`tiles/${other}`)).ownerTeam as string | null
  await breakOne('방 주인이 Z', 'tileOwnerBad',
    () => patch(`tiles/${other}`, { ownerTeam: 'Z' }),
    () => patch(`tiles/${other}`, { ownerTeam: owner }))
  await breakOne('쪽지 문서를 몰래 하나', 'slipCountMismatch',
    () => create('secret/slips/items', 'ghost', { textId: '', subjectId: '', tileId: START_TILE, heldBy: null, readBy: [], tornBy: null, atMs: 0 }),
    () => remove('secret/slips/items/ghost'))

  console.log('\n── 쪽지를 뿌리고 거두면 기대 장수가 따라간다 ──')
  const scattered = (await must('hostScatterRandom', host, { gameId: GAME, n: 2 })) as { scattered: number }
  check(scattered.scattered === 2, '두 장 뿌렸다', String(scattered.scattered))
  check((await inv()).violations.length === 0, '뿌린 뒤 이상 없음')
  check((await read('secret/qa')).expectedSlips === 2, '기대 장수 2', String((await read('secret/qa')).expectedSlips))
  const slips = await list('secret/slips/items')
  await must('hostPullSlip', host, { gameId: GAME, slipId: slips[0].id })
  check((await inv()).violations.length === 0, '거둔 뒤 이상 없음')
  check((await read('secret/qa')).expectedSlips === 1, '기대 장수 1')
  await must('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: other, text: '운영자 메모다' })
  check((await inv()).violations.length === 0, '메모를 놓아도 이상 없음')
  check((await read('secret/qa')).expectedSlips === 2, '기대 장수 2')

  console.log('\n── 기록 ──')
  const hist = (await inv()).history
  check(hist.length === 10, '어긋남 열 건이 남았다', String(hist.length))
  check(hist.every((v) => v.lastEvent !== null && typeof v.lastEvent.text === 'string'), '건마다 직전 로그 한 줄이 붙어 있다')
  const kindsSeen = new Set(hist.map((v) => v.kind))
  check(kindsSeen.size === 10, '열 종류가 다 다르다', [...kindsSeen].join(','))

  console.log('\n── 참가자는 못 부른다 ──')
  check((await call('hostInvariants', a.token, { gameId: GAME })).code === 'PERMISSION_DENIED', 'hostInvariants')
  check((await call('hostEventLog', a.token, { gameId: GAME })).code === 'PERMISSION_DENIED', 'hostEventLog')

  console.log('\n── 로그에 새면 안 되는 것 ──')
  const secretLine = `비밀말${Date.now()}`
  await must('say', a.token, { gameId: GAME, text: secretLine })
  // 운영자가 문을 열어야 적는다(ballotGate). a 가 b 를 적는다
  await must('hostOpenBallot', host, { gameId: GAME })
  const cast = await call('castBallot', a.token, { gameId: GAME, targetId: b.uid })
  check(cast.ok, '표를 적었다', cast.message ?? '')
  await must('roamTo', people[2].token, { gameId: GAME, tileId: other })
  const t0 = dayHourMs(START, 1, 10)
  const log = (await must('hostEventLog', host, { gameId: GAME })) as unknown as Log
  const dump = JSON.stringify(log.rows)
  check(log.rows.length >= 8, '줄이 있다', `${log.rows.length}줄 · 종류 ${log.kinds.length}`)
  check(!dump.includes(secretLine), '채팅 문장이 없다')
  const roster = await list('secret/roster/items')
  const roleIds = roster.map((r) => String(r.data.roleId))
  check(roleIds.length === TOTAL_SEATS && roleIds.every((id) => !dump.includes(`"${id}"`)), '역할이 없다', roleIds.filter((id) => dump.includes(`"${id}"`)).join(','))
  const ballotRows = log.rows.filter((r) => r.kind === 'ballotCast')
  check(ballotRows.length === 1 && ballotRows[0].actor === a.name, '표 적음 한 줄 · 적은 사람만', JSON.stringify(ballotRows))
  check(ballotRows.every((r) => !r.target && !r.text.includes(b.name) && !JSON.stringify(r).includes(b.uid)), '표의 상대는 없다')
  check(!dump.includes(b.uid) && !dump.includes(a.uid), '아이디 원문 대신 이름이다')
  const kinds = new Set(log.rows.map((r) => r.kind))
  for (const k of ['gameStart', 'assigned', 'devClock', 'slipScattered', 'slipPulled', 'memoDropped', 'ballotOpen', 'ballotCast'] as const) {
    check(kinds.has(k), `종류 ${k} 가 있다`)
  }
  check(log.rows.every((r, i) => i === 0 || log.rows[i - 1].atMs <= r.atMs), '시각순이다')
  const sorted = [...log.rows].every((r) => typeof r.day === 'number' && typeof r.text === 'string' && r.text.length > 0)
  check(sorted, '줄마다 날과 글이 있다')
  const since = (await must('hostEventLog', host, { gameId: GAME, sinceMs: t0 })) as unknown as Log
  check(since.rows.length > 0 && since.rows.every((r) => r.atMs >= t0), 'sinceMs 뒤만 온다', `${since.rows.length}줄`)
  const only = (await must('hostEventLog', host, { gameId: GAME, kinds: ['ballotCast', 'slipScattered'] })) as unknown as Log
  check(only.rows.length === 3 && only.rows.every((r) => r.kind === 'ballotCast' || r.kind === 'slipScattered'), 'kinds 로 거른다', `${only.rows.length}줄`)
  const lim = (await must('hostEventLog', host, { gameId: GAME, limit: 3 })) as unknown as Log
  check(lim.rows.length === 3 && lim.truncated && lim.rows[2].atMs === log.rows[log.rows.length - 1].atMs, 'limit 은 최근을 남긴다')

  console.log('\n── 달력을 넘기면 한 줄 ──')
  await must('pushDay', host, { gameId: GAME })
  const after = (await must('hostEventLog', host, { gameId: GAME, kinds: ['dayPushed'] })) as unknown as Log
  check(after.rows.length === 1 && after.rows[0].actor === undefined, '달력 넘김 한 줄', after.rows[0]?.text ?? '')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
