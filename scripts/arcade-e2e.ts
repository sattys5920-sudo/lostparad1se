// 오락기 — 진짜 서버로 본다.
//
//   ㆍ 오락기 옆에 서야 한다 — 시작도, 한 수도
//   ㆍ 업다운의 숫자는 **판이 끝날 때까지 어디로도 안 간다** — 돌려받는
//     값에도, 플레이어 열쇠로 읽는 어떤 문서에도
//   ㆍ 대결에서 먼저 낸 수는 봉인된다 — 상대가 제 열쇠로 대결 문서를
//     열어도 「냈다」만 보이고, 봉인 문서는 아예 못 연다
//   ㆍ 끝나면 기록(arcadeDone)이 남는다 — 보상을 붙일 자리
//
// 읽기 검사는 **운영자 열쇠가 아니라 그 사람 열쇠로** 한다. 운영자 열쇠는
// 규칙을 건너뛰므로, 그걸로 「안 보인다」를 재면 규칙이 없어도 통과한다.
//
//   npx vite-node scripts/arcade-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { ARCADE_CELL, UPDOWN_TRIES } from '../shared/rules/arcade'

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

/** 그 사람 열쇠로 문서를 연다. 규칙이 막으면 403 이 온다 */
async function readAs(tok: string, path: string): Promise<{ status: number; text: string }> {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${tok}` } })
  return { status: r.status, text: await r.text() }
}

async function main() {
  const game = `ar${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'ar' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const [a, b, c] = ['qa01', 'qa02', 'qa03']
  const [ta, tb, tc] = [await tok(a), await tok(b), await tok(c)]
  const [ua, ub] = [uidOf(a), uidOf(b)]

  console.log('\n── 옆에 없으면 ──')
  const far = await call('arcadeStart', ta, { gameId: game, game: 'updown' })
  check(!far.ok, '오락기 옆이 아니면 못 시작한다', far.ok ? '시작됐다' : (far.err ?? ''))

  // 둘은 오락기 옆, 하나는 멀리 복도에
  await must('standAt', ta, { gameId: game, x: ARCADE_CELL.x - 1, y: ARCADE_CELL.y + 1 })
  await must('standAt', tb, { gameId: game, x: ARCADE_CELL.x + 1, y: ARCADE_CELL.y + 1 })
  await must('standAt', tc, { gameId: game, x: ARCADE_CELL.x + 6, y: ARCADE_CELL.y + 1 })
  const onFixture = await call('standAt', tc, { gameId: game, x: ARCADE_CELL.x, y: ARCADE_CELL.y })
  check(!onFixture.ok, '오락기 칸 위에는 못 선다', onFixture.ok ? '섰다' : (onFixture.err ?? ''))

  console.log('\n── 업다운 ──')
  const s = await must('arcadeStart', ta, { gameId: game, game: 'updown' })
  const view0 = s.view as { left: number; answer: number | null }
  check(view0.left === UPDOWN_TRIES, `처음에 ${UPDOWN_TRIES}번`, String(view0.left))
  check(view0.answer === null, '시작할 때 답은 안 온다')
  // 숫자를 운영자 열쇠로만 몰래 본다 — 검사용이다
  const solo = await fetch(`${FS}/games/${game}/secret/arcade/solo/${ua}`, { headers: ADMIN }).then((r) => r.json()) as {
    fields: { secret: { mapValue: { fields: { target: { integerValue: string } } } } }
  }
  const target = Number(solo.fields.secret.mapValue.fields.target.integerValue)
  check(target >= 1 && target <= 100, '숫자는 1~100 이다', String(target))
  check(!JSON.stringify(s).includes(`"target"`), '돌려받은 값에 숫자가 없다')
  const peek = await readAs(ta, `games/${game}/secret/arcade/solo/${ua}`)
  check(peek.status === 403, '제 열쇠로는 숨은 판을 못 연다', String(peek.status))
  const view = await readAs(ta, `games/${game}/views/${ua}`)
  check(view.status === 200 && !view.text.includes(`"target"`), '내 몫(view)에도 숫자가 없다')

  // 일부러 한 번 틀리고 — 그다음 맞힌다
  const wrong = target === 1 ? 2 : target - 1
  const g1 = await must('arcadeMove', ta, { gameId: game, n: wrong })
  const v1 = g1.view as { guesses: { hint: string }[]; left: number; answer: number | null }
  check(v1.guesses.at(-1)?.hint === (wrong < target ? 'up' : 'down'), '틀리면 업/다운을 알려 준다', v1.guesses.at(-1)?.hint)
  check(v1.answer === null, '안 끝났으면 답은 여전히 없다')
  // **bad 라고 이름 짓지 않는다** — 틀린 수를 세는 전역 bad 를 가려서,
  // 끝 줄이 「[object Object]개 틀렸다」가 됐었다
  const outOfRange = await call('arcadeMove', ta, { gameId: game, n: 101 })
  check(!outOfRange.ok, '범위 밖은 안 받는다', outOfRange.ok ? '받았다' : (outOfRange.err ?? ''))
  const g2 = await must('arcadeMove', ta, { gameId: game, n: target })
  const v2 = g2.view as { outcome: string | null; answer: number | null; left: number }
  check(v2.outcome === 'win', '맞히면 이긴다', String(v2.outcome))
  check(v2.answer === target, '끝나면 답이 온다')
  check(v2.left === UPDOWN_TRIES - 2, '범위 밖은 횟수를 안 깎았다', String(v2.left))
  const after = await call('arcadeMove', ta, { gameId: game, n: target })
  check(!after.ok, '끝난 판에는 더 못 둔다')

  // 떠나면 못 둔다
  await must('arcadeStart', ta, { gameId: game, game: 'updown' })
  await must('standAt', ta, { gameId: game, x: ARCADE_CELL.x - 5, y: ARCADE_CELL.y + 1 })
  const gone = await call('arcadeMove', ta, { gameId: game, n: 50 })
  check(!gone.ok, '걸어서 떠나면 거기서 멈춘다', gone.ok ? '뒀다' : (gone.err ?? ''))
  await must('standAt', ta, { gameId: game, x: ARCADE_CELL.x - 1, y: ARCADE_CELL.y + 1 })

  console.log('\n── 대결 걸기 ──')
  const toFar = await call('arcadeChallenge', ta, { gameId: game, game: 'rps', toPlayerId: uidOf(c) })
  check(!toFar.ok, '상대가 오락기 옆에 없으면 못 건다', toFar.ok ? '걸렸다' : (toFar.err ?? ''))
  const solo2 = await call('arcadeChallenge', ta, { gameId: game, game: 'updown', toPlayerId: ub })
  check(!solo2.ok, '혼자 하는 게임으로는 못 건다')
  const m = await must('arcadeChallenge', ta, { gameId: game, game: 'rps', toPlayerId: ub })
  const matchId = String(m.matchId)
  const twice = await call('arcadeChallenge', ta, { gameId: game, game: 'rps', toPlayerId: ub })
  check(!twice.ok, '하던 대결이 있으면 또 못 건다')
  const cRead = await readAs(tc, `games/${game}/arcadeMatches/${matchId}`)
  check(cRead.status === 403, '남은 그 대결 문서를 못 연다', String(cRead.status))
  const notMe = await call('arcadeAnswer', ta, { gameId: game, matchId, accept: true })
  check(!notMe.ok, '건 사람이 제 신청을 받을 수는 없다')
  await must('arcadeAnswer', tb, { gameId: game, matchId, accept: true })

  console.log('\n── 봉인 ──')
  await must('arcadePick', ta, { gameId: game, matchId, pick: 'rock' })
  const seenByB = await readAs(tb, `games/${game}/arcadeMatches/${matchId}`)
  check(seenByB.status === 200, '상대는 대결 문서를 연다')
  check(seenByB.text.includes('"aIn"') && /"aIn":\s*\{\s*"booleanValue":\s*true/.test(seenByB.text), '「냈다」는 보인다')
  check(!seenByB.text.includes('rock'), '**무엇을 냈는지는 대결 문서에 없다**')
  const sealRead = await readAs(tb, `games/${game}/secret/arcade/seal/${matchId}`)
  check(sealRead.status === 403, '봉인 문서는 상대가 못 연다', String(sealRead.status))
  const again = await call('arcadePick', ta, { gameId: game, matchId, pick: 'paper' })
  check(!again.ok, '한 판에 두 번 못 낸다 — 낸 걸 못 바꾼다')

  // 비겨 본다 — 판이 안 닫히고 다음 판으로
  await must('arcadePick', tb, { gameId: game, matchId, pick: 'rock' })
  const tied = await readAs(tb, `games/${game}/arcadeMatches/${matchId}`)
  check(tied.text.includes('rock') && tied.text.includes('"playing"'), '둘 다 내면 펴지고, 비기면 계속한다')

  console.log('\n── 갈린다 ──')
  await must('arcadePick', tb, { gameId: game, matchId, pick: 'scissors' })
  const half = await readAs(ta, `games/${game}/arcadeMatches/${matchId}`)
  check(!half.text.includes('scissors'), '이번엔 b 가 먼저 — a 도 b 의 수를 못 본다')
  await must('arcadePick', ta, { gameId: game, matchId, pick: 'rock' })
  const end = await readAs(ta, `games/${game}/arcadeMatches/${matchId}`)
  check(end.text.includes('"done"'), '갈리면 닫힌다')
  check(/"outcome":\s*\{\s*"stringValue":\s*"a"/.test(end.text), '바위가 가위를 이겼다 — a 가 이긴다')

  const recs = await fetch(`${FS}/games/${game}/secret/records/items?pageSize=300`, { headers: ADMIN }).then((r) => r.text())
  const hits = (recs.match(/arcadeDone/g) ?? []).length
  check(hits >= 3, '끝난 판마다 기록이 남는다(업다운 하나 · 대결 둘)', `${hits}줄`)
  check(recs.includes('rps:win') && recs.includes('rps:lose'), '대결은 양쪽에 이김·짐이 따로 남는다')

  const late = await call('arcadeLeave', ta, { gameId: game, matchId })
  check(late.ok, '끝난 대결을 나가도 탈이 없다')

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  if (bad > 0) process.exitCode = 1
}

void main()
