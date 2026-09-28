// QA 9 — 정보 누출. 참가자 Y 가 받을 수 있는 **모든 응답**을 다 받아 놓고, 거기에
// 남의 것이 한 글자라도 섰는지 본다.
//
//   - 남의 역할 이름 · 역할 id · 상황 글 · 미션 문장(docs/roles_full.md · roleData.ts 의 문장이 바늘이다)
//   - 투명인간 투표의 투표자 · 득표수, 신뢰/호감 표의 voterId
//   - 안개 밖 사람과 지워진 사람(X)의 자리 — X 의 at/tileId 가 어디에도 안 뜬다
//   - 안 읽은 쪽지의 문장과 주인(slipsHere · slipPapers 는 아이디 · 자리만)
//   - 문제 정답 · 해설, 싹 안 난 화분의 작물 · 자랄 시간
//   - 아직 안 열린 A 의 조각, 아직 안 보낸 미션 판정(inbox 는 보내기 전 404)
//   - secret/** · 남의 views · inbox · notes 를 직접 읽으면 403
//   - 번들(dist/assets/*.js)에 역할 이름 옆 조항 · 문제 정답 · A 의 조각 문장이 없다(npm run build 뒤)
//
//   npx vite-node scripts/qa-leak-e2e.ts   (에뮬레이터가 떠 있어야 한다)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STARTING_TEAM_SIZES, ROLE_TITLES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'
import { START_TILE, TILE_IDS, canRoamTo, canStandAt, roomOfCell, type TileId } from '../shared/rules/board'
import { START_CELLS, isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { dropCellsIn } from '../shared/rules/quiz'
import { ROLE_NAMES, ROLE_IDS, type RoleId } from '../shared/missions/roleNames'
import { ROLE_DATA } from '../shared/missions/roleData'
import { CROP_BY_ID, GARDEN_TILE, POT_CELLS } from '../shared/rules/crop'
import { fillSubject } from '../shared/reveal/slips'
import { ERRANDS } from '../shared/rules/errand'
import { FRAGMENTS } from '../functions/src/story/fragments'
import { SLIP_NOTES } from '../functions/src/story/slipNotes'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const ROOT = new URL('..', import.meta.url).pathname
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
  if ('mapValue' in o) { const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}; return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)])) }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function signUp(e: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e
}
async function setAdmin(e: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) })
  const j = (await r.json()) as { idToken: string; localId: string }; return { uid: j.localId, token: j.idToken }
}
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string; raw: string }
/** 부하가 큰 기계에서 연결이 끊기면 한 번 더 — 서버의 답이 아니라 회선의 일이다 */
async function fetchRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) }) } catch (e) { if (i >= tries - 1) throw e }
  }
}
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetchRetry(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const raw = await r.text()
  try {
    const j = JSON.parse(raw) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
    if (j.error) return { ok: false, code: j.error.status, message: j.error.message, raw }
    return { ok: true, data: j.result ?? {}, raw }
  } catch { return { ok: false, code: 'NOT_JSON', message: raw.slice(0, 100), raw } }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}
async function getDoc(path: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!r.ok) return null
  return plain(await r.json()) as Record<string, unknown>
}
async function getAll(path: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((doc) => ({ id: doc.name.split('/').pop() as string, d: plain(doc) as Record<string, unknown> }))
}
async function patch(path: string, fields: Record<string, unknown>, tk?: string): Promise<number> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
      : typeof v === 'boolean' ? { booleanValue: v }
        : v === null ? { nullValue: null }
          : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
            : { stringValue: String(v) }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : ADMIN) },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  return r.status
}
/** Y 의 증표로 직접 읽는다. 상태와 본문을 돌려준다 — 규칙(firestore.rules)이 가른다 */
async function readAs(tk: string, path: string, list = false): Promise<{ status: number; text: string }> {
  const r = await fetch(`${FS}/${path}${list ? '?pageSize=300' : ''}`, { headers: { Authorization: `Bearer ${tk}` } })
  return { status: r.status, text: await r.text() }
}

const GAME = `lk${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
type P = { uid: string; token: string; team: TeamId; name: string }
const HANGUL = /[가-힣]/

/** 방 안에서 그 칸 옆 빈 칸에 선다 — 먼저 방을 옮겨 두고 칸을 짚는다 */
async function standBeside(p: P, x: number, y: number): Promise<boolean> {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const c = { x: x + dx, y: y + dy }
    if (!canStandAt(c.x, c.y) || roomOfCell(c.x, c.y) !== roomOfCell(x, y) || isBlockedCell(c.x, c.y) || isFixture(c.x, c.y)) continue
    const r = await call('standAt', p.token, { gameId: GAME, x: c.x, y: c.y })
    if (r.ok && r.data?.ok !== false) return true
  }
  return false
}

/** 문서에서 한글 문장을 뽑는다. 표의 칸 · 인용 · 문단을 문장으로 자른다 */
function sentencesOfMd(md: string): string[] {
  const body = md.slice(md.indexOf('\n## '))
  const out = new Set<string>()
  for (const line of body.split('\n')) {
    const cells = line.startsWith('|') ? line.split('|') : [line]
    for (const cell of cells) {
      const t = cell.replace(/^[>#*\-\s]+/, '').replace(/\*\*/g, '').trim()
      for (const s of t.split(/(?<=[.!?])\s+/)) {
        const x = s.trim()
        if (x.length >= 12 && HANGUL.test(x)) out.add(x)
      }
    }
  }
  return [...out]
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'leak' })
  const people: P[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${i}` })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  // 같은 에뮬레이터의 다른 시험이 hostDeleteAccounts 를 부르면 계정 없는 uid 의 자리가 휩쓸린다 — 빠진 사람은 다시 앉힌다
  for (let round = 0; round < 3; round++) {
    const g = (await getDoc(`games/${GAME}`)) as { seats: { playerId: string }[] }
    const missing = people.filter((p) => !g.seats.some((s) => s.playerId === p.uid))
    if (missing.length === 0) break
    for (const p of missing) await must('joinGame', p.token, { gameId: GAME, name: p.name, team: p.team })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  await clock(dayHourMs(START, 1, 10))
  const roster = (await getAll(`games/${GAME}/secret/roster/items`)).map((r) => r.d as { playerId: string; roleId: RoleId; team: TeamId })
  const roleOf = (uid: string) => roster.find((r) => r.playerId === uid)?.roleId as RoleId
  const A = people.filter((p) => p.team === 'A'), B = people.filter((p) => p.team === 'B'), C = people.filter((p) => p.team === 'C'), D = people.filter((p) => p.team === 'D')
  const Y = A[0]
  /** 지워질 사람. Y 와 다른 팀 — 같은 팀은 안개 없이 늘 보이므로 「지워졌다」만 남게 */
  const X = B[0]
  /** 안개 밖으로 걸어 나갈 사람들(Y 와 다른 팀) */
  const Z = C
  check(roster.length === 14, '열넷이 역할을 받고 판이 돌고 있다', `Y=${roleOf(Y.uid)} X=${roleOf(X.uid)}`)

  // ── 판을 채운다 ──
  console.log('\n── 하루치 일을 벌인다 ──')
  // 표 — 다른 팀 사이에서 몇 장. Y 도 한 장 받는다
  const votes = [[B[1], A[1]], [C[0], Y], [D[0], B[1]], [A[1], C[1]]] as const
  for (const [from, to] of votes) await must('castVote', from.token, { gameId: GAME, targetId: to.uid, kind: 'trust' })
  await must('castVote', D[1].token, { gameId: GAME, targetId: A[2].uid, kind: 'liking' })
  // 투명인간 투표 — 운영자가 문을 연 뒤(ballotGate) 몇 장. B[1] 이 셋
  await must('hostOpenBallot', host, { gameId: GAME })
  for (const [from, to] of [[A[1], B[1]], [C[0], B[1]], [D[0], B[1]], [B[1], A[1]], [Y, C[1]]] as const) await must('castBallot', from.token, { gameId: GAME, targetId: to.uid })
  // 쪽지 — 여섯 장을 뿌리고 X 가 한 장을 읽는다
  const scattered = (await must('hostScatterRandom', host, { gameId: GAME, n: 6 })) as { scattered: number }
  check(scattered.scattered >= 3, `쪽지 ${scattered.scattered}장을 뿌렸다`)
  const slipDocs = (await getAll(`games/${GAME}/secret/slips/items`)).map((s) => ({ id: s.id, ...(s.d as { x: number; y: number; noteId: string; subjectId: string; heldBy: string | null }) }))
  const readable = slipDocs.find((s) => { const room = roomOfCell(s.x, s.y); return room && canRoamTo(START_TILE, room) && canRoamTo(room, START_TILE) })
  let readSlipId: string | null = null
  if (readable) {
    const room = roomOfCell(readable.x, readable.y) as TileId
    await must('roamTo', X.token, { gameId: GAME, tileId: room })
    const near = await standBeside(X, readable.x, readable.y)
    check(near, `X 가 ${room} 의 쪽지 옆에 섰다`)
    await must('takeSlip', X.token, { gameId: GAME, slipId: readable.id })
    await must('readSlip', X.token, { gameId: GAME, slipId: readable.id })
    readSlipId = readable.id
    await must('roamTo', X.token, { gameId: GAME, tileId: START_TILE })
  } else check(false, '교실에서 갈 수 있는 방에 뿌려진 쪽지가 없다')
  // 문제 — 교실 안 한 장(Y 눈에 보인다), 먼 방에 한 장
  const ANSWER = '정답비밀단어ㅋ', EXPLAIN = '해설비밀문장이다', PROMPT_HERE = '교실바닥문제문장', PROMPT_FAR = '먼방바닥문제문장'
  const taken = new Set([...START_CELLS, ...slipDocs].map((c) => `${c.x},${c.y}`))
  const freeHere = dropCellsIn(START_TILE).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(`${c.x},${c.y}`))
  await must('hostDrop', host, { gameId: GAME, kind: 'quiz', x: freeHere[freeHere.length - 1].x, y: freeHere[freeHere.length - 1].y, quiz: { kind: 'short', prompt: PROMPT_HERE, answers: [ANSWER], explain: EXPLAIN } })
  // 이 학교는 복도가 층을 통째로 잇는다 — 교실에서 못 가는 방이 없으면 그냥 다른 방 하나
  const farRoom = (TILE_IDS.find((t) => t !== START_TILE && !canRoamTo(START_TILE, t)) ?? TILE_IDS.filter((t) => t !== START_TILE && t !== GARDEN_TILE).at(-1)) as TileId
  const farCell = dropCellsIn(farRoom).find((c) => !isBlockedCell(c.x, c.y)) as { x: number; y: number }
  await must('hostDrop', host, { gameId: GAME, kind: 'quiz', x: farCell.x, y: farCell.y, quiz: { kind: 'short', prompt: PROMPT_FAR, answers: [ANSWER + '2'], explain: EXPLAIN + '2' } })
  // 화분 — 운영자가 셋 심는다(흙만 보인다)
  await must('hostPlant', host, { gameId: GAME, pot: 0, cropId: 'tomato' })
  await must('hostPlant', host, { gameId: GAME, pot: 1, cropId: 'strawberry' })
  await must('hostPlant', host, { gameId: GAME, pot: 2 })
  // 심부름 한 장
  const board = 'f2w'
  const errandSpec = ERRANDS.find((e) => e.from !== START_TILE) ?? ERRANDS[0]
  await must('hostPostErrand', host, { gameId: GAME, specId: errandSpec.id, boardId: board, to: START_TILE })
  // 거래 — X 와 B[1] 이 연다(Y 는 남이다)
  const pair = (() => { for (const c of freeHere) { const n = freeHere.find((d) => d.x === c.x + 1 && d.y === c.y); if (n) return [c, n] } throw new Error('나란한 빈 칸이 없다') })()
  await must('standAt', X.token, { gameId: GAME, x: pair[0].x, y: pair[0].y })
  await must('standAt', B[1].token, { gameId: GAME, x: pair[1].x, y: pair[1].y })
  const deal = await must('askDeal', X.token, { gameId: GAME, toPlayerId: B[1].uid })
  await must('answerDeal', B[1].token, { gameId: GAME, dealId: deal.id, accept: true })
  // 말 — X 와 Z 가 몇 마디(지워지기 전)
  await must('say', B[1].token, { gameId: GAME, text: '거래하자' })
  await must('radio', X.token, { gameId: GAME, text: 'B팀 무전 비밀' })
  await must('radio', A[1].token, { gameId: GAME, text: 'A팀 무전' })
  await must('radio', C[0].token, { gameId: GAME, text: '전원 채널 말', channel: 'all' })
  // Z — 안개 밖으로. 교실에서 갈 수 있는 방 중 하나로
  const zRoom = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE, t)) as TileId
  for (const z of Z) await must('roamTo', z.token, { gameId: GAME, tileId: zRoom })
  // DAY 2 로 — DAY 1 자정 판정이 생긴다. A 의 조각도 2일치까지 열린다
  await clock(dayHourMs(START, 2, 10))
  for (let i = 0; i < 20; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { pushed: { kind: string; day: number } | null }
    if (!r.pushed || (r.pushed.kind === 'dayStart' && r.pushed.day === 2)) break
  }
  const snaps = await getAll(`games/${GAME}/secret/missionSnaps/items`)
  check(snaps.length === 14, 'DAY 1 판정 열넷이 secret 에 있다(아직 아무에게도 안 보냈다)', `${snaps.length}`)
  // X 를 지운다 — 그 뒤로 X 가 한 말은 Y 에게 안 간다
  await patch(`games/${GAME}`, { invisibleId: X.uid, invisibleTeam: 'B' })
  await must('say', X.token, { gameId: GAME, text: '지워진채로한말' })
  await must('radio', X.token, { gameId: GAME, text: '지워진채로무전' })
  // live — X · Z · 같은 팀 W 가 제 자리를 직접 적는다(규칙이 본인 쓰기를 허용한다)
  const W = A[1]
  for (const p of [X, Z[0], W]) {
    const st = await patch(`games/${GAME}/live/${p.uid}`, { tileId: p === Z[0] ? zRoom : START_TILE, x: 20.5, y: 22.5, dir: 'down', moving: false, ms: Date.now() }, p.token)
    check(st === 200, `${p === X ? 'X' : p === W ? 'W' : 'Z'} 가 제 live 문서를 적었다`, String(st))
  }
  // views 를 다시 짠다 — markMorning 은 늘 refreshViews 로 끝난다(standAt 은 칸이 차 있으면 조용히 물러난다)
  const yCell = freeHere[0]
  await must('markMorning', Y.token, { gameId: GAME, read: [], skipped: [] })

  // ── 바늘 ──
  const ownRole = roleOf(Y.uid)
  const ownData = ROLE_DATA.find((r) => r.key === ownRole)
  if (!ownData) throw new Error('Y 의 역할 데이터가 없다')
  const ownBlob = [ownData.intro, ...ownData.situation, ownData.goal, ownData.line, ownData.footnote ?? '', ownData.name, ownData.key,
    ...ownData.clauses.flatMap((c) => [c.text, c.text.replace('{분}', String(c.minutes ?? ''))])].join('\n')
  const names = people.map((p) => p.name)
  const fill = (t: string) => [t, ...names.map((n) => fillSubject(t, n)), fillSubject(t, null)]
  const md = readFileSync(join(ROOT, 'docs/roles_full.md'), 'utf8')
  const storyNeedles = new Set<string>()
  for (const r of ROLE_DATA) {
    for (const s of [r.intro, ...r.situation, r.goal, r.line, r.footnote ?? '']) if (s.length >= 8) storyNeedles.add(s)
    for (const c of r.clauses) if (c.text.length >= 8) for (const v of [c.text, c.text.replace('{분}', String(c.minutes ?? ''))]) storyNeedles.add(v)
    for (const n of r.notes) for (const v of fill(n.text)) storyNeedles.add(v)
  }
  for (const s of sentencesOfMd(md)) for (const v of fill(s)) storyNeedles.add(v)
  const slipNeedles = SLIP_NOTES.flatMap((n) => fill(n.text))
  const roleIdNeedles = ROLE_IDS.filter((id) => !(ROLE_TITLES as readonly string[]).includes(id))
  const fragmentNeedles = FRAGMENTS.flatMap((f) => f.papers.flatMap((p) => [...p.lines, ...(p.topLines ?? [])]).map((l) => ({ day: f.day, line: l })))
  const cropNames = Object.values(CROP_BY_ID).map((c) => c.name)
  check(storyNeedles.size > 200 && slipNeedles.length > 56 && fragmentNeedles.length >= 4, `바늘 — 문장 ${storyNeedles.size} · 쪽지 ${slipNeedles.length} · 조각 ${fragmentNeedles.length}`)

  /** 응답 하나를 훑는다. 허용된 것(own) 말고 걸리면 실패 */
  function scan(label: string, text: string, opt: { ownAllowed?: boolean; allowUids?: string[] } = {}): void {
    const leaks: string[] = []
    const roleHits = Object.entries(ROLE_NAMES).filter(([, n]) => text.includes(n)).map(([id]) => id)
    const idHits = roleIdNeedles.filter((id) => new RegExp(`"${id}"`).test(text))
    for (const id of [...roleHits, ...idHits]) if (!(opt.ownAllowed && id === ownRole)) leaks.push(`역할 ${id}`)
    for (const s of storyNeedles) if (text.includes(s) && !(opt.ownAllowed && ownBlob.includes(s))) leaks.push(`문장 「${s.slice(0, 18)}…」`)
    for (const s of slipNeedles) if (text.includes(s)) leaks.push(`쪽지 「${s.slice(0, 18)}…」`)
    for (const k of ['voterId', 'voterTeam', 'castAtMs', '"ballots"', '"votes"', 'truth', 'missionSnaps', 'override', 'growMs', 'plantedMs', '"answers"', '"explain"', 'subjectId":"' + X.uid]) if (text.includes(k)) leaks.push(`열쇠 ${k}`)
    for (const s of [ANSWER, EXPLAIN, PROMPT_HERE, PROMPT_FAR, ANSWER + '2', EXPLAIN + '2']) if (text.includes(s)) leaks.push(`문제 「${s}」`)
    for (const f of fragmentNeedles) if (f.day > 2 && text.includes(f.line)) leaks.push(`조각 DAY${f.day}`)
    for (const n of cropNames) if (text.includes(`"${n}"`)) leaks.push(`작물 ${n}`)
    for (const id of ['tomato', 'strawberry']) if (text.includes(`"${id}"`)) leaks.push(`작물 id ${id}`)
    if (!(opt.allowUids ?? []).includes(X.uid) && text.includes(X.uid)) leaks.push('지워진 X 의 아이디')
    for (const z of Z) if (!(opt.allowUids ?? []).includes(z.uid) && text.includes(z.uid)) leaks.push('안개 밖 Z 의 아이디')
    if (text.includes('지워진채로한말') || text.includes('지워진채로무전')) leaks.push('지워진 사람의 말')
    if (text.includes('B팀 무전 비밀') || text.includes('거래하자')) leaks.push('남의 팀 무전 · 남의 방 말')
    check(leaks.length === 0, label, [...new Set(leaks)].slice(0, 5).join(' · '))
  }

  // ── Y 가 받을 수 있는 것 전부 ──
  console.log('\n── Y 의 화면 문서(views) ──')
  const view = await readAs(Y.token, `games/${GAME}/views/${Y.uid}`)
  check(view.status === 200, 'Y 는 제 views 를 읽는다', String(view.status))
  const v = plain(JSON.parse(view.text)) as Record<string, unknown>
  scan('views/Y 에 남의 것이 없다', view.text, { ownAllowed: true })
  const vp = (v.visiblePawns as { playerId: string; tileId: string; at?: unknown }[]) ?? []
  check(!vp.some((p) => p.playerId === X.uid) && !(v.visibleIds as string[]).includes(X.uid), '지워진 X 는 visiblePawns · visibleIds 에 없다(같은 교실인데도)')
  check(!vp.some((p) => Z.some((z) => z.uid === p.playerId)), '안개 밖 Z 는 visiblePawns 에 없다')
  check(vp.some((p) => p.playerId === W.uid), '같은 팀 W 는 보인다(대조)')
  const counts = v.roomCounts as Record<string, number>
  check(counts[START_TILE] === vp.filter((p) => p.tileId === START_TILE).length, '교실 머릿수가 보이는 사람 수와 같다 — 지워진 X 를 안 센다', `${counts[START_TILE]} vs ${vp.length}`)
  check(!(zRoom in counts), `안개 밖 방(${zRoom})의 머릿수가 없다`)
  // 날이 넘어가 어제 표는 비어 있을 수 있다 — 어느 쪽이든 남의 표 · 득표수는 없다
  check(((v.myBallot as string | null) === C[1].uid || v.myBallot === null) && !('ballots' in v) && !('counts' in v), '내 투표만 있다(myBallot) · 남의 표도 득표수도 없다', String(v.myBallot))
  const papers = (v.slipPapers as Record<string, unknown>[]) ?? []
  const here = (v.slipsHere as Record<string, unknown>[]) ?? []
  check([...papers, ...here].every((s) => Object.keys(s).every((k) => ['id', 'x', 'y'].includes(k))), '바닥의 쪽지는 id · x · y 만이다', JSON.stringify([...papers, ...here].slice(0, 2)))
  const qh = (v.quizzesHere as Record<string, unknown>[]) ?? []
  check(qh.length === 1 && Object.keys(qh[0]).every((k) => ['id', 'x', 'y'].includes(k)), '교실의 문제 종이는 자리만이다', JSON.stringify(qh))
  check((v.myQuizzes as unknown[]).length === 0 && (v.mySlips as unknown[]).length === 0, '안 든 종이의 문장은 없다')
  check((v.own as { roleId: string }).roleId === ownRole, 'own 에는 내 역할만 있다')
  const notices = JSON.stringify(v.notices)
  check(!notices.includes('truth') && !/달성|실패/.test(notices), '공지에 판정이 섞이지 않았다')
  // 정원으로 가서 화분을 본다
  const toGarden = canRoamTo(START_TILE, GARDEN_TILE as TileId)
  if (toGarden) await must('roamTo', Y.token, { gameId: GAME, tileId: GARDEN_TILE })
  else {
    await patch(`games/${GAME}/pawns/${Y.uid}`, { tileId: GARDEN_TILE, postTile: GARDEN_TILE })
    check(await standBeside(Y, POT_CELLS[0].x, POT_CELLS[0].y), 'Y 가 정원 화분 앞에 섰다')
  }
  const gv = await readAs(Y.token, `games/${GAME}/views/${Y.uid}`)
  const g = plain(JSON.parse(gv.text)) as { potsHere: { i: number; stage: string; name: string | null; cropId: string | null }[] }
  scan('정원에 선 Y 의 views 에 화분 속이 없다', gv.text, { ownAllowed: true })
  const soil = g.potsHere.filter((p) => p.i <= 2)
  check(soil.length === 3 && soil.every((p) => p.stage === 'soil' && p.name === null && p.cropId === null), '흙만 보이는 화분 셋 — 이름도 작물 id 도 자랄 시간도 없다', JSON.stringify(soil))
  if (toGarden) await must('roamTo', Y.token, { gameId: GAME, tileId: START_TILE })
  else {
    await patch(`games/${GAME}/pawns/${Y.uid}`, { tileId: START_TILE, postTile: START_TILE })
    await standBeside(Y, yCell.x, yCell.y)
  }

  console.log('\n── Y 가 부를 수 있는 콜러블 전부 ──')
  const calls: [string, unknown, { ownAllowed?: boolean; allowUids?: string[] }][] = [
    ['myPaper', { gameId: GAME }, { ownAllowed: true }],
    // 같은 교실에 선 사람의 말에는 그 사람 아이디가 붙는다 — 보이는 사람이다
    ['chatLines', { gameId: GAME }, { allowUids: [] }],
    ['radioLines', { gameId: GAME, channel: 'team' }, {}],
    ['radioLines', { gameId: GAME, channel: 'all' }, { allowUids: Z.map((z) => z.uid) }],
    ['phaseNow', { gameId: GAME }, {}],
    ['clockNow', { gameId: GAME }, {}],
    ['tick', { gameId: GAME }, {}],
    ['snowNow', { gameId: GAME }, {}],
    ['dealNow', { gameId: GAME }, {}],
    ['releasedFragments', { gameId: GAME }, {}],
    ['fragmentOfDay', { gameId: GAME, day: 1 }, {}],
    ['fragmentOfDay', { gameId: GAME, day: 2 }, {}],
    ['fragmentOfDay', { gameId: GAME, day: 3 }, {}],
    ['fragmentOfDay', { gameId: GAME, day: 4 }, {}],
    ['myEnding', { gameId: GAME }, {}],
    ['peekDay', { gameId: GAME }, {}],
    ['arcadeClock', {}, {}],
    ['arcadeTick', { gameId: GAME, roomId: 'nope' }, {}],
    ['notifyConfig', {}, {}],
    ['markMorning', { gameId: GAME, read: [], skipped: [] }, {}],
    ['settleDeal', { gameId: GAME, dealId: deal.id }, {}],
    ['answerDeal', { gameId: GAME, dealId: deal.id, accept: true }, {}],
    ['readSlip', { gameId: GAME, slipId: readSlipId ?? 'x' }, {}],
    ['takeSlip', { gameId: GAME, slipId: readSlipId ?? 'x' }, {}],
    ['answerQuiz', { gameId: GAME, paperId: 'x', given: '?' }, {}],
    ['castVote', { gameId: GAME, targetId: X.uid, kind: 'trust' }, {}],
    ['seenMissionDay', { gameId: GAME, day: 1 }, {}],
  ]
  const got: Record<string, Res> = {}
  for (const [fn, args, opt] of calls) {
    const r = await call(fn, Y.token, args)
    got[`${fn}:${JSON.stringify(args).slice(0, 30)}`] = r
    scan(`${fn}${'day' in (args as object) ? ` day=${(args as { day: number }).day}` : ''}${'channel' in (args as object) ? ` ${(args as { channel: string }).channel}` : ''} 응답에 남의 것이 없다 (${r.ok ? 'ok' : r.code})`, r.raw, opt)
  }
  const paper = got[`myPaper:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].data as { roleId: string; votesReceived: number; votesThroughDay: number }
  check(paper.roleId === ownRole && paper.votesReceived === 1 && paper.votesThroughDay === 1, 'myPaper — 내 역할 · 받은 표는 어제까지 합계 하나(누가 줬는지 없음)', JSON.stringify([paper.roleId, paper.votesReceived, paper.votesThroughDay]))
  const chat = got[`chatLines:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].data as { lines: { playerId: string; text: string }[] }
  check(!chat.lines.some((l) => l.playerId === X.uid), 'chatLines — 지워진 뒤 X 가 친 말이 Y 에게 안 온다(아이디도 안 온다)')
  const radioAll = got[`radioLines:${JSON.stringify({ gameId: GAME, channel: 'all' }).slice(0, 30)}`].data as { lines: { text: string }[] }
  check(radioAll.lines.some((l) => l.text === '전원 채널 말') && !radioAll.lines.some((l) => l.text === '지워진채로무전'), '전원 채널은 들리고, 팀 채널의 남의 말은 안 온다')
  for (const d of [3, 4]) {
    const r = got[`fragmentOfDay:${JSON.stringify({ gameId: GAME, day: d }).slice(0, 30)}`]
    check(!r.ok && r.code === 'FAILED_PRECONDITION', `fragmentOfDay DAY ${d}(미래) 는 거절한다`, `${r.code} ${r.message}`)
  }
  const rel = got[`releasedFragments:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].data as { days: number[] }
  check(JSON.stringify(rel.days) === '[1,2]', 'releasedFragments 는 DAY 1·2 만', JSON.stringify(rel.days))
  check(got[`peekDay:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].code === 'PERMISSION_DENIED', 'peekDay 는 운영자만')
  check(got[`myEnding:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].code === 'FAILED_PRECONDITION', 'myEnding 은 끝나기 전에 안 준다')
  check(got[`dealNow:${JSON.stringify({ gameId: GAME }).slice(0, 30)}`].data?.id === null, 'dealNow — 남의 거래는 내 것으로 안 온다')

  console.log('\n── 직접 읽기 — 규칙이 가른다 ──')
  const denied: [string, boolean][] = [
    [`games/${GAME}/secret/roster/items`, true], [`games/${GAME}/secret/roster/items/${X.uid}`, false], [`games/${GAME}/secret/roster/items/${Y.uid}`, false],
    [`games/${GAME}/secret/votes/items`, true], [`games/${GAME}/secret/ballots/items`, true], [`games/${GAME}/secret/ballots/items/d1:${Y.uid}`, false],
    [`games/${GAME}/secret/slips/items`, true], [`games/${GAME}/secret/slips/items/${readSlipId ?? 'x'}`, false],
    [`games/${GAME}/secret/quiz/bank`, true], [`games/${GAME}/secret/quiz/floor`, true], [`games/${GAME}/secret/quiz`, false],
    [`games/${GAME}/secret/chat/items`, true], [`games/${GAME}/secret/radio/items`, true], [`games/${GAME}/secret/records/items`, true],
    [`games/${GAME}/secret/intervals/items`, true], [`games/${GAME}/secret/missionSnaps/items`, true], [`games/${GAME}/secret/missionSnaps/items/d1_${Y.uid}`, false],
    [`games/${GAME}/secret/missionDays/items`, true], [`games/${GAME}/secret/phase`, false], [`games/${GAME}/secret/cells/items`, true],
    [`games/${GAME}/secret/traps/set`, true], [`games/${GAME}/secret/traps/jobs`, true], [`games/${GAME}/secret/dealSlips/items`, true],
    [`games/${GAME}/secret/garden`, false], [`games/${GAME}/secret/flags`, false], [`games/${GAME}/secret/erased/items`, true],
    [`games/${GAME}/secret/progress/items`, true], [`games/${GAME}/secret/choices/items`, true], [`games/${GAME}/secret/ending/lines`, true],
    [`games/${GAME}/secret/pushSubs/items`, true], [`games/${GAME}/secret`, true],
    [`games/${GAME}/views/${X.uid}`, false], [`games/${GAME}/views/${W.uid}`, false], [`games/${GAME}/views`, true],
    [`games/${GAME}/inbox/${X.uid}`, false], [`games/${GAME}/inbox`, true], [`games/${GAME}/notes/${X.uid}`, false],
    [`games/${GAME}/pawns/${Y.uid}`, false], [`games/${GAME}/pawns/${X.uid}`, false], [`games/${GAME}/pawns`, true],
    [`games/${GAME}/robots`, true], [`games/${GAME}/schedule`, true], [`games/${GAME}/pots`, true], [`games/${GAME}/pots/0`, false],
    [`games/${GAME}/errands`, true], [`games/${GAME}/captures`, true], [`games/${GAME}/made`, true], [`games/${GAME}/notices`, true],
    [`games/${GAME}/teams`, true], [`games/${GAME}/teams/B`, false], [`games/${GAME}/deals/${deal.id}`, false], [`games/${GAME}/deals`, true],
    [`games/${GAME}/transfers`, true], [`games/${GAME}/arcadeRooms`, true],
    [`games/${GAME}/live/${X.uid}`, false], [`games/${GAME}/live/${Z[0].uid}`, false], [`games/${GAME}/live`, true],
  ]
  let deniedOk = 0
  const deniedBad: string[] = []
  for (const [path, list] of denied) {
    const r = await readAs(Y.token, path, list)
    if (r.status === 403) deniedOk += 1
    else deniedBad.push(`${path.replace(`games/${GAME}/`, '')}→${r.status}`)
  }
  check(deniedBad.length === 0, `Y 는 secret/** · 남의 views/inbox/notes · pawns · live(안개 밖 · 지워진) 등 ${denied.length}곳을 못 읽는다(403)`, deniedBad.join(' '))
  void deniedOk
  const allowed: [string, boolean][] = [
    [`games/${GAME}`, false], [`games/${GAME}/tiles`, true], [`games/${GAME}/events`, true], [`games/${GAME}/phaseLog`, true],
    [`games/${GAME}/teams/A`, false], [`games/${GAME}/live/${W.uid}`, false], [`games/${GAME}/views/${Y.uid}`, false],
  ]
  for (const [path, list] of allowed) {
    const r = await readAs(Y.token, path, list)
    const short = path.replace(`games/${GAME}`, '') || '(판)'
    check(r.status === 200 || (list && r.status === 200), `${short} 은 읽힌다`, String(r.status))
    // 판 문서(명단)와 공개 기록(events)에는 아이디가 원래 있다 — 역할 · 표 · 쪽지 문장만 본다
    if (r.status === 200) scan(`${short} 에 남의 것이 없다`, r.text, { ownAllowed: short.includes('views'), allowUids: short === '(판)' || short === '/events' ? [X.uid, ...Z.map((z) => z.uid)] : [] })
  }
  const inbox = await readAs(Y.token, `games/${GAME}/inbox/${Y.uid}`)
  // 우편함 문서는 알림(notify) 표시도 같이 산다 — 있어도 판정(missions)은 없어야 한다
  check(inbox.status === 404 || !inbox.text.includes('missions'), '보내기 전 내 우편함에 판정(missions)이 없다 — 판정은 secret 에만', `${inbox.status} ${inbox.text.slice(0, 80)}`)
  const gameDoc = plain(JSON.parse((await readAs(Y.token, `games/${GAME}`)).text)) as Record<string, unknown>
  check(gameDoc.invisibleId === X.uid && !('roles' in gameDoc) && !JSON.stringify(gameDoc.seats).includes('role'), '판 문서에는 오늘의 투명인간 이름만 있고 역할은 없다(공개 설계)')
  const events = ((plain(JSON.parse((await readAs(Y.token, `games/${GAME}/events`, true)).text)) as { documents?: Record<string, unknown>[] }).documents ?? []) as { kind: string; playerId?: string; targetId?: string; tileId?: string; detail?: unknown }[]
  const voteEv = events.filter((e) => e.kind === 'vote')
  check(voteEv.length === 5 && voteEv.every((e) => !e.playerId && !e.targetId && JSON.stringify(e.detail) === '{}'), 'events 의 표(vote) 기록에는 누가 누구에게가 없다', `${voteEv.length}줄`)
  const ballotEv = events.filter((e) => e.kind === 'ballotCast')
  check(ballotEv.every((e) => !e.playerId), '공개 events 의 투명인간 투표 기록에 **누가 적었는지**가 없다', `ballotCast ${ballotEv.length}줄 · playerId 있음 ${ballotEv.filter((e) => e.playerId).length}`)
  const withWho = [...new Set(events.filter((e) => e.playerId && e.kind !== 'devClock').map((e) => `${e.kind}${e.tileId ? '+tileId' : ''}${e.targetId ? '+targetId' : ''}`))]
  console.log(`  · 공개 events 에 playerId 가 붙은 종류: ${withWho.join(', ') || '없음'} (누구나 읽는 컬렉션 — 지워진 사람의 지난 자리도 여기 남는다)`)
  // 보낸 뒤에는 내 것만 온다
  await must('hostMissionSend', host, { gameId: GAME, day: 1, playerIds: [Y.uid] })
  const mail = await readAs(Y.token, `games/${GAME}/inbox/${Y.uid}`)
  check(mail.status === 200, '보낸 뒤 내 우편함은 읽힌다', String(mail.status))
  scan('내 우편함에 남의 판정 · truth 가 없다', mail.text, { ownAllowed: true })
  check((await readAs(Y.token, `games/${GAME}/inbox/${X.uid}`)).status === 403, '남의 우편함은 여전히 403')

  // ── 번들 ──
  console.log('\n── 번들(dist) ──')
  const assets = join(ROOT, 'dist/assets')
  if (!existsSync(assets)) check(false, 'dist/assets 가 없다 — npm run build 를 먼저 돌려라')
  else {
    const files = readdirSync(assets).filter((f) => f.endsWith('.js'))
    const bundle = files.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n')
    check(files.length > 0, `번들 파일 ${files.length}개`)
    // 역할 이름 옆에 조항 문장이 있는가 — 이름은 공개지만 조항은 서버 몫이다
    const clauseHits: string[] = []
    for (const r of ROLE_DATA) for (const c of r.clauses) {
      for (const t of [c.text, c.text.replace('{분}', String(c.minutes ?? ''))]) {
        const i = bundle.indexOf(t)
        if (i >= 0) clauseHits.push(`${r.name}: 「${t}」${bundle.slice(Math.max(0, i - 200), i + 200).includes(r.name) ? ' (이름 옆)' : ''}`)
      }
    }
    check(clauseHits.length === 0, '번들에 역할 조항 문장이 없다', clauseHits.slice(0, 3).join(' · '))
    const nameNearStory = ROLE_DATA.filter((r) => { const i = bundle.indexOf(r.name); return i >= 0 && [r.goal, r.line, ...r.situation].some((s) => bundle.includes(s)) })
    check(nameNearStory.length === 0, '번들에 역할 이름과 상황 · 미션 문장이 같이 있지 않다', nameNearStory.map((r) => r.name).join(' '))
    check(![ANSWER, EXPLAIN, PROMPT_HERE].some((s) => bundle.includes(s)), '번들에 문제 은행의 정답 · 해설이 없다(은행은 판마다 운영자가 적는 실행 시각 자료 — 파일로는 없다)')
    const fragHits = fragmentNeedles.filter((f) => bundle.includes(f.line))
    check(fragHits.length === 0, '번들에 A 의 조각 문장이 없다', fragHits.map((f) => `DAY${f.day}`).join(' '))
    const slipHits = SLIP_NOTES.filter((n) => bundle.includes(n.text))
    check(slipHits.length === 0, '번들에 쪽지 56장 문안이 없다', slipHits.map((n) => n.id).slice(0, 3).join(' '))
    const nameCount = Object.values(ROLE_NAMES).filter((n) => bundle.includes(n)).length
    console.log(`  · 역할 이름은 ${nameCount}/14 개가 번들에 있다 — 이름은 공개다(roleNames.ts)`)
  }

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
