// 페이즈를 진짜 서버로.
//
// 확인할 것은 셋이다.
//
//   자유 시간에 아무리 멀리 가도 **전선은 안 움직인다** — 페이즈가
//     열리면 제자리로 돌아온다
//   남이 무엇을 골랐는지 새지 않는다
//   머릿수가 많은 팀이 방을 가져가고, 동점이면 안 바뀐다
//
//   HOST_CODE=... npx vite-node scripts/phase-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { ACT_COST, ROOM_KIND, TOKENS_PER_PHASE, capacityOf, stepToward } from '../shared/rules/occupy'

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

const GAME = `ph${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const ownerOfTile = async (id: string) =>
  ((await getAll(`games/${GAME}/tiles`)).find((t) => t.id === id)?.d.ownerTeam ?? null) as string | null

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'phase' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  check(true, '판이 시작했다')

  console.log('\n── 주장 ──')
  const started = await pawnsNow()
  const caps = Object.values(started).filter((p) => p.captain === true)
  check(caps.length === 2, '세 명뿐인 두 팀에만 주장이 있다', `${caps.length}명`)
  check(Object.values(started).every((p) => p.postTile === p.tileId), '전투 자리가 선 자리와 같게 시작한다')

  console.log('\n── 자유 시간은 전선을 못 옮긴다 ──')
  const a0 = A[0]
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'classroom' })
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'library' })
  let now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'library', '자유 시간에는 즉시 걸어 다닌다', String(now.tileId))
  check(now.postTile === 'baseA', '**전선은 그대로다**', String(now.postTile))

  const far = await call('roamTo', a0.token, { gameId: GAME, tileId: 'baseB' })
  check(far.code === 'FAILED_PRECONDITION', '옆방이 아니면 못 간다', far.message)

  const openedAt = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: openedAt, speed: 1 })

  console.log('\n── 페이즈를 열면 걸어서 제자리로 ──')
  // 값은 여기서 치른다. 자유 시간의 이동은 공짜지만, 종이 울렸을 때
  // 멀리 있었으면 그만큼 걸어 돌아와야 한다
  const opened = await must('openPhase', host, { gameId: GAME })
  check(opened.no === 1, '첫 페이즈가 열렸다', `${opened.no}번`)
  now = (await pawnsNow())[a0.uid]
  check(now.tileId === null, '멀리 있던 사람은 **걸어서** 돌아온다', String(now.tileId))
  check(now.postTile === 'baseA', '전투 자리는 벌써 제자리다', String(now.postTile))
  check(Number(now.arriveAtMs) > openedAt, '도착 시각이 미래다', `${Number(now.arriveAtMs) - openedAt}ms 뒤`)
  check(Number(opened.returned) === 1, '돌아온 사람 수를 센다', `${opened.returned}명`)
  check(Number(opened.allInAtMs) >= Number(now.arriveAtMs), '다 모이는 시각을 알려 준다')

  const stayed = Object.entries(await pawnsNow()).filter(([uid]) => uid !== a0.uid)
  check(stayed.every(([, p]) => p.tileId !== null), '제자리에 있던 사람은 걷지 않는다')

  // 시계를 도착 시각으로 밀면 들어온다
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: Number(opened.allInAtMs), speed: 1 })
  await must('tick', a0.token, { gameId: GAME })
  now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'baseA', '걸어서 제자리에 닿았다', String(now.tileId))

  const roamNow = await call('roamTo', a0.token, { gameId: GAME, tileId: 'classroom' })
  check(roamNow.code === 'FAILED_PRECONDITION', '페이즈 중에는 토큰을 써서 움직인다')

  console.log('\n── 토큰이 한 페이즈의 전부다 ──')
  check(now.tokens === TOKENS_PER_PHASE, '열릴 때 토큰을 받았다', `${now.tokens}개`)
  const step = await must('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: 'classroom' })
  check(Number(step.tokens) === TOKENS_PER_PHASE - ACT_COST.move, '한 칸에 토큰 하나', `${step.tokens}개 남음`)
  check((await pawnsNow())[a0.uid].tileId === 'classroom', '**바로 움직였다** — 닫힐 때까지 안 기다린다')

  // 토큰이 떨어질 때까지 왔다 갔다 한다
  let purse = Number(step.tokens)
  for (let i = 0; purse > 0 && i < 20; i++) {
    const to = i % 2 === 0 ? 'baseA' : 'classroom'
    const r = await call('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: to })
    if (!r.ok) break
    purse = Number((r.data as { tokens: number }).tokens)
  }
  check(purse === 0, '토큰을 다 썼다', `${purse}개`)
  const broke = await call('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: 'baseA' })
  check(broke.code === 'FAILED_PRECONDITION' && String(broke.message).includes('토큰'), '떨어지면 더는 못 움직인다', broke.message)

  console.log('\n── 감출 것은 secret 아래에만 ──')
  await must('phaseAct', A[1].token, { gameId: GAME, kind: 'disguise' })
  const gameDoc = await getAll(`games`)
  check(!JSON.stringify(gameDoc).includes('disguised'), '**판 문서에 위장이 안 적힌다**')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/phase`, { headers: { Authorization: `Bearer ${B[0].token}` } })
  check(asPlayer.status === 403, '남이 위장 목록을 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/phase`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 못 읽는다', String(asHost.status))

  console.log('\n── 시간이 끝나면 아무도 못 움직인다 ──')
  const ends = Number(opened.endsAtMs)
  check(ends > openedAt, '끝나는 시각이 정해졌다', `${(ends - openedAt) / 60000}분`)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: ends + 1000, speed: 1 })
  const late = await call('phaseAct', B[0].token, { gameId: GAME, kind: 'disguise' })
  check(late.code === 'FAILED_PRECONDITION' && String(late.message).includes('시간'), '시간이 끝났다', late.message)
  const info = await must('phaseNow', B[0].token, { gameId: GAME })
  check(info.open === true && info.alive === false, '열려 있지만 살아 있지는 않다')
  check(!JSON.stringify(info).includes('disguise'), '**누가 무엇을 했는지는 안 나간다**')

  console.log('\n── 닫으면 서 있는 자리로 정해진다 ──')
  check((await ownerOfTile('library')) === null, '도서관은 처음에 주인이 없다', String(await ownerOfTile('library')))
  const closed = await must('closePhase', host, { gameId: GAME })
  check(Number(closed.no) === 1, '1번 페이즈가 닫혔다')
  const after = await pawnsNow()
  check(after[a0.uid].postTile === after[a0.uid].tileId, '전선이 선 자리로 옮겨졌다')
  check(after[a0.uid].tokens === 0, '남은 토큰은 사라진다', `${after[a0.uid].tokens}개`)

  // 페이즈를 열고 시계를 여유 있게 맞춘다
  let clockAt = ends + 2000
  const openWide = async () => {
    await must('openPhase', host, { gameId: GAME })
    clockAt += 1000
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
  }
  /** 거기까지 걸어간다. 페이즈 중에는 한 칸씩 토큰을 쓴다. */
  const walkTo = async (who: { uid: string; token: string }, goal: string) => {
    for (let i = 0; i < 8; i++) {
      const here = (await pawnsNow())[who.uid].tileId as string
      if (here === goal) return
      const next = stepToward(here, goal)
      if (!next) return
      const r = await call('phaseAct', who.token, { gameId: GAME, kind: 'move', targetTile: next })
      if (!r.ok) return
    }
  }

  console.log('\n── 머릿수가 많은 팀이 가져간다 ──')
  await openWide()
  await walkTo(a0, 'library')
  await walkTo(A[1], 'library')
  await walkTo(B[0], 'library')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', 'A 둘이 B 하나를 이겼다', String(await ownerOfTile('library')))
  const log2 = await getAll(`games/${GAME}/phaseLog`)
  check(JSON.stringify(log2).includes('captured'), '점령이 로그에 남았다')

  console.log('\n── 동점이면 안 바뀐다 ──')
  await openWide()
  await walkTo(B[1], 'library')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', '2대2가 되어도 주인이 그대로다')

  console.log('\n── 아무도 없어도 주인은 남는다 ──')
  await openWide()
  await walkTo(a0, 'classroom')
  await walkTo(A[1], 'classroom')
  await walkTo(B[0], 'artRoom')
  await walkTo(B[1], 'artRoom')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('library')) === 'A', '다 빠져나가도 A 것으로 남는다')

  console.log('\n── 주장은 둘로 센다 ──')
  const cap = C.find((p) => (started[p.uid] as { captain?: boolean }).captain === true)
  check(cap !== undefined, '주장을 찾았다')

  console.log('\n── 좁은 방은 둘까지 ──')
  const narrow = Object.entries(ROOM_KIND).find(([, k]) => k === 'narrow')?.[0] as string
  check(capacityOf(narrow) === 2, `${narrow}은 정원 2다`)

  console.log('\n── 페이즈가 아니면 못 한다 ──')
  const shut = await call('phaseAct', a0.token, { gameId: GAME, kind: 'disguise' })
  check(shut.code === 'FAILED_PRECONDITION', '닫힌 뒤에는 못 한다', shut.message)
  const notHost = await call('openPhase', a0.token, { gameId: GAME })
  check(notHost.code === 'PERMISSION_DENIED', '운영자만 페이즈를 연다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
