// 심부름 — 붙이고, 받고, 나르고, 먼저 놓는다.
//
// 붙드는 것은 여섯이다.
//   1. 운영자만 붙인다. 같은 심부름은 하루에 한 번, 게시판은 두 장까지
//   2. 게시판 앞에 서야 받는다. 한 사람에 하나
//   3. **남이 무엇을 받았는지는 어느 몫에도 없다** — 경주다
//   4. **물건은 받은 사람에게만 있다** — 남의 응답에는 없다
//   5. 먼저 놓은 사람이 가진다. 나머지는 그 순간 잃는다
//   6. 제한 시간이 지나면 전원 실패, 포기하면 나만 빠진다
//
//   npx vite-node scripts/errand-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { BOARDS } from '../shared/rules/errand'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 1층 서쪽 복도 게시판. 둘이 여기서 받는다 */
const BOARD = BOARDS.find((b) => b.id === 'f1w')!

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
  const email = `er-${tag}@x.test`
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
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
const arr = (f: unknown): Record<string, unknown>[] =>
  ((f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue?.values ?? [])
    .map((x) => x.mapValue?.fields ?? {})
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null
const num = (f: unknown): number => Number((f as { integerValue?: string })?.integerValue ?? 0)
const mapOf = (f: unknown): Record<string, unknown> =>
  (f as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}

/** 방에 세운다. 칸도 같이 비운다 — 서버가 방을 옮길 때 하는 것과 같다 */
async function putIn(game: string, uid: string, tileId: string): Promise<void> {
  const mask = ['tileId', 'arriveAtMs', 'at'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  await fetch(`${FS}/games/${game}/pawns/${uid}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null }, at: { nullValue: null } },
    }),
  })
}
const purseOf = async (game: string, uid: string): Promise<number> => {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  return num(mapOf(f.resources).money)
}

async function main() {
  const game = `er${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'er' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const me = 'qa01', you = 'qa02', third = 'qa03'
  const [meTok, youTok, thirdTok] = await Promise.all([tok(me), tok(you), tok(third)])
  const [meUid, youUid, thirdUid] = [uidOf(me), uidOf(you), uidOf(third)]

  console.log('── 운영자만 붙인다 ──')
  const pool = (await must('hostErrands', host, { gameId: game })) as { pool?: { id: string }[] }
  check((pool.pool ?? []).length >= 3, '판을 차릴 때 풀이 깔린다', `${(pool.pool ?? []).length}개`)

  const asPlayer = await call('hostPostErrand', meTok, { gameId: game, specId: 'beaker', boardId: BOARD.id })
  check(!asPlayer.ok, '보통 사람은 못 붙인다', asPlayer.ok ? '붙었다' : (asPlayer.err ?? ''))

  const posted = await must('hostPostErrand', host, { gameId: game, specId: 'beaker', boardId: BOARD.id })
  check(String(posted.board) === BOARD.name, '고른 게시판에 붙었다', String(posted.board))
  const again = await call('hostPostErrand', host, { gameId: game, specId: 'beaker', boardId: BOARD.id })
  check(!again.ok, '**같은 심부름은 하루에 한 번**', again.ok ? '두 번 붙었다' : (again.err ?? ''))
  await must('hostPostErrand', host, { gameId: game, specId: 'broom', boardId: BOARD.id })
  const full = await call('hostPostErrand', host, { gameId: game, specId: 'tray', boardId: BOARD.id })
  check(!full.ok, '게시판은 두 장까지다', full.ok ? '세 장 붙었다' : (full.err ?? ''))

  console.log('\n── 앞에 서야 본다 ──')
  await putIn(game, meUid, 'cafeteria')
  const vFar = await viewOf(game, meUid)
  const counts = mapOf(vFar.boardCounts)
  check(num(counts[BOARD.id]) === 2, '멀리서도 몇 장인지는 보인다', `${num(counts[BOARD.id])}장`)
  check(arr(vFar.errandsHere).length === 0, '**멀리서는 내용이 안 온다**', `${arr(vFar.errandsHere).length}개`)

  await must('standAt', meTok, { gameId: game, x: BOARD.cell.x, y: BOARD.cell.y })
  const vNear = await viewOf(game, meUid)
  const here = arr(vNear.errandsHere)
  check(here.length === 2, '앞에 서면 두 장이 보인다', `${here.length}개`)
  const beaker = here.find((e) => str(e.thing) === '비커') ?? {}
  check(str(beaker.text) === '깨지지 않게.', '적힌 말이 그대로 온다', String(str(beaker.text)))

  const farTake = await call('takeErrand', youTok, { gameId: game, errandId: str(beaker.id) ?? '' })
  check(!farTake.ok, '게시판 앞이 아니면 못 받는다', farTake.ok ? '받았다' : (farTake.err ?? ''))

  console.log('\n── 둘이 같이 받는다 ──')
  const errandId = str(beaker.id) ?? ''
  await must('takeErrand', meTok, { gameId: game, errandId })
  await must('standAt', youTok, { gameId: game, x: BOARD.cell.x + 1, y: BOARD.cell.y })
  await must('takeErrand', youTok, { gameId: game, errandId })

  const twice = await call('takeErrand', meTok, { gameId: game, errandId })
  check(!twice.ok, '한 사람이 두 개는 못 받는다', twice.ok ? '받았다' : (twice.err ?? ''))

  const vMine = await viewOf(game, meUid)
  const mine = mapOf(vMine.myErrand)
  check(str(mine.thing) === '비커', '내가 받은 것이 내 몫에 있다', String(str(mine.thing)))
  /*
   * **남이 받았는지는 어느 몫에도 없다.**
   *
   * 제삼자의 몫을 통째로 문자열로 만들어서 훑는다. 받은 사람 아이디가
   * 한 글자라도 섞이면 경주가 중계가 된다
   */
  await must('standAt', thirdTok, { gameId: game, x: BOARD.cell.x, y: BOARD.cell.y + 1 }).catch(() => undefined)
  await putIn(game, thirdUid, 'cafeteria')
  await must('standAt', meTok, { gameId: game, x: BOARD.cell.x, y: BOARD.cell.y })
  /*
   * **심부름 칸만 훑는다.**
   *
   * 몫 전체를 훑으면 visiblePawns 에 든 아이디가 걸려서 늘 빨갛다 —
   * 사람이 보이는 것은 원래 그렇고, 우리가 보는 것은 「누가 무엇을
   * 받았나」다. 그 셋만 꺼내서 본다.
   */
  const errandBits = async (uid: string): Promise<string> => {
    const v = await viewOf(game, uid)
    return JSON.stringify([v.boardCounts, v.errandsHere, v.myErrand])
  }
  const bitsThird = await errandBits(thirdUid)
  check(!bitsThird.includes(meUid) && !bitsThird.includes(youUid), '**남이 받았다는 사실이 제삼자 몫에 없다**')
  const bitsYou = await errandBits(youUid)
  check(!bitsYou.includes(meUid), '**같이 받은 사람끼리도 서로 모른다**', bitsYou.slice(0, 120))

  console.log('\n── 물건 ──')
  const noThing = await call('pickUpThing', meTok, { gameId: game })
  check(!noThing.ok, '출발 방이 아니면 못 집는다', noThing.ok ? '집었다' : (noThing.err ?? ''))

  await putIn(game, meUid, 'labRoom')
  const vAtFrom = await viewOf(game, meUid)
  check(mapOf(vAtFrom.myErrand).thingHere !== undefined, '출발 방에 서면 집을 수 있다고 온다')
  await must('pickUpThing', meTok, { gameId: game })
  const vCarry = await viewOf(game, meUid)
  check(String((mapOf(vCarry.myErrand).carrying as { booleanValue?: boolean })?.booleanValue) === 'true', '들고 있다')

  /*
   * **든 것은 보이고, 무슨 심부름인지는 안 보인다.**
   *
   * 비커를 안고 복도를 뛰는 사람은 원래 보인다 — 머리 위에 그려
   * 준다. 대신 붙어 가는 것은 **이름 하나**뿐이다. 어디서 어디로
   * 가는지도, 얼마를 받는지도, 누가 같이 받았는지도 안 간다.
   */
  await putIn(game, thirdUid, 'labRoom')
  await must('standAt', meTok, { gameId: game, x: 55, y: 96 }).catch(() => undefined)
  const vThird2 = await viewOf(game, thirdUid)
  const meSeen = arr(vThird2.visiblePawns).find((p) => str(p.playerId) === meUid) ?? {}
  check(str(meSeen.carrying) === '비커', '같은 방 사람에게는 든 물건이 보인다', str(meSeen.carrying) ?? '없다')
  const bitsWhileCarrying = await errandBits(thirdUid)
  check(
    !bitsWhileCarrying.includes('비커') && !bitsWhileCarrying.includes(meUid),
    '**그래도 무슨 심부름인지는 제삼자 몫에 없다**',
    bitsWhileCarrying.slice(0, 120),
  )

  console.log('\n── 먼저 놓는 사람 ──')
  await putIn(game, youUid, 'labRoom')
  await must('pickUpThing', youTok, { gameId: game })
  await putIn(game, meUid, 'annex')
  await putIn(game, youUid, 'annex')
  const before = await purseOf(game, meUid)
  const won = await must('dropThing', meTok, { gameId: game })
  check(Number(won.coins) === 2, '보상이 들어온다', `${Number(won.coins)}코인`)
  check((await purseOf(game, meUid)) === before + 2, '내 지갑에 그대로 붙었다')
  const lost = await call('dropThing', youTok, { gameId: game })
  check(
    !lost.ok && (lost.err ?? '').includes('먼저'),
    '**늦은 쪽은 못 놓는다 — 그리고 진 이유를 듣는다**',
    lost.ok ? '놓았다' : (lost.err ?? ''),
  )
  const vLost = await viewOf(game, youUid)
  check(mapOf(vLost.myErrand).thing === undefined, '늦은 쪽 손에서 물건이 사라진다')

  console.log('\n── 포기 ──')
  // **둘 다 게시판 앞에 세운다.** 한쪽만 세우면 받기에서 막힌다
  for (const [uid, tk, dx] of [[meUid, meTok, 0], [youUid, youTok, 1]] as const) {
    await putIn(game, uid, 'cafeteria')
    await must('standAt', tk, { gameId: game, x: BOARD.cell.x + dx, y: BOARD.cell.y })
  }
  const list = arr((await viewOf(game, meUid)).errandsHere)
  const broom = list.find((e) => str(e.thing) === '빗자루') ?? {}
  check(str(broom.id) !== null, '빗자루가 아직 붙어 있다', String(str(broom.thing)))
  await must('takeErrand', meTok, { gameId: game, errandId: str(broom.id) ?? '' })
  await must('takeErrand', youTok, { gameId: game, errandId: str(broom.id) ?? '' })
  await must('giveUpErrand', meTok, { gameId: game })
  check(mapOf((await viewOf(game, meUid)).myErrand).thing === undefined, '포기하면 내 손에서 사라진다')
  check(
    str(mapOf((await viewOf(game, youUid)).myErrand).thing) === '빗자루',
    '**남은 사람은 계속한다**',
    String(str(mapOf((await viewOf(game, youUid)).myErrand).thing)),
  )

  console.log('\n── 제한 시간 ──')
  // 25분짜리다. 시계를 40분 민다
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 11), speed: 60 })
  await must('tick', host, { gameId: game })
  check(mapOf((await viewOf(game, youUid)).myErrand).thing === undefined, '시간이 지나면 받은 사람 전원 실패')
  const gone = arr((await viewOf(game, meUid)).errandsHere)
  check(!gone.some((e) => str(e.thing) === '빗자루'), '게시판에서도 떼어진다', `${gone.length}장 남음`)

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
