// 운영자 지도 — hostLiveMap · hostRoomChat.
//
// 확인할 것.
//
//   **운영자만 연다** — 플레이어가 부르면 PERMISSION_DENIED
//   열넷이 한 줄씩 온다
//   걷는 중 · 거래 중 · 덫 이 한 줄(doing)에 제대로 찍힌다
//   지도에는 역할도 노트도 말도 없다
//   말은 운영자가 **시간 창 없이** 본다 — 들어오기 전의 말도, 지워진
//   사람의 말도(안 보임), 복도의 말도
//
//   1. cd functions && npm run build   (에뮬레이터가 떠 있어야 한다)
//   2. npx vite-node scripts/livemap-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { HALLS, START_TILE, TILE_BY_ID, TILES, canRoamTo, type TileId } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'

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
async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}

/** Firestore 값 하나 */
function enc(v: unknown): unknown {
  if (v === null) return { nullValue: null }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
  return { stringValue: String(v) }
}
/** 문서 몇 칸을 바로 적는다. **시험 준비용** — 서버를 거치지 않는다 */
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`patch ${path}: ${r.status}`)
}

const GAME = `lm${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000

type Row = {
  playerId: string
  name: string
  team: string
  tileId: string | null
  kind: string
  doing: string
  invisible: boolean
  walk: unknown
  deal: { withName: string } | null
}
type ChatLine = { id: string; name: string; text: string; tileId: string | null; hall: boolean; roomName: string; hidden: boolean; atMs: number }

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'livemap' })
  const people: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    const name = `봇${i}`
    people.push({ ...a, team: want[i], name })
    await must('joinGame', a.token, { gameId: GAME, name, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const T0 = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0, speed: 1 })
  check(true, '판이 시작했다')

  const map = async () => (await must('hostLiveMap', host, { gameId: GAME })) as { people: Row[]; nowMs: number; rooms: Record<string, unknown> }
  const rowOf = async (uid: string) => (await map()).people.find((p) => p.playerId === uid) as Row

  console.log('\n── 운영자만 ──')
  const first = await map()
  check(first.people.length === 14, '열넷이 한 줄씩', String(first.people.length))
  check(first.people.every((p) => p.kind === 'idle' && p.doing === '가만히'), '처음에는 다 「가만히」', [...new Set(first.people.map((p) => p.doing))].join(','))
  check(Object.keys(first.rooms).length === TILES.length, '방마다 한 칸', String(Object.keys(first.rooms).length))
  const denied = await call('hostLiveMap', people[0].token, { gameId: GAME })
  check(denied.code === 'PERMISSION_DENIED', '플레이어가 부르면 PERMISSION_DENIED', String(denied.code))
  const denied2 = await call('hostRoomChat', people[0].token, { gameId: GAME, room: 'all' })
  check(denied2.code === 'PERMISSION_DENIED', '말도 — 플레이어는 PERMISSION_DENIED', String(denied2.code))

  // 옆 방 하나. 2-3 교실에서 복도로 닿는 곳
  const room = TILES.map((t) => t.id as TileId).find((t) => t !== START_TILE && canRoamTo(START_TILE as TileId, t)) as TileId
  const far = TILES.map((t) => t.id as TileId).find((t) => t !== START_TILE && t !== room && canRoamTo(START_TILE as TileId, t)) as TileId

  console.log('\n── 걷는 중 ──')
  const W = people[0]
  await patch(`games/${GAME}/pawns/${W.uid}`, { tileId: null, fromTile: START_TILE, path: [room, far], arriveAtMs: T0 + 10 * M })
  const w = await rowOf(W.uid)
  check(w.kind === 'walk' && w.doing === `걷는 중 → ${TILE_BY_ID[far].name}`, '걷는 중 → 목적지', w.doing)
  check(w.tileId === null && w.walk !== null, '걷는 사람은 방이 없다')

  console.log('\n── 덫 ──')
  const TR = people[1]
  const now1 = (await map()).nowMs
  await patch(`games/${GAME}/pawns/${TR.uid}`, { busyKind: '덫', busyUntilMs: now1 + 4 * M + 1000 })
  const t = await rowOf(TR.uid)
  check(t.kind === 'trap' && /^덫에 걸림 5분$/.test(t.doing), '덫에 걸림 n분', t.doing)
  await patch(`games/${GAME}/pawns/${TR.uid}`, { busyKind: '연구', busyUntilMs: now1 + 2 * M })
  const lab = await rowOf(TR.uid)
  check(lab.kind === 'busy' && lab.doing === '연구 중 2분', '다른 일로 묶이면 「무엇 중 n분」', lab.doing)

  console.log('\n── 거래 ──')
  const A = people[2]
  const B = people[3]
  await must('roamTo', A.token, { gameId: GAME, tileId: room })
  await must('roamTo', B.token, { gameId: GAME, tileId: room })
  const cells = dropCellsIn(room).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y))
  const ok = new Set(cells.map((c) => `${c.x},${c.y}`))
  const pair = cells.find((c) => ok.has(`${c.x + 1},${c.y}`))
  if (!pair) throw new Error(`${room} 에 나란히 설 칸이 없다`)
  for (const [who, c] of [[A, pair], [B, { x: pair.x + 1, y: pair.y }]] as const) {
    const r = await must('standAt', who.token, { gameId: GAME, ...c })
    if (r.ok !== true) throw new Error(`standAt 안 섰다 ${String(r.why ?? '')}`)
  }
  const asked = await must('askDeal', A.token, { gameId: GAME, toPlayerId: B.uid })
  const askA = await rowOf(A.uid)
  const askB = await rowOf(B.uid)
  check(askA.kind === 'deal' && askA.doing === `거래 거는 중 · ${B.name}`, '건 쪽: 거래 거는 중 · 상대', askA.doing)
  check(askB.doing === `거래 요청 받음 · ${A.name}`, '받은 쪽: 거래 요청 받음 · 상대', askB.doing)
  await must('answerDeal', B.token, { gameId: GAME, dealId: String(asked.id), accept: true })
  const dA = await rowOf(A.uid)
  const dB = await rowOf(B.uid)
  check(dA.doing === `거래 중 · ${B.name}` && dB.doing === `거래 중 · ${A.name}`, '둘 다 「거래 중 · 상대 이름」', `${dA.doing} / ${dB.doing}`)
  check(dA.deal?.withName === B.name, '거래 상대가 실린다')

  console.log('\n── 말 — 운영자는 시간 창 없이 본다 ──')
  const S = people[4]
  const L = people[5]
  const OLD = `옛말-${GAME}`
  await must('roamTo', S.token, { gameId: GAME, tileId: far })
  await must('say', S.token, { gameId: GAME, text: OLD })
  // 늦게 온 사람 — 앞선 말은 못 듣는다
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0 + 2 * M, speed: 1 })
  await must('roamTo', L.token, { gameId: GAME, tileId: far })
  const late = (await must('chatLines', L.token, { gameId: GAME })) as { lines: { text: string }[] }
  check(!late.lines.some((l) => l.text === OLD), '늦게 온 플레이어는 앞선 말을 못 본다(규칙 그대로)')
  const inRoom = (await must('hostRoomChat', host, { gameId: GAME, room: far })) as { lines: ChatLine[] }
  const oldLine = inRoom.lines.find((l) => l.text === OLD)
  check(!!oldLine && oldLine.name === S.name && oldLine.tileId === far, '운영자는 들어오기 전 말까지 본다', oldLine ? `${oldLine.name}: ${oldLine.text}` : '없다')
  // 지워진 사람의 말
  const I = people[6]
  await must('roamTo', I.token, { gameId: GAME, tileId: far })
  await patch(`games/${GAME}`, { invisibleId: I.uid })
  const HID = `숨은말-${GAME}`
  await must('say', I.token, { gameId: GAME, text: HID })
  const inv = await rowOf(I.uid)
  check(inv.invisible === true, '지도에 투명인간 표시')
  // 복도
  const H = people[7]
  const taken = new Set((await getAll(`games/${GAME}/pawns`)).map((p) => { const a = p.d.at as { x: number; y: number } | null; return a ? `${a.x},${a.y}` : '' }))
  const hallCell = (() => {
    for (const h of HALLS) {
      if (h.floor !== TILE_BY_ID[START_TILE].floor) continue
      for (let y = h.rect.y; y < h.rect.y + h.rect.h; y++) for (let x = h.rect.x; x < h.rect.x + h.rect.w; x++) {
        if (!isFixture(x, y) && !isBlockedCell(x, y) && !taken.has(`${x},${y}`)) return { x, y }
      }
    }
    throw new Error('복도에 빈 칸이 없다')
  })()
  const hs = await must('standAt', H.token, { gameId: GAME, ...hallCell })
  check(hs.ok === true, '복도에 섰다', JSON.stringify(hallCell))
  const HALL = `복도말-${GAME}`
  await must('say', H.token, { gameId: GAME, text: HALL })
  const hRow = await rowOf(H.uid)
  check((hRow as unknown as { roomName: string }).roomName === '복도', '복도에 선 사람은 「복도」', String((hRow as unknown as { roomName: string }).roomName))

  const hid = ((await must('hostRoomChat', host, { gameId: GAME, room: far })) as { lines: ChatLine[] }).lines.find((l) => l.text === HID)
  check(!!hid && hid.hidden === true, '지워진 사람의 말도 보이고 「안 보임」 표시(hidden)', String(hid?.hidden))
  const hall = ((await must('hostRoomChat', host, { gameId: GAME, room: 'hall' })) as { lines: ChatLine[] }).lines
  check(hall.some((l) => l.text === HALL && l.hall && l.roomName === '복도'), '복도 말은 「hall」로 따로', String(hall.length))
  const all = (await must('hostRoomChat', host, { gameId: GAME, room: 'all' })) as { lines: ChatLine[] }
  const texts = all.lines.map((l) => l.text)
  check([OLD, HID, HALL].every((x) => texts.includes(x)), '「전체」는 방을 가리지 않고 섞어서', texts.join(' | '))
  check(all.lines.every((l, i) => i === 0 || all.lines[i - 1].atMs <= l.atMs), '오래된 것부터 차례로')
  check(all.lines.find((l) => l.text === OLD)?.roomName === TILE_BY_ID[far].name, '줄마다 방 이름이 붙는다')
  const lastMs = all.lines[all.lines.length - 1].atMs
  const since = (await must('hostRoomChat', host, { gameId: GAME, room: 'all', sinceMs: lastMs })) as { lines: ChatLine[] }
  check(since.lines.length >= 1 && since.lines.every((l) => l.atMs >= lastMs), 'sinceMs 뒤의 것만(새 줄만 받는다)', String(since.lines.length))
  const sum = (await must('hostRoomChat', host, { gameId: GAME, summary: true })) as { rooms: { room: string; lines: number; last: ChatLine | null }[]; lines: unknown }
  const farSum = sum.rooms.find((r) => r.room === far)
  check(farSum?.lines === 2 && farSum.last?.text === HID, '방마다 줄 수 · 마지막 줄', JSON.stringify(farSum))
  check(sum.rooms.some((r) => r.room === 'hall' && r.lines === 1), '복도도 한 칸으로 센다')
  check(sum.lines === null, '요약만 물으면 줄은 없다')
  const bad = await call('hostRoomChat', host, { gameId: GAME, room: 'nowhere' })
  check(bad.code === 'INVALID_ARGUMENT', '없는 방은 거절', String(bad.code))
  await patch(`games/${GAME}`, { invisibleId: null })

  console.log('\n── 지도에는 새지 않는다 ──')
  const raw = JSON.stringify(await map())
  check(!/"roleId"/.test(raw), 'roleId 가 없다')
  const roster = (await getAll(`games/${GAME}/secret/roster/items`)).map((r) => String(r.d.roleId))
  const leakedRole = roster.find((r) => raw.includes(`"${r}"`))
  check(!leakedRole, '역할 값도 어디에도 없다', leakedRole ?? '')
  check(!/"notes?"|"memo"|"targetId"/.test(raw), '노트 · 인연 대상이 없다')
  check(![OLD, HID, HALL].some((x) => raw.includes(x)), '말(채팅 문장)이 없다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
