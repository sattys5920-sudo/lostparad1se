// 되짚기 — 이적 이력과 투명인간 투표 결과.
//
// 개인 미션 v3 의 공통 규칙은 「그 사건이 일어난 **시점의** 팀」이다.
// 그런데 팀 값은 덮어써진다 — 명단은 새 팀으로 갈리고, 말에는
// teamSinceMs 하나뿐이라 두 번 옮기면 첫 번째가 사라진다. 그래서
// 옮길 때마다 한 줄을 남긴다. 여기서 그 줄을 본다.
//
// 투명인간 투표도 마찬가지다. 뒷자리는 「내가 적은 이름이 실제로
// 지워진 날」을 세고 **동률로 무효가 된 날은 안 센다**. 전에는 그
// 사유가 계산만 되고 버려져서, 아무도 안 지워진 날이 왜인지 알 수
// 없었다.
//
//   npx vite-node scripts/trace-e2e.ts
import { dayHourMs } from '../shared/rules/clock'
import { createHash } from 'node:crypto'

import { of as recOf, records } from './lib/records'
import { centerOf } from '../src/school/map/world'
import type { TileId } from '../shared/rules/board'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const GAME = `tr${Date.now()}`

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

let bad = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

interface Res { ok: boolean; data?: Record<string, unknown>; code?: string; message?: string }
async function call(n: string, tk: string, d: unknown): Promise<Res> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) return { ok: false, code: j.error.status, message: j.error.message }
  return { ok: true, data: j.result ?? {} }
}
async function must(n: string, tk: string, d: unknown): Promise<Record<string, unknown>> {
  const r = await call(n, tk, d)
  if (!r.ok) throw new Error(`${n}: ${r.code} ${r.message}`)
  return r.data as Record<string, unknown>
}

async function hostToken(): Promise<string> {
  const email = `trc-${Date.now()}@x.test`
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

/** QA 계정으로 들어간다. seedPlayers 가 열넷을 앉혀 둔다 */
async function tok(id: string): Promise<string> {
  const r = await fetch(`${FN}/logInAccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { id, password: QA_PW } }),
  })
  const j = (await r.json()) as { result?: { token?: string }; error?: { message: string } }
  if (j.error) throw new Error(`logInAccount ${id}: ${j.error.message}`)
  const custom = j.result?.token as string
  const inn = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
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
/** 문서 아이디도 같이 준다 — 말의 아이디가 곧 사람이다 */
async function docsIn(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${FS}/games/${GAME}/${path}?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: { name: string }[] }
  return (j.documents ?? []).map((d) => ({
    ...(plain(d) as Record<string, unknown>),
    id: d.name.split('/').pop() as string,
  }))
}
async function pawnOf(uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })
  return plain(await r.json()) as Record<string, unknown>
}

/** 두 사람을 같은 칸에 나란히 세운다. 이적은 마주 서야 꺼낸다 */
async function standTogether(a: string, b: string, tileId: string, cell: { x: number; y: number }): Promise<void> {
  for (const [uid, at] of [
    [a, cell],
    [b, { x: cell.x + 1, y: cell.y }],
  ] as const) {
    await fetch(
      `${FS}/games/${GAME}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=postTile&updateMask.fieldPaths=at&updateMask.fieldPaths=arriveAtMs&updateMask.fieldPaths=path`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ADMIN },
        body: JSON.stringify({
          fields: {
            tileId: { stringValue: tileId },
            postTile: { stringValue: tileId },
            at: { mapValue: { fields: { x: { integerValue: String(at.x) }, y: { integerValue: String(at.y) } } } },
            arriveAtMs: { nullValue: null },
            path: { arrayValue: { values: [] } },
          },
        }),
      },
    )
  }
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}\n── 판 세우기 ──`)
  const host = await hostToken()
  await must('createGame', host, { gameId: GAME, seed: 'trace' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  // 이적은 DAY 2 부터 꺼낼 수 있다
  await clock(dayHourMs(START, 2, 10))
  await must('tick', host, { gameId: GAME })
  check(true, '열넷 · DAY 2')

  console.log('\n── 팀이 바뀐 순간이 남는가 ──')
  /*
   * A팀 사람이 B팀 사람을 데려온다. 팀 값은 **다음 페이즈가 열릴 때**
   * 바뀐다 — 합의한 자리에서 바로 안 옮긴다
   */
  /*
   * **팀은 씨앗이 정한다.** qa01·qa05 로 짚으면 같은 팀이 나오는 판이
   * 있다 — 말을 읽어서 다른 팀 둘을 고른다
   */
  const all = await docsIn('pawns')
  /*
   * **말의 아이디는 해시다.** 자리표의 이름은 「가온」 같은 보이는
   * 이름이라 로그인에 못 쓴다 — qa01..qa14 를 해시해서 되짚는다
   */
  const nameOf = new Map(
    Array.from({ length: 14 }, (_, i) => `qa${String(i + 1).padStart(2, '0')}`).map((id) => [uidOf(id), id]),
  )
  check(all.every((p) => nameOf.has(String(p.id))), '열넷이 다 QA 계정이다')
  const byTeam = new Map<string, string[]>()
  for (const p of all) {
    const t = String(p.team)
    byTeam.set(t, [...(byTeam.get(t) ?? []), String(p.id)])
  }
  // 떠날 팀에 둘 이상 남아야 한다 — 팀이 비면 이적이 막힌다
  const teams = [...byTeam.entries()].filter(([, ids]) => ids.length >= 2)
  check(teams.length >= 2, '둘 이상 남는 팀이 둘은 있다', `${teams.length}팀`)
  const a = teams[0][1][0]
  const b = teams[1][1][0]
  const aTeam = teams[0][0]
  const bTeam = teams[1][0]
  const aTok = await tok(nameOf.get(a) as string)
  const bTok = await tok(nameOf.get(b) as string)
  check(aTeam !== bTeam, '둘이 다른 팀이다', `${aTeam} · ${bTeam}`)

  const spot = centerOf(String((await pawnOf(a)).tileId) as TileId)
  await standTogether(a, b, String((await pawnOf(a)).tileId), spot)
  const asked = await must('askTransfer', aTok, { gameId: GAME, toPlayerId: b })
  await must('answerTransfer', bTok, { gameId: GAME, askId: String(asked.id), accept: true })
  check(String((await pawnOf(b)).team) === bTeam, '합의만으로는 안 바뀐다 — 다음 페이즈다')

  await must('openPhase', host, { gameId: GAME })
  check(String((await pawnOf(b)).team) === aTeam, '페이즈가 열리며 팀이 바뀌었다', String((await pawnOf(b)).team))

  const log = await records(GAME)
  const moves = recOf(log, 'teamMoved', b)
  check(moves.length === 1, '이적이 한 줄 남았다', `${moves.length}줄`)
  check(moves[0]?.actorTeam === aTeam, '옮겨 간 팀이 적힌다', String(moves[0]?.actorTeam))
  check(moves[0]?.otherTeam === bTeam, '**떠나온 팀도 적힌다** — 말에는 이 값이 안 남는다', String(moves[0]?.otherTeam))
  check(typeof moves[0]?.atMs === 'number' && moves[0].atMs > START, '언제 바뀌었는지가 적힌다')

  console.log('\n── 투표 결과가 남는가 ──')
  /*
   * **동률이면 아무도 안 지워진다.** 그 하루를 뒷자리는 안 센다 —
   * 「아무도 안 지워졌다」가 동률 때문인지 표가 모자라서인지가
   * 갈려 있어야 셀 수 있다
   */
  await must('closePhase', host, { gameId: GAME })
  /*
   * **표는 그날 마지막 페이즈가 닫힐 때 센다.** 하루는 열 페이즈라
   * 스무 번째가 DAY 2 의 끝이다. 거기까지 밀고 나서 적는다 — 아무
   * 페이즈에서나 적고 닫으면 세는 자리에 안 걸린다
   */
  let phaseNo = 0
  for (let i = 0; i < 24; i++) {
    const open = await must('openPhase', host, { gameId: GAME })
    phaseNo = Number(open.no)
    if (phaseNo % 10 === 0) break
    await must('closePhase', host, { gameId: GAME })
  }
  check(phaseNo % 10 === 0, '그날 마지막 페이즈까지 밀었다', `${phaseNo}번째`)

  // 한 사람에게 몰아준다. 몰아주면 그 사람이 지워진다
  const voters = all.map((p) => String(p.id)).filter((id) => id !== a && id !== b)
  const victim = voters[voters.length - 1]
  for (const who of voters.slice(0, 5)) {
    if (who === victim) continue
    const t = await tok(nameOf.get(who) as string)
    const r = await call('castBallot', t, { gameId: GAME, targetId: victim })
    if (!r.ok) console.log(`    (${nameOf.get(who)} 못 적었다 — ${r.message})`)
  }
  const ballots = await docsIn('secret/ballots/items')
  check(ballots.length >= 3, '표가 쌓였다', `${ballots.length}장`)
  check(
    ballots.every((x) => typeof x.voterTeam === 'string' && typeof x.targetTeam === 'string'),
    '**적은 그 순간의 두 팀이 표마다 적힌다**',
    String(ballots[0]?.voterTeam),
  )

  // 닫는 순간 센다
  await must('closePhase', host, { gameId: GAME })
  const days = await docsIn('secret/ballotDays/items')
  check(days.length >= 1, '그날 결과가 한 장 남았다', `${days.length}장`)
  const row = days[0]
  console.log(`    (남은 줄 — day ${String(row?.day)} · ${String(row?.reason)} · ${String(row?.invisibleId)})`)
  check(typeof row?.reason === 'string' && String(row.reason).length > 0, '왜 그렇게 됐는지가 적힌다', String(row?.reason))
  /*
   * **표가 실제로 세어졌는가.** 몰아준 사람이 지워져야 한다.
   * 안 지워졌다면 표의 날짜와 세는 쪽의 날짜가 어긋난 것이다 —
   * 적을 때는 시계에서 날을 읽고, 셀 때는 페이즈 번호에서 읽는다
   */
  check(
    row?.invisibleId === victim,
    '몰아준 사람이 지워졌다 — 표가 세어졌다',
    `${String(row?.invisibleId)} · ${String(row?.reason)}`,
  )
  const ballotDay = Number((ballots[0] as { day?: number })?.day ?? -1)
  check(Number(row?.day) === ballotDay, '표를 적은 날과 센 날이 같다', `센 날 ${String(row?.day)} · 적은 날 ${ballotDay}`)

  console.log('\n── 아무도 못 읽는다 ──')
  for (const [path, label] of [
    ['secret/ballots/items', '표'],
    ['secret/ballotDays/items', '그날 결과'],
    ['secret/records/items', '기록'],
  ] as const) {
    const asPlayer = await fetch(`${FS}/games/${GAME}/${path}`, { headers: { Authorization: `Bearer ${aTok}` } })
    check(asPlayer.status === 403, `플레이어가 ${label}를 못 읽는다`, String(asPlayer.status))
    const asHost = await fetch(`${FS}/games/${GAME}/${path}`, { headers: { Authorization: `Bearer ${host}` } })
    check(asHost.status === 403, `운영자도 ${label}를 못 읽는다`, String(asHost.status))
  }

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  process.exit(bad === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
