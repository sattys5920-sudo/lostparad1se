// 운영자가 바닥에 한 장 놓는다 — 문제 종이와 메모.
//
// 붙드는 것은 넷이다.
//   1. 운영자만 놓는다
//   2. 고른 방에 놓인다. 다른 방에서는 안 보인다
//   3. **줍기 전에는 글이 한 자도 안 온다** — 「한 장 있다」까지다
//   4. 주워서 읽으면 운영자가 쓴 그대로 온다
//
//   npx vite-node scripts/drop-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID } from '../shared/rules/board'
import { canDropQuizAt } from '../shared/rules/quiz'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 놓을 방. 2-3 교실이라 아침에 다들 거기 서 있다 */
const HERE = 'centralPlaza'
/** 안 놓은 방. 여기서는 아무것도 안 보여야 한다 */
const THERE = 'artRoom'
const MEMO = '3층 계단 밑 사물함, 자물쇠 번호는 0412다.'

let bad = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false as const, err: j.error.message } : { ok: true as const, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown) {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result
}

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

const tokenFor = (host: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 내 몫. **운영자 열쇠로 읽는다** — 규칙은 본인에게만 열어 준다 */
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  if (!r.ok) throw new Error(`view ${r.status}`)
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? {}
}

/** 배열 칸 하나를 평범한 값으로. Firestore REST 는 죄다 싸서 준다 */
function arr(f: unknown): Record<string, unknown>[] {
  const v = (f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue
  return (v?.values ?? []).map((x) => x.mapValue?.fields ?? {})
}
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null

async function main() {
  const game = `dp${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'dp' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const me = 'qa01'
  const meTok = await tok(me)
  const meUid = uidOf(me)

  console.log('\n── 운영자만 놓는다 ──')
  const asPlayer = await call('hostDrop', meTok, { gameId: game, tileId: HERE, kind: 'memo', text: MEMO })
  check(!asPlayer.ok, '보통 사람은 못 놓는다', asPlayer.ok ? '놓여 버렸다' : (asPlayer.err ?? ''))

  console.log('\n── 메모 ──')
  const put = await must('hostDrop', host, { gameId: game, tileId: HERE, kind: 'memo', text: MEMO })
  check(put.where === '2-3 교실', '고른 방에 놓았다고 알려 준다', String(put.where))

  const v1 = await viewOf(game, meUid)
  const floor = arr(v1.slipsHere)
  check(floor.length === 1, '그 방에 선 사람에게 한 장이 보인다', `${floor.length}장`)
  /*
   * **글이 한 자도 안 와야 한다.**
   *
   * 화면에서 가리는 것이 아니라 문서에 아예 없어야 한다 — 있으면
   * 개발자도구로 다 보인다. 내 몫 전체를 글자열로 펴서 뒤진다.
   */
  const whole = JSON.stringify(v1)
  check(!whole.includes(MEMO), '줍기 전에는 글이 내 몫 어디에도 없다')
  check(!whole.includes('0412'), '숫자 한 조각도 안 샌다')

  console.log('\n── 다른 방에서는 ──')
  const other = 'qa02'
  const otherTok = await tok(other)
  const gone = await call('roamTo', otherTok, { gameId: game, tileId: THERE })
  if (!gone.ok) console.log(`  (옮기지 못했다: ${gone.err})`)
  else {
    await must('tick', host, { gameId: game })
    const v2 = await viewOf(game, uidOf(other))
    check(arr(v2.slipsHere).length === 0, '안 놓은 방에서는 한 장도 안 보인다')
  }

  console.log('\n── 주워서 읽는다 ──')
  const slipId = str(floor[0]?.id)
  check(slipId !== null, '종이에 아이디가 있다')
  await must('takeSlip', meTok, { gameId: game, slipId: slipId as string })
  const v3 = await viewOf(game, meUid)
  const held = arr(v3.mySlips)
  check(held.length === 1, '주웠더니 내 손에 있다')
  check(
    str(held[0]?.line) === null && !JSON.stringify(v3).includes(MEMO),
    '**줍기만 해서는 안 읽힌다** — 문장은 아직 안 온다',
    String(str(held[0]?.line)),
  )

  await must('readSlip', meTok, { gameId: game, slipId: slipId as string })
  const v4 = await viewOf(game, meUid)
  const read = arr(v4.mySlips)
  check(str(read[0]?.line) === MEMO, '읽으면 운영자가 쓴 그대로 온다', String(str(read[0]?.line)))
  check(str(read[0]?.subjectId) === '', '누구의 비밀도 아니다 — 주인 자리가 비어 있다')

  /*
   * 문제 종이. **방이 아니라 칸에 놓는다** — 복도에도 놓을 수 있어야
   * 해서 방 이름이 아니라 좌표를 받는다. 그리고 펴는 물건이 아니라
   * **줍는 물건이다**: 바닥에서는 자리만 보이고, 주운 한 사람에게만
   * 문장이 간다.
   */
  console.log('\n── 문제 종이 ──')
  /*
   * **먼저 칸에 세운다.** 방에 들어온 것만으로는 pawn.at 이 안 찬다 —
   * roamTo 는 방만 바꾸고 칸은 standAt 이 정한다. 안 세우고 좌표를
   * 물었더니 「모른다」가 나왔다.
   */
  // **plan 이 칸 좌표다.** rect 는 미니맵 쪽 네모라, 그걸로 훑었더니
  // 다른 층 방(rooftop)의 칸이 나왔다 — roomOfCell 도 plan 을 본다
  const rect = TILE_BY_ID[HERE].plan
  let stand: { x: number; y: number } | null = null
  let spot: { x: number; y: number } | undefined
  for (let y = rect.y; y < rect.y + rect.h && spot === undefined; y++) {
    for (let x = rect.x; x < rect.x + rect.w && spot === undefined; x++) {
      if (!canDropQuizAt(x, y) || !canDropQuizAt(x + 1, y)) continue
      stand = { x, y }
      spot = { x: x + 1, y }
    }
  }
  check(stand !== null && spot !== undefined, '설 칸과 놓을 칸을 찾았다', stand && spot ? `${stand.x},${stand.y} 옆 ${spot.x},${spot.y}` : '못 찾았다')
  await must('standAt', meTok, { gameId: game, x: stand?.x, y: stand?.y })

  const q = await must('hostDrop', host, {
    gameId: game,
    kind: 'quiz',
    x: spot?.x,
    y: spot?.y,
    quiz: {
      kind: 'short',
      prompt: '눈이 가장 많이 오는 달은?',
      choices: [],
      answers: ['한 달'],
      explain: '',
    },
  })
  check(typeof q.quizId === 'string', '문제 은행에도 적힌다', String(q.quizId))
  await must('tick', host, { gameId: game })

  const v5 = await viewOf(game, meUid)
  const papers = arr(v5.quizzesHere)
  check(papers.length === 1, '그 칸에 종이 한 장이 놓였다', `${papers.length}장`)
  check(
    str(papers[0]?.prompt) === null,
    '**줍기 전에는 문제도 안 온다**',
    String(str(papers[0]?.prompt)),
  )
  check(!JSON.stringify(v5).includes('한 달'), '정답은 어느 쪽이든 안 샌다')
  check(!JSON.stringify(v5).includes('눈이 가장 많이'), '문제 문장도 안 샌다')

  const paperId = str(papers[0]?.id)
  await must('takeQuiz', meTok, { gameId: game, paperId: paperId as string })
  const v6 = await viewOf(game, meUid)
  check(arr(v6.quizzesHere).length === 0, '주웠으니 바닥에서 사라진다')
  const mine = arr(v6.myQuizzes)
  check(str(mine[0]?.prompt) === '눈이 가장 많이 오는 달은?', '주우면 문제가 온다', String(str(mine[0]?.prompt)))
  check(!JSON.stringify(v6).includes('"explain"'), '해설은 주운 뒤에도 안 온다')
  check(!JSON.stringify(v6).includes('한 달'), '정답은 주운 뒤에도 안 샌다')

  /* **다른 사람 눈에는 여전히 없다.** 남의 손패가 새면 다 새는 것이다 */
  const vOther = await viewOf(game, uidOf(other))
  check(!JSON.stringify(vOther).includes('눈이 가장 많이'), '남의 손에 든 문제는 안 보인다')

  const wrong = (await must('answerQuiz', meTok, { gameId: game, paperId: paperId as string, given: '두 달' })) as {
    correct?: boolean
  }
  check(wrong.correct === false, '틀린 답은 틀렸다고 한다')
  const again = await call('answerQuiz', meTok, { gameId: game, paperId: paperId as string, given: '한 달' })
  check(!again.ok, '한 번 틀리면 다시 못 낸다', again.ok ? '받아 버렸다' : (again.err ?? ''))

  console.log('\n── 없는 방 ──')
  const nowhere = await call('hostDrop', host, { gameId: game, tileId: '옥탑방', kind: 'memo', text: '어디에' })
  check(!nowhere.ok, '없는 방에는 못 놓는다', nowhere.ok ? '놓여 버렸다' : (nowhere.err ?? ''))

  const blank = await call('hostDrop', host, { gameId: game, tileId: HERE, kind: 'memo', text: '   ' })
  check(!blank.ok, '빈 메모는 못 놓는다', blank.ok ? '놓여 버렸다' : (blank.err ?? ''))

  console.log(bad === 0 ? '\n다 맞았다.' : `\n어긋난 것 ${bad}개.`)
  if (bad > 0) process.exitCode = 1
}

void main()
