// 자정 판정 — 날이 바뀌면 열넷을 판정해 날짜별로 남기는가.
//
//   - 날이 바뀌기 전에는 판정이 없다
//   - 미션은 하루짜리 — DAY 1 → 2 로 넘기면 DAY 1 판정 열넷(달성 · 실패)
//   - 매일 0부터 센다. 오늘 한 일 · 오늘 받은 표는 어제 판정에 안 들어가고,
//     어제 한 일은 오늘 판정에 안 들어간다
//   - 빠진 날을 누가 두드릴 때 날짜순으로 따라잡는다 — 그날 밤까지만 센다
//   - 참가자는 판정 문서를 못 읽고, 화면 문서에도 안 섞인다
//   - 마지막 날 판정이 최종이다(진행 중 · 끝날 때 판정이 없다)
//
//   npx vite-node scripts/mission-days-e2e.ts   (에뮬레이터가 떠 있어야 한다)
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


const GAME = `md${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

interface Clause { kind: string; have: number | null; bar: number; status: string }
interface Snap {
  day: number
  playerId: string
  roleId: string
  final: boolean
  asOfMs: number
  truth: { status: string; clauses: Clause[] }
  view: { status: string; clauses: Clause[]; choice: string }
}
interface DayOut { days: { day: number; final: boolean }[]; day: number | null; rows: Snap[] }

async function plant(path: string, fields: Record<string, unknown>): Promise<void> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number'
      ? { integerValue: String(v) }
      : typeof v === 'boolean'
        ? { booleanValue: v }
        : v === null
          ? { nullValue: null }
          : { stringValue: String(v) }
  const r = await fetch(`${FS}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`심기 실패 ${path}: ${r.status}`)
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'md' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })

  const roster = plain(await (await fetch(`${FS}/games/${GAME}/secret/roster/items?pageSize=50`, { headers: ADMIN })).json()) as {
    documents: { fields: Record<string, unknown> }[]
  }
  const rows = ((roster as unknown as { documents: Record<string, unknown>[] }).documents ?? []).map((d) => plain(d) as { playerId: string; roleId: string; team: TeamId })
  const who = (role: string) => rows.find((r) => r.roleId === role) as { playerId: string; team: TeamId }
  const duty = who('duty')
  const model = who('model')
  const backseat = who('backseat')
  const voterOf = (not: TeamId) => people.find((p) => p.team !== not) as { uid: string; team: TeamId }
  check(rows.length === 14, '열넷이 역할을 받았다', `${rows.length}`)

  const day = async (d?: number): Promise<DayOut> => (await must('hostMissionDay', host, { gameId: GAME, ...(d ? { day: d } : {}) })) as unknown as DayOut
  const rowOf = (out: DayOut, id: string) => out.rows.find((r) => r.playerId === id) as Snap
  const pushTo = async (kind: string, d: number) => {
    for (let i = 0; i < 20; i++) {
      const r = (await must('pushDay', host, { gameId: GAME })) as { pushed: { kind: string; day: number } | null; phase: string }
      if (!r.pushed || (r.pushed.kind === kind && r.pushed.day === d)) return
    }
  }
  const errand = (atMs: number) =>
    plant(`games/${GAME}/secret/records/items`, { kind: 'errandDone', atMs, actorId: duty.playerId, actorTeam: duty.team })
  // 주번 미션은 「자물쇠 2 · 심부름 1」이다. 조항 0 이 자물쇠, 1 이 심부름
  const lockRec = (atMs: number) =>
    plant(`games/${GAME}/secret/records/items`, { kind: 'roomLock', atMs, actorId: duty.playerId, actorTeam: duty.team })
  const trust = async (d: number, atMs: number) => {
    const v = voterOf(model.team)
    await plant(`games/${GAME}/secret/votes/items`, {
      day: d, voterId: v.uid, voterTeam: v.team, targetId: model.playerId, targetTeam: model.team, kind: 'trust', castAtMs: atMs, settled: false,
    })
  }

  console.log('\n── DAY 1 — 자정 전에는 판정이 없다 ──')
  const d1noon = dayHourMs(START, 1, 12)
  await clock(d1noon)
  // 시계 **앞**으로 찍는다 — 넘기는 순간(pushedAtMs)보다 뒤면 그날 밤 판정에서 잘린다
  await errand(d1noon - 2000)
  await errand(d1noon - 1000)
  await lockRec(d1noon - 1500)
  await lockRec(d1noon - 500)
  await trust(1, d1noon)
  const before = await day()
  check(before.day === null && before.rows.length === 0, '날이 바뀌기 전에는 판정이 없다')

  console.log('\n── DAY 2 로 넘긴다 — DAY 1 자정 판정 ──')
  await pushTo('dayStart', 2)
  const one = await day(1)
  check(one.rows.length === 14, 'DAY 1 판정이 열넷 몫이다', `${one.rows.length}`)
  const dutyOne = rowOf(one, duty.playerId)
  check(dutyOne.truth.status === 'met' && dutyOne.truth.clauses[1].have === 2, '주번: 그날 자물쇠 2 · 심부름 2 — 달성', `${dutyOne.truth.status} ${dutyOne.truth.clauses[1].have}`)
  check(rowOf(one, model.playerId).truth.clauses[0].have === 1 && rowOf(one, model.playerId).truth.status === 'failed', '모범생: 그날 표 1장 — 실패')
  check(rowOf(one, backseat.playerId).truth.status === 'failed', '뒷자리: 그날 적은 이름이 안 지워졌다 — 실패', rowOf(one, backseat.playerId).truth.status)
  check(one.rows.every((r) => r.truth.status === 'met' || r.truth.status === 'failed'), '자정 판정에는 진행 중이 없다 — 그날로서는 최종이다')
  check(one.rows.every((r) => !r.final), 'DAY 1 은 최종이 아니다')

  console.log('\n── DAY 2 — 하루 경계 전에는 전날 판정이 안 바뀐다 ──')
  const d2noon = dayHourMs(START, 2, 12)
  await clock(d2noon)
  await errand(d2noon - 2000)
  await errand(d2noon - 1000)
  await trust(2, d2noon)
  const oneAgain = await day(1)
  check(rowOf(oneAgain, duty.playerId).truth.clauses[1].have === 2, '오늘 한 일은 어제 판정에 안 들어간다')
  check(rowOf(oneAgain, model.playerId).truth.clauses[0].have === 1, '모범생: 오늘 받은 표는 하루가 바뀌기 전에 안 오른다')

  await pushTo('dayStart', 3)
  const two = await day(2)
  check(rowOf(two, duty.playerId).truth.clauses[1].have === 2, '주번: 매일 0부터 — 어제 두 번은 오늘 안 센다', `${rowOf(two, duty.playerId).truth.clauses[1].have}`)
  check(rowOf(two, model.playerId).truth.clauses[0].have === 1, '모범생: 오늘 받은 1장만 — 어제 표는 안 센다')

  console.log('\n── 밀린 자정을 따라잡는다 ──')
  const d3noon = dayHourMs(START, 3, 12)
  await clock(d3noon)
  await errand(d3noon - 1000)
  // DAY 2 판정을 지운 것처럼 만든다 — 표시와 스냅샷을 걷고, 게임 문서를 1까지로
  await fetch(`${FS}/games/${GAME}/secret/missionDays/items/d2`, { method: 'DELETE', headers: ADMIN })
  for (const r of two.rows) await fetch(`${FS}/games/${GAME}/secret/missionSnaps/items/d2_${r.playerId}`, { method: 'DELETE', headers: ADMIN })
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=missionJudgedThrough`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { missionJudgedThrough: { integerValue: '1' } } }),
  })
  await must('tick', people[0].token, { gameId: GAME })
  const twoAgain = (await fetch(`${FS}/games/${GAME}/secret/missionDays/items/d2`, { headers: ADMIN })).ok
  check(twoAgain, '누가 두드리면 빠진 DAY 2 를 다시 판정한다')
  const re = await day(2)
  check(re.rows.length === 14, '열넷 몫이 다시 생겼다')
  check(rowOf(re, duty.playerId).truth.clauses[1].have === 2, '따라잡아도 그날 하루만 센다 — DAY 3 심부름은 안 들어간다', `${rowOf(re, duty.playerId).truth.clauses[1].have}`)

  console.log('\n── 새는 것 ──')
  const p = people[3]
  const direct = await fetch(`${FS}/games/${GAME}/secret/missionSnaps/items/d1_${p.uid}`, { headers: { Authorization: `Bearer ${p.token}` } })
  check(direct.status === 403, '참가자는 판정 문서를 직접 못 읽는다(제 것도)', `${direct.status}`)
  const notHost = await call('hostMissionDay', p.token, { gameId: GAME })
  check(notHost.code === 'PERMISSION_DENIED', '참가자는 운영자 판정을 못 부른다', notHost.code)
  let leaks = 0
  for (const x of people) {
    const v = await fetch(`${FS}/games/${GAME}/views/${x.uid}`, { headers: { Authorization: `Bearer ${x.token}` } })
    const t = await v.text()
    if (/missionSnaps|"truth"|invisibleHits|errandsDone|trustReceived/.test(t)) leaks += 1
  }
  check(leaks === 0, '열넷 누구의 화면 문서에도 판정이 없다', `${leaks}`)

  console.log('\n── 뒤집기 · 보내기 · 우편함 ──')
  const [p1, p2] = people
  const inboxOf = async (who: { uid: string }, tk: string) =>
    fetch(`${FS}/games/${GAME}/inbox/${who.uid}`, { headers: { Authorization: `Bearer ${tk}` } })
  check((await inboxOf(p1, p1.token)).status === 404, '보내기 전에는 우편함이 비어 있다')
  const noReason = await call('hostMissionOverride', host, { gameId: GAME, day: 1, playerId: p1.uid, status: 'met', reason: '' })
  check(!noReason.ok, '까닭 없이는 못 뒤집는다', noReason.message)
  const flip = await call('hostMissionOverride', p1.token, { gameId: GAME, day: 1, playerId: p1.uid, status: 'met', reason: '나' })
  check(flip.code === 'PERMISSION_DENIED', '참가자는 못 뒤집는다', flip.code)
  await must('hostMissionOverride', host, { gameId: GAME, day: 1, playerId: p1.uid, status: 'met', reason: '기록이 빠졌다' })
  const d1 = await day(1)
  const r1 = rowOf(d1, p1.uid) as unknown as { override: { status: string; reason: string } | null }
  check(r1.override?.status === 'met' && r1.override.reason === '기록이 빠졌다', '뒤집은 값과 까닭이 남는다')
  const sendOne = (await must('hostMissionSend', host, { gameId: GAME, day: 1, playerIds: [p1.uid] })) as { sent: number }
  check(sendOne.sent === 1, '한 사람에게만 보낸다')
  const mine = await inboxOf(p1, p1.token)
  const mailText = await mine.text()
  check(mine.status === 200, '받은 사람은 제 우편함을 읽는다', String(mine.status))
  const mail = (plain(JSON.parse(mailText)) as { missions?: Record<string, { status: string; day: number; roleName: string }> }).missions?.d1
  check(mail?.status === 'met' && mail.day === 1, '뒤집은 결과가 간다', JSON.stringify(mail?.status))
  check(!/기록이 빠졌다|"truth"|reason|byId/.test(mailText), '까닭 · 운영자 판(truth)은 안 간다')
  check((await inboxOf(p1, p2.token)).status === 403, '남의 우편함은 못 읽는다')
  check((await inboxOf(p2, p2.token)).status === 404, '안 보낸 사람에게는 아무것도 없다')
  await must('seenMissionDay', p1.token, { gameId: GAME, day: 1 })
  const seen = plain(JSON.parse(await (await inboxOf(p1, p1.token)).text())) as { seen?: Record<string, boolean> }
  check(seen.seen?.d1 === true, '닫으면 다시 안 뜬다')
  const all = (await must('hostMissionSend', host, { gameId: GAME, day: 1 })) as { sent: number }
  check(all.sent === people.length, '전부 보낸다', String(all.sent))
  const again = plain(JSON.parse(await (await inboxOf(p1, p1.token)).text())) as { seen?: Record<string, boolean> }
  check(again.seen?.d1 !== true, '다시 보내면 팝업이 다시 뜬다')
  const logd = (await day(1)) as unknown as { log: { kind: string }[] }
  check(logd.log.filter((l) => l.kind === 'send').length === 2 && logd.log.some((l) => l.kind === 'override'), '뒤집기 · 보내기가 기록에 남는다')

  console.log('\n── 모두에게 공개 — 이름과 성공/실패만 ──')
  const boardByPlayer = await call('hostMissionBoard', p1.token, { gameId: GAME, day: 1 })
  check(!boardByPlayer.ok, '플레이어는 공개하지 못한다', boardByPlayer.message ?? '했다')
  const noDay = await call('hostMissionBoard', host, { gameId: GAME, day: 3 })
  check(!noDay.ok, '판정이 없는 날은 공개하지 못한다', noDay.message ?? '했다')
  const board = (await must('hostMissionBoard', host, { gameId: GAME, day: 1 })) as { met: number; failed: number }
  check(board.met + board.failed === people.length, '열넷 전부 한 줄씩', `성공 ${board.met} · 실패 ${board.failed}`)
  // **플레이어의 증표로** 판 문서를 읽는다 — 누구나 읽는 문서라 여기 든 것이 곧 공개된 것이다
  const gameRaw = await (await fetch(`${FS}/games/${GAME}`, { headers: { Authorization: `Bearer ${people[5].token}` } })).text()
  const gameDoc = plain(JSON.parse(gameRaw)) as { missionBoards?: Record<string, { rows: { playerId: string; met: boolean }[]; day: number }> }
  const b1 = gameDoc.missionBoards?.d1
  check(b1?.day === 1 && b1.rows.length === people.length, '아무나 판 문서에서 읽는다', String(b1?.rows.length))
  check(b1?.rows.find((r) => r.playerId === p1.uid)?.met === true, '뒤집은 판정은 뒤집은 값으로 나간다')
  const boardJson = JSON.stringify(gameDoc.missionBoards)
  const leaky = ['roleId', 'clauses', 'truth', 'line', 'have', 'status'].filter((k) => boardJson.includes(`"${k}"`))
  check(leaky.length === 0, '역할 · 조항 · 숫자는 안 실린다', leaky.join(', '))
  check(!['반장', '모범생', '짝사랑', '뒷자리', '전학생'].some((w) => boardJson.includes(w)), '역할 이름도 없다')
  const boardLog = (await day(1)) as unknown as { log: { kind: string }[] }
  check(boardLog.log.some((l) => l.kind === 'board'), '공개도 기록에 남는다')

  console.log('\n── 마지막 날 — 최종 판정 ──')
  for (let i = 0; i < 40; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { phase: string; pushed: unknown }
    if (r.phase === 'finished' || r.pushed === null) break
  }
  const last = await day()
  check(last.days.map((x) => x.day).join(',') === '1,2,3,4', '날마다 판정이 남아 있다 — 나중에 다시 볼 수 있다', last.days.map((x) => x.day).join(','))
  check(last.day === 4 && last.rows.every((r) => r.final), 'DAY 4 판정이 최종이다')
  check(last.rows.every((r) => r.truth.status === 'met' || r.truth.status === 'failed'), '최종에는 진행 중 · 끝날 때 판정이 없다')
  check(rowOf(last, backseat.playerId).truth.clauses[0].status === 'met', '뒷자리: 투표가 없는 마지막 날은 달성으로 친다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
