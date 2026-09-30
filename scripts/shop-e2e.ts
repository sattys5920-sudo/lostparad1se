// 상점 여섯 품목 — 사고, 쓰고, 안 새는지.
//
// 붙드는 것은 여섯이다.
//   1. 상점에 서야 산다. 값은 산 사람 돈에서 빠진다
//   2. **지우개는 하루에 한 개다** — 열넷이 달려들어도 하나다
//   3. 자물쇠는 점령전에만 건다. 그 점령전 동안 남의 분단을 막고, 끝나면 사라진다
//   4. 빈 종이는 쓴 그대로 바닥에 놓이고, 줍기 전에는 한 자도 안 온다
//   5. 지우개는 표 한 장을 지우는데 **몇 장이었는지는 안 알려 준다**
//   6. 테이프는 찢긴 조각을 되살린다. 조각도 「있다」까지만 보인다
//
//   npx vite-node scripts/shop-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { SHOP_ITEMS, VENDINGS } from '../shared/rules/shop'
import { LOCKED_DOOR } from '../shared/rules/items'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
import { of as recOf, records } from './lib/records'
import { dropCellsIn } from '../shared/rules/quiz'
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
/** 자물쇠와 드나들기를 보는 방. **이름만 바뀌었다** — 상점 → 매점 */
const MART_TILE = 'classroom'
/** 1층 복도의 기계. 사고파는 시험은 이 칸 앞에서 한다 */
const MACHINE = VENDINGS.find((v) => v.floor === 'f1')!.cell
/**
 * 기계 앞 두 자리 — 동쪽과 서쪽 옆 칸. **한 칸에 한 사람이다.**
 * 기계 칸 자체는 기물이라 아무도 못 서고, 둘이 같은 칸에 서지도 못한다.
 * 나는 동쪽, 너는 서쪽이다
 */
const MY_SIDE = { x: MACHINE.x + 1, y: MACHINE.y }
const YOUR_SIDE = { x: MACHINE.x - 1, y: MACHINE.y }

/**
 * 기계 앞에 세운다. **방이 아니라 칸이다.**
 *
 * 자판기가 복도로 나간 뒤로 방을 옮겨 놓는 것으로는 못 산다 — 서버는
 * 선 칸(at)만 본다. tileId 는 건드리지 않는다: 복도에 선 사람도 마지막
 * 방을 달고 다닌다.
 */
async function standBy(game: string, uid: string, cell: { x: number; y: number }): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=at`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { at: { mapValue: { fields: { x: { integerValue: String(cell.x) }, y: { integerValue: String(cell.y) } } } } },
    }),
  })
}

async function standAt(game: string, uid: string, tileId: string): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=arriveAtMs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null } } }),
  })
}
/** 그 사람에게 돈을 쥐여 준다. **돈은 사람 것이다** — 말 문서의 money */
async function fund(game: string, uid: string, money: number): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=money`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { money: { integerValue: String(money) } } }),
  })
}
async function teamOf(game: string, uid: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  return str(((await r.json()) as { fields?: Record<string, unknown> }).fields?.team) ?? 'A'
}
/** 그 사람 돈 — 말 문서의 money */
async function moneyOf(game: string, uid: string): Promise<number> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  return num(f.money)
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
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  // 배속 1 — 빠르게 돌리면 자물쇠(한 시간)가 호출 사이에 풀려 「덮어 걸 수 없다」가 흔들린다
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })

  const me = 'qa01'
  const meTok = await tok(me)
  const meUid = uidOf(me)
  const myTeam = await teamOf(game, meUid)

  console.log('\n── 파는 것 일곱 ──')
  check(SHOP_ITEMS.length === 7, '일곱 가지를 판다 — 호루라기·깃발·자물쇠·락픽·빈 종이·지우개·테이프', String(SHOP_ITEMS.length))

  console.log('\n── 자판기 앞에 서야 산다 ──')
  await standAt(game, meUid, 'artRoom')
  await standBy(game, meUid, { x: MACHINE.x + 5, y: MACHINE.y })
  const far = await call('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  check(!far.ok, '**다섯 칸 떨어지면 못 산다** — 방이 아니라 칸을 본다', far.ok ? '사졌다' : (far.err ?? ''))

  /*
   * **기계 칸 자체에는 못 선다.** 기물이라 밟고 지나갈 수 없다.
   *
   * 화면도 같은 자로 재서 애초에 그리로 못 걷지만, 서버가 막는지를
   * 본다 — 화면만 막으면 손으로 부른 요청 하나로 기계 안에 서 있는
   * 사람이 생긴다.
   */
  // 거절은 던지지 않고 `{ ok: false, code: 'blocked' }` 로 온다 — 화면이 조용히 제자리에 남는다
  const onIt = await call('standAt', meTok, { gameId: game, x: MACHINE.x, y: MACHINE.y })
  const onItRes = onIt.ok ? onIt.result : {}
  check(
    onIt.ok && onItRes.ok === false && onItRes.code === 'blocked',
    '**기계 위에는 못 선다** — 기물이다',
    onIt.ok ? `${String(onItRes.code ?? '섰다')} ${String(onItRes.why ?? '')}` : `던졌다: ${onIt.err}`,
  )

  // 한 칸 옆은 「앞」이다. 거기 서야 산다
  await standBy(game, meUid, MY_SIDE)
  await fund(game, meUid, 40)
  const before = await moneyOf(game, meUid)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  const after = await moneyOf(game, meUid)
  const LOCK_PRICE = SHOP_ITEMS.find((i) => i.id === 'lock')?.cost.money ?? -1
  check(before - after === LOCK_PRICE, `자물쇠 값 ${LOCK_PRICE}이 **산 사람 돈**에서 빠졌다`, `${before} → ${after}`)
  check((await bagOf(game, meUid)).lock === 1, '주머니에 들어왔다')

  // 지우개는 **학교 전체에** 하루 몇 개뿐이다(shop.ts stockPerDay). 누가 사든 같은 몫에서 빠진다
  const ERASERS = SHOP_ITEMS.find((i) => i.id === 'eraser')?.stockPerDay ?? 1
  console.log(`\n── 지우개는 학교 전체에 하루 ${ERASERS}개 ──`)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'eraser' })
  // 다른 사람이어도, 다른 팀이어도 하루 몫은 판 전체에서 같이 줄어든다 — 남은 것은 남이 산다
  const you = 'qa08'
  const youTok = await tok(you)
  const youUid = uidOf(you)
  await standBy(game, youUid, YOUR_SIDE)
  await fund(game, youUid, 40)
  for (let i = 1; i < ERASERS; i++) await must('buyShopItem', youTok, { gameId: game, itemId: 'eraser' })
  const twice = await call('buyShopItem', meTok, { gameId: game, itemId: 'eraser' })
  check(!twice.ok, `**${ERASERS}개가 다 나가면 더는 안 나온다**`, twice.ok ? '또 나왔다' : (twice.err ?? ''))
  const other = await call('buyShopItem', youTok, { gameId: game, itemId: 'eraser' })
  check(!other.ok, '남의 팀이 와도 하루 몫은 판 전체에서 같이 줄어든다', other.ok ? '샀다' : (other.err ?? ''))

  console.log('\n── 자물쇠 ──')
  // 사는 것은 자유 시간이다. 거는 것은 점령전이다 — 미리 사 둔다
  await standBy(game, meUid, MY_SIDE)
  await fund(game, meUid, 40)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lock' })
  await must('buyShopItem', meTok, { gameId: game, itemId: 'lockpick' })
  const locks0 = (await bagOf(game, meUid)).lock ?? 0

  await standBy(game, youUid, YOUR_SIDE)
  await fund(game, youUid, 40)
  const PICK_PRICE = SHOP_ITEMS.find((i) => i.id === 'lockpick')?.cost.money ?? -1
  check(PICK_PRICE === 8, '락픽은 8원이다', String(PICK_PRICE))
  const pb = await moneyOf(game, youUid)
  // **하루 몫이 없다.** 셋을 내리 사도 나온다
  for (let i = 0; i < 3; i++) await must('buyShopItem', youTok, { gameId: game, itemId: 'lockpick' })
  check(pb - (await moneyOf(game, youUid)) === PICK_PRICE * 3, '세 개 값이 산 사람 돈에서 빠졌다', `${pb} → ${await moneyOf(game, youUid)}`)
  check((await bagOf(game, youUid)).lockpick === 3, '제한 없이 세 개 다 나왔다', JSON.stringify(await bagOf(game, youUid)))

  // **잠그는 것은 선 방이다.** 복도는 못 잠근다 — 매점 안으로 들여놓는다
  await standAt(game, meUid, MART_TILE)
  const early = await call('useItem', meTok, { gameId: game, kind: 'lock' })
  check(!early.ok && (early.err ?? '').includes('점령전'), '**자유 시간에는 못 건다**', early.ok ? '걸렸다' : (early.err ?? ''))
  check((await bagOf(game, meUid)).lock === locks0, '못 건 자물쇠는 그대로 있다', JSON.stringify(await bagOf(game, meUid)))

  await must('openPhase', host, { gameId: game })
  const locked = await must('useItem', meTok, { gameId: game, kind: 'lock' })
  check(String(locked.said ?? '').includes('매점'), '점령전에는 선 방 문을 잠근다', String(locked.said))
  check((await bagOf(game, meUid)).lock === locks0 - 1, '**건 자물쇠는 없어진다** — 소모품이다', JSON.stringify(await bagOf(game, meUid)))
  const again = await call('useItem', meTok, { gameId: game, kind: 'lock' })
  check(!again.ok, '덮어 걸 수 없다', again.ok ? '또 걸렸다' : (again.err ?? ''))

  // 점령전에는 남의 분단이 문 앞에서 막힌다
  await standAt(game, youUid, 'artRoom')
  const walk = await call('phaseAct', youTok, { gameId: game, kind: 'move', targetTile: MART_TILE })
  // 막히는 말은 한 글자도 틀리면 안 된다 — 화면이 이 말을 보고 락픽을 쓸지 묻는다
  check(!walk.ok && walk.err === LOCKED_DOOR, `**남의 분단은 막힌다** — 「${LOCKED_DOOR}」`, walk.ok ? '들어갔다' : (walk.err ?? ''))

  console.log('\n── 락픽 ──')
  const picked = await call('useItem', youTok, { gameId: game, kind: 'lockpick', tileId: MART_TILE })
  check(picked.ok && String(picked.result?.said ?? '').includes('땄다'), '문 앞에서 딴다', picked.ok ? String(picked.result?.said) : (picked.err ?? ''))
  check((await bagOf(game, youUid)).lockpick === 2, '딴 락픽은 없어진다', JSON.stringify(await bagOf(game, youUid)))
  const tileAfter = (await (await fetch(`${FS}/games/${game}/tiles/${MART_TILE}`, { headers: ADMIN })).json()) as { fields?: Record<string, unknown> }
  check(str(tileAfter.fields?.lockedBy) === null, '**따면 자물쇠가 사라진다**', JSON.stringify(tileAfter.fields?.lockedBy))
  const idle = await call('useItem', youTok, { gameId: game, kind: 'lockpick', tileId: MART_TILE })
  check(!idle.ok && (idle.err ?? '').includes('잠겨 있지 않다'), '안 잠긴 문은 안 딴다', idle.ok ? '땄다' : (idle.err ?? ''))
  check((await bagOf(game, youUid)).lockpick === 2, '헛손질에는 락픽이 안 준다', JSON.stringify(await bagOf(game, youUid)))

  // 우리 팀 자물쇠는 딸 일이 없다 — 그냥 들어가면 된다
  await must('useItem', meTok, { gameId: game, kind: 'lock' })
  await standAt(game, meUid, 'artRoom')
  const ownPick = await call('useItem', meTok, { gameId: game, kind: 'lockpick', tileId: MART_TILE })
  check(!ownPick.ok && (ownPick.err ?? '').includes('우리 분단'), '우리 분단 자물쇠는 안 딴다', ownPick.ok ? '땄다' : (ownPick.err ?? ''))
  const noRoom = await call('useItem', youTok, { gameId: game, kind: 'lockpick', tileId: 'nowhere' })
  check(!noRoom.ok, '없는 방은 못 딴다', noRoom.ok ? '땄다' : (noRoom.err ?? ''))

  console.log('\n── 점령전이 끝나면 자물쇠도 사라진다 ──')
  await must('closePhase', host, { gameId: game })
  const tileShut = (await (await fetch(`${FS}/games/${game}/tiles/${MART_TILE}`, { headers: ADMIN })).json()) as { fields?: Record<string, unknown> }
  check(str(tileShut.fields?.lockedBy) === null, '**페이즈가 끝나면 자물쇠가 없어진다**', JSON.stringify(tileShut.fields?.lockedBy))
  await standAt(game, youUid, 'artRoom')
  const walkIn = await call('roamTo', youTok, { gameId: game, tileId: MART_TILE })
  check(walkIn.ok, '자유 시간에는 남의 분단도 들어간다', walkIn.ok ? '' : (walkIn.err ?? ''))
  await standAt(game, meUid, 'artRoom')
  await standAt(game, youUid, 'artRoom')

  console.log('\n── 빈 종이 ──')
  await standAt(game, meUid, 'artRoom')
  await standAt(game, youUid, 'artRoom')
  await fund(game, meUid, 40)
  const noPaper = await call('useItem', meTok, { gameId: game, kind: 'paper', text: MEMO })
  check(!noPaper.ok, '없는 물건은 못 쓴다', noPaper.ok ? '썼다' : (noPaper.err ?? ''))

  await standBy(game, meUid, MY_SIDE)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'paper' })
  // 미술실 안 한 칸에 선다 — 종이는 **발밑 옆 칸**에 놓인다
  const artCells = dropCellsIn('artRoom')
  const mine = artCells.find((c) => artCells.some((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1)) ?? artCells[0]
  await standAt(game, meUid, 'artRoom')
  await standBy(game, meUid, mine)
  const blank = await call('useItem', meTok, { gameId: game, kind: 'paper', text: '   ' })
  check(!blank.ok, '빈 말은 못 놓는다', blank.ok ? '놓였다' : (blank.err ?? ''))
  // 보는 사람은 **놓기 전에** 세운다(내 몫은 놓을 때 다시 그려진다). 같은 방 안, 종이에서 떨어진 칸에 세운다 — 안개는 선 칸의 방을 본다
  const farCell = artCells.find((c) => Math.max(Math.abs(c.x - mine.x), Math.abs(c.y - mine.y)) >= 4) ?? artCells[artCells.length - 1]
  await standAt(game, youUid, 'artRoom')
  await standBy(game, youUid, farCell)
  await must('useItem', meTok, { gameId: game, kind: 'paper', text: MEMO })
  check((await bagOf(game, meUid)).paper === 0, '쓴 만큼 줄었다')

  const v1 = await viewOf(game, uidOf(you))
  const onMap = arr(v1.slipPapers)
  check(onMap.length === 1, '**맵 바닥에 종이가 그려진다** — 칸이 붙어 온다', `${onMap.length}장`)
  const at = { x: num(onMap[0]?.x), y: num(onMap[0]?.y) }
  check(Math.max(Math.abs(at.x - mine.x), Math.abs(at.y - mine.y)) === 1, '놓은 사람 발밑 옆 칸이다', `나 ${mine.x},${mine.y} · 종이 ${at.x},${at.y}`)
  check(str(onMap[0]?.kind) === 'memo', '**운영자 메모와 같은 그림**(봉인 없는 메모)으로 그려진다', String(str(onMap[0]?.kind)))
  check(arr(v1.slipsHere).length === 0, '방에 들어왔다고 「몇 장 있다」가 따로 오지 않는다')
  const floor = onMap
  /*
   * **줍기 전에는 글이 한 자도 없어야 한다.** 내 몫 전체를 문자열로
   * 만들어서 훑는다. 어느 칸에 들었는지가 아니라 「어디에도 없다」를 본다
   */
  const dump1 = JSON.stringify(v1)
  check(!dump1.includes(MEMO) && !dump1.includes('0412'), '줍기 전에는 글이 내 몫 어디에도 없다')

  const slipId = str(floor[0]?.id) ?? String((floor[0]?.id as { stringValue?: string })?.stringValue ?? '')
  // 멀리 선 채로는 못 줍는다 — 맵에서 옆에 가서 짚는 것이다
  const tooFar = await call('takeSlip', youTok, { gameId: game, slipId })
  check(!tooFar.ok, '종이에서 떨어져 있으면 못 줍는다', tooFar.ok ? '주웠다' : (tooFar.err ?? ''))
  await standBy(game, youUid, mine)
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
  const scraps = arr(v4.scrapPapers)
  check(scraps.length === 1, '**찢긴 종이가 맵 바닥에 그려진다** — 찢은 사람 발밑 옆', `${scraps.length}장`)
  const scrapAt = { x: num(scraps[0]?.x), y: num(scraps[0]?.y) }
  check(arr(v4.slipsHere).length === 0, '조각은 바닥의 「한 장」에 안 센다')
  const dump4 = JSON.stringify(v4)
  check(!dump4.includes(MEMO) && !dump4.includes('0412'), '**조각에도 글은 없다** — 붙여야 종이가 된다')

  await standBy(game, meUid, MY_SIDE)
  await must('buyShopItem', meTok, { gameId: game, itemId: 'tape' })
  /*
   * **방을 옮겨서 본다.** 기계 앞에 세우는 것(standBy)은 칸만 바꾸므로
   * 선 방은 조각이 있는 그 방 그대로다 — 그 상태로 「딴 방에서는 못
   * 붙인다」를 보면 붙어 버린다. 실제로 그랬다.
   */
  await standAt(game, meUid, 'musicRoom')
  const wrongRoom = await call('useItem', meTok, { gameId: game, kind: 'tape', scrapId: String(str(scraps[0]?.id) ?? '') })
  check(!wrongRoom.ok, '딴 방에서는 못 붙인다', wrongRoom.ok ? '붙였다' : (wrongRoom.err ?? ''))

  await standAt(game, meUid, 'artRoom')
  const scrapId = String(str(scraps[0]?.id) ?? '')
  // 같은 방이어도 떨어져 있으면 못 붙인다 — 찢긴 종이 옆에 서야 한다
  const farFromScrap = artCells.find((c) => Math.max(Math.abs(c.x - scrapAt.x), Math.abs(c.y - scrapAt.y)) >= 3) ?? artCells[0]
  await standBy(game, meUid, farFromScrap)
  const tooFarTape = await call('useItem', meTok, { gameId: game, kind: 'tape', scrapId })
  check(!tooFarTape.ok, '찢긴 종이에서 떨어져 있으면 못 붙인다', tooFarTape.ok ? '붙였다' : (tooFarTape.err ?? ''))
  const besideScrap = artCells.find((c) => Math.max(Math.abs(c.x - scrapAt.x), Math.abs(c.y - scrapAt.y)) === 1) ?? scrapAt
  await standBy(game, meUid, besideScrap)
  await must('useItem', meTok, { gameId: game, kind: 'tape', scrapId })
  check(arr((await viewOf(game, meUid)).scrapPapers).length === 0, '붙이면 바닥에서 찢긴 종이가 사라진다')
  const v5 = await viewOf(game, meUid)
  const taped = arr(v5.mySlips)[0] ?? {}
  check(arr(v5.mySlips).length === 1, '붙이면 내 손에 온다')
  check(str(taped.line) === null, '**접힌 채로 온다** — 붙였다고 읽히지 않는다', String(str(taped.line)))
  await must('readSlip', meTok, { gameId: game, slipId: scrapId })
  const v6 = await viewOf(game, meUid)
  check(str(arr(v6.mySlips)[0]?.line) === MEMO, '읽으면 찢기 전 그대로다')

  /*
   * **손으로 쓴 종이는 어떤 쪽지 미션에도 안 센다** — 읽기 · 찢기 ·
   * 건네기 모두. 개인 미션은 운영자가 놓은 쪽지(56장) 몫이다
   */
  const paperLog = await records(game)
  check(
    recOf(paperLog, 'slipRead').length === 0 && recOf(paperLog, 'slipTear').length === 0 && recOf(paperLog, 'slipGive').length === 0,
    '빈 종이를 읽고 찢어도 미션 줄(읽기·찢기·건네기)이 안 생긴다',
  )

  console.log('\n── 바닥의 메모 — 그 자리에서 읽기 · 찢기 ──')
  {
    await must('buyShopItem', meTok, { gameId: game, itemId: 'paper' }).catch(async () => {
      await standBy(game, meUid, MY_SIDE)
      await must('buyShopItem', meTok, { gameId: game, itemId: 'paper' })
    })
    await standAt(game, meUid, 'artRoom')
    await standBy(game, meUid, mine)
    await standAt(game, youUid, 'artRoom')
    await standBy(game, youUid, farCell)
    await must('useItem', meTok, { gameId: game, kind: 'paper', text: '두 번째 종이' })
    const papersNow = arr((await viewOf(game, youUid)).slipPapers)
    const memo = papersNow.find((p) => str(p.kind) === 'memo')
    const memoId = String(str(memo?.id) ?? '')
    const memoAt = { x: num(memo?.x), y: num(memo?.y) }
    const farRead = await call('readSlipHere', youTok, { gameId: game, slipId: memoId })
    check(!farRead.ok, '떨어져서는 못 읽는다', farRead.ok ? '읽었다' : (farRead.err ?? ''))
    const nearMemo = artCells.find((c) => Math.max(Math.abs(c.x - memoAt.x), Math.abs(c.y - memoAt.y)) === 1) ?? memoAt
    await standBy(game, youUid, nearMemo)
    const readHere = await call('readSlipHere', youTok, { gameId: game, slipId: memoId })
    check(readHere.ok && String(readHere.result.line) === '두 번째 종이', '옆에서 읽으면 글이 온다', readHere.ok ? String(readHere.result.line) : (readHere.err ?? ''))
    const vAfterRead = await viewOf(game, youUid)
    check(arr(vAfterRead.slipPapers).some((p) => str(p.id) === memoId), '**읽어도 바닥에 그대로 있다**')
    check(!JSON.stringify(vAfterRead).includes('두 번째 종이'), '읽은 글은 내 몫(views)에도 안 남는다 — 응답으로만 왔다')
    await must('tearSlipHere', youTok, { gameId: game, slipId: memoId })
    const vAfterTear = await viewOf(game, youUid)
    check(!arr(vAfterTear.slipPapers).some((p) => str(p.id) === memoId), '찢으면 쪽지 그림은 사라지고')
    const torn = arr(vAfterTear.scrapPapers).find((p) => str(p.id) === memoId)
    check(torn !== undefined && num(torn.x) === memoAt.x && num(torn.y) === memoAt.y, '**그 칸에 찢긴 종이로 남는다**')
    check(arr(vAfterTear.mySlips).length === 0, '찢어도 내 손에는 안 들어온다')
  }

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

  console.log('\n── 산 것이 기록에 남는가 ──')
  /*
   * **매점 단골이 이 줄을 센다.** 전에는 events 에만 남아서, 판정이
   * 보는 기록 계층에는 자판기가 통째로 없었다. 사는 것과 파는 것을
   * 가른 것도 미션 때문이다 — 「세 번 산다」에 매입이 들면 안 된다
   */
  const log = await records(game)
  const bought = recOf(log, 'vendBuy', meUid)
  check(bought.length >= 3, '산 횟수만큼 줄이 쌓였다', `${bought.length}줄`)
  check(
    bought.some((r) => r.subjectId === 'lock') && bought.some((r) => r.subjectId === 'eraser'),
    '무엇을 샀는지가 줄마다 적힌다',
  )
  check(recOf(log, 'vendSell').length === 0, '안 팔았으니 매입 줄은 없다')
  // 게임 시계로 찍혔는지. 실제 시계면 배속 판에서 날짜가 통째로 어긋난다
  const nowGame = (await must('clockNow', meTok, { gameId: game })) as { nowMs?: number }
  const drift = Math.abs((bought[0]?.atMs ?? 0) - (nowGame.nowMs ?? 0))
  check(drift < 6 * 3600_000, '게임 시계로 찍혔다', `${Math.round(drift / 60000)}분 차이`)

  console.log('\n── 없는 물건 ──')
  const notHand = await call('useItem', meTok, { gameId: game, kind: 'whistle' })
  check(!notHand.ok, '없어진 호루라기는 못 쓴다', notHand.ok ? '썼다' : (notHand.err ?? ''))

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
