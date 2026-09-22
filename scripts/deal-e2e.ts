// 거래 탁자를 진짜 서버로.
//
// 순수 함수 쪽은 shared/rules/deal.test.ts 가 본다. 여기서 볼 것은
// 서버만 아는 여섯 가지다.
//
//   준비한 뒤 물건이 바뀌면 준비가 풀린다
//   가진 것보다 많이 올리면 막힌다
//   자리를 뜨거나 페이즈가 열리면 사라지고 **물건은 그대로 있다**
//   둘이 동시에 성립을 불러도 한 번만 먹는다
//   개인 토큰은 성립할 때만 하나 든다 — 청했다 사라지면 안 든다
//   쪽지는 접힌 채로 간다. 어느 쪽지인지 거래판에 없다
//
//   npx vite-node scripts/deal-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { ADJACENCY, TILE_BY_ID } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'
import { DEAL_COUNTDOWN_MS } from '../shared/rules/deal'
import { stepToward } from '../shared/rules/occupy'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
import { of as recOf, records } from './lib/records'
import { tradedTeams } from '../shared/rules/records'

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

const GAME = `dl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const dealNow = async (id: string) => (await getAll(`games/${GAME}/deals`)).find((d) => d.id === id)?.d ?? {}
const teamNow = async (t: TeamId) => (await getAll(`games/${GAME}/teams`)).find((x) => x.id === t)?.d ?? {}
/** 그 사람 지갑. **돈과 지식은 사람 것이다** — 팀 금고가 없어졌다 */
const purseNow = async (uid: string): Promise<Record<string, number>> =>
  (((await pawnsNow())[uid]?.resources ?? {}) as Record<string, number>)
const slipsNow = async () => await getAll(`games/${GAME}/secret/slips/items`)
const side = (x: Record<string, unknown>, k: 'a' | 'b') => (x[k] ?? {}) as Record<string, unknown>
const staked = (x: Record<string, unknown>, k: 'a' | 'b') =>
  (side(x, k).stake ?? {}) as Record<string, number>

/** 말 하나를 원하는 자리에 놓는다. **시험 준비용** — 서버를 거치지 않는다. */
async function put(uid: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) },
        ]),
      ),
    }),
  })
}

/**
 * 지갑에 돈을 넣는다. **시험 준비용.**
 *
 * 이제 모두 빈손으로 시작한다 — 거래에 걸 것이 있으려면 먼저 벌어야
 * 하는데, 이 대본이 보려는 것은 벌이가 아니라 탁자다. 걸 것만 쥐여 준다.
 */
async function fund(uid: string, money: number, knowledge = 9): Promise<void> {
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        resources: {
          mapValue: {
            fields: {
              money: { integerValue: String(money) },
              knowledge: { integerValue: String(knowledge) },
            },
          },
        },
      },
    }),
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < n; i++) want.push(t)
  }
  await must('createGame', host, { gameId: GAME, seed: 'deal' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  const push = async (ms: number): Promise<void> => {
    clock += ms
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
    await must('tick', host, { gameId: GAME })
  }
  await push(0)

  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const me = A[0]
  const you = B[0]
  // 빈손으로 시작하므로 걸 것을 먼저 쥐여 준다
  for (const p of people) await fund(p.uid, 20)

  /**
   * 둘을 **바로 옆 칸**에 세운다.
   *
   * 같은 방으로는 모자라다 — 거래는 마주 보고 물건을 주고받는 것이다.
   * 걸어서 같은 방까지 오게 한 뒤, 칸은 화면이 할 일을 대신해 적는다
   * (standAt 을 부르는 것은 원래 각자의 화면이다).
   */
  const face = async (): Promise<string> => {
    const where = (await pawnsNow())[me.uid].tileId as string
    for (let i = 0; i < 16; i++) {
      const here = (await pawnsNow())[you.uid].tileId as string | null
      if (here === where) break
      if (here === null) {
        await push(20 * M)
        continue
      }
      const next = stepToward(here, where)
      if (!next) break
      await must('roamTo', you.token, { gameId: GAME, tileId: next })
    }
    await standSideBySide(where)
    return where
  }
  /** 그 방 안에서 둘을 옆 칸에 세운다. */
  const standSideBySide = async (where: string): Promise<void> => {
    const rect = TILE_BY_ID[where].plan
    const x = rect.x + 1
    const y = rect.y + 1
    await must('standAt', me.token, { gameId: GAME, x, y })
    await must('standAt', you.token, { gameId: GAME, x: x + 1, y })
  }
  const room = await face()
  check((await pawnsNow())[you.uid].tileId === room, '둘이 같은 방에 섰다', room)

  const open = async (): Promise<string> => {
    const asked = await must('askDeal', me.token, { gameId: GAME, toPlayerId: you.uid })
    const id = String(asked.id)
    await must('answerDeal', you.token, { gameId: GAME, dealId: id, accept: true })
    return id
  }

  // ── 0. 같은 방으로는 모자라다 ───────────────────────────────
  console.log('── 0. 바로 옆 칸 ──')
  const rect = TILE_BY_ID[room].plan
  await must('standAt', you.token, { gameId: GAME, x: rect.x + 4, y: rect.y + 3 })
  const far = await call('askDeal', me.token, { gameId: GAME, toPlayerId: you.uid })
  check(!far.ok && far.code === 'FAILED_PRECONDITION', '같은 방이어도 떨어져 있으면 못 건다', far.message)
  await must('standAt', you.token, { gameId: GAME, x: rect.x + 2, y: rect.y + 2 })
  const diag = await call('askDeal', me.token, { gameId: GAME, toPlayerId: you.uid })
  check(!diag.ok, '대각선도 닿은 것이 아니다', diag.message)
  const notMine = await call('standAt', me.token, { gameId: GAME, x: 0, y: 0 })
  check(!notMine.ok, '내 방 아닌 칸에는 못 선다', notMine.message)
  await standSideBySide(room)
  check(true, '옆 칸에 나란히 섰다')

  // ── 1. 준비한 뒤 물건이 바뀌면 준비가 풀린다 ────────────────
  console.log('── 1. 준비 해제 ──')
  let id = await open()
  check(String((await dealNow(id)).status) === 'open', '수락하면 탁자가 열린다')

  await must('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { money: 1 } })
  await must('stakeDeal', you.token, { gameId: GAME, dealId: id, stake: { knowledge: 1 } })
  await must('readyDeal', me.token, { gameId: GAME, dealId: id, ready: true })
  await must('readyDeal', you.token, { gameId: GAME, dealId: id, ready: true })
  let d = await dealNow(id)
  check(String(d.status) === 'settling', '둘 다 준비하면 세기 시작한다')

  await must('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { money: 2 } })
  d = await dealNow(id)
  check(
    String(d.status) === 'open' &&
      side(d, 'a').ready === false &&
      side(d, 'b').ready === false &&
      d.settleAtMs === null,
    '물건이 바뀌면 **둘 다** 준비가 풀리고 세던 것도 멈춘다',
    String(d.status),
  )

  // ── 2. 가진 것보다 많이 올리면 막힌다 ───────────────────────
  console.log('── 2. 자원 부족 ──')
  const vault = await purseNow(me.uid)
  const tooMuch = await call('stakeDeal', me.token, {
    gameId: GAME,
    dealId: id,
    stake: { money: (vault.money ?? 0) + 99 },
  })
  check(!tooMuch.ok && tooMuch.code === 'FAILED_PRECONDITION', '지갑에 없는 돈은 못 올린다', tooMuch.message)
  const ghostSlip = await call('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { slips: 5 } })
  check(!ghostSlip.ok, '없는 쪽지도 못 올린다', ghostSlip.message)
  check(Number(staked(await dealNow(id), 'a').money) === 2, '막힌 뒤에도 탁자는 아까 그대로다')

  // ── 3. 자리를 뜨거나 페이즈가 열리면 사라진다 ───────────────
  console.log('── 3. 이탈 · 페이즈 ──')
  const moneyBefore = (await purseNow(me.uid)).money ?? 0
  // 방을 뜨기 전에, **한 걸음만 물러나도** 탁자가 접힌다
  await must('standAt', you.token, { gameId: GAME, x: rect.x + 4, y: rect.y + 3 })
  await must('dealNow', me.token, { gameId: GAME })
  check(String((await dealNow(id)).status) === 'gone', '한 걸음 떨어지면 사라진다', String((await dealNow(id)).why ?? ''))

  await standSideBySide(room)
  id = await open()
  await must('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { money: 2 } })
  const away = ADJACENCY[(await pawnsNow())[you.uid].tileId as string][0]
  await must('roamTo', you.token, { gameId: GAME, tileId: away })
  await must('dealNow', me.token, { gameId: GAME })
  d = await dealNow(id)
  check(String(d.status) === 'gone', '방을 뜨면 사라진다', String(d.why ?? ''))
  check(
    ((await purseNow(me.uid)).money ?? 0) === moneyBefore,
    '올린 것은 선언일 뿐이라 **돌아올 것도 없다**',
  )

  /*
   * **페이즈가 열렸다고 탁자가 접히지는 않는다.**
   *
   * 전에는 페이즈가 열리는 것만으로 살아 있는 거래가 전부 사라졌다.
   * 마주 선 둘이 물건을 주고받는 일은 점령과 같이 일어나도 이상하지
   * 않다 — 접히는 것은 자리를 잃을 때뿐이다.
   *
   * 페이즈가 열리면 다들 전선으로 옮겨 세워지므로 대개는 갈라진다.
   * 여기서는 손으로 나란히 세워 두고, 그래도 살아 있는지를 본다.
   */
  await face()
  id = await open()
  await must('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { money: 1 } })
  await must('openPhase', host, { gameId: GAME })

  // roamTo 는 페이즈 중에 안 된다. 손으로 나란히 세운다
  const mineNow = (await pawnsNow())[me.uid].tileId as string
  const r2 = TILE_BY_ID[mineNow as keyof typeof TILE_BY_ID].plan
  await must('standAt', me.token, { gameId: GAME, x: r2.x + 2, y: r2.y + 2 })
  await must('standAt', you.token, { gameId: GAME, x: r2.x + 3, y: r2.y + 2 })
  await must('dealNow', me.token, { gameId: GAME })
  check(String((await dealNow(id)).status) === 'open', '페이즈가 열려도 탁자는 그대로다')
  check(
    Number(((await dealNow(id)) as { a: { stake: { money: number } } }).a.stake.money) === 1,
    '올려 둔 것도 그대로다',
  )

  // 페이즈 중에 한 걸음 떨어지면 그때는 접힌다 — 자리를 잃어서다
  await must('standAt', you.token, { gameId: GAME, x: r2.x + 6, y: r2.y + 4 })
  await must('dealNow', me.token, { gameId: GAME })
  check(String((await dealNow(id)).status) === 'gone', '자리가 갈리면 사라진다')

  // 다시 마주 서면 페이즈 중에도 새로 연다. **값은 안 든다**
  await must('standAt', you.token, { gameId: GAME, x: r2.x + 3, y: r2.y + 2 })
  await push(0)
  const pid = await open()
  check(String((await dealNow(pid)).status) === 'open', '페이즈 중에도 새 탁자가 열린다', pid)
  await must('stakeDeal', me.token, { gameId: GAME, dealId: pid, stake: { money: 1 } })
  check(
    Number(((await dealNow(pid)) as { a: { stake: { money: number } } }).a.stake.money) === 1,
    '페이즈 중에도 물건을 올린다',
  )
  await must('cancelDeal', me.token, { gameId: GAME, dealId: pid })
  await must('closePhase', host, { gameId: GAME })
  await push(20 * M)

  // ── 4·5·6. 동시 성립 · 값 · 쪽지 ────────────────────────────
  console.log('── 4·5·6. 성립 ──')
  await face()
  // 쪽지 한 장을 손에 쥐어 준다 — 접힌 채로 건너가는지 볼 것이다
  const slip = (await slipsNow())[0]
  await fetch(`${FS}/games/${GAME}/secret/slips/items/${slip.id}?updateMask.fieldPaths=heldBy`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { heldBy: { stringValue: me.uid } } }),
  })

  id = await open()
  await must('stakeDeal', me.token, { gameId: GAME, dealId: id, stake: { money: 1, slips: 1 } })
  await must('stakeDeal', you.token, { gameId: GAME, dealId: id, stake: { knowledge: 1 } })

  // 쪽지 내용이 거래판에 없는지 먼저 본다
  const board = JSON.stringify(await dealNow(id))
  check(!board.includes(slip.id), '거래판에 **어느 쪽지인지가 없다**')
  const line = String(slip.d.line ?? '')
  check(line === '' || !board.includes(line), '쪽지 본문도 없다')
  check(Number(staked(await dealNow(id), 'a').slips) === 1, '장수만 적힌다')

  const aMoney = (await purseNow(me.uid)).money ?? 0
  const bKnow = (await purseNow(you.uid)).knowledge ?? 0
  await must('readyDeal', me.token, { gameId: GAME, dealId: id, ready: true })
  await must('readyDeal', you.token, { gameId: GAME, dealId: id, ready: true })
  const early = await call('settleDeal', me.token, { gameId: GAME, dealId: id })
  check(!early.ok, '다 세기 전에는 성립하지 않는다', early.message)

  await push(DEAL_COUNTDOWN_MS + 1000)
  // 둘이 **같이** 부른다. 한 번만 먹어야 한다
  const both = await Promise.all([
    call('settleDeal', me.token, { gameId: GAME, dealId: id }),
    call('settleDeal', you.token, { gameId: GAME, dealId: id }),
  ])
  check(both.some((r) => r.ok), '성립했다', JSON.stringify(both.map((r) => r.code ?? 'ok')))
  check(String((await dealNow(id)).status) === 'done', '탁자가 닫혔다')

  const aAfter = await purseNow(me.uid)
  const bAfter = await purseNow(you.uid)
  /*
   * **지갑에서 지갑으로.** 전에는 팀 금고끼리 움직여서 둘이 마주 서서
   * 한 거래가 일곱 명의 돈을 움직였다 — 이제 둘의 지갑만 바뀐다
   */
  check((aAfter.money ?? 0) === aMoney - 1, '내 지갑에서 돈 하나가 나갔다', `${aMoney} → ${aAfter.money}`)
  check((bAfter.knowledge ?? 0) === bKnow - 1, '상대 지갑에서 지식 하나가 나갔다', `${bKnow} → ${bAfter.knowledge}`)
  // 받은 쪽에 그대로 들어갔는가. 나가기만 하고 안 들어오면 돈이 사라진다
  check((bAfter.money ?? 0) >= 1, '상대 지갑에 그 돈이 들어왔다', String(bAfter.money))
  check((aAfter.knowledge ?? 0) >= 1, '내 지갑에 그 지식이 들어왔다', String(aAfter.knowledge))


  /*
   * **매점 단골이 이 줄을 센다** — 「다른 팀 사람과 두 번 성립」.
   * 받기만 한 쪽도 거래한 것으로 세어야 한다. 제안한 쪽만 세면
   * 받기만 하는 사람은 아무리 거래해도 안 센 것이 된다
   */
  const log = await records(GAME)
  const trade = recOf(log, 'trade').find((r) => r.actorId === me.uid || r.otherId === me.uid)
  check(trade !== undefined, '거래가 한 줄 남았다')
  check(trade?.actorId === me.uid && trade?.otherId === you.uid, '양쪽이 다 적힌다')
  check(tradedTeams(log, you.uid).includes('A'), '받은 쪽도 거래한 것으로 센다')
  check(tradedTeams(log, me.uid).includes('B'), '제안한 쪽도 센다')

  const moved = (await slipsNow()).find((s) => s.id === slip.id)
  check(String(moved?.d.heldBy) === you.uid, '쪽지가 받는 쪽 손에 들어갔다')
  const myView = (await getAll(`games/${GAME}/views`)).find((v) => v.id === me.uid)?.d ?? {}
  check(!JSON.stringify(myView).includes(slip.id), '넘긴 사람 몫에서는 그 쪽지가 사라졌다')

  console.log('── 덤. 답이 없으면 사라진다 ──')
  const asked = await must('askDeal', me.token, { gameId: GAME, toPlayerId: you.uid })
  await push(20_000)
  await must('dealNow', me.token, { gameId: GAME })
  check(String((await dealNow(String(asked.id))).status) === 'gone', '열다섯 초가 지나면 사라진다')


  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
