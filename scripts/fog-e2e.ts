// 안개 — **몇 명 있는지는 들어가야만 안다.** 진짜 서버로 본다.
//
//   ㆍ 바로 옆 방의 남은 내 몫(view)에 **아예 안 실린다** — 머릿수도 없다
//   ㆍ 그 사람이 내 방에 들어오면 실리고 센다
//   ㆍ 내가 복도로 나서면 방 안이 안 보인다
//
// 늘 짝으로 잰다. 「안 보인다」만 재면 아무도 안 보이는 고장에도 통과한다.
//
//   npx vite-node scripts/fog-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { ADJACENCY, TILE_BY_ID, roomOfCell } from '../shared/rules/board'
import { canDropQuizAt } from '../shared/rules/quiz'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 놓을 방. 2-3 교실이라 아침에 다들 거기 서 있다 */
const HERE = 'centralPlaza'
/** 안 놓은 방. 여기서는 아무것도 안 보여야 한다 */
const THERE = 'artRoom'
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
  const email = `host-${tag}@x.test`
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
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? {}
}

/** 배열 칸 하나를 평범한 값으로. Firestore REST 는 죄다 싸서 준다 */
function arr(f: unknown): Record<string, unknown>[] {
  const v = (f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue
  return (v?.values ?? []).map((x) => x.mapValue?.fields ?? {})
}
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null

async function main() {
  const game = `fg${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'fg' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const teamOf = async (id: string) => {
    const r = await fetch(`${FS}/games/${game}/pawns/${uidOf(id)}`, { headers: ADMIN })
    const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
    return str(f.team)
  }
  const me = 'qa01'
  const meTok = await tok(me)
  const myTeam = await teamOf(me)
  // 다른 팀 한 사람. 우리 편은 어디 있든 보이므로 남이어야 잰다
  let foe = ''
  for (let i = 2; i <= 14 && !foe; i++) {
    const id = `qa${String(i).padStart(2, '0')}`
    if ((await teamOf(id)) !== myTeam) foe = id
  }
  const foeUid = uidOf(foe)
  const foeTok = await tok(foe)
  const ids = (v: Record<string, unknown>) => arr(v.visiblePawns).map((p) => str(p.playerId))
  const counts = (v: Record<string, unknown>) =>
    ((v.roomCounts as { mapValue?: { fields?: Record<string, { integerValue?: string }> } })?.mapValue?.fields ?? {})
  /** 보이는 방 이름들. 문자열 배열이라 arr()(맵 배열용)로는 못 읽는다 */
  const tiles = (v: Record<string, unknown>) =>
    ((v.visibleTiles as { arrayValue?: { values?: { stringValue?: string }[] } })?.arrayValue?.values ?? []).map(
      (x) => x.stringValue ?? '',
    )

  // 아침 판은 다들 2-3 교실(centralPlaza)에 있다. 그 이웃 하나로 보낸다
  const HOME = 'centralPlaza'
  const NEXT = ADJACENCY[HOME][0]
  console.log(`\n나 ${me}(${myTeam}팀) · 남 ${foe}(${await teamOf(foe)}팀) · 옆 방 ${TILE_BY_ID[NEXT].name}`)

  console.log('\n── 같은 방에 있으면 ──')
  let v = await viewOf(game, uidOf(me))
  check(ids(v).includes(foeUid), '같은 방의 남은 보인다')
  check(Number(counts(v)[HOME]?.integerValue ?? 0) >= 2, '내 방은 센다', counts(v)[HOME]?.integerValue ?? '없음')
  check(JSON.stringify(tiles(v)) === JSON.stringify([HOME]), '보이는 방은 내 방 하나다', tiles(v).join(','))

  console.log('\n── 남이 옆 방으로 가면 ──')
  await must('roamTo', foeTok, { gameId: game, tileId: NEXT })
  await must('tick', host, { gameId: game })
  v = await viewOf(game, uidOf(me))
  check(!ids(v).includes(foeUid), '옆 방의 남은 내 몫에 아예 없다')
  check(counts(v)[NEXT] === undefined, '옆 방 머릿수도 안 온다', JSON.stringify(counts(v)[NEXT] ?? null))
  check(!JSON.stringify(v).includes(foeUid), '문서 어디에도 그 사람 아이디가 없다')
  // 짝 — 남 쪽에서는 제가 선 방이 보인다
  const theirs = await viewOf(game, foeUid)
  check(JSON.stringify(tiles(theirs)) === JSON.stringify([NEXT]), '그 사람에게는 제 방이 보인다', tiles(theirs).join(','))

  console.log('\n── 다시 들어오면 ──')
  await must('roamTo', foeTok, { gameId: game, tileId: HOME })
  await must('tick', host, { gameId: game })
  v = await viewOf(game, uidOf(me))
  check(ids(v).includes(foeUid), '들어오면 다시 보인다')

  console.log('\n── 내가 복도로 나서면 ──')
  // 내 방 바로 바깥의 복도 칸 하나. 방 네모 둘레를 돌며 찾는다
  const p = TILE_BY_ID[HOME].plan
  let hall: { x: number; y: number } | null = null
  for (let x = p.x - 2; x <= p.x + p.w + 1 && !hall; x++)
    for (let y = p.y - 2; y <= p.y + p.h + 1 && !hall; y++) {
      if (roomOfCell(x, y) !== null) continue
      const r = await call('standAt', meTok, { gameId: game, x, y })
      if (r.ok && (r.result as { ok?: boolean }).ok !== false) hall = { x, y }
    }
  check(hall !== null, '복도 칸에 섰다', hall ? `${hall.x},${hall.y}` : '못 섰다')
  await must('tick', host, { gameId: game })
  v = await viewOf(game, uidOf(me))
  check(tiles(v).length === 0, '복도에서는 어느 방도 안 보인다', tiles(v).join(',') || '없음')
  check(counts(v)[HOME] === undefined, '방금 나온 방의 머릿수도 안 온다')
  void canDropQuizAt

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  if (bad > 0) process.exitCode = 1
}

void main()
