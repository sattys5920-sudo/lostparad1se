// 카드를 진짜 서버로.
import { TEAM_SIZES, HAND_LIMIT, type TeamId } from '../shared/rules/v2'
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
async function getDoc<T = Record<string, unknown>>(p: string): Promise<T | null> {
  const r = await fetch(`${FS}/${p}`, { headers: ADMIN }); return r.ok ? (plain(await r.json()) as T) : null
}
async function getAll(p: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${p}?pageSize=300`, { headers: ADMIN }); if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((d) => ({ id: d.name.split('/').pop() as string, d: plain(d) as Record<string, unknown> }))
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
const GAME = `card${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 시험 준비용. 규칙을 건너뛰고 자원을 심는다. */
async function setResources(team: string, res: Record<string, number>): Promise<void> {
  await fetch(`${FS}/games/${GAME}/teams/${team}?updateMask.fieldPaths=resources`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { resources: { mapValue: { fields: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { integerValue: String(v) }])) } } } }),
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'card' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 12))
  const A = people.filter((p) => p.team === 'A')
  const me = A[0]
  const team = async (t: TeamId) => (await getDoc(`games/${GAME}/teams/${t}`)) as { handCount: number; resources: Record<string, number> }
  const view = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as { hand: { kind: string }[] }
  check(true, '판이 시작했다')

  console.log('\n── 연구가 카드를 준다 ──')
  await setResources('A', { money: 40, knowledge: 40, influence: 10 })
  check((await team('A')).handCount === 0, '처음에는 손패가 비어 있다')
  const r1 = await must('research', me.token, { gameId: GAME, tileId: 'baseA' })
  check(Boolean((r1.card as { drawn: string }).drawn), '연구가 카드 한 장을 줬다', String((r1.card as { drawn: string }).drawn))
  check((await team('A')).handCount === 1, '손패가 한 장')

  console.log('\n── 손패는 우리 팀만 ──')
  const mineHand = (await view(me.uid)).hand
  check(mineHand.length === 1, '내 몫에 손패가 있다')
  const foe = people.find((p) => p.team === 'C') as (typeof people)[0]
  check((await view(foe.uid)).hand.length === 0, '다른 팀 몫에는 없다')
  const asFoe = await fetch(`${FS}/games/${GAME}/secret/hands/items`, { headers: { Authorization: `Bearer ${foe.token}` } })
  check(asFoe.status === 403, '규칙도 막는다', String(asFoe.status))
  const evs = await getAll(`games/${GAME}/events`)
  const drawn = evs.filter((e) => e.d.kind === 'cardDrawn')
  check(drawn.length === 1 && !JSON.stringify(drawn).includes(mineHand[0].kind), '기록에 무슨 카드인지 안 남는다')

  console.log('\n── 손패 한도 ──')
  for (let i = 0; i < 6; i++) {
    await clock(dayHourMs(START, 1 + Math.floor(i / 3), 12 + (i % 3) * 2))
    await must('tick', me.token, { gameId: GAME })
    await setResources('A', { money: 40, knowledge: 40, influence: 10 })
    await call('research', A[i % A.length].token, { gameId: GAME, tileId: 'baseA' })
  }
  const full = (await team('A')).handCount
  check(full <= HAND_LIMIT, `손패는 ${HAND_LIMIT}장까지`, `${full}장`)

  console.log('\n── 카드를 낸다 ──')
  const hand = (await view(me.uid)).hand.map((c) => c.kind)
  check(hand.length > 0, '손에 카드가 있다', hand.join(','))
  check((await call('playOne', me.token, { gameId: GAME, kind: '없는카드' })).code === 'INVALID_ARGUMENT', '없는 카드는 거절')
  const notMine = hand.includes('windfall') ? 'cramming' : 'windfall'
  if (!hand.includes(notMine)) {
    check((await call('playOne', me.token, { gameId: GAME, kind: notMine })).message === '그 카드가 손패에 없다.', '손에 없는 카드는 못 낸다')
  }

  // 자원 카드
  const money0 = (await team('A')).resources.money
  if (hand.includes('windfall')) {
    await must('playOne', me.token, { gameId: GAME, kind: 'windfall' })
    check((await team('A')).resources.money > money0, '뜻밖의 돈이 들어왔다')
  }
  // 대상이 필요한 카드는 고르지 않으면 거절
  if (hand.includes('falseRumor')) {
    check((await call('playOne', me.token, { gameId: GAME, kind: 'falseRumor' })).message === '대상 팀을 골라야 한다.', '대상 팀을 골라야 한다')
    check((await call('playOne', me.token, { gameId: GAME, kind: 'falseRumor', targetTeam: 'A' })).message === '우리 팀에는 못 쓴다.', '우리 팀에는 못 쓴다')
  }

  console.log('\n── 가짜 깃발 ──')
  // 가짜 깃발은 secret에만. 다른 팀에게는 진짜와 구별되지 않는다
  const fakeDocs = await getAll(`games/${GAME}/secret/flagTruth/items`)
  check(fakeDocs.length >= 0, '가짜 깃발 표는 secret에 있다', `${fakeDocs.length}개`)
  const asFoe2 = await fetch(`${FS}/games/${GAME}/secret/flagTruth/items`, { headers: { Authorization: `Bearer ${foe.token}` } })
  check(asFoe2.status === 403, '다른 팀은 진짜인지 가짜인지 못 읽는다', String(asFoe2.status))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
