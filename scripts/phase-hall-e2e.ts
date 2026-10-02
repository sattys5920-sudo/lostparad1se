// 페이즈가 열리면 모두 복도에서 시작한다 — 방 안 사람은 그 방 문 앞, 걷던 사람은 가던 방 문 앞
//
//   npx vite-node scripts/phase-hall-e2e.ts   (에뮬레이터가 떠 있어야 한다)
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
import { isBlockedCell } from '../shared/rules/blocked'
import { TILE_IDS, canRoamTo, isHallCell, roomOfCell } from '../shared/rules/board'
import { entryCellOf, inLane } from '../shared/rules/seat'
import { isFixture } from '../shared/rules/fixtures'
import { ROOF_LANDINGS, TILE_BY_ID as TILES } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'

const GAME = `hall${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

interface PawnRow { id: string; tileId: string | null; at: { x: number; y: number } | null; team: string; path: string[]; arriveAtMs: number | null }
async function pawnsAll(): Promise<PawnRow[]> {
  const j = (await (await fetch(`${FS}/games/${GAME}/pawns?pageSize=300`, { headers: ADMIN })).json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => {
    const d = plain(doc) as { tileId?: string | null; at?: { x: number; y: number } | null; team: string; path?: string[]; arriveAtMs?: number | null }
    return { id: doc.name.split('/').pop() as string, tileId: d.tileId ?? null, at: d.at ?? null, team: d.team, path: d.path ?? [], arriveAtMs: d.arriveAtMs ?? null }
  })
}
const pawnOf = async (uid: string) => (await pawnsAll()).find((p) => p.id === uid) as PawnRow
const int = (n: number) => ({ integerValue: String(n) })
const cellV = (c: { x: number; y: number }) => ({ mapValue: { fields: { x: int(c.x), y: int(c.y) } } })
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
}
const inHall = (c: { x: number; y: number } | null) => !!c && roomOfCell(c.x, c.y) === null && isHallCell(c.x, c.y)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
/** 그 방 안의 빈 칸 하나(소품·시작 칸이 아닌) */
function roomCell(tile: string, skip: Set<string>): { x: number; y: number } {
  const c = dropCellsIn(tile as never).find((x) => !isBlockedCell(x.x, x.y) && !isFixture(x.x, x.y) && !skip.has(`${x.x},${x.y}`))
  if (!c) throw new Error(`${tile} 안에 빈 칸이 없다`)
  skip.add(`${c.x},${c.y}`)
  return c
}
async function tokensOf(team: string): Promise<number> {
  return Number((plain(await (await fetch(`${FS}/games/${GAME}/teams/${team}`, { headers: ADMIN })).json()) as { phaseTokens?: number }).phaseTokens ?? 0)
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'hall' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const t0 = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: t0, speed: 1 })

  const R1 = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE as never, t)) as string
  const R2 = TILE_IDS.find((t) => t !== START_TILE && t !== R1 && t !== 'rooftop' && canRoamTo(START_TILE as never, t)) ?? R1
  const [a, b, c, d, e, f, g] = people

  console.log('\n── 첫 교시: 열리자마자 2-3 교실의 열넷이 모두 복도로 ──')
  await must('openPhase', host, { gameId: GAME })
  let rows = await pawnsAll()
  check(rows.every((r) => inHall(r.at)), '열넷 모두 복도에 섰다', rows.filter((r) => !inHall(r.at)).map((r) => JSON.stringify(r.at)).join(' '))
  check(rows.every((r) => r.tileId === START_TILE), '방(tileId)은 2-3 교실 그대로다 — 복도에 선 것이다')
  check(new Set(rows.map((r) => `${r.at?.x},${r.at?.y}`)).size === rows.length, '한 칸에 한 사람')
  check(rows.every((r) => r.at && dist(r.at, entryCellOf(START_TILE as never)) <= 12), '모두 2-3 교실 문 가까이에 섰다')
  check(rows.every((r) => r.at && !inLane(r.at.x, r.at.y)), '문 바로 앞(다시 들어가는 길)은 비워 두었다', rows.filter((r) => r.at && inLane(r.at.x, r.at.y)).map((r) => JSON.stringify(r.at)).join(' '))

  // f 는 다른 방으로 걷기 시작한다 — 도착 전에 교시를 닫는다
  const fGo = await must('phaseAct', f.token, { gameId: GAME, kind: 'move', targetTile: R2 })
  check(fGo.ok !== false, `f 가 ${R2} 로 걷기 시작했다`, JSON.stringify(fGo))
  check((await pawnOf(f.uid)).tileId === null, 'f 는 걷는 중이다')
  await must('closePhase', host, { gameId: GAME })
  const fClosed = await pawnOf(f.uid)
  check(
    fClosed.tileId === R2 && fClosed.at !== null && roomOfCell(fClosed.at.x, fClosed.at.y) === R2 && fClosed.path.length === 0 && fClosed.arriveAtMs === null,
    '**교시가 닫히면 걷던 f 는 바로 가던 방 안에 선다**',
    JSON.stringify(fClosed),
  )

  console.log('\n── 자유 시간에 여기저기 자리를 잡는다 ──')
  const skip = new Set<string>()
  await must('roamTo', a.token, { gameId: GAME, tileId: R1 })
  const bIn = roomCell(START_TILE, skip)
  const bStand = await must('standAt', b.token, { gameId: GAME, x: bIn.x, y: bIn.y })
  check(bStand.ok === true, 'b 는 자유 시간에 2-3 교실 안으로 다시 들어갔다', JSON.stringify(bStand))
  const cWas = (await pawnOf(c.uid)).at
  // d 는 우리 분단이 가진 방 안
  const OWN = TILE_IDS.find((t) => t !== START_TILE && t !== R1 && t !== R2 && t !== 'rooftop') as string
  await patch(`games/${GAME}/tiles/${OWN}`, { ownerTeam: { stringValue: d.team } })
  await patch(`games/${GAME}/pawns/${d.uid}`, { tileId: { stringValue: OWN }, at: cellV(roomCell(OWN, skip)) })
  await patch(`games/${GAME}/pawns/${e.uid}`, { tileId: { stringValue: 'rooftop' }, at: cellV(roomCell('rooftop', skip)) })
  // g 는 방 안에서 덫에 걸려 있다
  const gCell = roomCell(R1, skip)
  await patch(`games/${GAME}/pawns/${g.uid}`, { tileId: { stringValue: R1 }, at: cellV(gCell), busyKind: { stringValue: '덫' }, busyUntilMs: int(t0 + 6 * 3600_000) })

  console.log('\n── 둘째 교시가 열린다 ──')
  await must('openPhase', host, { gameId: GAME })
  rows = await pawnsAll()
  const row = (u: { uid: string }) => rows.find((r) => r.id === u.uid) as PawnRow
  check(inHall(row(a).at) && row(a).tileId === R1, `${TILES[R1 as never].name}에 있던 a 는 그 방 문 앞 복도로`, JSON.stringify(row(a)))
  check(row(a).at !== null && dist(row(a).at as never, entryCellOf(R1 as never)) <= 7, 'a 는 그 방 문 가까이에 섰다')
  check(inHall(row(b).at) && row(b).tileId === START_TILE, '2-3 교실 안의 b 도 복도로')
  check(inHall(row(d).at) && row(d).tileId === OWN, '우리 분단 방에 있던 d 도 복도로')
  check(inHall(row(e).at) && ROOF_LANDINGS.some((l) => dist(l, row(e).at as never) <= 6), '옥상의 e 는 2층 계단통으로 내려섰다', JSON.stringify(row(e).at))
  check(row(c).at?.x === cWas?.x && row(c).at?.y === cWas?.y, '이미 복도에 있던 c 는 그대로다')
  check(row(g).at?.x === gCell.x && row(g).at?.y === gCell.y, '덫에 걸린 g 는 그 자리 그대로다')
  check(row(f).tileId === R2 && inHall(row(f).at) && row(f).path.length === 0 && row(f).arriveAtMs === null, `닫힐 때 도착한 f 는 그 방(${TILES[R2 as never].name}) 문 앞 복도로`, JSON.stringify(row(f)))
  check(row(f).at !== null && dist(row(f).at as never, entryCellOf(R2 as never)) <= 7, 'f 는 그 방 문 가까이에 섰다')
  const seen = rows.filter((r) => r.at).map((r) => `${r.at?.x},${r.at?.y}`)
  check(new Set(seen).size === seen.length, '판 전체에 한 칸에 둘이 선 곳이 없다')
  const bad = rows.filter((r) => r.id !== g.uid && !inHall(r.at))
  check(bad.length === 0, '덫에 걸린 사람 말고는 모두 복도다', bad.map((r) => r.id).join(' '))

  console.log('\n── 도착 예약이 남아 저절로 들어서지 않는다 ──')
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: t0 + 30 * 60_000, speed: 1 })
  await must('tick', f.token, { gameId: GAME })
  const fLater = await pawnOf(f.uid)
  check(inHall(fLater.at) && fLater.tileId === R2, '시간이 지나도 저절로 방에 들어서지 않는다', JSON.stringify(fLater))

  console.log('\n── 다시 들어가기 ──')
  const aIn = roomCell(R1, skip)
  const sneak = await must('standAt', a.token, { gameId: GAME, x: aIn.x, y: aIn.y })
  check(sneak.ok === false && sneak.code === 'reenter', '걸어서 그냥 들어가면 「토큰을 쓴다」로 막힌다', JSON.stringify(sneak))
  const aTok = await tokensOf(a.team)
  const aGo = await must('phaseAct', a.token, { gameId: GAME, kind: 'move', targetTile: R1 })
  check(Number(aGo.minutes) === 5, '복도에서 들어가면 5 분 — 나가는 5 분은 안 물었다', JSON.stringify(aGo))
  check((await tokensOf(a.team)) === aTok - 1, '남의 방(주인 없는 방)은 토큰 1')
  const dTok = await tokensOf(d.team)
  const dGo = await must('phaseAct', d.token, { gameId: GAME, kind: 'move', targetTile: OWN })
  check(Number(dGo.minutes) === 5, '우리 분단 방도 5 분', JSON.stringify(dGo))
  check((await tokensOf(d.team)) === dTok, '우리 분단 방은 토큰이 안 든다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
