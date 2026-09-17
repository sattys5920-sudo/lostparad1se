// 생산·공부는 **페이즈에만** 한다. 진짜 서버로 본다.
//
// 자유 시간은 만나고 거래하고 이야기하는 시간이다. 거기에 값을 치르는
// 일이 섞여 있으면 「자유」가 아니라 그냥 짧은 페이즈가 된다.
// 그래서 자유 시간에 부르면 거절하고, 페이즈에서는 **팀 토큰**에서
// 빠진다 — 자유 시간용 주머니를 따로 두지 않는다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/earn-e2e.ts
import { createHash } from 'node:crypto'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { ACTION_TOKEN_COST } from '../shared/rules/actions'
import { dayHourMs } from '../shared/rules/clock'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `er${TAG}`
const PW = 'earnpass1'
const QA = 'qaearnpass1'
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
const num = (v: unknown) => Number((v as { integerValue?: string })?.integerValue ?? 0)
async function team(t: string): Promise<{ phaseTokens: number; money: number; knowledge: number }> {
  const r = await fetch(`${FS}/games/${GAME}/teams/${t}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const res = ((f.resources as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}) as Record<string, unknown>
  return { phaseTokens: num(f.phaseTokens), money: num(res.money), knowledge: num(res.knowledge) }
}
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) },
        ]),
      ),
    }),
  })
}

async function main(): Promise<void> {
  const he = `eh${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'er' })
  // **QA 봇으로 들어가지 않는다.** qa01 은 한 에뮬레이터 안에서 판을
  // 넘어 살아남아서, 비밀번호가 맨 처음 차린 판의 것으로 굳는다.
  // 사람 계정 하나를 먼저 앉히고 나머지를 봇으로 채운다 — 지금 판을
  // 차리는 길과 같은 순서다
  const id = `pl${TAG}`
  await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(id), { gameId: GAME, name: '나' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })

  const me = uidOf(id)
  const r = await fetch(`${FS}/games/${GAME}/pawns/${me}`, { headers: ADMIN })
  const myTeam = ((await r.json()) as { fields?: { team?: { stringValue?: string } } }).fields?.team?.stringValue ?? 'A'
  // 우리 땅에 서 있어야 생산한다. 전선을 기지로 옮겨 둔다 —
  // 종이 치면 서버가 전선으로 데려다 세운다
  const home = `base${myTeam}`
  await patch(`games/${GAME}/pawns/${me}`, { tileId: home, postTile: home })
  const mine = await tok(id)

  console.log('\n── 자유 시간 ──')
  const freeSaid = await no(call('produce', mine, { gameId: GAME, tileId: home }))
  check(freeSaid.includes('페이즈에만'), '자유 시간에는 생산이 거절된다', freeSaid)
  const freeStudy = await no(call('study', mine, { gameId: GAME, tileId: home }))
  check(freeStudy.includes('페이즈에만'), '자유 시간에는 공부도 거절된다', freeStudy)

  console.log('\n── 페이즈 ──')
  await call('openPhase', host, { gameId: GAME })
  const before = await team(myTeam)
  check(before.phaseTokens > 0, '팀 토큰이 들어왔다', `${before.phaseTokens}개`)

  await call('produce', mine, { gameId: GAME, tileId: home })
  const afterProduce = await team(myTeam)
  check(
    afterProduce.phaseTokens === before.phaseTokens - ACTION_TOKEN_COST.produce,
    '생산이 팀 토큰에서 빠진다',
    `${before.phaseTokens} → ${afterProduce.phaseTokens}`,
  )
  check(afterProduce.money > before.money, '돈이 늘었다', `${before.money} → ${afterProduce.money}`)

  await call('study', mine, { gameId: GAME, tileId: home })
  const afterStudy = await team(myTeam)
  check(afterStudy.knowledge > afterProduce.knowledge, '공부로 지식이 늘었다', `${afterProduce.knowledge} → ${afterStudy.knowledge}`)

  console.log('\n── 상자가 비면 ──')
  await patch(`games/${GAME}/teams/${myTeam}`, { phaseTokens: 0 })
  const empty = await no(call('produce', mine, { gameId: GAME, tileId: home }))
  check(empty.includes('팀 토큰이 모자라다'), '팀 토큰이 없으면 거절한다', empty)
  const still = await team(myTeam)
  check(still.money === afterStudy.money, '거절당하면 아무것도 안 빠지고 안 는다')

  console.log('\n── 페이즈가 닫히면 ──')
  await call('closePhase', host, { gameId: GAME })
  const shut = await no(call('produce', mine, { gameId: GAME, tileId: home }))
  check(shut.includes('페이즈에만'), '닫히면 다시 거절된다', shut)

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 실패.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
