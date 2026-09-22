// 「판을 첫날로 되돌리기」를 **진짜 서버로** 확인한다.
//
// 끝까지 간 판을 되돌려서, 자리는 남고 나머지는 다 지워졌는지 본다.
// 그러고 다시 시작해 DAY 1 부터 도는지까지 본다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/reset-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
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

async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
}
async function token(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
async function call(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}
async function count(path: string): Promise<number> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: unknown[] }
  return (j.documents ?? []).length
}
async function doc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? null
}
const str = (v: unknown) => ((v ?? {}) as { stringValue?: string }).stringValue ?? ''
const num = (v: unknown) => Number(((v ?? {}) as { integerValue?: string }).integerValue ?? 0)

const GAME = `reset${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await token(he)

  const want: TeamId[] = []
  for (const t of ['A', 'B', 'C', 'D'] as TeamId[]) {
    for (let i = 0; i < STARTING_TEAM_SIZES[t]; i++) want.push(t)
  }
  await call('createGame', host, { gameId: GAME, seed: 'reset' })
  const seats: string[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const e = await signUp(`p${i}-${GAME}@x.test`)
    seats.push(await token(e))
    await call('joinGame', seats[i], { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 12), speed: 1 })

  console.log('\n── 끝까지 민다 ──')
  for (let i = 0; i < 12; i++) {
    const h = await call('pushDay', host, { gameId: GAME })
    if (h.pushed === null) break
  }
  let g = await doc(`games/${GAME}`)
  check(str(g?.phase) === 'finished', '판이 끝났다', str(g?.phase))
  const pawnsBefore = await count(`games/${GAME}/pawns`)
  const eventsBefore = await count(`games/${GAME}/events`)
  check(pawnsBefore === TOTAL_SEATS, `말 ${TOTAL_SEATS}개가 있다`, `${pawnsBefore}개`)
  check(eventsBefore > 0, '기록이 쌓여 있다', `${eventsBefore}건`)

  console.log('\n── 되돌린다 ──')
  // 운영자가 아니면 못 한다. 화면이 하는 말을 믿지 않는다
  const denied = await call('resetGame', seats[0], { gameId: GAME }).then(
    () => '',
    (e: Error) => e.message,
  )
  check(denied.includes('PERMISSION_DENIED'), '운영자가 아니면 거절한다', denied)

  const out = await call('resetGame', host, { gameId: GAME })
  check(out.seats === TOTAL_SEATS, '앉은 열넷을 그대로 들고 왔다', String(out.seats))

  g = await doc(`games/${GAME}`)
  check(str(g?.phase) === 'lobby', '로비로 돌아왔다', str(g?.phase))
  check(num(g?.day) === 0, '날짜가 0으로 돌아왔다', String(num(g?.day)))
  const seatVals = ((g?.seats ?? {}) as { arrayValue?: { values?: unknown[] } }).arrayValue?.values ?? []
  check(seatVals.length === TOTAL_SEATS, '자리 열넷이 남았다', `${seatVals.length}자리`)

  for (const sub of ['pawns', 'tiles', 'teams', 'schedule', 'events', 'views']) {
    const n = await count(`games/${GAME}/${sub}`)
    check(n === 0, `${sub} 가 비었다`, `${n}개`)
  }
  // 비밀 문서도 같이 지워진다. 남으면 지난 판의 역할이 새 판에 붙는다
  check((await count(`games/${GAME}/secret/roster/items`)) === 0, '지난 판의 역할이 안 남았다')
  check((await count(`games/${GAME}/secret/tokens/items`)) === 0, '지난 판의 토큰 상자가 안 남았다')

  console.log('\n── 다시 시작한다 ──')
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  g = await doc(`games/${GAME}`)
  check(str(g?.phase) === 'running', '다시 돈다', str(g?.phase))
  check(num(g?.day) === 1, 'DAY 1 부터다', String(num(g?.day)))
  check((await count(`games/${GAME}/pawns`)) === TOTAL_SEATS, '말 열넷이 다시 섰다')
  check((await count(`games/${GAME}/schedule`)) === 11, '달력 열한 칸이 새로 깔렸다', `${await count(`games/${GAME}/schedule`)}칸`)

  const peek = (await call('peekDay', host, { gameId: GAME })).next as { kind: string; day: number } | null
  check(peek?.kind === 'settlement' && peek.day === 1, '다음에 넘길 것은 DAY 1 정산이다', `${peek?.kind} ${peek?.day}`)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
