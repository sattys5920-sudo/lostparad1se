// 엔딩 데이터를 진짜 서버로.
//
// 제일 중요한 확인은 **종례 전에는 한 줄도 안 나가는 것**이다.
// A의 시선 열넷이 먼저 새면 닷새가 무너진다.
import { TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'
import { dayHourMs } from '../shared/rules/clock'

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
async function getDoc<T = Record<string, unknown>>(p: string): Promise<T | null> {
  const r = await fetch(`${FS}/${p}`, { headers: ADMIN }); return r.ok ? (plain(await r.json()) as T) : null
}
async function getAll(p: string): Promise<{ id: string; d: Record<string, unknown> }[]> {
  const r = await fetch(`${FS}/${p}?pageSize=300`, { headers: ADMIN }); if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((d) => ({ id: d.name.split('/').pop() as string, d: plain(d) as Record<string, unknown> }))
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

const GAME = `end${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he)
  const host = (await auth(he)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'end' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const a = await auth(await signUp(`p${i}-${GAME}@x.test`))
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: `봇${i}`, team: want[i] })
  }
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  const me = people[0]
  check(true, '판이 시작했다')

  console.log('\n── 종례 전에는 ──')
  await clock(dayHourMs(START, 1, 12))
  const early = await call('endingData', me.token, { gameId: GAME })
  check(early.code === 'FAILED_PRECONDITION', 'DAY 1에는 아무것도 안 나온다', early.message)
  check(!JSON.stringify(early).includes('찢긴'), '거절 응답에도 문장이 없다')

  await clock(dayHourMs(START, 5, 20))
  await must('tick', me.token, { gameId: GAME })
  const late = await call('endingData', me.token, { gameId: GAME })
  check(late.code === 'FAILED_PRECONDITION', 'DAY 5 저녁에도 아직이다', late.message)

  console.log('\n── 종례 뒤 ──')
  await clock(dayHourMs(START, 5, 25))
  await must('tick', me.token, { gameId: GAME })
  const d = (await must('endingData', me.token, { gameId: GAME })) as Record<string, unknown>
  check(Array.isArray(d.aWords) && (d.aWords as unknown[]).length === 14, 'A의 시선 열넷', `${(d.aWords as unknown[])?.length}줄`)
  check(Array.isArray(d.aftermath) && (d.aftermath as unknown[]).length === 17, '그날의 전말 열일곱 줄', `${(d.aftermath as unknown[])?.length}줄`)
  check(Array.isArray(d.mirror) && (d.mirror as unknown[]).length === 8, '거울 규칙 여덟 줄')
  check(((d.torn as { lines: string[] }).lines ?? []).length === 4, '찢긴 한 장 네 줄')
  check(typeof (d.torn as { intro: string }).intro === 'string', '찢긴 한 장 소개가 있다', (d.torn as { intro: string }).intro)
  check(Array.isArray(d.teamResult) && (d.teamResult as unknown[]).length === 4, '팀 결과 넷')
  check((d.memoryTiles as unknown[]).length === 13, 'A의 기억 열셋이 전원에게')

  const personal = d.personal as { band: string; score: number; lines: string[] }
  check(typeof personal.band === 'string' && personal.band.length > 0, '개인 엔딩 구간이 나왔다', personal.band)
  check(personal.score >= 0 && personal.score <= 11, '개인 점수가 0~11', String(personal.score))
  check(personal.lines.length === 3, '개인 엔딩 세 줄')

  const board = d.myBoard as { name: string }[]
  check(Array.isArray(board), '내 추리 보드가 있다', `${board.length}줄`)

  console.log('\n── 남의 것이 섞였는가 ──')
  const other = people[7]
  const d2 = (await must('endingData', other.token, { gameId: GAME })) as Record<string, unknown>

  // 역할이 다르니 미션 문장도 다르다. 봇이 아무것도 안 해서 점수는
  // 둘 다 0이지만, 「각자의 미션」인지는 문장으로 갈린다
  const p1 = (d.personal as { lines: string[] }).lines[0]
  const p2 = (d2.personal as { lines: string[] }).lines[0]
  check(p1 !== p2, '사람마다 자기 미션으로 판정한다', `${p1.slice(0, 12)}… / ${p2.slice(0, 12)}…`)

  // 공동의 것은 같아야 한다
  check(JSON.stringify(d.aWords) === JSON.stringify(d2.aWords), 'A의 시선은 모두 같다')

  // 추리 노트를 한 명에게만 심고, 그 사람 보드에만 뜨는지 본다
  await fetch(`${FS}/games/${GAME}/notes/${me.uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        ownerId: { stringValue: me.uid },
        board: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    targetId: { stringValue: other.uid },
                    guess: { stringValue: 'guard' },
                    note: { stringValue: '수상하다' },
                    updatedAtMs: { integerValue: '1' },
                  },
                },
              },
            ],
          },
        },
      },
    }),
  })
  const d3 = (await must('endingData', me.token, { gameId: GAME })) as { myBoard: { name: string; guess: string }[] }
  const d4 = (await must('endingData', other.token, { gameId: GAME })) as { myBoard: unknown[] }
  check(d3.myBoard.length === 1 && d3.myBoard[0].guess === '지킴이', '내가 적은 추리가 내 보드에 뜬다', JSON.stringify(d3.myBoard))
  check(d4.myBoard.length === 0, '남의 보드에는 내 추리가 없다', `${d4.myBoard.length}줄`)

  console.log('\n── 판에 없는 사람 ──')
  const outsider = await auth(await signUp(`out-${GAME}@x.test`))
  const no = await call('endingData', outsider.token, { gameId: GAME })
  check(no.code === 'PERMISSION_DENIED', '구경꾼에게는 안 준다', no.code)
  check(!JSON.stringify(no).includes('A의'), '거절 응답에 문장이 없다')

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
