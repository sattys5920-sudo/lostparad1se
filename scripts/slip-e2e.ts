// 쪽지를 진짜 서버로.
//
// 확인할 것은 하나다. **적힌 것이 주워서 읽은 사람 말고는 아무에게도
// 안 간다.** 바닥에 있는 쪽지는 그 방에 선 사람에게 「한 장 있다」까지고,
// 들고만 있으면 아직 안 보이고, 넘겨주면 새 주인에게 간다.
//
// 문장 표가 번들에 안 실리는지는 check:bundle 이 따로 본다.
//
//   npx vite-node scripts/slip-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { SLIPS_PER_PERSON } from '../shared/reveal/slips'
import { TILE_BY_ID, type TileId } from '../shared/rules/board'
import { standAndSpot } from './lib/spot'
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

const GAME = `sl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
/** 서버만 보는 쪽지 전부. 시험이 판을 짜는 데만 쓴다. */
const allSlips = async () => await getAll(`games/${GAME}/secret/slips/items`)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'slip' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  check(true, '판이 시작했다')

  console.log('\n── 서버는 뿌리지 않는다 ──')
  check((await allSlips()).length === 0, '처음에는 한 장도 없다')
  await must('openPhase', host, { gameId: GAME })
  await must('closePhase', host, { gameId: GAME })
  check((await allSlips()).length === 0, '**페이즈가 닫혀도 안 떨어진다** — 운영자가 놓는다')

  console.log('\n── 운영자가 칸을 짚어 놓는다 ──')
  const goal = String((await pawnsNow())[A[0].uid].tileId) as TileId
  const { stand, spot } = standAndSpot(goal)
  await must('standAt', A[0].token, { gameId: GAME, x: stand.x, y: stand.y })
  const TEXT = '{이름}은/는 그날 밤 옥상 문을 열어 두었다.'
  const byPlayer = await call('hostDrop', A[0].token, { gameId: GAME, kind: 'slip', x: spot.x, y: spot.y, subjectId: B[0].uid, text: TEXT })
  check(!byPlayer.ok, '보통 사람은 못 놓는다', byPlayer.message)
  const nobody = await call('hostDrop', host, { gameId: GAME, kind: 'slip', x: spot.x, y: spot.y, subjectId: 'nobody', text: TEXT })
  check(nobody.code === 'INVALID_ARGUMENT', '판에 없는 사람의 쪽지는 못 놓는다', nobody.message)
  const put = await must('hostDrop', host, { gameId: GAME, kind: 'slip', x: spot.x, y: spot.y, subjectId: B[0].uid, text: TEXT })
  check(put.where === TILE_BY_ID[goal].name, '짚은 칸의 방 이름을 알려 준다', String(put.where))
  const same = await call('hostDrop', host, { gameId: GAME, kind: 'slip', x: spot.x, y: spot.y, subjectId: B[0].uid, text: '또' })
  check(same.code === 'FAILED_PRECONDITION', '**한 칸에 한 장** — 같은 칸에는 못 겹친다', same.message)

  // 같은 사람 앞으로 세 장 더 — 넉 장이 차면 다섯째는 막힌다
  const used = [spot]
  const extra: string[] = []
  for (let i = 0; i < SLIPS_PER_PERSON - 1; i++) {
    const c = standAndSpot('library', used).spot
    used.push(c)
    extra.push(String((await must('hostDrop', host, { gameId: GAME, kind: 'slip', x: c.x, y: c.y, subjectId: B[0].uid, text: `${i}` })).slipId))
  }
  const fifth = standAndSpot('library', used).spot
  const over = await call('hostDrop', host, { gameId: GAME, kind: 'slip', x: fifth.x, y: fifth.y, subjectId: B[0].uid, text: '다섯째' })
  check(over.code === 'FAILED_PRECONDITION', `**한 사람 앞으로 ${SLIPS_PER_PERSON}장까지**`, over.message)
  const board = (await must('hostSlipList', host, { gameId: GAME })) as { people: { id: string; placed: number }[]; onFloor: { id: string }[] }
  check(board.people.find((p) => p.id === B[0].uid)?.placed === SLIPS_PER_PERSON, '운영자 판에 넉 장이 잡힌다')
  check(board.onFloor.length === SLIPS_PER_PERSON, '바닥에 넉 장')
  // 하나를 거두면 한 자리가 빈다
  await must('hostPullSlip', host, { gameId: GAME, slipId: extra[0] })
  const again = await call('hostDrop', host, { gameId: GAME, kind: 'slip', x: fifth.x, y: fifth.y, subjectId: B[0].uid, text: '다시' })
  check(again.ok, '거두면 그 사람 몫이 한 자리 빈다', again.message)

  const floor = await allSlips()
  const target = floor.find((f) => f.id === String(put.slipId)) as { id: string; d: Record<string, unknown> }
  check(target.d.x === spot.x && target.d.y === spot.y && target.d.tileId === null, '방이 아니라 칸에 놓였다')

  console.log('\n── 누구도 직접 못 읽는다 ──')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/slips/items`, {
    headers: { Authorization: `Bearer ${A[0].token}` },
  })
  check(asPlayer.status === 403, '쪽지 컬렉션을 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/slips/items`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 직접은 못 읽는다', String(asHost.status))

  console.log('\n── 바닥에는 자리만 보인다 ──')
  // B1 은 옆방으로 보낸다 — 다른 방 사람 몫에는 있다는 것조차 안 가야 한다
  const away = B[1]
  const next = stepToward(goal, 'library') ?? 'library'
  await call('roamTo', away.token, { gameId: GAME, tileId: next })
  await must('tick', host, { gameId: GAME })
  const mine = await viewOf(A[0].uid)
  const papers = (mine.slipPapers as { id: string; x: number; y: number }[]) ?? []
  check(papers.some((p) => p.id === target.id && p.x === spot.x && p.y === spot.y), '그 방에 선 사람에게 그 칸에 한 장이 보인다', `${papers.length}장`)
  check(!JSON.stringify(mine.slipPapers).includes(B[0].uid), '**누구 것인지는 안 온다**')
  check(!JSON.stringify(mine).includes('옥상 문'), '**적힌 말도 안 온다**')
  const far = await viewOf(away.uid)
  if ((await pawnsNow())[away.uid].tileId !== goal) {
    check(!((far.slipPapers as { id: string }[]) ?? []).some((p) => p.id === target.id), '다른 방 사람에게는 있다는 것조차 안 간다')
  }

  console.log('\n── 옆에 서야 줍는다 ──')
  // A1 을 종이에서 떨어진 칸에 세운다
  let farOk = false
  for (let dx = 4; dx < 12 && !farOk; dx++) {
    const c = { x: spot.x + dx, y: spot.y }
    const r = await call('standAt', A[1].token, { gameId: GAME, x: c.x, y: c.y })
    farOk = r.ok
  }
  check(farOk, '종이에서 떨어진 칸에 섰다')
  if (farOk) {
    const notBeside = await call('takeSlip', A[1].token, { gameId: GAME, slipId: target.id })
    check(notBeside.code === 'FAILED_PRECONDITION', '멀리 선 사람은 못 줍는다', notBeside.message)
  }

  console.log('\n── 주워도 읽어야 보인다 ──')
  await must('takeSlip', A[0].token, { gameId: GAME, slipId: target.id })
  let held = ((await viewOf(A[0].uid)).mySlips as { id: string; read: boolean; line: string | null }[]) ?? []
  const one = held.find((s) => s.id === target.id)
  check(one !== undefined, '손에 들어왔다')
  check(one?.read === false && one?.line === null, '**들고만 있으면 문장이 안 온다**')
  check(!((await viewOf(A[0].uid)).slipPapers as unknown[]).some((s) => (s as { id: string }).id === target.id), '바닥에서 사라졌다')

  const gone = await call('takeSlip', B[0].token, { gameId: GAME, slipId: target.id })
  check(gone.code === 'FAILED_PRECONDITION', '남이 주운 것은 못 줍는다', gone.message)

  await must('readSlip', A[0].token, { gameId: GAME, slipId: target.id })
  held = ((await viewOf(A[0].uid)).mySlips as { id: string; read: boolean; line: string | null }[]) ?? []
  const read = held.find((s) => s.id === target.id)
  check(read?.read === true && typeof read?.line === 'string', '읽으니 문장이 왔다', String(read?.line))
  check(String(read?.line).startsWith(`봇${people.indexOf(B[0])}은`), '**{이름}이 쪽지 주인 이름으로 바뀌었다**', String(read?.line))
  check(!JSON.stringify(await viewOf(B[0].uid)).includes(String(read?.line)), '**남에게는 안 간다**')

  console.log('\n── 처리: 두기 · 건네기 · 찢기 ──')
  await must('dropSlip', A[0].token, { gameId: GAME, slipId: target.id })
  check(
    ((await viewOf(A[0].uid)).slipsHere as { id: string }[]).some((s) => s.id === target.id),
    '두고 나니 다시 바닥에 있다',
  )
  await must('takeSlip', A[0].token, { gameId: GAME, slipId: target.id })

  // 같은 방으로 팀원을 부른다
  const mate = A[1]
  for (let i = 0; i < 8; i++) {
    const here = (await pawnsNow())[mate.uid].tileId as string
    if (here === goal) break
    const next = stepToward(here, goal)
    if (!next) break
    const r = await call('roamTo', mate.token, { gameId: GAME, tileId: next })
    if (!r.ok) break
  }
  const farGive = await call('giveSlip', A[0].token, { gameId: GAME, slipId: target.id, toPlayerId: away.uid })
  check(farGive.code === 'FAILED_PRECONDITION', '멀리 있는 사람에게는 못 건넨다', farGive.message)
  await must('giveSlip', A[0].token, { gameId: GAME, slipId: target.id, toPlayerId: mate.uid })
  const mateSlips = ((await viewOf(mate.uid)).mySlips as { id: string; read: boolean }[]) ?? []
  check(mateSlips.some((s) => s.id === target.id), '건네받았다')
  check(mateSlips.find((s) => s.id === target.id)?.read === false, '**받은 사람은 다시 읽어야 한다**')
  check(!((await viewOf(A[0].uid)).mySlips as unknown[]).some((s) => (s as { id: string }).id === target.id), '내 손에서는 떠났다')

  const notMine = await call('tearSlip', A[0].token, { gameId: GAME, slipId: target.id })
  check(notMine.code === 'PERMISSION_DENIED', '남의 손에 있는 것은 못 찢는다', notMine.message)

  await must('tearSlip', mate.token, { gameId: GAME, slipId: target.id })
  check(!((await viewOf(mate.uid)).mySlips as unknown[]).some((s) => (s as { id: string }).id === target.id), '찢으니 사라졌다')
  for (const p of people) {
    const j = JSON.stringify(await viewOf(p.uid))
    if (j.includes(String(read?.line))) {
      check(false, '찢긴 문장이 아직 누군가에게 간다', p.uid)
      break
    }
  }
  check(true, '**찢긴 쪽지는 아무에게도 안 간다**')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
