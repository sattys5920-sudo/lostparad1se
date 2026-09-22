// 문제 종이를 진짜 서버로.
//
// 확인할 것은 셋이다.
//
//   **정답이 어디로도 안 나간다** — 플레이어에게도, 운영자 아닌
//   누구에게도. 안 펼친 문제는 본문조차 안 간다
//   **펼치면 그 방 사람 전원이 본다** — 다른 팀이라도
//   **한 장은 한 팀만 가져간다** — 먼저 낸 답이 이긴다
//
//   npx vite-node scripts/quiz-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { KNOWLEDGE_PER_QUIZ, QUIZ_MIN_BANK, QUIZ_PER_PHASE } from '../shared/rules/quiz'
import { stepToward } from '../shared/rules/occupy'
import { TILE_BY_ID, roomOfCell, type TileId } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'

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


const GAME = `qz${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
/** 서버만 보는 바닥의 종이. 시험이 판을 짜는 데만 쓴다. */
const floorNow = async () => await getAll(`games/${GAME}/secret/quiz/floor`)
type Cell = { x: number; y: number }
const cellOf = (d: Record<string, unknown>): Cell | null => {
  const c = d.cell as Cell | undefined
  return c && typeof c.x === 'number' ? { x: c.x, y: c.y } : null
}
/** 종이 옆 한 칸에 선다. 기물이 아닌 첫 자리 */
async function standBeside(token: string, c: Cell): Promise<void> {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (isFixture(c.x + dx, c.y + dy)) continue
    const r = await call('standAt', token, { gameId: GAME, x: c.x + dx, y: c.y + dy })
    if (!r.code) return
  }
  throw new Error(`${c.x},${c.y} 옆에 설 자리가 없다`)
}
/** 같은 방 안에서 종이와 두 칸 넘게 떨어진 자리에 선다 */
async function standFar(token: string, room: TileId, c: Cell): Promise<void> {
  const r = TILE_BY_ID[room].plan
  for (let y = r.y + 1; y < r.y + r.h - 1; y++)
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      if (Math.abs(x - c.x) <= 1 && Math.abs(y - c.y) <= 1) continue
      if (isFixture(x, y)) continue
      const out = await call('standAt', token, { gameId: GAME, x, y })
      if (!out.code) return
    }
  throw new Error(`${room} 에 멀리 설 자리가 없다`)
}

/** 시험에 쓸 문제 하나. 정답은 여기와 서버에만 있다. */
const ANSWER = '사과'
const PROMPT_SHUT = '접힌 채로 두는 문제'
const PROMPT_OPEN = '펼쳐서 같이 보는 문제'
const EXPLAIN = '맞힌 사람에게만 가는 해설'

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'quiz' })
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

  console.log('\n── 운영자가 문제를 등록한다 ──')
  const empty = await must('hostQuizList', host, { gameId: GAME })
  check(Number(empty.count) === 0, '처음에는 한 문제도 없다')
  check(empty.thin === true, `권장 최소 ${QUIZ_MIN_BANK}개에 못 미친다고 알린다`)

  const asPlayerList = await call('hostQuizList', A[0].token, { gameId: GAME })
  check(asPlayerList.code === 'PERMISSION_DENIED', '플레이어는 문제 은행을 못 본다', String(asPlayerList.code))

  await must('hostQuizUpsert', host, {
    gameId: GAME,
    quiz: { kind: 'short', prompt: PROMPT_SHUT, choices: [], answers: [ANSWER], explain: '' },
  })
  await must('hostQuizUpsert', host, {
    gameId: GAME,
    quiz: { kind: 'short', prompt: PROMPT_OPEN, choices: [], answers: [ANSWER, '능금'], explain: EXPLAIN },
  })
  const two = await must('hostQuizList', host, { gameId: GAME })
  check(Number(two.count) === 2, '두 문제가 등록됐다', `${two.count}개`)

  const badChoice = await call('hostQuizUpsert', host, {
    gameId: GAME,
    quiz: { kind: 'choice', prompt: '객관식', choices: ['하나', '둘', '셋', '넷'], answers: ['둘'], explain: '' },
  })
  check(badChoice.code === 'INVALID_ARGUMENT', '**객관식은 받지 않는다** — 주관식뿐', String(badChoice.message ?? badChoice.code))
  const stillTwo = await must('hostQuizList', host, { gameId: GAME })
  check(Number(stillTwo.count) === 2, '막힌 것은 은행에 안 남는다', `${stillTwo.count}개`)

  console.log('\n── 페이즈가 닫히면 종이가 떨어진다 ──')
  check((await floorNow()).length === 0, '처음에는 바닥에 없다')
  await must('openPhase', host, { gameId: GAME })
  const closed = await must('closePhase', host, { gameId: GAME })
  check(Number(closed.quizzes) === QUIZ_PER_PHASE, `${QUIZ_PER_PHASE}장 떨어졌다`, `${closed.quizzes}장`)
  const floor = await floorNow()
  // 기지는 없어졌다(76368eb). 스물다섯 방 어디에나 떨어진다
  check(floor.every((q) => q.d.openedBy === null), '전부 접힌 채로 떨어진다', floor.map((q) => q.d.tileId).join(','))
  check(
    floor.every((q) => {
      const c = cellOf(q.d)
      return c !== null && roomOfCell(c.x, c.y) === q.d.tileId && !isFixture(c.x, c.y)
    }),
    '**바닥 한 칸에 놓인다** — 그 방 안, 기물이 아닌 자리',
    floor.map((q) => { const c = cellOf(q.d); return `${q.d.tileId}:${c?.x},${c?.y}` }).join(' '),
  )

  console.log('\n── 정답은 누구도 직접 못 읽는다 ──')
  for (const [who, tk] of [['플레이어', A[0].token], ['운영자', host]] as const) {
    const r = await fetch(`${FS}/games/${GAME}/secret/quiz/bank`, { headers: { Authorization: `Bearer ${tk}` } })
    check(r.status === 403, `${who}도 문제 은행 문서를 직접 못 읽는다`, String(r.status))
  }

  console.log('\n── 접힌 종이는 본문조차 안 간다 ──')
  /*
   * **해설이 달린 문제가 떨어진 종이를 고른다.**
   *
   * 앞서는 floor[0] 을 그냥 썼다. 등록한 둘 중 하나만 해설이 있어서,
   * 어느 것이 그 자리에 떨어졌느냐에 따라 「맞힌 사람에게만 해설이
   * 간다」가 반쯤 실패했다 — 시험이 판마다 다른 답을 내면 시험이 아니다.
   */
  const bankNow = (await must('hostQuizList', host, { gameId: GAME })).items as { id: string; prompt: string }[]
  const openId = bankNow.find((q) => q.prompt === PROMPT_OPEN)?.id
  const target = floor.find((f) => f.d.quizId === openId) ?? floor[0]
  const goal = String(target.d.tileId)
  // 그 방으로 A0 를 걸어 보낸다. 자유 시간이라 걸음은 공짜다
  for (let i = 0; i < 8; i++) {
    const here = (await pawnsNow())[A[0].uid].tileId as string
    if (here === goal) break
    const next = stepToward(here, goal)
    if (!next) break
    await must('roamTo', A[0].token, { gameId: GAME, tileId: next })
  }
  check((await pawnsNow())[A[0].uid].tileId === goal, `${goal} 에 닿았다`)

  const shut = await viewOf(A[0].uid)
  const hereQ = (shut.quizzesHere ?? []) as { id: string; opened: boolean; prompt: string | null; cell: Cell | null }[]
  check(hereQ.length >= 1, '한 장 있다는 것은 보인다', `${hereQ.length}장`)
  check(hereQ.every((q) => q.opened === false && q.prompt === null), '본문은 안 온다')
  const paperCell = cellOf(target.d)!
  check(
    hereQ.some((q) => q.id === target.id && q.cell?.x === paperCell.x && q.cell?.y === paperCell.y),
    '**자리째로 온다** — 맵에 그릴 칸',
    JSON.stringify(hereQ.find((q) => q.id === target.id)?.cell),
  )
  const shutText = JSON.stringify(shut)
  check(!shutText.includes(ANSWER), '**정답이 응답에 없다**')
  check(!shutText.includes(EXPLAIN), '해설도 없다')

  console.log('\n── 펼치면 그 방 사람 전원이 본다 ──')
  // B0 도 같은 방으로 보낸다. 다른 팀 앞에서 여는 것이 이 물건의 전부다
  for (let i = 0; i < 8; i++) {
    const here = (await pawnsNow())[B[0].uid].tileId as string
    if (here === goal) break
    const next = stepToward(here, goal)
    if (!next) break
    await must('roamTo', B[0].token, { gameId: GAME, tileId: next })
  }
  check((await pawnsNow())[B[0].uid].tileId === goal, 'B팀 사람도 같은 방에 섰다')

  // 방에 들어온 것만으로는 안 된다 — 종이 옆에 서야 편다
  await standFar(A[0].token, goal as TileId, paperCell)
  const farOpen = await call('openQuiz', A[0].token, { gameId: GAME, paperId: target.id })
  check(farOpen.code === 'FAILED_PRECONDITION', '**방 안이라도 멀면 못 편다**', String(farOpen.message ?? farOpen.code))
  // 종이는 기물이다 — 그 위에는 못 선다
  const onIt = await call('standAt', A[0].token, { gameId: GAME, ...paperCell })
  check(onIt.code === 'FAILED_PRECONDITION', '**종이 위에는 못 선다**', String(onIt.message ?? onIt.code))
  await standBeside(A[0].token, paperCell)
  await must('openQuiz', A[0].token, { gameId: GAME, paperId: target.id })
  const mine = (await viewOf(A[0].uid)).quizzesHere as { id: string; opened: boolean; prompt: string | null }[]
  const theirs = (await viewOf(B[0].uid)).quizzesHere as { id: string; opened: boolean; prompt: string | null }[]
  const mineOne = mine.find((q) => q.id === target.id)
  const theirsOne = theirs.find((q) => q.id === target.id)
  check(mineOne?.opened === true && mineOne.prompt !== null, '편 사람에게 본문이 간다')
  check(theirsOne?.opened === true && theirsOne.prompt !== null, '**다른 팀 사람에게도 같이 간다**')
  check(!JSON.stringify(await viewOf(B[0].uid)).includes(ANSWER), '그래도 정답은 안 간다')

  const far = await viewOf(A[1].uid)
  check(
    ((far.quizzesHere ?? []) as unknown[]).length === 0 || (await pawnsNow())[A[1].uid].tileId === goal,
    '다른 방 사람에게는 있다는 것조차 안 간다',
  )

  console.log('\n── 틀리면 그 사람만 다시 못 푼다 ──')
  const wrong = await must('answerQuiz', A[0].token, { gameId: GAME, paperId: target.id, given: '배' })
  check(wrong.correct === false, '틀렸다고 온다')
  check(wrong.explain === null, '틀린 사람에게는 해설이 안 간다')
  const again = await call('answerQuiz', A[0].token, { gameId: GAME, paperId: target.id, given: ANSWER })
  check(again.code === 'FAILED_PRECONDITION', '같은 사람은 다시 못 푼다', String(again.code))

  console.log('\n── 맞히면 맞힌 사람이 가져간다. 한 장은 한 팀만 ──')
  // 지식은 팀 금고가 아니라 **그 사람 지갑**에 붙는다(7d045ae)
  const knowledgeOf = async (uid: string) =>
    Number(((await pawnsNow())[uid].resources as Record<string, number> | undefined)?.knowledge ?? 0)
  const before = await knowledgeOf(B[0].uid)
  const mateBefore = await knowledgeOf(B[1].uid)
  // 답도 옆에서만 낸다
  await standFar(B[0].token, goal as TileId, paperCell)
  const farAns = await call('answerQuiz', B[0].token, { gameId: GAME, paperId: target.id, given: ANSWER })
  check(farAns.code === 'FAILED_PRECONDITION', '멀리서는 답도 못 낸다', String(farAns.message ?? farAns.code))
  await standBeside(B[0].token, paperCell)
  // 대소문자·공백·자모를 흩뜨려 내도 맞아야 한다
  const right = await must('answerQuiz', B[0].token, { gameId: GAME, paperId: target.id, given: `  ${ANSWER.normalize('NFD')} ` })
  check(right.correct === true, '자모로 쳐도 맞는다')
  check(right.explain === EXPLAIN, '맞힌 사람에게만 해설이 간다')
  const after = await knowledgeOf(B[0].uid)
  check(after === before + KNOWLEDGE_PER_QUIZ, `**맞힌 사람 지갑에 지식 ${KNOWLEDGE_PER_QUIZ}점**`, `${before} → ${after}`)
  const mate = await knowledgeOf(B[1].uid)
  check(mate === mateBefore, '같은 팀 다른 사람 지갑은 그대로다', `${mateBefore} → ${mate}`)

  const late = await call('answerQuiz', A[1].token, { gameId: GAME, paperId: target.id, given: ANSWER })
  check(late.code === 'FAILED_PRECONDITION', '뒤에 온 답은 거절된다 — 한 장은 한 팀만', String(late.code))
  check(((await viewOf(A[0].uid)).quizzesHere as unknown[]).every((q) => (q as { id: string }).id !== target.id), '가져간 종이는 사라진다')

  console.log('\n── 판에 나간 문제는 못 지운다 ──')
  const bank = await must('hostQuizList', host, { gameId: GAME })
  const used = (bank.items as { id: string; used: boolean }[]).find((q) => q.used)
  if (used) {
    const nope = await call('hostQuizRemove', host, { gameId: GAME, id: used.id })
    check(nope.code === 'FAILED_PRECONDITION', '이미 나간 문제는 삭제가 막힌다', String(nope.code))
  } else {
    check(false, '나간 문제를 찾지 못했다')
  }

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 실패`)
  if (failures > 0) process.exit(1)
}

void main()
