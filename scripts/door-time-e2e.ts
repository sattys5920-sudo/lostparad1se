// 점령전 중 드나드는 시간 — 들어서기 5분 · 나서기 5분.
//
//   1. 방에서 복도로 나서면 5분 묶인다(방에서 나가는 중)
//   2. 묶여 있는 동안은 다른 방으로 못 간다
//   3. 복도에서 방으로 들어서면 5분 걷는다
//   4. 방 안에서 곧장 다른 방으로 가면 10분(나서기 + 들어서기)
//
//   npx vite-node scripts/door-time-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID, isHallCell, roomOfCell, type TileId } from '../shared/rules/board'
import { standAndSpot } from './lib/spot'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FROM: TileId = 'library'
const TO: TileId = 'artRoom'

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false as const, err: j.error.message, result: {} as Record<string, unknown> } : { ok: true as const, err: '', result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown) {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result
}
async function hostToken(tag: string): Promise<string> {
  const email = `door-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}
async function tokenOf(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })
  return ((await r.json()) as { idToken: string }).idToken
}
const int = (n: number) => ({ integerValue: String(n) })
const str = (s: string | null) => (s === null ? { nullValue: null } : { stringValue: s })
async function patch(path: string, fields: Record<string, unknown>) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
}
async function pawnOf(game: string, uid: string): Promise<Record<string, { integerValue?: string; stringValue?: string; nullValue?: null }>> {
  return ((await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN }).then((r) => r.json())) as { fields: Record<string, never> }).fields
}
const num = (v: { integerValue?: string; doubleValue?: number } | undefined) => Number(v?.integerValue ?? v?.doubleValue ?? NaN)

/** 방 바로 바깥의 복도 칸 */
function hallBeside(tile: TileId) {
  const r = TILE_BY_ID[tile].plan
  for (let d = 1; d <= 6; d++)
    for (let y = r.y - d; y <= r.y + r.h - 1 + d; y++)
      for (let x = r.x - d; x <= r.x + r.w - 1 + d; x++) if (roomOfCell(x, y) === null && isHallCell(x, y)) return { x, y }
  throw new Error('복도 칸이 없다')
}

async function main() {
  const game = `dt${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'dt' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  const t0 = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: game, anchorGameMs: t0, speed: 1 })
  const me = uidOf('qa01')
  const tok = await tokenOf(host, 'qa01')
  const inRoom = standAndSpot(FROM).stand
  const put = async () =>
    patch(`games/${game}/pawns/${me}`, {
      tileId: str(FROM), postTile: str(FROM), toTile: str(null), arriveAtMs: str(null),
      at: { mapValue: { fields: { x: int(inRoom.x), y: int(inRoom.y) } } },
      busyUntilMs: str(null), busyKind: str(null),
    })
  // 교시가 열리면 모두 복도로 나온다 — 연 다음에 방 안에 다시 세운다
  await must('openPhase', host, { gameId: game })
  await put()
  console.log(`판 ${game}`)

  console.log('\n── 방에서 복도로 나서기 ──')
  const hall = hallBeside(FROM)
  const out = await must('standAt', tok, { gameId: game, x: hall.x, y: hall.y })
  const p1 = await pawnOf(game, me)
  const clock1 = Number((await must('clockNow', tok, { gameId: game })).nowMs)
  const busyFor = (num(p1.busyUntilMs) - (Number.isFinite(clock1) ? clock1 : t0)) / 60_000
  check(p1.busyKind?.stringValue === '방에서 나가는', '나서면 「방에서 나가는 중」으로 묶인다', String(p1.busyKind?.stringValue))
  check(Math.round(busyFor) === 5, '묶이는 시간은 5 분', `${busyFor.toFixed(2)} 분 · ${JSON.stringify(out)}`)
  const early = await call('phaseAct', tok, { gameId: game, kind: 'move', targetTile: TO })
  check(!early.ok && early.err.includes('나가는 중'), '나가는 동안은 다른 방으로 못 간다', early.err)

  console.log('\n── 복도에서 방으로 들어서기 ──')
  await patch(`games/${game}/pawns/${me}`, { busyUntilMs: str(null), busyKind: str(null) })
  const went = await must('phaseAct', tok, { gameId: game, kind: 'move', targetTile: TO })
  check(went.minutes === 5, '복도에서 들어서면 5 분', JSON.stringify(went))

  console.log('\n── 방 안에서 곧장 다른 방으로 ──')
  await put()
  const direct = await must('phaseAct', tok, { gameId: game, kind: 'move', targetTile: TO })
  check(direct.minutes === 10, '방 안에서 곧장 가면 10 분(나서기 + 들어서기)', JSON.stringify(direct))

  console.log('\n── 호루라기 호출 ──')
  // 같은 분단 한 명을 불러온다 — 불린 사람도 부른 사람도 5분
  await put()
  const pawns = ((await fetch(`${FS}/games/${game}/pawns?pageSize=50`, { headers: ADMIN }).then((r) => r.json())) as { documents: { name: string; fields: Record<string, { stringValue?: string }> }[] }).documents
  const myTeam = pawns.find((d) => d.name.endsWith(me))?.fields.team?.stringValue
  const mate = pawns.find((d) => !d.name.endsWith(me) && d.fields.team?.stringValue === myTeam)
  const mateId = mate?.name.split('/').pop() as string
  await patch(`games/${game}/pawns/${mateId}`, { tileId: str(TO), postTile: str(TO), busyUntilMs: str(null), busyKind: str(null), at: { mapValue: { fields: { x: int(standAndSpot(TO).stand.x), y: int(standAndSpot(TO).stand.y) } } } })
  await patch(`games/${game}/pawns/${me}`, { items: { mapValue: { fields: { whistle: int(1) } } } })
  const called = await call('phaseAct', tok, { gameId: game, kind: 'summon', targetPlayer: mateId })
  const mp = await pawnOf(game, mateId)
  const pm = await pawnOf(game, me)
  const clock2 = Number((await must('clockNow', tok, { gameId: game })).nowMs)
  const arrive = (num(mp.arriveAtMs) - clock2) / 60_000
  const held = (num(pm.busyUntilMs) - clock2) / 60_000
  check(called.ok && Math.round(arrive) === 5, '불린 사람은 5 분 뒤에 닿는다', `${called.err} ${arrive.toFixed(2)} 분`)
  check(Math.round(held) === 5, '부른 사람도 5 분 묶인다', `${held.toFixed(2)} 분`)

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
