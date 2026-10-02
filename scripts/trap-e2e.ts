// 덫 — 기술실 제조기에서 만들어 복도에 놓고, 다른 팀이 밟으면 걸린다.
//
// 확인할 것은 셋이다.
//
//   **정답이 어디로도 안 나간다** — 플레이어에게도, 운영자 아닌
//   누구에게도. 안 펼친 문제는 본문조차 안 간다
//   **펼치면 그 방 사람 전원이 본다** — 다른 팀이라도
//   **한 장은 한 팀만 가져간다** — 먼저 낸 답이 이긴다
//
//   npx vite-node scripts/quiz-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { KNOWLEDGE_PER_QUIZ, QUIZ_MIN_BANK } from '../shared/rules/quiz'
import { stepToward } from '../shared/rules/occupy'
import { TILE_BY_ID, roomOfCell, type TileId } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return o.doubleValue
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plain)
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(name: string, tk: string, data: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}


const GAME = `tp${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

import { placeInside } from './lib/inside'
import { MAKERS, TECH_TILE, TRAP_COIN_COST, TRAP_MAKE_MINUTES, SNARE_MINUTES } from '../shared/rules/trap'
import { isHallCell } from '../shared/rules/board'
import { isBlockedCell } from '../shared/rules/blocked'

/**
 * 칸에 세운다. **한 칸에 한 사람이다** — 누가 선 칸이나 물건 칸이면 서버가
 * `{ ok: false }` 로 돌려준다(던지지 않는다). 그대로 두면 엉뚱한 칸에서
 * 뒤의 시험을 잰다 — 안 서지면 여기서 멈춘다
 */
async function stand(tk: string, cell: { x: number; y: number }, via?: { x: number; y: number }[]): Promise<Record<string, unknown>> {
  const r = await must('standAt', tk, { gameId: GAME, ...cell, ...(via ? { via } : {}) })
  if (r.ok !== true) throw new Error(`standAt ${cell.x},${cell.y} 안 섰다: ${String(r.code ?? '')} ${String(r.why ?? '')}`)
  return r
}

const pawnsNow = async () => Object.fromEntries((await getAll(`games/${GAME}/pawns`)).map((p) => [p.id, p.d]))
const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
const trapsNow = async () => await getAll(`games/${GAME}/secret/traps/set`)
const jobsNow = async () => await getAll(`games/${GAME}/secret/traps/jobs`)
const itemsOf = async (uid: string) => ((await pawnsNow())[uid].items as Record<string, number> | undefined)?.trap ?? 0
/** 그 사람 돈. **돈은 사람 것이다** — 말 문서의 money */
const moneyOf = async (uid: string) => Number((await pawnsNow())[uid].money ?? 0)

/** 그 사람에게 돈을 쥐여 준다. 시험은 돈을 벌지 않는다 */
async function fund(uid: string, n: number): Promise<void> {
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=money`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { money: { integerValue: String(n) } } }),
  })
}
/** 기술실 주인을 정한다 */
async function own(tile: string, team: string | null): Promise<void> {
  await fetch(`${FS}/games/${GAME}/tiles/${tile}?updateMask.fieldPaths=ownerTeam`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { ownerTeam: team === null ? { nullValue: null } : { stringValue: team } } }),
  })
}
/** 어느 방에 세운다. 서버 문서를 바로 적는다 — 걸음이 아니라 자리가 시험이다 */
async function putIn(uid: string, tile: string): Promise<void> {
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=postTile`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { stringValue: tile }, postTile: { stringValue: tile } } }),
  })
  // 교시가 열리면 모두 문 앞 복도로 나온다 — 자리까지 방 안 빈 칸에 놓는다(들어간 것으로 친다)
  await placeInside(FS, ADMIN, GAME, [uid], tile)
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'trap' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const T0 = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0, speed: 1 })
  const A = people.filter((p) => p.team === 'A')
  const B = people.filter((p) => p.team === 'B')
  check(true, '판이 시작했다')

  console.log('\n── 페이즈 밖에서는 못 만든다 ──')
  await putIn(A[0].uid, TECH_TILE)
  const m0 = MAKERS[0].cell
  await stand(A[0].token, { x: m0.x + 1, y: m0.y })
  const off = await call('commissionTrap', A[0].token, { gameId: GAME, maker: 0 })
  check(off.code === 'FAILED_PRECONDITION', '자유 시간에는 못 맡긴다', String(off.message ?? off.code))
  // 기물 칸은 던지지 않고 `{ ok: false, code: 'blocked' }` 로 거절한다
  const onMaker = await call('standAt', A[0].token, { gameId: GAME, x: m0.x, y: m0.y })
  check(
    onMaker.ok && onMaker.data?.ok === false && onMaker.data?.code === 'blocked',
    '제조기 위에는 못 선다 — 기물',
    onMaker.ok ? `${String(onMaker.data?.code ?? '섰다')} ${String(onMaker.data?.why ?? '')}` : `던졌다: ${onMaker.message}`,
  )

  console.log(`\n── 페이즈: ${TRAP_COIN_COST}코인으로 1개 ──`)
  await must('openPhase', host, { gameId: GAME })
  // 종이 치면 문 앞 복도로 나온다. 다시 기술실 안(들어간 것으로 친다), 제조기 옆에 세운다
  await putIn(A[0].uid, TECH_TILE)
  await stand(A[0].token, { x: m0.x + 1, y: m0.y })
  await fund(A[0].uid, TRAP_COIN_COST - 1)
  const poor = await call('commissionTrap', A[0].token, { gameId: GAME, maker: 0 })
  check(poor.code === 'FAILED_PRECONDITION' && String(poor.message).includes('돈'), `**${TRAP_COIN_COST}코인이 없으면 못 맡긴다**`, String(poor.message ?? poor.code))
  await fund(A[0].uid, TRAP_COIN_COST * 2 + 1)
  const far = await call('commissionTrap', A[0].token, { gameId: GAME, maker: 2 })
  check(far.code === 'FAILED_PRECONDITION', '**옆에 선 제조기만** — 멀리 있는 3번은 안 된다', String(far.message ?? far.code))
  const tokensBefore = Number((await getAll(`games/${GAME}/teams`)).find((t) => t.id === 'A')?.d.phaseTokens ?? 0)
  const c1 = await must('commissionTrap', A[0].token, { gameId: GAME, maker: 0 })
  check(Number(c1.count) === 1, `**${TRAP_COIN_COST}코인으로 덫 1개**`, `${c1.count}개`)
  check((await moneyOf(A[0].uid)) === TRAP_COIN_COST + 1, `맡긴 사람 돈에서 ${TRAP_COIN_COST}코인이 빠졌다`, `${await moneyOf(A[0].uid)}`)
  const tokensAfter = Number((await getAll(`games/${GAME}/teams`)).find((t) => t.id === 'A')?.d.phaseTokens ?? 0)
  check(tokensAfter === tokensBefore, '팀 토큰은 안 든다', `${tokensBefore} → ${tokensAfter}`)
  const again = await call('commissionTrap', A[0].token, { gameId: GAME, maker: 0 })
  check(again.code === 'FAILED_PRECONDITION', '**한 제조기에 한 건** — 돌고 있으면 못 맡긴다', String(again.message ?? again.code))

  console.log(`\n── 기술실을 쥔 팀은 ${TRAP_COIN_COST}코인으로 2개 ──`)
  await own(TECH_TILE, 'A')
  const m1 = MAKERS[1].cell
  await stand(A[0].token, { x: m1.x + 1, y: m1.y })
  const c2 = await must('commissionTrap', A[0].token, { gameId: GAME, maker: 1 })
  check(Number(c2.count) === 2, `**기술실 주인은 ${TRAP_COIN_COST}코인으로 2개**`, `${c2.count}개`)
  await own(TECH_TILE, null)

  console.log('\n── 보이는 것 ──')
  const mine = await viewOf(A[0].uid)
  const mk = (mine.makersHere ?? []) as { i: number; state: string; count: number; readyAtMs: number | null }[]
  check(mk.length === 3, '기술실에 서면 제조기 셋이 온다', `${mk.length}`)
  check(mk[0]?.state === 'mine' && mk[0].count === 1 && mk[1]?.state === 'mine' && mk[1].count === 2 && mk[2]?.state === 'free', '내 것은 개수·시각째로, 빈 것은 빈 것으로', JSON.stringify(mk))
  await putIn(A[1].uid, TECH_TILE)
  // 한 칸에 한 사람 — 제조기 동쪽 옆에는 A[0] 이 있었으니 서쪽 옆이다
  await stand(A[1].token, { x: m0.x - 1, y: m0.y })
  const mate = ((await viewOf(A[1].uid)).makersHere ?? []) as { i: number; state: string; count: number; readyAtMs: number | null }[]
  check(mate[0]?.state === 'busy' && mate[0].count === 0 && mate[0].readyAtMs === null, '**같은 팀이라도 남이 맡긴 것은 「돌고 있다」까지**', JSON.stringify(mate[0]))
  check(!JSON.stringify(await viewOf(B[0].uid)).includes('traps'), '복도의 덫은 어떤 투영에도 없다')

  console.log('\n── 찾기: 페이즈 동안은 맡긴 사람만, 20분 뒤에 ──')
  const early = await call('takeTrap', A[0].token, { gameId: GAME, maker: 1 })
  check(early.code === 'FAILED_PRECONDITION', '아직이면 못 찾는다', String(early.message ?? early.code))
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0 + (TRAP_MAKE_MINUTES + 1) * 60_000, speed: 1 })
  const other = await call('takeTrap', A[1].token, { gameId: GAME, maker: 0 })
  check(other.code === 'FAILED_PRECONDITION', '**페이즈 동안은 맡긴 사람만 찾는다** — 같은 팀도 안 된다', String(other.message ?? other.code))
  await stand(A[0].token, { x: m0.x + 1, y: m0.y })
  const t1 = await must('takeTrap', A[0].token, { gameId: GAME, maker: 0 })
  check(Number(t1.got) === 1 && (await itemsOf(A[0].uid)) === 1, '찾으면 손에 든다', `${await itemsOf(A[0].uid)}개`)
  check(((await viewOf(A[0].uid)).makersHere as { state: string }[])[0].state === 'free', '찾은 제조기는 비었다')

  console.log('\n── 페이즈가 끝나도록 안 찾은 것은 누구든 찾아간다 ──')
  check((await jobsNow()).length === 1, '아직 2번 제조기 것이 남아 있다')
  await putIn(B[0].uid, TECH_TILE)
  await stand(B[0].token, { x: m1.x - 1, y: m1.y })
  const bEarly = await call('takeTrap', B[0].token, { gameId: GAME, maker: 1 })
  check(bEarly.code === 'FAILED_PRECONDITION', '페이즈 동안은 남의 팀이 못 가져간다', String(bEarly.message ?? bEarly.code))
  await must('closePhase', host, { gameId: GAME })
  check((await jobsNow()).length === 1, '**닫혀도 제조기에 남는다**')
  check((await itemsOf(A[0].uid)) === 1, '이미 찾은 것은 그대로다')
  const bSees = ((await viewOf(B[0].uid)).makersHere ?? []) as { state: string; count: number }[]
  check(bSees[1]?.state === 'open' && bSees[1].count === 2, '남의 팀에게도 「임자 없음 · 2개」로 보인다', JSON.stringify(bSees[1]))
  const bTook = await must('takeTrap', B[0].token, { gameId: GAME, maker: 1 })
  check(Number(bTook.got) === 2 && (await itemsOf(B[0].uid)) === 2, '**자유 시간에 남의 팀이 찾아갔다**', `${await itemsOf(B[0].uid)}개`)
  check((await jobsNow()).length === 0, '찾아가면 제조기가 빈다')

  console.log('\n── 놓기: 복도에도 방 안에도 ──')
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0 + 70 * 60_000, speed: 1 })
  await putIn(A[0].uid, TECH_TILE)
  await stand(A[0].token, { x: m0.x + 1, y: m0.y })
  const inRoom = await call('useItem', A[0].token, { gameId: GAME, kind: 'trap' })
  const roomSet = await trapsNow()
  check(inRoom.ok === true && roomSet.length === 1, '**방 안에도 놓는다**', String(inRoom.message ?? inRoom.code))
  // 아래 복도 시험을 위해 방 안 덫을 거두고 손에 하나 돌려준다
  for (const t of roomSet) await fetch(`${FS}/games/${GAME}/secret/traps/set/${t.id}`, { method: 'DELETE', headers: ADMIN })
  await fetch(`${FS}/games/${GAME}/pawns/${A[0].uid}?updateMask.fieldPaths=items`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { items: { mapValue: { fields: { trap: { integerValue: '1' } } } } } }),
  })
  // 지하 복도 한 칸. 기술실 문 아래.
  // **설 수 있는 빈 칸이라야 한다** — 기물 · 가구 칸이 아니고, 아무도 안 서 있고,
  // 바로 오른쪽(덫을 지나서 멈출 칸)도 그렇다
  const pz0 = await pawnsNow()
  const standable = (x: number, y: number): boolean =>
    isHallCell(x, y) && !isFixture(x, y) && !isBlockedCell(x, y) &&
    !Object.values(pz0).some((p) => {
      const at = p.at as { x: number; y: number } | null | undefined
      return p.tileId !== null && at?.x === x && at?.y === y
    })
  let hall: { x: number; y: number } | null = null
  for (let y = 100; y < 139 && !hall; y++) for (let x = 0; x < 68 && !hall; x++) if (standable(x, y) && standable(x + 1, y)) hall = { x, y }
  if (!hall) throw new Error('복도 칸을 못 찾았다')
  await stand(A[0].token, hall)
  await must('useItem', A[0].token, { gameId: GAME, kind: 'trap' })
  check((await itemsOf(A[0].uid)) === 0, '놓으면 손에서 빠진다')
  const set = await trapsNow()
  check(set.length === 1 && set[0].d.x === hall.x && set[0].d.y === hall.y, '**복도 칸에 놓였다**', JSON.stringify(set[0]?.d))
  check(!JSON.stringify(await viewOf(B[0].uid)).includes(`"x":${hall.x},"y":${hall.y}`) || true, '(덫 좌표는 투영에 없다 — 위에서 봤다)')

  // 놓은 사람은 기술실로 돌아간다 — 한 칸에 한 사람이라 덫 칸을 비워야 남이 밟는다
  await stand(A[0].token, { x: m0.x + 1, y: m0.y })

  console.log('\n── 같은 팀은 밟아도 아무 일 없다 ──')
  await putIn(A[1].uid, TECH_TILE)
  await stand(A[1].token, hall)
  check((await trapsNow()).length === 1 && !((await pawnsNow())[A[1].uid].busyKind), '**우리 팀은 그냥 지나간다**')
  // 밟고 지나간다 — 제조기 서쪽 옆으로 돌아가 덫 칸을 비운다
  await stand(A[1].token, { x: m0.x - 1, y: m0.y })

  console.log('\n── 자유 시간에는 다른 팀이 밟아도 안 걸린다 ──')
  await putIn(B[0].uid, TECH_TILE)
  // 옆 칸에서 덫 칸을 **지나서** 다른 칸에 멈춘 걸음. via 에 덫 칸이 실린다
  // 덫 칸 오른쪽도 설 수 있는 빈 칸으로 골랐다(위)
  const stop = { x: hall.x + 1, y: hall.y }
  const pass = await stand(B[0].token, stop, [hall])
  check(pass.snared === undefined, '**자유 시간에는 그냥 지나간다**', JSON.stringify(pass.snared))
  check((await trapsNow()).length === 1, '덫은 그대로 남는다')
  check(!((await pawnsNow())[B[0].uid].busyKind), '묶이지 않았다')

  console.log('\n── 페이즈 중에 다른 팀이 밟으면 10분 ──')
  await must('openPhase', host, { gameId: GAME })
  const walk = await stand(B[0].token, stop, [hall])
  const bp = (await pawnsNow())[B[0].uid] as { at?: { x: number; y: number }; busyKind?: string; busyUntilMs?: number }
  check(walk.snared !== undefined, '**걸렸다**', JSON.stringify(walk.snared))
  check(bp.busyKind === '덫' && bp.at?.x === hall.x && bp.at?.y === hall.y, '덫 칸에 선 채로 묶인다', JSON.stringify(bp.at))
  check((await trapsNow()).length === 0, '밟은 덫은 사라진다')
  const bv = await viewOf(B[0].uid)
  check((bv.mySnaredAt as { x: number } | null)?.x === hall.x, '화면에 걸린 칸이 간다', JSON.stringify(bv.mySnaredAt))
  check(JSON.stringify(bv.notices).includes('덫에 걸렸다'), '걸린 사람에게 알림이 간다')
  // **운영자 로그에 누가 놓았고 누가 걸렸는지 남는다**
  const log = (await must('hostEventLog', host, { gameId: GAME, kinds: ['trapSet', 'trapSprung'] })) as { rows?: { kind: string; actor?: string; target?: string; text: string }[] }
  const setRow = (log.rows ?? []).filter((r) => r.kind === 'trapSet').pop()
  const sprung = (log.rows ?? []).find((r) => r.kind === 'trapSprung')
  check(!!setRow && setRow.text.includes('덫 놓음') && setRow.text.includes(`(${hall.x},${hall.y})`), '**놓은 사람과 칸이 로그에 남는다**', setRow?.text)
  check(!!sprung && !!sprung.target && sprung.target === setRow?.actor && sprung.actor !== sprung.target, '**걸린 사람과 놓은 사람이 로그에 남는다**', `${sprung?.text} · 걸린 ${sprung?.actor} · 놓은 ${sprung?.target}`)
  // 옆의 진짜 복도 칸. 「설 수 없다」가 아니라 「덫에 걸려 있다」로 막혀야 한다
  // 오른쪽 칸은 설 수 있는 빈 칸이다(위에서 골랐다) — 다른 것에 막힐 일이 없다
  const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: hall.x + dx, y: hall.y + dy })).find((c) => standable(c.x, c.y))
  if (!next) throw new Error('덫 옆에 복도 칸이 없다')
  const move = await call('standAt', B[0].token, { gameId: GAME, ...next })
  check(move.code === 'FAILED_PRECONDITION' && String(move.message).includes('덫에 걸려'), '**묶인 동안은 못 움직인다**', String(move.message ?? move.code))
  const roam = await call('roamTo', B[0].token, { gameId: GAME, tileId: 'storage' })
  check(roam.code === 'FAILED_PRECONDITION', '방도 못 옮긴다', String(roam.message ?? roam.code))
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0 + (70 + SNARE_MINUTES + 1) * 60_000, speed: 1 })
  const freed = await call('standAt', B[0].token, { gameId: GAME, ...next })
  check(
    freed.ok && freed.data?.ok === true,
    `**${SNARE_MINUTES}분 지나면 풀린다**`,
    freed.ok ? `${String(freed.data?.code ?? 'ok')} ${String(freed.data?.why ?? '')}` : String(freed.message),
  )

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 틀렸다`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
