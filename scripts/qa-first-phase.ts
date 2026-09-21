// 열넷이 가입하고, 배정되고, 운영자가 바로 첫 페이즈를 연다.
//
// **묻는 것은 하나다: 그래서 지금 각자 무엇을 하나.**
//
// 시험이 아니라 둘러보기다. 규칙이 옳은지가 아니라, 종이 친 그 순간
// 열네 사람의 화면에 **할 일이 있는지**를 본다. 아무것도 할 게 없는
// 사람이 하나라도 있으면 그 자리가 이 게임의 구멍이다.
//
//   npx vite-node scripts/qa-first-phase.ts
import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { TILE_BY_ID, FLOOR_NAME, ROAM_TO, type TileId } from '../shared/rules/board'
import { ACT_COST, TOKENS_PER_PHASE, TOKEN_CAP } from '../shared/rules/occupy'
import { SHOP_ITEMS, VENDINGS, atVending, priceOf } from '../shared/rules/shop'
import { ITEM_BY_KIND, type ItemKind } from '../shared/rules/items'
import { GARDEN_TILE } from '../shared/rules/crop'
import { coreOpen } from '../shared/rules/fragments'
import { BOARDS } from '../shared/rules/errand'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

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
  const email = `qa-${tag}@x.test`
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

// ── 몫 읽기 ────────────────────────────────────────────────────
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null
const num = (f: unknown): number => Number((f as { integerValue?: string })?.integerValue ?? 0)
const mapOf = (f: unknown): Record<string, unknown> =>
  (f as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields ?? {}
const arr = (f: unknown): Record<string, unknown>[] =>
  ((f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue?.values ?? [])
    .map((x) => x.mapValue?.fields ?? {})

async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
async function pawnOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}

const IDS = Array.from({ length: 14 }, (_, i) => `qa${String(i + 1).padStart(2, '0')}`)

async function main() {
  const game = `qafp${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)

  console.log('── 판을 세운다 ──')
  await must('createGame', host, { gameId: game, seed: 'qa-first' })
  // seedPlayers 는 열넷을 만들어 넣는다. 사람이 하나씩 가입하는 것과
  // 같은 길로 간다 — 자리가 차는 순간 역할이 나뉜다
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  console.log(`  열넷이 찼다 — 판 ${game}`)

  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  console.log('  닷새가 시작됐다 — DAY 1')

  console.log('\n── 운영자가 바로 첫 페이즈를 연다 ──')
  const opened = await call('openPhase', host, { gameId: game })
  console.log(opened.ok ? `  열렸다 — ${JSON.stringify(opened.result)}` : `  ✗ 못 열었다 — ${opened.err}`)

  const g = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  const gf = ((await g.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  console.log(`  날 ${num(gf.day)} · 페이즈 ${str(gf.phase)} · 끝난 페이즈 ${num(gf.phaseDone)}`)

  // ── 판 전체의 자리 ──────────────────────────────────────────
  console.log('\n── 판이 차려진 모양 ──')
  const tiles = await fetch(`${FS}/games/${game}/tiles`, { headers: ADMIN })
  const tdocs = ((await tiles.json()) as { documents?: { name: string; fields?: Record<string, unknown> }[] }).documents ?? []
  const owned = tdocs.filter((d) => str(d.fields?.ownerTeam) !== null)
  console.log(`  칸 ${tdocs.length} · 주인 있는 칸 ${owned.length}`)
  const posted = await fetch(`${FS}/games/${game}/posted`, { headers: ADMIN })
  const pdocs = ((await posted.json()) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? []
  console.log(`  게시판에 붙은 심부름 ${pdocs.length}장`)
  const pots = await fetch(`${FS}/games/${game}/pots`, { headers: ADMIN })
  const potDocs = ((await pots.json()) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? []
  // **자리가 여덟 있는 것과 뭔가 심긴 것은 다르다.** seedGarden 은 빈
  // 화분 여덟을 놓을 뿐이고, 심는 것은 운영자가 한다
  const planted = potDocs.filter((d) => str(d.fields?.cropId) !== null)
  console.log(`  화분 자리 ${potDocs.length} · 그중 심긴 것 ${planted.length}`)
  console.log(`  자판기 ${VENDINGS.length}대 — ${VENDINGS.map((v) => v.name).join(' · ')}`)
  console.log(`  자판기에서 파는 것 — ${SHOP_ITEMS.map((i) => `${i.name} ${priceOf(i)}`).join(' · ')}`)

  // ── 열넷 ────────────────────────────────────────────────────
  console.log('\n── 열넷은 지금 무엇을 할 수 있나 ──')
  const ownerOf = (t: TileId): string =>
    str(tdocs.find((d) => d.name.endsWith(`/${t}`))?.fields?.ownerTeam) ?? ''

  const rows: { id: string; team: string; role: string; room: string; tokens: number; money: number; can: string[] }[] = []
  for (const id of IDS) {
    const uid = uidOf(id)
    const tk = await tok(id)
    const v = await viewOf(game, uid)
    const p = await pawnOf(game, uid)
    const paper = await must('myPaper', tk, { gameId: game })

    const room = (str(p.tileId) ?? '') as TileId
    const tokens = num(v.myTeamTokens)
    const vault = mapOf(v.myVault)
    const money = num(vault.money)
    const items = mapOf(v.myItems)
    const held = Object.entries(items)
      .filter(([, n]) => num(n) > 0)
      .map(([k, n]) => `${ITEM_BY_KIND[k as ItemKind]?.name ?? k}×${num(n)}`)

    /*
     * **할 수 있는 일을 규칙에서 센다.** 화면 코드를 베끼지 않는다 —
     * 화면이 틀렸으면 여기서도 같이 틀려서 아무것도 못 잡는다.
     *
     * 그리고 **선 자리를 본다.** 토큰만 세면 「연구 할 수 있음」이
     * 열넷에게 다 붙는데, 연구는 우리 땅 위에서만 된다. 자리를 안
     * 보는 점검표는 초록만 찍고 아무것도 안 잡는다 — 한 번 그랬다.
     */
    const cell = mapOf(p.at)
    const me = Object.keys(cell).length > 0 ? { x: num(cell.x), y: num(cell.y) } : null
    const mine = ownerOf(room) === (str(p.team) ?? '')
    const can: string[] = []
    if (tokens >= ACT_COST.move) can.push(`이동(${ACT_COST.move}) → ${ROAM_TO[room]?.length ?? 0}곳`)
    // 생산·공부는 **우리 땅** 위에서만(ACTION_STAND 의 ourZone)
    if (mine && tokens >= 1) can.push('생산 · 공부')
    if (room === 'labRoom' && tokens >= ACT_COST.research) can.push(`연구(${ACT_COST.research})`)
    for (const [kind, label] of [['whistle', '방해'], ['nameTag', '위장']] as const) {
      if (num(items[kind]) > 0) can.push(`${label}(${ITEM_BY_KIND[kind].name})`)
    }
    const spot = atVending(me)
    if (spot) {
      const afford = SHOP_ITEMS.filter((i) => priceOf(i) <= money)
      can.push(`자판기 ${spot.name}(살 수 있는 것 ${afford.length})`)
    }
    if (BOARDS.some((b) => me !== null && Math.abs(me.x - b.cell.x) <= 1 && Math.abs(me.y - b.cell.y) <= 1)) {
      can.push(`게시판(${pdocs.length}장)`)
    }
    if (room === (GARDEN_TILE as TileId)) can.push(`화분(심긴 것 ${planted.length})`)
    // 자리와 상관없이 늘 되는 것 — 같은 방 사람과 거래, 무전, 메모
    const mates = arr(v.visiblePawns).length - 1
    can.push(`거래(같은 방 ${mates}명)`, '무전 · 메모')

    rows.push({
      id,
      team: str(p.team) ?? '?',
      role: String((paper as { roleName?: string }).roleName ?? '?'),
      room: TILE_BY_ID[room]?.name ?? room,
      tokens,
      money,
      can,
    })
    if (id === IDS[0]) {
      console.log(`\n  [${id} 의 몫을 통째로 본다 — 첫 화면에 무엇이 오는가]`)
      console.log(`    선 방 ${TILE_BY_ID[room]?.name} · 층 ${FLOOR_NAME[TILE_BY_ID[room].floor]}`)
      console.log(`    역할 ${(paper as { roleName?: string }).roleName}`)
      console.log(`    숨긴 사실 ${String((paper as { secret?: string }).secret ?? '').slice(0, 40)}…`)
      console.log(`    미션 ${String(((paper as { main?: { text?: string } }).main ?? {}).text ?? '').slice(0, 50)}…`)
      console.log(`    같은 방 사람 ${arr(v.visiblePawns).length}`)
      console.log(`    손에 든 것 ${held.length > 0 ? held.join(' · ') : '없음'}`)
      console.log(`    무전 줄 ${arr(v.radioLines).length} · 알림 ${arr(v.notices).length}`)
    }
  }

  console.log('\n  아이디  팀  역할          선 방      토큰  돈   할 수 있는 것')
  for (const r of rows) {
    console.log(
      `  ${r.id}  ${r.team}   ${r.role.padEnd(12, '　').slice(0, 12)}  ${r.room.padEnd(8, '　').slice(0, 8)}  ` +
        `${String(r.tokens).padStart(3)}  ${String(r.money).padStart(3)}  ${r.can.join(' · ')}`,
    )
  }

  // ── 그래서 실제로 해 본다 ───────────────────────────────────
  //
  // 표만 찍고 끝내면 「할 수 있다」가 정말 되는지는 모른다. 열넷이
  // 각자 한 방씩 들어가 보고, 운영자가 페이즈를 닫는다.
  console.log('\n── 열넷이 실제로 움직인다 ──')
  const start = (str((await pawnOf(game, uidOf(IDS[0]))).tileId) ?? '') as TileId
  const out = ROAM_TO[start] ?? []
  console.log(`  2-3 에서 갈 수 있는 방 ${out.length} — ${out.map((t) => TILE_BY_ID[t].name).join(', ')}`)

  const went: Record<string, string> = {}
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i]
    const tk = await tok(id)
    // 열넷을 고루 흩는다. 같은 방에 몰리면 정원에 걸려 뒤엣사람이 튕긴다
    const to = out[i % out.length]
    const r = await call('phaseAct', tk, { gameId: game, kind: 'move', targetTile: to })
    went[id] = r.ok ? TILE_BY_ID[to].name : `✗ ${r.err}`
  }
  const moved = Object.values(went).filter((w) => !w.startsWith('✗'))
  console.log(`  들어간 사람 ${moved.length}/14`)
  for (const [id, w] of Object.entries(went)) if (w.startsWith('✗')) console.log(`    ${id} ${w}`)

  /*
   * **문 하나를 넘는 데 10분이 든다.** 누르자마자 닫으면 열넷이 모두
   * 문과 문 사이에 있고, 걷는 말은 깃발 판정에 안 센다 — 그대로
   * 닫았더니 점령이 0이었다. 실제 페이즈는 한 시간이니 시계를 민다.
   */
  const walking = (await Promise.all(IDS.map((id) => pawnOf(game, uidOf(id))))).filter(
    (p) => str(p.tileId) === null,
  ).length
  console.log(`  누른 직후 아직 걷는 중인 사람 ${walking}/14 — 문 하나에 10분이다`)
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10) + 20 * 60_000, speed: 60 })
  await must('tick', host, { gameId: game })
  const arrived = (await Promise.all(IDS.map((id) => pawnOf(game, uidOf(id))))).filter(
    (p) => str(p.tileId) !== null,
  ).length
  console.log(`  20분 뒤 방에 들어선 사람 ${arrived}/14`)

  console.log('\n── 운영자가 페이즈를 닫는다 ──')
  const closed = await call('closePhase', host, { gameId: game })
  console.log(closed.ok ? `  닫혔다 — ${JSON.stringify(closed.result).slice(0, 200)}` : `  ✗ ${closed.err}`)

  const tiles2 = await fetch(`${FS}/games/${game}/tiles`, { headers: ADMIN })
  const t2 = ((await tiles2.json()) as { documents?: { name: string; fields?: Record<string, unknown> }[] }).documents ?? []
  const nowOwned = t2.filter((d) => str(d.fields?.ownerTeam) !== null)
  console.log(`  주인이 생긴 칸 ${nowOwned.length}`)
  for (const d of nowOwned) {
    const id = d.name.split('/').pop() as TileId
    console.log(`    ${TILE_BY_ID[id]?.name ?? id} → ${str(d.fields?.ownerTeam)}팀`)
  }

  /*
   * **혼자 들어갔는데 주인이 안 된 방은 설명이 붙어야 한다.**
   *
   * 열넷이 열네 방에 하나씩 들어갔으니 열넷이 다 주인이 되어야
   * 정상인데 열셋만 됐다. 남은 하나가 「아직 안 열린 핵심」이면
   * 규칙대로고, 아니면 버그다 — 세어만 보고 넘어가면 못 가른다.
   */
  const ownedIds = new Set(nowOwned.map((d) => d.name.split('/').pop() as TileId))
  const wentTo = IDS.map((_, i) => out[i % out.length])
  const missed = wentTo.filter((t) => !ownedIds.has(t))
  for (const t of missed) {
    const why = coreOpen(t, 1) ? '✗ 까닭을 모르겠다' : `규칙대로 — 아직 안 열린 ${TILE_BY_ID[t].tier}, DAY 1 에는 못 꽂는다`
    console.log(`  혼자 섰는데 주인이 안 된 방: ${TILE_BY_ID[t].name} — ${why}`)
  }
  if (missed.length === 0) console.log('  들어간 방은 모두 주인이 생겼다.')

  // 이제 우리 땅이 생겼으니 생산·공부가 열린다. 한 사람으로 확인한다
  const firstOwner = nowOwned[0]
  if (firstOwner) {
    const tileId = firstOwner.name.split('/').pop() as TileId
    const team = str(firstOwner.fields?.ownerTeam)
    const who = rows.find((r) => r.team === team)
    if (who) {
      const tk = await tok(who.id)
      await must('openPhase', host, { gameId: game })
      const p2 = await pawnOf(game, uidOf(who.id))
      const stood = str(p2.tileId)
      const earn = await call('produce', tk, { gameId: game, tileId: stood as TileId })
      console.log(
        `\n  ── 땅이 생기니 생산이 열린다 ──\n  ${who.id}(${team}팀) 가 ${TILE_BY_ID[stood as TileId]?.name}` +
          `(우리 땅) 에서 생산 — ` +
          (earn.ok ? `${JSON.stringify(earn.result)}` : `✗ ${earn.err}`),
      )
      void tileId
    }
  }

  // ── 구멍 찾기 ───────────────────────────────────────────────
  console.log('\n── 빈 곳 ──')
  const idle = rows.filter((r) => r.can.length === 0)
  console.log(idle.length === 0 ? '  할 일이 없는 사람은 없다.' : `  ✗ 할 일이 없다: ${idle.map((r) => r.id).join(', ')}`)
  const teams = new Map<string, number>()
  for (const r of rows) teams.set(r.team, (teams.get(r.team) ?? 0) + 1)
  console.log(`  팀 나뉨 — ${[...teams].map(([t, n]) => `${t}팀 ${n}`).join(' · ')}`)
  const boxes = [...new Set(rows.map((r) => r.tokens))]
  console.log(
    `  팀 상자 ${boxes.join(' / ')} — 페이즈마다 ${TOKENS_PER_PHASE}, 이월 한도 ${TOKEN_CAP}. ` +
      (boxes.length === 1 ? '인원이 달라도 같다' : '✗ 팀마다 다르다 — 인원을 곱하고 있다'),
  )
  const rooms = new Set(rows.map((r) => r.room))
  console.log(`  선 방 ${[...rooms].join(', ')} — ${rooms.size === 1 ? '열넷이 한 방에서 시작한다' : '흩어져 있다'}`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
