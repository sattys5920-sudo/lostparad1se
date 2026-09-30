// 운영자 도구 — 1위 발표 · 공지 · 투명 풀기, 그리고 복도에서는 방의 일을 못 한다.
//
//   npx vite-node scripts/host-tools-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { isHallCell, roomOfCell } from '../shared/rules/board'
import { isFixture } from '../shared/rules/fixtures'
import { isBlockedCell } from '../shared/rules/blocked'

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



async function gameDoc(game: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  return ((await r.json()) as { fields: Record<string, unknown> }).fields
}
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`patch ${path} ${r.status}`)
}
const own = (game: string, tile: string, team: string) => patch(`games/${game}/tiles/${tile}`, { ownerTeam: { stringValue: team } })
const noticesOf = async (game: string, uid: string) => arr((await viewOf(game, uid)).notices).map((n) => ({ text: str(n.text) ?? '', leader: arr(n.leader).length > 0 || JSON.stringify(n.leader ?? '').includes('A') ? n.leader : undefined }))
const cellVal = (c: { x: number; y: number }) => ({ mapValue: { fields: { x: { integerValue: String(c.x) }, y: { integerValue: String(c.y) } } } })

function findCell(pred: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let y = 0; y < 200; y++) for (let x = 0; x < 120; x++) if (pred(x, y) && !isFixture(x, y) && !isBlockedCell(x, y)) return { x, y }
  throw new Error('칸을 못 찾았다')
}

async function main() {
  const game = `ht${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'ht' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const seats = arr((await gameDoc(game)).seats).map((s) => ({ id: str(s.playerId) as string, name: str(s.name) as string, team: str(s.team) as string }))
  const a0 = seats.find((s) => s.team === 'A') as { id: string; name: string; team: string }
  const b0 = seats.find((s) => s.team === 'B') as { id: string; name: string; team: string }
  const qaIdOf = async (uid: string) => {
    for (let i = 1; i <= 14; i++) {
      const id = `qa${String(i).padStart(2, '0')}`
      if (uidOf(id) === uid) return id
    }
    throw new Error('계정 이름을 못 찾았다')
  }
  const aTok = await tok(await qaIdOf(a0.id))

  console.log('\n── 1위 발표 ──')
  const early = await call('hostAnnounceLeader', host, { gameId: game })
  check(!early.ok && (early.err ?? '').includes('방을 가진 분단이 없다'), '방이 하나도 없으면 발표할 것이 없다', early.ok ? '발표됐다' : early.err)
  const byPlayer = await call('hostAnnounceLeader', aTok, { gameId: game })
  check(!byPlayer.ok, '보통 사람은 발표 못 한다')
  await own(game, 'library', 'A')
  await own(game, 'gym', 'A')
  await own(game, 'storage', 'B')
  const one = await must('hostAnnounceLeader', host, { gameId: game })
  check(String(one.text) === '지금 1위는 2분단입니다. 방 2개.', '한 팀이 1위면 그 팀과 방 수', String(one.text))
  const bSees = await noticesOf(game, b0.id)
  check(bSees.some((n) => n.text === '지금 1위는 2분단입니다. 방 2개.'), '**누르자마자 모두의 몫에 들어간다** — 다른 팀 사람에게도')
  const rawLeader = arr((await viewOf(game, b0.id)).notices).find((n) => str(n.text)?.startsWith('지금 1위'))
  check(JSON.stringify(rawLeader?.leader ?? null).includes('"A"'), '1위 팀이 함께 실린다(팀 색 그림용)', JSON.stringify(rawLeader?.leader ?? null))
  await own(game, 'artRoom', 'B')
  const tie = await must('hostAnnounceLeader', host, { gameId: game })
  check(String(tie.text) === '지금 공동 1위는 1분단 · 2분단입니다. 방 2개씩.', '동점이면 공동 1위', String(tie.text))

  console.log('\n── 공지 ──')
  await must('hostNotice', host, { gameId: game, text: '한 사람에게만', toPlayerId: a0.id })
  check((await noticesOf(game, a0.id)).some((n) => n.text === '한 사람에게만'), '받는 사람 몫에 바로 들어간다')
  check(!(await noticesOf(game, b0.id)).some((n) => n.text === '한 사람에게만'), '다른 사람에게는 안 간다')
  await must('hostNotice', host, { gameId: game, text: '모두에게', toPlayerId: null })
  check((await noticesOf(game, b0.id)).some((n) => n.text === '모두에게'), '전원 공지는 모두에게')

  console.log('\n── 투명 풀기 ──')
  await patch(`games/${game}`, { invisibleId: { stringValue: b0.id }, invisibleTeam: { stringValue: 'B' } })
  const noWhy = await call('clearInvisible', host, { gameId: game, reason: '' })
  check(!noWhy.ok, '까닭 없이는 못 푼다')
  const byP = await call('clearInvisible', aTok, { gameId: game, reason: '장난' })
  check(!byP.ok, '보통 사람은 못 푼다')
  await must('clearInvisible', host, { gameId: game, reason: '힘들어했다' })
  check(str((await gameDoc(game)).invisibleId) === null, '**풀렸다**')
  const bN = await noticesOf(game, b0.id)
  check(bN.some((n) => n.text.includes('다시 보인다')), '본인에게 「다시 보인다」가 간다')
  check(!bN.some((n) => n.text.includes('힘들어했다')), '까닭은 본인에게도 안 간다')
  check(!(await noticesOf(game, a0.id)).some((n) => n.text.includes('다시 보인다')), '다른 사람에게는 안 간다')

  console.log('\n── 복도에 서서는 방의 일을 못 한다 ──')
  await must('openPhase', host, { gameId: game })
  const hall = findCell((x, y) => isHallCell(x, y) && roomOfCell(x, y) === null)
  const inLib = findCell((x, y) => roomOfCell(x, y) === 'library')
  await patch(`games/${game}/pawns/${a0.id}`, { tileId: { stringValue: 'library' }, at: cellVal(hall) })
  const outside = await call('phaseAct', aTok, { gameId: game, kind: 'plant' })
  check(!outside.ok && (outside.err ?? '').includes('방 안에'), '**복도에서 깃발을 못 꽂는다**', outside.ok ? '꽂혔다' : outside.err)
  await patch(`games/${game}/pawns/${a0.id}`, { at: cellVal(inLib) })
  const inside = await call('phaseAct', aTok, { gameId: game, kind: 'plant' })
  check(inside.ok, '방 안에 서면 꽂는다', inside.ok ? '' : inside.err)

  console.log(bad === 0 ? '\n다 맞았다.' : `\n어긋난 것 ${bad}개.`)
  if (bad > 0) process.exitCode = 1
}

void main()
