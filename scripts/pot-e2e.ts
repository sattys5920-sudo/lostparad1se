// 토큰은 **페이즈가 열릴 때만** 찬다. 진짜 서버로 본다.
//
//   ㆍ 시간이 흘러도 자유 시간에는 한 개도 안 는다
//   ㆍ 페이즈가 열리면 인원수만큼 들어온다
//   ㆍ 상점 구매와 두 투표는 **페이즈 중에도** 된다
//
//   npx vite-node scripts/pot-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'

/** 매점. 옛 이름은 상점 — 여기서는 그냥 방 하나가 필요했다 */
const MART_TILE = 'classroom'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `pt${TAG}`
const PW = 'ptpass1234'
const QA = `qapt${TAG}`
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
async function teamBox(t: string) {
  const r = await fetch(`${FS}/games/${GAME}/teams/${t}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  return {
    phaseTokens: Number((f.phaseTokens as { integerValue?: string })?.integerValue ?? 0),
    /** 걷어낸 옛 주머니. 아예 없어야 한다 */
    oldPot: f.tokens !== undefined,
  }
}
async function put(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields }),
  })
}
async function clockTo(host: string, ms: number): Promise<void> {
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await call('tick', host, { gameId: GAME })
}

async function main(): Promise<void> {
  const he = `ph${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'pt' })

  const me = `p1${TAG}`
  const you = `p2${TAG}`
  for (const id of [me, you]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(me), { gameId: GAME, name: '나', team: 'A' })
  await call('joinGame', await tok(you), { gameId: GAME, name: '너', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  const uMe = uidOf(me)
  const uYou = uidOf(you)
  const tkMe = await tok(me)

  console.log('\n── 걷어낸 옛 주머니 ──')
  const box0 = await teamBox('A')
  check(!box0.oldPot, '팀 문서에 시간마다 차던 주머니가 없다')
  const potDocs = await fetch(`${FS}/games/${GAME}/secret/tokens/items`, { headers: ADMIN })
  const potBody = (await potDocs.json()) as { documents?: unknown[] }
  check((potBody.documents ?? []).length === 0, 'secret/tokens 도 안 만든다')

  console.log('\n── 자유 시간에는 한 개도 안 는다 ──')
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })
  const before = (await teamBox('A')).phaseTokens
  // 다섯 시간을 흘려보낸다. 옛 규칙이면 시간마다 찼을 자리다
  await clockTo(host, dayHourMs(START, 1, 15))
  const after = (await teamBox('A')).phaseTokens
  check(after === before, '다섯 시간이 지나도 그대로다', `${before} → ${after}`)

  console.log('\n── 페이즈가 열릴 때 찬다 ──')
  await call('openPhase', host, { gameId: GAME })
  const opened = (await teamBox('A')).phaseTokens
  check(opened > after, '종이 치면 들어온다', `${after} → ${opened}`)

  console.log('\n── 상점 구매는 페이즈 중에도 된다 ──')
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: { stringValue: MART_TILE } })
  const shop = await fetch(`${FS}/games/${GAME}/tiles/${MART_TILE}`, { headers: ADMIN })
  void shop
  const bought = await no(call('buyShopItem', tkMe, { gameId: GAME, itemId: 'whistle' }))
  check(!bought.includes('페이즈'), '페이즈라고 거절하지 않는다', bought || '샀다')

  console.log('\n── 두 투표도 페이즈 중에 된다 ──')
  const ballot = await no(call('castBallot', tkMe, { gameId: GAME, targetId: uYou }))
  check(!ballot.includes('페이즈'), '투명인간 투표가 열려 있다', ballot || '적었다')
  // 신뢰표는 마주 서야 준다. 같은 자리에 세워 놓고 본다
  await put(`games/${GAME}/pawns/${uYou}`, { tileId: { stringValue: MART_TILE } })
  const trust = await no(call('castVote', tkMe, { gameId: GAME, targetId: uYou, kind: 'trust' }))
  check(!trust.includes('페이즈'), '신뢰·호감표도 열려 있다', trust || '줬다')

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
