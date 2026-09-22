// 투명인간 투표를 진짜 서버로.
//
// 볼 것은 하나다. **누가 누구를 적었는지가 아무에게도 안 나간다.**
// 본인에게는 자기가 적은 한 줄만, 남에게는 아무것도. 득표수도 안 나간다 —
// 「몇 표였다」가 새면 누가 적었는지를 좁혀 나갈 수 있다.
//
// 그리고 지워진 사람이 무엇을 못 하고 무엇을 할 수 있는지.
//
//   npx vite-node scripts/ballot-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { INVISIBLE_TEAM_TOKEN_BONUS } from '../shared/rules/v2'
import { stepToward } from '../shared/rules/occupy'

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




const GAME = `bl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
const gameNow = async () => (await getAll('games')).find((g) => g.id === GAME)?.d ?? {}
const noticesNow = async () => (await getAll(`games/${GAME}/notices`)).map((n) => n.d)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'ballot' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clockAt = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
  const land = async (minutes: number): Promise<void> => {
    for (let round = 0; round < 8; round++) {
      const waiting = Object.values(await pawnsNow()).map((p) => Number(p.arriveAtMs ?? 0)).filter((n) => n > 0)
      clockAt = Math.max(round === 0 ? clockAt + minutes * M : clockAt, ...waiting) + 5_000
      await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
      await must('tick', host, { gameId: GAME })
      if (Object.values(await pawnsNow()).every((p) => p.tileId !== null)) return
    }
  }
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  check(true, '판이 시작했다')

  console.log('\n── 적을 수 있는 사람 ──')
  const self = await call('castBallot', A[0].token, { gameId: GAME, targetId: A[0].uid })
  check(self.code === 'FAILED_PRECONDITION', '나 자신은 못 적는다', String(self.code))

  // C팀은 셋이라 주장이 있다. 그 사람은 못 적는다
  const capC = (await getAll(`games/${GAME}/teams`)).find((t) => t.id === 'C')?.d.captainId as string | null
  if (capC) {
    const cap = await call('castBallot', A[0].token, { gameId: GAME, targetId: capC })
    check(cap.code === 'FAILED_PRECONDITION', '팀장은 못 적는다', String(cap.code))
  } else {
    check(false, 'C팀 주장을 못 찾았다')
  }

  await must('castBallot', A[0].token, { gameId: GAME, targetId: A[1].uid })
  check(true, '**같은 팀 사람도 적을 수 있다**')

  console.log('\n── 적은 것은 나만 본다 ──')
  check((await viewOf(A[0].uid)).myBallot === A[1].uid, '본인에게는 자기가 적은 한 줄이 온다')
  for (const who of [A[1], B[0], C[0]]) {
    check((await viewOf(who.uid)).myBallot === null, `${who.team}팀 사람에게는 안 온다`)
  }
  // 적힌 당사자에게도 안 보인다. 같은 팀이라 visiblePawns 에는
  // 당연히 있으므로, 표에 관한 자리만 본다
  const named = await viewOf(A[1].uid)
  check(named.myBallot === null, '적힌 사람에게도 표 자리는 비어 있다')
  check(!('ballots' in named) && !('myBallots' in named), '표 목록 자체가 안 내려간다')

  for (const [who, tk] of [['플레이어', A[0].token], ['운영자', host]] as const) {
    const r = await fetch(`${FS}/games/${GAME}/secret/ballots/items`, { headers: { Authorization: `Bearer ${tk}` } })
    check(r.status === 403, `${who}도 표 문서를 직접 못 읽는다`, String(r.status))
  }

  console.log('\n── 마감 전까지 바꾼다 ──')
  await must('castBallot', A[0].token, { gameId: GAME, targetId: B[0].uid })
  check((await viewOf(A[0].uid)).myBallot === B[0].uid, '마지막에 적은 이름만 남는다')
  const rows = await getAll(`games/${GAME}/secret/ballots/items`)
  check(rows.filter((r) => r.d.voterId === A[0].uid).length === 1, '두 장이 되지 않는다', `${rows.length}장`)

  console.log('\n── 하루가 끝나면 한 명이 정해진다 ──')
  // B0 에게 두 표, C0 에게 한 표 — 갈리지 않게
  await must('castBallot', A[1].token, { gameId: GAME, targetId: B[0].uid })
  await must('castBallot', C[0].token, { gameId: GAME, targetId: B[1].uid })
  // 하루 열 페이즈를 다 돌린다
  for (let i = 0; i < 10; i++) {
    await must('openPhase', host, { gameId: GAME })
    await land(11)
    await must('closePhase', host, { gameId: GAME })
  }
  const g = await gameNow()
  check(g.invisibleId === B[0].uid, '가장 많이 적힌 사람이 지워진다', String(g.invisibleId))
  check(g.invisibleTeam === 'B', '그 팀이 기록된다', String(g.invisibleTeam))

  const said = await noticesNow()
  const all = said.filter((n) => n.toPlayerId === null).map((n) => String(n.text))
  check(all.some((t) => t.includes('오늘의 투명인간은')), '전원에게 한 줄 발표된다')
  check(!all.some((t) => /\d+표/.test(t)), '**득표수는 발표되지 않는다**')
  const onlyMine = said.filter((n) => n.toPlayerId === B[0].uid).map((n) => String(n.text))
  check(onlyMine.some((t) => t.includes('보이지 않습니다')), '본인에게만 따로 안내가 간다')

  console.log('\n── 지워진 사람이 할 수 없는 일 ──')
  await land(11)
  const where = (await pawnsNow())[B[0].uid].tileId as string
  // 같은 방에 A0 를 보낸다
  for (let i = 0; i < 10; i++) {
    const here = (await pawnsNow())[A[0].uid].tileId as string | null
    if (here === null) { await land(11); continue }
    if (here === where) break
    const next = stepToward(here, where)
    if (!next) break
    await must('roamTo', A[0].token, { gameId: GAME, tileId: next })
  }

  const tradeOut = await call('offerTrade', B[0].token, {
    gameId: GAME, toPlayerId: A[0].uid, give: { money: 1 }, want: {},
  })
  check(tradeOut.code === 'FAILED_PRECONDITION', '거래를 걸 수 없다', String(tradeOut.code))
  const tradeIn = await call('offerTrade', A[0].token, {
    gameId: GAME, toPlayerId: B[0].uid, give: { money: 1 }, want: {},
  })
  check(tradeIn.code === 'FAILED_PRECONDITION', '**남이 거는 것도 막힌다**', String(tradeIn.code))

  const voteOut = await call('castVote', B[0].token, { gameId: GAME, targetId: A[0].uid, kind: 'trust' })
  check(voteOut.ok === false, '표를 줄 수 없다', String(voteOut.code))
  const voteIn = await call('castVote', A[0].token, { gameId: GAME, targetId: B[0].uid, kind: 'trust' })
  check(voteIn.ok === false, '표를 받을 수도 없다', String(voteIn.code))

  console.log('\n── 지워진 사람이 할 수 있는 일 ──')
  // 팀장이 아닌 사람을 고른다. 팀장은 누구도 못 적는다
  const freeTarget = people.find((p) => p.uid !== B[0].uid && p.uid !== capC) as (typeof people)[number]
  const ballotStill = await call('castBallot', B[0].token, { gameId: GAME, targetId: freeTarget.uid })
  check(ballotStill.ok, '투명인간 투표는 던질 수 있다', ballotStill.ok ? '' : `${ballotStill.code} ${ballotStill.message}`)
  const neighbours = (await pawnsNow())[B[0].uid].tileId as string
  const step = stepToward(neighbours, 'centralPlaza')
  if (step) {
    const roam = await call('roamTo', B[0].token, { gameId: GAME, tileId: step })
    check(roam.ok, '돌아다닐 수 있다', roam.ok ? '' : String(roam.code))
  }

  console.log('\n── 남에게는 위치가 아예 안 간다 ──')
  for (const who of [A[0], C[0]]) {
    const v = await viewOf(who.uid)
    const seen = ((v.visiblePawns ?? []) as { playerId: string }[]).map((p) => p.playerId)
    check(!seen.includes(B[0].uid), `${who.team}팀 사람 화면에 없다`)
  }
  const mate = await viewOf(B[1].uid)
  check(
    !((mate.visiblePawns ?? []) as { playerId: string }[]).some((p) => p.playerId === B[0].uid),
    '**같은 팀에게도 안 보인다**',
  )

  console.log('\n── 팀 토큰 보정 ──')
  // 상자는 팀에 하나다. 보정도 통째로 상자에 들어간다
  const boxOf = async (t: string) =>
    Number((await getAll(`games/${GAME}/teams`)).find((x) => x.id === t)?.d.phaseTokens ?? 0)
  const before = await boxOf('B')
  await must('openPhase', host, { gameId: GAME })
  const after = await boxOf('B')
  check(after > before, `투명인간이 나온 팀이 더 받는다 (팀 전체 ${INVISIBLE_TEAM_TOKEN_BONUS})`, `${before} → ${after}`)
  await must('closePhase', host, { gameId: GAME })

  console.log('\n── 운영자가 풀 수 있다 ──')
  const noReason = await call('clearInvisible', host, { gameId: GAME, reason: '  ' })
  check(noReason.code === 'INVALID_ARGUMENT', '사유 없이는 못 푼다', String(noReason.code))
  const asPlayer = await call('clearInvisible', A[0].token, { gameId: GAME, reason: '아무거나' })
  check(asPlayer.code === 'PERMISSION_DENIED', '플레이어는 못 푼다', String(asPlayer.code))
  await must('clearInvisible', host, { gameId: GAME, reason: '본인이 힘들어해서' })
  check(((await gameNow()).invisibleId ?? null) === null, '풀린다')
  const events = (await getAll(`games/${GAME}/events`)).map((e) => e.d)
  check(
    events.some((e) => e.kind === 'invisibleCleared' && String(JSON.stringify(e)).includes('힘들어해서')),
    '사유가 기록에 남는다',
  )

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  if (failures > 0) process.exit(1)
}

void main()
