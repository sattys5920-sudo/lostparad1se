// 로봇 — 놓아야 센다 · 놓은 사람만 거둔다 · 놓인 것만 부순다.
//
//   - 자유 시간 걸음에 든 로봇이 따라간다(앞 방에 남았다가 순간이동하지 않는다)
//   - 놓기·수거는 페이즈 중에만. 수거는 놓은 사람만 — 같은 팀도 못 한다
//   - 든 로봇은 남의 화면에 안 온다. 놓인 것만 보이고, 내가 놓은 것에 표시(mine)
//   - 남이 든 로봇은 부술 수 없다. 놓인 것은 부순다
//   - 거래로 받는 쪽이 두 기를 넘게 들게 되면 성립하지 않는다
//   - 페이즈가 닫히면 놓인 로봇이 깃발 하나로 센다
//
//   npx vite-node scripts/robot-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { DEAL_COUNTDOWN_MS } from '../shared/rules/deal'
import { TILE_BY_ID, roomOfCell } from '../shared/rules/board'
import { canSeatAt } from '../shared/rules/seat'
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
function plain(v: any): any {
  if (v === null || typeof v !== 'object') return v
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(plain)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]))
  if ('fields' in v) return Object.fromEntries(Object.entries(v.fields).map(([k, x]) => [k, plain(x)]))
  return v
}
async function signUp(e: string) { await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e }
async function setAdmin(e: string) {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string) {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }; return { uid: j.localId, token: j.idToken }
}
async function call(n: string, tk: string, d: unknown): Promise<any> {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as any
  return j.error ? { ok: false, code: j.error.status, message: j.error.message } : { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown) { const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data }

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const GAME = `rb${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
// 넷이 함께 서는 방이라 정원(6)이 넉넉한 방을 쓴다 — 도서관(정원 2)이면 페이즈가 열릴 때 늦게 온 둘이 복도로 나간다
const ROOM = 'artRoom'
async function getDoc(path: string) { return plain(await (await fetch(`${FS}/${path}`, { headers: ADMIN })).json()) as Record<string, any> }
async function listDocs(path: string): Promise<Record<string, any>[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  return (((await r.json()) as { documents?: { name: string }[] }).documents ?? []).map((d) => ({ _id: d.name.split('/').pop(), ...plain(d) }))
}
const bot = async (id: string) => getDoc(`games/${GAME}/robots/${id}`)
async function seedBot(id: string, team: TeamId, tileId: string, carriedBy: string | null) {
  await fetch(`${FS}/games/${GAME}/robots/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: {
      id: { stringValue: id }, team: { stringValue: team }, tileId: { stringValue: tileId },
      carriedBy: carriedBy ? { stringValue: carriedBy } : { nullValue: null }, placedBy: { nullValue: null },
    } }),
  })
}
const viewOf = async (uid: string) => getDoc(`games/${GAME}/views/${uid}`)

async function main() {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'rb' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`)); people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  // 시계는 배속 1로 흐른다 — 그사이 흐른 실제 시간도 더해야 뒤로 안 돌아간다
  let pushedAt = Date.now()
  const push = async (ms: number) => {
    clock += ms + (Date.now() - pushedAt)
    pushedAt = Date.now()
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
    await must('tick', host, { gameId: GAME })
  }
  await push(0)
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const [a0, a1] = A
  const [b0, b1] = B
  const startTile = (await getDoc(`games/${GAME}/pawns/${a0.uid}`)).tileId as string

  console.log('\n── 자유 시간 걸음에 든 로봇이 따라간다 ──')
  await seedBot('bot-r1', 'A', startTile, a0.uid)
  await seedBot('bot-r2', 'A', startTile, a1.uid)
  await seedBot('bot-r3', 'A', startTile, a0.uid)
  await seedBot('bot-b1', 'B', startTile, b0.uid)
  await seedBot('bot-b2', 'B', startTile, b0.uid)
  for (const p of [a0, a1, b0, b1]) {
    const r = await call('roamTo', p.token, { gameId: GAME, tileId: ROOM })
    if (!r.ok) { await must('roamTo', p.token, { gameId: GAME, tileId: 'scienceRoom' }); await must('roamTo', p.token, { gameId: GAME, tileId: ROOM }) }
  }
  check((await bot('bot-r1')).tileId === ROOM, '든 로봇이 들고 간 사람과 같은 방에 있다', String((await bot('bot-r1')).tileId))
  const early = await call('phaseAct', a0.token, { gameId: GAME, kind: 'dropRobot' })
  check(!early.ok, '자유 시간에는 못 놓는다', early.message)

  console.log('\n── 페이즈 — 놓기 ──')
  await must('openPhase', host, { gameId: GAME })
  let vb = await viewOf(b0.uid)
  check(!(vb.visibleRobots ?? []).some((r: any) => r.id === 'bot-r1'), '남이 든 로봇은 내 화면에 안 온다', JSON.stringify(vb.visibleRobots))
  let va = await viewOf(a0.uid)
  check(va.myCarriedRobots === 2 && (va.myCarried ?? []).length === 2, '내가 든 로봇 둘이 내 화면에 온다', JSON.stringify(va.myCarried))
  await must('phaseAct', a0.token, { gameId: GAME, kind: 'dropRobot', targetRobot: 'bot-r3' })
  const r3 = await bot('bot-r3')
  check(r3.carriedBy === null && r3.placedBy === a0.uid && r3.tileId === ROOM, '고른 로봇(r3)이 놓였다 — 놓은 사람이 적혔다', JSON.stringify(r3))
  check((await bot('bot-r1')).carriedBy === a0.uid, '안 고른 로봇(r1)은 그대로 들고 있다')
  vb = await viewOf(b0.uid)
  const seen = (vb.visibleRobots ?? []).find((r: any) => r.id === 'bot-r3')
  check(!!seen && seen.mine === false, '놓인 로봇은 남의 화면에도 온다 — 내 것 표시는 없다', JSON.stringify(seen))
  va = await viewOf(a0.uid)
  check((va.visibleRobots ?? []).find((r: any) => r.id === 'bot-r3')?.mine === true, '내 화면에는 내가 놓은 것으로 온다')
  check(va.robotCounts?.[ROOM] === 1, '방의 로봇 수는 놓인 것만 센다', String(va.robotCounts?.[ROOM]))

  console.log('\n── 수거 — 놓은 사람만 ──')
  const mate = await call('phaseAct', a1.token, { gameId: GAME, kind: 'takeRobot', targetRobot: 'bot-r3' })
  check(!mate.ok && /놓은 사람만/.test(mate.message ?? ''), '같은 팀도 남이 놓은 것은 못 거둔다', mate.message)
  const enemy = await call('phaseAct', b1.token, { gameId: GAME, kind: 'takeRobot', targetRobot: 'bot-r3' })
  check(!enemy.ok, '다른 팀은 못 거둔다', enemy.message)
  await must('phaseAct', a0.token, { gameId: GAME, kind: 'takeRobot' })
  check((await bot('bot-r3')).carriedBy === a0.uid, '놓은 사람은 도로 든다')
  const full = await call('phaseAct', a0.token, { gameId: GAME, kind: 'takeRobot' })
  check(!full.ok, '거둘 것이 없으면(또는 두 기 들었으면) 거절', full.message)
  await must('phaseAct', a0.token, { gameId: GAME, kind: 'dropRobot' })
  await must('phaseAct', a0.token, { gameId: GAME, kind: 'dropRobot' })
  check((await listDocs(`games/${GAME}/robots`)).filter((r) => r.tileId === ROOM && r.carriedBy === null).length === 2, '두 기를 놓았다')

  console.log('\n── 부수기 — 드라이버 한 자루에 한 기 · 놓인 것만 ──')
  const noTool = await call('phaseAct', b0.token, { gameId: GAME, kind: 'smashRobot', targetRobot: 'bot-r1' })
  check(!noTool.ok && String(noTool.message).includes('드라이버'), '**드라이버가 없으면 못 부순다**', noTool.message)
  await fetch(`${FS}/games/${GAME}/pawns/${b0.uid}?updateMask.fieldPaths=items`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { items: { mapValue: { fields: { screwdriver: { integerValue: '1' } } } } } }),
  })
  const carried = await call('phaseAct', b0.token, { gameId: GAME, kind: 'smashRobot', targetRobot: 'bot-r2' })
  check(!carried.ok, '남이 든 로봇은 못 부순다', carried.message)
  await must('phaseAct', b0.token, { gameId: GAME, kind: 'smashRobot', targetRobot: 'bot-r1' })
  check(!(await getDoc(`games/${GAME}/robots/bot-r1`)).id, '놓인 로봇은 부서진다')
  check(Number((await getDoc(`games/${GAME}/pawns/${b0.uid}`)).items?.screwdriver ?? 0) === 0, '**드라이버 한 자루가 빠졌다**')

  console.log('\n── 거래 — 받는 쪽 두 기 한도 ──')
  // b0 은 두 기를 들었다. a1 이 한 기를 건네면 세 기가 되니 안 된다
  const plan = TILE_BY_ID[ROOM].plan
  const pawns = Object.fromEntries((await listDocs(`games/${GAME}/pawns`)).map((p) => [p._id, p]))
  const taken = new Set(Object.values(pawns).filter((p: any) => p.tileId && p.at).map((p: any) => `${p.at.x},${p.at.y}`))
  let pair: { x: number; y: number } | null = null
  for (let y = plan.y; y < plan.y + plan.h && !pair; y++) for (let x = plan.x; x < plan.x + plan.w - 1 && !pair; x++) {
    const ok = (cx: number, cy: number) => roomOfCell(cx, cy) === ROOM && canSeatAt(cx, cy) && !taken.has(`${cx},${cy}`)
    if (ok(x, y) && ok(x + 1, y)) pair = { x, y }
  }
  if (!pair) throw new Error('둘이 나란히 설 칸이 없다')
  await must('standAt', a1.token, { gameId: GAME, x: pair.x, y: pair.y })
  await must('standAt', b0.token, { gameId: GAME, x: pair.x + 1, y: pair.y })
  const open = async () => {
    const id = String((await must('askDeal', a1.token, { gameId: GAME, toPlayerId: b0.uid })).id)
    await must('answerDeal', b0.token, { gameId: GAME, dealId: id, accept: true })
    return id
  }
  const settle = async (id: string) => {
    await must('readyDeal', a1.token, { gameId: GAME, dealId: id, ready: true })
    await must('readyDeal', b0.token, { gameId: GAME, dealId: id, ready: true })
    await push(DEAL_COUNTDOWN_MS + 1000)
    return call('settleDeal', a1.token, { gameId: GAME, dealId: id })
  }
  let id = await open()
  await must('stakeDeal', a1.token, { gameId: GAME, dealId: id, stake: { robots: 1 } })
  const over = await settle(id)
  check(!over.ok && /두 기까지/.test(over.message ?? ''), '받는 쪽이 세 기가 되면 성립하지 않는다', over.message)
  check((await bot('bot-r2')).carriedBy === a1.uid, '로봇은 그대로 건넨 사람 손에 있다')
  // 한 기씩 맞바꾸면 된다
  await must('stakeDeal', b0.token, { gameId: GAME, dealId: id, stake: { robots: 1 } })
  const swap = await settle(id)
  check(swap.ok, '한 기씩 맞바꾸면 성립한다', swap.message)
  const r2 = await bot('bot-r2')
  check(r2.carriedBy === b0.uid && r2.team === 'B' && r2.tileId === ROOM, '받은 로봇은 받은 사람 손에, 그 팀 것이 된다', JSON.stringify(r2))
  check((await listDocs(`games/${GAME}/robots`)).filter((r) => r.carriedBy === b0.uid).length === 2, 'b0 은 여전히 두 기다')

  console.log('\n── 닫으면 놓인 로봇이 센다 ──')
  await must('closePhase', host, { gameId: GAME })
  const lib = await getDoc(`games/${GAME}/tiles/${ROOM}`)
  check(lib.ownerTeam === 'A', '놓인 A 로봇 한 기로 도서관이 A 것이 된다', String(lib.ownerTeam))
  const inv = (await must('hostInvariants', host, { gameId: GAME })) as { violations?: { kind: string; detail?: string }[] }
  const robotBad = (inv.violations ?? []).filter((v) => v.kind.startsWith('robots'))
  check(robotBad.length === 0, '불변 검사에 로봇 어긋남이 없다', JSON.stringify(robotBad))

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
