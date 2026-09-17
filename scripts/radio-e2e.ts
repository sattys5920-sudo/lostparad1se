// 무전이 팀 밖으로 안 나가는가. 진짜 서버로 본다.
//
//   ㆍ 같은 팀에게는 닿고, 남의 팀에게는 한 줄도 안 간다
//   ㆍ 걷는 중에도 보낸다 — 방에 매이지 않는 유일한 말이다
//   ㆍ 지워진 사람의 무전은 **같은 팀에게도** 안 간다
//   ㆍ 이적한 사람은 옮긴 뒤로 새 팀 무전을 듣는다
//
//   npx vite-node scripts/radio-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `rd${TAG}`
const PW = 'rdpass1234'
const QA = `qard${TAG}`
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
type Line = { playerId: string; text: string; muted?: boolean }
const heard = async (tk: string): Promise<Line[]> =>
  ((await call('radioLines', tk, { gameId: GAME })) as { lines?: Line[] }).lines ?? []
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }])),
    }),
  })
}

async function main(): Promise<void> {
  const he = `rh${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'rd' })

  // A팀 둘, B팀 하나
  const a1 = `ra${TAG}`
  const a2 = `rb${TAG}`
  const b1 = `rc${TAG}`
  for (const id of [a1, a2, b1]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(a1), { gameId: GAME, name: 'A하나', team: 'A' })
  await call('joinGame', await tok(a2), { gameId: GAME, name: 'A둘', team: 'A' })
  await call('joinGame', await tok(b1), { gameId: GAME, name: 'B하나', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 2, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })

  const tk1 = await tok(a1)
  const tk2 = await tok(a2)
  const tkB = await tok(b1)

  console.log('\n── 팀 안에서만 돈다 ──')
  await call('radio', tk1, { gameId: GAME, text: '운동장으로 모여' })
  const mate = await heard(tk2)
  check(mate.some((l) => l.text === '운동장으로 모여'), '같은 팀에게 닿는다')
  const other = await heard(tkB)
  check(!other.some((l) => l.text === '운동장으로 모여'), '남의 팀에게는 한 줄도 안 간다', `${other.length}줄`)

  console.log('\n── 걷는 중에도 된다 ──')
  // 방에 매이지 않는 유일한 말이다. 말(say)은 걷는 중에 거절당한다
  await patch(`games/${GAME}/pawns/${uidOf(a1)}`, { tileId: '' })
  await fetch(`${FS}/games/${GAME}/pawns/${uidOf(a1)}?updateMask.fieldPaths=tileId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { nullValue: null } } }),
  })
  const walking = await call('radio', tk1, { gameId: GAME, text: '가는 중' })
  check(walking.said === true, '걷는 중에도 보낸다')
  const said = await call('say', tk1, { gameId: GAME, text: '가는 중' }).then(() => '', (e: Error) => e.message)
  check(said.includes('걷는 중'), '말은 걷는 중에 거절된다 — 둘이 다른 줄이다', said)

  console.log('\n── 지워진 사람의 무전은 같은 팀에게도 안 간다 ──')
  await patch(`games/${GAME}`, { invisibleId: uidOf(a1), invisibleTeam: 'A' })
  await call('radio', tk1, { gameId: GAME, text: '나 여기 있어' })
  const mate2 = await heard(tk2)
  check(!mate2.some((l) => l.text === '나 여기 있어'), '같은 팀도 못 듣는다')
  const own = await heard(tk1)
  const line = own.find((l) => l.text === '나 여기 있어')
  check(line !== undefined && line.muted === true, '본인에게는 「전해지지 않았다」로 남는다')

  console.log('\n── 이적하면 새 팀 무전을 듣는다 ──')
  await patch(`games/${GAME}`, { invisibleId: '' })
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=invisibleId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { invisibleId: { nullValue: null } } }),
  })
  // 이적이 실제로 발효될 때 openPhase 가 team 과 teamSinceMs 를 **같이**
  // 쓴다(transfer-e2e 가 그것을 본다). 여기서는 무전만 보므로 그 결과를
  // 그대로 만들어 놓고 시작한다
  const movedAtMs = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? Date.now())
  await fetch(`${FS}/games/${GAME}/pawns/${uidOf(b1)}?updateMask.fieldPaths=team&updateMask.fieldPaths=teamSinceMs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { team: { stringValue: 'A' }, teamSinceMs: { integerValue: String(movedAtMs) } },
    }),
  })
  await call('radio', tk2, { gameId: GAME, text: '어서 와' })
  const moved = await heard(tkB)
  check(moved.some((l) => l.text === '어서 와'), 'A팀으로 옮기면 A팀 무전이 들린다')
  check(
    !moved.some((l) => l.text === '운동장으로 모여'),
    '옮기기 전 줄은 안 따라온다 — 팀이 된 시각부터 듣는다',
    '옛 줄이 딸려 왔다',
  )

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
