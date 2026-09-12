// 행동 · 교역 · 동맹을 진짜 서버로.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/act-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { BASE_OF } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'
import { meetAt } from './meet'

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
async function getDoc<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return r.ok ? (plain(await r.json()) as T) : null
}

/** 시험 준비용. 규칙을 건너뛰고 자원을 심는다. */
async function setResources(team: string, res: Record<string, number>): Promise<void> {
  await fetch(
    `${FS}/games/${GAME}/teams/${team}?updateMask.fieldPaths=resources`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({
        fields: {
          resources: {
            mapValue: {
              fields: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { integerValue: String(v) }])),
            },
          },
        },
      }),
    },
  )
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

const GAME = `act${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'act' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 9))
  check(true, '판이 시작했다')

  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  const me = A[0]
  const team = async (t: TeamId) => (await getDoc(`games/${GAME}/teams/${t}`)) as { resources: Record<string, number>; tokens: number; researchTier: number; allyTeam: string | null }
  const tile = async (id: string) => (await getDoc(`games/${GAME}/tiles/${id}`)) as { buildings: { kind: string; level: number }[] }

  console.log('\n── 짓기 ──')
  const notOurs = await call('buildOn', me.token, { gameId: GAME, tileId: 'library', kind: 'observatory' })
  check(notOurs.code === 'FAILED_PRECONDITION', '남의 칸에는 못 짓는다', notOurs.message)
  const base = await call('buildOn', me.token, { gameId: GAME, tileId: BASE_OF.A, kind: 'observatory' })
  check(base.code === 'FAILED_PRECONDITION', '기지에도 못 짓는다', base.message)

  // 기지 옆 우리 칸으로 걸어가 거기 짓는다
  await must('moveTo', me.token, { gameId: GAME, tileId: 'classroom' })
  const p1 = await getDoc(`games/${GAME}/pawns/${me.uid}`) as { arriveAtMs: number }
  await clock(Number(p1.arriveAtMs))
  await must('tick', me.token, { gameId: GAME })

  const before = await team('A')
  const built = await must('buildOn', me.token, { gameId: GAME, tileId: 'classroom', kind: 'observatory' })
  check(Boolean(built.built), '우리 칸에 지었다', String(built.built))
  const after = await team('A')
  check(after.tokens === before.tokens - 1, '토큰이 하나 빠졌다', `${before.tokens} → ${after.tokens}`)
  check(after.resources.money < before.resources.money, '돈이 빠졌다', `${before.resources.money} → ${after.resources.money}`)
  check((await tile('classroom')).buildings.length === 1, '건물이 놓였다')
  check((await call('buildOn', me.token, { gameId: GAME, tileId: 'classroom', kind: 'observatory' })).code === 'FAILED_PRECONDITION', '같은 건물 두 번은 못 짓는다')

  console.log('\n── 관측소가 시야를 넓히는가 ──')
  const view = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as { visibleTiles: string[]; trades: { id: string }[]; proposals: { id: string }[] }
  const seen = (await view(me.uid)).visibleTiles
  check(seen.length >= 6, '관측소를 지으니 더 보인다', `${seen.length}칸`)

  console.log('\n── 개조 ──')
  const up = await must('upgradeOn', me.token, { gameId: GAME, tileId: 'classroom', kind: 'observatory' })
  check(Boolean(up.upgraded), '개조했다')
  check((await tile('classroom')).buildings[0].level === 2, '단계가 2가 됐다')

  console.log('\n── 연구 ──')
  // 토큰은 08:00에 둘, 10·12·14·16·18·20시에 하나씩 찬다.
  // 여기까지 둘을 썼으니 시계를 옮겨 채운다
  await clock(dayHourMs(START, 1, 14))
  await must('tick', me.token, { gameId: GAME })
  const t0 = (await team('A')).researchTier
  const res = await call('research', A[1].token, { gameId: GAME, tileId: BASE_OF.A })
  if (res.ok) {
    check((await team('A')).researchTier === t0 + 1, '연구 단계가 올랐다')
  } else {
    check(res.code === 'FAILED_PRECONDITION', '지식이 모자라 거절', res.message)
  }

  console.log('\n── 탐색 ──')
  // 남의 칸이나 빈 칸에서만
  const ourZone = await call('scout', me.token, { gameId: GAME, tileId: 'classroom' })
  check(ourZone.code === 'FAILED_PRECONDITION', '우리 칸은 못 뒤진다', ourZone.message)
  await must('moveTo', me.token, { gameId: GAME, tileId: 'library' })
  const p2 = await getDoc(`games/${GAME}/pawns/${me.uid}`) as { arriveAtMs: number }
  await clock(Number(p2.arriveAtMs))
  await must('tick', me.token, { gameId: GAME })
  await clock(dayHourMs(START, 1, 18))
  await must('tick', me.token, { gameId: GAME })
  const s1 = await call('scout', me.token, { gameId: GAME, tileId: 'library' })
  if (s1.ok) {
    check(true, '빈 칸을 뒤졌다', JSON.stringify(s1.data?.got))
    // 같은 팀의 **다른 사람**이 같은 칸을 뒤진다. 자리도 토큰도
    // 멀쩡하니 거절 사유가 「하루 한 번」이어야 한다
    const other = A[2]
    await must('moveTo', other.token, { gameId: GAME, tileId: 'library' })
    // pawn.arriveAtMs는 **다음 한 칸** 도착 시각이다. 목적지가 아니다.
    // 두 칸이면 칸당 15분을 더 얹어야 다 걷는다
    const p3 = await getDoc(`games/${GAME}/pawns/${other.uid}`) as { arriveAtMs: number; path: string[] }
    await clock(Number(p3.arriveAtMs) + p3.path.length * 15 * 60_000)
    await must('tick', other.token, { gameId: GAME })
    check((await getDoc(`games/${GAME}/pawns/${other.uid}`) as { tileId: string }).tileId === 'library', '다른 사람도 도서관에 섰다')
    const again = await call('scout', other.token, { gameId: GAME, tileId: 'library' })
    check(again.message === '오늘 이미 뒤진 칸이다.', '같은 칸은 팀당 하루 한 번', again.message)
  } else {
    check(false, '탐색', s1.message)
  }

  console.log('\n── 생산 ──')
  const prodBad = await call('produce', me.token, { gameId: GAME, tileId: 'library' })
  check(prodBad.code === 'FAILED_PRECONDITION', '우리 땅이 아니면 못 만든다', prodBad.message)

  console.log('\n── 교역 ──')
  await clock(dayHourMs(START, 2, 12))
  await must('tick', me.token, { gameId: GAME })
  // 교역도 동맹도 그 팀 사람과 마주 서야 꺼낼 수 있다. 복도에 모인다
  await meetAt(must, GAME, 'hallway', people, (ms) => clock(ms), dayHourMs(START, 2, 18))
  const badBag = await call('offerTrade', me.token, { gameId: GAME, toTeam: 'B', give: { money: -3 }, want: {} })
  check(badBag.code === 'INVALID_ARGUMENT', '음수 자원은 거절', badBag.message)
  const empty = await call('offerTrade', me.token, { gameId: GAME, toTeam: 'B', give: {}, want: {} })
  check(empty.code === 'FAILED_PRECONDITION', '빈 제안은 거절', empty.message)
  check((await call('offerTrade', me.token, { gameId: GAME, toTeam: 'A', give: { money: 1 }, want: {} })).code === 'FAILED_PRECONDITION', '우리 팀에는 못 보낸다')

  const offer = await must('offerTrade', me.token, { gameId: GAME, toTeam: 'B', give: { money: 2 }, want: { knowledge: 1 }, note: 'A와 B만 보는 말' })
  const tradeId = String(offer.id)
  const aView = await view(me.uid)
  const bView = await view(B[0].uid)
  const cView = await view(C[0].uid)
  check(aView.trades.some((t) => t.id === tradeId), '보낸 팀 몫에 있다')
  check(bView.trades.some((t) => t.id === tradeId), '받는 팀 몫에 있다')
  check(!cView.trades.some((t) => t.id === tradeId), '상관없는 팀 몫에는 없다')
  check(!JSON.stringify(cView).includes('A와 B만 보는 말'), '덧붙인 말도 안 새어 나간다')

  check((await call('respondTrade', C[0].token, { gameId: GAME, tradeId, accept: true })).code === 'PERMISSION_DENIED', '남의 제안에는 답 못 한다')
  const aMoney = (await team('A')).resources.money
  const bKnow = (await team('B')).resources.knowledge
  await must('respondTrade', B[0].token, { gameId: GAME, tradeId, accept: true })
  check((await team('A')).resources.money === aMoney - 2, 'A가 돈 2를 냈다')
  check((await team('B')).resources.knowledge === bKnow - 1, 'B가 지식 1을 냈다')
  check((await team('A')).resources.knowledge > 0, 'A가 지식을 받았다')
  check((await call('respondTrade', B[0].token, { gameId: GAME, tradeId, accept: true })).code === 'FAILED_PRECONDITION', '끝난 제안에 또 답 못 한다')

  console.log('\n── 동맹 ──')
  check((await call('proposeAlliance', me.token, { gameId: GAME, withTeam: 'A' })).code === 'FAILED_PRECONDITION', '우리 팀과는 못 맺는다')
  const prop = await must('proposeAlliance', me.token, { gameId: GAME, withTeam: 'B' })
  const propId = String(prop.id)
  check((await view(C[0].uid)).proposals.length === 0, '상관없는 팀 몫에는 제안이 없다')
  check((await call('respondAlliance', C[0].token, { gameId: GAME, proposalId: propId, accept: true })).code === 'PERMISSION_DENIED', '남의 제안에는 답 못 한다')
  await must('respondAlliance', B[0].token, { gameId: GAME, proposalId: propId, accept: true })
  check((await team('A')).allyTeam === 'B' && (await team('B')).allyTeam === 'A', '양쪽 다 맺혔다')
  check((await call('proposeAlliance', me.token, { gameId: GAME, withTeam: 'C' })).code === 'FAILED_PRECONDITION', '동맹은 한 번에 하나다')

  // 영향력이 0이면 「2를 잃는다」가 확인되지 않는다. 심어 두고 본다
  const nowRes = (await team('A')).resources
  await setResources('A', { ...nowRes, influence: 5 })
  const infl = (await team('A')).resources.influence
  check(infl === 5, '영향력 5를 심었다')
  const broke = await must('breakAllianceNow', me.token, { gameId: GAME })
  check(broke.broke === 'B', '먼저 깼다')
  check((await team('A')).allyTeam === null && (await team('B')).allyTeam === null, '양쪽 다 풀렸다')
  check((await team('A')).resources.influence === infl - 2, '깬 쪽이 영향력 2를 잃었다', `${infl} → ${(await team('A')).resources.influence}`)
  check((await team('B')).resources.influence === 0, '당한 쪽은 아무것도 안 잃었다')
  check((await call('proposeAlliance', me.token, { gameId: GAME, withTeam: 'C' })).code === 'FAILED_PRECONDITION', '깬 뒤에는 잠긴다')
  // 당한 쪽은 잠기지 않는다
  check((await call('proposeAlliance', B[0].token, { gameId: GAME, withTeam: 'C' })).ok, '당한 쪽은 바로 새로 맺을 수 있다')

  console.log('\n── DAY 4에 동맹이 풀리는가 ──')
  await must('respondAlliance', C[0].token, {
    gameId: GAME,
    proposalId: String(((await view(C[0].uid)).proposals[0] ?? {}).id),
    accept: true,
  })
  check((await team('B')).allyTeam === 'C', 'B와 C가 맺었다')
  await clock(dayHourMs(START, 4, 9))
  await must('tick', me.token, { gameId: GAME })
  check((await team('B')).allyTeam === null && (await team('C')).allyTeam === null, 'DAY 4 아침에 모든 동맹이 풀렸다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
