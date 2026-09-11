// 따라잡기를 **진짜 서버로** 확인한다.
//
// 개발용 시계를 DAY 1 08:00에 걸고, 시계를 앞으로 옮겨 가며 tick을
// 부른다. 밀린 아침과 정산이 제때 처리되는지, 두 번 불러도 두 번
// 처리되지 않는지, 이틀을 건너뛰어도 그 사이가 전부 밀리는지 본다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/catchup-e2e.ts
import { TEAM_SIZES, TOKEN_CAP, type TeamId } from '../shared/rules/v2'
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
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) {
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

  // 08:00에 2개로 시작해 10·12시에 한 개씩 → 4개
  const tokensOf = async (t: TeamId) => num((await doc(`games/${GAME}/teams/${t}`))?.tokens)
  check((await tokensOf('A')) === 4, 'DAY 1 12:00까지 토큰 넷', `${await tokensOf('A')}개`)

  console.log('\n── 정산 ──')
  await setClock(dayHourMs(START, 1, 21))
  r = await call('tick', seats[0], { gameId: GAME })
  check(r.applied === 1, 'DAY 1 21:00에 정산 하나', `${r.applied}건`)
  const settle1 = await events('settlement')
  check(settle1.length === 1, '정산 기록이 하나 남았다')

  // 두 번 불러도 두 번 처리되지 않는다
  r = await call('tick', seats[1], { gameId: GAME })
  check(r.applied === 0, '같은 시각에 또 불러도 다시 안 민다', `${r.applied}건`)
  check((await events('settlement')).length === 1, '정산 기록도 그대로 하나')

  const g1 = await game()
  const spot = ((g1?.spotlightTeams as { arrayValue: { values: { stringValue: string }[] } }).arrayValue.values ?? [])[0]
  check(Boolean(spot?.stringValue), '주목 팀이 정해졌다', spot?.stringValue)

  console.log('\n── 이틀 건너뛰기 ──')
  // DAY 2·3을 아무도 안 들어온 채 보낸다
  await setClock(dayHourMs(START, 3, 12))
  r = await call('tick', seats[2], { gameId: GAME })
  // 아침 2·3, 정산 2 → 셋
  check(r.applied === 3, '빠진 아침 둘과 정산 하나를 한 번에 민다', `${r.applied}건`)
  check(num((await game())?.day) === 3, '날이 3일차로 맞춰졌다', String(num((await game())?.day)))
  check((await events('dayStart')).length === 2, '아침 기록이 둘')
  check((await events('settlement')).length === 2, '정산 기록이 둘')

  // 토큰은 한도를 넘지 않는다
  const t3 = await tokensOf('A')
  check(t3 <= TOKEN_CAP, `토큰이 한도(${TOKEN_CAP})를 안 넘는다`, `${t3}개`)

  // 만회 보너스: 꼴찌 팀은 다음 08:00에 더 받는다
  const g3 = await game()
  const comeback = ((g3?.comebackTeams as { arrayValue: { values: { stringValue: TeamId }[] } }).arrayValue.values ?? [])[0]?.stringValue
  check(Boolean(comeback), '만회 팀이 정해졌다', comeback)

  console.log('\n── 핵심 칸이 열리는가 ──')
  const opened = (await game())?.openedTiles as { arrayValue: { values?: { stringValue: string }[] } }
  const names = (opened.arrayValue.values ?? []).map((v) => v.stringValue)
  // DAY 1 운동장·방송실, DAY 2 강당·학생회실. DAY 3에는 없다
  //
  // DAY 1의 08:00은 시작 그 자체라 예정 이벤트가 없다. 첫날 것을
  // startGame이 직접 놓지 않으면 영영 안 열린다
  check(names.includes('playground') && names.includes('broadcastRoom'), 'DAY 1 핵심 둘이 열렸다', names.join(','))
  check(names.includes('auditorium') && names.includes('studentCouncil'), 'DAY 2 핵심 둘이 열렸다', names.join(','))
  check(!names.includes('centralPlaza'), '중앙광장은 아직 안 열렸다')

  // 그날까지 나온 기록이 가리킨 칸의 가치가 올라 있다
  const boosted = ((await game())?.boostedTiles as { arrayValue: { values?: { stringValue: string }[] } }).arrayValue.values ?? []
  check(boosted.length === 3, 'DAY 3까지 기록 셋이 칸을 가리켰다', boosted.map((v) => v.stringValue).join(','))

  console.log('\n── 마지막 여섯 시간 ──')
  await setClock(dayHourMs(START, 5, 16))
  r = await call('tick', seats[3], { gameId: GAME })
  // 아침 4·5, 정산 3·4, 마지막 여섯 시간 → 다섯
  check(r.applied === 5, 'DAY 5 16:00까지 다섯을 민다', `${r.applied}건`)
  const g5 = await game()
  check((g5?.lastHours as { booleanValue: boolean }).booleanValue === true, '점수판이 꺼졌다')
  const scoreA = await doc(`games/${GAME}/teams/A`)
  check('nullValue' in (scoreA?.publicScore as object), '공개 점수가 지워졌다')

  console.log('\n── 끝 ──')
  await setClock(dayHourMs(START, 5, 25))
  r = await call('tick', seats[4], { gameId: GAME })
  // 정산 5, 끝 → 둘
  check(r.applied === 2, 'DAY 5 정산과 끝을 민다', `${r.applied}건`)
  check(r.phase === 'finished', '판이 끝났다', String(r.phase))
  r = await call('tick', seats[5], { gameId: GAME })
  check(r.applied === 0, '끝난 판은 더 밀지 않는다')

  check((await doneCount()) === 11, '예정 이벤트 열하나가 전부 밀렸다', `${await doneCount()}건`)
  check((await events('gameEnd')).length === 1, '끝 기록이 하나')
  check((await events('settlement')).length === 5, '정산이 닷새 모두', `${(await events('settlement')).length}건`)

  console.log('\n── 한꺼번에 들어와도 ──')
  // 열넷이 아침에 동시에 접속하는 건 흔한 일이다. 같은 정산이 두 번
  // 처리되면 자원이 두 배로 들어간다
  const GAME2 = `race${Date.now()}`
  await call('createGame', host, { gameId: GAME2, seed: 'race' })
  for (let i = 0; i < TOTAL_SEATS; i++) {
    await call('joinGame', seats[i], { gameId: GAME2, name: `봇${i}`, team: want[i] })
  }
  await call('startGame', host, { gameId: GAME2, startAtMs: START })
  await call('setDevClock', host, { gameId: GAME2, anchorGameMs: dayHourMs(START, 3, 12), speed: 1 })

  const results = await Promise.allSettled(
    seats.slice(0, 6).map((tk) => call('tick', tk, { gameId: GAME2 })),
  )
  const okRuns = results.filter((r) => r.status === 'fulfilled')
  check(okRuns.length === 6, '여섯이 동시에 불러도 전부 응답한다', `${okRuns.length}/6`)
  const totalApplied = okRuns.reduce((a, r) => a + Number((r as PromiseFulfilledResult<Record<string, unknown>>).value.applied), 0)
  // 아침 2·3 + 정산 1·2 = 넷. 여섯이 나눠 밀든 하나가 다 밀든 합은 넷이다
  check(totalApplied === 4, '여섯이 나눠 밀어도 합은 넷', `${totalApplied}건`)

  const ev2 = await list(`games/${GAME2}/events`)
  const kindCount = (k: string) => ev2.filter((e) => (e.f.kind as { stringValue: string }).stringValue === k).length
  check(kindCount('settlement') === 2, '정산이 딱 두 번만 기록됐다', `${kindCount('settlement')}건`)
  check(kindCount('dayStart') === 2, '아침도 딱 두 번', `${kindCount('dayStart')}건`)

  console.log('\n── 중앙광장 ──')
  const finalOpened = ((await game())?.openedTiles as { arrayValue: { values?: { stringValue: string }[] } }).arrayValue.values ?? []
  check(finalOpened.map((v) => v.stringValue).includes('centralPlaza'), 'DAY 5에 중앙광장이 열렸다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
