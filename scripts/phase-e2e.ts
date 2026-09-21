// 페이즈를 진짜 서버로.
//
// 확인할 것은 셋이다.
//
//   자유 시간에 아무리 멀리 가도 **전선은 안 움직인다** — 페이즈가
//     열리면 제자리로 돌아온다
//   남이 무엇을 골랐는지 새지 않는다
//   머릿수가 많은 팀이 방을 가져가고, 동점이면 안 바뀐다
//
//   HOST_CODE=... npx vite-node scripts/phase-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { VENDINGS } from '../shared/rules/shop'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { ACT_COST, MOVE_MINUTES, ROOM_KIND, TOKENS_PER_PHASE, capacityOf, nextWallet, stepToward } from '../shared/rules/occupy'

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

const GAME = `ph${Date.now()}`
/** 2-3 교실과 같은 층의 기계. 복도 칸이라 자유 시간에 그냥 선다 */
const MACHINE = VENDINGS.find((v) => v.floor === 'f2')!.cell

const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
/** 팀 상자. **토큰은 팀에 한 주머니다** — 사람 문서에는 없다. */
const boxOf = async (team: string) =>
  Number((await getAll(`games/${GAME}/teams`)).find((t) => t.id === team)?.d.phaseTokens ?? -1)
const ownerOfTile = async (id: string) =>
  ((await getAll(`games/${GAME}/tiles`)).find((t) => t.id === id)?.d.ownerTeam ?? null) as string | null

/** 그 방 주인을 손으로 적어 둔다. 판을 만들어 놓고 보는 시험이다 */
async function setOwner(tileId: string, team: string): Promise<void> {
  await fetch(`${FS}/games/${GAME}/tiles/${tileId}?updateMask.fieldPaths=ownerTeam`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { ownerTeam: { stringValue: team } } }),
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'phase' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  check(true, '판이 시작했다')

  console.log('\n── 주장 ──')
  const started = await pawnsNow()
  const caps = Object.values(started).filter((p) => p.captain === true)
  check(caps.length === 2, '세 명뿐인 두 팀에만 주장이 있다', `${caps.length}명`)
  check(Object.values(started).every((p) => p.postTile === p.tileId), '전투 자리가 선 자리와 같게 시작한다')

  console.log('\n── 자유 시간은 전선을 못 옮긴다 ──')
  // 열넷이 다 2-3 교실에서 시작한다. 2층 복도로 이어진 방은 어디든
  // 곧바로 걸어 들어간다 — 값도 시간도 안 든다
  const a0 = A[0]
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'scienceRoom' })
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'library' })
  let now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'library', '자유 시간에는 즉시 걸어 다닌다', String(now.tileId))
  check(now.postTile === 'centralPlaza', '**전선은 그대로다**', String(now.postTile))

  /*
   * **점령은 문이 아니다.** 남의 칸이라고 못 들어가면 한 번 가져간
   * 방은 영영 그 팀 것이 되고, 페이즈마다 머릿수로 다시 정하는 규칙이
   * 할 일이 없다. 자유 시간에도 페이즈에도 그냥 드나든다.
   */
  await setOwner('musicRoom', 'B')
  const intoTheirs = await call('roamTo', a0.token, { gameId: GAME, tileId: 'musicRoom' })
  check(intoTheirs.ok === true, 'B팀이 점령한 방에도 걸어 들어간다', intoTheirs.message ?? '')
  check((await pawnsNow())[a0.uid].tileId === 'musicRoom', '정말 그 방에 서 있다')
  check((await ownerOfTile('musicRoom')) === 'B', '들어간 것만으로 주인이 바뀌지는 않는다 — 판정은 페이즈 끝이다')
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'library' })

  /*
   * **자유 시간에는 정원이 없다.**
   *
   * 급식실은 좁은 방이라 페이즈에는 둘까지다(narrow). 자유 시간에는
   * 몰려 들어가 떠드는 것이 하라는 일이라 막지 않는다 — 넷을 넣어
   * 본다. 페이즈 중의 걸음은 여전히 정원을 본다(occupy 의 step).
   */
  const CROWD = [A[1], B[0], B[1], C[0]]
  const seats = capacityOf('cafeteria')
  for (const p of CROWD) await must('roamTo', p.token, { gameId: GAME, tileId: 'cafeteria' })
  const inRoom = Object.values(await pawnsNow()).filter((p) => p.tileId === 'cafeteria').length
  check(
    inRoom === CROWD.length && CROWD.length > seats,
    `정원 ${seats}인 방에 ${CROWD.length}명이 들어간다 — 자유 시간에는 한도가 없다`,
    `${inRoom}명`,
  )
  // 원래 자리로 돌려보낸다. 여기 둔 채로 페이즈를 열면 아래의
  // 「돌아온 사람 수」가 이 시험 때문에 달라진다
  for (const p of CROWD) await must('roamTo', p.token, { gameId: GAME, tileId: 'centralPlaza' })

  // **계단은 문이라 층도 한 걸음이다.** 2층 도서관에서 1층 연구실로 곧장
  await must('roamTo', a0.token, { gameId: GAME, tileId: 'labRoom' })
  check((await pawnsNow())[a0.uid].tileId === 'labRoom', '층이 달라도 한 걸음에 간다')
  const nowhere = await call('roamTo', a0.token, { gameId: GAME, tileId: 'stair_f1_w' })
  check(nowhere.code === 'FAILED_PRECONDITION' || nowhere.code === 'INVALID_ARGUMENT',
    '계단에는 설 수 없다 — 칸이 아니다', nowhere.message)

  /*
   * **위장은 물건이 든다.** 자유 시간에 자판기까지 걸어가서 사 둔다.
   * 물건은 산 사람 주머니에 들어가므로 페이즈에 제자리로 끌려와도 남는다.
   *
   * 지갑을 먼저 채운다 — 돈이 개인 것이 되면서 시작 자금이 사람당
   * 2코인이고, 명찰은 3이다. 버는 것은 이 시험의 관심이 아니다
   */
  await fetch(`${FS}/games/${GAME}/pawns/${A[1].uid}?updateMask.fieldPaths=resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        resources: {
          mapValue: { fields: { money: { integerValue: '9' }, knowledge: { integerValue: '4' } } },
        },
      },
    }),
  })
  /*
   * **기계 앞으로 간다.** 매점 방에 서서 사던 자리다 — 자판기가
   * 복도로 나간 뒤로는 방이 아니라 칸을 본다.
   */
  await must('standAt', A[1].token, { gameId: GAME, x: MACHINE.x, y: MACHINE.y })
  await must('buyShopItem', A[1].token, { gameId: GAME, itemId: 'nameTag' })
  check(true, '자유 시간에 자판기에서 남의 명찰을 샀다')

  const openedAt = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: openedAt, speed: 1 })

  console.log('\n── 페이즈를 열면 곧바로 제자리로 ──')
  // 자유 시간에 어디까지 갔든 종이 치면 전선이다. 걸어 돌아오지
  // 않는다 — 걸리면 그 페이즈를 통째로 길에서 버리게 된다
  const opened = await must('openPhase', host, { gameId: GAME })
  check(opened.no === 1, '첫 페이즈가 열렸다', `${opened.no}번`)
  now = (await pawnsNow())[a0.uid]
  check(now.tileId === 'centralPlaza', '멀리 있던 사람이 **곧바로** 전선에 섰다', String(now.tileId))
  check(now.postTile === 'centralPlaza', '전투 자리도 그대로다', String(now.postTile))
  check(now.arriveAtMs === null, '걷는 중이 아니다', String(now.arriveAtMs))
  /*
   * 도서관까지 **방을 옮겨** 간 a0 하나만 끌려 온다.
   *
   * A[1] 은 자판기 앞에 섰지만 그것은 복도 칸이라 선 방은 2-3 교실
   * 그대로다(standAt 은 at 만 적는다) — 떠난 적이 없으니 돌아올 것도
   * 없다. 기계가 방 안에 있던 때에는 이 사람도 둘째로 세어졌다.
   */
  check(Number(opened.returned) === 1, '방을 옮겨 갔던 사람만 끌려 온다', `${opened.returned}명`)
  check(Number(opened.allInAtMs) - openedAt < 60_000, '다 모인 시각은 곧 지금이다 — 아무도 안 걷는다',
    `${Number(opened.allInAtMs) - openedAt}ms`)

  const stayed = Object.entries(await pawnsNow()).filter(([uid]) => uid !== a0.uid)
  check(stayed.every(([, p]) => p.tileId !== null), '아무도 길 위에 없다')

  const roamNow = await call('roamTo', a0.token, { gameId: GAME, tileId: 'artRoom' })
  check(roamNow.code === 'FAILED_PRECONDITION', '페이즈 중에는 토큰을 써서 움직인다')

  console.log('\n── 토큰은 팀이 한 주머니를 나눠 쓴다 ──')
  // 판이 시작할 때 한 벌, 페이즈가 열릴 때 또 한 벌. **인원을 안 본다** —
  // 어느 팀이든 여섯씩이다
  const wantTokens = nextWallet({ held: TOKENS_PER_PHASE })
  const boxA = await boxOf('A')
  check(boxA === wantTokens, '열릴 때 팀 상자에 여섯이 더 든다', `${boxA}개 (바란 값 ${wantTokens})`)

  // **인원이 달라도 같다.** 곱셈이 돌아오면 여기가 갈라진다
  const boxC = await boxOf('C')
  check(boxC === boxA, `세 명짜리 C팀도 네 명짜리 A팀과 같다`, `C ${boxC} · A ${boxA}`)

  /**
   * 게임 시계를 민다. 걷는 10분이 지나야 도착한다.
   *
   * 「지금 + 10분」으로 잡으면 안 된다. 배속 1이면 게임 시계가 실제
   * 시간을 따라 흐르고, 호출 왕복에 몇 초가 지나간다 — 도착 예정보다
   * 몇 초 모자라서 영영 안 도착한다. 실제로 그랬다
   */
  let clockAt = openedAt
  const tickOn = async (minutes: number) => {
    const waiting = Object.values(await pawnsNow())
      .map((p) => Number(p.arriveAtMs ?? 0))
      .filter((n) => n > 0)
    clockAt = Math.max(clockAt + minutes * 60_000, ...waiting) + 5_000
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
    await must('tick', host, { gameId: GAME })
  }

  const step = await must('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: 'artRoom' })
  check(Number(step.tokens) === wantTokens - ACT_COST.move, '들어갈 때 토큰 하나', `${step.tokens}개 남음`)
  check((await boxOf('A')) === wantTokens - ACT_COST.move, '깎인 것은 **팀 상자**다')
  check((await boxOf('B')) === wantTokens, '남의 팀 상자는 안 건드린다')
  check(step.walking === true, '**바로 도착하지 않는다**')
  let mid = (await pawnsNow())[a0.uid]
  check(mid.tileId === null, '나가는 5분 · 들어가는 5분 동안은 어느 방에도 없다', String(mid.tileId))

  // 그 사이에 닫히면 아무 방도 못 가져간다
  const inTransit = await must('phaseNow', a0.token, { gameId: GAME })
  check(inTransit.alive === true, '아직 페이즈 안이다')

  await tickOn(MOVE_MINUTES)
  mid = (await pawnsNow())[a0.uid]
  check(mid.tileId === 'artRoom', `${MOVE_MINUTES}분 뒤에 도착했다`, String(mid.tileId))
  const been = (mid.visitedTiles as string[]) ?? []
  check(been.includes('artRoom'), '가 본 방으로 지도에 남는다', `${been.length}곳`)

  console.log('\n── 감출 것은 secret 아래에만 ──')
  await must('phaseAct', A[1].token, { gameId: GAME, kind: 'disguise' })
  const gameDoc = await getAll(`games`)
  check(!JSON.stringify(gameDoc).includes('disguised'), '**판 문서에 위장이 안 적힌다**')
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/phase`, { headers: { Authorization: `Bearer ${B[0].token}` } })
  check(asPlayer.status === 403, '남이 위장 목록을 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/phase`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 못 읽는다', String(asHost.status))

  // 같은 팀 다른 사람이 쓴 것도 같은 상자에서 빠진다
  const beforeMate = await boxOf('A')
  await must('phaseAct', A[1].token, { gameId: GAME, kind: 'move', targetTile: 'library' })
  check((await boxOf('A')) === beforeMate - ACT_COST.move, '**같은 팀 다른 사람이 써도 같은 상자가 준다**')
  await tickOn(MOVE_MINUTES)

  // 상자가 마를 때까지 왔다 갔다 한다
  let purse = await boxOf('A')
  for (let i = 0; purse > 0 && i < 20; i++) {
    const to = i % 2 === 0 ? 'centralPlaza' : 'artRoom'
    const r = await call('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: to })
    if (!r.ok) break
    await tickOn(MOVE_MINUTES)
    purse = await boxOf('A')
  }
  // **시계가 토큰보다 먼저 마른다.** 한 방에 10분이고 한 시간뿐이라,
  // 토큰 여섯 개를 다 쓰려면 딱 한 시간이 든다 — 돌아오는 걸음까지 치면
  // 언제나 시간이 먼저 끝난다. 토큰 바닥은 규칙 시험이 따로 본다
  const broke = await call('phaseAct', a0.token, { gameId: GAME, kind: 'move', targetTile: 'centralPlaza' })
  check(
    broke.code === 'FAILED_PRECONDITION' && /토큰|시간/.test(String(broke.message)),
    '토큰이든 시간이든 마르면 더는 못 움직인다',
    `${purse}개 남기고 — ${broke.message}`,
  )

  console.log('\n── 시간이 끝나면 아무도 못 움직인다 ──')
  const ends = Number(opened.endsAtMs)
  check(ends > openedAt, '끝나는 시각이 정해졌다', `${(ends - openedAt) / 60000}분`)
  clockAt = ends + 1000
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clockAt, speed: 1 })
  const late = await call('phaseAct', B[0].token, { gameId: GAME, kind: 'disguise' })
  check(late.code === 'FAILED_PRECONDITION' && String(late.message).includes('시간'), '시간이 끝났다', late.message)
  const info = await must('phaseNow', B[0].token, { gameId: GAME })
  check(info.open === true && info.alive === false, '열려 있지만 살아 있지는 않다')
  check(!JSON.stringify(info).includes('disguise'), '**누가 무엇을 했는지는 안 나간다**')

  console.log('\n── 닫으면 서 있는 자리로 정해진다 ──')
  check((await ownerOfTile('artRoom')) === null, '미술실은 처음에 주인이 없다', String(await ownerOfTile('artRoom')))
  const closed = await must('closePhase', host, { gameId: GAME })
  check(Number(closed.no) === 1, '1번 페이즈가 닫혔다')
  const after = await pawnsNow()
  check(after[a0.uid].postTile === after[a0.uid].tileId, '전선이 선 자리로 옮겨졌다')
  check((await boxOf('A')) > 0, '**남은 토큰은 들고 간다** — 거래할 물건이다', `${await boxOf('A')}개`)

  const openWide = async () => {
    await must('openPhase', host, { gameId: GAME })
    await tickOn(1)
  }
  /**
   * 거기까지 걸어간다. 한 방 들어갈 때마다 토큰 하나와 10분이 든다.
   * 시계를 밀어 주지 않으면 문 사이에 선 채로 끝난다.
   */
  const walkTo = async (who: { uid: string; token: string }, goal: string) => {
    for (let i = 0; i < 8; i++) {
      const here = (await pawnsNow())[who.uid].tileId as string | null
      if (here === goal) return
      if (here === null) {
        await tickOn(MOVE_MINUTES)
        continue
      }
      const next = stepToward(here, goal)
      if (!next) return
      const r = await call('phaseAct', who.token, { gameId: GAME, kind: 'move', targetTile: next })
      if (!r.ok) return
      await tickOn(MOVE_MINUTES)
    }
  }

  console.log('\n── 머릿수가 많은 팀이 가져간다 ──')
  await openWide()
  await walkTo(a0, 'artRoom')
  await walkTo(A[1], 'artRoom')
  await walkTo(B[0], 'artRoom')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('artRoom')) === 'A', 'A 둘이 B 하나를 이겼다', String(await ownerOfTile('artRoom')))
  const log2 = await getAll(`games/${GAME}/phaseLog`)
  check(JSON.stringify(log2).includes('captured'), '점령이 로그에 남았다')

  console.log('\n── 동점이면 안 바뀐다 ──')
  await openWide()
  await walkTo(B[1], 'artRoom')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('artRoom')) === 'A', '2대2가 되어도 주인이 그대로다')

  console.log('\n── 아무도 안 서면 주인이 없어진다 ──')
  // 「한 번 꽂으면 계속 내 것」이 아니다. 닫히는 순간 그 방에 선
  // 사람이 없으면 주인이 사라진다 — 지키러 돌아와야 한다
  await openWide()
  await walkTo(a0, 'musicRoom')
  await walkTo(A[1], 'musicRoom')
  await walkTo(B[0], 'scienceRoom')
  await walkTo(B[1], 'scienceRoom')
  await must('closePhase', host, { gameId: GAME })
  check((await ownerOfTile('artRoom')) === null, '다 빠져나가면 주인이 없어진다', String(await ownerOfTile('artRoom')))

  console.log('\n── 주장은 둘로 센다 ──')
  const cap = C.find((p) => (started[p.uid] as { captain?: boolean }).captain === true)
  check(cap !== undefined, '주장을 찾았다')

  console.log('\n── 좁은 방은 둘까지 ──')
  const narrow = Object.entries(ROOM_KIND).find(([, k]) => k === 'narrow')?.[0] as string
  check(capacityOf(narrow) === 2, `${narrow}은 정원 2다`)

  console.log('\n── 페이즈가 아니면 못 한다 ──')
  const shut = await call('phaseAct', a0.token, { gameId: GAME, kind: 'disguise' })
  check(shut.code === 'FAILED_PRECONDITION', '닫힌 뒤에는 못 한다', shut.message)
  const notHost = await call('openPhase', a0.token, { gameId: GAME })
  check(notHost.code === 'PERMISSION_DENIED', '운영자만 페이즈를 연다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
