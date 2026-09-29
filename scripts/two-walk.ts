// 두 사람이 실제로 — B 가 걸어가 멈추고, A 가 B 쪽으로 걸어간다(판 중 · 시작 전 교실).
//
//   1 서버가 아는 칸은 먼 곳, 실시간 자리(보이는 곳)는 내 바로 오른쪽 — 오른쪽을 눌러도 못 간다
//     (전에는 서버 칸으로만 막아서 걸어 들어갔고, 그 사람이 옆으로 비켜 그려졌다)
//   2 그 사람은 그 자리에 그대로 그려진다(비켜 그려지지 않는다)
//   3 그 사람이 비키면 지나간다
//
//   1. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-bk --emptyOutDir
//   2. python3 -m http.server 8908 --bind 127.0.0.1 --directory /tmp/claude-0/serve-bk
//   3. npx vite-node scripts/block-shots.ts
// 찍은 것: /tmp/claude-0/shots/ov-*.png (TAG=before 면 ov-before-*.png)
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { tapCell, walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { BOARDS } from '../shared/rules/errand'
import { VENDINGS } from '../shared/rules/shop'
import { START_TILE, canStandAt, roomOfCell } from '../shared/rules/board'
import { isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { entryCellOf, seatIn } from '../shared/rules/seat'
import { TILE } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8908'
const OUT = '/tmp/claude-0/shots'
const TAG = process.env.TAG ? `${process.env.TAG}-` : ''
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

const missed: string[] = []
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) missed.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

async function hostToken(tag: string): Promise<string> {
  const email = `ov-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

/** 그 사람 자신으로 서버를 부른다. 화면이 하는 것과 같은 길이다 */
async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

interface Row { id: string; tileId: string | null; at: { x: number; y: number } | null }
async function pawns(game: string): Promise<Row[]> {
  const r = await fetch(`${FS}/games/${game}/pawns?pageSize=50`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: { name: string; fields: Record<string, { stringValue?: string; nullValue?: null; mapValue?: { fields: Record<string, { integerValue: string }> } }> }[] }
  return (j.documents ?? []).map((d) => {
    const m = d.fields.at?.mapValue?.fields
    return {
      id: d.name.split('/').pop() as string,
      tileId: d.fields.tileId?.stringValue ?? null,
      at: m ? { x: Number(m.x.integerValue), y: Number(m.y.integerValue) } : null,
    }
  })
}
const stackedOn = (rows: Row[]) => {
  const n = new Map<string, number>()
  for (const r of rows) if (r.tileId && r.at) n.set(`${r.at.x},${r.at.y}`, (n.get(`${r.at.x},${r.at.y}`) ?? 0) + 1)
  return [...n].filter(([, k]) => k > 1).map(([c, k]) => `${c}×${k}`)
}

/** 화면의 이름표 자리(발끝). 두 이름표가 한 점에 있으면 두 사람이 한 칸에 그려진 것이다 */
async function tagSpots(page: Page): Promise<{ t: string; x: number; y: number }[]> {
  // 화면 안에 떠 있는 것만 — 안 보이는 사람의 이름표는 화면 밖에 치워 둔다
  return (await page.evaluate(`(() => [...document.querySelectorAll('.sc-wk__tag')]
    .filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth })
    .map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top) } }))()`)) as {
    t: string
    x: number
    y: number
  }[]
}
function tagClash(tags: { t: string; x: number; y: number }[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++)
      if (Math.abs(tags[i].x - tags[j].x) < 6 && Math.abs(tags[i].y - tags[j].y) < 6) out.push(`${tags[i].t}/${tags[j].t}@${tags[i].x},${tags[i].y}`)
  return out
}

async function enter(page: Page, game: string, id: string): Promise<void> {
  page.on('pageerror', (e) => missed.push('화면 터짐: ' + String(e).slice(0, 200)))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', QA_PW)
  await page.locator('.sc-gt__submit').click()
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1000)
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(800)
}


const cellOf = async (page: Page) => {
  const at = (await page.locator('canvas').first().getAttribute('data-at')) ?? ''
  const [x, y] = at.split(',').map(Number)
  return { x, y }
}
const KEY: Record<string, string> = { '1,0': 'ArrowRight', '-1,0': 'ArrowLeft', '0,1': 'ArrowDown', '0,-1': 'ArrowUp' }

/** 방 안에서 사람 · 막힌 칸을 피해 가는 길 */
function route(from: { x: number; y: number }, to: { x: number; y: number }, avoid: Set<string>): { x: number; y: number }[] {
  const k = (x: number, y: number) => `${x},${y}`
  const prev = new Map<string, string | null>([[k(from.x, from.y), null]])
  let edge = [from]
  while (edge.length) {
    const next: { x: number; y: number }[] = []
    for (const c of edge) {
      if (c.x === to.x && c.y === to.y) {
        const out = []
        let at: string | null = k(c.x, c.y)
        while (at) { const [x, y] = at.split(',').map(Number); out.unshift({ x, y }); at = prev.get(at) ?? null }
        return out.slice(1)
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy }
        const key = k(n.x, n.y)
        if (prev.has(key) || avoid.has(key)) continue
        if (roomOfCell(n.x, n.y) !== START_TILE || !canStandAt(n.x, n.y) || isBlockedCell(n.x, n.y) || isFixture(n.x, n.y)) continue
        prev.set(key, k(c.x, c.y))
        next.push(n)
      }
    }
    edge = next
  }
  return []
}

async function walkKeys(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[]): Promise<void> {
  let now = from
  for (const s of path) {
    await page.keyboard.press(KEY[`${s.x - now.x},${s.y - now.y}`])
    await page.waitForTimeout(320)
    now = s
  }
}

async function tagX(page: Page, name: string): Promise<number | null> {
  const tags = await tagSpots(page)
  return tags.find((t) => t.t === name)?.x ?? null
}
async function cellX(page: Page, x: number): Promise<number> {
  return ((await page.evaluate(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const [cx] = c.dataset.cam.split(',').map(Number); const k = r.width / c.width; return Math.round(r.left + ((${x} + 0.5) * ${TILE} - cx) * k) })()`)) as number)
}

async function scene(label: string, A: Page, B: Page, bName: string, others: Set<string>) {
  console.log(`\n── ${label} ──`)
  const a = await cellOf(A)
  const b = await cellOf(B)
  const avoid = new Set([...others, `${a.x},${a.y}`])
  // A 의 바로 옆 빈 칸 하나 — B 가 거기 선다. 그 너머 칸도 있어야 A 가 그쪽으로 민다
  const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ dx, dy, t: { x: a.x + dx, y: a.y + dy } }))
    .find((s) => route(b, s.t, avoid).length > 0 || (b.x === s.t.x && b.y === s.t.y))
  if (!side) throw new Error('B 가 A 옆으로 갈 길이 없다')
  await walkKeys(B, b, route(b, side.t, avoid))
  await B.waitForTimeout(1500)
  const bNow = await cellOf(B)
  check(bNow.x === side.t.x && bNow.y === side.t.y, `B 가 A 옆(${side.t.x},${side.t.y})에 섰다`, JSON.stringify(bNow))
  await A.waitForTimeout(1500)
  const key = KEY[`${side.dx},${side.dy}`]
  for (let i = 0; i < 3; i++) { await A.keyboard.press(key); await A.waitForTimeout(350) }
  await A.waitForTimeout(800)
  const aNow = await cellOf(A)
  check(aNow.x === a.x && aNow.y === a.y, 'A 가 B 쪽을 눌러도 못 간다', `${JSON.stringify(a)} → ${JSON.stringify(aNow)}`)
  const bAfter = await cellOf(B)
  check(bAfter.x === side.t.x && bAfter.y === side.t.y, 'B 는 제 화면에서도 그 자리 그대로', JSON.stringify(bAfter))
  const got = await tagX(A, bName)
  const want = await cellX(A, side.t.x)
  check(got !== null && Math.abs(got - want) <= 3, 'A 화면에서 B 는 비켜 그려지지 않는다', `이름표 ${got} · 칸 ${want}`)
  await A.screenshot({ path: `${OUT}/two-${label}-1.png` })
  // 한참 뒤(실시간 자리가 낡은 뒤)에도
  await A.waitForTimeout(8000)
  for (let i = 0; i < 2; i++) { await A.keyboard.press(key); await A.waitForTimeout(350) }
  await A.waitForTimeout(800)
  const aLate = await cellOf(A)
  check(aLate.x === a.x && aLate.y === a.y, '8초 뒤에도 못 간다', JSON.stringify(aLate))
  const got2 = await tagX(A, bName)
  check(got2 !== null && Math.abs(got2 - want) <= 3, '8초 뒤에도 B 는 그 자리에 그려진다', `이름표 ${got2} · 칸 ${want}`)
  await A.screenshot({ path: `${OUT}/two-${label}-2.png` })
}

async function seatName(game: string, uid: string): Promise<string> {
  const j = (await (await fetch(`${FS}/games/${game}`, { headers: ADMIN })).json()) as {
    fields: { seats: { arrayValue: { values: { mapValue: { fields: { playerId: { stringValue: string }; name: { stringValue: string } } } }[] } } }
  }
  return j.fields.seats.arrayValue.values.map((v) => ({ id: v.mapValue.fields.playerId.stringValue, name: v.mapValue.fields.name.stringValue })).find((x) => x.id === uid)?.name ?? ''
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const size = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' }

  // ── 판 중 ──
  {
    const game = `tw${Date.now()}`
    const host = await hostToken(game)
    await must('createGame', host, { gameId: game, seed: 'tw' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    await must('assignAll', host, { gameId: game })
    await must('startGame', host, { gameId: game, startAtMs: START })
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 9), speed: 1 })
    await must('tick', host, { gameId: game })
    const A = await (await browser.newContext(size)).newPage()
    const B = await (await browser.newContext(size)).newPage()
    await enter(A, game, 'qa01')
    await enter(B, game, 'qa02')
    const rows = await pawns(game)
    const others = new Set(rows.filter((r) => r.at && r.id !== uidOf('qa01') && r.id !== uidOf('qa02')).map((r) => `${r.at!.x},${r.at!.y}`))
    await scene('판중', A, B, await seatName(game, uidOf('qa02')), others)
  }

  // ── 시작 전 교실 ──
  {
    const game = `tl${Date.now()}`
    const host = await hostToken(game)
    await must('createGame', host, { gameId: game, seed: 'tl' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    const A = await (await browser.newContext(size)).newPage()
    const B = await (await browser.newContext(size)).newPage()
    for (const [p, id] of [[A, 'qa01'], [B, 'qa02']] as const) {
      await p.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
      await p.fill('#gt-id', id)
      await p.fill('#gt-pw', QA_PW)
      await p.locator('.sc-gt__submit').click()
      await p.waitForSelector('canvas', { timeout: 20000 })
      await p.waitForTimeout(1500)
    }
    await scene('시작전', A, B, await seatName(game, uidOf('qa02')), new Set())
  }

  await browser.close()
  console.log(missed.length === 0 ? '\n전부 통과' : `\n실패 ${missed.length}건\n${missed.join('\n')}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
