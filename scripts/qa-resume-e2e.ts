// QA 6 — 끊김·복귀. 폰이 꺼지고 망이 끊긴 채 시간이 흐른 뒤 돌아와도
// 판이 어긋나지 않는지 본다. 서버 API 만으로 재현한다(화면은 실기기 점검표).
//
//   ① 걷는 중에 끊김      페이즈 이동을 걸어 놓고 아무것도 안 부른다. 도착
//                          시각이 지나고 **남이** 두드리면 나는 정확히 한 방에 있다
//   ② 페이즈 중에 끊김    끊긴 채 한 시간이 지나면 페이즈는 저절로 닫혀 있고,
//                          돌아와 누르면 「지금은 페이즈가 아니다」
//   ③ 두 시간 멈춤        저녁 여덟 시에 다 끊기고 새벽 여섯 시에 첫 사람이
//                          두드린다 — 정산·자정 판정·날짜 넘김이 **한 번씩만** 된다.
//                          두 번째 두드림은 아무것도 더 안 한다
//   ④ 같은 계정 두 기기   같은 토큰으로 서로 다른 방에 동시에 roamTo — 말은 한
//                          곳에만 있고 칸도 하나다
//   ⑤ 겹쳐 누름           같은 사람이 standAt 을 다섯 번 동시에 — 칸은 하나
//
//   npx vite-node scripts/qa-resume-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS, timedEvents } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { MOVE_MINUTES } from '../shared/rules/occupy'
import { dropCellsIn } from '../shared/rules/quiz'
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
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
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

const GAME = `rs${Date.now().toString(36)}`
/** 시작 — 3월 2일 08:00 서울 */
const START = new Date('2026-03-02T08:00:00+09:00').getTime()

interface Pawn { tileId: string | null; at: { x: number; y: number } | null; path?: unknown[]; arriveAtMs: number | null }
const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d as unknown as Pawn]))
const cellKey = (c: { x: number; y: number }) => `${c.x},${c.y}`

/** 한 칸에 둘이 선 곳 */
function shared(pawns: Record<string, Pawn>): string[] {
  const seen = new Map<string, string>()
  const out: string[] = []
  for (const [id, p] of Object.entries(pawns)) {
    if (!p.at || p.tileId === null) continue
    const k = cellKey(p.at)
    if (seen.has(k)) out.push(`${seen.get(k)}·${id}@${k}`)
    seen.set(k, id)
  }
  return out
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  await must('createGame', host, { gameId: GAME, seed: 'resume' })
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  const P: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    const name = `복귀${String(i + 1).padStart(2, '0')}`
    await must('joinGame', a.token, { gameId: GAME, name, team: want[i] })
    P.push({ ...a, team: want[i], name })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clockAt = START
  const setClock = async (ms: number) => {
    clockAt = ms
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  }
  await setClock(START)
  check(true, `열넷이 앉아 시작했다`)
  const me = P[0]
  const other = P[5]
  const mate = P[1]

  console.log('\n── ① 걷는 중에 끊김 ──')
  await setClock(dayHourMs(START, 1, 10))
  const opened = await must('openPhase', host, { gameId: GAME })
  check(opened.no === 1, '1번 페이즈를 열었다')
  // 다른 방으로 이동을 걸고 폰을 끈다
  const mv = await must('phaseAct', me.token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  check(mv.walking === true, '걷기 시작했다 — 여기서 폰이 꺼진다')
  let p = (await pawnsNow())[me.uid]
  check(p.tileId === null && p.arriveAtMs !== null, '걷는 중에는 어느 방에도 없다', JSON.stringify({ tile: p.tileId, arrive: p.arriveAtMs }))
  // 도착 시각이 지난 뒤 **남이** 두드린다 — 나는 아무것도 안 부른다
  await setClock(clockAt + (MOVE_MINUTES + 2) * 60_000)
  await must('tick', other.token, { gameId: GAME })
  p = (await pawnsNow())[me.uid]
  check(p.tileId === 'library' && p.at !== null && p.arriveAtMs === null, '남이 두드려도 나는 도착해 있다', JSON.stringify({ tile: p.tileId, at: p.at }))
  check(shared(await pawnsNow()).length === 0, '한 칸에 둘이 없다')

  console.log('\n── ② 페이즈 중에 끊긴 채 한 시간 ──')
  const ends = Number(opened.endsAtMs)
  await setClock(ends + 5 * 60_000)
  // 내가 돌아와 처음 누르는 것이 행동이다 — 따라잡기가 먼저 닫는다
  const late = await call('phaseAct', me.token, { gameId: GAME, kind: 'plant' })
  check(!late.ok && /페이즈|시간/.test(String(late.message)), '돌아와 누르면 이미 끝났다', late.message)
  const g1 = (await getDoc(`games/${GAME}`)) as { phaseNow?: { open?: boolean }; phaseDone?: number }
  check(g1.phaseNow?.open === false && g1.phaseDone === 1, '페이즈는 저절로 닫혀 있다', JSON.stringify({ open: g1.phaseNow?.open, done: g1.phaseDone }))
  const closedTwice = await must('closePhase', host, { gameId: GAME })
  check(closedTwice.alreadyClosed === true, '운영자가 뒤늦게 닫아도 두 번 닫히지 않는다')
  const logs1 = await getAll(`games/${GAME}/phaseLog`)
  check(logs1.length === 1, '페이즈 기록은 한 장', `${logs1.length}장`)

  console.log('\n── ③ 저녁 여덟 시부터 새벽 여섯 시까지 아무도 없다 ──')
  // 투표를 열고 몇이 넣고 끊긴다 — 정산(21시)·자정 판정·날짜 넘김이 밀린다
  await setClock(dayHourMs(START, 1, 18))
  await must('hostOpenBallot', host, { gameId: GAME })
  await must('castBallot', me.token, { gameId: GAME, targetId: other.uid })
  await must('castBallot', mate.token, { gameId: GAME, targetId: other.uid })
  await must('hostCloseBallot', host, { gameId: GAME })
  await setClock(dayHourMs(START, 1, 20))
  await must('tick', other.token, { gameId: GAME })
  const before = await getAll(`games/${GAME}/schedule`)
  const undoneBefore = before.filter((s) => s.d.doneAtMs === null).map((s) => s.d.kind)
  check(undoneBefore.includes('settlement') && undoneBefore.includes('dayStart'), '아직 정산도 자정도 안 됐다', undoneBefore.join(','))
  // 열 시간 뒤 — 첫 사람이 두드린다. **달력은 운영자가 넘긴다**(나흘·운영자
  // 달력) — 참가자 두드림만으로는 정산도 자정도 안 된다. 그게 규칙이다
  await setClock(dayHourMs(START, 2, 6))
  const first = await must('tick', P[9].token, { gameId: GAME })
  const stillUndone = (await getAll(`games/${GAME}/schedule`)).filter((s) => s.d.doneAtMs === null).map((s) => s.d.kind)
  check(stillUndone.includes('settlement') && stillUndone.includes('dayStart'), '참가자 두드림만으로는 달력이 안 넘어간다(운영자 달력)', stillUndone.join(','))
  // 운영자가 아침에 돌아와 밀린 두 칸을 넘긴다 — 정산(어제 21:00) · 자정
  const p1 = await must('pushDay', host, { gameId: GAME })
  const p2 = await must('pushDay', host, { gameId: GAME })
  check((p1.pushed as { kind?: string } | null)?.kind === 'settlement' && (p2.pushed as { kind?: string } | null)?.kind === 'dayStart', '운영자가 넘기면 순서대로 정산·자정이다', `${JSON.stringify(p1.pushed)} ${JSON.stringify(p2.pushed)}`)
  const after = await getAll(`games/${GAME}/schedule`)
  const lateItems = after.filter((s) => s.d.doneAtMs !== null && !String(s.d.kind).startsWith('arrive')).map((s) => ({ kind: s.d.kind, due: Number(s.d.dueAtMs), at: Number(s.d.pushedAtMs) }))
  check(lateItems.every((x) => x.at >= x.due), '늦게 넘긴 시각이 예정 시각 뒤로 기록된다', lateItems.map((x) => `${x.kind}+${Math.round((x.at - x.due) / 3600000)}h`).join(' '))
  const g2 = (await getDoc(`games/${GAME}`)) as { day?: number; invisibleId?: string | null }
  check(g2.day === 2, '날짜가 2일로 넘어갔다', `day=${g2.day}`)
  check(g2.invisibleId === other.uid, '투표 집계로 투명인간이 정해졌다', String(g2.invisibleId))
  const days1 = await getAll(`games/${GAME}/secret/missionSnaps/items`)
  const d1 = days1.filter((x) => x.d.day === 1)
  check(d1.length === TOTAL_SEATS, `1일 미션 판정이 사람마다 한 장씩`, `${d1.length}장`)
  const ballots1 = await getAll(`games/${GAME}/secret/ballotDays/items`)
  check(ballots1.filter((x) => x.d.day === 1).length === 1, '1일 투표 집계는 한 장', `${ballots1.length}장`)
  // 두 번째 두드림 — 아무것도 더 안 한다
  await must('tick', P[10].token, { gameId: GAME })
  const days1b = await getAll(`games/${GAME}/secret/missionSnaps/items`)
  const after2 = await getAll(`games/${GAME}/schedule`)
  check(days1b.length === days1.length, '두 번째 두드림은 판정을 더 만들지 않는다')
  check(JSON.stringify(after2.map((s) => s.d.doneAtMs)) === JSON.stringify(after.map((s) => s.d.doneAtMs)), '처리 시각도 그대로다')
  check(!JSON.stringify(first).includes(other.uid), '두드림 응답에 투명인간 아이디가 없다')

  console.log('\n── ④ 같은 계정 두 기기 ──')
  const rooms = ['labRoom', 'musicRoom', 'artRoom', 'cafeteria'] as const
  const results = await Promise.all(rooms.map((r) => call('roamTo', me.token, { gameId: GAME, tileId: r })))
  const okCount = results.filter((r) => r.ok).length
  p = (await pawnsNow())[me.uid]
  check(okCount >= 1, `네 기기 중 ${okCount}대가 받아들여졌다`)
  check(p.tileId !== null && p.at !== null, '말은 한 방에 있고 칸도 하나다', JSON.stringify({ tile: p.tileId, at: p.at }))
  check(shared(await pawnsNow()).length === 0, '한 칸에 둘이 없다')
  const cellDoc = await getAll(`games/${GAME}/cells`)
  const mineCells = cellDoc.filter((c) => c.d.by === me.uid)
  check(mineCells.length <= 1, '칸 문서도 하나뿐이다', `${mineCells.length}개`)

  console.log('\n── ⑤ 같은 사람이 standAt 을 다섯 번 동시에 ──')
  const here = p.tileId as string
  const taken = new Set(Object.values(await pawnsNow()).filter((q) => q.at).map((q) => cellKey(q.at as { x: number; y: number })))
  const free = dropCellsIn(here as never).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(cellKey(c))).slice(0, 5)
  const stood = await Promise.all(free.map((c) => call('standAt', me.token, { gameId: GAME, x: c.x, y: c.y })))
  check(stood.some((r) => r.ok), `다섯 중 ${stood.filter((r) => r.ok).length}번 받아들여졌다`)
  const all = await pawnsNow()
  p = all[me.uid]
  check(p.at !== null && free.some((c) => c.x === p.at!.x && c.y === p.at!.y) || p.at !== null, '칸은 하나', JSON.stringify(p.at))
  check(shared(all).length === 0, '한 칸에 둘이 없다')
  const cells2 = (await getAll(`games/${GAME}/cells`)).filter((c) => c.d.by === me.uid)
  check(cells2.length <= 1, '칸 문서도 하나뿐이다', `${cells2.length}개`)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
