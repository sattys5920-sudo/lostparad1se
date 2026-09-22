// 「말은 들어가는데 한 줄도 안 돌아온다」 — 조용히 영원히 귀가 막히는 두 경우.
//
//   1. 체류 기록이 하나도 안 열려 있다
//   2. 운영자가 시계를 되돌려서 도착 시각이 지금보다 뒤에 있다
//
// 둘 다 화면에는 아무 오류도 안 뜬다. 보내기를 누르면 글자는 지워지고,
// 로그와 풍선만 영영 비어 있다.
//
//   npx vite-node scripts/deaf-chat.ts
import { dayHourMs } from '../shared/rules/clock'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

const MY_PW = 'deaf-chat-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

let bad = 0
function check(ok: boolean, what: string) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`)
  if (!ok) bad += 1
}

async function call(name: string, tk: string | null, data: unknown): Promise<{ ok: boolean; result?: Record<string, unknown>; err?: string }> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false, err: j.error.message } : { ok: true, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result ?? {}
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

const tokenFor = (host: string, pwd: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: pwd })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 이 판에서 열려 있는 체류 칸을 전부 지운다. */
async function wipeIntervals(game: string): Promise<number> {
  const box = `${FS}/games/${game}/secret/intervals/items?pageSize=300`
  const got = (await (await fetch(box, { headers: ADMIN })).json()) as { documents?: { name: string }[]; error?: unknown }
  const docs = got.documents ?? []
  if (docs.length === 0) console.log(`    (목록이 비었다: ${JSON.stringify(got).slice(0, 160)})`)
  let n = 0
  for (const d of docs) {
    // d.name 은 projects/… 로 시작하는 전체 경로다
    const r = await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: 'DELETE', headers: ADMIN })
    if (r.ok) n += 1
  }
  return n
}

async function linesOf(tok: string, game: string): Promise<{ text: string }[]> {
  const r = (await must('chatLines', tok, { gameId: game, sinceMs: 0 })) as { lines?: { text: string }[] }
  return r.lines ?? []
}

async function freshGame(tag: string): Promise<{ game: string; host: string; meTok: string }> {
  const game = `df${tag}`
  const me = `df${tag}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'df' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: null })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  return { game, host, meTok }
}

async function main() {
  const stamp = String(Date.now()).slice(-8)

  console.log('\n── 여느 때 ──')
  {
    const { game, meTok } = await freshGame(`a${stamp}`)
    await must('say', meTok, { gameId: game, text: '들리나' })
    check((await linesOf(meTok, game)).some((l) => l.text === '들리나'), '제가 친 말은 제게 돌아온다')
  }

  console.log('\n── 체류 기록이 하나도 없을 때 ──')
  {
    const { game, meTok } = await freshGame(`b${stamp}`)
    const wiped = await wipeIntervals(game)
    check(wiped > 0, `체류 칸 ${wiped} 개를 지웠다 (안 지워졌으면 이 시험은 아무것도 재지 못한다)`)

    // 화면은 들어가자마자, 그리고 2.5초마다 물어본다. **말보다 먼저다.**
    // 그 한 번이 없어진 칸을 도로 열어 놓는다
    await linesOf(meTok, game)

    await must('say', meTok, { gameId: game, text: '기록이 없다' })
    check(
      (await linesOf(meTok, game)).some((l) => l.text === '기록이 없다'),
      '기록이 없어도 그 뒤로는 들린다 — 조용히 영원히 막히지 않는다',
    )

    // 두 번째 줄도. 한 번 고쳐 놓으면 계속 들려야 한다
    await must('say', meTok, { gameId: game, text: '그 다음 줄' })
    check(
      (await linesOf(meTok, game)).some((l) => l.text === '그 다음 줄'),
      '한 번 고쳐지면 계속 들린다',
    )
  }

  console.log('\n── 운영자가 시계를 되돌렸을 때 ──')
  {
    const { game, host, meTok } = await freshGame(`c${stamp}`)
    // 체류 칸은 지금(1일 10시)에 열려 있다. 시계를 아침으로 되돌린다
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 8), speed: 1 })
    await must('say', meTok, { gameId: game, text: '시계를 되돌렸다' })
    check(
      (await linesOf(meTok, game)).some((l) => l.text === '시계를 되돌렸다'),
      '도착 시각이 미래여도 들린다 — 판을 새로 만들지 않아도 풀린다',
    )
  }

  console.log('\n── 그래도 지켜야 하는 것 ──')
  {
    const { game, host, meTok } = await freshGame(`d${stamp}`)
    const other = await tokenFor(host, QA_PW)('qa01')
    // qa01 을 내 방으로 부른 뒤, 내가 오기 **전에** 말하게 한다
    const mine = String(((await must('chatLines', meTok, { gameId: game })) as { here?: string }).here ?? '')
    const theirs = String(((await must('chatLines', other, { gameId: game })) as { here?: string }).here ?? '')
    if (theirs !== mine) await must('roamTo', other, { gameId: game, tileId: mine })
    await must('say', other, { gameId: game, text: '네가 오기 전에 한 말' })
    // 내가 방을 나갔다 들어온다 — 도착 시각이 새로 찍힌다
    const away = ['artRoom', 'library', 'musicRoom', 'clubRoom'].find((t) => t !== mine)
    await must('roamTo', meTok, { gameId: game, tileId: away })
    await must('roamTo', meTok, { gameId: game, tileId: mine })
    check(
      !(await linesOf(meTok, game)).some((l) => l.text === '네가 오기 전에 한 말'),
      '들어오기 전 말은 여전히 안 들린다',
    )
  }

  console.log(bad === 0 ? '\n다 통과했다' : `\n${bad} 개가 틀렸다`)
  process.exit(bad === 0 ? 0 : 1)
}

void main()
