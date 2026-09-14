// 다섯 기록을 진짜 서버로.
//
// 개인 미션은 이 다섯 가지로만 판정한다 — 위치 · 같은 방에 있었던 사람 ·
// 거래 내역 · 쪽지 처리 · 로봇. 여기서 볼 것은 둘이다.
//
//   **일이 일어나면 한 줄이 쌓인다** — 안 쌓이면 미션이 영영 안 채워진다
//   **아무도 그 줄을 못 읽는다** — 다 보면 남이 무엇을 하려는지 역산된다
//
//   npx vite-node scripts/records-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { coStayMs, metPeople, tradedTeams, type GameRecord, type Stay } from '../shared/rules/records'
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



const GAME = `rc${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
/** 서버만 보는 기록. 시험이 확인하는 데만 쓴다. */
const recordsNow = async () =>
  (await getAll(`games/${GAME}/secret/records/items`)).map((r) => r.d as unknown as GameRecord)
const staysNow = async (): Promise<Stay[]> =>
  (await getAll(`games/${GAME}/secret/intervals/items`)).map((r) => ({
    playerId: String(r.d.playerId),
    tileId: (r.d.tileId ?? null) as string | null,
    startMs: Number(r.d.startMs),
    endMs: r.d.endMs === null || r.d.endMs === undefined ? null : Number(r.d.endMs),
  }))
const allSlips = async () => await getAll(`games/${GAME}/secret/slips/items`)

/**
 * 걷는 중인 사람들을 도착시킨다.
 *
 * 페이즈가 열리면 다들 전투 자리로 걸어 돌아가고, 그동안은 어느 방에도
 * 없다. 시계를 안 밀면 영영 문 사이에 있다 — 실제로 한 번 걸렸다.
 */
async function walk(tk: string, uid: string, goal: string, land?: (m: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < 12; i++) {
    let here = (await pawnsNow())[uid].tileId as string | null
    // 걷는 중이면 먼저 도착시킨다. 문 사이에서는 아무 데로도 못 간다
    if (here === null && land) {
      await land(15)
      here = (await pawnsNow())[uid].tileId as string | null
    }
    if (here === null || here === goal) return
    const next = stepToward(here, goal)
    if (!next) return
    await must('roamTo', tk, { gameId: GAME, tileId: next })
  }
}

let clockAt = 0
/** 말 하나를 원하는 자리에 놓는다. **시험 준비용** — 서버를 거치지 않는다. */
async function put(uid: string, fields: Record<string, unknown>): Promise<void> {
  const toValue = (v: unknown): unknown => {
    if (v === null) return { nullValue: null }
    if (typeof v === 'string') return { stringValue: v }
    if (typeof v === 'number') return { integerValue: String(v) }
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
    return { stringValue: String(v) }
  }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toValue(v)])) }),
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'rec' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  clockAt = clock
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
  /**
   * 시계를 밀어 걷는 사람들을 **끝까지** 도착시킨다.
   *
   * 한 번만 미는 것으로는 모자란다. 복귀 경로가 여러 칸이면 칸마다
   * 도착이 하나씩 잡혀 있어서, 한 번 밀면 한 칸만 간다 — 실제로
   * 그 때문에 한 사람이 영영 문 사이에 남았다.
   */
  const land = async (minutes: number): Promise<void> => {
    for (let round = 0; round < 8; round++) {
      const waiting = Object.values(await pawnsNow())
        .map((p) => Number(p.arriveAtMs ?? 0))
        .filter((n) => n > 0)
      // 첫 바퀴만 넉넉히 민다. 그 뒤로는 **실제로 잡혀 있는 도착
      // 시각까지만** — 매 바퀴 넉넉히 밀면 한 시간짜리 페이즈가
      // 도착을 기다리다 끝나 버린다
      const push = round === 0 ? clockAt + minutes * M : clockAt
      clockAt = Math.max(push, ...waiting) + 5_000
      await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
      await must('tick', host, { gameId: GAME })
      const stuck = Object.values(await pawnsNow()).filter((p) => p.tileId === null)
      if (stuck.length === 0) return
    }
  }
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  check(true, '판이 시작했다')
  check((await recordsNow()).length === 0, '처음에는 기록이 한 줄도 없다')

  console.log('\n── 아무도 기록을 못 읽는다 ──')
  for (const [who, tk] of [['플레이어', A[0].token], ['운영자', host]] as const) {
    for (const path of ['secret/records/items', 'secret/intervals/items']) {
      const r = await fetch(`${FS}/games/${GAME}/${path}`, { headers: { Authorization: `Bearer ${tk}` } })
      check(r.status === 403, `${who}가 ${path.split('/')[1]} 를 못 읽는다`, String(r.status))
    }
  }

  console.log('\n── 같은 방에 있었던 시간 ──')
  // A0 는 A기지에 서 있다. B0 를 그리로 보낸다
  const meet = (await pawnsNow())[A[0].uid].tileId as string
  await walk(B[0].token, B[0].uid, meet)
  check((await pawnsNow())[B[0].uid].tileId === meet, `둘이 ${meet} 에 같이 섰다`)

  // 게임 시계를 10분 민다. 구간이 그만큼 겹친다
  clock += 10 * M
  clockAt = clock
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
  const stays = await staysNow()
  const together = coStayMs(stays, A[0].uid, B[0].uid, clock)
  check(together >= 9 * M, '겹친 시간이 10분쯤 쌓인다', `${Math.round(together / M)}분`)
  check(metPeople(stays, A[0].uid, 1 * M, clock).includes(B[0].uid), '1분 넘게 만난 사람으로 센다')
  check(!metPeople(stays, A[0].uid, 1 * M, clock).includes(A[0].uid), '나는 안 든다')

  console.log('\n── 거래 한 줄 ──')
  const offered = await must('offerTrade', A[0].token, {
    gameId: GAME,
    toTeam: 'B',
    give: { money: 1 },
    want: {},
  })
  await must('respondTrade', B[0].token, { gameId: GAME, tradeId: offered.id, accept: true })
  const afterTrade = await recordsNow()
  const trade = afterTrade.find((r) => r.kind === 'trade')
  check(trade !== undefined, '거래가 한 줄 남았다')
  check(trade?.actorId === A[0].uid && trade?.otherId === B[0].uid, '양쪽이 다 적힌다')
  // 받기만 한 사람도 거래한 것으로 세어져야 한다
  check(tradedTeams(afterTrade, B[0].uid).includes('A'), '**받은 쪽도 거래한 것으로 센다**')
  check(tradedTeams(afterTrade, A[0].uid).includes('B'), '제안한 쪽도 센다')

  console.log('\n── 쪽지 처리 ──')
  await must('openPhase', host, { gameId: GAME })
  await land(15)
  await must('closePhase', host, { gameId: GAME })
  const floor = (await allSlips()).filter((s) => s.d.tileId !== null)
  check(floor.length > 0, '쪽지가 떨어졌다', `${floor.length}장`)
  const slip = floor[0]
  await walk(A[0].token, A[0].uid, String(slip.d.tileId), land)
  await must('takeSlip', A[0].token, { gameId: GAME, slipId: slip.id })
  await must('readSlip', A[0].token, { gameId: GAME, slipId: slip.id })
  await must('readSlip', A[0].token, { gameId: GAME, slipId: slip.id })

  let rows = await recordsNow()
  check(rows.filter((r) => r.kind === 'slipTake').length === 1, '주운 것이 한 줄')
  const reads = rows.filter((r) => r.kind === 'slipRead')
  check(reads.length === 1, '**두 번 읽어도 한 줄이다**', `${reads.length}줄`)
  check(reads[0]?.ownerId === slip.d.subjectId, '누구의 비밀인지가 적힌다')

  // 건네기 — 같은 방에 있는 B0 에게
  await walk(B[0].token, B[0].uid, String(slip.d.tileId), land)
  const pos = await pawnsNow()
  check(
    pos[A[0].uid].tileId === pos[B[0].uid].tileId,
    '둘이 같은 방에 섰다',
    `A0 ${pos[A[0].uid].tileId} · B0 ${pos[B[0].uid].tileId} · 쪽지 ${slip.d.tileId}`,
  )
  await must('giveSlip', A[0].token, { gameId: GAME, slipId: slip.id, toPlayerId: B[0].uid })
  rows = await recordsNow()
  const gave = rows.find((r) => r.kind === 'slipGive')
  check(gave?.otherId === B[0].uid && gave?.otherTeam === 'B', '건넨 상대와 그 팀이 적힌다')

  // 찢기 — B0 가 들고 있으니 B0 가 찢는다
  await must('tearSlip', B[0].token, { gameId: GAME, slipId: slip.id })
  rows = await recordsNow()
  const torn = rows.find((r) => r.kind === 'slipTear')
  check(torn?.actorId === B[0].uid, '찢은 사람이 적힌다')
  check(torn?.ownerId === slip.d.subjectId, '**누구의 쪽지를 찢었는지가 적힌다**')

  console.log('\n── 로봇 ──')
  // 연구실에 세워 둔다. **시험 준비라 자리를 직접 놓는다** — 걸어서
  // 가면 페이즈 복귀에 한 시간이 다 들어가고, 여기서 볼 것은 걸음이
  // 아니라 「로봇이 나면 한 줄 남는가」다
  const lab = 'mainBuilding'
  await put(A[1].uid, { tileId: lab, postTile: lab, path: [], arriveAtMs: null, fromTile: null })
  await must('openPhase', host, { gameId: GAME })
  const acted = await call('phaseAct', A[1].token, { gameId: GAME, kind: 'research' })
  check(acted.ok, '연구를 걸었다', acted.ok ? '' : `${acted.code} ${acted.message}`)
  await must('closePhase', host, { gameId: GAME })
  rows = await recordsNow()
  const born = rows.find((r) => r.kind === 'robotBorn')
  check(born !== undefined, '로봇이 난 것이 한 줄 남았다')
  check(born?.actorId === A[1].uid && born?.ownerId === A[1].uid, '만든 사람이 적힌다 — 심부름꾼이 이걸 본다')

  console.log('\n── 판정 재료가 응답에 안 섞인다 ──')
  const views = await getAll(`games/${GAME}/views`)
  for (const v of views) {
    const text = JSON.stringify(v.d)
    check(!text.includes('slipTear') && !text.includes('robotBorn'), `${v.id} 의 view 에 기록이 안 섞인다`)
  }

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  if (failures > 0) process.exit(1)
}

void main()
