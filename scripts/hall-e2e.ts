// 복도에서 마주치기 — 서고, 보이고, 흥정한다.
//
// 붙드는 것은 넷이다.
//   1. 복도 칸에 설 수 있다. 서버가 그 자리를 적는다
//   2. 남의 방 칸이라고 우길 수는 없다
//   3. 같은 복도에 선 둘은 **서로 보인다** — 안개 밖의 방에서 왔어도
//   4. 옆 칸이면 **방을 안 묻고** 거래가 걸린다
//
//   npx vite-node scripts/hall-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { isHallCell, roomOfCell } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 1층 가운데 복도. 둘이 여기서 만난다 */
const HALL = { x: 34, y: 80 }
const NEXT = { x: 35, y: 80 }

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
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
  const email = `hall-${tag}@x.test`
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
async function pawnOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
const arr = (f: unknown): Record<string, unknown>[] =>
  ((f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue?.values ?? [])
    .map((x) => x.mapValue?.fields ?? {})
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null
const cellOf = (f: unknown): { x: number; y: number } | null => {
  const m = (f as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields
  if (!m) return null
  return { x: Number((m.x as { integerValue?: string })?.integerValue ?? -1), y: Number((m.y as { integerValue?: string })?.integerValue ?? -1) }
}
/**
 * 그 방에 세운다. 걸어가는 값은 이 시험의 관심이 아니다.
 *
 * **칸은 비운다** — 서버가 방을 옮길 때 하는 것과 같다(roamTo·arrive).
 * 안 비우면 옛 칸이 남아서 「아직 복도에 있다」로 읽힌다.
 */
async function putIn(game: string, uid: string, tileId: string): Promise<void> {
  const mask = ['tileId', 'arriveAtMs', 'at'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  await fetch(`${FS}/games/${game}/pawns/${uid}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null }, at: { nullValue: null } },
    }),
  })
}

async function main() {
  console.log('── 자리부터 ──')
  check(isHallCell(HALL.x, HALL.y) && roomOfCell(HALL.x, HALL.y) === null, '고른 칸이 복도다', `${HALL.x},${HALL.y}`)

  const game = `hl${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'hl' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  // **서로 다른 팀**이라야 안개가 뜻이 있다. 같은 팀은 원래 다 보인다
  const me = 'qa01'
  const meUid = uidOf(me)
  const meTok = await tok(me)
  const myTeam = str((await pawnOf(game, meUid)).team)
  let you = ''
  for (const id of ['qa02', 'qa03', 'qa04', 'qa05', 'qa06', 'qa07', 'qa08']) {
    if (str((await pawnOf(game, uidOf(id))).team) !== myTeam) { you = id; break }
  }
  const youUid = uidOf(you)
  const youTok = await tok(you)
  console.log(`  ${me}(${myTeam}팀) 와 ${you}(${str((await pawnOf(game, youUid)).team)}팀)`)

  console.log('\n── 서로 딴 방에서 나온다 ──')
  // 각자 다른 방에 있다가 복도로 나선다. **서로의 방은 안개 밖이다**
  await putIn(game, meUid, 'cafeteria')
  await putIn(game, youUid, 'gym')
  await must('standAt', meTok, { gameId: game, x: HALL.x, y: HALL.y })
  await must('standAt', youTok, { gameId: game, x: NEXT.x, y: NEXT.y })

  const minePawn = await pawnOf(game, meUid)
  check(JSON.stringify(cellOf(minePawn.at)) === JSON.stringify(HALL), '복도 칸이 그대로 적혔다', JSON.stringify(cellOf(minePawn.at)))
  check(str(minePawn.tileId) === 'cafeteria', '**칸은 안 바뀐다** — 복도에 섰다고 방이 바뀌지 않는다', String(str(minePawn.tileId)))

  const liar = await call('standAt', meTok, { gameId: game, x: 24, y: 86 })
  check(!liar.ok, '남의 방 칸이라고 우길 수는 없다', liar.ok ? '적혔다' : (liar.err ?? ''))

  console.log('\n── 보인다 ──')
  await must('tick', host, { gameId: game })
  /*
   * **A/B 로 본다.**
   *
   * 「보인다」만 확인하면 시험이 거짓말을 한다 — 판이 시작하면 서로
   * 쥔 칸 때문에 웬만한 방이 다 보여서, 복도 규칙이 없어도 초록이
   * 된다. 그래서 **내 눈에 안 보이는 방**을 먼저 찾아서 거기 세우고,
   * 안 보이는 것을 확인한 다음 복도로 불러낸다.
   */
  const tilesOf = (v: Record<string, unknown>) =>
    ((v.visibleTiles as { arrayValue?: { values?: { stringValue?: string }[] } })?.arrayValue?.values ?? [])
      .map((x) => x.stringValue as string)
  const seenIds = (v: Record<string, unknown>) => arr(v.visiblePawns).map((p) => str(p.playerId))

  const v0 = await viewOf(game, meUid)
  const dark = ['baseB', 'labRoom', 'annex', 'gym', 'garden', 'playground'].find((t) => !tilesOf(v0).includes(t))
  check(dark !== undefined, '내 눈에 안 보이는 방을 하나 찾았다', String(dark))

  await putIn(game, youUid, dark as string)
  // **tick 으로는 몫이 안 깎인다.** 따라잡을 것이 없으면 그냥 돌아온다 —
  // 서버가 진짜로 한 번 일하게 해야 views 가 새로 만들어진다
  await must('standAt', meTok, { gameId: game, x: HALL.x, y: HALL.y + 1 })
  await must('standAt', meTok, { gameId: game, x: HALL.x, y: HALL.y })
  const vHidden = await viewOf(game, meUid)
  check(!seenIds(vHidden).includes(youUid), `${dark} 에 선 남의 팀 사람은 안 보인다`)

  // 이제 복도로 나온다. **방은 그대로 안 보이는 방이다**
  await must('standAt', youTok, { gameId: game, x: NEXT.x, y: NEXT.y })
  const vHall = await viewOf(game, meUid)
  check(seenIds(vHall).includes(youUid), '**복도로 나오니 보인다** — 같은 복도라서다')
  check(!tilesOf(vHall).includes(dark as string), `${dark} 은 여전히 안개 밖이다 — 트인 것은 복도뿐이다`)

  // 내가 방으로 들어가면 도로 안 보인다
  // 급식실(cafeteria) 안 칸으로 들어간다 — 내 칸이 거기라 설 수 있다
  await must('standAt', meTok, { gameId: game, x: 28, y: 70 })
  const vBack = await viewOf(game, meUid)
  check(!seenIds(vBack).includes(youUid), '내가 방으로 들어가면 도로 안 보인다')

  console.log('\n── 흥정 ──')
  await must('standAt', meTok, { gameId: game, x: HALL.x, y: HALL.y })
  const open = await call('askDeal', meTok, { gameId: game, toPlayerId: youUid })
  check(open.ok, '복도에서 거래를 건다 — 방을 안 묻는다', open.ok ? '' : (open.err ?? ''))

  // 한 걸음 물러나면 접힌다. 복도라고 느슨해지지 않는다
  if (open.ok) {
    await must('standAt', youTok, { gameId: game, x: NEXT.x + 2, y: NEXT.y })
    const after = await call('dealNow', meTok, { gameId: game })
    const txt = JSON.stringify(after.ok ? after.result : {})
    check(!txt.includes('"asked"') && !txt.includes('"open"'), '한 걸음 떨어지면 복도에서도 접힌다', txt.slice(0, 80))
  }

  console.log('\n── 복도에서 말하기 ──')
  // 셋을 세운다. 나와 상대는 복도에, 제삼자는 방 안에
  const third = ['qa03', 'qa04', 'qa05'].find((id) => id !== you) as string
  const thirdUid = uidOf(third)
  const thirdTok = await tok(third)
  await putIn(game, thirdUid, 'cafeteria')
  await must('standAt', thirdTok, { gameId: game, x: 28, y: 70 })

  await must('standAt', meTok, { gameId: game, x: HALL.x, y: HALL.y })
  await must('standAt', youTok, { gameId: game, x: NEXT.x, y: NEXT.y })
  const WORD = '복도에서 한 말이다'
  const said = await call('say', meTok, { gameId: game, text: WORD })
  check(said.ok, '복도에서 말이 나간다', said.ok ? '' : (said.err ?? ''))

  const heard = (await call('chatLines', youTok, { gameId: game, sinceMs: 0 })) as
    { ok: boolean; result?: { lines?: { text?: string }[]; here?: string | null } }
  check(
    (heard.result?.lines ?? []).some((l) => l.text === WORD),
    '옆에 선 사람에게 들린다',
    JSON.stringify((heard.result?.lines ?? []).map((l) => l.text)),
  )
  check(heard.result?.here === null, '복도에서는 「여기」가 어느 방도 아니다', String(heard.result?.here))

  const inRoom = (await call('chatLines', thirdTok, { gameId: game, sinceMs: 0 })) as
    { result?: { lines?: { text?: string }[] } }
  /*
   * **방에는 안 들린다.**
   *
   * 복도 말에 방 이름을 적어 두면 그 방 로그에 섞인다 — 내 칸은
   * 복도에 서 있어도 마지막으로 들어간 방(급식실) 그대로이기 때문에,
   * 하필 그 방 사람에게 들리는 것이 제일 그럴듯한 사고다
   */
  check(
    !(inRoom.result?.lines ?? []).some((l) => l.text === WORD),
    '**같은 이름의 방에 남은 사람에게는 안 들린다**',
    JSON.stringify((inRoom.result?.lines ?? []).map((l) => l.text)),
  )

  // 멀어지면 안 들린다. 보이는 자와 같은 자다
  await must('standAt', youTok, { gameId: game, x: HALL.x + 10, y: HALL.y })
  const WORD2 = '멀어진 뒤에 한 말'
  await must('say', meTok, { gameId: game, text: WORD2 })
  const far = (await call('chatLines', youTok, { gameId: game, sinceMs: 0 })) as
    { result?: { lines?: { text?: string }[] } }
  check(
    !(far.result?.lines ?? []).some((l) => l.text === WORD2),
    '열 칸 떨어지면 안 들린다 — 보이는 자와 같은 자다',
    JSON.stringify((far.result?.lines ?? []).map((l) => l.text)),
  )

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
