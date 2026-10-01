// 오락실 — 진짜 서버로 본다.
//
//   ㆍ 기계 앞자리에 앉아야 한다 — 고르기도, 부르기도, 받기도, 한 수도.
//     한 기계에는 한 사람이다
//   ㆍ 업다운의 숫자는 **판이 끝날 때까지 어디로도 안 간다** — 돌려받는
//     값에도, 플레이어 열쇠로 읽는 어떤 문서에도
//   ㆍ 다른 기계를 불러 방을 채운다. 인원이 모자라면 못 열고 넘치면 못 부른다
//   ㆍ 가위바위보에서 먼저 낸 수는 봉인된다 — 상대가 제 열쇠로 방 문서를
//     열어도 「냈다」만 보이고, 봉인 문서는 아예 못 연다
//   ㆍ 리듬 쌓기는 서버가 누른 기록을 다시 돌려 채점한다 — 판이 끝나기
//     전에는 안 받고, 마구 두드린 기록은 한 판도 못 깬다
//   ㆍ 끝나면 기록(arcadeDone)이 남는다 — 보상을 붙일 자리
//
// 읽기 검사는 **운영자 열쇠가 아니라 그 사람 열쇠로** 한다. 운영자 열쇠는
// 규칙을 건너뛰므로, 그걸로 「안 보인다」를 재면 규칙이 없어도 통과한다.
//
//   npx vite-node scripts/arcade-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { ARCADE_MACHINES, ARCADE_MAX_MS, UPDOWN_TRIES } from '../shared/rules/arcade'
import { BEAT_PADS, SOLO_PASS_ROUNDS, soloReplay, soloRun } from '../shared/rules/arcadeBeat'

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

/** 그 사람 열쇠로 문서를 연다. 규칙이 막으면 403 이 온다 */
async function readAs(tok: string, path: string): Promise<{ status: number; text: string }> {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${tok}` } })
  return { status: r.status, text: await r.text() }
}

/** Firestore REST 한 문서를 평평하게. 방 문서를 읽을 때만 쓴다 */
function flat(v: unknown): unknown {
  const x = v as Record<string, unknown>
  if (!x || typeof x !== 'object') return v
  if ('stringValue' in x) return x.stringValue
  if ('integerValue' in x) return Number(x.integerValue)
  if ('doubleValue' in x) return x.doubleValue
  if ('booleanValue' in x) return x.booleanValue
  if ('nullValue' in x) return null
  if ('arrayValue' in x) return ((x.arrayValue as { values?: unknown[] }).values ?? []).map(flat)
  if ('mapValue' in x) return Object.fromEntries(Object.entries((x.mapValue as { fields?: Record<string, unknown> }).fields ?? {}).map(([k, w]) => [k, flat(w)]))
  if ('fields' in x) return Object.fromEntries(Object.entries(x.fields as Record<string, unknown>).map(([k, w]) => [k, flat(w)]))
  return v
}

async function main() {
  const game = `ar${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'ar' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const [a, b, c, d] = ['qa01', 'qa02', 'qa03', 'qa04']
  const [ta, tb, tc, td] = [await tok(a), await tok(b), await tok(c), await tok(d)]
  const [ua, ub, uc] = [uidOf(a), uidOf(b), uidOf(c)]
  const room = async (id: string) => flat(await fetch(`${FS}/games/${game}/arcadeRooms/${id}`, { headers: ADMIN }).then((r) => r.json())) as {
    status: string; members: { id: string; state: string }[]; memberIds: string[]; results: Record<string, { outcome: string; line: string }> | null
    updown: { answer: number | null; left: number; guesses: { hint: string }[] } | null; seed: number; startAtMs: number
    rps: { inIds: string[]; rounds: unknown[] } | null
    deadlineMs: number | null
  }
  const [m0, m1, m2] = ARCADE_MACHINES

  console.log('\n── 앉기 ──')
  const far = await call('arcadeOpen', ta, { gameId: game, game: 'updown' })
  check(!far.ok, '앉지 않으면 못 고른다', far.ok ? '열렸다' : (far.err ?? ''))
  await must('standAt', ta, { gameId: game, x: m0.seat.x, y: m0.seat.y })
  await must('standAt', tb, { gameId: game, x: m1.seat.x, y: m1.seat.y })
  // c 는 골목에 서 있기만 한다(앉지 않았다)
  await must('standAt', tc, { gameId: game, x: m2.seat.x, y: m2.seat.y + 2 })
  const twoOnOne = await call('standAt', td, { gameId: game, x: m0.seat.x, y: m0.seat.y })
  check(!twoOnOne.ok, '한 기계에는 한 사람 — 앉은 자리에 못 끼어든다', twoOnOne.ok ? '끼어들었다' : (twoOnOne.err ?? ''))
  const onCab = await call('standAt', td, { gameId: game, x: m0.cell.x, y: m0.cell.y })
  // 물건 칸은 오류가 아니라 보통 응답 { ok: false, code: 'blocked' } 로 거절한다 — 그것도 못 선 것이다
  const cabRefused = !onCab.ok || (onCab.result.ok === false && onCab.result.code === 'blocked')
  check(cabRefused, '기계 칸 위에는 못 선다', !onCab.ok ? (onCab.err ?? '') : cabRefused ? String(onCab.result.why ?? 'blocked') : '섰다')

  console.log('\n── 업다운 ──')
  const s = await must('arcadeOpen', ta, { gameId: game, game: 'updown' })
  const soloId = String(s.roomId)
  const r0 = await room(soloId)
  check(r0.status === 'playing', '혼자 하는 게임은 고르자마자 열린다', r0.status)
  check(r0.updown?.left === UPDOWN_TRIES && r0.updown.answer === null, `처음에 ${UPDOWN_TRIES}번, 답은 없다`)
  check(r0.deadlineMs !== null && r0.deadlineMs - r0.startAtMs === ARCADE_MAX_MS, '어느 판이든 5분 마감이 선다', String((r0.deadlineMs ?? 0) - r0.startAtMs))
  // 숫자를 운영자 열쇠로만 몰래 본다 — 검사용이다
  const secret = flat(await fetch(`${FS}/games/${game}/secret/arcade/solo/${soloId}`, { headers: ADMIN }).then((r) => r.json())) as { target: number }
  const target = secret.target
  check(target >= 1 && target <= 100, '숫자는 1~100 이다', String(target))
  check(!JSON.stringify(s).includes('target'), '돌려받은 값에 숫자가 없다')
  const peek = await readAs(ta, `games/${game}/secret/arcade/solo/${soloId}`)
  check(peek.status === 403, '제 열쇠로는 숨은 숫자를 못 연다', String(peek.status))
  const mine = await readAs(ta, `games/${game}/arcadeRooms/${soloId}`)
  check(mine.status === 200 && !mine.text.includes('"target"'), '제 방 문서는 열리고, 거기에 숫자는 없다', String(mine.status))
  const other = await readAs(tb, `games/${game}/arcadeRooms/${soloId}`)
  check(other.status === 403, '남은 내 방 문서를 못 연다', String(other.status))

  const wrong = target === 1 ? 2 : target - 1
  await must('arcadeMove', ta, { gameId: game, roomId: soloId, n: wrong })
  const r1 = await room(soloId)
  check(r1.updown?.guesses.at(-1)?.hint === (wrong < target ? 'up' : 'down'), '틀리면 업/다운을 알려 준다', r1.updown?.guesses.at(-1)?.hint)
  check(r1.updown?.answer === null, '안 끝났으면 답은 여전히 없다')
  const outOfRange = await call('arcadeMove', ta, { gameId: game, roomId: soloId, n: 101 })
  check(!outOfRange.ok, '범위 밖은 안 받는다', outOfRange.ok ? '받았다' : (outOfRange.err ?? ''))
  await must('arcadeMove', ta, { gameId: game, roomId: soloId, n: target })
  const r2 = await room(soloId)
  check(r2.status === 'done' && r2.results?.[ua]?.outcome === 'win', '맞히면 이기고 판이 닫힌다', `${r2.status} ${r2.results?.[ua]?.outcome}`)
  check(r2.updown?.answer === target, '끝나면 답이 온다')
  check(r2.updown?.left === UPDOWN_TRIES - 2, '범위 밖은 횟수를 안 깎았다', String(r2.updown?.left))
  const after = await call('arcadeMove', ta, { gameId: game, roomId: soloId, n: target })
  check(!after.ok, '끝난 판에는 더 못 둔다')

  // 일어나면 못 둔다
  const s2 = await must('arcadeOpen', ta, { gameId: game, game: 'updown' })
  await must('standAt', ta, { gameId: game, x: m0.seat.x, y: m0.seat.y + 1 })
  const up = await call('arcadeMove', ta, { gameId: game, roomId: String(s2.roomId), n: 50 })
  check(!up.ok, '자리에서 일어나면 거기서 멈춘다', up.ok ? '뒀다' : (up.err ?? ''))
  await must('standAt', ta, { gameId: game, x: m0.seat.x, y: m0.seat.y })
  // 새로 고르면 하던 판은 버린다
  const s3 = await must('arcadeOpen', ta, { gameId: game, game: 'updown' })
  check((await room(String(s2.roomId))).status === 'gone', '새로 고르면 하던 판은 깨진다')
  await must('arcadeLeave', ta, { gameId: game, roomId: String(s3.roomId) })

  console.log('\n── 부르기 ──')
  const o = await must('arcadeOpen', ta, { gameId: game, game: 'rps' })
  const rpsId = String(o.roomId)
  check((await room(rpsId)).status === 'lobby', '둘이 하는 게임은 부르는 중으로 선다')
  const early = await call('arcadeBegin', ta, { gameId: game, roomId: rpsId })
  check(!early.ok, '혼자서는 못 연다', early.ok ? '열렸다' : (early.err ?? ''))
  const toStanding = await call('arcadeInvite', ta, { gameId: game, roomId: rpsId, playerId: uc })
  check(!toStanding.ok, '앉지 않은 사람은 못 부른다', toStanding.ok ? '불렀다' : (toStanding.err ?? ''))
  const byGuest = await call('arcadeInvite', tb, { gameId: game, roomId: rpsId, playerId: ub })
  check(!byGuest.ok, '고른 사람만 부른다')
  await must('arcadeInvite', ta, { gameId: game, roomId: rpsId, playerId: ub })
  const dup = await call('arcadeInvite', ta, { gameId: game, roomId: rpsId, playerId: ub })
  check(!dup.ok, '이미 부른 사람은 또 못 부른다')
  await must('standAt', tc, { gameId: game, x: m2.seat.x, y: m2.seat.y })
  const third = await call('arcadeInvite', ta, { gameId: game, roomId: rpsId, playerId: uc })
  check(!third.ok, '가위바위보는 둘까지 — 셋째는 못 부른다', third.ok ? '불렀다' : (third.err ?? ''))
  const invitedRead = await readAs(tb, `games/${game}/arcadeRooms/${rpsId}`)
  check(invitedRead.status === 200, '부름을 받은 사람은 방 문서를 연다(부름을 봐야 받는다)', String(invitedRead.status))
  const cRead = await readAs(tc, `games/${game}/arcadeRooms/${rpsId}`)
  check(cRead.status === 403, '안 불린 사람은 그 방을 못 연다', String(cRead.status))
  const notMe = await call('arcadeAnswer', tc, { gameId: game, roomId: rpsId, accept: true })
  check(!notMe.ok, '안 받은 부름에는 못 답한다')
  await must('arcadeAnswer', tb, { gameId: game, roomId: rpsId, accept: true })
  const guestBegin = await call('arcadeBegin', tb, { gameId: game, roomId: rpsId })
  check(!guestBegin.ok, '받은 사람은 시작을 못 누른다')
  await must('arcadeBegin', ta, { gameId: game, roomId: rpsId })
  check((await room(rpsId)).status === 'playing', '둘이 차면 연다')

  console.log('\n── 봉인 ──')
  await must('arcadePick', ta, { gameId: game, roomId: rpsId, pick: 'rock' })
  const seenByB = await readAs(tb, `games/${game}/arcadeRooms/${rpsId}`)
  check(seenByB.status === 200 && seenByB.text.includes(ua), '상대는 방 문서를 열고 「냈다」를 본다')
  check(!seenByB.text.includes('rock'), '**무엇을 냈는지는 방 문서에 없다**')
  const sealRead = await readAs(tb, `games/${game}/secret/arcade/seal/${rpsId}`)
  check(sealRead.status === 403, '봉인 문서는 상대가 못 연다', String(sealRead.status))
  const again = await call('arcadePick', ta, { gameId: game, roomId: rpsId, pick: 'paper' })
  check(!again.ok, '한 판에 두 번 못 낸다 — 낸 걸 못 바꾼다')
  await must('arcadePick', tb, { gameId: game, roomId: rpsId, pick: 'rock' })
  const tied = await room(rpsId)
  check(tied.status === 'playing' && (tied.rps?.rounds.length ?? 0) === 1, '둘 다 내면 펴지고, 비기면 계속한다')

  console.log('\n── 갈린다 ──')
  await must('arcadePick', tb, { gameId: game, roomId: rpsId, pick: 'scissors' })
  const half = await readAs(ta, `games/${game}/arcadeRooms/${rpsId}`)
  check(!half.text.includes('scissors'), '이번엔 b 가 먼저 — a 도 b 의 수를 못 본다')
  await must('arcadePick', ta, { gameId: game, roomId: rpsId, pick: 'rock' })
  const end = await room(rpsId)
  check(end.status === 'done', '갈리면 닫힌다')
  check(end.results?.[ua]?.outcome === 'win' && end.results?.[ub]?.outcome === 'lose', '바위가 가위를 이겼다', JSON.stringify(end.results))

  console.log('\n── 방장이 나가면 ──')
  const o2 = await must('arcadeOpen', ta, { gameId: game, game: 'rps' })
  await must('arcadeInvite', ta, { gameId: game, roomId: String(o2.roomId), playerId: ub })
  await must('arcadeLeave', ta, { gameId: game, roomId: String(o2.roomId) })
  const orphan = await call('arcadeAnswer', tb, { gameId: game, roomId: String(o2.roomId), accept: true })
  check(!orphan.ok, '고른 사람이 그만두면 그 부름은 못 받는다', orphan.ok ? '받았다' : (orphan.err ?? ''))

  console.log('\n── 리듬 쌓기 — 서버가 다시 돌려 채점한다 ──')
  const ra = String((await must('arcadeOpen', ta, { gameId: game, game: 'rhythm' })).roomId)
  const rb = String((await must('arcadeOpen', tb, { gameId: game, game: 'rhythm' })).roomId)
  const [ja, jb] = [await room(ra), await room(rb)]
  check(ja.status === 'playing' && typeof ja.seed === 'number' && ja.startAtMs > Date.now(), '고르면 씨앗과 시작 시각(셋 센 뒤)이 선다')
  // a: 두 판을 딱 맞게 치고 손을 뗀다(목숨 셋을 다 쓰고 끝) — 판마다 한 박씩 는다
  const played: { t: number; pad: number }[] = []
  let now = 0
  for (let i = 0; i < 2; i++) {
    const cur = soloRun(ja.seed, played, now).current!
    for (const n of cur.notes) played.push({ t: Math.round(cur.answerZero + n.step * cur.e), pad: n.pad })
    now = cur.closeAt + 1000
  }
  const want = soloReplay(ja.seed, played)
  const tooSoon = await call('arcadeSubmit', ta, { gameId: game, roomId: ra, log: played })
  check(!tooSoon.ok, '판이 끝나기 전에는 기록을 안 받는다', tooSoon.ok ? '받았다' : (tooSoon.err ?? ''))
  const stranger = await call('arcadeSubmit', tc, { gameId: game, roomId: ra, log: played })
  check(!stranger.ok, '남의 판에는 못 낸다')
  // b: 네 패드를 마구 두드린다
  const mash: { t: number; pad: number }[] = []
  for (let t = 0; t < 40_000; t += 40) for (let p = 0; p < BEAT_PADS; p++) mash.push({ t, pad: p })
  const endB = soloReplay(jb.seed, mash).endMs
  const wait = Math.max(ja.startAtMs + want.endMs, jb.startAtMs + endB) - Date.now() + 300
  console.log(`  (판이 끝나기를 ${Math.round(wait / 1000)}초 기다린다)`)
  await new Promise((r) => setTimeout(r, wait))
  // 화면이 「다 깼다」고 우겨도 소용없게 점수 칸을 같이 실어 본다
  await must('arcadeSubmit', ta, { gameId: game, roomId: ra, log: played, cleared: 99 })
  await must('arcadeSubmit', tb, { gameId: game, roomId: rb, log: mash })
  const [ea, eb] = [await room(ra), await room(rb)]
  // 서버가 적는 줄은 「2 판 · 최대 4 박」 꼴이다(숫자와 「판」 사이에 띄어쓰기)
  check(ea.status === 'done' && /^2 ?판/.test(ea.results?.[ua]?.line ?? ''), '두 판 깬 기록은 「2 판」 — 화면이 적은 숫자는 안 본다', ea.results?.[ua]?.line)
  check(ea.results?.[ua]?.outcome === 'lose', `${SOLO_PASS_ROUNDS}판을 못 깨면 CLEAR 가 아니다`)
  check(/^0 ?판/.test(eb.results?.[ub]?.line ?? ''), '마구 두드린 기록은 한 판도 못 깬다', eb.results?.[ub]?.line)
  const twiceSubmit = await call('arcadeSubmit', ta, { gameId: game, roomId: ra, log: played })
  check(!twiceSubmit.ok, '끝난 판에는 또 못 낸다')

  const recs = await fetch(`${FS}/games/${game}/secret/records/items?pageSize=300`, { headers: ADMIN }).then((r) => r.text())
  check(recs.includes('updown:win'), '업다운 기록이 남는다')
  check(recs.includes('rps:win') && recs.includes('rps:lose'), '대결은 양쪽에 이김·짐이 따로 남는다')
  check(recs.includes('rhythm:lose'), '리듬 쌓기도 남는다')

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  if (bad > 0) process.exitCode = 1
}

void main()
