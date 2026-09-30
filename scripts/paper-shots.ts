// 빈 종이와 문제 종이 — 사람이 하는 순서대로 찍는다.
//
//   A(qa01) 자판기에서 빈 종이를 사고 → 적고 → 복도 바닥에 놓는다
//   B(qa02) 걸어와서 → 맵에서 짚어 줍고 → 읽고 → 찢는다(찢긴 뒤 바닥)
//   문제 종이 — B 가 펼쳐 보고 틀린다(바닥에 남는다) → A 가 맞힌다(사라진다)
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/paper-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { cellNow, pickOnMap, tap, walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { SHOP_ITEMS, VENDINGS } from '../shared/rules/shop'
import { canDropQuizAt } from '../shared/rules/quiz'
import { isWalkable } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = process.env.SITE ?? 'http://127.0.0.1:8899'
const OUT = process.env.OUT ?? '/tmp/claude-0/papershots'

const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const NOTE = '3층 계단 밑 사물함을 열어 봐.'
const MACHINE = VENDINGS.find((v) => v.floor === 'f2')!

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const missed: string[] = []

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
  const email = `pshot-${tag}@x.test`
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

/** 돈을 쥐여 준다. 돈은 사람 것이다 — 말 문서의 money */
async function fund(game: string, uid: string, money: number): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=money`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { money: { integerValue: String(money) } } }),
  })
}

async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  return ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
}
function arr(f: unknown): Record<string, unknown>[] {
  const v = (f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue
  return (v?.values ?? []).map((x) => x.mapValue?.fields ?? {})
}
const num = (f: unknown): number => Number((f as { integerValue?: string })?.integerValue ?? NaN)

async function enter(page: Page, game: string, id: string): Promise<void> {
  page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))
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
  await page.waitForTimeout(500)
}

async function shot(page: Page, file: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

async function tab(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === n)
    ;(t as HTMLElement | undefined)?.click()
  }, name)
  await page.waitForTimeout(600)
}

/** 「나」 탭의 가진 것을 펼친다. 물건과 쪽지가 거기 있다 */
async function openBag(page: Page): Promise<void> {
  await tab(page, '나')
  await page.waitForSelector('.sc-mi__have', { timeout: 15_000 })
  if ((await page.locator('.sc-mi__open').count()) === 0) await page.locator('.sc-mi__have').click()
  await page.waitForSelector('.sc-mi__open')
  await page.waitForTimeout(400)
}

/** 아래 칸의 단추(손패 · 이 방 …)를 이름으로 누른다 */
async function act(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll('.sc-ct__act')].find((e) => e.textContent?.includes(l))
    ;(b as HTMLElement | undefined)?.click()
  }, label)
  await page.waitForTimeout(700)
}

async function closeSheet(page: Page): Promise<void> {
  await page.locator('.sc-sheet__head button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

/** 그 칸 옆에서 설 수 있는 칸 하나 */
function besideOf(c: { x: number; y: number }): { x: number; y: number } {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (isWalkable(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy }
  }
  return c
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `ps${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ps' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const aUid = uidOf('qa01')
  const bUid = uidOf('qa02')
  await fund(game, aUid, 20)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const size = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
  const A = await (await browser.newContext(size)).newPage()
  const B = await (await browser.newContext(size)).newPage()
  await enter(A, game, 'qa01')
  await enter(B, game, 'qa02')
  const walk = (page: Page, uid: string, want: { x: number; y: number }, what: string) =>
    walkToCell({ page, fs: FS, admin: ADMIN, game, uid, want, what })

  // ── A: 자판기에서 빈 종이를 산다 ─────────────────────────────
  console.log('\n── A: 사기 ──')
  await walk(A, aUid, MACHINE.cell, '자판기')
  if (!(await pickOnMap(A, MACHINE.cell, '고른다'))) missed.push('자판기 「고른다」가 없다')
  await A.waitForSelector('.sc-vd__body', { timeout: 10_000 })
  await A.waitForTimeout(900)
  const paperIdx = SHOP_ITEMS.findIndex((i) => i.id === 'paper')
  await A.locator('.sc-vd__cell').nth(paperIdx).click()
  await A.waitForTimeout(300)
  await shot(A, '01-A-자판기-빈종이-고름.png')
  await A.locator('.sc-vd__push').click()
  await A.waitForSelector('.sc-vd__out2', { timeout: 5_000 }).catch(() => undefined)
  await A.waitForTimeout(400)
  await shot(A, '02-A-샀다.png')
  await A.locator('.sc-vd__out').click()
  await A.waitForTimeout(800)

  // ── A: 적는다 ───────────────────────────────────────────────
  console.log('\n── A: 쓰기 ──')
  await openBag(A)
  await shot(A, '03-A-가진것-빈종이.png')
  await tap(A, '.sc-mi__use', '적어서 놓기')
  await A.waitForTimeout(400)
  await A.fill('.sc-mi__write textarea', NOTE)
  await A.waitForTimeout(300)
  await shot(A, '04-A-적는중.png')
  await tap(A, '.sc-mi__writeRow button', '바닥에 놓기')
  await A.waitForTimeout(1500)
  await shot(A, '05-A-놓았다-말줄.png')
  await tab(A, '맵')
  await A.waitForTimeout(1200)
  await shot(A, '06-A-맵-발밑옆에-종이.png')

  const floor = arr((await viewOf(game, aUid)).slipPapers)
  const at = { x: num(floor[0]?.x), y: num(floor[0]?.y) }
  console.log(`  종이 자리 ${at.x},${at.y} · 그림 ${(floor[0]?.kind as { stringValue?: string })?.stringValue}`)
  if (!Number.isFinite(at.x)) missed.push('놓은 종이가 맵에 없다')

  // A 는 옆으로 비킨다 — B 가 설 자리를 비운다
  const aNow = await cellNow(FS, ADMIN, game, aUid)
  if (aNow) {
    const away = { x: aNow.x + 4, y: aNow.y }
    if (isWalkable(away.x, away.y)) await walk(A, aUid, away, '비키기')
  }

  // ── B: 걸어와서 줍는다 ──────────────────────────────────────
  console.log('\n── B: 줍기 ──')
  const bStand = besideOf(at)
  const far = { x: bStand.x, y: bStand.y + 3 }
  if (isWalkable(far.x, far.y)) await walk(B, bUid, far, '종이 근처')
  await B.waitForTimeout(1200)
  await shot(B, '07-B-멀리서-바닥의-종이.png')
  await walk(B, bUid, at, '종이 옆')
  await B.waitForTimeout(1000)
  if (!(await pickOnMap(B, at, '줍는다'))) {
    missed.push('B 가 종이를 짚었는데 「줍는다」가 없다')
    await shot(B, '08-B-짚음-실패.png')
  } else {
    await B.waitForTimeout(1500)
    await shot(B, '08-B-주웠다.png')
  }

  // ── B: 읽는다 ───────────────────────────────────────────────
  console.log('\n── B: 읽기 ──')
  await openBag(B)
  await B.locator('.sc-sl').scrollIntoViewIfNeeded().catch(() => undefined)
  await B.waitForTimeout(300)
  await shot(B, '09-B-접힌-쪽지.png')
  await tap(B, '.sc-sl__row button', '읽기')
  await B.waitForTimeout(1500)
  await B.locator('.sc-sl').scrollIntoViewIfNeeded().catch(() => undefined)
  await shot(B, '10-B-읽었다.png')

  // ── B: 찢는다 ───────────────────────────────────────────────
  console.log('\n── B: 찢기 ──')
  await B.locator('.sc-sl__tear').click()
  await B.waitForTimeout(300)
  await shot(B, '11-B-찢기-한번더.png')
  await B.locator('.sc-sl__tear').click()
  await B.waitForFunction(() => document.querySelectorAll('.sc-sl__list > li').length === 0, null, { timeout: 15_000 }).catch(() => undefined)
  await B.waitForTimeout(800)
  await B.locator('.sc-mi__open').scrollIntoViewIfNeeded().catch(() => undefined)
  await shot(B, '12-B-찢은뒤-가진것.png')
  await tab(B, '맵')
  await B.waitForTimeout(1200)
  await shot(B, '13-B-찢은뒤-맵바닥.png')

  // ── 문제 종이 ───────────────────────────────────────────────
  console.log('\n── 문제 종이 ──')
  const bAt = (await cellNow(FS, ADMIN, game, bUid)) ?? bStand
  const qCell = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1]]
    .map(([dx, dy]) => ({ x: bAt.x + dx, y: bAt.y + dy }))
    .find((c) => canDropQuizAt(c.x, c.y) && !(c.x === at.x && c.y === at.y))
  if (!qCell) throw new Error('문제 종이를 놓을 칸이 없다')
  await must('hostDrop', host, {
    gameId: game,
    kind: 'quiz',
    x: qCell.x,
    y: qCell.y,
    quiz: { kind: 'short', prompt: '눈이 가장 많이 오는 달은?', choices: [], answers: ['한 달'], explain: '' },
  })
  await B.waitForTimeout(2000)
  await shot(B, '14-B-문제종이-바닥.png')
  await walk(B, bUid, qCell, '문제 종이 옆')
  await B.waitForTimeout(800)
  if (!(await pickOnMap(B, qCell, '펼쳐 본다'))) missed.push('B 가 문제 종이를 짚었는데 「펼쳐 본다」가 없다')
  await B.waitForTimeout(1500)
  await shot(B, '15-B-펼쳤다-바닥에-그대로.png')
  await act(B, '손패')
  await B.waitForSelector('.sc-qz__short input', { timeout: 8000 }).catch(() => missed.push('손패에 문제가 없다'))
  await B.fill('.sc-qz__short input', '두 달').catch(() => undefined)
  await shot(B, '16-B-손패-답적기.png')
  await tap(B, '.sc-qz__short button', '낸다').catch(() => undefined)
  await B.waitForTimeout(1500)
  await shot(B, '17-B-틀렸다.png')
  await closeSheet(B)
  await B.waitForTimeout(800)
  await shot(B, '18-B-틀려도-바닥에-남는다.png')

  // A 가 와서 맞힌다
  await walk(A, aUid, qCell, '문제 종이 옆')
  await A.waitForTimeout(800)
  if (!(await pickOnMap(A, qCell, '펼쳐 본다'))) missed.push('A 가 문제 종이를 짚었는데 「펼쳐 본다」가 없다')
  await A.waitForTimeout(1200)
  await act(A, '손패')
  await A.waitForSelector('.sc-qz__short input', { timeout: 8000 }).catch(() => missed.push('A 손패에 문제가 없다'))
  await A.fill('.sc-qz__short input', '한 달').catch(() => undefined)
  await tap(A, '.sc-qz__short button', '낸다').catch(() => undefined)
  await A.waitForTimeout(1500)
  await shot(A, '19-A-맞혔다.png')
  await closeSheet(A)
  await A.waitForTimeout(1000)
  await shot(A, '20-A-맞힌뒤-바닥.png')
  await B.waitForTimeout(1500)
  await shot(B, '21-B-남이-맞힌뒤-바닥.png')
  const left = arr((await viewOf(game, bUid)).quizzesHere).length
  console.log(`  B 가 보는 바닥의 문제 종이: ${left}장`)
  if (left !== 0) missed.push('맞힌 뒤에도 바닥에 남았다')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
  console.log(`놓침 ${JSON.stringify(missed)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
