// 화분 — 운영자가 심고, 자라고, 먼저 온 사람이 딴다.
//
// 붙드는 것은 여섯이다.
//   1. **심는 것은 운영자뿐이다.** 사람에게는 심는 문이 없다
//   2. 빈 자리에만 심긴다. 작물을 고를 수도, 맡길 수도 있다
//   3. **무엇이 심겼는지는 싹이 나야 안다** — 그 방에 선 누구도
//   4. 자랄 시간은 **어느 몫에도 없다** — 흙 앞에서 기다리는 것이 일이다
//   5. 열매는 **누구든 먼저 온 사람이** 딴다. 화분 앞에 서야 한다
//   6. 시들면 못 딴다. 치워야 다음 것이 들어간다
//
//   npx vite-node scripts/garden-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { CROP_BY_ID, GARDEN_TILE, HARVEST_LIMIT, POT_CELLS } from '../shared/rules/crop'
import { VENDINGS } from '../shared/rules/shop'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
import { of as recOf, records } from './lib/records'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
/** 1층 복도의 자판기. 매입구 시험은 이 칸 앞에서 한다 */
const MACHINE = VENDINGS.find((v) => v.floor === 'f1')!.cell

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
  const email = `gd-${tag}@x.test`
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

/**
 * 복도의 그 칸에 세운다. **tileId 는 안 건드린다** — 복도에 선 사람도
 * 마지막 방을 달고 다니고, 자판기는 선 칸(at)만 본다.
 */
async function standBy(game: string, uid: string, cell: { x: number; y: number }): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=at`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { at: { mapValue: { fields: { x: { integerValue: String(cell.x) }, y: { integerValue: String(cell.y) } } } } },
    }),
  })
}

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


/** 그 화분 문서를 손으로 들여다본다. 서버만 아는 값까지 여기서는 본다 */
async function potDoc(game: string, i: number): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/pots/${i}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}

/** 화분의 심은 시각을 손으로 당긴다. 기다리지 않고 자라게 하는 길이다 */
async function ageBy(game: string, i: number, ms: number): Promise<void> {
  const f = await potDoc(game, i)
  const planted = Number((f.plantedMs as { integerValue?: string })?.integerValue ?? 0)
  await fetch(`${FS}/games/${game}/pots/${i}?updateMask.fieldPaths=plantedMs`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { plantedMs: { integerValue: String(planted - ms) } } }),
  })
}

/**
 * 그 화분을 **꼭 열매까지만** 당긴다.
 *
 * 열두 시간씩 밀어 버리면 빨리 자라는 작물은 그새 시들어 버린다 —
 * 무엇이 심겼는지는 시험만 아는 값(문서)이므로, 뽑아 둔 시간을 읽어
 * 그만큼만 당긴다.
 */
async function ageToFruit(game: string, i: number): Promise<{ cropId: string; witherMs: number }> {
  const f = await potDoc(game, i)
  const cropId = String((f.cropId as { stringValue?: string })?.stringValue ?? '')
  const growMs = Number((f.growMs as { integerValue?: string })?.integerValue ?? 0)
  await ageBy(game, i, growMs + 60_000)
  return { cropId, witherMs: (CROP_BY_ID[cropId]?.witherHours ?? 1) * H }
}

/**
 * 몫을 새로 쓰게 한다. **서버가 정말 한 번 일해야 한다.**
 *
 * 문서만 손으로 고치면 views 는 옛 값 그대로다 — tick 은 따라잡을
 * 것이 있을 때만 다시 쓴다. 옆 칸으로 한 걸음 옮겼다 돌아온다.
 */
async function wake(game: string, tk: string, cell: { x: number; y: number }): Promise<void> {
  await must('standAt', tk, { gameId: game, x: cell.x + 1, y: cell.y + 1 })
  await must('standAt', tk, { gameId: game, x: cell.x, y: cell.y + 1 })
}

/**
 * 그 화분 **옆**에 세운다. 화분 칸 자체는 기물이라 못 밟는다 — 전에는
 * 화분 위에 서던 시험이라, 막히자마자 여기서 드러났다. 바로 아랫칸이다:
 * 화분 두 줄(y100·y103) 아래에는 가구가 없다.
 */
async function standAt(game: string, tk: string, cell: { x: number; y: number }): Promise<void> {
  await must('standAt', tk, { gameId: game, x: cell.x, y: cell.y + 1 })
}

const potsOf = (v: Record<string, unknown>) => arr(v.potsHere)
const H = 3_600_000

async function main() {
  const game = `gd${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'gd' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const meTok = await tok('qa01')
  const youTok = await tok('qa02')
  const meUid = uidOf('qa01')
  const youUid = uidOf('qa02')

  console.log('── 심는 것은 운영자다 ──')
  const asPlayer = await call('hostPlant', meTok, { gameId: game, pot: 0 })
  check(!asPlayer.ok, '보통 사람은 못 심는다', asPlayer.ok ? '심었다' : (asPlayer.err ?? ''))

  const planted = await must('hostPlant', host, { gameId: game, pot: 0, cropId: 'corn' })
  check(String(planted.planted ?? '') === CROP_BY_ID.corn.name, '고른 작물이 심긴다', String(planted.planted))
  check(!('growMs' in planted), '**자랄 시간은 운영자에게도 안 간다**', JSON.stringify(planted))
  const twice = await call('hostPlant', host, { gameId: game, pot: 0 })
  check(!twice.ok, '한 자리에 둘은 안 심긴다', twice.ok ? '심었다' : (twice.err ?? ''))

  const anyOne = await must('hostPlant', host, { gameId: game, pot: 1 })
  check(
    Object.values(CROP_BY_ID).some((c) => c.name === String(anyOne.planted)),
    '안 고르면 서버가 뽑는다',
    String(anyOne.planted),
  )

  // 판에 두 번뿐인 것을 세 번 심어 본다
  await must('hostPlant', host, { gameId: game, pot: 6, cropId: 'hers' })
  await must('hostPlant', host, { gameId: game, pot: 7, cropId: 'hers' })
  const third = await call('hostPlant', host, { gameId: game, pot: 4, cropId: 'hers' })
  check(!third.ok, '**두 번뿐인 것은 세 번째가 막힌다**', third.ok ? '심었다' : (third.err ?? ''))

  await putIn(game, meUid, GARDEN_TILE)
  await standAt(game, meTok, POT_CELLS[0])
  const vSoil = await viewOf(game, meUid)
  const pot0 = potsOf(vSoil).find((p) => num(p.i) === 0) ?? {}
  check(str(pot0.stage) === 'soil', '흙이다', String(str(pot0.stage)))
  check(pot0.name?.toString().includes('nullValue') !== false || str(pot0.name) === null,
    '**흙일 때는 이름이 안 온다** — 심은 사람에게도', JSON.stringify(pot0.name))
  const soilJson = JSON.stringify(potsOf(vSoil))
  check(!soilJson.includes('growMs') && !soilJson.includes('plantedMs'),
    '**자랄 시간도 심은 시각도 안 온다**')
  check(!soilJson.includes('corn') && !soilJson.includes(CROP_BY_ID.corn.name),
    '**무엇이 심겼는지도 안 온다**')

  console.log('\n── 남의 눈 ──')
  await putIn(game, youUid, GARDEN_TILE)
  await standAt(game, youTok, POT_CELLS[1])
  const vYou = await viewOf(game, youUid)
  check(potsOf(vYou).length === POT_CELLS.length, '같은 방 사람도 화분 여덟을 본다', `${potsOf(vYou).length}개`)
  const youSoil = potsOf(vYou).find((p) => num(p.i) === 0) ?? {}
  check(str(youSoil.stage) === 'soil', '남에게도 흙으로 보인다', String(str(youSoil.stage)))

  const vOut = await viewOf(game, uidOf('qa03'))
  check(potsOf(vOut).length === 0, '**정원 밖 사람에게는 화분이 아예 안 간다**', `${potsOf(vOut).length}개`)

  console.log('\n── 자란다 ──')
  await ageToFruit(game, 0)
  await wake(game, meTok, POT_CELLS[0])
  const vGrown = await viewOf(game, meUid)
  const ripe = potsOf(vGrown).find((p) => num(p.i) === 0) ?? {}
  check(str(ripe.stage) === 'fruit', '열매가 된다', String(str(ripe.stage)))
  check(str(ripe.name) !== null, '**이때는 이름이 보인다**', String(str(ripe.name)))
  const grownName = str(ripe.name) ?? ''
  check(
    Object.values(CROP_BY_ID).some((c) => c.name === grownName),
    '표에 있는 작물이다',
    grownName,
  )

  console.log('\n── 딴다 ──')
  const farPick = await call('harvestPot', youTok, { gameId: game, pot: 0 })
  check(!farPick.ok, '화분 앞이 아니면 못 딴다', farPick.ok ? '땄다' : (farPick.err ?? ''))

  // **심은 사람이 아니어도 딴다.** 앞에 선 사람이 가진다
  await standAt(game, youTok, POT_CELLS[0])
  const got = await must('harvestPot', youTok, { gameId: game, pot: 0 })
  check(String(got.got ?? '') === grownName, '**심은 사람이 아니어도 딴다**', String(got.got))
  const vYou2 = await viewOf(game, youUid)
  const bag = mapOf(vYou2.myCrops)
  check(Object.keys(bag).length === 1, '딴 것이 내 몫에 있다', JSON.stringify(Object.keys(bag)))
  const vMe2 = await viewOf(game, meUid)
  check(Object.keys(mapOf(vMe2.myCrops)).length === 0, '심은 사람 손에는 없다')
  const empty = potsOf(vYou2).find((p) => num(p.i) === 0) ?? {}
  check(str(empty.stage) === 'empty', '딴 자리는 빈 화분이 된다', String(str(empty.stage)))

  console.log('\n── 시듦 ──')
  await must('hostPlant', host, { gameId: game, pot: 0 })
  const dead0 = await ageToFruit(game, 0)
  // 열매가 된 뒤로 시드는 시간만큼 더 당긴다
  await ageBy(game, 0, dead0.witherMs + 60_000)
  await wake(game, meTok, POT_CELLS[0])
  const vDead = await viewOf(game, meUid)
  const dead = potsOf(vDead).find((p) => num(p.i) === 0) ?? {}
  check(str(dead.stage) === 'withered', '시든다', String(str(dead.stage)))
  const pickDead = await call('harvestPot', meTok, { gameId: game, pot: 0 })
  check(!pickDead.ok, '시든 것은 못 딴다', pickDead.ok ? '땄다' : (pickDead.err ?? ''))
  const plantOnDead = await call('hostPlant', host, { gameId: game, pot: 0 })
  check(!plantOnDead.ok, '치우기 전에는 못 심는다', plantOnDead.ok ? '심었다' : (plantOnDead.err ?? ''))
  await must('clearPot', meTok, { gameId: game, pot: 0 })
  const vClean = await viewOf(game, meUid)
  check(
    str((potsOf(vClean).find((p) => num(p.i) === 0) ?? {}).stage) === 'empty',
    '치우면 빈 화분이 된다',
  )

  console.log('\n── 그 애가 심은 것 ──')
  /*
   * 판에 두 번뿐인 작물이다. 싹이 나면 **그 방에 선 사람 전원**이
   * 짧은 알림을 받는다 — 흔하면 그냥 비싼 작물이고, 두 번뿐이라
   * 그 자리에 있었다는 것이 이야기가 된다.
   *
   * 무엇이 심길지는 서버가 뽑으므로 시험이 손으로 심어 둔다.
   */
  await fetch(`${FS}/games/${game}/pots/5`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        cropId: { stringValue: 'hers' },
        plantedMs: { integerValue: String(dayHourMs(START, 1, 1)) },
        growMs: { integerValue: String(10 * H) },
        toldHers: { booleanValue: false },
      },
    }),
  })
  await must('tick', host, { gameId: game })
  const noticed = await fetch(`${FS}/games/${game}/notices`, { headers: ADMIN })
  const rows = ((await noticed.json()) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? []
  const hersRows = rows.filter((d) => (str(d.fields?.text) ?? '').includes(CROP_BY_ID.hers.name))
  const toMe = hersRows.some((d) => str(d.fields?.toPlayerId) === meUid)
  const toYou = hersRows.some((d) => str(d.fields?.toPlayerId) === youUid)
  const toOut = hersRows.some((d) => str(d.fields?.toPlayerId) === uidOf('qa03'))
  check(toMe && toYou, '**정원에 선 사람 전원이 알림을 받는다**', `${hersRows.length}줄`)
  check(!toOut, '정원 밖 사람에게는 안 간다')
  // 두 번 부르면 두 번 울리지 않는다
  const before = hersRows.length
  await must('tick', host, { gameId: game })
  const again = await fetch(`${FS}/games/${game}/notices`, { headers: ADMIN })
  const rows2 = ((await again.json()) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? []
  const after = rows2.filter((d) => (str(d.fields?.text) ?? '').includes(CROP_BY_ID.hers.name)).length
  check(after === before, '한 번만 울린다', `${before} → ${after}`)

  console.log('\n── 매입구 ──')
  /*
   * 딴 것은 자판기에 넣어야 돈이 된다. **값은 표에 적힌 그대로다** —
   * 흥정도 떨이도 없다. 기계 앞에 서야 넣을 수 있는 것도 사는 것과 같다.
   */
  const bagNow = mapOf((await viewOf(game, youUid)).myCrops)
  const soldId = Object.keys(bagNow)[0] ?? 'corn'
  const farSell = await call('sellCrop', youTok, { gameId: game, cropId: soldId })
  check(!farSell.ok, '자판기 앞이 아니면 못 넣는다', farSell.ok ? '넣었다' : (farSell.err ?? ''))

  // **기계 앞에 세운다.** 방이 아니라 칸이다 — 복도에는 방이 없다
  await standBy(game, youUid, MACHINE)
  const moneyBefore = await purseOf(game, youUid)
  const paid = await must('sellCrop', youTok, { gameId: game, cropId: soldId })
  check(
    Number(paid.paid) === CROP_BY_ID[soldId].price,
    '**표에 적힌 값 그대로 받는다**',
    `${paid.paid} / 표는 ${CROP_BY_ID[soldId].price}`,
  )
  check((await purseOf(game, youUid)) === moneyBefore + CROP_BY_ID[soldId].price, '내 지갑에 그대로 붙었다')
  const vSold = await viewOf(game, youUid)
  check(num(mapOf(vSold.myCrops)[soldId]) === 0, '손에서 빠진다')
  const twiceSell = await call('sellCrop', youTok, { gameId: game, cropId: soldId })
  check(!twiceSell.ok, '없는 것은 못 넣는다', twiceSell.ok ? '넣었다' : (twiceSell.err ?? ''))

  console.log('\n── 손에 드는 수 ──')
  // 한도까지 채워 두고 한 번 더 따 본다
  const full = Object.fromEntries(
    Object.entries({ potato: HARVEST_LIMIT }).map(([k, n]) => [k, { integerValue: String(n) }]),
  )
  await fetch(`${FS}/games/${game}/pawns/${meUid}?updateMask.fieldPaths=crops`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { crops: { mapValue: { fields: full } } } }),
  })
  await must('hostPlant', host, { gameId: game, pot: 2 })
  await standAt(game, meTok, POT_CELLS[2])
  await ageToFruit(game, 2)
  await wake(game, meTok, POT_CELLS[2])
  const vFull = await viewOf(game, meUid)
  const ripe2 = potsOf(vFull).find((p) => num(p.i) === 2) ?? {}
  check(str(ripe2.stage) === 'fruit', '열매가 달렸다', String(str(ripe2.stage)))
  check((ripe2.canPick as { booleanValue?: boolean })?.booleanValue === false, '손이 차면 못 딴다고 온다')
  const nope = await call('harvestPot', meTok, { gameId: game, pot: 2 })
  check(!nope.ok, `${HARVEST_LIMIT}개까지만 들고 다닌다`, nope.ok ? '땄다' : (nope.err ?? ''))

  console.log('\n── 딴 것이 기록에 남는가 ──')
  /*
   * **화분은 따는 순간 비워진다.** 그래서 여기서 안 적으면 누가 무엇을
   * 땄는지가 영영 사라진다 — 원예부의 「다섯 번 딴다」가 셀 것이 없어진다.
   */
  const log = await records(game)
  const picked = recOf(log, 'potHarvest')
  check(picked.length >= 1, '딴 만큼 줄이 쌓인다', `${picked.length}줄`)
  check(picked.some((r) => r.actorId === youUid), '딴 사람으로 적힌다')
  check(
    picked.every((r) => typeof r.subjectId === 'string' && r.subjectId.includes(':')),
    '어느 화분에서 무엇을 땄는지가 적힌다',
    String(picked[0]?.subjectId),
  )
  check(picked.every((r) => r.ownerId === undefined), '심은 사람은 안 적는다 — 화분에 주인이 없다')

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  if (bad > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
