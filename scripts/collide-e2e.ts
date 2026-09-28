// 충돌 — 한 칸에 한 사람. 서버가 가른다.
//
//   - 판이 시작되면 열넷이 서로 다른 칸에 선다
//   - 두 사람이 같은 칸으로 동시에 가면 한 사람만 서고, 진 쪽은 제자리
//   - 누가 선 칸 · 서버가 세운 시작 칸 · 책상 같은 소품 칸에는 못 선다
//   - 떠난 칸은 다시 빈다 · 걸음에는 토큰이 안 든다
//   - 같은 문으로 여럿이 들어와도(roamTo) 저마다 다른 빈 칸에 선다 — 칸 없는(null) 사람이 없다
//   - 칸 없이 시작한 예전 판 사람도 거절당하면 빈 칸을 받는다
//   - 종이 치면 제자리로 끌려 온 사람들이 서로 다른 칸에 선다
//   - 페이즈 중에 걸어서 도착한 사람들도 서로 다른 칸에 선다
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
import { TILE_IDS, canRoamTo, isHallCell, roomOfCell } from '../shared/rules/board'
import { entryCellOf, inLane } from '../shared/rules/seat'
import { isFixture } from '../shared/rules/fixtures'
import { dayHourMs } from '../shared/rules/clock'

const GAME = `col${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function pawnAt(uid: string): Promise<{ x: number; y: number } | null> {
  const r = plain(await (await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })).json()) as { at?: { x: number; y: number } | null }
  return r.at ?? null
}

interface PawnRow { id: string; tileId: string | null; at: { x: number; y: number } | null; team: string }
async function pawnsAll(): Promise<PawnRow[]> {
  const r = await fetch(`${FS}/games/${GAME}/pawns?pageSize=300`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => {
    const d = plain(doc) as { tileId?: string | null; at?: { x: number; y: number } | null; team: string }
    return { id: doc.name.split('/').pop() as string, tileId: d.tileId ?? null, at: d.at ?? null, team: d.team }
  })
}
/** 방(또는 복도)에 선 사람 중 한 칸에 둘 이상인 칸들 */
function stacked(rows: PawnRow[]): string[] {
  const seen = new Map<string, number>()
  for (const p of rows) if (p.tileId !== null && p.at) seen.set(`${p.at.x},${p.at.y}`, (seen.get(`${p.at.x},${p.at.y}`) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`)
}
/** 선 칸이 그 사람의 방 안(또는 복도)이고 물건 칸이 아닌가 */
const fits = (p: PawnRow) =>
  p.at !== null && (roomOfCell(p.at.x, p.at.y) === p.tileId || isHallCell(p.at.x, p.at.y)) && !isBlockedCell(p.at.x, p.at.y) && !isFixture(p.at.x, p.at.y)

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

  console.log('\n── 같은 문으로 여럿이 한꺼번에 들어온다 ──')
  const next2 = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE as never, t)) as string
  const door = entryCellOf(next2 as never)
  // 여섯이 **같은 칸(문 바로 안쪽)에 들어섰다고** 동시에 말한다 — 화면이 보내는 값이다
  const six = people.slice(7, 13)
  const outs = await Promise.all(six.map((p) => must('roamTo', p.token, { gameId: GAME, tileId: next2, at: door })))
  const rows = await pawnsAll()
  const inRoom = rows.filter((r) => six.some((p) => p.uid === r.id))
  check(inRoom.every((r) => r.tileId === next2), `여섯 모두 ${next2} 에 들어갔다`)
  check(inRoom.every((r) => r.at !== null), '들어온 사람 누구도 칸이 비어(null) 있지 않다', inRoom.map((r) => JSON.stringify(r.at)).join(' '))
  check(new Set(inRoom.map((r) => `${r.at?.x},${r.at?.y}`)).size === 6, '여섯이 서로 다른 칸에 섰다', inRoom.map((r) => `${r.at?.x},${r.at?.y}`).join(' '))
  check(inRoom.every(fits), '모두 그 방 안, 물건 없는 칸이다')
  check(inRoom.some((r) => r.at?.x === door.x && r.at?.y === door.y), '한 사람은 들어선 그 칸에 섰다(비어 있었다)')
  check(inRoom.filter((r) => !(r.at?.x === door.x && r.at?.y === door.y)).every((r) => r.at && !inLane(r.at.x, r.at.y)),
    '나머지는 문 앞 길 밖에 선다 — 문이 막히지 않는다')
  check(outs.every((o, i) => { const r = inRoom.find((q) => q.id === six[i].uid); return (o.at as { x: number } | null)?.x === r?.at?.x }), '서버가 세운 칸을 돌려준다 — 화면이 그 칸으로 선다')
  // 칸을 안 알려 주고 들어와도(계단 · 옛 화면) 문 앞 빈 칸에 선다
  const back2 = await Promise.all(six.slice(0, 3).map((p) => must('roamTo', p.token, { gameId: GAME, tileId: START_TILE })))
  check(back2.every((o) => o.at != null), '다시 나간 셋도 교실의 빈 칸을 받는다')
  check(stacked(await pawnsAll()).length === 0, '판 전체에 한 칸에 둘이 선 곳이 없다', stacked(await pawnsAll()).join(' '))

  console.log('\n── 칸 없이 시작한 예전 판 사람 ──')
  // 칸을 나눠 주기 전에 시작한 판처럼 칸을 지운다
  const legacy = people[13]
  await fetch(`${FS}/games/${GAME}/pawns/${legacy.uid}?updateMask.fieldPaths=at`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { at: { nullValue: null } } }),
  })
  const someoneAt = (await pawnsAll()).find((r) => r.id !== legacy.id && r.tileId === START_TILE && r.at && roomOfCell(r.at.x, r.at.y) === START_TILE)
  const onSome = await must('standAt', legacy.token, { gameId: GAME, x: someoneAt?.at?.x, y: someoneAt?.at?.y })
  const legacyAt = await pawnAt(legacy.uid)
  check(onSome.ok === false && onSome.code === 'occupied', '남의 칸으로는 못 간다', String(onSome.why))
  check(onSome.at != null && legacyAt !== null, '거절하면서 빈 칸에 세워 돌려준다 — 화면이 그 칸으로 선다', JSON.stringify(onSome.at))
  check(stacked(await pawnsAll()).length === 0, '한 칸에 둘이 선 곳이 없다')

  console.log('\n── 종이 치면 제자리 — 서로 다른 칸 ──')
  // 몇 사람을 다른 방으로 보내 두고 연다. 끌려 오는 사람들이 한 문으로 몰린다
  await Promise.all(people.slice(0, 6).map((p) => call('roamTo', p.token, { gameId: GAME, tileId: next2 })))
  const openedAt = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: openedAt, speed: 1 })
  const opened = await must('openPhase', host, { gameId: GAME })
  const afterOpen = await pawnsAll()
  check(Number(opened.returned) >= 6, '다른 방에 갔던 사람들이 끌려 왔다', `${opened.returned}명`)
  check(afterOpen.every((r) => r.at !== null), '열넷 모두 칸이 있다', afterOpen.filter((r) => r.at === null).map((r) => r.id).join(' '))
  check(stacked(afterOpen).length === 0, '열넷이 서로 다른 칸에 섰다', stacked(afterOpen).join(' '))
  check(afterOpen.every(fits), '모두 제 방 안(또는 복도), 물건 없는 칸이다')
  check(afterOpen.filter((r) => people.slice(0, 6).some((p) => p.uid === r.id)).every((r) => r.at && !inLane(r.at.x, r.at.y)),
    '끌려 온 사람들은 문 앞 길 밖에 선다')

  console.log('\n── 페이즈 중에 걸어서 도착 — 서로 다른 칸 ──')
  // 팀마다 한 사람씩 같은 방으로 걸어간다(팀 상자에서 토큰 하나씩)
  const walkers = (['A', 'B', 'C', 'D'] as const).map((t) => people.find((p) => p.team === t)).filter((p): p is (typeof people)[number] => !!p)
  const target = 'artRoom'
  const went = await Promise.all(walkers.map((p) => call('phaseAct', p.token, { gameId: GAME, kind: 'move', targetTile: target })))
  const moving = walkers.filter((_, i) => went[i].ok)
  check(moving.length >= 2, `둘 이상이 ${target} 로 걷기 시작했다`, went.map((w) => w.ok ? 'ok' : w.message).join(' · '))
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: openedAt + 30 * 60_000, speed: 1 })
  await must('tick', host, { gameId: GAME })
  const arrived = (await pawnsAll()).filter((r) => moving.some((p) => p.uid === r.id))
  check(arrived.every((r) => r.tileId === target), '모두 도착했다', arrived.map((r) => r.tileId).join(' '))
  check(arrived.every((r) => r.at !== null), '도착한 사람 누구도 칸이 비어 있지 않다')
  check(new Set(arrived.map((r) => `${r.at?.x},${r.at?.y}`)).size === arrived.length, '도착한 사람들이 서로 다른 칸에 섰다', arrived.map((r) => `${r.at?.x},${r.at?.y}`).join(' '))
  check(arrived.every(fits), '도착한 칸은 그 방 안, 물건 없는 칸이다')
  check(stacked(await pawnsAll()).length === 0, '판 전체에 한 칸에 둘이 선 곳이 없다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
