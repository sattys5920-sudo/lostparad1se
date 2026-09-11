// views를 **다른 계정으로 실제로 읽어** 확인한다.
//
// 순수 함수 시험(shared/rules/views.test.ts)은 「무엇을 담는가」를 본다.
// 이 파일은 그 결과가 Firestore에 제대로 놓였는지, 그리고 규칙이 남의
// 것을 정말 막는지를 본다. 둘 중 하나만 맞아도 새어 나간다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/views-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { BASE_OF } from '../shared/rules/board'

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
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
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

/** 그 사람의 토큰으로 읽는다. 규칙이 그대로 걸린다. */
async function readAs(tk: string, path: string): Promise<{ status: number; text: string }> {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${tk}` } })
  return { status: r.status, text: await r.text() }
}
async function readAdmin(path: string): Promise<string> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return r.ok ? await r.text() : ''
}

/**
 * Firestore REST의 타입 봉투를 벗겨 평범한 값으로 만든다.
 *
 * 정규식으로 훑다가 크게 데었다 — REST는 줄바꿈과 공백을 넣어
 * 내려보내서 `"roleId":{"stringValue"` 같은 패턴이 안 맞는다. 안 맞으면
 * 검사가 조용히 통과한다. 누출 검사에서 그건 최악이다.
 */
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
    const fields = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) {
    return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  }
  return o
}

/** 문서 하나를 평범한 객체로. 없으면 null. */
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}

/** 컬렉션을 평범한 객체 목록으로. */
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({
    id: doc.name.split('/').pop() as string,
    d: plain(doc) as Record<string, unknown>,
  }))
}

const GAME = `view${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token

  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < n; i++) want.push(t)
  }
  await call('createGame', host, { gameId: GAME, seed: 'views' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const e = await signUp(`p${i}-${GAME}@x.test`)
    const a = await auth(e)
    people.push({ ...a, team: want[i] })
    await call('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 명단 밖 구경꾼
  const outsider = await auth(await signUp(`out-${GAME}@x.test`))
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  check(true, '열넷이 앉고 판이 시작했다')

  const me = people[0] // A팀
  const mate = people[1] // 같은 A팀
  const foe = people.find((p) => p.team === 'C') as (typeof people)[0]

  console.log('\n── 규칙이 막는가 ──')
  const mine = await readAs(me.token, `games/${GAME}/views/${me.uid}`)
  check(mine.status === 200, '본인 몫은 읽힌다')
  check((await readAs(foe.token, `games/${GAME}/views/${me.uid}`)).status === 403, '다른 팀은 내 몫을 못 읽는다')
  check((await readAs(mate.token, `games/${GAME}/views/${me.uid}`)).status === 403, '**같은 팀도** 내 몫을 못 읽는다')
  check((await readAs(host, `games/${GAME}/views/${me.uid}`)).status === 403, '운영자도 못 읽는다')
  check((await readAs(outsider.token, `games/${GAME}/views/${me.uid}`)).status === 403, '구경꾼도 못 읽는다')
  check((await fetch(`${FS}/games/${GAME}/views/${me.uid}`)).status === 403, '로그인 없이도 못 읽는다')

  console.log('\n── 담긴 것 ──')
  const v = JSON.parse(mine.text) as { fields: Record<string, { [k: string]: unknown }> }
  const f = v.fields
  check(Boolean(f.own), '내 역할 한 줄이 있다')
  const ownRole = ((f.own as { mapValue: { fields: { roleId: { stringValue: string } } } }).mapValue.fields.roleId).stringValue
  check(Boolean(ownRole), '역할 아이디가 들어 있다', ownRole)

  // 열넷 몫을 전부 관리자로 읽어 남의 역할이 섞였는지 본다
  const rosterRows = await getAll(`games/${GAME}/secret/roster/items`)
  const roleOf = new Map(rosterRows.map((r) => [r.id, r.d.roleId as string]))
  const allRoles = [...roleOf.values()]
  check(allRoles.length === TOTAL_SEATS, '명단에 역할 열넷', `${allRoles.length}개`)
  check(new Set(allRoles).size === TOTAL_SEATS, '역할이 겹치지 않는다')

  let leaks = 0
  const leaked: string[] = []
  for (const p of people) {
    const text = await readAdmin(`games/${GAME}/views/${p.uid}`)
    const myRole = roleOf.get(p.uid)
    for (const role of allRoles) {
      if (role === myRole) continue
      if (text.includes(`"${role}"`)) {
        leaks += 1
        leaked.push(`${p.uid.slice(0, 6)}←${role}`)
      }
    }
  }
  check(leaks === 0, '어느 몫에도 남의 역할이 없다', leaked.slice(0, 4).join(' '))

  // 인연 대상도 자기 것뿐이다
  let bondLeaks = 0
  for (const p of people) {
    const view = (await getDoc(`games/${GAME}/views/${p.uid}`)) as { own?: { bondId?: string } } | null
    const row = await getDoc(`games/${GAME}/secret/roster/items/${p.uid}`)
    if (view?.own?.bondId !== row?.bondId) bondLeaks += 1
  }
  check(bondLeaks === 0, '인연 대상도 자기 것뿐이다', `${bondLeaks}건`)

  console.log('\n── 안개 ──')
  const viewOf = async (uid: string) =>
    (await getDoc(`games/${GAME}/views/${uid}`)) as {
      visiblePawns: { playerId: string; toTile: string | null }[]
      visibleTiles: string[]
      hand: unknown[]
      goals: unknown[]
      commutePlan: unknown
      fakeFlagTiles: string[]
    }
  const myView = await readAdmin(`games/${GAME}/views/${me.uid}`)
  const mineParsed = await viewOf(me.uid)
  const visible = new Set(mineParsed.visiblePawns.map((p) => p.playerId))
  check(visible.size > 0, '보이는 말이 있다', `${visible.size}개`)
  const teamMates = people.filter((p) => p.team === me.team).map((p) => p.uid)
  check(teamMates.every((u) => visible.has(u)), '같은 팀 넷은 다 보인다')
  const farTeam = people.filter((p) => p.team === 'B').map((p) => p.uid)
  check(!farTeam.some((u) => visible.has(u)), '먼 팀 말은 목록에 없다')

  // 내 기지와 이웃은 보이고 남의 기지는 안 보인다
  check(mineParsed.visibleTiles.includes(BASE_OF[me.team]), '내 기지가 보인다', mineParsed.visibleTiles.join(','))
  check(!mineParsed.visibleTiles.includes('baseB'), '남의 기지는 안 보인다')
  check(mineParsed.visiblePawns.every((p) => p.toTile === null), '서 있는 말에는 다음 칸이 없다')

  console.log('\n── 구경꾼 ──')
  const outView = await readAdmin(`games/${GAME}/views/${outsider.uid}`)
  check(outView === '', '명단 밖 사람에게는 몫 자체가 없다')

  console.log('\n── 따라잡으면 다시 깎는가 ──')
  const before = await readAdmin(`games/${GAME}/views/${me.uid}`)
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: START + 2 * 24 * 3_600_000, speed: 1 })
  const r = await call('tick', me.token, { gameId: GAME })
  check(Number(r.applied) > 0, '이틀치를 밀었다', `${r.applied}건`)
  const after = await readAdmin(`games/${GAME}/views/${me.uid}`)
  check(before !== after, '민 뒤에 몫이 새로 깎였다')
  console.log(failures === 0 ? '\n누출 없음.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
