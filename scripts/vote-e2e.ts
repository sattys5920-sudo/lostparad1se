// 신뢰표 · 호감표 — 하루 종일 · 하루 한 장 · 날이 넘어가야 센다.
//
//   firebase emulators:start --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/vote-e2e.ts
//
// 확인하는 것
//   - 옆 칸에 선 사람에게만 준다. 같은 방이라도 멀면 못 준다
//   - 자기에게는 못 주고, 우리 팀에는 준다
//   - **시간 제한이 없다** — 밤 11시 반에도 준다
//   - 하루 한 장. 날이 넘어가면(운영자가 달력을 넘기면) 다시 한 장
//   - 받은 표는 **어제까지만** 센다. 오늘 받은 것은 날이 넘어가야 오른다
//   - 받는 쪽에는 종류별 장수만 간다. 누가 줬는지는 어디에도 없다
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { canStandAt, roomOfCell } from '../shared/rules/board'
import { isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'

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
  if ('mapValue' in o) { const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}; return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)])) }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function signUp(e: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e
}
async function setAdmin(e: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }; return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string; raw: string }
/** 부하가 큰 기계에서 연결이 끊기면 한 번 더 — 서버의 답이 아니라 회선의 일이다 */
async function fetchRetry(url: string, init: RequestInit, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) })
      // 5xx 인데 콜러블 오류 봉투가 아니면 워커가 죽은 것이다(부하) — 한 번 더 두드린다
      if (r.status >= 500 && i < tries - 1) {
        const t = await r.clone().text()
        if (!t.includes('"error"')) { await new Promise((f) => setTimeout(f, 2000)); continue }
      }
      return r
    } catch (e) { if (i >= tries - 1) throw e }
  }
}
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetchRetry(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const raw = await r.text()
  try {
    const j = JSON.parse(raw) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
    if (j.error) return { ok: false, code: j.error.status, message: j.error.message, raw }
    return { ok: true, data: j.result ?? {}, raw }
  } catch { return { ok: false, code: 'NOT_JSON', message: raw.slice(0, 100), raw } }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
async function patch(path: string, fields: Record<string, unknown>, tk?: string): Promise<number> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
      : typeof v === 'boolean' ? { booleanValue: v }
        : v === null ? { nullValue: null }
          : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
            : { stringValue: String(v) }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : ADMIN) },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  return r.status
}
/** Y 의 증표로 직접 읽는다. 상태와 본문을 돌려준다 — 규칙(firestore.rules)이 가른다 */
async function readAs(tk: string, path: string, list = false): Promise<{ status: number; text: string }> {
  const r = await fetch(`${FS}/${path}${list ? '?pageSize=300' : ''}`, { headers: { Authorization: `Bearer ${tk}` } })
  return { status: r.status, text: await r.text() }
}

const GAME = `vt${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
type P = { uid: string; token: string; team: TeamId; name: string }
const HANGUL = /[가-힣]/

/** 방 안에서 그 칸 옆 빈 칸에 선다 — 먼저 방을 옮겨 두고 칸을 짚는다 */
async function standBeside(p: P, x: number, y: number): Promise<boolean> {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const c = { x: x + dx, y: y + dy }
    if (!canStandAt(c.x, c.y) || roomOfCell(c.x, c.y) !== roomOfCell(x, y) || isBlockedCell(c.x, c.y) || isFixture(c.x, c.y)) continue
    const r = await call('standAt', p.token, { gameId: GAME, x: c.x, y: c.y })
    if (r.ok && r.data?.ok !== false) return true
  }
  return false
}

/**
 * 표는 **옆 칸에만** 준다(vote.ts · cellsTouch). from 을 to 의 바로 옆(상하좌우)
 * 빈 칸에 세운 뒤 준다
 */
async function voteBeside(from: P, to: P, kind: 'trust' | 'liking'): Promise<void> {
  const at = ((await getDoc(`games/${GAME}/pawns/${to.uid}`)) as { at?: { x: number; y: number } } | null)?.at
  if (!at) throw new Error(`${to.name} 의 칸을 모른다`)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = { x: at.x + dx, y: at.y + dy }
    if (!canStandAt(c.x, c.y) || roomOfCell(c.x, c.y) !== roomOfCell(at.x, at.y) || isBlockedCell(c.x, c.y) || isFixture(c.x, c.y)) continue
    const r = await call('standAt', from.token, { gameId: GAME, x: c.x, y: c.y })
    if (!r.ok || r.data?.ok === false) continue
    await must('castVote', from.token, { gameId: GAME, targetId: to.uid, kind })
    return
  }
  throw new Error(`${from.name} 이(가) ${to.name} 옆에 못 섰다`)
}


interface Paper { votesReceived: { trust: number; liking: number }; votesThroughDay: number }
const paperOf = async (p: P) => (await must('myPaper', p.token, { gameId: GAME })) as unknown as Paper

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'vote' })
  const people: P[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${i}` })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  for (let round = 0; round < 3; round++) {
    const g = (await getDoc(`games/${GAME}`)) as { seats: { playerId: string }[] }
    const missing = people.filter((p) => !g.seats.some((s) => s.playerId === p.uid))
    if (missing.length === 0) break
    for (const p of missing) await must('joinGame', p.token, { gameId: GAME, name: p.name, team: p.team })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 10))
  const A = people.filter((p) => p.team === 'A'), B = people.filter((p) => p.team === 'B'), C = people.filter((p) => p.team === 'C'), D = people.filter((p) => p.team === 'D')
  check(true, '판이 돌고 있다')

  console.log('\n── 옆 칸에만 ──')
  // 서로 먼 칸에 세운다. 같은 교실이라도 옆 칸이 아니면 못 준다
  const far = await call('castVote', A[0].token, { gameId: GAME, targetId: D[D.length - 1].uid, kind: 'trust' })
  const aAt = ((await getDoc(`games/${GAME}/pawns/${A[0].uid}`)) as { at?: { x: number; y: number } }).at
  const dAt = ((await getDoc(`games/${GAME}/pawns/${D[D.length - 1].uid}`)) as { at?: { x: number; y: number } }).at
  const apart = !!aAt && !!dAt && Math.max(Math.abs(aAt.x - dAt.x), Math.abs(aAt.y - dAt.y)) > 1
  if (apart) check(!far.ok && (far.message ?? '').includes('옆 칸'), '떨어져 있으면 못 준다', far.message ?? '줬다')
  else console.log('  (처음 자리가 붙어 있어 건너뜀)')
  check(!(await call('castVote', A[0].token, { gameId: GAME, targetId: A[0].uid, kind: 'trust' })).ok, '자기에게는 못 준다')
  const bad = await call('castVote', A[0].token, { gameId: GAME, targetId: B[0].uid, kind: 'suspicion' })
  check(!bad.ok && bad.code === 'INVALID_ARGUMENT', '신뢰 · 호감 말고는 없다', bad.message)

  console.log('\n── 우리 팀에도 준다 · 하루 한 장 ──')
  await voteBeside(A[1], A[2], 'trust')
  check(true, '같은 팀에게 신뢰표를 줬다')
  const twice = await call('castVote', A[1].token, { gameId: GAME, targetId: A[2].uid, kind: 'liking' })
  check(!twice.ok && (twice.message ?? '').includes('이미'), '하루 한 장뿐 — 종류를 바꿔도', twice.message ?? '또 줬다')

  console.log('\n── 밤에도 준다 ──')
  // 옛 규칙은 08~21시였다. 지금은 시간 제한이 없다
  await clock(dayHourMs(START, 1, 23) + 30 * 60_000)
  await voteBeside(B[0], C[0], 'liking')
  check(true, '밤 11시 반에 호감표를 줬다')
  await voteBeside(D[0], C[0], 'trust')
  check(true, '같은 사람에게 다른 사람이 신뢰표를 줬다')
  // 바로 옆에 선 채로 한 장 더 — 거절 이유가 「이미」여야 한다
  const late2 = await call('castVote', B[0].token, { gameId: GAME, targetId: C[0].uid, kind: 'trust' })
  check(!late2.ok && (late2.message ?? '').includes('이미'), '밤에도 하루 한 장', late2.message ?? '또 줬다')

  console.log('\n── 받은 표는 날이 넘어가야 오른다 ──')
  const today = await paperOf(C[0])
  check(today.votesReceived.trust === 0 && today.votesReceived.liking === 0, '오늘 받은 표는 아직 안 보인다', JSON.stringify(today.votesReceived))
  check(today.votesThroughDay === 0, '어제까지 셌다 — DAY 1에는 0일', String(today.votesThroughDay))

  // 운영자가 달력을 넘긴다 — 정산, 그다음 날이 바뀐다
  await clock(dayHourMs(START, 2, 0) + 10 * 60_000)
  let pushed = ''
  for (let i = 0; i < 3 && !pushed.includes('dayStart'); i++) {
    const r = await must('pushDay', host, { gameId: GAME })
    pushed += ` ${String((r.pushed as { kind?: string } | null)?.kind ?? '')}`
  }
  const g = (await getDoc(`games/${GAME}`)) as { day: number }
  check(g.day === 2, 'DAY 2로 넘어갔다', `${g.day} ·${pushed}`)

  const next = await paperOf(C[0])
  check(next.votesReceived.trust === 1 && next.votesReceived.liking === 1, '어제 받은 신뢰 1 · 호감 1이 올랐다', JSON.stringify(next.votesReceived))
  check(next.votesThroughDay === 1, 'DAY 1까지 셌다', String(next.votesThroughDay))
  const mate = await paperOf(A[2])
  check(mate.votesReceived.trust === 1, '우리 팀에게 받은 표도 센다', JSON.stringify(mate.votesReceived))

  const raw = JSON.stringify(next) + JSON.stringify(mate)
  check(![B[0], D[0], A[1]].some((p) => raw.includes(p.uid)) && !raw.includes('voterId'), '받는 쪽에는 누가 줬는지가 없다')

  console.log('\n── 날이 바뀌면 다시 한 장 ──')
  await voteBeside(B[0], C[1], 'trust')
  check(true, '어제 준 사람이 오늘 또 준다')
  const again = await call('castVote', B[0].token, { gameId: GAME, targetId: C[1].uid, kind: 'liking' })
  check(!again.ok && (again.message ?? '').includes('이미'), '그리고 오늘도 한 장뿐', again.message ?? '또 줬다')

  console.log('\n── 공개 기록에 사람이 없다 ──')
  const evs = (await getAll(`games/${GAME}/events`)).filter((e) => e.d.kind === 'vote')
  const evJson = JSON.stringify(evs)
  check(evs.length === 4, '표 기록 네 줄 — 준 만큼', `${evs.length}줄`)
  check(!people.some((p) => evJson.includes(p.uid)), '표 기록에 보낸 사람도 받은 사람도 없다')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/votes/items`, { headers: { Authorization: `Bearer ${A[0].token}` } })
  check(asPlayer.status === 403, '플레이어는 표 원본을 못 읽는다', String(asPlayer.status))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 틀렸다.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
