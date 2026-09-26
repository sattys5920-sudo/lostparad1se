// 문제 종이를 진짜 서버로.
//
// 확인할 것은 넷이다.
//
//   **운영자가 놓는다** — 서버는 더 이상 안 뿌린다. 복도에도 놓인다
//   **정답이 어디로도 안 나간다** — 플레이어에게도, 운영자 아닌
//   누구에게도. 바닥에 있는 종이는 본문조차 안 간다
//   **주운 사람만 본다** — 남에게는 있다는 것도 안 간다
//   **한 장은 한 사람만** — 먼저 줍는 손이 이긴다
//
//   npx vite-node scripts/quiz-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { KNOWLEDGE_PER_QUIZ, QUIZ_MIN_BANK, canDropQuizAt } from '../shared/rules/quiz'
import { stepToward } from '../shared/rules/occupy'
import { HALLS, TILE_BY_ID, roomOfCell, type TileId } from '../shared/rules/board'
import { FIXTURE_CELLS, isFixture } from '../shared/rules/fixtures'

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
const PROMPT_OPEN = '주워서 혼자 푸는 문제'
const PROMPT_WIN = '맞히는 데 쓰는 문제'
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
    quiz: { kind: 'short', prompt: PROMPT_OPEN, choices: [], answers: [ANSWER, '능금'], explain: '' },
  })
  await must('hostQuizUpsert', host, {
    gameId: GAME,
    quiz: { kind: 'short', prompt: PROMPT_WIN, choices: [], answers: [ANSWER], explain: EXPLAIN },
  })
  const two = await must('hostQuizList', host, { gameId: GAME })
  check(Number(two.count) === 3, '세 문제가 등록됐다', `${two.count}개`)

  const badChoice = await call('hostQuizUpsert', host, {
    gameId: GAME,
    quiz: { kind: 'choice', prompt: '객관식', choices: ['하나', '둘', '셋', '넷'], answers: ['둘'], explain: '' },
  })
  check(badChoice.code === 'INVALID_ARGUMENT', '**객관식은 받지 않는다** — 주관식뿐', String(badChoice.message ?? badChoice.code))
  const stillTwo = await must('hostQuizList', host, { gameId: GAME })
  check(Number(stillTwo.count) === 3, '막힌 것은 은행에 안 남는다', `${stillTwo.count}개`)

  console.log('\n── 서버는 더 이상 안 뿌린다 ──')
  check((await floorNow()).length === 0, '처음에는 바닥에 없다')
  await must('openPhase', host, { gameId: GAME })
  const closed = await must('closePhase', host, { gameId: GAME })
  check(closed.quizzes === undefined, '**페이즈가 닫혀도 안 떨어진다** — 운영자가 놓는다', JSON.stringify(closed.quizzes))
  check((await floorNow()).length === 0, '바닥은 그대로 비어 있다')

  console.log('\n── 운영자가 자리를 짚어 놓는다 ──')
  const bankNow = (await must('hostQuizList', host, { gameId: GAME })).items as { id: string; prompt: string }[]
  const openQ = bankNow.find((q) => q.prompt === PROMPT_OPEN)
  const shutQ = bankNow.find((q) => q.prompt === PROMPT_SHUT)
  if (!openQ || !shutQ) throw new Error('등록한 문제를 못 찾았다')

  // 벽에는 못 놓는다
  const onWall = await call('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: openQ.id, x: -5, y: -5 })
  check(onWall.code === 'FAILED_PRECONDITION', '**벽에는 못 놓는다**', String(onWall.message ?? onWall.code))
  // 기물 위에도 못 놓는다
  const fx = [...FIXTURE_CELLS][0].split(',').map(Number)
  const onFix = await call('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: openQ.id, x: fx[0], y: fx[1] })
  check(onFix.code === 'FAILED_PRECONDITION', '**기물 위에는 못 놓는다**', String(onFix.message ?? onFix.code))

  /*
   * **복도에 놓는다.** 이게 주소를 방에서 칸으로 옮긴 까닭이다 —
   * 복도는 어느 방에도 안 속해서 방 주소로는 가리킬 수가 없었다.
   */
  const hallCell = (() => {
    for (const h of HALLS) {
      for (let y = h.rect.y; y < h.rect.y + h.rect.h; y++)
        for (let x = h.rect.x; x < h.rect.x + h.rect.w; x++)
          if (canDropQuizAt(x, y) && roomOfCell(x, y) === null) return { x, y }
    }
    throw new Error('복도 칸을 못 찾았다')
  })()
  const inHall = await must('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: shutQ.id, x: hallCell.x, y: hallCell.y })
  check(inHall.where === '복도', '**복도에 놓인다**', String(inHall.where))

  // 같은 문제를 두 번은 못 놓는다
  const twice = await call('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: shutQ.id, x: hallCell.x + 1, y: hallCell.y })
  check(twice.code === 'FAILED_PRECONDITION', '같은 문제를 두 번은 못 놓는다', String(twice.message ?? twice.code))

  // 시험에 쓸 한 장은 A 팀이 닿기 쉬운 방 안에 놓는다
  const goal = 'centralPlaza' as TileId
  const r = TILE_BY_ID[goal].plan
  const paperCell = (() => {
    for (let y = r.y + 1; y < r.y + r.h - 1; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (canDropQuizAt(x, y)) return { x, y }
    throw new Error(`${goal} 에 놓을 자리가 없다`)
  })()
  const put = await must('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: openQ.id, x: paperCell.x, y: paperCell.y })
  check(put.where === TILE_BY_ID[goal].name, `${TILE_BY_ID[goal].name} 에 놓였다`, String(put.where))
  const floor = await floorNow()
  check(floor.length === 2, '바닥에 두 장', `${floor.length}장`)
  check(floor.every((q) => q.d.heldBy === null), '아무도 안 주운 채다')
  const target = floor.find((q) => q.d.quizId === openQ.id)
  if (!target) throw new Error('놓은 종이를 못 찾았다')

  console.log('\n── 정답은 누구도 직접 못 읽는다 ──')
  for (const [who, tk] of [['플레이어', A[0].token], ['운영자', host]] as const) {
    const r2 = await fetch(`${FS}/games/${GAME}/secret/quiz/bank`, { headers: { Authorization: `Bearer ${tk}` } })
    check(r2.status === 403, `${who}도 문제 은행 문서를 직접 못 읽는다`, String(r2.status))
  }

  console.log('\n── 바닥에 있는 동안에는 자리까지만 ──')
  for (const p of [A[0], A[1]]) {
    const here = (await pawnsNow())[p.uid].tileId as string
    for (let i = 0; i < 30 && (await pawnsNow())[p.uid].tileId !== goal; i++) {
      const at = (await pawnsNow())[p.uid].tileId as string
      const next = stepToward(at as TileId, goal)
      if (!next) break
      await must('roamTo', p.token, { gameId: GAME, tileId: next })
    }
    check((await pawnsNow())[p.uid].tileId === goal, `${goal} 에 닿았다`, `${here} → ${(await pawnsNow())[p.uid].tileId}`)
  }
  const onFloorView = (await viewOf(A[0].uid)).quizzesHere as { id: string; x: number; y: number }[]
  const seen = onFloorView.find((q) => q.id === target.id)
  check(seen !== undefined, '같은 방이면 자리가 보인다')
  check(seen !== undefined && !('prompt' in seen), '**자리뿐이다** — 문장 칸이 아예 없다', JSON.stringify(seen))
  check(!JSON.stringify(await viewOf(A[0].uid)).includes(PROMPT_OPEN), '본문이 어디에도 안 실린다')
  const hallSeen = (onFloorView).some((q) => q.x === hallCell.x && q.y === hallCell.y)
  check(!hallSeen, '복도에 놓인 것은 방 안에서 안 보인다')

  console.log('\n── 옆에 서야 줍는다 ──')
  await standFar(A[0].token, goal, paperCell)
  const farTake = await call('takeQuiz', A[0].token, { gameId: GAME, paperId: target.id })
  check(farTake.code === 'FAILED_PRECONDITION', '**방 안이라도 멀면 못 줍는다**', String(farTake.message ?? farTake.code))
  const onIt = await call('standAt', A[0].token, { gameId: GAME, ...paperCell })
  check(onIt.code === 'FAILED_PRECONDITION', '**종이 위에는 못 선다**', String(onIt.message ?? onIt.code))

  console.log('\n── 먼저 줍는 손이 이긴다 ──')
  await standBeside(A[0].token, paperCell)
  await standBeside(A[1].token, paperCell)
  await must('takeQuiz', A[0].token, { gameId: GAME, paperId: target.id })
  const second = await call('takeQuiz', A[1].token, { gameId: GAME, paperId: target.id })
  check(second.code === 'FAILED_PRECONDITION', '**둘째 손은 거절된다** — 한 장은 한 사람만', String(second.message ?? second.code))

  console.log('\n── 주운 사람만 본다 ──')
  const mineV = (await viewOf(A[0].uid)).myQuizzes as { id: string; prompt: string | null }[]
  const mineOne = mineV.find((q) => q.id === target.id)
  check(mineOne?.prompt === PROMPT_OPEN, '주운 사람에게 문장이 간다')
  check(!JSON.stringify(await viewOf(A[0].uid)).includes(ANSWER), '그래도 정답은 안 간다')
  for (const p of [A[1], B[0]]) {
    const v = await viewOf(p.uid)
    const held = ((v.myQuizzes ?? []) as { id: string }[]).some((q) => q.id === target.id)
    const onF = ((v.quizzesHere ?? []) as { id: string }[]).some((q) => q.id === target.id)
    check(!held && !onF, '**남에게는 있다는 것조차 안 간다**')
    check(!JSON.stringify(v).includes(PROMPT_OPEN), '본문도 안 간다')
  }

  console.log('\n── 틀리면 그 사람만 다시 못 푼다 ──')
  const notMine = await call('answerQuiz', A[1].token, { gameId: GAME, paperId: target.id, given: ANSWER })
  check(notMine.code === 'FAILED_PRECONDITION', '**안 든 사람은 답을 못 낸다**', String(notMine.message ?? notMine.code))
  const wrong = await must('answerQuiz', A[0].token, { gameId: GAME, paperId: target.id, given: '배' })
  check(wrong.correct === false, '틀렸다고 온다')
  check(wrong.explain === null, '틀린 사람에게는 해설이 안 간다')
  const again = await call('answerQuiz', A[0].token, { gameId: GAME, paperId: target.id, given: ANSWER })
  check(again.code === 'FAILED_PRECONDITION', '같은 사람은 다시 못 푼다', String(again.code))

  console.log('\n── 맞히면 지갑에 지식이 붙고 종이는 끝난다 ──')
  /*
   * **안 틀린 사람으로 잰다.** A[0] 은 방금 틀려서 이 종이를 다시
   * 못 푼다 — 그 사람으로 정답을 재면 「맞히면 지식이 는다」가 아니라
   * 「틀린 사람은 못 낸다」를 한 번 더 재는 셈이 된다.
   */
  const winQ = (await must('hostQuizList', host, { gameId: GAME })).items as { id: string; prompt: string }[]
  const win = winQ.find((q) => q.prompt === PROMPT_WIN)
  if (!win) throw new Error('맞힐 문제를 못 찾았다')
  const winCell = (() => {
    for (let y = r.y + 1; y < r.y + r.h - 1; y++)
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
        if (x === paperCell.x && y === paperCell.y) continue
        if (canDropQuizAt(x, y)) return { x, y }
      }
    throw new Error('둘째 자리가 없다')
  })()
  await must('hostDrop', host, { gameId: GAME, kind: 'quiz', quizId: win.id, x: winCell.x, y: winCell.y })
  const winPaper = (await floorNow()).find((q) => q.d.quizId === win.id)
  if (!winPaper) throw new Error('놓은 둘째 종이를 못 찾았다')

  const knowledgeOf = async (uid: string) =>
    Number(((await pawnsNow())[uid].resources as Record<string, number> | undefined)?.knowledge ?? 0)
  const before = await knowledgeOf(A[1].uid)
  const mateBefore = await knowledgeOf(A[2].uid)

  await standBeside(A[1].token, winCell)
  await must('takeQuiz', A[1].token, { gameId: GAME, paperId: winPaper.id })
  // 대소문자·공백·자모를 흩뜨려 내도 맞아야 한다
  const right = await must('answerQuiz', A[1].token, {
    gameId: GAME,
    paperId: winPaper.id,
    given: `  ${ANSWER.normalize('NFD')} `,
  })
  check(right.correct === true, '자모로 쳐도 맞는다')
  check(right.explain === EXPLAIN, '맞힌 사람에게만 해설이 간다')
  const after = await knowledgeOf(A[1].uid)
  check(after === before + KNOWLEDGE_PER_QUIZ, `**맞힌 사람 지갑에 지식 ${KNOWLEDGE_PER_QUIZ}점**`, `${before} → ${after}`)
  const mate = await knowledgeOf(A[2].uid)
  check(mate === mateBefore, '같은 팀 다른 사람 지갑은 그대로다', `${mateBefore} → ${mate}`)

  // **푼 종이는 손에서 사라진다.** 그게 「끝났다」의 표시다
  const handAfter = ((await viewOf(A[1].uid)).myQuizzes ?? []) as { id: string }[]
  check(!handAfter.some((q) => q.id === winPaper.id), '푼 종이는 손패에서 사라진다')
  const lateAns = await call('answerQuiz', A[1].token, { gameId: GAME, paperId: winPaper.id, given: ANSWER })
  check(lateAns.code === 'FAILED_PRECONDITION', '끝난 종이에는 답을 더 못 낸다', String(lateAns.code))

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
