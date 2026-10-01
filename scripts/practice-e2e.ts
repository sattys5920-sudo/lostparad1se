// 연습 시간 — 판은 돌지만 DAY · 페이즈 · 미션에는 안 들어간다. 「연습 끝 · DAY 1 시작」에서 DAY 1 이 열린다
//
//   npx vite-node scripts/practice-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `pr${TAG}`
const PW = 'prpass1234'
const QA = `qapr${TAG}`
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
/** 자리표에 적힌 팀. 화면 구독이 이것을 본다. */
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
  // 감독관은 이메일 계정에 admin 표시를 붙여 들어온다 — 사용자 지정 토큰은 표시를 안 싣는다
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
  await call('createGame', host, { gameId: GAME, seed: 'pr' })

  // 사람 둘을 서로 다른 팀에 앉힌다. 나머지는 봇으로 채운다
  const aId = `pa${TAG}`
  const bId = `pb${TAG}`
  for (const id of [aId, bId]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(aId), { gameId: GAME, name: '부르는쪽', team: 'A' })
  await call('joinGame', await tok(bId), { gameId: GAME, name: '넘어갈쪽', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START, practice: true })

  const a = uidOf(aId)
  const b = uidOf(bId)
  // 실재하는 방이라야 한다. 없는 칸에 세우면 서버가 보는 값과 어긋난다
  const room = 'storage'
  // 같은 방 **바로 옆 칸**에 세운다. 같은 방만으로는 모자라다
  await patch(`games/${GAME}/pawns/${a}`, { tileId: room, postTile: room })
  await patch(`games/${GAME}/pawns/${b}`, { tileId: room, postTile: room })
  // **칸은 판에서 뽑는다.** 방 좌표는 층을 이어 붙인 전역 값이다
  const plan = TILE_BY_ID[room].plan
  for (const [who, cell] of [
    [a, { x: plan.x + 1, y: plan.y + 1 }],
    [b, { x: plan.x + 2, y: plan.y + 1 }],
  ] as const) {
    await fetch(`${FS}/games/${GAME}/pawns/${who}?updateMask.fieldPaths=at`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({
        fields: { at: { mapValue: { fields: { x: { integerValue: String(cell.x) }, y: { integerValue: String(cell.y) } } } } },
      }),
    })
  }

  const num = (v: unknown) => Number((v as { integerValue?: string })?.integerValue ?? NaN)
  const tkA = await tok(aId)

  console.log('\n── 연습 시간 ──')
  check(JSON.stringify((await doc(`games/${GAME}`)).practice ?? null).includes('true'), '판이 연습으로 섰다')
  check((await no(call('openPhase', host, { gameId: GAME }))).includes('연습'), '페이즈는 못 연다')
  check((await no(call('pushDay', host, { gameId: GAME }))).includes('연습'), '날을 못 넘긴다')
  check((await no(call('hostOpenBallot', host, { gameId: GAME }))).includes('연습'), '투표를 못 연다')
  check((await no(call('castVote', tkA, { gameId: GAME, targetId: b, kind: 'trust' }))).includes('연습'), '신뢰·호감표를 못 준다')
  const paper = await call('myPaper', tkA, { gameId: GAME })
  check(paper.counting === false && paper.practice === true, '「나」 탭 미션은 아직 안 센다', JSON.stringify([paper.counting, paper.practice]))

  // 연습 동안 번 돈 — 그대로 가야 한다
  await fetch(`${FS}/games/${GAME}/pawns/${a}?updateMask.fieldPaths=money`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { money: { integerValue: '7' } } }),
  })

  console.log('\n── 연습 끝 · DAY 1 시작 ──')
  const day1 = START + 2 * 60 * 60_000
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: day1, speed: 1 })
  check((await no(call('hostEndPractice', tkA, { gameId: GAME }))) !== '', '플레이어는 못 누른다')
  const ended = await call('hostEndPractice', host, { gameId: GAME })
  const g = await doc(`games/${GAME}`)
  check(!(String(JSON.stringify(g.practice)).includes('true')), '연습이 끝났다')
  check(num(g.startedAtMs) >= day1 && Number(ended.startedAtMs) >= day1, '**누른 순간이 DAY 1 의 시작이 된다**', `${num(g.startedAtMs)} vs ${day1}`)
  check(num((await doc(`games/${GAME}`)).day) === 1, '날은 DAY 1 그대로다')
  check(num((await doc(`games/${GAME}/pawns/${a}`)).money) === 7, '**연습 동안 번 돈은 그대로 간다**')
  const paper2 = await call('myPaper', tkA, { gameId: GAME })
  check(paper2.counting === true, '이제 미션을 센다')
  check((await no(call('openPhase', host, { gameId: GAME }))) === '', '이제 페이즈가 열린다')
  check((await no(call('hostEndPractice', host, { gameId: GAME }))).includes('연습 중인 판이 아니다'), '두 번은 못 누른다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
