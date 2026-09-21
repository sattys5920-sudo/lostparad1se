// 상점 여섯 품목 — 사고, 쓰고, 안 새는지.
//
// 붙드는 것은 여섯이다.
//   1. 상점에 서야 산다. 값은 팀 금고에서 빠지고 주인 팀으로 간다
//   2. **지우개는 하루에 한 개다** — 열넷이 달려들어도 하나다
//   3. 자물쇠는 걸음을 막는다. 잠근 팀은 드나든다
//   4. 빈 종이는 쓴 그대로 바닥에 놓이고, 줍기 전에는 한 자도 안 온다
//   5. 지우개는 표 한 장을 지우는데 **몇 장이었는지는 안 알려 준다**
//   6. 테이프는 찢긴 조각을 되살린다. 조각도 「있다」까지만 보인다
//
//   npx vite-node scripts/shop-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { SHOP_ITEMS, SHOP_TILE } from '../shared/rules/shop'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

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
  const email = `shop-${tag}@x.test`
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
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}

function arr(f: unknown): Record<string, unknown>[] {
  const v = (f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue
  return (v?.values ?? []).map((x) => x.mapValue?.fields ?? {})
}
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null
const num = (f: unknown): number => Number((f as { integerValue?: string })?.integerValue ?? 0)

/** 말을 그 방에 세운다. 걸어가는 데 드는 값은 이 시험의 관심이 아니다 */
async function standAt(game: string, uid: string, tileId: string): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=arriveAtMs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null } } }),
  })
}
/** 지갑에 돈을 넣는다. **사람 문서다** — 팀 금고가 없어졌다 */
async function fund(game: string, uid: string, money: number): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { resources: { mapValue: { fields: { money: { integerValue: String(money) }, knowledge: { integerValue: '9' } } } } },
    }),
  })
}
async function teamOf(game: string, uid: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  return str(((await r.json()) as { fields?: Record<string, unknown> }).fields?.team) ?? 'A'
}
async function moneyOf(game: string, uid: string): Promise<number> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const res = (f.resources as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
  return num(res.money)
}
const bagOf = async (game: string, uid: string): Promise<Record<string, number>> => {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const items = (f.items as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
  return Object.fromEntries(Object.entries(items).map(([k, v]) => [k, num(v)]))
}

async function main() {
  const game = `sp${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'sp' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const me = 'qa01'
  const meTok = await tok(me)
  const meUid = uidOf(me)
  const myTeam = await teamOf(game, meUid)

  console.log('\n── 파는 것 여섯 ──')
  check(SHOP_ITEMS.length === 6, '여섯 가지를 판다', String(SHOP_ITEMS.length))

  console.log('\n── 상점에 서야 산다 ──')
  await standAt(game, meUid, 'artRoom')
  const far = await call('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  check(!far.ok, '딴 방에서는 못 산다', far.ok ? '사졌다' : (far.err ?? ''))

  await standAt(game, meUid, SHOP_TILE)
  await fund(game, meUid, 40)
  const before = await moneyOf(game, meUid)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  const after = await moneyOf(game, meUid)
  check(before - after === 4, '자물쇠 값 4가 **내 지갑**에서 빠졌다', `${before} → ${after}`)
  check((await bagOf(game, meUid)).lock === 1, '주머니에 들어왔다')

  console.log('\n── 지우개는 하루에 한 개 ──')
  await must('buyShopItem', meTok, { gameId: game, itemId: 'eraser' })
  const twice = await call('buyShopItem', meTok, { gameId: game, itemId: 'eraser' })
  check(!twice.ok, '**두 개째는 안 나온다**', twice.ok ? '두 개 나왔다' : (twice.err ?? ''))
  // 다른 사람이어도, 다른 팀이어도 하루 몫은 판 전체에서 하나다
  const you = 'qa08'
  const youTok = await tok(you)
  const youUid = uidOf(you)
  await standAt(game, youUid, SHOP_TILE)
  await fund(game, youUid, 40)
  const other = await call('buyShopItem', youTok, { gameId: game, itemId: 'eraser' })
  check(!other.ok, '남의 팀이 와도 하루 몫은 판 전체에서 하나다', other.ok ? '샀다' : (other.err ?? ''))

  console.log('\n── 자물쇠 ──')
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  const locked = await must('useItem', meTok, { gameId: game, kind: 'lock' })
  check(String(locked.said ?? '').includes('상점'), '선 방 문을 잠갔다', String(locked.said))
  const again = await call('useItem', meTok, { gameId: game, kind: 'lock' })
  check(!again.ok, '덮어 걸 수 없다', again.ok ? '또 걸렸다' : (again.err ?? ''))

  // 잠긴 방으로는 못 들어간다. **같은 팀이면 들어간다**
  await standAt(game, youUid, 'artRoom')
  const walk = await call('roamTo', youTok, { gameId: game, tileId: SHOP_TILE })
  /*
   * **거절 이유까지 본다.** 문 앞에 세워 놓는 것을 잊으면 roamTo 가
   * 「이미 그 방이다」로 거절하고, !ok 만 보는 시험은 자물쇠가 하나도
   * 안 걸려 있어도 초록이 된다 — 실제로 한 번 그랬다
   */
  check(
    !walk.ok && (walk.err ?? '').includes('잠겨'),
    '**남의 팀은 문 앞에서 막힌다**',
    walk.ok ? '들어갔다' : (walk.err ?? ''),
  )

  let mateId = ''
  for (const id of ['qa02', 'qa03', 'qa04', 'qa05', 'qa06', 'qa07', 'qa09', 'qa10']) {
    if (id !== me && id !== you && (await teamOf(game, uidOf(id))) === myTeam) { mateId = id; break }
  }
  const mateTok = await tok(mateId)
  await standAt(game, uidOf(mateId), 'artRoom')
  const inn = await call('roamTo', mateTok, { gameId: game, tileId: SHOP_TILE })
  check(inn.ok, '같은 팀은 드나든다', inn.ok ? '' : (inn.err ?? ''))

  console.log('\n── 빈 종이 ──')
  await standAt(game, meUid, 'artRoom')
  await standAt(game, youUid, 'artRoom')
  await fund(game, meUid, 40)
  const noPaper = await call('useItem', meTok, { gameId: game, kind: 'paper', text: MEMO })
  check(!noPaper.ok, '없는 물건은 못 쓴다', noPaper.ok ? '썼다' : (noPaper.err ?? ''))

  await standAt(game, meUid, SHOP_TILE)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'paper' })
  await standAt(game, meUid, 'artRoom')
  const blank = await call('useItem', meTok, { gameId: game, kind: 'paper', text: '   ' })
  check(!blank.ok, '빈 말은 못 놓는다', blank.ok ? '놓였다' : (blank.err ?? ''))
  await must('useItem', meTok, { gameId: game, kind: 'paper', text: MEMO })
  check((await bagOf(game, meUid)).paper === 0, '쓴 만큼 줄었다')

  const v1 = await viewOf(game, uidOf(you))
  const floor = arr(v1.slipsHere)
  check(floor.length === 1, '같은 방 사람에게 한 장이 보인다', `${floor.length}장`)
  /*
   * **줍기 전에는 글이 한 자도 없어야 한다.** 내 몫 전체를 문자열로
   * 만들어서 훑는다. 어느 칸에 들었는지가 아니라 「어디에도 없다」를 본다
   */
  const dump1 = JSON.stringify(v1)
  check(!dump1.includes(MEMO) && !dump1.includes('0412'), '줍기 전에는 글이 내 몫 어디에도 없다')

  const slipId = str(floor[0]?.id) ?? String((floor[0]?.id as { stringValue?: string })?.stringValue ?? '')
  await must('takeSlip', youTok, { gameId: game, slipId })
  const v2 = await viewOf(game, uidOf(you))
  const held = arr(v2.mySlips)[0] ?? {}
  check(str(held.line) === null, '**주워도 안 읽으면 문장이 안 온다**', String(str(held.line)))
  await must('readSlip', youTok, { gameId: game, slipId })
  const v3 = await viewOf(game, uidOf(you))
  const read = arr(v3.mySlips)[0] ?? {}
  check(str(read.line) === MEMO, '읽으면 쓴 그대로 온다', String(str(read.line)))
  check((str(read.subjectId) ?? '') === '', '누구의 비밀도 아니다 — 주인이 안 붙는다', JSON.stringify(read.subjectId))

  console.log('\n── 테이프 ──')
  await must('tearSlip', youTok, { gameId: game, slipId })
  const v4 = await viewOf(game, uidOf(you))
  check(arr(v4.mySlips).length === 0, '찢으면 손에서 없어진다')
  const scraps = arr(v4.scrapsHere)
  check(scraps.length === 1, '찢긴 조각이 그 방에 남는다', `${scraps.length}무더기`)
  check(arr(v4.slipsHere).length === 0, '조각은 바닥의 「한 장」에 안 센다')
  const dump4 = JSON.stringify(v4)
  check(!dump4.includes(MEMO) && !dump4.includes('0412'), '**조각에도 글은 없다** — 붙여야 종이가 된다')

  await standAt(game, meUid, SHOP_TILE)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'tape' })
  const wrongRoom = await call('useItem', meTok, { gameId: game, kind: 'tape', scrapId: String(str(scraps[0]?.id) ?? '') })
  check(!wrongRoom.ok, '딴 방에서는 못 붙인다', wrongRoom.ok ? '붙였다' : (wrongRoom.err ?? ''))

  await standAt(game, meUid, 'artRoom')
  const scrapId = String(str(scraps[0]?.id) ?? '')
  await must('useItem', meTok, { gameId: game, kind: 'tape', scrapId })
  const v5 = await viewOf(game, meUid)
  const taped = arr(v5.mySlips)[0] ?? {}
  check(arr(v5.mySlips).length === 1, '붙이면 내 손에 온다')
  check(str(taped.line) === null, '**접힌 채로 온다** — 붙였다고 읽히지 않는다', String(str(taped.line)))
  await must('readSlip', meTok, { gameId: game, slipId: scrapId })
  const v6 = await viewOf(game, meUid)
  check(str(arr(v6.mySlips)[0]?.line) === MEMO, '읽으면 찢기 전 그대로다')

  console.log('\n── 지우개 ──')
  // 두 사람이 나를 적는다. 한 장을 지우면 동점이 되어 아무도 안 지워진다
  const erased = await call('useItem', meTok, { gameId: game, kind: 'eraser' })
  check(erased.ok, '지우개를 쓴다', erased.ok ? String(erased.result.said) : (erased.err ?? ''))
  check(
    erased.ok && String(erased.result.said ?? '') === '한 장 지웠다.',
    '**몇 장이었는지 안 알려 준다** — 말이 늘 같다',
    erased.ok ? String(erased.result.said) : '',
  )
  const v7 = await viewOf(game, meUid)
  const dump7 = JSON.stringify(v7)
  check(!dump7.includes('erased') && !dump7.includes('지운'), '지운 표 수는 내 몫에도 안 실린다')

  /*
   * **적힌 자리가 집계가 읽는 자리와 같아야 한다.**
   *
   * 집계(settleBallots)는 secret/erased 를 day 로 뒤져서 뺀다. 여기
   * 모양이 어긋나면 지우개가 닳기만 하고 표는 그대로인데, 그 사실은
   * 날이 끝나야 드러나고 그때는 이미 누가 지워진 뒤다.
   */
  const er = await fetch(`${FS}/games/${game}/secret/erased/items`, { headers: ADMIN })
  const rows = ((await er.json()) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? []
  const mineRow = rows.find((d) => str(d.fields?.targetId) === meUid)
  check(rows.length === 1 && num(mineRow?.fields?.n) === 1, '집계가 읽는 자리에 한 장으로 적혔다', `${rows.length}줄`)
  check(num(mineRow?.fields?.day) === 1, '오늘 날짜로 적혔다 — 날이 다르면 안 빠진다', String(num(mineRow?.fields?.day)))

  // 남은 지우개가 없으면 못 쓴다
  const none = await call('useItem', meTok, { gameId: game, kind: 'eraser' })
  check(!none.ok, '없으면 못 쓴다', none.ok ? '썼다' : (none.err ?? ''))

  console.log('\n── 손으로 쓰는 물건이 아닌 것 ──')
  const notHand = await call('useItem', meTok, { gameId: game, kind: 'whistle' })
  check(!notHand.ok, '호루라기는 여기서 못 쓴다 — 행동에 딸려 있다', notHand.ok ? '썼다' : (notHand.err ?? ''))

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
