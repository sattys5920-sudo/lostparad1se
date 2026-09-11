// 이동과 깃발을 **진짜 서버로** 돌린다.
//
// 걸음이 시각대로 밀리는지, 걷는 도중에 목적지가 새지 않는지, 깃발이
// 머릿수대로 판정되는지, 자원이 성공하는 순간에 빠지는지.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/move-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { BASE_OF, pathBetween } from '../shared/rules/board'
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
  if ('fields' in o) {
    return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  }
  return o
}
async function getDoc<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return r.ok ? (plain(await r.json()) as T) : null
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({
    id: doc.name.split('/').pop() as string,
    d: plain(doc) as Record<string, unknown>,
  }))
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
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}

const GAME = `move${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token

  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < n; i++) want.push(t)
  }
  await must('createGame', host, { gameId: GAME, seed: 'move' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const e = await signUp(`p${i}-${GAME}@x.test`)
    const a = await auth(e)
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 9))
  check(true, '열넷이 앉고 판이 시작했다')

  const A = people.filter((p) => p.team === 'A')
  const me = A[0]
  const pawn = async (uid: string) => (await getDoc(`games/${GAME}/pawns/${uid}`)) as {
    tileId: string | null
    fromTile: string | null
    path: string[]
    arriveAtMs: number | null
  }

  console.log('\n── 이동 ──')
  check((await pawn(me.uid)).tileId === BASE_OF.A, '기지에 서 있다')
  const bad = await call('moveTo', me.token, { gameId: GAME, tileId: BASE_OF.A })
  check(bad.code === 'INVALID_ARGUMENT', '같은 칸으로는 못 간다', bad.code)
  check((await call('moveTo', me.token, { gameId: GAME, tileId: '없는칸' })).code === 'INVALID_ARGUMENT', '없는 칸도 거절')

  // 기지 → 중앙광장. 네 칸이라 목적지가 시야 밖이다 —
  // 「목적지가 새는가」를 보려면 목적지가 원래 안 보이는 칸이어야 한다
  const DEST = 'centralPlaza'
  const steps = pathBetween(BASE_OF.A, DEST)
  const moved = await must('moveTo', me.token, { gameId: GAME, tileId: DEST })
  check(Number(moved.steps) === steps.length, `${steps.length}칸 걷는다`, `${moved.steps}칸`)

  const walking = await pawn(me.uid)
  check(walking.tileId === null, '걷는 중에는 어느 칸에도 서 있지 않다')
  check(walking.fromTile === BASE_OF.A, '떠난 칸이 기지다')
  check((await call('moveTo', me.token, { gameId: GAME, tileId: 'garden' })).code === 'FAILED_PRECONDITION', '걷는 중에는 또 못 간다')

  console.log('\n── 목적지가 새는가 ──')
  const viewOf = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as {
    visiblePawns: { playerId: string; toTile: string | null; tileId: string | null }[]
  }
  const mate = A[1]
  const mateView = await viewOf(mate.uid)
  const seenMe = mateView.visiblePawns.find((p) => p.playerId === me.uid)
  check(Boolean(seenMe), '같은 팀은 걷는 말을 본다')
  check(seenMe?.toTile === steps[0], '다음 한 칸까지만 보인다', String(seenMe?.toTile))
  // 목적지는 시야 밖 칸이다. 그래도 몫 어디에도 없어야 한다
  const mateRaw = JSON.stringify(mateView)
  check(!mateRaw.includes(DEST), '목적지는 같은 팀 몫에도 없다')
  // 말 하나에 붙는 칸은 셋뿐이다. 경로를 담을 자리가 아예 없다
  //
  // 칸 이름을 문자열로 찾는 방법은 못 쓴다 — 경로의 칸이 안개에
  // 보여서 visibleTiles에 들어 있을 수 있다. 담는 모양을 본다
  check(
    Object.keys(seenMe ?? {}).sort().join(',') === 'asleep,fromTile,playerId,team,tileId,toTile,walking',
    '말에 붙는 칸은 지금·떠난·다음 셋뿐이다',
    Object.keys(seenMe ?? {}).join(','),
  )

  console.log('\n── 걸음이 밀리는가 ──')
  // 칸당 15분이다. 한 칸 반쯤 지난 자리로 시계를 옮긴다
  //
  // 「도착 1ms 전」으로 잡으면 안 된다. 배속 1이면 게임 시계가 실제
  // 시간을 따라 흐르고, 호출 왕복에 수백 ms가 지나간다
  const STEP_MS = 15 * 60_000
  await clock(Number(moved.arriveAtMs) - (steps.length - 1) * STEP_MS - STEP_MS / 2)
  let r = await must('tick', me.token, { gameId: GAME })
  check(Number(r.applied) === 0, '첫 칸에 닿기 전에는 밀 것이 없다', `${r.applied}건`)
  check((await pawn(me.uid)).tileId === null, '아직 걷는 중이다')

  await clock(Number(moved.arriveAtMs) - (steps.length - 2) * STEP_MS - STEP_MS / 2)
  r = await must('tick', me.token, { gameId: GAME })
  check(Number(r.applied) === 1, '한 칸만 밀렸다', `${r.applied}건`)
  const mid = await pawn(me.uid)
  check(mid.tileId === null, '가운데서도 어느 칸에도 서 있지 않다')
  check(mid.fromTile === steps[0], '떠난 칸이 첫 칸으로 바뀌었다', String(mid.fromTile))
  check(mid.path.length === steps.length - 1, '남은 경로가 하나 줄었다', `${mid.path.length}칸`)

  await clock(Number(moved.arriveAtMs))
  r = await must('tick', me.token, { gameId: GAME })
  check(Number(r.applied) === steps.length - 1, `남은 ${steps.length - 1}칸이 한 번에 밀렸다`, `${r.applied}건`)
  const landed = await pawn(me.uid)
  check(landed.tileId === DEST, '목적지에 섰다', String(landed.tileId))
  check(landed.path.length === 0 && landed.fromTile === null, '경로가 비었다')

  console.log('\n── 깃발 ──')
  // 중앙광장은 DAY 5에나 열린다. 열리지 않은 칸에는 못 꽂는 것도 확인한다
  const closed = await call('plantFlag', me.token, { gameId: GAME, tileId: DEST })
  check(closed.code === 'FAILED_PRECONDITION', '아직 안 열린 칸에는 못 꽂는다', closed.message)

  // 도서관으로 되돌아가 거기에 꽂는다
  await must('moveTo', me.token, { gameId: GAME, tileId: 'library' })
  const back = await getDoc(`games/${GAME}/pawns/${me.uid}`) as { arriveAtMs: number }
  await clock(Number(back.arriveAtMs) + 2 * 15 * 60_000)
  await must('tick', me.token, { gameId: GAME })
  check((await pawn(me.uid)).tileId === 'library', '도서관으로 돌아왔다', String((await pawn(me.uid)).tileId))

  const tokensOf = async (t: TeamId) => Number((await getDoc(`games/${GAME}/teams/${t}`))?.tokens)
  const before = await tokensOf('A')
  const notThere = await call('plantFlag', mate.token, { gameId: GAME, tileId: 'library' })
  check(notThere.code === 'FAILED_PRECONDITION', '그 칸에 없으면 못 꽂는다', notThere.message)
  check((await call('plantFlag', me.token, { gameId: GAME, tileId: 'baseB' })).code === 'FAILED_PRECONDITION', '기지에는 못 꽂는다')

  const planted = await must('plantFlag', me.token, { gameId: GAME, tileId: 'library' })
  check(Number(planted.durationSec) > 0, '깃발이 익기 시작했다', `${planted.durationSec}초`)
  check((await tokensOf('A')) === before - 1, '토큰이 하나 빠졌다', `${before} → ${await tokensOf('A')}`)
  check((await call('plantFlag', me.token, { gameId: GAME, tileId: 'library' })).code === 'FAILED_PRECONDITION', '한 칸에 두 번은 못 꽂는다')

  const flagDoc = await getDoc(`games/${GAME}/flags/library`)
  check(Boolean(flagDoc), '깃발 문서가 놓였다')

  console.log('\n── 깃발 판정 ──')
  const resBefore = (await getDoc(`games/${GAME}/teams/A`)) as { resources: { money: number } }
  await clock(Number(planted.dueAtMs))
  await must('tick', me.token, { gameId: GAME })
  const tile = (await getDoc(`games/${GAME}/tiles/library`)) as { ownerTeam: string | null }
  check(tile.ownerTeam === 'A', '빈 칸을 가져왔다', String(tile.ownerTeam))
  check((await getDoc(`games/${GAME}/flags/library`)) === null, '깃발이 치워졌다')
  const resAfter = (await getDoc(`games/${GAME}/teams/A`)) as { resources: { money: number } }
  check(resAfter.resources.money < resBefore.resources.money, '성공하는 순간 값을 치렀다', `${resBefore.resources.money} → ${resAfter.resources.money}`)

  const evs = await getAll(`games/${GAME}/events`)
  const kind = (k: string) => evs.filter((e) => e.d.kind === k).length
  check(kind('flagSucceeded') === 1, '성공 기록 하나')
  check(kind('tileCaptured') === 1, '점령 기록 하나')

  console.log('\n── 등교 예약 ──')
  const far = await call('planCommute', me.token, { gameId: GAME, tileId: BASE_OF.C })
  check(far.code === 'INVALID_ARGUMENT', '두 칸을 넘으면 예약 못 한다', far.message)
  await must('planCommute', me.token, { gameId: GAME, tileId: 'playground' })
  const myView = await getDoc(`games/${GAME}/views/${me.uid}`) as { commutePlan: { path: string[] } | null }
  check(myView.commutePlan?.path?.[0] === 'playground', '내 예약은 내 몫에 있다')
  // 칸 이름을 문자열로 찾으면 안 된다 — 그 칸이 안개에 보여서 들어 있을
  // 수도 있다. 예약 칸 자체가 비어 있는지를 본다
  const mateView2 = (await getDoc(`games/${GAME}/views/${mate.uid}`)) as { commutePlan: unknown }
  check(mateView2.commutePlan === null, '같은 팀 몫에는 예약 칸이 비어 있다')

  // 08:00에 한꺼번에 출발한다
  await clock(dayHourMs(START, 2, 8))
  await must('tick', me.token, { gameId: GAME })
  const afterDawn = await pawn(me.uid)
  check(afterDawn.tileId === null, '아침에 예약이 출발했다', String(afterDawn.tileId))
  check((await getDoc(`games/${GAME}/secret/plans/items/${me.uid}`)) === null, '쓴 예약은 치워졌다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
