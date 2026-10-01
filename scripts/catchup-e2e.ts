// 따라잡기를 **진짜 서버로** 확인한다.
//
// **시계는 달력을 넘기지 않는다.** 판을 세워 두고 며칠 지나면 아무도
// 안 들어온 사이에 닷새가 지나가 버려서, 다음에 들어온 사람은 엔딩만
// 봤다. 그래서 날이 바뀌는 것도 정산도 끝나는 것도 운영자가 pushDay 로
// 민다 — 시계가 미는 것은 걸음(도착)뿐이다.
//
// 여기서 보는 것: 시간이 아무리 흘러도 tick 이 달력을 안 민다는 것,
// pushDay 가 원래 순서대로 한 번에 한 칸씩 넘긴다는 것, 두 번 눌러도
// 두 번 처리되지 않는다는 것.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/catchup-e2e.ts
import { STARTING_TEAM_SIZES, TOTAL_DAYS, type TeamId } from '../shared/rules/v2'
import { TOKEN_CAP } from '../shared/rules/occupy'
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
async function token(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}

async function call(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}

const num = (v: unknown) => Number((v as { integerValue?: string; doubleValue?: number })?.integerValue ?? (v as { doubleValue?: number })?.doubleValue ?? NaN)

async function doc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? null
}
async function list(path: string): Promise<{ id: string; f: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string; fields: Record<string, unknown> }[] }
  return (j.documents ?? []).map((d) => ({ id: d.name.split('/').pop() as string, f: d.fields }))
}

const GAME = `tick${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0) // DAY 1 08:00 KST

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const hostEmail = await signUp(`h-${GAME}@x.test`)
  await setAdmin(hostEmail)
  const host = await token(hostEmail)

  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < n; i++) want.push(t)
  }
  await call('createGame', host, { gameId: GAME, seed: 'fixed' })
  const seats: string[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const e = await signUp(`p${i}-${GAME}@x.test`)
    const tk = await token(e)
    seats.push(tk)
    await call('joinGame', tk, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  check(true, '열넷이 앉고 판이 시작했다')

  /** 게임 속 시각을 그 자리에 고정한다. 배속 1이면 실제 시간이 안 흐른다 */
  const setClock = (gameMs: number) => call('setDevClock', host, { gameId: GAME, anchorGameMs: gameMs, speed: 1 })

  const doneCount = async () => (await list(`games/${GAME}/schedule`)).filter((d) => d.f.doneAtMs && !('nullValue' in (d.f.doneAtMs as object))).length
  const events = async (kind: string) => (await list(`games/${GAME}/events`)).filter((e) => (e.f.kind as { stringValue: string }).stringValue === kind)
  const game = () => doc(`games/${GAME}`)

  console.log('\n── DAY 1 ──')
  await setClock(dayHourMs(START, 1, 12))
  let r = await call('tick', seats[0], { gameId: GAME })
  check(r.applied === 0, 'DAY 1 낮에는 밀 것이 없다', `${r.applied}건`)
  check(num((await game())?.day) === 1, '아직 1일차')

  // 토큰은 **팀 상자 하나**(teams/{팀}.phaseTokens)이고, 시계가 아니라 운영자가
  // 페이즈를 열 때(openPhase)만 채워진다. 시간이 흘러도 저절로 늘지 않는다
  const tokensOf = async (t: TeamId) => num((await doc(`games/${GAME}/teams/${t}`))?.phaseTokens)
  check((await tokensOf('A')) === 0, '페이즈를 안 열었으니 DAY 1 12:00에도 팀 토큰은 0', `${await tokensOf('A')}개`)

  console.log('\n── 정산 ──')
  // 21시가 지나도 시계는 정산을 안 민다. 여기가 이 판의 새 규칙이다
  await setClock(dayHourMs(START, 1, 21))
  r = await call('tick', seats[0], { gameId: GAME })
  check(r.applied === 0, 'DAY 1 21:00이 지나도 시계는 정산을 안 민다', `${r.applied}건`)
  check((await events('settlement')).length === 0, '정산 기록도 아직 없다')

  // 누르기 전에 무엇을 누르는지 보인다
  const peek = await call('peekDay', host, { gameId: GAME })
  const nextOf = (x: Record<string, unknown>) => (x.next ?? null) as { kind: string; day: number } | null
  check(nextOf(peek)?.kind === 'settlement', '다음에 넘길 것은 정산이다', String(nextOf(peek)?.kind))

  let h = await call('pushDay', host, { gameId: GAME })
  check((h.pushed as { kind: string } | null)?.kind === 'settlement', '운영자가 정산을 넘겼다')
  const settle1 = await events('settlement')
  check(settle1.length === 1, '정산 기록이 하나 남았다')
  check(nextOf(h)?.kind === 'dayStart', '그 다음은 DAY 2 아침이다', String(nextOf(h)?.kind))

  // 두 번 불러도 두 번 처리되지 않는다 — tick 도 pushDay 도
  r = await call('tick', seats[1], { gameId: GAME })
  check(r.applied === 0, '시계는 여전히 아무것도 안 민다', `${r.applied}건`)
  check((await events('settlement')).length === 1, '정산 기록도 그대로 하나')

  const g1 = await game()
  const spot = ((g1?.spotlightTeams as { arrayValue: { values: { stringValue: string }[] } }).arrayValue.values ?? [])[0]
  check(Boolean(spot?.stringValue), '주목 팀이 정해졌다', spot?.stringValue)

  console.log('\n── 아무도 안 들어온 채 이틀이 지나도 ──')
  await setClock(dayHourMs(START, 3, 12))
  r = await call('tick', seats[2], { gameId: GAME })
  check(r.applied === 0, '이틀이 지나도 시계는 날을 안 넘긴다', `${r.applied}건`)
  check(num((await game())?.day) === 1, '아직 1일차 그대로', String(num((await game())?.day)))

  console.log('\n── 손으로 셋을 넘긴다 ──')
  // 아침 2 · 정산 2 · 아침 3. 한 번 누르면 한 칸이다
  for (const want of ['dayStart', 'settlement', 'dayStart']) {
    h = await call('pushDay', host, { gameId: GAME })
    check((h.pushed as { kind: string } | null)?.kind === want, `${want} 을(를) 넘겼다`, String((h.pushed as { kind: string } | null)?.kind))
  }
  check(num((await game())?.day) === 3, '날이 3일차가 됐다', String(num((await game())?.day)))
  check((await events('dayStart')).length === 2, '아침 기록이 둘')
  check((await events('settlement')).length === 2, '정산 기록이 둘')

  // 날을 넘겨도(아침·정산) 토큰은 안 생긴다 — 채우는 곳은 openPhase 하나다.
  // 어느 쪽이든 팀 상자는 한도(occupy TOKEN_CAP)를 넘지 않는다
  const t3 = await tokensOf('A')
  check(t3 === 0, '날을 넘겨도 팀 토큰은 저절로 안 생긴다', `${t3}개`)
  check(t3 <= TOKEN_CAP, `토큰이 한도(${TOKEN_CAP})를 안 넘는다`, `${t3}개`)

  // 「만회 팀」 검사는 지웠다 — 만회 보너스(꼴찌 팀이 다음 아침에 더 받는 것)가
  // 규칙에서 없어졌다. 받는 쪽이 없으니 볼 것이 없다

  // 「핵심 칸이 열리는가」(openedTiles)·「기록이 가리킨 칸의 가치」(boostedTiles)
  // 검사는 지웠다 — 날마다 핵심 칸이 열리는 규칙과 칸 가치 올리기가 없어져서
  // 서버가 그 값을 더는 적지 않는다

  console.log('\n── 마지막 여섯 시간 ──')
  // 판은 이제 나흘(TOTAL_DAYS)이다. 마지막 날 15시에 점수판을 끈다
  await setClock(dayHourMs(START, TOTAL_DAYS, 16))
  // 정산 3 · 아침 4 · 점수판 끄기 → 셋
  for (let i = 0; i < 3; i++) h = await call('pushDay', host, { gameId: GAME })
  check((h.pushed as { kind: string } | null)?.kind === 'lastHours', '셋째에 점수판을 껐다', String((h.pushed as { kind: string } | null)?.kind))
  const g5 = await game()
  check((g5?.lastHours as { booleanValue: boolean }).booleanValue === true, '점수판이 꺼졌다')
  const scoreA = await doc(`games/${GAME}/teams/A`)
  check('nullValue' in (scoreA?.publicScore as object), '공개 점수가 지워졌다')

  console.log('\n── 끝 ──')
  await setClock(dayHourMs(START, TOTAL_DAYS, 25))
  // **마지막 날이 지나도 저절로 안 끝난다.** 여기가 「엔딩만 뜬다」를 막는 자리다
  r = await call('tick', seats[4], { gameId: GAME })
  check(r.applied === 0, `${TOTAL_DAYS}일이 다 지나도 시계는 판을 안 끝낸다`, `${r.applied}건`)
  check(r.phase === 'running', '아직 돌고 있다', String(r.phase))

  h = await call('pushDay', host, { gameId: GAME })
  check((h.pushed as { kind: string } | null)?.kind === 'settlement', `DAY ${TOTAL_DAYS} 정산을 넘겼다`)
  h = await call('pushDay', host, { gameId: GAME })
  check((h.pushed as { kind: string } | null)?.kind === 'gameEnd', '운영자가 판을 끝냈다')
  check(h.phase === 'finished', '판이 끝났다', String(h.phase))
  h = await call('pushDay', host, { gameId: GAME })
  check(h.pushed === null, '끝난 판은 더 넘길 것이 없다')

  // 아침 3(DAY 2~4) · 정산 4 · 점수판 끄기 1 · 끝 1 → 아홉
  const scheduled = (TOTAL_DAYS - 1) + TOTAL_DAYS + 1 + 1
  check((await doneCount()) === scheduled, `예정 이벤트 ${scheduled}개가 전부 밀렸다`, `${await doneCount()}건`)
  check((await events('gameEnd')).length === 1, '끝 기록이 하나')
  check((await events('settlement')).length === TOTAL_DAYS, '정산이 날마다', `${(await events('settlement')).length}건`)

  console.log('\n── 한꺼번에 들어와도 ──')
  // 열넷이 아침에 동시에 접속하는 건 흔한 일이다. 같은 정산이 두 번
  // 처리되면 자원이 두 배로 들어간다
  const GAME2 = `race${Date.now()}`
  await call('createGame', host, { gameId: GAME2, seed: 'race' })
  for (let i = 0; i < TOTAL_SEATS; i++) {
    await call('joinGame', seats[i], { gameId: GAME2, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME2 })
  await call('startGame', host, { gameId: GAME2, startAtMs: START })
  await call('setDevClock', host, { gameId: GAME2, anchorGameMs: dayHourMs(START, 3, 12), speed: 1 })

  // 운영자가 손가락이 미끄러져 넷을 연달아 눌러도, 같은 칸이 두 번
  // 처리되면 안 된다. 자원이 두 배로 들어간다
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => call('pushDay', host, { gameId: GAME2 })),
  )
  const okRuns = results.filter((r) => r.status === 'fulfilled')
  check(okRuns.length === 4, '넷을 동시에 눌러도 전부 응답한다', `${okRuns.length}/4`)
  const pushedKinds = okRuns
    .map((r) => (r as PromiseFulfilledResult<Record<string, unknown>>).value.pushed as { kind: string } | null)
    .filter((x): x is { kind: string } => x !== null)

  const ev2 = await list(`games/${GAME2}/events`)
  const kindCount = (k: string) => ev2.filter((e) => (e.f.kind as { stringValue: string }).stringValue === k).length
  const logged = kindCount('settlement') + kindCount('dayStart') + kindCount('lastHours') + kindCount('gameEnd')
  // 몇 칸이 넘어갔든, 넘어갔다고 말한 수와 기록에 남은 수가 같아야 한다
  check(logged === pushedKinds.length, '민 만큼만 기록됐다', `말한 것 ${pushedKinds.length} · 남은 것 ${logged}`)
  check(pushedKinds.length >= 1, '적어도 한 칸은 넘어갔다', `${pushedKinds.length}칸`)

  // 「DAY 5에 중앙광장이 열렸다」 검사는 지웠다 — 핵심 칸 열기(openedTiles)가 규칙에서 없어졌다

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
