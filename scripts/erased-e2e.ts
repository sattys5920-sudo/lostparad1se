// 지워진 사람이 하루 동안 무엇을 못 하는가. 진짜 서버로 본다.
//
// 보는 것은 다섯이다 —
//   ㆍ 친 말이 **남에게는 줄째로 안 간다**(본인에게만 남는다)
//   ㆍ 거래·이적·동맹·쪽지 건네기가 **양쪽 다** 막힌다
//   ㆍ 사람을 겨눈 카드도 호출도 막힌다
//   ㆍ 점령전 자체에는 참여한다
//   ㆍ 신뢰·호감표는 **줄 수 있다**. 받는 것만 막힌다
//
//   npx vite-node scripts/erased-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `iv${TAG}`
const PW = 'ivpass1234'
const QA = `qaiv${TAG}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
const no = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message)
async function tok(id: string, password = PW): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }])),
    }),
  })
}

async function main(): Promise<void> {
  const he = `ih${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'iv' })

  const gone = `ig${TAG}`   // 지워질 사람
  const near = `in${TAG}`   // 같은 방에 선 남의 팀 사람
  for (const id of [gone, near]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(gone), { gameId: GAME, name: '지워진쪽', team: 'A' })
  await call('joinGame', await tok(near), { gameId: GAME, name: '옆사람', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })

  const g = uidOf(gone)
  const n = uidOf(near)
  // 실재하는 방이라야 한다. 없는 칸에 세우면 서버가 보는 값과 어긋난다
  const room = 'storage'
  for (const who of [g, n]) await patch(`games/${GAME}/pawns/${who}`, { tileId: room, postTile: room })
  // **칸은 판에서 뽑는다.** 방 좌표는 층을 이어 붙인 전역 값이라
  // 눈대중으로 적으면 서버가 「그 방의 칸이 아니다」로 답한다
  const plan = TILE_BY_ID[room].plan
  const cell = (i: number) => ({ x: plan.x + 1 + i, y: plan.y + 1 })
  const spare = { x: plan.x + 3, y: plan.y + 3 }
  for (const [who, i] of [[g, 0], [n, 1]] as const) {
    const c = cell(i)
    await fetch(`${FS}/games/${GAME}/pawns/${who}?updateMask.fieldPaths=at`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { at: { mapValue: { fields: { x: { integerValue: String(c.x) }, y: { integerValue: String(c.y) } } } } } }),
    })
  }
  // DAY 2 로 옮겨 이적까지 볼 수 있게 한다
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 2, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })
  // 오늘의 투명인간으로 앉힌다. **날짜표에도 적는다** — 따라잡기가
  // 날마다 그 표에서 다시 꺼내므로, 한쪽만 적으면 tick 한 번에 풀린다
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=invisibleId&updateMask.fieldPaths=invisibleTeam&updateMask.fieldPaths=invisibleByDay`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        invisibleId: { stringValue: g },
        invisibleTeam: { stringValue: 'A' },
        invisibleByDay: { mapValue: { fields: { '2': { stringValue: g } } } },
      },
    }),
  })
  // **여기서 tick 을 부르면 안 된다.** 따라잡기가 날짜표에서 그날 것을
  // 다시 꺼내 덮어쓰므로, 방금 앉힌 투명인간이 그 자리에서 풀린다

  const tkG = await tok(gone)
  const tkN = await tok(near)

  console.log('\n── 보이지 않는다 ──')
  // 투영은 서버가 한 번 깎아 다시 쓰는 것이다. REST 로 문서만 고쳐 놓고
  // 보면 고치기 전의 사본을 보게 된다 — **뷰를 다시 쓰는** 호출 하나를
  // 끼운다. say 는 줄만 쌓고 투영은 안 건드린다
  // **다른 칸으로 보내야 한다.** 같은 칸이면 standAt 이 일찍 돌아가
  // 투영을 다시 쓰지 않는다
  await call('standAt', tkN, { gameId: GAME, x: plan.x + 5, y: plan.y + 2 })
  const vr = await fetch(`${FS}/games/${GAME}/views/${n}`, { headers: ADMIN })
  const vf = ((await vr.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const ids = ((vf.visibleIds as { arrayValue?: { values?: { stringValue?: string }[] } })?.arrayValue?.values ?? [])
    .map((x) => x.stringValue)
  check(!ids.includes(g), '남의 목록에 아예 없다', `${ids.length}명 보인다`)

  console.log('\n── 친 말이 남에게 안 간다 ──')
  await call('say', tkG, { gameId: GAME, text: '나 여기 있어' })
  const heard = (await call('chatLines', tkN, { gameId: GAME })) as { lines?: { playerId: string }[] }
  check(
    !(heard.lines ?? []).some((l) => l.playerId === g),
    '옆사람에게는 줄째로 안 간다 — 위치가 안 샌다',
    `${(heard.lines ?? []).length}줄 들렸다`,
  )
  const mine = (await call('chatLines', tkG, { gameId: GAME })) as { lines?: { playerId: string; muted?: boolean }[] }
  const own = (mine.lines ?? []).find((l) => l.playerId === g)
  check(own !== undefined && own.muted === true, '본인에게는 「전해지지 않았다」로 남는다')

  // 뷰를 다시 쓰려고 옆사람을 한 번 떼어 놓았다. 마주 보고 하는 일을
  // 보려면 도로 옆 칸에 세워야 한다 — 거래는 붙어 서야 꺼낸다
  await call('standAt', tkN, { gameId: GAME, ...cell(1) })

  console.log('\n── 마주 보고 하는 일 ──')
  for (const [name, go] of [
    ['거래', () => call('askDeal', tkG, { gameId: GAME, toPlayerId: n })],
    ['이적', () => call('askTransfer', tkG, { gameId: GAME, toPlayerId: n })],
    ['동맹', () => call('proposeAlliance', tkG, { gameId: GAME, withTeam: 'B' })],
    ['쪽지 건네기', () => call('giveSlip', tkG, { gameId: GAME, toPlayerId: n, slipId: 'x' })],
  ] as const) {
    const why = await no(go())
    check(why.includes('보이지 않는 동안에는'), `${name}을 못 꺼낸다`, why)
  }

  console.log('\n── 남이 지워진 사람에게 거는 것도 막힌다 ──')
  for (const [name, go] of [
    ['거래', () => call('askDeal', tkN, { gameId: GAME, toPlayerId: g })],
    ['이적', () => call('askTransfer', tkN, { gameId: GAME, toPlayerId: g })],
  ] as const) {
    const why = await no(go())
    check(why.includes('그런 사람이 없다'), `${name}을 그 사람에게 못 건다`, why)
  }

  console.log('\n── 신뢰·호감표 ──')
  const gave = await no(call('castVote', tkG, { gameId: GAME, targetId: n, kind: 'trust' }))
  check(gave === '' || !gave.includes('보이지 않는 동안에는'), '지워진 사람도 표는 준다', gave)
  const got = await no(call('castVote', tkN, { gameId: GAME, targetId: g, kind: 'trust' }))
  check(got.includes('그 사람에게 줄 수 없다'), '받지는 못한다', got)

  console.log('\n── 점령전 ──')
  await call('openPhase', host, { gameId: GAME })
  const summon = await no(call('phaseAct', tkG, { gameId: GAME, kind: 'summon', targetPlayer: n }))
  check(summon.includes('보이지 않는 동안에는'), '호출을 못 한다', summon)
  const stand = await no(call('standAt', tkG, { gameId: GAME, ...spare }))
  check(stand === '', '점령전 자체에는 참여한다 — 자리를 옮겨 섰다', stand || '섰다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
