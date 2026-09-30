// 쪽지 56장을 진짜 서버로.
//
// 운영자가 방을 골라 뿌리고, 사람이 줍고 · 읽고 · 두고 · 찢는다. 확인할 것:
//
//   - 뿌리기 · 회수 · 무작위 · 2짝은 DAY 3 전에 한 번 더
//   - {이름}은 **읽는 순간** 그 역할을 받은 사람 이름으로 바뀌어 온다
//   - 읽기 전에는 문장도 주인도 안 온다. 원문 틀 · roleKey · 쪽지 번호는 누구에게도 안 간다
//   - 찢으면 끝이다. 테이프로도 못 붙인다
//
//   npx vite-node scripts/slip-e2e.ts
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID } from '../shared/rules/board'

import { canStandAt, roomOfCell } from '../shared/rules/board'
import { SLIP_NOTES } from '../functions/src/story/slipNotes'
import { ROLE_IDS } from '../shared/missions/roleNames'
import { fillSubject } from '../shared/reveal/slips'

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

const GAME = `sl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const viewOf = async (uid: string) => (await getAll(`games/${GAME}/views`)).find((v) => v.id === uid)?.d ?? {}
/** 서버만 보는 쪽지 전부. 시험이 판을 짜는 데만 쓴다. */
const allSlips = async () => await getAll(`games/${GAME}/secret/slips/items`)

type Note = { id: string; roleKey: string; pair: number; kind: string; state: string; slipId: string | null; room: string | null; holder: string | null; placedDay: number | null; everHeld: boolean; text: string }
const board = async (host: string) => (await must('hostSlipBoard', host, { gameId: GAME })) as { day: number; notes: Note[] }
const noteOf = async (host: string, id: string) => (await board(host)).notes.find((n) => n.id === id) as Note
const slipDoc = async (slipId: string) => (await allSlips()).find((s) => s.id === slipId)?.d as Record<string, unknown>

async function setDay(day: number): Promise<void> {
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=day`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { day: { integerValue: String(day) } } }),
  })
}
/** 쪽지 옆 빈 칸에 세운다 — 방을 먼저 옮겨 두고 칸을 짚는다 */
async function standBeside(token: string, uid: string, x: number, y: number): Promise<boolean> {
  const room = roomOfCell(x, y) as string
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=postTile`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { stringValue: room }, postTile: { stringValue: room } } }),
  })
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const c = { x: x + dx, y: y + dy }
    if (!canStandAt(c.x, c.y) || roomOfCell(c.x, c.y) !== room) continue
    if ((await call('standAt', token, { gameId: GAME, x: c.x, y: c.y })).ok) return true
  }
  return false
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'notes' })
  const people: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${i}` })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  const early = await call('hostSlipBoard', host, { gameId: GAME })
  check(early.ok && (early.data?.assigned as boolean) === false, '배정 전 — 판은 보이지만 역할이 안 나뉘었다')
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const roster = await getAll(`games/${GAME}/secret/roster/items`)
  const holderOf = (roleKey: string) => people.find((p) => p.uid === roster.find((r) => r.d.roleId === roleKey)?.id) as (typeof people)[number]
  check(true, '판이 시작했다')

  console.log('\n── 배포판 ──')
  const b0 = await board(host)
  check(b0.notes.length === 56, '56장', `${b0.notes.length}`)
  check(b0.notes.every((n) => n.state === 'waiting'), '처음에는 전부 대기')
  check(b0.notes.every((n) => !n.text.includes('{이름}')), '운영자 전문에도 {이름}이 실제 이름으로 바뀌어 있다')
  const byPlayer = await call('hostSlipBoard', people[0].token, { gameId: GAME })
  check(!byPlayer.ok, '**보통 사람은 배포판을 못 본다**', byPlayer.code)

  console.log('\n── 한 장 뿌리기 ──')
  const N1 = 'r04-p1-name'
  const owner = holderOf('deskmate')
  const put = await must('hostScatterSlip', host, { gameId: GAME, noteId: N1, tileId: 'library' })
  check(put.where === TILE_BY_ID.library.name, '고른 방에 뿌렸다', String(put.where))
  const n1 = await noteOf(host, N1)
  check(n1.state === 'placed' && n1.room === 'library' && n1.placedDay === 1, '상태: 뿌림(도서관)', `${n1.state} ${n1.room}`)
  const again = await call('hostScatterSlip', host, { gameId: GAME, noteId: N1, tileId: 'library' })
  check(again.code === 'FAILED_PRECONDITION', '같은 쪽지를 두 번 못 뿌린다', again.message)
  const base = await call('hostScatterSlip', host, { gameId: GAME, noteId: 'r05-p1-role', tileId: 'centralPlaza' })
  check(base.code === 'INVALID_ARGUMENT', '2-3 교실에는 못 뿌린다', base.message)
  const doc1 = await slipDoc(n1.slipId as string)
  check(!String(n1.slipId).startsWith('r0'), '**쪽지 문서 번호에 역할 번호가 없다**', String(n1.slipId))
  check(roomOfCell(Number(doc1.x), Number(doc1.y)) === 'library', '그 방 안의 빈 칸에 놓였다', `${doc1.x},${doc1.y}`)
  check(doc1.subjectId === owner.uid, '**주인은 그 역할을 받은 사람이다**')

  console.log('\n── 2짝은 DAY 3부터 ──')
  const p2 = await call('hostScatterSlip', host, { gameId: GAME, noteId: 'r07-p2-role', tileId: 'gym' })
  check(p2.code === 'FAILED_PRECONDITION' && String(p2.message).includes('DAY 3'), 'DAY 1 에 2짝은 막힌다', p2.message)
  const p2ok = await call('hostScatterSlip', host, { gameId: GAME, noteId: 'r07-p2-role', tileId: 'gym', confirmEarly: true })
  check(p2ok.ok, '한 번 더 확인하면 뿌린다')
  const rand = await must('hostScatterRandom', host, { gameId: GAME, n: 6 })
  const b1 = await board(host)
  const today = b1.notes.filter((n) => n.placedDay === 1)
  const perRole = new Map<string, number>()
  for (const n of today) perRole.set(n.roleKey, (perRole.get(n.roleKey) ?? 0) + 1)
  const doneIds = ((rand.done as { noteId: string }[]) ?? []).map((d) => d.noteId)
  check(Number(rand.scattered) === 6, '무작위 6장', String(rand.scattered))
  check(doneIds.every((id) => id.includes('-p1-')), '무작위는 DAY 3 전에 2짝을 안 고른다', doneIds.join(','))
  check(doneIds.every((id) => (perRole.get(SLIP_NOTES.find((x) => x.id === id)?.roleKey ?? '') ?? 0) === 1), '**무작위는 한 역할을 같은 날 두 장 안 만든다**')
  await setDay(3)
  const rand3 = await must('hostScatterRandom', host, { gameId: GAME, n: 14 })
  check(Number(rand3.scattered) > 0, `DAY 3 무작위 ${rand3.scattered}장`)

  console.log('\n── 바닥에는 자리만 ──')
  const reader = people.find((p) => p.uid !== owner.uid) as (typeof people)[number]
  const near = await standBeside(reader.token, reader.uid, Number(doc1.x), Number(doc1.y))
  check(near, '쪽지 옆에 섰다')
  await must('tick', host, { gameId: GAME })
  const v0 = await viewOf(reader.uid)
  const papers = (v0.slipPapers as { id: string; kind?: string }[]) ?? []
  check(papers.some((p) => p.id === n1.slipId), '그 방에 선 사람에게 한 장이 보인다')
  check(papers.find((p) => p.id === n1.slipId)?.kind === 'slip', '비밀 쪽지는 봉인한 그림 그대로다(메모와 다르다)')
  const tmpl = (SLIP_NOTES.find((x) => x.id === N1) as { text: string }).text
  const filled = fillSubject(tmpl, owner.name)
  check(!JSON.stringify(v0).includes(filled) && !JSON.stringify(v0).includes(tmpl), '**문안은 안 온다**')

  console.log('\n── 줍기 · 읽기 ──')
  await must('takeSlip', reader.token, { gameId: GAME, slipId: n1.slipId })
  let mine = ((await viewOf(reader.uid)).mySlips as { id: string; read: boolean; line: string | null; subjectId: string | null }[]).find((s) => s.id === n1.slipId)
  check(mine?.read === false && mine.line === null && mine.subjectId === null, '**주워도 읽기 전에는 내용도 주인도 없다**')
  check((await noteOf(host, N1)).state === 'held' && (await noteOf(host, N1)).holder === reader.name, `운영자 화면: 주움(${reader.name})`)
  const pullHeld = await call('hostPullSlip', host, { gameId: GAME, slipId: n1.slipId })
  check(pullHeld.code === 'FAILED_PRECONDITION', '주운 것은 회수 못 한다', pullHeld.message)
  await must('readSlip', reader.token, { gameId: GAME, slipId: n1.slipId })
  mine = ((await viewOf(reader.uid)).mySlips as { id: string; read: boolean; line: string | null; subjectId: string | null }[]).find((s) => s.id === n1.slipId)
  check(mine?.line === filled, '**읽으면 {이름}이 그 역할을 받은 사람 이름으로 바뀌어 온다**', String(mine?.line))
  check(mine?.subjectId === owner.uid, '주인도 같이 온다 — 그 역할을 받은 사람')

  console.log('\n── 두기 → 다시 뿌림 ──')
  await must('dropSlip', reader.token, { gameId: GAME, slipId: n1.slipId })
  const back = await noteOf(host, N1)
  check(back.state === 'placed' && back.room === 'library', '바닥에 두면 운영자 화면이 「뿌림」으로 돌아간다', `${back.state} ${back.room}`)
  const d2 = await slipDoc(n1.slipId as string)
  check(typeof d2.x === 'number', '방 바닥의 빈 칸에 다시 놓였다 — 종이가 그려진다', `${d2.x},${d2.y}`)
  const pullBack = await call('hostPullSlip', host, { gameId: GAME, slipId: n1.slipId })
  check(pullBack.code === 'FAILED_PRECONDITION', '한 번 주웠던 것은 바닥에 있어도 회수 못 한다', pullBack.message)

  console.log('\n── 회수 ──')
  const fresh = (await board(host)).notes.find((n) => n.state === 'placed' && !n.everHeld && n.id !== N1) as Note
  await must('hostPullSlip', host, { gameId: GAME, slipId: fresh.slipId })
  check((await noteOf(host, fresh.id)).state === 'waiting', '아무도 안 주운 것은 회수된다 — 다시 대기')

  console.log('\n── 찢기 ──')
  await must('takeSlip', reader.token, { gameId: GAME, slipId: n1.slipId })
  await must('tearSlip', reader.token, { gameId: GAME, slipId: n1.slipId })
  check((await noteOf(host, N1)).state === 'torn', '운영자 화면: 찢김')
  const d3 = await slipDoc(n1.slipId as string)
  check(d3.tornAt === null, '**조각이 안 남는다**')
  await fetch(`${FS}/games/${GAME}/pawns/${reader.uid}?updateMask.fieldPaths=items`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { items: { mapValue: { fields: { tape: { integerValue: '1' } } } } } }),
  })
  const tape = await call('useItem', reader.token, { gameId: GAME, kind: 'tape', scrapId: n1.slipId })
  check(tape.ok === true || tape.code !== 'FAILED_PRECONDITION' || !String(tape.message).includes('되돌릴'), '비밀 쪽지도 테이프로 붙일 수 있다', tape.message)
  check(!(((await viewOf(reader.uid)).mySlips as { id: string }[]) ?? []).some((s) => s.id === n1.slipId), '읽었던 사람 손에도 안 남는다')

  console.log('\n── 누출 — 열넷 모두의 응답 ──')
  const noteTexts = SLIP_NOTES.map((n) => n.text)
  const readIds = new Set<string>()
  let bad = 0
  for (const p of people) {
    const v = await viewOf(p.uid)
    const j = JSON.stringify(v)
    if (noteTexts.some((t) => j.includes(t))) bad += 1
    if (j.includes('{이름}')) bad += 1
    if (/r\d{2}-p[12]-(role|name)/.test(j)) bad += 1
    if (ROLE_IDS.some((r) => j.includes(`"${r}"`) && !j.includes(`"roleId":"${r}"`))) bad += 1
    for (const s of (v.mySlips as { id: string; read: boolean }[]) ?? []) if (s.read) readIds.add(s.id)
  }
  check(bad === 0, '**원문 틀 · {이름} · 쪽지 번호 · roleKey 가 어떤 사람 응답에도 없다**', `${bad}건`)
  // 안 읽은 쪽지 문장 — 누가 들고 있어도 안 읽었으면 어디에도 없어야 한다
  const slipsNow = await allSlips()
  let unreadLeak = 0
  for (const s of slipsNow) {
    const noteId = s.d.noteId as string | undefined
    if (!noteId) continue
    const n = SLIP_NOTES.find((x) => x.id === noteId) as { roleKey: string; text: string }
    const line = fillSubject(n.text, holderOf(n.roleKey).name)
    for (const p of people) {
      const v = await viewOf(p.uid)
      const readByMe = ((v.mySlips as { id: string; read: boolean }[]) ?? []).some((m) => m.id === s.id && m.read)
      if (!readByMe && JSON.stringify(v).includes(line)) unreadLeak += 1
    }
  }
  check(unreadLeak === 0, '**읽지 않은 쪽지 문장은 누구에게도 없다**', `${unreadLeak}건`)
  const direct = await fetch(`${FS}/games/${GAME}/secret/slips/items`, { headers: { Authorization: `Bearer ${people[0].token}` } })
  check(direct.status === 403, '쪽지 문서를 직접은 못 읽는다', String(direct.status))

  console.log(failures === 0 ? '\n전부 통과' : `\n${failures}개 틀렸다`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
