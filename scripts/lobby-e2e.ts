// 로비 한 판을 **진짜 서버로** 돌린다.
//
// 함수 에뮬레이터에 실제로 호출을 넣고, Firestore에 무엇이 놓였는지
// admin SDK로 확인한다. 단위 시험은 순수 함수를 보고, 이 파일은
// 엔드포인트와 권한과 문서 모양을 본다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/lobby-e2e.ts
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { BASE_OF, startingTiles } from '../shared/rules/board'
import { ROLE_IDS } from '../shared/missions/roleNames'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// ── 에뮬레이터 계정 ─────────────────────────────────────────────

/**
 * 인증 에뮬레이터로 계정을 만든다.
 *
 * 운영자 표시는 커스텀 클레임으로 단다. 에뮬레이터는 서명을 확인하지
 * 않으므로 signUp 응답의 idToken에 클레임을 실으려면 계정 문서를
 * 고쳐야 한다 — 아래 setClaims가 그 일을 한다.
 */
async function signUp(email: string): Promise<{ uid: string; idToken: string }> {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  const j = (await r.json()) as { localId: string; idToken: string; error?: { message: string } }
  if (!j.idToken) throw new Error(`가입 실패: ${JSON.stringify(j)}`)
  return { uid: j.localId, idToken: j.idToken }
}

async function setClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
  })
  if (!r.ok) throw new Error(`클레임 실패: ${await r.text()}`)
}

/** 클레임을 단 뒤에는 토큰을 다시 받아야 한다. 옛 토큰에는 안 들어 있다. */
async function signIn(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  const j = (await r.json()) as { idToken: string }
  return j.idToken
}

// ── 호출 ────────────────────────────────────────────────────────

interface CallResult {
  ok: boolean
  data?: unknown
  code?: string
  message?: string
}

async function call(name: string, token: string | null, data: unknown): Promise<CallResult> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: unknown; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result }
}

/**
 * Firestore를 REST로 읽는다.
 *
 * 「owner」 토큰은 에뮬레이터에서 규칙을 건너뛰는 관리자 열쇠다. 이걸
 * 빼면 규칙이 그대로 걸린다 — 아래 leakChecks가 그쪽을 쓴다.
 */
async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } })
  if (!r.ok) return null
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? null
}

async function listDocs(path: string): Promise<string[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((d) => d.name.split('/').pop() as string)
}

// ── 판 하나 ─────────────────────────────────────────────────────

const GAME = `e2e${Date.now()}`

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n`)

  console.log('── 계정 ──')
  const host = await signUp(`host-${GAME}@x.test`)
  await setClaims(host.uid, { admin: true })
  const hostToken = await signIn(`host-${GAME}@x.test`)
  const players: { uid: string; token: string; email: string }[] = []
  for (let i = 0; i < TOTAL_SEATS + 1; i++) {
    const email = `p${i}-${GAME}@x.test`
    const u = await signUp(email)
    // 가입 응답의 토큰은 함수 에뮬레이터가 받아 주지 않는다. 로그인해서 받는다
    players.push({ uid: u.uid, token: await signIn(email), email })
  }
  check(players.length === TOTAL_SEATS + 1, `계정 ${TOTAL_SEATS + 1}개 만들었다`)

  console.log('\n── 판 만들기 ──')
  check((await call('createGame', null, { gameId: GAME })).code === 'UNAUTHENTICATED', '로그인 없이는 못 만든다')
  const asPlayer = await call('createGame', players[0].token, { gameId: GAME })
  check(asPlayer.code === 'PERMISSION_DENIED', '운영자가 아니면 못 만든다', asPlayer.code)
  check((await call('createGame', hostToken, { gameId: 'a b' })).code === 'INVALID_ARGUMENT', '이상한 이름은 거절')
  check((await call('createGame', hostToken, { gameId: GAME })).ok, '운영자는 만든다')
  check((await call('createGame', hostToken, { gameId: GAME })).code === 'ALREADY_EXISTS', '같은 이름 두 번은 거절')

  console.log('\n── 참가 ──')
  check((await call('joinGame', players[0].token, { gameId: GAME, name: '' })).code === 'INVALID_ARGUMENT', '빈 이름 거절')
  check(
    (await call('joinGame', players[0].token, { gameId: GAME, name: '열세글자를넘기는아주긴이름' })).code ===
      'INVALID_ARGUMENT',
    '13자 넘는 이름 거절',
  )
  check((await call('joinGame', players[0].token, { gameId: GAME, name: '하나', team: 'Z' })).code === 'INVALID_ARGUMENT', '없는 팀 거절')

  // 팀을 안 고르면 서버가 가장 많이 빈 팀에 앉힌다
  const auto = await call('joinGame', players[0].token, { gameId: GAME, name: '하나' })
  check(auto.ok, '팀을 안 골라도 앉는다', JSON.stringify((auto.data as { seat: unknown })?.seat))

  // 같은 사람이 다시 부르면 자리가 늘지 않고 고쳐진다
  const again = await call('joinGame', players[0].token, { gameId: GAME, name: '하나로', team: 'D' })
  check(
    again.ok && (again.data as { seated: number }).seated === 1,
    '같은 사람이 다시 부르면 자리가 안 늘고 고쳐진다',
    `${(again.data as { seated: number })?.seated}자리`,
  )

  // 나머지를 정원대로 채운다
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) {
    for (let i = 0; i < n; i++) want.push(t)
  }
  want.splice(want.indexOf('D'), 1) // 0번이 이미 D에 앉았다
  for (let i = 0; i < want.length; i++) {
    const r = await call('joinGame', players[i + 1].token, { gameId: GAME, name: `봇${i + 1}`, team: want[i] })
    if (!r.ok) check(false, `${want[i]}팀 참가`, r.message)
  }
  const gameDoc = await readDoc(`games/${GAME}`)
  const seatCount = ((gameDoc?.seats as { arrayValue?: { values?: unknown[] } })?.arrayValue?.values ?? []).length
  check(seatCount === TOTAL_SEATS, `${TOTAL_SEATS}자리가 찼다`, `${seatCount}자리`)

  const extra = await call('joinGame', players[TOTAL_SEATS].token, { gameId: GAME, name: '늦둥이' })
  check(extra.code === 'RESOURCE_EXHAUSTED', '꽉 찬 뒤에는 못 앉는다', extra.code)

  console.log('\n── 시작 ──')
  check((await call('startGame', players[1].token, { gameId: GAME })).code === 'PERMISSION_DENIED', '운영자가 아니면 시작 못 한다')
  const startAtMs = Date.UTC(2026, 2, 1, 23, 0, 0) // DAY 1 08:00 KST
  const started = await call('startGame', hostToken, { gameId: GAME, startAtMs })
  check(started.ok, '운영자가 시작한다', started.message ?? '')
  check((await call('startGame', hostToken, { gameId: GAME })).code === 'FAILED_PRECONDITION', '두 번 시작 못 한다')
  check((await call('joinGame', players[1].token, { gameId: GAME, name: '늦둥이' })).code === 'FAILED_PRECONDITION', '시작한 뒤엔 못 앉는다')
  check((await call('leaveGame', players[1].token, { gameId: GAME })).code === 'FAILED_PRECONDITION', '시작한 뒤엔 못 일어난다')

  console.log('\n── 놓인 것 ──')
  const roster = await listDocs(`games/${GAME}/secret/roster/items`)
  check(roster.length === TOTAL_SEATS, '역할이 열넷에게 나뉘었다', `${roster.length}명`)
  const roles = new Set<string>()
  for (const id of roster) {
    const d = await readDoc(`games/${GAME}/secret/roster/items/${id}`)
    roles.add((d?.roleId as { stringValue: string }).stringValue)
  }
  check(roles.size === ROLE_IDS.length, '열네 역할이 겹치지 않는다', `${roles.size}종`)

  const pawns = await listDocs(`games/${GAME}/pawns`)
  check(pawns.length === TOTAL_SEATS, '말이 열넷 놓였다', `${pawns.length}개`)
  const onBase = await Promise.all(
    pawns.map(async (id) => {
      const d = await readDoc(`games/${GAME}/pawns/${id}`)
      const team = (d?.team as { stringValue: TeamId }).stringValue
      return (d?.tileId as { stringValue: string }).stringValue === BASE_OF[team]
    }),
  )
  check(onBase.every(Boolean), '말이 모두 자기 기지에 서 있다')

  const tiles = await listDocs(`games/${GAME}/tiles`)
  check(tiles.length === 25, '칸 스물다섯이 놓였다', `${tiles.length}칸`)
  let owned = 0
  for (const id of tiles) {
    const d = await readDoc(`games/${GAME}/tiles/${id}`)
    const o = d?.ownerTeam as { stringValue?: string; nullValue?: null }
    if (o?.stringValue) {
      owned += 1
      check(startingTiles(o.stringValue as TeamId).includes(id as never), `${id}은 ${o.stringValue}팀 시작 칸`)
    }
  }
  check(owned === 12, '각 팀이 기지와 1구역 두 칸으로 시작한다', `${owned}칸`)

  const teams = await listDocs(`games/${GAME}/teams`)
  check(teams.length === 4, '팀 문서 넷')
  for (const t of ['C', 'D']) {
    const d = await readDoc(`games/${GAME}/teams/${t}`)
    check(Boolean((d?.captainId as { stringValue?: string })?.stringValue), `3인 팀 ${t}에는 주장이 있다`)
  }
  for (const t of ['A', 'B']) {
    const d = await readDoc(`games/${GAME}/teams/${t}`)
    check((d?.captainId as { nullValue?: null })?.nullValue === null, `4인 팀 ${t}에는 주장이 없다`)
  }

  // 아침 넷(DAY 2~5) + 정산 다섯 + 마지막 여섯 시간 하나 + 끝 하나
  const schedule = await listDocs(`games/${GAME}/schedule`)
  const kinds: Record<string, number> = {}
  for (const id of schedule) {
    const d = await readDoc(`games/${GAME}/schedule/${id}`)
    const k = (d?.kind as { stringValue: string }).stringValue
    kinds[k] = (kinds[k] ?? 0) + 1
    check((d?.doneAtMs as { nullValue?: null })?.nullValue === null, `${k}은 아직 안 밀렸다`)
  }
  check(
    kinds.dayStart === 4 && kinds.settlement === 5 && kinds.lastHours === 1 && kinds.gameEnd === 1,
    '정시 이벤트가 아침 4 · 정산 5 · 마지막 6시간 1 · 끝 1',
    JSON.stringify(kinds),
  )

  // 역할은 secret 밖 어디에도 없다
  const publicish = JSON.stringify([
    await readDoc(`games/${GAME}`),
    ...(await Promise.all(pawns.map((id) => readDoc(`games/${GAME}/pawns/${id}`)))),
    ...(await Promise.all(teams.map((id) => readDoc(`games/${GAME}/teams/${id}`)))),
  ])
  const leaked = ROLE_IDS.filter((r) => publicish.includes(`"${r}"`))
  check(leaked.length === 0, '역할 이름이 secret 밖에 없다', leaked.join(','))

  console.log('\n── 규칙이 막는가 ──')
  // 관리자 열쇠 없이 읽어 본다. 규칙만 남는다
  const plain = async (path: string) => (await fetch(`${FS}/${path}`)).status
  check(await plain(`games/${GAME}/secret/roster/items`) === 403, '명단은 규칙이 막는다')
  check(await plain(`games/${GAME}/pawns`) === 403, '말의 위치는 규칙이 막는다')
  check(await plain(`games/${GAME}/schedule`) === 403, '예정된 일은 규칙이 막는다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
