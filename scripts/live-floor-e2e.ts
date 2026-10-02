// 바로 보인다 — 감독관이 문제 종이 · 쪽지를 놓거나 남이 깃발을 꽂으면, 옆에 선 사람의 화면 몫(views)이
// 그 부름이 끝나기 전에 이미 바뀌어 있다. 화면은 views 를 실시간으로 구독하므로 새로고침이 필요 없다
//
//   npx vite-node scripts/live-floor-e2e.ts
import { createHash } from 'node:crypto'
import { TILE_BY_ID, canStandAt, isHallCell, roomOfCell, type TileId } from '../shared/rules/board'
import { entryCellOf, nearestOpenHall } from '../shared/rules/seat'
import { SLIP_NOTES } from '../functions/src/story/slipNotes'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `lf${TAG}`
const PW = 'lfpass1234'
const QA = `qalf${TAG}`
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
  await call('createGame', host, { gameId: GAME, seed: 'lf' })

  const aId = `la${TAG}`
  const bId = `lb${TAG}`
  for (const id of [aId, bId]) await call('signUpAccount', null, { id, password: PW })
  const tkA = await tok(aId)
  const tkB = await tok(bId)
  await call('joinGame', tkA, { gameId: GAME, name: '보는쪽' })
  await call('joinGame', tkB, { gameId: GAME, name: '꽂는쪽' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  const a = uidOf(aId)
  const b = uidOf(bId)

  /** 지금 a 의 화면 몫 — 화면이 구독하는 바로 그 문서 */
  const viewA = async () => {
    const r = await fetch(`${FS}/games/${GAME}/views/${a}`, { headers: ADMIN })
    return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  }
  const cells = (f: Record<string, unknown>, key: string) =>
    ((f[key] as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue?.values ?? []).map((v) => {
      const x = v.mapValue?.fields ?? {}
      return `${num(x.x)},${num(x.y)}`
    })

  const room: TileId = 'storage'
  const plan = TILE_BY_ID[room].plan
  const inside: { x: number; y: number }[] = []
  for (let y = plan.y; y < plan.y + plan.h; y++) for (let x = plan.x; x < plan.x + plan.w; x++) if (roomOfCell(x, y) === room && canStandAt(x, y)) inside.push({ x, y })
  await setPawn(a, { tileId: room, postTile: room, at: inside[0] })
  await setPawn(b, { tileId: room, postTile: room, at: inside[1] })
  await call('roamTo', tkA, { gameId: GAME, tileId: room }).catch(() => undefined)
  const meAt = cellOf(await doc(`games/${GAME}/pawns/${a}`))

  console.log('\n── 방 안: 바로 옆에 문제 종이 ──')
  const spot = inside.find((c) => Math.abs(c.x - meAt.x) + Math.abs(c.y - meAt.y) === 1 && !(c.x === inside[1].x && c.y === inside[1].y)) as { x: number; y: number }
  const before = cells(await viewA(), 'quizzesHere')
  await call('hostDrop', host, { gameId: GAME, kind: 'quiz', x: spot.x, y: spot.y, quiz: { kind: 'short', prompt: '1 더하기 1', answers: ['2'] } })
  const after = cells(await viewA(), 'quizzesHere')
  check(!before.includes(`${spot.x},${spot.y}`) && after.includes(`${spot.x},${spot.y}`), '**놓는 부름이 끝났을 때 이미 옆 사람 화면 몫에 있다**', `${before} → ${after}`)

  console.log('\n── 방 안: 쪽지 뿌리기 ──')
  const note = SLIP_NOTES.find((n) => n.slot === 1) as { id: string }
  const slipsBefore = cells(await viewA(), 'slipPapers').length
  const put = await call('hostScatterSlip', host, { gameId: GAME, noteId: note.id, tileId: room })
  const slipsAfter = cells(await viewA(), 'slipPapers')
  check(slipsAfter.length === slipsBefore + 1 && slipsAfter.includes(`${put.x},${put.y}`), '**뿌린 쪽지가 같은 방 사람 화면 몫에 바로 있다**', JSON.stringify([slipsBefore, slipsAfter, put.x, put.y]))
  await call('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: room, text: '메모 한 장' })
  check(cells(await viewA(), 'slipPapers').length === slipsAfter.length + 1, '**메모도 바로 있다**')

  console.log('\n── 복도: 바로 옆에 문제 종이 ──')
  const door = entryCellOf(room)
  const hall = nearestOpenHall(door, new Set()) as { x: number; y: number }
  await call('standAt', tkA, { gameId: GAME, x: hall.x, y: hall.y })
  const meHall = cellOf(await doc(`games/${GAME}/pawns/${a}`))
  check(isHallCell(meHall.x, meHall.y), '복도에 섰다', JSON.stringify(meHall))
  const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: meHall.x + dx, y: meHall.y + dy })).find((c) => isHallCell(c.x, c.y) && canStandAt(c.x, c.y)) as { x: number; y: number }
  await call('hostDrop', host, { gameId: GAME, kind: 'quiz', x: near.x, y: near.y, quiz: { kind: 'short', prompt: '2 더하기 2', answers: ['4'] } })
  check(cells(await viewA(), 'quizzesHere').includes(`${near.x},${near.y}`), '**복도에서도 바로 옆에 놓은 것이 바로 있다**')

  console.log('\n── 깃발: 같은 방 남이 꽂는다 ──')
  await call('standAt', tkA, { gameId: GAME, x: meAt.x, y: meAt.y })
  await call('openPhase', host, { gameId: GAME })
  // 교시가 열리면 모두 복도로 나온다 — 둘을 방 안에 다시 세운다(들어간 것으로 친다)
  await setPawn(a, { at: meAt })
  await setPawn(b, { at: inside.find((c) => c.x !== meAt.x || c.y !== meAt.y) as { x: number; y: number } })
  await call('tick', tkA, { gameId: GAME })
  const flags = (f: Record<string, unknown>) => JSON.stringify((f.flagCounts as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields?.[room] ?? null)
  const f0 = flags(await viewA())
  await call('phaseAct', tkB, { gameId: GAME, kind: 'plant' })
  const f1 = flags(await viewA())
  check(f0 !== f1 && f1.includes('integerValue'), '**남이 꽂은 깃발이 같은 방 사람 화면 몫에 바로 있다**', `${f0} → ${f1}`)

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
