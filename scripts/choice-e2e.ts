// DAY 3 중요한 사람 · DAY 4 선택을 진짜 서버로.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/choice-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { CHOSEN_ONE_DAY, DAY4_CHOICE_DAY } from '../shared/rules/choices'
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
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function getDoc<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return r.ok ? (plain(await r.json()) as T) : null
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

const GAME = `cho${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'cho' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  const tick = (tk: string) => must('tick', tk, { gameId: GAME })
  const view = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as { myChoice: { chosenId: string | null; day4: string | null } | null }
  const [a, b, c] = people
  check(true, '판이 시작했다')

  console.log('\n── DAY 3 전에는 못 고른다 ──')
  await clock(dayHourMs(START, 1, 10))
  const early = await call('chooseImportant', a.token, { gameId: GAME, targetId: b.uid })
  check(early.code === 'FAILED_PRECONDITION', `DAY 1에는 못 고른다`, early.message)

  console.log(`\n── DAY ${CHOSEN_ONE_DAY} ──`)
  await clock(dayHourMs(START, CHOSEN_ONE_DAY, 10))
  await tick(a.token)
  check((await call('chooseImportant', a.token, { gameId: GAME, targetId: a.uid })).message === '자기 자신은 못 고른다.', '자기 자신은 못 고른다')
  check((await call('chooseImportant', a.token, { gameId: GAME, targetId: '없는사람' })).message === '그런 사람이 없다.', '명단에 없는 사람도 못 고른다')

  await must('chooseImportant', a.token, { gameId: GAME, targetId: b.uid })
  check((await view(a.uid)).myChoice?.chosenId === b.uid, '골랐다')
  // 그날 하루는 몇 번이든 바꿀 수 있다
  await must('chooseImportant', a.token, { gameId: GAME, targetId: c.uid })
  check((await view(a.uid)).myChoice?.chosenId === c.uid, '같은 날에는 바꿀 수 있다')
  await must('chooseImportant', a.token, { gameId: GAME, targetId: b.uid })

  console.log('\n── 남에게 보이는가 ──')
  check((await view(b.uid)).myChoice === null, '고르지 않은 사람은 비어 있다')
  let leaks = 0
  for (const p of people) {
    if (p.uid === a.uid) continue
    if (JSON.stringify(await getDoc(`games/${GAME}/views/${p.uid}`)).includes('"chosenId"')) leaks += 1
  }
  check(leaks === 0, '누가 나를 골랐는지 아무도 모른다', `${leaks}건`)
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/choices/items`, { headers: { Authorization: `Bearer ${b.token}` } })
  check(asPlayer.status === 403, '규칙도 막는다', String(asPlayer.status))

  console.log(`\n── DAY ${DAY4_CHOICE_DAY} ──`)
  check((await call('chooseDay4', a.token, { gameId: GAME, choice: 'team' })).code === 'FAILED_PRECONDITION', `DAY ${CHOSEN_ONE_DAY}에는 DAY 4 선택을 못 한다`)
  await clock(dayHourMs(START, DAY4_CHOICE_DAY, 10))
  await tick(a.token)
  // 날짜 검사가 잠금까지 한다
  const locked = await call('chooseImportant', a.token, { gameId: GAME, targetId: c.uid })
  check(locked.message === `중요한 사람은 DAY ${CHOSEN_ONE_DAY}에 고른다.`, '날이 지나면 그대로 잠긴다', locked.message)
  check((await view(a.uid)).myChoice?.chosenId === b.uid, '고른 것은 그대로다')

  check((await call('chooseDay4', a.token, { gameId: GAME, choice: '몰라' })).code === 'INVALID_ARGUMENT', '없는 선택은 거절')
  await must('chooseDay4', a.token, { gameId: GAME, choice: 'bond' })
  check((await view(a.uid)).myChoice?.day4 === 'bond', 'DAY 4 선택이 담겼다')
  await must('chooseDay4', a.token, { gameId: GAME, choice: 'team' })
  check((await view(a.uid)).myChoice?.day4 === 'team', '같은 날에는 바꿀 수 있다')

  console.log('\n── 종례 ──')
  // b도 a를 고르게 만들 수는 없다(DAY 3이 지났다). a만 고른 채로 끝낸다
  await clock(dayHourMs(START, 5, 25))
  await tick(a.token)
  const closing = (await getDoc(`games/${GAME}/secret/closing`)) as {
    together: Record<string, boolean>
    mutual: Record<string, boolean>
    chosenBy: Record<string, string | null>
  }
  check(Boolean(closing), '종례 순간이 굳었다')
  check(closing.chosenBy[a.uid] === b.uid, '고른 것이 남았다')
  check(closing.mutual[a.uid] === false, 'b는 a를 안 골랐으니 마주 본 것이 아니다')
  // 둘 다 기지에 서 있으니 같은 칸이다
  check(closing.together[a.uid] === true, '같은 칸에 있었다', String(closing.together[a.uid]))
  check(closing.together[c.uid] === false, '안 고른 사람은 함께가 아니다')

  const day4Locked = await call('chooseDay4', a.token, { gameId: GAME, choice: 'self' })
  check(!day4Locked.ok, '끝난 뒤에는 못 고친다', day4Locked.message)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
