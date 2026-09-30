// 오락실 2단계 — 새 게임 일곱을 진짜 서버로 본다. **판마다 따로 기계에 앉혀
// 한꺼번에 굴린다** — 손 게임은 판이 끝나기 전 기록을 안 받으므로, 하나씩
// 하면 기다림만 몇 분이다.
//
//   ㆍ 뱀 · 1 to 50 · 두더지 — 서버가 기록을 다시 돌려 채점한다.
//     여럿이면 **다 끝날 때까지 남의 점수가 방 문서에 없다.** 끝까지 안 낸
//     사람은 마감 뒤 누구든 판을 밀면 「일어난 것」으로 친다
//   ㆍ 먼저 쏴 — 먼저 쏜 값은 봉인된다. 신호 전·100ms 안은 부정출발
//   ㆍ 눈치 게임 — 서버에 닿은 순서로 매기고, 거의 같이 닿으면 겹친다
//   ㆍ 탑 쌓기 — 차례가 아니면 못 떨어뜨리고, 차례인 사람이 사라지면
//     마감 뒤 저절로 떨어진다
//   ㆍ 둘이서 한 곡 — 따라 치고 보태면 곡에 한 박이 붙는다. 미리 낸 기록,
//     남의 차례, 보태지 않은 차례, 안 친 차례를 가려낸다
//
// 읽기 검사는 그 사람 열쇠로 한다. 운영자 열쇠는 규칙을 건너뛴다.
//
//   npx vite-node scripts/arcade2-e2e.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { ARCADE_MACHINES } from '../shared/rules/arcade'
import { DRAW_TIMEOUT_MS } from '../shared/rules/arcadeDraw'
import { fiftyBoard, fiftyStart, fiftyTap, type FiftyTap } from '../shared/rules/arcadeFifty'
import { MOLE_MS, moleSchedule } from '../shared/rules/arcadeMole'
import { NUNCHI_SAME_MS } from '../shared/rules/arcadeNunchi'
import { RELAY_GOAL, RELAY_LIVES, RELAY_START_NOTES, relayTimes, relayWho, type RelayState } from '../shared/rules/arcadeBeat'
import { SNAKE_H, SNAKE_PASS, SNAKE_W, canTurn, snakeStart, snakeStep, type SnakeDir, type SnakeGame, type SnakeInput } from '../shared/rules/arcadeSnake'
import { TOWER_GOAL, TOWER_TURN_MS, towerHitT } from '../shared/rules/arcadeTower'

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

/** 판마다 따로 적어 두었다가 끝에 차례로 찍는다 — 한꺼번에 굴리니 섞이지 않게 */
function section(title: string) {
  const lines: string[] = [`\n── ${title} ──`]
  const ok = (cond: boolean, label: string, detail = '') => {
    if (!cond) bad += 1
    lines.push(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  }
  return { ok, lines }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

interface Room {
  status: string
  members: { id: string; state: string }[]
  doneIds: string[]
  results: Record<string, { outcome: string; score: number; line: string }> | null
  seed: number
  startAtMs: number
  deadlineMs: number | null
  draw?: { round: number; signalAtMs: number; inIds: string[]; wins: Record<string, number> }
  nunchi?: { calls: { id: string; n: number }[]; clash: string[] | null; closeAtMs: number | null }
  tower?: { blocks: unknown[]; order: string[]; turn: number; turnAtMs: number; fell: boolean }
  relay?: RelayState
}

/** 뱀 — 사과까지 넓게 찾아 가는 손. 없으면 안 죽는 아무 쪽 */
const STEP: Record<SnakeDir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
function plan(g: SnakeGame): SnakeDir | null {
  const key = (x: number, y: number) => `${x},${y}`
  const body = new Set(g.body.slice(0, -1).map((c) => key(c.x, c.y)))
  const head = g.body[0]
  const seen = new Set<string>()
  const q: { x: number; y: number; first: SnakeDir }[] = []
  for (const d of Object.keys(STEP) as SnakeDir[]) {
    if (d !== g.dir && !canTurn(g, d)) continue
    const x = head.x + STEP[d][0]
    const y = head.y + STEP[d][1]
    if (x < 0 || y < 0 || x >= SNAKE_W || y >= SNAKE_H || body.has(key(x, y))) continue
    seen.add(key(x, y))
    q.push({ x, y, first: d })
  }
  const any = q[0]?.first ?? null
  while (q.length) {
    const c = q.shift()!
    if (c.x === g.food.x && c.y === g.food.y) return c.first
    for (const d of Object.keys(STEP) as SnakeDir[]) {
      const x = c.x + STEP[d][0]
      const y = c.y + STEP[d][1]
      if (x < 0 || y < 0 || x >= SNAKE_W || y >= SNAKE_H || body.has(key(x, y)) || seen.has(key(x, y))) continue
      seen.add(key(x, y))
      q.push({ x, y, first: c.first })
    }
  }
  return any
}

async function main() {
  const game = `a2${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'a2' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const ids = Array.from({ length: 14 }, (_, i) => `qa${String(i + 1).padStart(2, '0')}`)
  const T = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await tok(id)] as const))) as Record<string, string>
  const U = (id: string) => uidOf(id)
  const room = async (rid: string) => flat(await fetch(`${FS}/games/${game}/arcadeRooms/${rid}`, { headers: ADMIN }).then((r) => r.json())) as Room
  const sit = (id: string, m: number) => must('standAt', T[id], { gameId: game, x: ARCADE_MACHINES[m].seat.x, y: ARCADE_MACHINES[m].seat.y })
  const standUp = (id: string, m: number) => must('standAt', T[id], { gameId: game, x: ARCADE_MACHINES[m].seat.x, y: ARCADE_MACHINES[m].seat.y + 2 })
  /** 방 하나 열고 부르고 받고 시작까지. 첫 사람이 방장 */
  async function table(game_: string, who: string[]): Promise<string> {
    const rid = String((await must('arcadeOpen', T[who[0]], { gameId: game, game: game_ })).roomId)
    for (const o of who.slice(1)) {
      await must('arcadeInvite', T[who[0]], { gameId: game, roomId: rid, playerId: U(o) })
      await must('arcadeAnswer', T[o], { gameId: game, roomId: rid, accept: true })
    }
    if (who.length > 1) await must('arcadeBegin', T[who[0]], { gameId: game, roomId: rid })
    return rid
  }

  // ── 첫 물결: 손 게임 넷 + 먼저 쏴 (기계 아홉) ──
  const wave1 = [['qa01', 0], ['qa02', 1], ['qa03', 2], ['qa04', 3], ['qa05', 4], ['qa06', 5], ['qa07', 6], ['qa08', 7], ['qa09', 8]] as const
  for (const [id, m] of wave1) await sit(id, m)

  const snake = async () => {
    const s = section('뱀')
    const rid = String((await must('arcadeOpen', T.qa01, { gameId: game, game: 'snake' })).roomId)
    const r = await room(rid)
    s.ok(r.status === 'playing' && r.deadlineMs !== null, '혼자 하는 게임은 고르자마자 열리고 마감이 선다')
    const g = snakeStart(r.seed)
    const turns: SnakeInput[] = []
    while (g.alive && g.eaten < SNAKE_PASS + 2) {
      const d = plan(g)
      if (d && d !== g.dir) turns.push({ tick: g.tick, dir: d })
      snakeStep(g, d)
    }
    // 12개 먹은 채로 멈춰 두면 서버는 끝까지 굴리고 벽에 박는다 — 거기까지의 시간
    const early = await call('arcadeSubmit', T.qa01, { gameId: game, roomId: rid, log: turns })
    s.ok(!early.ok, '뱀이 살아 있던 시간보다 먼저 온 기록은 안 받는다', early.ok ? '받았다' : (early.err ?? ''))
    await sleep(r.startAtMs + g.timeMs + 2000 - Date.now())
    const sub = await call('arcadeSubmit', T.qa01, { gameId: game, roomId: rid, log: turns, eaten: 999 })
    s.ok(sub.ok, '시간이 차면 받는다', sub.ok ? '' : sub.err)
    const e = await room(rid)
    const got = Number(/사과 (\d+) 개/.exec(e.results?.[U('qa01')]?.line ?? '')?.[1] ?? -1)
    s.ok(e.status === 'done' && got >= g.eaten, '서버가 기록을 다시 굴려 사과를 센다 — 화면이 적은 수(999)는 안 본다', e.results?.[U('qa01')]?.line)
    s.ok(e.results?.[U('qa01')]?.outcome === (got >= SNAKE_PASS ? 'win' : 'lose'), `사과 ${SNAKE_PASS}개부터 깬 것이다`)
    return s.lines
  }

  const fifty = async () => {
    const s = section('1 to 50 — 둘이 같은 판')
    const rid = await table('oneToFifty', ['qa02', 'qa03'])
    const r = await room(rid)
    const run = (gap: number) => {
      const b = fiftyBoard(r.seed)
      let st = fiftyStart(b)
      const taps: FiftyTap[] = []
      for (let n = 1; n <= 50; n++) {
        const tap = { t: n * gap, cell: st.cells.indexOf(n) }
        taps.push(tap)
        st = fiftyTap(b, st, tap).s
      }
      return taps
    }
    const fast = run(300)
    const slow = run(500)
    await sleep(r.startAtMs + 50 * 300 + 500 - Date.now())
    await must('arcadeSubmit', T.qa02, { gameId: game, roomId: rid, log: fast })
    const mid = await readAs(T.qa03, `games/${game}/arcadeRooms/${rid}`)
    s.ok(mid.status === 200 && !mid.text.includes('15.00'), '**먼저 낸 사람의 기록이 방 문서에 없다** — 상대가 보고 맞춰 칠 수 없다')
    const peek = await readAs(T.qa03, `games/${game}/secret/arcade/score/${rid}`)
    s.ok(peek.status === 403, '봉인된 점수는 상대가 못 연다', String(peek.status))
    await sleep(r.startAtMs + 50 * 500 + 500 - Date.now())
    await must('arcadeSubmit', T.qa03, { gameId: game, roomId: rid, log: slow })
    const e = await room(rid)
    s.ok(e.results?.[U('qa02')]?.outcome === 'win' && e.results?.[U('qa03')]?.outcome === 'lose', '빨리 끝낸 쪽이 이긴다', `${e.results?.[U('qa02')]?.line} / ${e.results?.[U('qa03')]?.line}`)
    return s.lines
  }

  const mole = async () => {
    const s = section('두더지 — 끝까지 안 낸 사람')
    const rid = await table('mole', ['qa04', 'qa05'])
    const r = await room(rid)
    const taps = moleSchedule(r.seed).filter((p) => p.kind !== 'bomb').map((p) => ({ t: p.t + 40, hole: p.hole }))
    await sleep(r.startAtMs + MOLE_MS + 300 - Date.now())
    await must('arcadeSubmit', T.qa04, { gameId: game, roomId: rid, log: taps })
    const before = await call('arcadeTick', T.qa04, { gameId: game, roomId: rid })
    s.ok(before.ok && (await room(rid)).status === 'playing', '마감 전에는 밀어도 그대로다')
    await sleep((r.deadlineMs ?? 0) + 300 - Date.now())
    await must('arcadeTick', T.qa04, { gameId: game, roomId: rid })
    const e = await room(rid)
    s.ok(e.status === 'done', '마감 뒤 밀면 닫힌다')
    s.ok(e.results?.[U('qa05')]?.outcome === 'lose' && e.members.find((m) => m.id === U('qa05'))?.state === 'left', '안 낸 사람은 일어난 것으로 치고 진다')
    s.ok(e.results?.[U('qa04')]?.outcome === 'win', '낸 사람이 이긴다', e.results?.[U('qa04')]?.line)
    return s.lines
  }

  const duet = async () => {
    const s = section('둘이서 한 곡 — 번갈아 따라 치고 보태기')
    const rid = await table('duet', ['qa06', 'qa07'])
    let r = await room(rid)
    const name = (uid: string) => (uid === U('qa06') ? 'qa06' : 'qa07')
    /** 곡을 딱 맞게 따라 치고, 곡 끝 두 칸 뒤에 pad 를 보태는 손. t 는 차례가 열린 때부터 */
    const play = (st: RelayState, pad: number, add = true) => {
      const tm = relayTimes(st)
      const last = st.notes.at(-1)!.step
      const copy = st.notes.map((n) => ({ t: Math.round(tm.answerZero + n.step * tm.e - st.turnAtMs), pad: n.pad }))
      return add ? [...copy, { t: Math.round(tm.answerZero + (last + 2) * tm.e + 10 - st.turnAtMs), pad }] : copy
    }
    s.ok(r.relay?.notes.length === RELAY_START_NOTES && r.relay.lives === RELAY_LIVES, `곡은 ${RELAY_START_NOTES}박, 목숨 ${RELAY_LIVES}로 시작한다`)
    for (let i = 0; i < 3; i++) {
      r = await room(rid)
      const st = r.relay!
      const who = name(relayWho(st)!)
      const other = who === 'qa06' ? 'qa07' : 'qa06'
      if (i === 0) {
        const notMine = await call('arcadePlay', T[other], { gameId: game, roomId: rid, move: { taps: play(st, 1) } })
        s.ok(!notMine.ok, '내 차례가 아니면 못 낸다', notMine.ok ? '냈다' : (notMine.err ?? ''))
        const early = await call('arcadePlay', T[who], { gameId: game, roomId: rid, move: { taps: play(st, 1) } })
        s.ok(!early.ok, '곡을 다 듣고 치기 전에 미리 낸 기록은 안 받는다', early.ok ? '받았다' : (early.err ?? ''))
      }
      await sleep(relayTimes(st).closeAt + 100 - Date.now())
      await must('arcadePlay', T[who], { gameId: game, roomId: rid, move: { taps: play(st, i % 4) } })
      const after = (await room(rid)).relay!
      s.ok(after.notes.length === st.notes.length + 1 && after.notes.at(-1)!.pad === i % 4 && relayWho(after) !== relayWho(st), `${i + 1}번째 차례 — 따라 치고 보태면 한 박이 붙고 차례가 넘어간다`, `${after.notes.length}박`)
    }
    // 보태지 않고 따라만 친다 → 틀린 것
    r = await room(rid)
    let st = r.relay!
    await sleep(relayTimes(st).closeAt + 100 - Date.now())
    await must('arcadePlay', T[name(relayWho(st)!)], { gameId: game, roomId: rid, move: { taps: play(st, 0, false) } })
    let after = (await room(rid)).relay!
    s.ok(after.lives === RELAY_LIVES - 1 && after.notes.length === st.notes.length, '보태지 않으면 틀린 것 — 곡은 그대로, 목숨 하나')
    // 가만히 있다 → 마감 뒤 누구든 밀면 틀린 것
    for (let k = 0; k < 2; k++) {
      st = (await room(rid)).relay!
      const dl = (await room(rid)).deadlineMs ?? 0
      await sleep(dl + 300 - Date.now())
      await must('arcadeTick', T.qa06, { gameId: game, roomId: rid })
    }
    const e = await room(rid)
    s.ok(e.status === 'done', '목숨을 다 쓰면 끝난다(안 친 차례는 마감 뒤 틀린 것)')
    const res = [e.results?.[U('qa06')], e.results?.[U('qa07')]]
    s.ok(res.every((x) => x?.outcome === 'lose' && x.line.startsWith(`${RELAY_START_NOTES + 3} 박`)), `${RELAY_GOAL}박을 못 채우면 다 같이 진다`, res[0]?.line)
    return s.lines
  }

  const draw = async () => {
    const s = section('먼저 쏴')
    const rid = await table('quickdraw', ['qa08', 'qa09'])
    let r = await room(rid)
    const early = await call('arcadePlay', T.qa08, { gameId: game, roomId: rid, move: { round: 0, shot: 250 } })
    // 신호 전에 닿았다 — 화면이 250ms 라고 적어도 부정출발이다
    s.ok(early.ok, '신호 전에 쏜 것도 받는다(부정출발로)')
    await sleep((r.draw?.signalAtMs ?? 0) + 300 - Date.now())
    await must('arcadePlay', T.qa09, { gameId: game, roomId: rid, move: { round: 0, shot: 320 } })
    r = await room(rid)
    s.ok(r.draw?.round === 1 && r.draw.wins[U('qa09')] === 1, '부정출발한 쪽이 판을 내준다')
    // 둘째 판: 봉인
    await sleep((r.draw?.signalAtMs ?? 0) + 300 - Date.now())
    await must('arcadePlay', T.qa08, { gameId: game, roomId: rid, move: { round: 1, shot: 187 } })
    const sealed = await readAs(T.qa09, `games/${game}/arcadeRooms/${rid}`)
    s.ok(sealed.text.includes(U('qa08')) && !sealed.text.includes('187'), '먼저 쏜 값은 방 문서에 없다 — 「쐈다」만 보인다')
    const sealRead = await readAs(T.qa09, `games/${game}/secret/arcade/seal/${rid}`)
    s.ok(sealRead.status === 403, '봉인은 상대가 못 연다', String(sealRead.status))
    const again = await call('arcadePlay', T.qa08, { gameId: game, roomId: rid, move: { round: 1, shot: 150 } })
    s.ok(!again.ok, '한 판에 두 번 못 쏜다')
    const stale = await call('arcadePlay', T.qa09, { gameId: game, roomId: rid, move: { round: 0, shot: 150 } })
    s.ok(!stale.ok, '지난 판 번호로는 못 쏜다')
    await must('arcadePlay', T.qa09, { gameId: game, roomId: rid, move: { round: 1, shot: 50 } })
    r = await room(rid)
    s.ok(r.draw?.wins[U('qa08')] === 1, '100ms 보다 빠르면 부정출발 — 187ms 가 이긴다')
    // 셋째 판: 한 사람이 안 쏜다 → 마감 뒤 밀면 쏜 쪽이 이긴다
    await sleep((r.draw?.signalAtMs ?? 0) + 300 - Date.now())
    await must('arcadePlay', T.qa08, { gameId: game, roomId: rid, move: { round: 2, shot: 240 } })
    await sleep((r.draw?.signalAtMs ?? 0) + DRAW_TIMEOUT_MS + 400 - Date.now())
    await must('arcadeTick', T.qa08, { gameId: game, roomId: rid })
    const e = await room(rid)
    s.ok(e.status === 'done' && e.results?.[U('qa08')]?.outcome === 'win', '안 쏜 채 마감이 지나면 쏜 쪽이 판을 따고 2:1 로 끝난다', e.results?.[U('qa08')]?.line)
    return s.lines
  }

  const first = await Promise.all([snake(), fifty(), mole(), duet(), draw()])

  // ── 둘째 물결: 눈치 게임·탑 쌓기 (기계 다섯) ──
  for (const [id, m] of wave1) await standUp(id, m)
  const wave2 = [['qa10', 0], ['qa11', 1], ['qa12', 2], ['qa13', 3], ['qa14', 4]] as const
  for (const [id, m] of wave2) await sit(id, m)

  const nunchi = async () => {
    const s = section('눈치 게임')
    const rid = await table('nunchi', ['qa10', 'qa11', 'qa12'])
    let r = await room(rid)
    const soon = await call('arcadePlay', T.qa10, { gameId: game, roomId: rid })
    s.ok(!soon.ok, '시작 전에는 못 외친다', soon.ok ? '외쳤다' : (soon.err ?? ''))
    await sleep(r.startAtMs + 300 - Date.now())
    await must('arcadePlay', T.qa10, { gameId: game, roomId: rid })
    await sleep(NUNCHI_SAME_MS + 400)
    await must('arcadePlay', T.qa11, { gameId: game, roomId: rid })
    r = await room(rid)
    s.ok(r.nunchi?.calls.map((c) => c.n).join(',') === '1,2', '서버가 닿은 순서로 1, 2 를 매긴다')
    await sleep((r.deadlineMs ?? 0) + 200 - Date.now())
    await must('arcadeTick', T.qa12, { gameId: game, roomId: rid })
    const e = await room(rid)
    s.ok(e.results?.[U('qa12')]?.outcome === 'lose' && e.results?.[U('qa10')]?.outcome === 'win', '셋이면 2 까지 — 못 외친 사람이 진다')
    // 겹치기. **에뮬레이터는 동시에 온 둘째 요청에 일꾼을 새로 띄운다** —
    // 그 기동이 겹침 창(600ms)보다 길 때가 있어서, 미리 둘을 깨워 둔다
    await Promise.all([0, 1].map(() => call('arcadePlay', T.qa10, { gameId: game, roomId: 'warm' })))
    const rid2 = await table('nunchi', ['qa10', 'qa11', 'qa12'])
    const r2 = await room(rid2)
    await sleep(r2.startAtMs + 300 - Date.now())
    await Promise.all([
      must('arcadePlay', T.qa10, { gameId: game, roomId: rid2 }),
      must('arcadePlay', T.qa12, { gameId: game, roomId: rid2 }),
    ])
    const e2 = await room(rid2)
    s.ok(e2.status === 'done' && e2.results?.[U('qa10')]?.outcome === 'lose' && e2.results?.[U('qa12')]?.outcome === 'lose' && e2.results?.[U('qa11')]?.outcome === 'win', '거의 같이 외치면 겹쳐 둘 다 진다', e2.nunchi?.calls.map((c) => c.n).join(','))
    return s.lines
  }

  const tower = async () => {
    const s = section('탑 쌓기')
    const rid = await table('tower', ['qa13', 'qa14'])
    let r = await room(rid)
    const who = (x: Room) => x.tower!.order[x.tower!.turn % x.tower!.order.length]
    await sleep(r.startAtMs + 100 - Date.now())
    const notMine = await call('arcadePlay', T.qa14, { gameId: game, roomId: rid, move: { t: 100 } })
    s.ok(!notMine.ok, '내 차례가 아니면 못 떨어뜨린다', notMine.ok ? '떨어뜨렸다' : (notMine.err ?? ''))
    for (let i = 0; i < TOWER_GOAL; i++) {
      r = await room(rid)
      await sleep(r.tower!.turnAtMs + 50 - Date.now())
      const me = who(r) === U('qa13') ? 'qa13' : 'qa14'
      // 아래 블록 한가운데에 닿는 때 — 딱 맞는다
      const blocks = r.tower!.blocks as { x: number }[]
      const t = towerHitT(blocks.length - 1, blocks[blocks.length - 1].x)
      await sleep(r.tower!.turnAtMs + t - Date.now())
      await must('arcadePlay', T[me], { gameId: game, roomId: rid, move: { t } })
    }
    r = await room(rid)
    s.ok(r.tower?.blocks.length === TOWER_GOAL + 1 && !r.tower.fell, `돌아가며 ${TOWER_GOAL}층을 쌓았다`)
    // 차례인 사람이 가만히 있으면 마감 뒤 저절로 떨어진다(끝까지 흔들린 자리)
    await sleep(r.tower!.turnAtMs + TOWER_TURN_MS + 400 - Date.now())
    await must('arcadeTick', T.qa13, { gameId: game, roomId: rid })
    const after = await room(rid)
    s.ok((after.tower?.turn ?? 0) > (r.tower?.turn ?? 0), '차례인 사람이 가만히 있으면 마감 뒤 저절로 떨어진다')
    // 끝에서(차례가 열린 그 순간) 떨어뜨려 무너뜨린다
    let e = after
    for (let i = 0; i < 6 && e.status === 'playing'; i++) {
      await sleep(e.tower!.turnAtMs + 50 - Date.now())
      const me = who(e) === U('qa13') ? 'qa13' : 'qa14'
      await call('arcadePlay', T[me], { gameId: game, roomId: rid, move: { t: 0 } })
      e = await room(rid)
    }
    s.ok(e.status === 'done' && e.tower?.fell === true, '하나도 안 겹치면 무너지고 끝난다')
    s.ok(e.results?.[U('qa13')]?.outcome === 'win' && e.results?.[U('qa14')]?.outcome === 'win', `${TOWER_GOAL}층을 넘겼으니 다 같이 깬다`, e.results?.[U('qa13')]?.line)
    return s.lines
  }

  const second = await Promise.all([nunchi(), tower()])
  for (const lines of [...first, ...second]) console.log(lines.join('\n'))

  const recs = await fetch(`${FS}/games/${game}/secret/records/items?pageSize=300`, { headers: ADMIN }).then((r) => r.text())
  const games = ['snake', 'oneToFifty', 'mole', 'duet', 'quickdraw', 'nunchi', 'tower']
  const missing = games.filter((g) => !recs.includes(`${g}:`))
  check(missing.length === 0, '일곱 게임 다 끝난 판 기록이 남는다', missing.join(','))

  console.log(bad === 0 ? '\n다 맞았다.' : `\n${bad}개 틀렸다.`)
  if (bad > 0) process.exitCode = 1
}

void main()
