// 한 페이즈를 손으로 짜서 넣고 결과를 본다.
//
// 열넷이 어디로 갔는지를 적어 주면 그대로 세워서 페이즈를 닫는다.
// **판정은 서버가 한다** — 여기서 세지 않는다. 머리로 푼 답과
// 서버가 낸 답이 갈리면, 갈린 그 자리가 볼 만한 자리다.
//
//   npx vite-node scripts/qa-scenario.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID, type TileId } from '../shared/rules/board'
import { capacityOf } from '../shared/rules/occupy'
import { coreOpen } from '../shared/rules/fragments'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

/**
 * 누가 어디로 갔는가. **사람 이름은 팀 안에서의 자리로 푼다** —
 * 「같은 팀 셋, 그중 팀장이 a」이면 세 명짜리 팀의 팀장이 a다.
 */
const PLAN: { team: 'three' | 'four'; who: string[]; to: TileId[] }[] = [
  // 같은 팀 · 팀장 a — 과학실 / 음악실 / 과학실
  { team: 'three', who: ['a', 'b', 'c'], to: ['scienceRoom', 'musicRoom', 'scienceRoom'] },
  // 같은 팀 넷 — 과학실 / 도서관 / 과학실 / 정원
  { team: 'four', who: ['d', 'e', 'f', 'g'], to: ['scienceRoom', 'library', 'scienceRoom', 'garden'] },
  // 같은 팀 · 팀장 h — 화장실 / 화장실 / 무용실
  { team: 'three', who: ['h', 'i', 'j'], to: ['baseB', 'baseB', 'newBuilding'] },
  // 같은 팀 넷 — 무용실 / 동아리실 / 가사실 / 음악실
  { team: 'four', who: ['k', 'l', 'm', 'n'], to: ['newBuilding', 'clubRoom', 'hallway', 'musicRoom'] },
]

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null
const num = (f: unknown): number => Number((f as { integerValue?: string })?.integerValue ?? 0)
const bool = (f: unknown): boolean => (f as { booleanValue?: boolean })?.booleanValue === true

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
  const email = `sc-${tag}@x.test`
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
async function pawns(game: string) {
  const r = await fetch(`${FS}/games/${game}/pawns`, { headers: ADMIN })
  const docs = ((await r.json()) as { documents?: { name: string; fields?: Record<string, unknown> }[] }).documents ?? []
  return docs.map((d) => ({
    uid: d.name.split('/').pop() as string,
    team: str(d.fields?.team) ?? '?',
    tileId: str(d.fields?.tileId),
    captain: bool(d.fields?.captain),
  }))
}
async function tiles(game: string) {
  const r = await fetch(`${FS}/games/${game}/tiles`, { headers: ADMIN })
  const docs = ((await r.json()) as { documents?: { name: string; fields?: Record<string, unknown> }[] }).documents ?? []
  return new Map(docs.map((d) => [d.name.split('/').pop() as TileId, str(d.fields?.ownerTeam)]))
}

async function main() {
  const game = `sc${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'scenario' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  // 씨앗이 나눈 팀에 a~n 을 얹는다. 세 명짜리 팀 둘, 네 명짜리 팀 둘
  const all = await pawns(game)
  const byTeam = new Map<string, typeof all>()
  for (const p of all) byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p])
  const threes = [...byTeam.entries()].filter(([, m]) => m.length === 3).map(([t]) => t)
  const fours = [...byTeam.entries()].filter(([, m]) => m.length === 4).map(([t]) => t)

  /** 이름 → 그 사람의 uid·팀. 팀장은 서버가 이미 3인 팀에 세워 두었다 */
  const cast = new Map<string, { uid: string; team: string; to: TileId; captain: boolean }>()
  let ti = 0
  let fi = 0
  for (const row of PLAN) {
    const team = row.team === 'three' ? threes[ti++] : fours[fi++]
    const members = [...(byTeam.get(team) ?? [])]
    // **팀장을 맨 앞으로.** 「팀장 a」라고 했으니 a 가 팀장이어야 한다
    members.sort((x, y) => Number(y.captain) - Number(x.captain))
    row.who.forEach((name, i) => {
      cast.set(name, { uid: members[i].uid, team, to: row.to[i], captain: members[i].captain })
    })
  }

  console.log('── 누가 어느 팀인가 ──')
  for (const [name, c] of cast) {
    console.log(`  ${name}  ${c.team}팀${c.captain ? ' · 팀장(머릿수 둘)' : '        '}  → ${TILE_BY_ID[c.to].name}`)
  }

  console.log('\n── 페이즈를 연다 ──')
  const opened = await must('openPhase', host, { gameId: game })
  console.log(`  ${opened.no}번 페이즈 · 팀 상자 ${opened.granted} 씩`)

  console.log('\n── 각자 움직인다 ──')
  for (const [name, c] of cast) {
    const r = await call('phaseAct', await tok(idOf(c.uid)), { gameId: game, kind: 'move', targetTile: c.to })
    if (!r.ok) console.log(`  ✗ ${name} → ${TILE_BY_ID[c.to].name} — ${r.err}`)
  }

  // 문 하나에 10분. 다 들어서고 나서 닫는다
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10) + 20 * 60_000, speed: 60 })
  await must('tick', host, { gameId: game })

  console.log('\n── 닫기 직전, 방마다 누가 서 있나 ──')
  const now = await pawns(game)
  const uidName = new Map([...cast].map(([n, c]) => [c.uid, n]))
  const here = new Map<TileId, { name: string; team: string; head: number }[]>()
  for (const p of now) {
    const name = uidName.get(p.uid)
    if (!name || p.tileId === null) continue
    const t = p.tileId as TileId
    here.set(t, [...(here.get(t) ?? []), { name, team: p.team, head: p.captain ? 2 : 1 }])
  }
  const before = await tiles(game)
  for (const [t, people] of here) {
    const w = new Map<string, number>()
    for (const p of people) w.set(p.team, (w.get(p.team) ?? 0) + p.head)
    const desc = people.map((p) => `${p.name}(${p.team}${p.head === 2 ? '·팀장' : ''})`).join(' ')
    const tally = [...w].map(([t2, n]) => `${t2} ${n}`).join(' vs ')
    console.log(
      `  ${TILE_BY_ID[t].name.padEnd(5, '　')} 정원 ${capacityOf(t)} · ${desc}  →  머릿수 ${tally}` +
        (coreOpen(t, 1) ? '' : '  ※ 아직 안 열린 핵심'),
    )
  }
  const walking = now.filter((p) => uidName.has(p.uid) && p.tileId === null).length
  if (walking > 0) console.log(`  ✗ 아직 걷는 사람 ${walking}`)

  console.log('\n── 페이즈를 닫는다 ──')
  const closed = await must('closePhase', host, { gameId: game })
  console.log(`  점령 ${closed.captured}건`)

  const after = await tiles(game)
  console.log('\n── 결과 ──')
  for (const [t] of here) {
    const was = before.get(t) ?? null
    const is = after.get(t) ?? null
    const mark = is === null ? '주인 없음' : `${is}팀`
    const why = is === was ? (is === null ? '(동점 — 아무도 못 가져갔다)' : '(그대로)') : '(새 주인)'
    console.log(`  ${TILE_BY_ID[t].name.padEnd(5, '　')} → ${mark} ${why}`)
  }
  // 토큰도 본다. 이동 한 번에 하나이니 셋 움직인 팀은 셋이 남는다
  const tr = await fetch(`${FS}/games/${game}/teams`, { headers: ADMIN })
  const tdocs = ((await tr.json()) as { documents?: { name: string; fields?: Record<string, unknown> }[] }).documents ?? []
  const spent = new Map<string, number>()
  for (const [, c] of cast) spent.set(c.team, (spent.get(c.team) ?? 0) + 1)
  console.log('\n  남은 팀 토큰')
  for (const d of tdocs) {
    const t = d.name.split('/').pop() as string
    if (!spent.has(t)) continue
    console.log(`    ${t}팀 ${num(d.fields?.phaseTokens)} — ${spent.get(t)}명이 한 번씩 움직였다`)
  }

  const owned = [...after].filter(([, o]) => o !== null)
  const tally = new Map<string, number>()
  for (const [, o] of owned) tally.set(o as string, (tally.get(o as string) ?? 0) + 1)
  console.log(`\n  판 전체에서 주인 있는 칸 ${owned.length} — ${[...tally].map(([t, n]) => `${t}팀 ${n}`).join(' · ')}`)
}

/** uid 로 qa 아이디를 되찾는다. 씨앗이 qa01..qa14 로 만든다 */
function idOf(uid: string): string {
  for (let i = 1; i <= 14; i++) {
    const id = `qa${String(i).padStart(2, '0')}`
    if (uidOf(id) === uid) return id
  }
  throw new Error(`모르는 사람 ${uid}`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
