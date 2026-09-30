// 감독관 — 시작 전 잠금 · 탭 잠금 · 답안지(역할 맞히기)와 채점.
//
//   npx vite-node scripts/stage-answers-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { isHallCell, roomOfCell } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'
import { isBlockedCell } from '../shared/rules/blocked'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)


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



async function gameDoc(game: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  return ((await r.json()) as { fields: Record<string, unknown> }).fields
}
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`patch ${path} ${r.status}`)
}
const own = (game: string, tile: string, team: string) => patch(`games/${game}/tiles/${tile}`, { ownerTeam: { stringValue: team } })
const noticesOf = async (game: string, uid: string) => arr((await viewOf(game, uid)).notices).map((n) => ({ text: str(n.text) ?? '', leader: arr(n.leader).length > 0 || JSON.stringify(n.leader ?? '').includes('A') ? n.leader : undefined }))
const cellVal = (c: { x: number; y: number }) => ({ mapValue: { fields: { x: { integerValue: String(c.x) }, y: { integerValue: String(c.y) } } } })

function findCell(pred: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let y = 0; y < 200; y++) for (let x = 0; x < 120; x++) if (pred(x, y) && !isFixture(x, y) && !isBlockedCell(x, y)) return { x, y }
  throw new Error('칸을 못 찾았다')
}

async function main() {
  const game = `sa${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'sa' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  const qaIdOf = (uid: string) => {
    for (let i = 1; i <= 14; i++) {
      const id = `qa${String(i).padStart(2, '0')}`
      if (uidOf(id) === uid) return id
    }
    throw new Error('계정 이름을 못 찾았다')
  }
  const seats0 = arr((await gameDoc(game)).seats).map((s) => str(s.playerId) as string)
  const p0 = await tok(qaIdOf(seats0[0]))

  console.log('\n── 시작 전 잠금 ──')
  const muted = await call('say', p0, { gameId: game, text: '안녕' })
  check(!muted.ok && (muted.err ?? '').includes('감독관이 풀 때까지'), '**처음에는 말을 못 한다**', muted.ok ? '말했다' : muted.err)
  check(!(await call('hostSetLobbyStage', p0, { gameId: game, stage: 'talk' })).ok, '보통 사람은 못 푼다')
  await must('hostSetLobbyStage', host, { gameId: game, stage: 'talk' })
  check(str((await gameDoc(game)).lobbyStage) === 'talk', '감독관이 풀면 게임 문서에 적힌다')
  const spoke = await call('say', p0, { gameId: game, text: '안녕' })
  check(spoke.ok, '**풀면 2-3 교실에서 말한다**', spoke.ok ? '' : spoke.err)
  await must('hostSetLobbyStage', host, { gameId: game, stage: 'locked' })
  check(!(await call('say', p0, { gameId: game, text: '또' })).ok, '다시 잠그면 또 못 한다')

  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  check(!(await call('hostSetLobbyStage', host, { gameId: game, stage: 'talk' })).ok, '판이 시작되면 시작 전 잠금은 손댈 수 없다')

  console.log('\n── 탭 잠금 ──')
  check(!(await call('hostSetTabLock', p0, { gameId: game, tab: 'radio', locked: true })).ok, '보통 사람은 못 잠근다')
  check(!(await call('hostSetTabLock', host, { gameId: game, tab: 'nope', locked: true })).ok, '없는 탭은 못 잠근다')
  await must('hostSetTabLock', host, { gameId: game, tab: 'radio', locked: true })
  await must('hostSetTabLock', host, { gameId: game, tab: 'vote', locked: true })
  const locked = ((await gameDoc(game)).lockedTabs as { arrayValue?: { values?: { stringValue: string }[] } })?.arrayValue?.values?.map((v) => v.stringValue) ?? []
  check(JSON.stringify(locked) === JSON.stringify(['radio', 'vote']), '잠근 탭이 게임 문서에 적힌다', JSON.stringify(locked))
  await must('hostSetTabLock', host, { gameId: game, tab: 'radio', locked: false })
  const after = ((await gameDoc(game)).lockedTabs as { arrayValue?: { values?: { stringValue: string }[] } })?.arrayValue?.values?.map((v) => v.stringValue) ?? []
  check(JSON.stringify(after) === JSON.stringify(['vote']), '다시 누르면 열린다', JSON.stringify(after))

  console.log('\n── 답안지 ──')
  const seats = arr((await gameDoc(game)).seats).map((s) => str(s.playerId) as string)
  const early = await call('submitAnswers', p0, { gameId: game, answers: {} })
  check(!early.ok, '열기 전에는 못 낸다', early.ok ? '냈다' : early.err)
  check(!(await call('hostOpenAnswers', p0, { gameId: game, open: true })).ok, '보통 사람은 못 연다')
  await must('hostOpenAnswers', host, { gameId: game, open: true })
  check(Boolean((await gameDoc(game)).answerSheet), '**열면 모두에게 뜬다** — 게임 문서에 적힌다')
  // 정답은 감독관 명단으로 안다
  const roster = (await must('hostRoster', host, { gameId: game })).rows as { playerId: string; roleId: string }[]
  const key = Object.fromEntries(roster.map((r) => [r.playerId, r.roleId]))
  // p0 은 다 맞히고, p1 은 절반만 맞힌다
  const p1 = await tok(qaIdOf(seats[1]))
  await must('submitAnswers', p0, { gameId: game, answers: { ...key, stranger: 'model' } })
  const half = Object.fromEntries(seats.map((id, i) => [id, i < 7 ? key[id] : 'nope']))
  await must('submitAnswers', p1, { gameId: game, answers: half })
  const mine = (await must('myAnswers', p1, { gameId: game })).answers as Record<string, string>
  check(Object.keys(mine).length === 7, '없는 역할은 버리고 저장한다 — 일곱 칸', String(Object.keys(mine).length))
  const view = (await must('hostAnswers', host, { gameId: game })).rows as { playerId: string; submitted: boolean; preview: { score: number } | null }[]
  check(view.filter((r) => r.submitted).length === 2, '**감독관은 누가 냈는지 본다**', String(view.filter((r) => r.submitted).length))
  check(!(await call('hostAnswers', p0, { gameId: game })).ok, '보통 사람은 남의 답을 못 본다')
  check(!JSON.stringify(await gameDoc(game)).includes('roleId'), '**채점 전에는 정답이 게임 문서에 없다**')

  console.log('\n── 채점 ──')
  await must('hostGradeAnswers', host, { gameId: game })
  const g = await gameDoc(game)
  const res = (g.answerResult as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
  const scores = arr(res.scores).map((s) => ({ id: str(s.playerId), score: Number((s.score as { integerValue?: string; doubleValue?: number })?.integerValue ?? (s.score as { doubleValue?: number })?.doubleValue ?? -1), submitted: (s.submitted as { booleanValue?: boolean })?.booleanValue }))
  check(arr(res.key).length === 14, '정답 열넷이 모두에게 간다', String(arr(res.key).length))
  check(scores.find((s) => s.id === seats[0])?.score === 100, '**다 맞히면 100 점**', JSON.stringify(scores.find((s) => s.id === seats[0])))
  check(scores.find((s) => s.id === seats[1])?.score === 50, '**열넷 중 일곱이면 50 점**', JSON.stringify(scores.find((s) => s.id === seats[1])))
  check(scores.find((s) => s.id === seats[2])?.submitted === false, '안 낸 사람은 안 냈다고 나온다')
  check(!g.answerSheet || JSON.stringify(g.answerSheet).includes('nullValue'), '채점하면 답안지는 닫힌다', JSON.stringify(g.answerSheet))

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad} 개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main()
