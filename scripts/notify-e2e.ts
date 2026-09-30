// 알림 — 서버가 정하고 우편함(inbox)에 적는다.
//
//   - 공지 · 태그 · 페이즈가 받을 사람에게만, 내용 없이 간다
//   - 설정을 끄면 안 간다 · 1분에 다섯 건을 넘으면 「알림 n건」으로 묶인다
//   - 보낸 기록이 남는다(운영자만) · 죽은 구독은 실패로 적힌다
//
//   npx vite-node scripts/notify-e2e.ts   (에뮬레이터가 떠 있어야 한다)

import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'

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
interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d); if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`); return r.data as Record<string, unknown>
}


const GAME = `ntf${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
type Note = { type: string; text: string; count?: number; link: string }

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'ntf' })
  const people: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i], name: `봇${String.fromCharCode(0xac00 + i * 30)}` })
    await must('joinGame', a.token, { gameId: GAME, name: people[i].name, team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const g = plain(await (await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })).json()) as { seats: { playerId: string; name: string; team: string }[] }
  for (const p of people) {
    const s = g.seats.find((x) => x.playerId === p.uid)
    if (s) { p.name = s.name; p.team = s.team as TeamId }
  }
  const notesOf = async (p: { uid: string; token: string }): Promise<Note[]> => {
    const r = await fetch(`${FS}/games/${GAME}/inbox/${p.uid}`, { headers: { Authorization: `Bearer ${p.token}` } })
    if (r.status === 404) return []
    return ((plain(await r.json()) as { notes?: Note[] }).notes ?? [])
  }

  console.log('\n── 공지 ──')
  await must('hostNotice', host, { gameId: GAME, text: '비밀 본문 — 3층으로 모여라' })
  const n0 = await notesOf(people[0])
  check(n0[0]?.type === 'notice' && n0[0].text === '새 공지', '「새 공지」가 간다', n0[0]?.text)
  const raw = await (await fetch(`${FS}/games/${GAME}/inbox/${people[3].uid}`, { headers: { Authorization: `Bearer ${people[3].token}` } })).text()
  check(!raw.includes('비밀 본문'), '공지 본문은 안 싣는다')
  let everyone = 0
  for (const p of people) if ((await notesOf(p)).some((x) => x.type === 'notice')) everyone += 1
  check(everyone === people.length, '열넷 모두에게', String(everyone))

  console.log('\n── 태그 ──')
  const a = people[0]
  const mate = people.find((p) => p !== a && p.team === a.team)!
  const stranger = people.find((p) => p.team !== a.team)!
  await must('radio', a.token, { gameId: GAME, text: `${mate.name} 3층 창고로 와`, channel: 'team' })
  const mn = await notesOf(mate)
  check(mn[0]?.type === 'tag' && mn[0].link === 'radio', '불린 팀원에게 태그가 간다', mn[0]?.text)
  check(!JSON.stringify(mn).includes('창고'), '무슨 말인지는 안 싣는다')
  check(!(await notesOf(a)).some((x) => x.type === 'tag'), '말한 사람에게는 안 간다')
  await must('radio', a.token, { gameId: GAME, text: `${stranger.name} 너 말고`, channel: 'team' })
  check(!(await notesOf(stranger)).some((x) => x.type === 'tag'), '다른 팀 이름은 태그가 아니다')

  console.log('\n── 설정 ──')
  await must('setNotifySettings', mate.token, { gameId: GAME, settings: { on: true, modes: { tag: 'off' } } })
  const before = (await notesOf(mate)).length
  await must('radio', a.token, { gameId: GAME, text: `${mate.name} 또`, channel: 'team' })
  check((await notesOf(mate)).length === before, '태그를 끄면 안 온다')
  await must('setNotifySettings', mate.token, { gameId: GAME, settings: { on: false } })
  await must('hostNotice', host, { gameId: GAME, text: '두 번째 공지', toPlayerId: mate.uid })
  check((await notesOf(mate)).length === before, '전체를 끄면 공지도 안 온다')

  console.log('\n── 몰아치기 ──')
  const b = people[5]
  const had = (await notesOf(b)).length
  for (let i = 0; i < 7; i += 1) await must('hostNotice', host, { gameId: GAME, text: `공지 ${i}`, toPlayerId: b.uid })
  const bn = await notesOf(b)
  check(bn[0]?.text === '알림 3 건' && bn[0].count === 3, '1분에 다섯 건을 넘으면 한 줄로 묶는다', bn[0]?.text)
  check(bn.length === had + 5, '묶인 줄 하나 + 앞의 넷', String(bn.length - had))

  console.log('\n── 페이즈 ──')
  await must('openPhase', host, { gameId: GAME })
  check((await notesOf(stranger))[0]?.type === 'phaseStart', '페이즈 시작이 간다')
  await must('closePhase', host, { gameId: GAME })
  const pe = (await notesOf(stranger))[0]
  check(pe?.type === 'phaseEnd' && pe.text === '페이즈가 끝났다', '페이즈 종료 — 결과는 없다', pe?.text)

  console.log('\n── 앱 밖 · 기록 ──')
  const cfg = await must('notifyConfig', a.token, {})
  check(typeof cfg.publicKey === 'string', '공개 열쇠를 준다', String(cfg.publicKey).length + '자')
  const bad = await call('pushSubscribe', a.token, { gameId: GAME, sub: { endpoint: 'http://no', keys: {} } })
  check(!bad.ok, '이상한 구독은 거절')
  await must('pushSubscribe', a.token, { gameId: GAME, sub: { endpoint: 'https://127.0.0.1:9/push/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } })
  // 처음에는 모두 앱 안이다. 「앱 밖에서도 받기」를 고른 사람에게만 앱 밖으로 간다
  await must('setNotifySettings', a.token, { gameId: GAME, settings: { on: true, modes: { tag: 'push', phaseStart: 'push', phaseEnd: 'push', made: 'push', notice: 'push' } } })
  await must('hostNotice', host, { gameId: GAME, text: '세 번째', toPlayerId: a.uid })
  const lg = (await must('hostNotifyLog', host, { gameId: GAME })) as { rows: { type: string; channel: string; ok: boolean; target: string; err?: string }[]; fails: Record<string, { push: number }>; devices: number }
  check(lg.rows.some((r) => r.channel === 'app' && r.ok), '앱 안 기록이 남는다')
  const pushRow = lg.rows.find((r) => r.channel === 'push' && r.target === a.uid)
  check(pushRow !== undefined && pushRow.ok === false, '닿지 않는 구독은 실패로 적힌다', pushRow?.err)
  check(lg.fails.notice.push > 0, '실패 수를 센다', JSON.stringify(lg.fails.notice))
  check(lg.devices === 1, '기기 수', String(lg.devices))
  const peek = await call('hostNotifyLog', a.token, { gameId: GAME })
  check(!peek.ok, '참가자는 기록을 못 본다', peek.code)
  await must('readNotes', a.token, { gameId: GAME })
  const rd = plain(await (await fetch(`${FS}/games/${GAME}/inbox/${a.uid}`, { headers: { Authorization: `Bearer ${a.token}` } })).json()) as { notesReadAtMs?: number }
  check((rd.notesReadAtMs ?? 0) > 0, '보관함을 열면 읽은 자리가 남는다')
  check((await fetch(`${FS}/games/${GAME}/inbox/${a.uid}`, { headers: { Authorization: `Bearer ${mate.token}` } })).status === 403, '남의 보관함은 못 읽는다')

  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
