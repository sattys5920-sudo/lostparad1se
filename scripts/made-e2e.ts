// 연구 20분과 연구실에 놓이는 완성품. 진짜 서버로 본다.
//
//   ㆍ 걸어도 바로는 안 나온다. 스무 분이 지나야 익는다
//   ㆍ 익을 때 그 연구실에 서 있으면 **본인이 받는다**
//   ㆍ 없으면 주인이 없어지고, 먼저 온 사람이 가진다 — **남의 팀도**
//   ㆍ 둘이 노리면 먼저 누른 쪽만 가진다
//   ㆍ 안 익은 채로 페이즈가 닫히면 그냥 끝이다. 값도 안 돌아온다
//
//   npx vite-node scripts/made-e2e.ts
import { createHash } from 'node:crypto'
import { dayHourMs } from '../shared/rules/clock'
import { ACT_MINUTES, ROOM_KIND } from '../shared/rules/occupy'
import { TILES, TILE_BY_ID, type TileId } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `md${TAG}`
const PW = 'mdpass1234'
const QA = `qamd${TAG}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const MIN = 60_000

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

async function list(path: string): Promise<{ name: string; fields: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  return ((await r.json()) as { documents?: { name: string; fields: Record<string, unknown> }[] }).documents ?? []
}
async function robotsOf(team: string): Promise<number> {
  const all = await list(`games/${GAME}/robots`)
  return all.filter((d) => (d.fields.team as { stringValue?: string })?.stringValue === team).length
}
async function madeCount(): Promise<number> {
  return (await list(`games/${GAME}/made`)).length
}
async function put(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields }),
  })
}
const str = (v: string) => ({ stringValue: v })
async function clockTo(host: string, ms: number): Promise<void> {
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await call('tick', host, { gameId: GAME })
}
async function vault(team: string): Promise<{ knowledge: number }> {
  const r = await fetch(`${FS}/games/${GAME}/teams/${team}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const res = ((f.resources as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}) as Record<string, unknown>
  return { knowledge: Number((res.knowledge as { integerValue?: string })?.integerValue ?? 0) }
}

async function main(): Promise<void> {
  const lab = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as { id: TileId }
  const he = `mh${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(he), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'md' })

  const me = `m1${TAG}`   // 연구를 거는 A팀
  const foe = `m2${TAG}`  // 훔치러 오는 B팀
  for (const id of [me, foe]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(me), { gameId: GAME, name: '연구자', team: 'A' })
  await call('joinGame', await tok(foe), { gameId: GAME, name: '도둑', team: 'B' })
  await call('seedPlayers', host, { gameId: GAME, password: QA, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  const uMe = uidOf(me)
  const uFoe = uidOf(foe)
  const tkMe = await tok(me)
  const tkFoe = await tok(foe)

  // 둘 다 연구실에 세운다. 지식도 넉넉히 준다
  for (const u of [uMe, uFoe]) {
    await put(`games/${GAME}/pawns/${u}`, { tileId: str(lab.id), postTile: str(lab.id) })
  }
  await fetch(`${FS}/games/${GAME}/teams/A?updateMask.fieldPaths=resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { resources: { mapValue: { fields: { money: { integerValue: '20' }, knowledge: { integerValue: '20' } } } } },
    }),
  })
  await call('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await call('tick', host, { gameId: GAME })
  await call('openPhase', host, { gameId: GAME })

  console.log(`\n── 걸어도 바로는 안 나온다 (${ACT_MINUTES.research}분) ──`)
  const before = await robotsOf('A')
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  check((await robotsOf('A')) === before, '거는 순간에는 로봇이 안 난다')
  check((await madeCount()) === 0, '완성품도 아직 없다')
  const kAfter = (await vault('A')).knowledge
  check(kAfter < 20, '지식은 걸 때 바로 빠진다', `${kAfter}점 남았다`)

  console.log('\n── 스무 분 뒤, 본인이 그 자리에 있으면 받는다 ──')
  const nowMs = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? 0)
  await clockTo(host, nowMs + (ACT_MINUTES.research + 1) * MIN)
  check((await robotsOf('A')) === before + 1, '본인이 서 있으면 바로 받는다')
  check((await madeCount()) === 0, '주인 없는 물건은 안 생긴다')

  console.log('\n── 자리를 비우면 주인이 없어진다 ──')
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  const t2 = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? 0)
  // 연구자를 딴 방으로 옮겨 놓는다
  const away = TILES.find((t) => t.id !== lab.id && !t.homeOf) as { id: TileId }
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(away.id) })
  const aBefore = await robotsOf('A')
  await clockTo(host, t2 + (ACT_MINUTES.research + 1) * MIN)
  check((await robotsOf('A')) === aBefore, '본인이 없으면 못 받는다')
  check((await madeCount()) === 1, `${TILE_BY_ID[lab.id].name}에 주인 없이 놓인다`)

  console.log('\n── 먼저 온 사람이 가진다 — 남의 팀도 ──')
  const mine = (await list(`games/${GAME}/made`))[0]
  const madeId = mine.name.split('/').pop() as string
  const bBefore = await robotsOf('B')
  const took = await call('takeMade', tkFoe, { gameId: GAME, madeId })
  check(took.took === true && took.mine === false, '남의 팀이 주워 간다', String(took.said ?? ''))
  check((await robotsOf('B')) === bBefore + 1, '주운 팀의 로봇이 된다')
  check((await madeCount()) === 0, '가져가면 사라진다')
  const again = await no(call('takeMade', tkMe, { gameId: GAME, madeId }))
  check(again.includes('그런 완성품이 없다'), '둘이 노려도 먼저 누른 쪽만 가진다', again)

  console.log('\n── 딴 방에서는 못 가져간다 ──')
  // 아까 딴 방으로 보내 놨다. 걸려면 연구실에 서 있어야 한다
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(lab.id) })
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  const t3 = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? 0)
  // 다시 자리를 비워 주인 없는 물건이 되게 한다
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(away.id) })
  await clockTo(host, t3 + (ACT_MINUTES.research + 1) * MIN)
  const m2 = (await list(`games/${GAME}/made`))[0]
  if (m2) {
    const id2 = m2.name.split('/').pop() as string
    const far = await no(call('takeMade', tkMe, { gameId: GAME, madeId: id2 }))
    check(far.includes('그 방에 있어야'), '그 방에 있어야 가져간다', far)
  } else {
    check(false, '완성품이 또 놓였어야 한다')
  }

  console.log('\n── 안 익은 채로 닫히면 그냥 끝 ──')
  // 시계를 여러 번 밀어 한 시간이 다 갔다. 페이즈를 새로 연다
  await call('closePhase', host, { gameId: GAME })
  await call('openPhase', host, { gameId: GAME })
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(lab.id) })
  const kBefore = (await vault('A')).knowledge
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  const kPaid = (await vault('A')).knowledge
  check(kPaid < kBefore, '걸면서 값을 치렀다')
  const aNow = await robotsOf('A')
  await call('closePhase', host, { gameId: GAME })
  check((await robotsOf('A')) === aNow, '로봇이 안 난다')
  check((await vault('A')).knowledge === kPaid, '지식도 안 돌아온다', `${kPaid}점 그대로`)

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
