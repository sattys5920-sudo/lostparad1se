// 바닥의 비밀 쪽지 — 줍지 않고 그 자리에서 읽기 · 찢기.
//
//   읽기: 옆 칸에서만. 문장과 「누구의 일이다」가 응답으로만 온다. 바닥에
//         그대로 남는다. 처음 한 번 slipRead 한 줄(개인 미션이 센다)
//   찢기: 그 칸에 찢긴 종이로 남아 맵에 그려진다. slipTear 한 줄
//   테이프: 비밀 쪽지도 붙인다 — 접힌 채 손에 오고, 읽으면 찢기 전 문장 그대로
//
//   npx vite-node scripts/floor-slip-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { canDropQuizAt } from '../shared/rules/quiz'
import { SLIP_NOTES } from '../functions/src/story/slipNotes'
import { of as recOf, records } from './lib/records'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/** 안 놓은 방. 여기서는 아무것도 안 보여야 한다 */
const THERE = 'artRoom'

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
  const game = `fs${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'fs' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  // 비밀 쪽지 한 장을 미술실에 뿌린다(1짝 — DAY 1 에 된다)
  const noteId = SLIP_NOTES.find((n) => n.slot === 1)?.id as string
  const put = await must('hostScatterSlip', host, { gameId: game, noteId, tileId: THERE })
  const cell = { x: Number(put.x), y: Number(put.y) }
  check(Number.isFinite(cell.x), '비밀 쪽지를 뿌렸다', `${noteId} · ${cell.x},${cell.y}`)

  const reader = 'qa02'
  const readerTok = await tok(reader)
  const readerUid = uidOf(reader)
  await must('roamTo', readerTok, { gameId: game, tileId: THERE })
  await must('tick', host, { gameId: game })
  const v0 = await viewOf(game, readerUid)
  const onMap = arr(v0.slipPapers).find((p) => str(p.id) !== null)
  const slipId = String(str(onMap?.id) ?? '')
  check(str(onMap?.kind) === 'slip', '비밀 쪽지는 봉인한 그림(slip)으로 온다', String(str(onMap?.kind)))

  const far = await call('readSlipHere', readerTok, { gameId: game, slipId })
  check(!far.ok, '떨어져서는 못 읽는다', far.ok ? '읽었다' : (far.err ?? ''))

  let stood = false
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const c = { x: cell.x + dx, y: cell.y + dy }
    if (!canDropQuizAt(c.x, c.y)) continue
    const r = await call('standAt', readerTok, { gameId: game, x: c.x, y: c.y })
    if (r.ok && (r.result as { ok?: boolean }).ok !== false) { stood = true; break }
  }
  check(stood, '쪽지 옆에 섰다')

  console.log('\n── 그 자리에서 읽기 ──')
  const read = await call('readSlipHere', readerTok, { gameId: game, slipId })
  check(read.ok && String(read.result.line ?? '').length > 0, '옆에서 읽으면 문장이 온다', read.ok ? String(read.result.line).slice(0, 30) : (read.err ?? ''))
  check(read.ok && typeof read.result.whose === 'string' && String(read.result.whose).length > 0, '「누구의 일이다」도 온다', read.ok ? String(read.result.whose) : '')
  const v1 = await viewOf(game, readerUid)
  check(arr(v1.slipPapers).some((p) => str(p.id) === slipId), '**읽어도 바닥에 그대로 있다**')
  check(arr(v1.mySlips).length === 0, '읽어도 내 손에는 안 들어온다')
  await call('readSlipHere', readerTok, { gameId: game, slipId })
  const log1 = await records(game)
  check(recOf(log1, 'slipRead', readerUid).length === 1, '**미션이 센다** — 처음 읽은 한 번만 slipRead 한 줄', `${recOf(log1, 'slipRead', readerUid).length}줄`)

  console.log('\n── 그 자리에서 찢기 ──')
  await must('tearSlipHere', readerTok, { gameId: game, slipId })
  const v2 = await viewOf(game, readerUid)
  check(!arr(v2.slipPapers).some((p) => str(p.id) === slipId), '쪽지 그림은 사라지고')
  const scrap = arr(v2.scrapPapers).find((p) => str(p.id) === slipId)
  const n = (f: unknown) => Number((f as { integerValue?: string })?.integerValue)
  check(scrap !== undefined && n(scrap.x) === cell.x && n(scrap.y) === cell.y, '**그 칸에 찢긴 종이로 남는다**')
  const log2 = await records(game)
  check(recOf(log2, 'slipTear', readerUid).length === 1, '**미션이 센다** — slipTear 한 줄(누구의 쪽지인지 적힌다)', String(recOf(log2, 'slipTear', readerUid)[0]?.ownerId ?? ''))

  console.log('\n── 테이프 ──')
  await fetch(`${FS}/games/${game}/pawns/${readerUid}?updateMask.fieldPaths=items`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { items: { mapValue: { fields: { tape: { integerValue: '1' } } } } } }),
  })
  const lineBefore = read.ok ? String(read.result.line) : ''
  const tape = await call('useItem', readerTok, { gameId: game, kind: 'tape', scrapId: slipId })
  check(tape.ok, '**비밀 쪽지도 테이프로 붙인다**', tape.ok ? '' : (tape.err ?? ''))
  const v3 = await viewOf(game, readerUid)
  check(!arr(v3.scrapPapers).some((p) => str(p.id) === slipId), '붙이면 바닥의 찢긴 종이가 사라진다')
  const held = arr(v3.mySlips).find((p) => str(p.id) === slipId)
  check(held !== undefined, '접힌 채로 내 손에 온다')
  check(str(held?.line) !== null, '이미 읽은 사람이면 붙이자마자 문장이 보인다(읽은 것은 안 잊는다)', String(str(held?.line)).slice(0, 20))
  check(str(held?.line) === lineBefore, '찢기 전 문장 그대로다')
  const log3 = await records(game)
  check(recOf(log3, 'slipRead', readerUid).length === 1, '붙여서 다시 봐도 미션 「읽기」는 한 번뿐이다')

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
