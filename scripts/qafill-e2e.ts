// 둘만 앉은 판을 **QA 로 채워 시작**하고, 그 뒤에 진짜로 채팅과 거래가
// 되는지 본다.
//
// 열넷이 안 차면 판이 안 선다 — 역할과 인연 고리가 열넷을 전제로
// 짜여 있다. 둘이서 확인하고 싶을 때는 나머지를 QA 로 메운다.
// 앉은 사람은 그대로 두고 빈 자리만 채운다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/qafill-e2e.ts
import { createHash } from 'node:crypto'
import { randomLook } from '../src/school/char/look'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { START_TILE, TILE_BY_ID } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `qf${TAG}`
const PW = 'qafillpass1'
const QA_PW = 'qaqaqa12345'

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
async function tok(id: string, password = PW): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
async function count(path: string): Promise<number> {
  const r = await fetch(`${FS}/${path}?pageSize=60`, { headers: ADMIN })
  return (((await r.json()) as { documents?: unknown[] }).documents ?? []).length
}

async function main(): Promise<void> {
  const he = `h${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'qf' })

  console.log('\n── 둘만 앉는다 ──')
  const a = `me${TAG}`
  const b = `you${TAG}`
  for (const id of [a, b]) {
    await call('signUpAccount', null, { id, password: PW })
    await call('saveCharacter', await tok(id), { nickname: id.slice(0, 6), avatar: randomLook('F') })
    await call('joinGame', await tok(id), { gameId: GAME, name: id.slice(0, 4) })
  }
  const two = await call('peekDay', host, { gameId: GAME }).then(() => 0, () => 0)
  void two
  const stuck = await call('startGame', host, { gameId: GAME }).then(() => '', (e: Error) => e.message)
  check(stuck.includes('14') || stuck.includes('명'), '둘만으로는 시작이 거절된다', stuck)

  console.log('\n── 빈 자리를 QA 로 채운다 ──')
  const seeded = await call('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  check(seeded.seated === TOTAL_SEATS, `열넷이 찼다`, `${seeded.seated}명`)

  // 먼저 앉은 둘이 밀려나지 않았는지 — 이름이 그대로 있어야 한다
  const g = await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })
  const seats = (((await g.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } } }
  }).fields?.seats?.arrayValue?.values ?? []).map(
    (v) => (v.mapValue?.fields?.playerId as { stringValue?: string })?.stringValue ?? '',
  )
  check(seats.includes(uidOf(a)) && seats.includes(uidOf(b)), '먼저 앉은 둘은 그대로다')

  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME })
  check((await count(`games/${GAME}/pawns`)) === TOTAL_SEATS, '말 열넷이 섰다')

  console.log('\n── 그래서 되는가 ──')
  const meTok = await tok(a)
  const youTok = await tok(b)
  const said = await call('say', meTok, { gameId: GAME, text: '들리나' })
  check(said !== null, '채팅이 된다')
  const heard = await call('chatLines', youTok, { gameId: GAME })
  const lines = (heard.lines ?? []) as { text?: string }[]
  check(lines.some((l) => l.text === '들리나'), '상대에게 들린다', `${lines.length}줄`)

  // 거래는 **바로 옆 칸**이라야 건다. 둘을 나란히 세운다.
  // 칸 좌표는 판에서 읽는다 — 여기 적어 두면 방을 옮길 때 같이 안 바뀐다
  const rect = TILE_BY_ID[START_TILE].plan
  const cx = rect.x + Math.floor(rect.w / 2)
  const cy = rect.y + Math.floor(rect.h / 2)
  await call('standAt', meTok, { gameId: GAME, x: cx, y: cy })
  await call('standAt', youTok, { gameId: GAME, x: cx + 1, y: cy })
  const asked = await call('askDeal', meTok, { gameId: GAME, toPlayerId: uidOf(b) })
  check(Boolean(asked), '거래를 걸 수 있다')
  const dealId = String((asked as { id?: string }).id ?? '')
  const ans = await call('answerDeal', youTok, { gameId: GAME, dealId, accept: true }).then(
    () => true,
    (e: Error) => {
      console.log('    (' + e.message + ')')
      return false
    },
  )
  check(ans, '상대가 받아 탁자가 열린다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 실패.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
