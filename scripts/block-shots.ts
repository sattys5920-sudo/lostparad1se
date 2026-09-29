// 사람은 기물처럼 막는다 — 보이는 자리에 선 사람에게 걸어 들어가지 못한다.
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

async function liveAt(game: string, uid: string, x: number, y: number): Promise<void> {
  await fetch(`${FS}/games/${game}/live/${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        tileId: { stringValue: START_TILE },
        x: { doubleValue: x + 0.5 },
        y: { doubleValue: y + 0.5 },
        dir: { stringValue: 'down' },
        moving: { booleanValue: false },
        ms: { integerValue: String(Date.now() + 120_000) },
      },
    }),
  })
}

const myCell = async (page: Page) => {
  const at = (await page.locator('canvas').first().getAttribute('data-at')) ?? ''
  const [x, y] = at.split(',').map(Number)
  return { x, y }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `bk${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'bk' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 9), speed: 1 })
  await must('tick', host, { gameId: game })
  console.log(`판 ${game}  ${SITE}`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')
  const bot = { uid: uidOf('qa02'), token: await asPlayer(host, 'qa02') }

  // 내 옆 빈 칸 하나를 고른다 — 같은 교실 · 설 수 있는 칸 · 아무도 없는 칸
  let me = await myCell(page)
  const rows = await pawns(game)
  const held = new Set(rows.filter((r) => r.at).map((r) => `${r.at!.x},${r.at!.y}`))
  const DIRS = [
    { key: 'ArrowRight', dx: 1, dy: 0 },
    { key: 'ArrowLeft', dx: -1, dy: 0 },
    { key: 'ArrowDown', dx: 0, dy: 1 },
    { key: 'ArrowUp', dx: 0, dy: -1 },
  ]
  const ok = (x: number, y: number) =>
    roomOfCell(x, y) === START_TILE && canStandAt(x, y) && !isBlockedCell(x, y) && !isFixture(x, y) && !held.has(`${x},${y}`)
  const dir = DIRS.find((d) => ok(me.x + d.dx, me.y + d.dy) && ok(me.x + d.dx * 2, me.y + d.dy * 2) || ok(me.x + d.dx, me.y + d.dy))
  if (!dir) throw new Error(`${JSON.stringify(me)} 옆에 빈 칸이 없다`)
  const right = { x: me.x + dir.dx, y: me.y + dir.dy }
  const start = { ...me }
  // 비킬 자리 — 그 칸에서 떨어진 교실 안 빈 칸
  let away = right
  for (let d = 3; d < 8 && away === right; d++) {
    for (const [ax, ay] of [[0, -d], [0, d], [-d, 0], [d, 0]]) if (ok(right.x + ax, right.y + ay)) { away = { x: right.x + ax, y: right.y + ay }; break }
  }
  check(true, `나 ${JSON.stringify(me)} → ${dir.key} ${JSON.stringify(right)}`)

  console.log('\n── 1 보이는 자리에 선 사람은 막는다 ──')
  // qa02 의 **서버 칸**은 그대로(교실 어딘가), **실시간 자리**만 내 바로 옆
  await liveAt(game, bot.uid, right.x, right.y)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/bk-1-before.png` })
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(dir.key)
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(800)
  me = await myCell(page)
  check(me.x === start.x && me.y === start.y, '그쪽을 눌러도 그 사람 칸으로 못 간다', JSON.stringify(me))
  const said = await page.locator('text=누가 서 있다').count()
  check(said > 0, '「누가 서 있다」가 뜬다')

  console.log('\n── 2 그 사람은 그 자리에 그대로 ──')
  const name = ((await (await fetch(`${FS}/games/${game}`, { headers: ADMIN })).json()) as {
    fields: { seats: { arrayValue: { values: { mapValue: { fields: { playerId: { stringValue: string }; name: { stringValue: string } } } }[] } } }
  }).fields.seats.arrayValue.values.map((v) => ({ id: v.mapValue.fields.playerId.stringValue, name: v.mapValue.fields.name.stringValue })).find((x) => x.id === bot.uid)?.name ?? ''
  const tags = await tagSpots(page)
  const want = (await page.evaluate(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const [cx] = c.dataset.cam.split(',').map(Number); const k = r.width / c.width; return { x: Math.round(r.left + ((${right.x} + 0.5) * ${TILE} - cx) * k) } })()`)) as { x: number }
  const got = tags.find((t) => t.t === name)
  check(!!got && Math.abs(got.x - want.x) <= 3, `${name} 은 비켜 그려지지 않고 그 칸에 그대로 선다`, got ? `이름표 ${got.x} · 칸 ${want.x}` : '이름표 없음')
  await page.screenshot({ path: `${OUT}/bk-2-blocked.png` })

  console.log('\n── 3 비키면 지나간다 ──')
  await liveAt(game, bot.uid, away.x, away.y)
  await page.waitForTimeout(1500)
  await page.keyboard.press(dir.key)
  await page.waitForTimeout(900)
  me = await myCell(page)
  check(me.x === right.x && me.y === right.y, '비킨 뒤에는 그 칸으로 간다', JSON.stringify(me))
  await page.screenshot({ path: `${OUT}/bk-3-passed.png` })

  await browser.close()
  console.log(missed.length === 0 ? '\n전부 통과' : `\n실패 ${missed.length}건\n${missed.join('\n')}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
