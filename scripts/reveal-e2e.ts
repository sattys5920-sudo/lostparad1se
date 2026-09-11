// 진상 공개 흐름의 서버 쪽을 진짜 서버로.
//
// 아침 진행 · 체류 기록 · 깨달음 · 눈발 · A의 기억.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/reveal-e2e.ts
import { AWAKENING_STAY_GAME_HOURS, TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { MEMORY_TILES } from '../shared/rules/memory'
import { dayHourMs } from '../shared/rules/clock'
// 검수 script는 서버 전용 데이터를 읽어도 된다 — 번들에 실리지 않는다.
// 게임 중에는 이 짝을 아무도 못 본다
import { placeOf } from '../functions/src/story/sights'
import type { RoleId } from '../shared/missions/roleNames'

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
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
function hasKey(v: unknown, key: string): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some((x) => hasKey(x, key))
  const o = v as Record<string, unknown>
  if (key in o) return true
  return Object.values(o).some((x) => hasKey(x, key))
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

const GAME = `rev${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'rev' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 10))
  const A = people.filter((p) => p.team === 'A')
  const me = A[0]
  const view = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as {
    handledDays: number[]; readDays: number[]; memories: { tileId: string }[]; sightAtMs: number | null
  }
  check(true, '판이 시작했다')

  console.log('\n── 아침 진행 ──')
  const v0 = await view(me.uid)
  check(v0.handledDays.length === 0, '처음에는 본 날이 없다')

  const bad = await must('markMorning', me.token, { gameId: GAME, read: [1, 5, 99, -1, 1.5] })
  check(bad.handledDays !== undefined, '표시했다')
  check(JSON.stringify(bad.handledDays) === '[1]', '아직 안 열린 날과 이상한 날은 버린다', JSON.stringify(bad.handledDays))

  await clock(dayHourMs(START, 3, 10))
  await must('tick', me.token, { gameId: GAME })
  await must('markMorning', me.token, { gameId: GAME, read: [2], skipped: [3] })
  const v1 = await view(me.uid)
  check(JSON.stringify(v1.handledDays) === '[1,2,3]', '건너뛴 날도 처리한 날에 들어간다', JSON.stringify(v1.handledDays))
  check(JSON.stringify(v1.readDays) === '[1,2]', '본 날에는 건너뛴 날이 없다', JSON.stringify(v1.readDays))

  const mate = A[1]
  check((await view(mate.uid)).handledDays.length === 0, '남의 진행은 남의 것이다')

  console.log('\n── 체류 기록 ──')
  const ivs = await getAll(`games/${GAME}/secret/intervals/items`)
  check(ivs.length >= TOTAL_SEATS, '시작할 때 열넷의 구간이 열렸다', `${ivs.length}개`)
  check(ivs.filter((i) => i.d.playerId === me.uid).every((i) => typeof i.d.tileId === 'string' || i.d.tileId === null), '칸이 적혀 있다')

  // 규칙이 막는가 — 위치 이력은 안개보다 센 정보다
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/intervals/items`, { headers: { Authorization: `Bearer ${me.token}` } })
  check(asPlayer.status === 403, '플레이어는 체류 기록을 못 읽는다', String(asPlayer.status))
  let ivLeaks = 0
  for (const p of people) if (hasKey(await getDoc(`games/${GAME}/views/${p.uid}`), 'intervals')) ivLeaks += 1
  check(ivLeaks === 0, '어느 몫에도 체류 기록이 없다')

  // 걸으면 구간이 닫히고 새로 열린다
  await must('moveTo', me.token, { gameId: GAME, tileId: 'classroom' })
  const walking = (await getAll(`games/${GAME}/secret/intervals/items`)).filter((i) => i.d.playerId === me.uid)
  check(walking.some((i) => i.d.state === 'walking' && i.d.endMs === null), '걷는 동안은 어느 칸에도 없다')
  const p1 = await getDoc(`games/${GAME}/pawns/${me.uid}`) as { arriveAtMs: number }
  await clock(Number(p1.arriveAtMs))
  await must('tick', me.token, { gameId: GAME })
  const landed = (await getAll(`games/${GAME}/secret/intervals/items`)).filter((i) => i.d.playerId === me.uid && i.d.endMs === null)
  check(landed.length === 1 && landed[0].d.tileId === 'classroom', '도착하면 그 칸의 구간이 열린다', String(landed[0]?.d.tileId))

  console.log('\n── 눈발 ──')
  const snow = await must('snowNow', me.token, { gameId: GAME })
  check(snow.level === 5 && snow.stopped === false, '아무도 깨닫지 않았으면 눈이 가장 굵다', JSON.stringify(snow))
  // 사람 수는 내려가지 않는다
  check(!('awakened' in snow) && !('revealed' in snow), '몇 명인지는 알려 주지 않는다', JSON.stringify(snow))
  const g = (await getDoc(`games/${GAME}`)) as { snow: { level: number; stopped: boolean } }
  check(g.snow.level === 5, '판 문서에도 단계만 있다')
  check(!hasKey(g.snow, 'awakened'), '판 문서에도 사람 수가 없다')

  console.log('\n── 깨달음 ──')
  check((await view(me.uid)).sightAtMs === null, '아직 A의 시선이 안 열렸다')

  // 실제로 한 명을 그 자리에 세워 본다. 「판정이 돌았다」만 보면
  // 아무도 깨닫지 않은 판에서도 초록으로 뜬다
  const roster = await getAll(`games/${GAME}/secret/roster/items`)
  const walker = people.find((p) => {
    const row = roster.find((r) => r.id === p.uid)
    return row && placeOf(row.d.roleId as RoleId) !== undefined
  }) as (typeof people)[0]
  const myPlace = placeOf(
    (roster.find((r) => r.id === walker.uid) as { d: { roleId: string } }).d.roleId as RoleId,
  )
  console.log(`     (${myPlace}에 세운다)`)

  await must('moveTo', walker.token, { gameId: GAME, tileId: myPlace })
  const pw = (await getDoc(`games/${GAME}/pawns/${walker.uid}`)) as { arriveAtMs: number; path: string[] }
  await clock(Number(pw.arriveAtMs) + pw.path.length * 15 * 60_000)
  await must('tick', walker.token, { gameId: GAME })
  const stood = (await getDoc(`games/${GAME}/pawns/${walker.uid}`)) as { tileId: string }
  check(stood.tileId === myPlace, '그 자리에 섰다', String(stood.tileId))

  // 세 시간이 차기 직전에는 아직 안 열린다
  const arrivedAt = Number(pw.arriveAtMs) + pw.path.length * 15 * 60_000
  await clock(arrivedAt + (AWAKENING_STAY_GAME_HOURS - 1) * 3_600_000)
  await must('snowNow', walker.token, { gameId: GAME })
  check((await view(walker.uid)).sightAtMs === null, `${AWAKENING_STAY_GAME_HOURS - 1}시간으로는 안 열린다`)

  await clock(arrivedAt + (AWAKENING_STAY_GAME_HOURS + 1) * 3_600_000)
  await must('snowNow', walker.token, { gameId: GAME })
  const opened = await getAll(`games/${GAME}/secret/awakened/items`)
  check(opened.some((o) => o.id === walker.uid), `${AWAKENING_STAY_GAME_HOURS}시간을 서니 깨달았다`, `${opened.length}명`)
  check((await view(walker.uid)).sightAtMs !== null, '본인에게 A의 시선이 열렸다')

  // 남에게는 안 열린다
  let sightLeaks = 0
  for (const p of people) {
    if (opened.some((o) => o.id === p.uid)) continue
    if ((await view(p.uid)).sightAtMs !== null) sightLeaks += 1
  }
  check(sightLeaks === 0, '깨닫지 않은 사람에게는 안 열린다', `${sightLeaks}명`)

  // 그 짝은 어디로도 안 나간다 — 알면 역할을 역산할 수 있다
  let placeLeaks = 0
  for (const p of people) if (hasKey(await getDoc(`games/${GAME}/views/${p.uid}`), 'placeTile')) placeLeaks += 1
  check(placeLeaks === 0, '「그 자리」가 어느 몫에도 없다')

  console.log('\n── A의 기억 ──')
  check(MEMORY_TILES.length === 13, '기억이 묻힌 칸은 열셋', `${MEMORY_TILES.length}칸`)
  const mem0 = await getAll(`games/${GAME}/secret/memories/items`)
  check(mem0.length === 0, '아직 아무도 안 열었다')

  // 도서관(관문)을 가져간다
  await clock(dayHourMs(START, 2, 9))
  await must('tick', me.token, { gameId: GAME })
  await must('moveTo', me.token, { gameId: GAME, tileId: 'library' })
  const p2 = await getDoc(`games/${GAME}/pawns/${me.uid}`) as { arriveAtMs: number; path: string[] }
  await clock(Number(p2.arriveAtMs) + p2.path.length * 15 * 60_000)
  await must('tick', me.token, { gameId: GAME })
  const planted = await must('plantFlag', me.token, { gameId: GAME, tileId: 'library' })
  await clock(Number(planted.dueAtMs))
  await must('tick', me.token, { gameId: GAME })

  const mem1 = await getAll(`games/${GAME}/secret/memories/items`)
  check(mem1.length === 1 && mem1[0].id === 'library', '처음 가져간 팀에게 기억이 열렸다', mem1.map((m) => m.id).join(','))
  check(mem1[0].d.team === 'A', '연 팀이 A다')

  const mineMem = (await view(me.uid)).memories.map((m) => m.tileId)
  check(mineMem.includes('library'), '우리 팀 몫에 있다')
  const foe = people.find((p) => p.team === 'C') as (typeof people)[0]
  check(!(await view(foe.uid)).memories.some((m) => m.tileId === 'library'), '다른 팀 몫에는 없다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
