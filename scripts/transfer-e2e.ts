// 이적을 진짜 서버로 본다.
//
// 자유 시간에 마주 서서 꺼내고, 불린 쪽이 답하고, **다음 페이즈가
// 열릴 때** 발효된다. 보는 것은 세 가지다 —
//   ㆍ 날·페이즈·거리·같은 팀의 막음이 제대로 서는가
//   ㆍ 수락해도 종이 칠 때까지는 아직 옛 팀인가
//   ㆍ 발효될 때 팀 값 **세 군데**(자리표·말·명단)가 같이 옮겨지는가
//
//   npx vite-node scripts/transfer-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'
import { TRANSFER_NO } from '../shared/rules/transfer'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `tr${TAG}`
const PW = 'trpass1234'
const QA = `qatr${TAG}`
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
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }]),
      ),
    }),
  })
}
/** 자리표에 적힌 팀. 팀장 교대와 화면 구독이 이것을 본다. */
async function seatTeam(who: string): Promise<string | null> {
  const f = await doc(`games/${GAME}`)
  const rows = (f.seats as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })
    ?.arrayValue?.values ?? []
  for (const row of rows) {
    const x = row.mapValue?.fields ?? {}
    if (str(x.playerId) === who) return str(x.team)
  }
  return null
}

async function main(): Promise<void> {
  const he = `th${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'tr' })

  // 사람 둘을 서로 다른 팀에 앉힌다. 나머지는 봇으로 채운다
  const aId = `ta${TAG}`
  const bId = `tb${TAG}`
  for (const id of [aId, bId]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(aId), { gameId: GAME, name: '부르는쪽', team: 'A' })
  await call('joinGame', await tok(bId), { gameId: GAME, name: '넘어갈쪽', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })

  const a = uidOf(aId)
  const b = uidOf(bId)
  const room = 'class2_3'
  // 같은 방 **바로 옆 칸**에 세운다. 같은 방만으로는 모자라다
  await patch(`games/${GAME}/pawns/${a}`, { tileId: room, postTile: room })
  await patch(`games/${GAME}/pawns/${b}`, { tileId: room, postTile: room })
  for (const [who, cell] of [[a, { x: 4, y: 4 }], [b, { x: 5, y: 4 }]] as const) {
    await fetch(`${FS}/games/${GAME}/pawns/${who}?updateMask.fieldPaths=at`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({
        fields: { at: { mapValue: { fields: { x: { integerValue: String(cell.x) }, y: { integerValue: String(cell.y) } } } } },
      }),
    })
  }

  console.log('\n── DAY 1 — 아직 못 꺼낸다 ──')
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })
  const tkA = await tok(aId)
  const tkB = await tok(bId)
  check(
    (await no(call('askTransfer', tkA, { gameId: GAME, toPlayerId: b }))).includes(TRANSFER_NO.early),
    '첫날에는 거절한다',
    await no(call('askTransfer', tkA, { gameId: GAME, toPlayerId: b })),
  )

  console.log('\n── DAY 2 자유 시간 ──')
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 2, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })

  check(
    (await no(call('askTransfer', tkA, { gameId: GAME, toPlayerId: a }))).includes(TRANSFER_NO.self),
    '나에게는 못 꺼낸다',
  )
  // 같은 팀 봇 하나를 찾아 꺼내 본다
  const pawns = await fetch(`${FS}/games/${GAME}/pawns`, { headers: ADMIN })
  const all = ((await pawns.json()) as { documents?: { name: string; fields: Record<string, unknown> }[] }).documents ?? []
  const mate = all.find((d) => str(d.fields.team) === 'A' && !d.name.endsWith(a))
  check(
    (await no(call('askTransfer', tkA, { gameId: GAME, toPlayerId: mate!.name.split('/').pop()! })))
      .includes(TRANSFER_NO.sameTeam),
    '같은 팀에게는 못 꺼낸다',
  )

  const ask = await call('askTransfer', tkA, { gameId: GAME, toPlayerId: b })
  check(typeof ask.id === 'string', '마주 서면 꺼낼 수 있다')
  check(
    (await no(call('answerTransfer', tkA, { gameId: GAME, askId: ask.id, accept: true })))
      .includes('불린 사람만'),
    '부른 쪽은 제 제안에 답하지 못한다',
  )

  const said = await call('answerTransfer', tkB, { gameId: GAME, askId: ask.id, accept: true })
  check(said.moved === true && said.team === 'A', '불린 쪽이 수락한다', String(said.said ?? ''))

  console.log('\n── 수락한 뒤, 아직 종이 치기 전 ──')
  check(str((await doc(`games/${GAME}/pawns/${b}`)).team) === 'B', '말은 아직 B팀이다')
  check(str((await doc(`games/${GAME}/pawns/${b}`)).movingTo) === 'A', '옮기기로 한 것만 적혀 있다')
  check((await seatTeam(b)) === 'B', '자리표도 아직 B팀이다')
  check(
    str((await doc(`games/${GAME}/secret/roster/items/${b}`)).team) === 'B',
    '명단도 아직 B팀이다',
  )
  check(
    (await no(call('askTransfer', tkA, { gameId: GAME, toPlayerId: b }))).includes(TRANSFER_NO.pending),
    '이미 옮기기로 한 사람에게는 또 못 꺼낸다',
  )

  console.log('\n── 종이 친다 — 여기서 발효된다 ──')
  await call('openPhase', host, { gameId: GAME })
  check(str((await doc(`games/${GAME}/pawns/${b}`)).team) === 'A', '말이 A팀으로 옮겨졌다')
  const after = (await doc(`games/${GAME}/pawns/${b}`)).movingTo
  check(
    after === undefined || (after as { nullValue?: unknown }).nullValue !== undefined,
    '옮기기로 한 표시가 지워졌다 — 남으면 다음 페이즈에 또 옮긴다',
    JSON.stringify(after),
  )
  check((await seatTeam(b)) === 'A', '자리표가 A팀으로 옮겨졌다')
  check(
    str((await doc(`games/${GAME}/secret/roster/items/${b}`)).team) === 'A',
    '명단이 A팀으로 옮겨졌다 — 안개와 미션 채점이 이것을 본다',
  )

  console.log('\n── 페이즈 중에는 못 꺼낸다 ──')
  check(
    (await no(call('askTransfer', tkB, { gameId: GAME, toPlayerId: a }))).includes(TRANSFER_NO.phase),
    '점령전 중에는 거절한다',
  )

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
