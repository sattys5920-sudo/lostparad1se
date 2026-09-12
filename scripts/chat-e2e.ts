// 말을 진짜 서버로.
//
// 확인할 것은 셋이다.
//
//   팀 방이 팀 밖으로 나가지 않는가
//   지워진 사람의 전체 채팅이 **원문째로** 안 나가는가 — 화면에서
//     가리는 것으로는 부족하다. 개발자도구로 다 보인다
//   그 원문이 종례 뒤에 정확히 돌아오는가
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/chat-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { meetAt } from './meet'
import { CHAT_MAX_LEN, INVISIBLE_CHAT_MASK } from '../shared/rules/v2'

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

interface Line { room: string; playerId: string; name: string; text: string; muted: boolean; atMs: number }
const linesOf = async (tk: string): Promise<Line[]> =>
  ((await must('chatLines', tk, { gameId: GAME, sinceMs: 0 })) as { lines: Line[] }).lines

const GAME = `chat${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

// 새는지 보려면 흔하지 않은 글자여야 한다. 「안녕」으로 찾으면
// 어디에나 있어서 아무것도 못 잡는다
const CLASS_SAID = `전체에게한말${GAME}`
const TEAM_SAID = `팀에게만한말${GAME}`
const GHOST_SAID = `아무도듣지않은말${GAME}`
const GHOST_TEAM = `지워진채로팀에게${GAME}`

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'chat' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 10))
  check(true, '판이 시작했다')

  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')

  console.log('\n── 못 치는 말 ──')
  check((await call('say', A[0].token, { gameId: GAME, room: 'class', text: '   ' })).code === 'INVALID_ARGUMENT', '빈 줄은 거절')
  check((await call('say', A[0].token, { gameId: GAME, room: 'class', text: '가'.repeat(CHAT_MAX_LEN + 1) })).code === 'INVALID_ARGUMENT', `${CHAT_MAX_LEN}자를 넘기면 거절`)
  const outsider = await auth(await signUp(`out-${GAME}@x.test`))
  check((await call('say', outsider.token, { gameId: GAME, room: 'class', text: '끼어든다' })).ok === false, '판에 없는 사람은 못 친다')

  console.log('\n── 전체 방 ──')
  await must('say', A[0].token, { gameId: GAME, room: 'class', text: CLASS_SAID })
  let heardBy = 0
  for (const p of people) if ((await linesOf(p.token)).some((l) => l.text === CLASS_SAID)) heardBy += 1
  check(heardBy === TOTAL_SEATS, '열넷 모두에게 들린다', `${heardBy}명`)

  console.log('\n── 팀 방 ──')
  await must('say', A[0].token, { gameId: GAME, room: 'team', text: TEAM_SAID })
  const mates = await linesOf(A[1].token)
  check(mates.some((l) => l.text === TEAM_SAID && l.room === 'team'), '팀원에게는 그대로 간다')
  let outLeaks = 0
  for (const p of [...B, ...C]) if (JSON.stringify(await linesOf(p.token)).includes(TEAM_SAID)) outLeaks += 1
  check(outLeaks === 0, '다른 팀 열에게는 한 글자도 안 간다', `${outLeaks}명`)

  console.log('\n── 지워진 하루 ──')
  // 표는 그 자리에서 만나야 준다. 복도에 모은다
  await meetAt(must, GAME, 'hallway', people, (ms) => clock(ms), dayHourMs(START, 1, 16))
  // C[0]이 의심표를 받아 내일 지워지게 한다
  await must('castVote', A[0].token, { gameId: GAME, targetId: C[0].uid, kind: 'suspicion' })
  await must('castVote', A[1].token, { gameId: GAME, targetId: C[0].uid, kind: 'suspicion' })
  await clock(dayHourMs(START, 1, 21))
  await must('tick', A[0].token, { gameId: GAME })
  await clock(dayHourMs(START, 2, 9))
  await must('tick', A[0].token, { gameId: GAME })
  const g = (await getDoc(`games/${GAME}`)) as { invisibleId: string }
  check(g.invisibleId === C[0].uid, '아침에 지워졌다')

  const said = await must('say', C[0].token, { gameId: GAME, room: 'class', text: GHOST_SAID })
  check(said.heard === false, '친 사람에게 「들리지 않았다」고 알려 준다')

  const mine = await linesOf(C[0].token)
  check(mine.some((l) => l.text === GHOST_SAID && l.muted), '본인 화면에만 원문이 남는다')

  let ghostLeaks = 0
  let maskedFor = 0
  for (const p of people) {
    if (p.uid === C[0].uid) continue
    const ls = await linesOf(p.token)
    if (JSON.stringify(ls).includes(GHOST_SAID)) ghostLeaks += 1
    if (ls.some((l) => l.playerId === C[0].uid && l.text === INVISIBLE_CHAT_MASK && l.muted)) maskedFor += 1
  }
  check(ghostLeaks === 0, '남에게는 원문이 한 글자도 안 간다', `${ghostLeaks}명`)
  // 반대쪽도 본다 — 줄 자체가 안 갔으면 위 검사는 아무것도 안 보고 통과한다
  check(maskedFor === TOTAL_SEATS - 1, `열셋에게 「${INVISIBLE_CHAT_MASK}」로 간다`, `${maskedFor}명`)

  // 팀 방은 다르다. 지워져도 팀에게는 들린다
  await must('say', C[0].token, { gameId: GAME, room: 'team', text: GHOST_TEAM })
  check((await linesOf(C[1].token)).some((l) => l.text === GHOST_TEAM), '팀 방은 지워져도 팀원에게 들린다')

  console.log('\n── 원문은 어디에 있는가 ──')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/chat/items`, { headers: { Authorization: `Bearer ${A[0].token}` } })
  check(asPlayer.status === 403, '플레이어는 채팅 원문을 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/chat/items`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 못 읽는다', String(asHost.status))
  let viewLeaks = 0
  for (const p of people) {
    const v = JSON.stringify(await getDoc(`games/${GAME}/views/${p.uid}`))
    if (v.includes(GHOST_SAID) || v.includes(TEAM_SAID) || v.includes(CLASS_SAID)) viewLeaks += 1
  }
  check(viewLeaks === 0, '각자 몫에는 채팅이 아예 없다', `${viewLeaks}건`)

  console.log('\n── 종례 뒤 되돌아오는가 ──')
  const early = await call('endingData', C[0].token, { gameId: GAME })
  check(early.code === 'FAILED_PRECONDITION', '닷새가 끝나기 전에는 안 돌려준다')
  check(!JSON.stringify(early).includes(GHOST_SAID), '거절 응답에도 원문이 없다')

  await clock(dayHourMs(START, 5, 25))
  await must('tick', A[0].token, { gameId: GAME })
  const d = (await must('endingData', B[0].token, { gameId: GAME })) as { unheard: { name: string; day: number; text: string }[] }
  check(d.unheard.some((u) => u.text === GHOST_SAID), '「들리지 않았던 말」에 원문으로 돌아온다')
  check(d.unheard.every((u) => u.text !== GHOST_TEAM), '팀 방에서 한 말은 여기 없다 — 그건 들렸으니까')
  check(d.unheard.every((u) => u.text !== CLASS_SAID), '지워지지 않은 채로 한 말도 없다')
  const ghost = d.unheard.find((u) => u.text === GHOST_SAID)
  check(ghost?.day === 2, '며칠에 한 말인지 남는다', `DAY ${ghost?.day}`)
  check(ghost?.name === '봇8' || typeof ghost?.name === 'string', '누가 한 말인지 남는다', String(ghost?.name))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
