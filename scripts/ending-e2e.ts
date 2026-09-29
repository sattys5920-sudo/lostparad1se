// 엔딩은 운영자가 누르는 버튼 하나다. 화면은 A의 마지막 쪽지 한 장을
// 전원에게 같은 순간 튼다.
//
// 제일 중요한 확인은 셋이다. **종례 전에는 한 줄도 안 나간다.**
// **운영자만 송출한다.** 그리고 **「못 본 사람만」과 「전원」이 다르게
// 움직인다** — 하나는 이미 본 사람을 건드리지 않고, 하나는 전원을 다시 튼다.
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { FINAL_NOTE_LINES } from '../functions/src/story/finalNote'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { Authorization: 'Bearer owner' }
let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
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
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const GAME = `end${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'end' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  const me = people[0]
  const other = people[1]
  check(true, '판이 시작했다')

  console.log('\n── 종례 전에는 ──')
  await clock(dayHourMs(START, 1, 12))
  const early = await call('finalNoteText', me.token, { gameId: GAME })
  check(early.code === 'FAILED_PRECONDITION', 'DAY 1에는 문장을 안 준다', early.message)
  check(!JSON.stringify(early).includes(FINAL_NOTE_LINES[0]), '거절 응답에도 문장이 없다')

  const earlyBroadcast = await call('hostBroadcastEnding', host, { gameId: GAME, mode: 'all' })
  check(earlyBroadcast.code === 'FAILED_PRECONDITION', '운영자도 끝나기 전에는 송출을 못 누른다', earlyBroadcast.message)

  const earlyStatus = (await must('hostEndingStatus', host, { gameId: GAME })) as { finished: boolean; broadcast: unknown }
  check(earlyStatus.finished === false && earlyStatus.broadcast === null, '끝나기 전 상태는 finished:false, 송출 없음')

  console.log('\n── 권한 ──')
  const notHostBroadcast = await call('hostBroadcastEnding', me.token, { gameId: GAME, mode: 'all' })
  check(notHostBroadcast.code === 'PERMISSION_DENIED', '참가자는 송출을 못 누른다', notHostBroadcast.code)
  const notHostStatus = await call('hostEndingStatus', me.token, { gameId: GAME })
  check(notHostStatus.code === 'PERMISSION_DENIED', '참가자는 송출 상태를 못 본다', notHostStatus.code)

  console.log('\n── 종례 뒤 ──')
  // **시계가 판을 끝내지 않는다.** 달력 칸은 운영자가 하나씩 민다 —
  // 닷새치를 다 밀어야 phase 가 finished 가 된다
  await clock(dayHourMs(START, 5, 25))
  await must('tick', me.token, { gameId: GAME })
  for (let i = 0; i < 40; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { phase?: string; pushed?: string | null }
    if (r.phase === 'finished' || r.pushed === null) break
  }
  const finishedStatus = (await must('hostEndingStatus', host, { gameId: GAME })) as { finished: boolean }
  check(finishedStatus.finished === true, '판이 끝났다')

  const lines = (await must('finalNoteText', me.token, { gameId: GAME })) as { lines: string[] }
  check(JSON.stringify(lines.lines) === JSON.stringify(FINAL_NOTE_LINES), '문장은 고정이고 누구에게나 같다')
  const linesOther = (await must('finalNoteText', other.token, { gameId: GAME })) as { lines: string[] }
  check(JSON.stringify(linesOther.lines) === JSON.stringify(lines.lines), '다른 사람에게도 같은 문장')

  console.log('\n── 송출 ──')
  const first = (await must('hostBroadcastEnding', host, { gameId: GAME, mode: 'all' })) as { atMs: number; pingMs: number }
  check(first.atMs === first.pingMs, '첫 송출은 atMs 와 pingMs 가 같다')

  const s0 = (await must('hostEndingStatus', host, { gameId: GAME })) as { seenCount: number; total: number; broadcast: { atMs: number } }
  check(s0.broadcast.atMs === first.atMs, '송출 시각이 상태에 반영된다')
  check(s0.seenCount === 0, '아직 아무도 안 봤다', `${s0.seenCount}`)
  check(s0.total === TOTAL_SEATS, '전체 인원이 좌석 수와 같다')

  await must('markEndingSeen', me.token, { gameId: GAME })
  const s1 = (await must('hostEndingStatus', host, { gameId: GAME })) as { seenCount: number }
  check(s1.seenCount === 1, '본 사람이 하나 늘었다', `${s1.seenCount}`)

  console.log('\n── 못 본 사람만 다시 송출 ──')
  await sleep(5)
  const unseen = (await must('hostBroadcastEnding', host, { gameId: GAME, mode: 'unseen' })) as { atMs: number; pingMs: number }
  check(unseen.atMs === first.atMs, '「못 본 사람만」은 atMs 를 그대로 둔다')
  check(unseen.pingMs > first.pingMs, '「못 본 사람만」도 ping 은 새로 울린다')
  const s2 = (await must('hostEndingStatus', host, { gameId: GAME })) as { seenCount: number }
  check(s2.seenCount === 1, '「못 본 사람만」은 이미 본 사람 수를 안 건드린다', `${s2.seenCount}`)

  console.log('\n── 전원 다시 송출 ──')
  await sleep(5)
  const again = (await must('hostBroadcastEnding', host, { gameId: GAME, mode: 'all' })) as { atMs: number; pingMs: number }
  check(again.atMs > first.atMs, '「전원」은 atMs 를 새로 올린다')
  const s3 = (await must('hostEndingStatus', host, { gameId: GAME })) as { seenCount: number }
  check(s3.seenCount === 0, '「전원」 뒤에는 이미 본 사람도 다시 못 본 사람으로 친다', `${s3.seenCount}`)

  await must('markEndingSeen', me.token, { gameId: GAME })
  const s4 = (await must('hostEndingStatus', host, { gameId: GAME })) as { seenCount: number }
  check(s4.seenCount === 1, '다시 본 뒤에는 다시 센다', `${s4.seenCount}`)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
