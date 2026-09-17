// 팀장을 투표로 뽑는가. 진짜 서버로 본다.
//
//   ㆍ 하루가 열리면 네 팀에 한 차례씩 걸리고, 어제 팀장은 내려온다
//   ㆍ 상의 중에는 못 적고, 창이 열리면 적을 수 있다
//   ㆍ 우리 팀 사람만 적을 수 있다
//   ㆍ 창이 닫히면 최다가 팀장이 된다
//   ㆍ **동점이면 다시 건다** — 정해질 때까지 팀장이 없다
//   ㆍ 머릿수 두 배는 세 명인 팀의 팀장에게만 붙는다
//
//   npx vite-node scripts/captain-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'
import { CAPTAIN_NO, CAPTAIN_TALK_MINUTES, CAPTAIN_VOTE_MINUTES } from '../shared/rules/captain'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `cp${TAG}`
const PW = 'cppass1234'
const QA = `qacp${TAG}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const MIN = 60_000

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
const no = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message)
async function tok(id: string, password = PW): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const str = (v: unknown) => (v as { stringValue?: string })?.stringValue ?? null

async function doc(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
async function teamDoc(t: string) {
  const f = await doc(`games/${GAME}/teams/${t}`)
  const v = (f.captainVote as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields
  return {
    captainId: str(f.captainId),
    round: v ? Number((v.round as { integerValue?: string })?.integerValue ?? 0) : 0,
    opensAtMs: v ? Number((v.opensAtMs as { integerValue?: string })?.integerValue ?? 0) : 0,
    closesAtMs: v ? Number((v.closesAtMs as { integerValue?: string })?.integerValue ?? 0) : 0,
  }
}
/** 게임 시계를 그 시각으로 옮기고 한 번 따라잡는다. */
async function clockTo(host: string, ms: number): Promise<void> {
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await call('tick', host, { gameId: GAME })
}
/**
 * 그 팀의 투표 창이 열린 자리로 시계를 민다.
 *
 * 차례가 굴러갔으면 새 차례에 다시 맞춘다 — 창을 지나쳐 놓고 「왜 안
 * 열리지」를 보는 것이 이 프로브에서 제일 흔한 헛걸음이었다.
 */
async function openWindow(host: string, team: string) {
  for (let i = 0; i < 5; i++) {
    const d = await teamDoc(team)
    if (!d.round) throw new Error(`${team}팀에 차례가 없다`)
    await clockTo(host, d.opensAtMs + 60_000)
    const now = await teamDoc(team)
    if (now.round === d.round && !now.captainId) return now
  }
  throw new Error('창을 못 잡았다')
}

async function main(): Promise<void> {
  const he = `ch${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'cp' })

  // C팀은 세 명이다. 사람 셋을 거기 앉혀 표를 갈라 본다
  const ids = [`c1${TAG}`, `c2${TAG}`, `c3${TAG}`]
  for (const id of ids) await call('signUpAccount', null, { id, password: PW })
  for (const [i, id] of ids.entries()) {
    await call('joinGame', await tok(id), { gameId: GAME, name: `C${i + 1}`, team: 'C' })
  }
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  const [u1, u2, u3] = ids.map(uidOf)
  const [t1, t2, t3] = await Promise.all(ids.map((id) => tok(id)))

  console.log('\n── DAY 2 아침 — 네 팀에 한 차례씩 걸린다 ──')
  // **날은 시계가 밀지 않는다.** 운영자가 pushDay 로 넘긴다 — 아무도
  // 없는 사이에 닷새가 지나가 버리는 일을 막는 규칙이다
  const dawn = dayHourMs(START, 2, 8)
  await clockTo(host, dawn)
  for (let i = 0; i < 12; i++) {
    const peek = (await call('peekDay', host, { gameId: GAME })) as { next?: { kind?: string } | null }
    if (!peek.next) break
    await call('pushDay', host, { gameId: GAME })
    if (peek.next.kind === 'dayStart') break
  }
  for (const t of ['A', 'B', 'C', 'D']) {
    const d = await teamDoc(t)
    check(d.round === 1 && d.captainId === null, `${t}팀에 1번째 차례가 걸렸다`, `round=${d.round} 팀장=${d.captainId}`)
  }
  const c = await teamDoc('C')
  check(
    c.closesAtMs - c.opensAtMs === CAPTAIN_VOTE_MINUTES * MIN,
    `투표 창이 ${CAPTAIN_VOTE_MINUTES}분이다`,
  )


  console.log('\n── 상의 중에는 못 적는다 ──')
  check(
    (await no(call('voteCaptain', t1, { gameId: GAME, targetId: u2 }))).includes(CAPTAIN_NO.notOpen),
    '창이 열리기 전에는 거절한다',
  )

  console.log('\n── 창이 열린다 ──')
  const cOpen = await openWindow(host, 'C')
  check(cOpen.captainId === null, '창이 열렸고 아직 팀장이 없다', `round=${cOpen.round}`)
  check(
    (await no(call('voteCaptain', t1, { gameId: GAME, targetId: uidOf(he) }))).includes(CAPTAIN_NO.otherTeam),
    '우리 팀 사람만 적을 수 있다',
  )
  // 셋이 서로를 가리킨다 — 1·1·1
  await call('voteCaptain', t1, { gameId: GAME, targetId: u2 })
  await call('voteCaptain', t2, { gameId: GAME, targetId: u3 })
  await call('voteCaptain', t3, { gameId: GAME, targetId: u1 })

  console.log('\n── 창이 닫힌다 — 동점이라 다시 건다 ──')
  const closed = cOpen.closesAtMs
  await clockTo(host, closed + 60_000)
  const c2 = await teamDoc('C')
  check(c2.captainId === null, '아무도 팀장이 안 됐다')
  check(c2.round === cOpen.round + 1, '다음 차례가 걸렸다', `round=${c2.round}`)
  // 다시 걸 때는 **그 자리에서부터** 상의 시간을 새로 준다
  // 배속 1로 도는 시계라 재는 사이에도 흐른다. 분 단위로 본다
  const talk = Math.round((c2.opensAtMs - (closed + 60_000)) / MIN)
  check(
    talk === CAPTAIN_TALK_MINUTES,
    `다시 걸 때도 상의가 ${CAPTAIN_TALK_MINUTES}분 먼저다`,
    `${talk}분`,
  )

  console.log('\n── 두 번째 — 둘이 한 사람을 적는다 ──')
  const c2open = await openWindow(host, 'C')
  await call('voteCaptain', t1, { gameId: GAME, targetId: u2 })
  await call('voteCaptain', t3, { gameId: GAME, targetId: u2 })
  await call('voteCaptain', t2, { gameId: GAME, targetId: u1 })
  await clockTo(host, c2open.closesAtMs + 60_000)
  const c3 = await teamDoc('C')
  check(c3.captainId === u2, '최다가 팀장이 됐다', String(c3.captainId))
  check(c3.round === 0, '차례가 끝났다')

  console.log('\n── 머릿수 두 배는 세 명인 팀의 팀장만 ──')
  const pawn = await doc(`games/${GAME}/pawns/${u2}`)
  check((pawn.captain as { booleanValue?: boolean })?.booleanValue === true, 'C팀(3명) 팀장은 둘로 센다')
  const aTeam = await teamDoc('A')
  if (aTeam.captainId) {
    const ap = await doc(`games/${GAME}/pawns/${aTeam.captainId}`)
    check(
      (ap.captain as { booleanValue?: boolean })?.booleanValue !== true,
      'A팀(4명) 팀장은 하나로 센다',
    )
  } else {
    check(true, 'A팀은 아직 못 정했다 — 4인 팀이라 어차피 두 배는 없다')
  }

  console.log('\n── 정해진 뒤에는 못 적는다 ──')
  check(
    (await no(call('voteCaptain', t1, { gameId: GAME, targetId: u1 }))).includes(CAPTAIN_NO.settled),
    '이미 정해졌다고 거절한다',
  )

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
