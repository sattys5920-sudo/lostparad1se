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
import { LAB_MACHINES } from '../shared/rules/trap'
import { KNOWLEDGE_PER_RESEARCH } from '../shared/rules/occupy'
import { TILES, TILE_BY_ID, type TileId } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const TAG = String(Date.now()).slice(-6)
const GAME = `md${TAG}`
const PW = 'mdpass1234'
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
/** 그 사람 지갑의 지식. **팀 금고는 없어졌다** — 지식은 사람마다다. */
async function vault(uid: string): Promise<{ knowledge: number }> {
  const r = await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const res = (f.resources as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
  return { knowledge: Number((res.knowledge as { integerValue?: string })?.integerValue ?? 0) }
}

async function main(): Promise<void> {
  const lab = TILES.find((t) => ROOM_KIND[t.id] === 'lab') as { id: TileId }
  const he = `mh${TAG}`
  /*
   * **운영자는 이메일 계정이다.** 전에는 사람 계정을 만들고 uid 를
   * 아이디 해시로 짚어 admin 표시를 박았는데, 그 uid 가 실제 계정과
   * 안 맞아 표시가 허공에 붙었다 — createGame 이 「운영자만」으로
   * 막혔다. quiz-e2e 와 같은 길로 간다: 이메일로 가입하고 lookup 으로
   * localId 를 받아 거기에 박는다.
   */
  const email = `host-${GAME}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const host = ((await inn.json()) as { idToken: string }).idToken
  void he
  await call('createGame', host, { gameId: GAME, seed: 'md' })

  const me = `m1${TAG}`   // 연구를 거는 A팀
  const foe = `m2${TAG}`  // 훔치러 오는 B팀
  for (const id of [me, foe]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await tok(me), { gameId: GAME, name: '연구자', team: 'A' })
  await call('joinGame', await tok(foe), { gameId: GAME, name: '도둑', team: 'B' })
  /*
   * **QA 비밀번호는 모든 대본이 같은 것을 쓴다.** qa01…qa14 는 한
   * 에뮬레이터 안에서 판을 넘어 살아남고, 비밀번호는 맨 처음 만든
   * 대본의 것으로 굳는다. 이 대본만 판마다 다른 값을 넣고 있어서,
   * 이것이 먼저 돌면 drop-e2e 가 qa01 로 못 들어갔다.
   */
  await call('seedPlayers', host, { gameId: GAME, password: 'seed-password-1', leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME })
  await call('startGame', host, { gameId: GAME, startAtMs: START })
  const uMe = uidOf(me)
  const uFoe = uidOf(foe)
  const tkMe = await tok(me)
  const tkFoe = await tok(foe)

  /*
   * 둘 다 연구실에, **연구 기계 옆 칸에** 세운다. 방에 있는 것만으로는
   * 안 된다 — 연구는 기계 옆에서만 걸린다(atLabMachine). 이 대본이
   * 쓰인 뒤에 생긴 조건이라 「연구 기계 옆에 서야 한다」로 막혔다.
   * 지식도 **사람 지갑에** 준다. 팀 금고는 없어졌다.
   */
  for (const u of [uMe, uFoe]) {
    await put(`games/${GAME}/pawns/${u}`, { tileId: str(lab.id), postTile: str(lab.id) })
    await fetch(`${FS}/games/${GAME}/pawns/${u}?updateMask.fieldPaths=at&updateMask.fieldPaths=resources`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: {
        at: { mapValue: { fields: { x: { integerValue: String(LAB_MACHINES[0].x - 1) }, y: { integerValue: String(LAB_MACHINES[0].y) } } } },
        resources: { mapValue: { fields: { money: { integerValue: '20' }, knowledge: { integerValue: '20' } } } },
      } }),
    })
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
  const kAfter = (await vault(uMe)).knowledge
  check(kAfter === 20 - KNOWLEDGE_PER_RESEARCH, `지식 ${KNOWLEDGE_PER_RESEARCH}점이 걸 때 바로 빠진다`, `${kAfter}점 남았다`)

  console.log('\n── 스무 분 뒤, 본인이 그 자리에 있으면 받는다 ──')
  const nowMs = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? 0)
  await clockTo(host, nowMs + (ACT_MINUTES.research + 1) * MIN)
  check((await robotsOf('A')) === before + 1, '본인이 서 있으면 바로 받는다')
  check((await madeCount()) === 0, '주인 없는 물건은 안 생긴다')

  console.log('\n── 자리를 비우면 완성품으로 놓인다 ──')
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  const t2 = Number((await call('clockNow', host, { gameId: GAME })).nowMs ?? 0)
  // 연구자를 딴 방으로 옮겨 놓는다
  const away = TILES.find((t) => t.id !== lab.id && !t.homeOf) as { id: TileId }
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(away.id) })
  const aBefore = await robotsOf('A')
  await clockTo(host, t2 + (ACT_MINUTES.research + 1) * MIN)
  check((await robotsOf('A')) === aBefore, '본인이 없으면 못 받는다')
  check((await madeCount()) === 1, `${TILE_BY_ID[lab.id].name}에 완성품으로 놓인다`)

  console.log('\n── 페이즈 동안은 연구한 사람만 ──')
  const mine = (await list(`games/${GAME}/made`))[0]
  const madeId = mine.name.split('/').pop() as string
  const locked = await no(call('takeMade', tkFoe, { gameId: GAME, madeId }))
  check(locked.includes('연구한 사람만'), '**남의 팀은 이 페이즈 동안 못 가져간다**', locked)
  const foeView = (await list(`games/${GAME}/views`)).find((v) => v.name.endsWith(`/${uFoe}`))
  check(JSON.stringify(foeView).includes('"locked":{"booleanValue":true}'), '남에게는 잠긴 것으로 보인다')

  console.log('\n── 딴 방에서는 못 가져간다 ──')
  const far = await no(call('takeMade', tkMe, { gameId: GAME, madeId }))
  check(far.includes('그 방에 있어야'), '연구한 사람도 그 방에 있어야 가져간다', far)

  console.log('\n── 페이즈가 끝나도록 안 가져가면 누구든 — 남의 팀도 ──')
  await call('closePhase', host, { gameId: GAME })
  check((await madeCount()) === 1, '닫혀도 연구실에 그대로 놓여 있다')
  const bBefore = await robotsOf('B')
  const took = await call('takeMade', tkFoe, { gameId: GAME, madeId })
  check(took.took === true && took.mine === false, '**자유 시간에 남의 팀이 주워 간다**', String(took.said ?? ''))
  check((await robotsOf('B')) === bBefore + 1, '주운 팀의 로봇이 된다')
  check((await madeCount()) === 0, '가져가면 사라진다')
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(lab.id) })
  const again = await no(call('takeMade', tkMe, { gameId: GAME, madeId }))
  check(again.includes('그런 완성품이 없다'), '둘이 노려도 먼저 누른 쪽만 가진다', again)

  console.log('\n── 안 익은 채로 닫히면 그냥 끝 ──')
  // 앞에서 닫았다. 페이즈를 새로 연다
  await call('openPhase', host, { gameId: GAME })
  await put(`games/${GAME}/pawns/${uMe}`, { tileId: str(lab.id) })
  const kBefore = (await vault(uMe)).knowledge
  await call('phaseAct', tkMe, { gameId: GAME, kind: 'research' })
  const kPaid = (await vault(uMe)).knowledge
  check(kPaid < kBefore, '걸면서 값을 치렀다')
  const aNow = await robotsOf('A')
  await call('closePhase', host, { gameId: GAME })
  check((await robotsOf('A')) === aNow, '로봇이 안 난다')
  check((await vault(uMe)).knowledge === kPaid, '지식도 안 돌아온다', `${kPaid}점 그대로`)

  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
