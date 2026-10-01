// 정원 넘침 — 자유 시간에 정원보다 많이 들어간 방은 페이즈가 열릴 때 늦게 들어온 사람부터 문 앞 복도로 나온다
//
//   npx vite-node scripts/overflow-e2e.ts
import { createHash } from 'node:crypto'
import { ROAM_TO, TILE_BY_ID, isHallCell, roomOfCell, type TileId } from '../shared/rules/board'
import { entryCellOf } from '../shared/rules/seat'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `of${TAG}`
const PW = 'ofpass1234'
const QA = `qaof${TAG}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
const no = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message)
async function tok(id: string, password = PW): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const str = (v: unknown) => (v as { stringValue?: string })?.stringValue ?? null

async function doc(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
async function setPawn(uid: string, f: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(f).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? { integerValue: String(v) }
    : typeof v === 'string' ? { stringValue: v }
    : { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, number>).map(([k, n]) => [k, { integerValue: String(n) }])) } }
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, enc(v)])) }),
  })
}
const num = (v: unknown) => Number((v as { integerValue?: string; doubleValue?: number })?.integerValue ?? (v as { doubleValue?: number })?.doubleValue ?? NaN)
const cellOf = (f: Record<string, unknown>) => {
  const m = (f.at as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
  return { x: num(m.x), y: num(m.y) }
}

async function main(): Promise<void> {
  const email = `host-${TAG}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const host = ((await inn.json()) as { idToken: string }).idToken
  await call('createGame', host, { gameId: GAME, seed: 'of' })

  const aId = `oa${TAG}`
  const bId = `ob${TAG}`
  for (const id of [aId, bId]) await call('signUpAccount', null, { id, password: PW })
  const tkA = await tok(aId)
  const tkB = await tok(bId)
  await call('joinGame', tkA, { gameId: GAME, name: '먼저온쪽', team: 'A' })
  await call('joinGame', tkB, { gameId: GAME, name: '나중온쪽', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })

  const a = uidOf(aId)
  const b = uidOf(bId)
  const list = await fetch(`${FS}/games/${GAME}/pawns?pageSize=50`, { headers: ADMIN })
  const all = ((await list.json()) as { documents: { name: string }[] }).documents.map((d) => d.name.split('/').pop() as string)
  const [early, late] = all.filter((id) => id !== a && id !== b)
  console.log(`사람 ${all.length} 명 · 봇 둘 ${early.slice(0, 8)} ${late.slice(0, 8)}`)
  check(Number.isFinite(num((await doc(`games/${GAME}/pawns/${a}`)).inSinceMs)), '시작할 때 들어온 시각이 찍힌다')

  // 도서관 — 정원 둘
  const room: TileId = 'library'
  const plan = TILE_BY_ID[room].plan
  const inside: { x: number; y: number }[] = []
  for (let y = plan.y; y < plan.y + plan.h && inside.length < 6; y++) {
    for (let x = plan.x; x < plan.x + plan.w && inside.length < 6; x++) if (roomOfCell(x, y) === room) inside.push({ x, y })
  }

  console.log('\n── 들어온 시각 찍기 ──')
  // a: 문 앞 복도에 서 있다가 방 안으로 한 걸음 — standAt 이 찍는다
  const door = entryCellOf(room)
  await setPawn(a, { tileId: room, postTile: room, at: { x: door.x - 2, y: door.y - 2 }, inSinceMs: 1 })
  check(isHallCell(door.x - 2, door.y - 2) && roomOfCell(door.x - 2, door.y - 2) === null, '복도 칸에서 시작한다')
  await call('standAt', tkA, { gameId: GAME, x: inside[0].x, y: inside[0].y })
  const aIn = num((await doc(`games/${GAME}/pawns/${a}`)).inSinceMs)
  check(aIn > 1, '**복도에서 방 안으로 들어서면 그때가 들어온 시각이다**', String(aIn))
  // a 가 방 안에서 한 칸 움직여도 시각은 그대로다
  await call('standAt', tkA, { gameId: GAME, x: inside[1].x, y: inside[1].y })
  check(num((await doc(`games/${GAME}/pawns/${a}`)).inSinceMs) === aIn, '방 안에서 옮겨 서는 것은 새로 들어온 것이 아니다')

  // b: 이웃 방에서 걸어 들어온다 — roamTo 가 찍는다
  const from = ROAM_TO[room][0]
  const fp = TILE_BY_ID[from].plan
  let fc = { x: fp.x + 1, y: fp.y + 1 }
  for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) if (roomOfCell(x, y) === from) { fc = { x, y }; y = 1e9; break }
  await setPawn(b, { tileId: from, postTile: from, at: fc, inSinceMs: 1 })
  await new Promise((r) => setTimeout(r, 50))
  await call('roamTo', tkB, { gameId: GAME, tileId: room })
  const bIn = num((await doc(`games/${GAME}/pawns/${b}`)).inSinceMs)
  check(bIn > aIn, '**걸어 들어오면 그때가 들어온 시각이다**', `${bIn} > ${aIn}`)

  // 봇 둘: 가장 먼저 · 가장 늦게
  const used = new Set([`${cellOf(await doc(`games/${GAME}/pawns/${a}`)).x},${cellOf(await doc(`games/${GAME}/pawns/${a}`)).y}`, `${cellOf(await doc(`games/${GAME}/pawns/${b}`)).x},${cellOf(await doc(`games/${GAME}/pawns/${b}`)).y}`])
  const free = inside.filter((c) => !used.has(`${c.x},${c.y}`))
  await setPawn(early, { tileId: room, postTile: room, at: free[0], inSinceMs: 1 })
  await setPawn(late, { tileId: room, postTile: room, at: free[1], inSinceMs: 9_000_000_000_000 })

  console.log('\n── 페이즈 열기 ──')
  await call('openPhase', host, { gameId: GAME })
  const where = async (uid: string) => {
    const f = await doc(`games/${GAME}/pawns/${uid}`)
    const c = cellOf(f)
    return { tile: str(f.tileId), inRoom: roomOfCell(c.x, c.y) === room, hall: isHallCell(c.x, c.y) }
  }
  const [wa, wb, we, wl] = await Promise.all([where(a), where(b), where(early), where(late)])
  check(we.inRoom, '가장 먼저 들어온 사람은 남는다')
  check(wa.inRoom, '두 번째로 들어온 사람도 남는다(정원 둘)')
  check(!wl.inRoom && wl.hall && wl.tile === room, '**가장 늦게 들어온 사람은 문 앞 복도로 나온다**', JSON.stringify(wl))
  check(!wb.inRoom && wb.hall && wb.tile === room, '**그다음 늦게 들어온 사람도 나온다**', JSON.stringify(wb))
  const notes = await fetch(`${FS}/games/${GAME}/notices?pageSize=100`, { headers: ADMIN })
  const texts = (((await notes.json()) as { documents?: { fields: Record<string, unknown> }[] }).documents ?? [])
    .filter((d) => str(d.fields.toPlayerId) === b).map((d) => str(d.fields.text) ?? '')
  check(texts.some((t) => t.includes('정원') && t.includes('늦게 들어온')), '나온 사람에게 안내가 간다', texts.join(' / '))
  const notesA = await fetch(`${FS}/games/${GAME}/notices?pageSize=100`, { headers: ADMIN })
  const textsA = (((await notesA.json()) as { documents?: { fields: Record<string, unknown> }[] }).documents ?? [])
    .filter((d) => str(d.fields.toPlayerId) === a).map((d) => str(d.fields.text) ?? '')
  check(!textsA.some((t) => t.includes('정원')), '남은 사람에게는 안내가 안 간다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
