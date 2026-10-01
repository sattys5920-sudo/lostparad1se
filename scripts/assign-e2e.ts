// 운영자가 한 사람씩 팀과 역할을 정한다.
//
//   정하면 그 자리에 dealtAtMs 가 찍히고 그 사람 학생증(myPaper)에 역할이 뜬다
//   공개 문서에는 역할이 없다 · 고치면 다시 찍힌다
//   한 역할은 한 사람 · 팀 인원은 4 · 4 · 3 · 3 까지
//   다 정해야 시작 · 시작한 뒤에는 못 바꾼다
//   한 사람이 나가도 남의 배정은 그대로다
//
//   npx vite-node scripts/assign-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { ROLE_IDS } from '../shared/missions/roleNames'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)


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


const TEAM_OF = (i: number) => (i < 4 ? 'A' : i < 8 ? 'B' : i < 11 ? 'C' : 'D')

async function main() {
  const game = `as${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'as' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  const seatsOf = async () => ((await gameDoc(game)).seats as { playerId: string; team: string | null; dealtAtMs?: number | null }[])
  const seats = await seatsOf()
  check(seats.length === 14 && seats.every((s) => s.team === null && !s.dealtAtMs), '열넷이 앉았고 아무도 배정 전이다')

  console.log('\n── 운영자만 ──')
  const firstTok = await tok('qa01')
  const asPlayer = await call('hostAssignSeat', firstTok, { gameId: game, playerId: uidOf('qa01'), team: 'A', roleId: 'crush' })
  check(!asPlayer.ok, '보통 사람은 못 정한다', asPlayer.ok ? '정해졌다' : (asPlayer.err ?? ''))

  console.log('\n── 한 사람 ──')
  const before = await call('myPaper', firstTok, { gameId: game })
  check(!before.ok, '정하기 전에는 학생증이 없다', before.ok ? '' : (before.err ?? ''))
  await must('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa01'), team: 'A', roleId: 'crush' })
  const s1 = (await seatsOf()).find((s) => s.playerId === uidOf('qa01'))
  check(s1?.team === 'A' && typeof s1?.dealtAtMs === 'number', '자리에 팀과 「정해진 시각」이 찍힌다 — 화면이 이걸 보고 팝업을 띄운다')
  const paper1 = await call('myPaper', firstTok, { gameId: game })
  check(paper1.ok && String(paper1.result.roleId) === 'crush', '그 사람 학생증에 역할이 뜬다', paper1.ok ? String(paper1.result.roleName) : (paper1.err ?? ''))
  const other = await call('myPaper', await tok('qa02'), { gameId: game })
  check(!other.ok, '다른 사람은 아직 배정 전이다', other.ok ? '받았다' : (other.err ?? ''))
  const g1 = JSON.stringify(await gameDoc(game))
  check(!g1.includes('crush'), '**공개 문서(판)에는 역할이 없다**')

  console.log('\n── 고쳐 주기 ──')
  const stamp1 = s1?.dealtAtMs ?? 0
  await new Promise((r) => setTimeout(r, 30))
  await must('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa01'), team: 'B', roleId: 'model' })
  const s1b = (await seatsOf()).find((s) => s.playerId === uidOf('qa01'))
  check(s1b?.team === 'B' && Number(s1b?.dealtAtMs) !== stamp1, '고치면 팀이 바뀌고 시각도 새로 찍힌다 — 팝업이 다시 뜬다')
  const paper1b = await call('myPaper', firstTok, { gameId: game })
  check(paper1b.ok && String(paper1b.result.roleId) === 'model', '학생증도 바뀐 역할이다')

  console.log('\n── 막는 것 ──')
  const dup = await call('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa02'), team: 'A', roleId: 'model' })
  check(!dup.ok && (dup.err ?? '').includes('이미'), '한 역할은 한 사람 — 이미 준 역할은 못 준다', dup.ok ? '' : (dup.err ?? ''))
  const badRole = await call('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa02'), team: 'A', roleId: 'nobody' })
  check(!badRole.ok, '없는 역할은 못 준다')
  // A팀을 넷 채우고 다섯째를 넣어 본다
  for (let i = 2; i <= 5; i++) {
    await must('hostAssignSeat', host, { gameId: game, playerId: uidOf(`qa0${i}`), team: 'A', roleId: ROLE_IDS.filter((r) => r !== 'model')[i - 2] })
  }
  const over = await call('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa06'), team: 'A', roleId: ROLE_IDS.filter((r) => r !== 'model')[4] })
  check(!over.ok && (over.err ?? '').includes('다 찼다'), '팀 인원을 넘게는 못 넣는다', over.ok ? '' : (over.err ?? ''))

  console.log('\n── 시작 ──')
  const early = await call('startGame', host, { gameId: game, startAtMs: START })
  check(!early.ok, '다 정하기 전에는 시작 못 한다', early.ok ? '시작했다' : (early.err ?? ''))
  // 나머지를 정한다 — qa01 은 B · model 이다
  const used = new Set<string>(['model', ...ROLE_IDS.filter((r) => r !== 'model').slice(0, 4)])
  const left = ROLE_IDS.filter((r) => !used.has(r))
  const now = await seatsOf()
  const want: Record<string, number> = { A: 4, B: 4, C: 3, D: 3 }
  for (const s of now) if (s.team) want[s.team] -= 0
  let k = 0
  for (const s of now) {
    if (s.dealtAtMs) continue
    const team = (['A', 'B', 'C', 'D'] as const).find((t) => (now.filter((x) => x.team === t).length + 0) < { A: 4, B: 4, C: 3, D: 3 }[t]) as string
    await must('hostAssignSeat', host, { gameId: game, playerId: s.playerId, team, roleId: left[k++] })
    s.team = team
    s.dealtAtMs = 1
  }
  const all = await seatsOf()
  check(all.every((s) => s.team && s.dealtAtMs), '열넷 모두 배정됐다', `${all.filter((s) => s.dealtAtMs).length}명`)
  await must('startGame', host, { gameId: game, startAtMs: START })
  check(String((await gameDoc(game)).phase) === 'running', '운영자가 시작하면 판이 돈다')
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  const after = await call('hostAssignSeat', host, { gameId: game, playerId: uidOf('qa01'), team: 'B', roleId: 'model' })
  check(!after.ok, '시작한 뒤에는 배정을 못 바꾼다', after.ok ? '' : (after.err ?? ''))
  const paperRun = await call('myPaper', firstTok, { gameId: game })
  check(paperRun.ok && String(paperRun.result.roleId) === 'model', '판이 돌아도 정한 역할 그대로다(「나」 탭)')

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

async function gameDoc(game: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return plainOf(j.fields ?? {}) as Record<string, unknown>
}
function plainOf(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return Number(o.doubleValue)
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plainOf)
  if ('mapValue' in o) return plainOf((o.mapValue as { fields?: unknown }).fields ?? {})
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, plainOf(x)]))
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
