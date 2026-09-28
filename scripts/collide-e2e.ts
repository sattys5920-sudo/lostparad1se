// 충돌 — 한 칸에 한 사람. 서버가 가른다.
//
//   - 판이 시작되면 열넷이 서로 다른 칸에 선다
//   - 두 사람이 같은 칸으로 동시에 가면 한 사람만 서고, 진 쪽은 제자리
//   - 누가 선 칸 · 서버가 세운 시작 칸 · 책상 같은 소품 칸에는 못 선다
//   - 떠난 칸은 다시 빈다 · 걸음에는 토큰이 안 든다
//
//   npx vite-node scripts/collide-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'

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



import { START_TILE } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'

const GAME = `col${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function pawnAt(uid: string): Promise<{ x: number; y: number } | null> {
  const r = plain(await (await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })).json()) as { at?: { x: number; y: number } | null }
  return r.at ?? null
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'col' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })

  console.log('\n── 시작 자리 ──')
  const starts = await Promise.all(people.map((p) => pawnAt(p.uid)))
  const keys = new Set(starts.map((c) => (c ? `${c.x},${c.y}` : 'none')))
  check(starts.every((c) => c !== null), '열넷 모두 칸을 받고 시작한다')
  check(keys.size === 14, '열넷의 시작 칸이 모두 다르다', `${keys.size}칸`)

  const [a, b, c] = people
  const taken = new Set(START_CELLS.map((x) => `${x.x},${x.y}`))
  const free = dropCellsIn(START_TILE as never).filter((x) => !isBlockedCell(x.x, x.y) && !taken.has(`${x.x},${x.y}`))
  const spot = free[0]
  const tokensBefore = plain(await (await fetch(`${FS}/games/${GAME}/teams/${a.team}`, { headers: ADMIN })).json()) as { phaseTokens?: number }

  console.log('\n── 두 사람이 같은 칸으로 동시에 ──')
  const aWas = await pawnAt(a.uid)
  const bWas = await pawnAt(b.uid)
  const [ra, rb] = await Promise.all([
    must('standAt', a.token, { gameId: GAME, x: spot.x, y: spot.y }),
    must('standAt', b.token, { gameId: GAME, x: spot.x, y: spot.y }),
  ])
  const won = [ra, rb].filter((r) => r.ok === true).length
  check(won === 1, '둘 중 한 사람만 선다', `${won}명`)
  const loser = ra.ok === true ? b : a
  const loserWas = ra.ok === true ? bWas : aWas
  const lost = ra.ok === true ? rb : ra
  check(lost.code === 'occupied', '진 쪽은 「누가 먼저 섰다」', String(lost.why))
  const lAt = await pawnAt(loser.uid)
  check(lAt?.x === loserWas?.x && lAt?.y === loserWas?.y, '진 쪽은 원래 자리에 남는다', JSON.stringify(lAt))
  const winner = loser === a ? b : a
  const wAt = await pawnAt(winner.uid)
  check(wAt?.x === spot.x && wAt?.y === spot.y, '이긴 쪽이 그 칸에 섰다')

  console.log('\n── 남이 선 칸 · 기물 칸 ──')
  const onto = await must('standAt', c.token, { gameId: GAME, x: spot.x, y: spot.y })
  check(onto.ok === false && onto.code === 'occupied', '누가 선 칸에는 못 선다', String(onto.why))
  const intoOther = await must('standAt', c.token, { gameId: GAME, x: bWas?.x ?? 0, y: bWas?.y ?? 0 })
  check(loser === b ? intoOther.ok === false : true, '서버가 세운 시작 칸(표시 없음)도 막는다', String(intoOther.why ?? ''))
  // b 가 이겼으면 b 의 시작 칸은 비었고 c 가 거기 섰다 — 제자리는 그 뒤로 잰다
  const cStart = await pawnAt(c.uid)
  const desk = dropCellsIn(START_TILE as never).find((x) => isBlockedCell(x.x, x.y))
  if (desk) {
    const onDesk = await must('standAt', c.token, { gameId: GAME, x: desk.x, y: desk.y })
    check(onDesk.ok === false && onDesk.code === 'blocked', '책상 · 소품 위에는 못 선다', `${desk.x},${desk.y} ${String(onDesk.why)}`)
  } else check(false, '교실에 소품 칸이 없다 — 검사할 수 없다')
  const cNow = await pawnAt(c.uid)
  check(cNow?.x === cStart?.x && cNow?.y === cStart?.y, '거절된 사람은 제자리다')

  console.log('\n── 떠난 칸은 다시 빈다 ──')
  const next = free[1]
  await must('standAt', winner.token, { gameId: GAME, x: next.x, y: next.y })
  const refill = await must('standAt', c.token, { gameId: GAME, x: spot.x, y: spot.y })
  check(refill.ok === true, '앞사람이 떠난 칸에는 설 수 있다', String(refill.why ?? ''))

  console.log('\n── 셋이 한 칸으로 — 다섯 번 ──')
  let clean = 0
  for (let round = 0; round < 5; round++) {
    const cell = free[3 + round]
    const trio = [people[4], people[5], people[6]]
    const outs = await Promise.all(trio.map((p) => must('standAt', p.token, { gameId: GAME, x: cell.x, y: cell.y })))
    const at = await Promise.all(trio.map((p) => pawnAt(p.uid)))
    const on = at.filter((q) => q?.x === cell.x && q?.y === cell.y).length
    if (outs.filter((o) => o.ok === true).length === 1 && on === 1) clean += 1
  }
  check(clean === 5, '다섯 번 다 한 사람만 섰다', `${clean}/5`)

  const tokensAfter = plain(await (await fetch(`${FS}/games/${GAME}/teams/${a.team}`, { headers: ADMIN })).json()) as { phaseTokens?: number }
  check((tokensBefore.phaseTokens ?? 0) === (tokensAfter.phaseTokens ?? 0), '방 안 걸음에는 토큰이 안 든다 — 실패해도 잃는 것이 없다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
