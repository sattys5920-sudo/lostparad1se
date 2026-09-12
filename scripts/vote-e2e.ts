// 표 · 털어놓기 · 투명인간을 진짜 서버로.
//
// 여기서 제일 중요한 확인은 **보낸 사람이 어디로도 안 나가는 것**이다.
// 표는 익명이어야 하고, 익명이 아니면 투명인간 투표가 게임이 아니라
// 보복이 된다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/vote-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
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
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
/**
 * 문서 안 어딘가에 이 **열쇠**가 있는가.
 *
 * 「아이디가 문자열로 들어 있나」로 찾으면 안 된다. 같은 아이디가
 * 보이는 말 목록이나 고백의 들은 사람 목록에 정당하게 들어 있을 수
 * 있어서, 새지 않았는데 샌 것처럼 잡힌다. 담기는 **모양**을 본다.
 */
function hasKey(v: unknown, key: string): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some((x) => hasKey(x, key))
  const o = v as Record<string, unknown>
  if (key in o) return true
  return Object.values(o).some((x) => hasKey(x, key))
}

/** 그 값이 이 열쇠 아래에 들어 있는가. */
function hasValueUnder(v: unknown, key: string, value: string): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some((x) => hasValueUnder(x, key, value))
  const o = v as Record<string, unknown>
  if (o[key] === value) return true
  return Object.values(o).some((x) => hasValueUnder(x, key, value))
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

const GAME = `vote${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'vote' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 10))
  check(true, '판이 시작했다')


  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  const C = people.filter((p) => p.team === 'C')
  const game = () => getDoc(`games/${GAME}`) as Promise<{ invisibleId: string | null; invisibleByDay: Record<string, string | null>; day: number }>
  const team = async (t: TeamId) => (await getDoc(`games/${GAME}/teams/${t}`)) as { resources: Record<string, number> }

  const A0 = people.filter((p) => p.team === 'A')
  const B0 = people.filter((p) => p.team === 'B')

  console.log('\n── 멀리 있으면 안 된다 ──')
  // 시작하면 각자 자기 기지에 선다. A팀 기지와 B팀 기지는 다른 방이다
  const far = await call('castVote', A0[0].token, { gameId: GAME, targetId: B0[0].uid, kind: 'trust' })
  check(far.code === 'FAILED_PRECONDITION', '학교 반대편 사람에게는 표를 못 준다', far.message)
  const farSay = await call('revealSecret', A0[0].token, { gameId: GAME, scope: 'private', listenerIds: [B0[0].uid] })
  check(farSay.code === 'FAILED_PRECONDITION', '멀리 있는 사람에게는 못 털어놓는다', farSay.message)
  const farDeal = await call('offerTrade', A0[0].token, { gameId: GAME, toTeam: 'B', give: { money: 1 }, want: { knowledge: 1 } })
  check(farDeal.code === 'FAILED_PRECONDITION', '멀리 있는 팀에는 교역을 못 건다', farDeal.message)

  // 표도 교역도 털어놓기도 그 자리에서 만나야 한다. 복도에 모인다
  console.log('\n── 한자리에 모은다 ──')
  await meetAt(must, GAME, 'hallway', people, (ms) => clock(ms), dayHourMs(START, 1, 16))
  const standing = await getAll(`games/${GAME}/pawns`)
  const atHall = standing.filter((p) => p.d.tileId === 'hallway').length
  check(atHall === TOTAL_SEATS, '열넷이 복도에 섰다', `${atHall}명`)

  console.log('\n── 표 ──')
  check((await call('castVote', A[0].token, { gameId: GAME, targetId: A[0].uid, kind: 'trust' })).code === 'FAILED_PRECONDITION', '자기에게는 못 준다')
  check((await call('castVote', A[0].token, { gameId: GAME, targetId: A[1].uid, kind: 'trust' })).code === 'FAILED_PRECONDITION', '같은 팀에는 못 준다')
  check((await call('castVote', A[0].token, { gameId: GAME, targetId: B[0].uid, kind: '좋아요' })).code === 'INVALID_ARGUMENT', '없는 표는 거절')

  await must('castVote', A[0].token, { gameId: GAME, targetId: B[0].uid, kind: 'trust' })
  check(true, '신뢰표를 던졌다')
  check((await call('castVote', A[0].token, { gameId: GAME, targetId: C[0].uid, kind: 'trust' })).code === 'FAILED_PRECONDITION', '하루 한 장뿐')

  // 응답에 「짚었는지」가 없어야 한다 — 있으면 표 한 장으로 역할을 찍는다
  const cast = await must('castVote', A[1].token, { gameId: GAME, targetId: C[0].uid, kind: 'suspicion' })
  check(!('exactHit' in cast), '응답에 적중 여부가 없다', JSON.stringify(cast))

  console.log('\n── 보낸 사람이 새는가 ──')
  const voteDocs = await getAll(`games/${GAME}/secret/votes/items`)
  check(voteDocs.length === 2, '표 두 장이 secret에 있다', `${voteDocs.length}장`)
  check(voteDocs.every((v) => typeof v.d.voterId === 'string'), 'secret에는 보낸 사람이 있다')

  // 규칙이 막는가
  const asPlayer = await fetch(`${FS}/games/${GAME}/secret/votes/items`, { headers: { Authorization: `Bearer ${A[0].token}` } })
  check(asPlayer.status === 403, '플레이어는 표를 못 읽는다', String(asPlayer.status))
  const asHost = await fetch(`${FS}/games/${GAME}/secret/votes/items`, { headers: { Authorization: `Bearer ${host}` } })
  check(asHost.status === 403, '운영자도 표를 못 읽는다', String(asHost.status))

  // 각자 몫에는 표가 담기는 자리 자체가 없다
  let leaks = 0
  for (const p of people) {
    const v = await getDoc(`games/${GAME}/views/${p.uid}`)
    if (hasKey(v, 'voterId') || hasKey(v, 'votes') || hasKey(v, 'exactHit')) leaks += 1
  }
  check(leaks === 0, '어느 몫에도 표가 담기는 자리가 없다', `${leaks}건`)

  const evs = await getAll(`games/${GAME}/events`)
  const voteEvents = evs.filter((e) => e.d.kind === 'vote')
  check(voteEvents.length === 2, '표 기록 두 줄', `${voteEvents.length}줄`)
  const evJson = JSON.stringify(voteEvents)
  check(!voteEvents.some((e) => evJson.includes(String(e.d.playerId ?? 'ZZZ')) && e.d.playerId), '표 기록에 사람이 없다')
  check(!evJson.includes(A[0].uid) && !evJson.includes(B[0].uid), '표 기록에 보낸 사람도 받은 사람도 없다')

  console.log('\n── 털어놓기 ──')
  const inflBefore = (await team('A')).resources.influence
  const first = await must('revealSecret', A[2].token, { gameId: GAME, scope: 'private', listenerIds: [B[0].uid, C[0].uid] })
  check(Number(first.gain) === 3, '첫 1:1은 영향력 +3', `+${first.gain}`)
  check((await team('A')).resources.influence === inflBefore + 3, '팀 영향력이 올랐다')

  const second = await must('revealSecret', A[2].token, { gameId: GAME, scope: 'private', listenerIds: [B[1].uid] })
  check(Number(second.gain) === 0, '그다음 1:1은 0 — 약점만 늘어난다', `+${second.gain}`)

  const lev = await getAll(`games/${GAME}/secret/leverage/items`)
  check(lev.length === 3, '들은 사람 셋이 약점을 쥐었다', `${lev.length}개`)
  check(lev.every((l) => l.d.aboutId === A[2].uid), '약점의 대상이 말한 사람이다')

  console.log('\n── 고백이 들은 사람에게만 ──')
  const viewOf = async (uid: string) => (await getDoc(`games/${GAME}/views/${uid}`)) as { confessions: { id: string; speakerId: string }[] }
  const heard = [A[2], B[0], C[0], B[1]]
  const notHeard = people.filter((p) => !heard.some((h) => h.uid === p.uid))
  check((await viewOf(A[2].uid)).confessions.length === 2, '말한 사람은 둘 다 본다')
  check((await viewOf(B[0].uid)).confessions.length === 1, '첫 자리에 있던 사람은 하나만')
  check((await viewOf(B[1].uid)).confessions.length === 1, '둘째 자리에 있던 사람도 하나만')
  let heardLeaks = 0
  for (const p of notHeard) if ((await viewOf(p.uid)).confessions.length > 0) heardLeaks += 1
  check(heardLeaks === 0, '못 들은 아홉에게는 한 줄도 없다', `${heardLeaks}명`)

  console.log('\n── 전체 털어놓기 ──')
  const cls = await must('revealSecret', C[1].token, { gameId: GAME, scope: 'class' })
  check(Number(cls.listeners) === TOTAL_SEATS - 1, '전체는 자기를 뺀 열셋이 듣는다', `${cls.listeners}명`)
  check(Number(cls.gain) === 6, '전체는 6까지 채운다', `+${cls.gain}`)
  let allSee = 0
  for (const p of people) if ((await viewOf(p.uid)).confessions.some((c) => c.speakerId === C[1].uid)) allSee += 1
  check(allSee === TOTAL_SEATS, '열넷 모두의 몫에 있다', `${allSee}명`)
  const levAfter = await getAll(`games/${GAME}/secret/leverage/items`)
  check(levAfter.length === 3, '전체 고백은 아무도 약점을 쥐지 않는다', `${levAfter.length}개`)

  console.log('\n── 투명인간 ──')
  // C[0]이 의심표를 둘 받게 만든다
  await must('castVote', A[3].token, { gameId: GAME, targetId: C[0].uid, kind: 'suspicion' })
  await clock(dayHourMs(START, 1, 21))
  await must('tick', A[0].token, { gameId: GAME })
  const g1 = await game()
  check(g1.invisibleByDay['2'] === C[0].uid, '의심표를 가장 많이 받은 사람이 내일 지워진다', String(g1.invisibleByDay['2']))

  await clock(dayHourMs(START, 2, 9))
  await must('tick', A[0].token, { gameId: GAME })
  const g2 = await game()
  check(g2.invisibleId === C[0].uid, '아침에 지워졌다')

  const fog = async (uid: string) => ((await getDoc(`games/${GAME}/views/${uid}`)) as { visiblePawns: { playerId: string }[] }).visiblePawns.map((p) => p.playerId)
  check((await fog(C[0].uid)).includes(C[0].uid), '본인은 자기 말을 본다')
  check(!(await fog(C[1].uid)).includes(C[0].uid), '**같은 팀에게도** 안 보인다')
  check(!(await fog(A[0].uid)).includes(C[0].uid), '남에게도 안 보인다')
  // 위치는 visiblePawns에만 담긴다. 다른 자리(고백의 들은 사람 등)에
  // 같은 아이디가 있는 건 정당하다
  let posLeaks = 0
  for (const p of people) {
    if (p.uid === C[0].uid) continue
    const v = (await getDoc(`games/${GAME}/views/${p.uid}`)) as { visiblePawns: unknown }
    if (hasValueUnder(v.visiblePawns, 'playerId', C[0].uid)) posLeaks += 1
  }
  check(posLeaks === 0, '위치 데이터가 어느 몫에도 없다', `${posLeaks}건`)
  // 반대로, 지워지지 않은 사람은 팀 몫에 그대로 있어야 한다 —
  // 검사가 아무것도 안 보고 통과하는 것을 막는다
  const mateVisible = (await getDoc(`games/${GAME}/views/${C[1].uid}`)) as { visiblePawns: unknown }
  check(hasValueUnder(mateVisible, 'playerId', C[2].uid), '지워지지 않은 팀원은 그대로 보인다')

  check((await call('castVote', A[0].token, { gameId: GAME, targetId: C[0].uid, kind: 'trust' })).code === 'FAILED_PRECONDITION', '지워진 사람은 표를 못 받는다')

  console.log('\n── 표가 두 번 세어지는가 ──')
  const before = (await team('B')).resources.influence
  await must('tick', A[1].token, { gameId: GAME })
  check((await team('B')).resources.influence === before, '따라잡기를 또 불러도 표가 다시 안 들어간다', `${before}`)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
