// 화분 — 운영자가 심는 자리와, 사람이 보는 자리.
//
// 판정은 garden-e2e 가 본다. 여기서 보는 것은 **화면**이다. 운영자
// 책상의 화분 여덟, 정원의 빈 화분, 흙, 열매, 그리고 따는 자리.
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/drop-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { tap, walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { POT_CELLS, GARDEN_TILE } from '../shared/rules/crop'
import { isWalkable, tileAt } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/gardenshots'

const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const MEMO = '3층 계단 밑 사물함, 자물쇠 번호는 0412다.'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function must(name: string, tk: string | null, data: unknown) {
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
  const email = `gshot-${tag}@x.test`
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

/** 그 조각만 찍는다. 화면 전체는 무엇을 보라는지가 안 보인다 */
async function shot(page: Page, sel: string, file: string): Promise<void> {
  const el = page.locator(sel).first()
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

/** 내 몫. 운영자 열쇠로 읽는다 — 규칙은 본인에게만 열어 준다 */
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/games/${game}/views/${uid}`,
    { headers: ADMIN },
  )
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? {}
}
const arrLen = (f: unknown): number =>
  (f as { arrayValue?: { values?: unknown[] } })?.arrayValue?.values?.length ?? 0



/** 저장소에 없는 코드. 읽기만 하고 어디에도 안 적는다 */
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}

/** 들어와서 화면을 덮는 것들을 사람이 하듯 넘긴다. */
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

/** 그 방에 세운다. 방 안에 서 있으면 화면이 군말 없이 따라온다 */
async function putIn(game: string, uid: string, tileId: string): Promise<void> {
  const mask = ['tileId', 'arriveAtMs', 'at'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  await fetch(`${FS}/games/${game}/pawns/${uid}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null }, at: { nullValue: null } },
    }),
  })
}

/**
 * 서버가 한 번 일하게 해서 몫을 다시 쓴다.
 *
 * 문서만 손으로 고치면 views 는 옛 값 그대로다 — 화면은 아직
 * 2-3 교실에 서 있다고 믿는다. 여기서 또 속았다.
 */
async function wake(game: string, host: string): Promise<void> {
  await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
}

/**
 * 화분을 그 단계까지 당긴다. **자랄 시간은 문서에만 있다** —
 * 셋으로 나눠 넘어가므로(stageOf) 그만큼씩 심은 시각을 앞당긴다.
 */
async function ageTo(game: string, i: number, stage: 'sprout' | 'leaf' | 'fruit'): Promise<void> {
  const r = await fetch(`${FS}/games/${game}/pots/${i}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const planted = Number((f.plantedMs as { integerValue?: string })?.integerValue ?? 0)
  const growMs = Number((f.growMs as { integerValue?: string })?.integerValue ?? 0)
  const by = stage === 'sprout' ? growMs / 3 : stage === 'leaf' ? (growMs * 2) / 3 : growMs
  await fetch(`${FS}/games/${game}/pots/${i}?updateMask.fieldPaths=plantedMs`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { plantedMs: { integerValue: String(Math.round(planted - by - 60_000)) } } }),
  })
}

/** 그 칸 앞까지 걸어간다. 손은 lib/walk 에 있다 — 셋이 같이 쓴다 */
const walkTo = (page: Page, game: string, uid: string, want: { x: number; y: number }, what = '자리') =>
  walkToCell({ page, fs: FS, admin: ADMIN, game, uid, want, what })

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `gs${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'gs' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const meUid = uidOf('qa01')
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')

  /*
   * **정원으로 옮겨 세운다.** 2-3 교실(2층)에서 정원(1층)까지는
   * 계단을 지나야 하는데, 이 캡처가 볼 것은 그 길이 아니다. 방 안에
   * 서 있는 사람을 서버가 옮기면 화면이 군말 없이 따라온다(Walk).
   */
  await putIn(game, meUid, GARDEN_TILE)
  await wake(game, host)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/1-정원.png` })
  console.log('  찍었다 1-정원.png')

  /*
   * **운영자가 심는다.** 사람에게는 심는 문이 없다 — 운영자 화면을
   * 따로 열어서 한 자리에 심고, 사람 쪽 화면이 그것을 받는다.
   */
  const deskCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const desk = await deskCtx.newPage()
  await desk.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await desk.waitForSelector('.sc-gt__title')
  for (let i = 0; i < 5; i++) {
    await desk.locator('.sc-gt__title').click()
    await desk.waitForTimeout(80)
  }
  await desk.fill('#gt-code', hostCode())
  await desk.locator('.sc-gt__submit').click()
  await desk.waitForSelector('.sc-ga', { timeout: 20_000 })
  await desk.waitForTimeout(1200)
  const card = desk.locator('.sc-ad__card').filter({ has: desk.locator('h2:text-is("화분")') })
  await card.scrollIntoViewIfNeeded()
  await desk.waitForTimeout(300)
  await card.screenshot({ path: `${OUT}/2-운영자-화분.png` })
  console.log('  찍었다 2-운영자-화분.png')

  // 첫 자리에 심는다. 무엇을 심을지도 고를 수 있다
  await desk.locator('.sc-ga .sc-dr__row select').selectOption('corn')
  await desk.evaluate(() => {
    const b = [...document.querySelectorAll('.sc-ga__pots button')].find((x) => x.textContent?.includes('심기'))
    ;(b as HTMLElement | undefined)?.click()
  })
  await desk.waitForTimeout(1500)
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: `${OUT}/3-운영자-심은뒤.png` })
  console.log('  찍었다 3-운영자-심은뒤.png')

  /*
   * 나머지 일곱 자리에도 골라 심고 **단계를 흩어 놓는다.**
   *
   * 한 화분만 보면 「흙이 열매가 된다」가 안 보인다 — 여덟 자리에
   * 흙·싹·잎·열매가 같이 있어야 자라는 일이 한 장에 담긴다. 색도
   * 그때 같이 보인다: 딸기는 붉고 수박은 푸르다.
   */
  const PLAN: { pot: number; crop: string; stage?: 'sprout' | 'leaf' | 'fruit' }[] = [
    { pot: 1, crop: 'strawberry', stage: 'sprout' },
    { pot: 2, crop: 'watermelon', stage: 'leaf' },
    { pot: 3, crop: 'tomato', stage: 'fruit' },
    { pot: 4, crop: 'sunflower', stage: 'fruit' },
    { pot: 5, crop: 'blackTulip', stage: 'fruit' },
    { pot: 6, crop: 'iceFlower', stage: 'fruit' },
    { pot: 7, crop: 'hers', stage: 'fruit' },
  ]
  for (const row of PLAN) {
    await must('hostPlant', host, { gameId: game, pot: row.pot, cropId: row.crop })
    if (row.stage) await ageTo(game, row.pot, row.stage)
  }
  await ageTo(game, 0, 'sprout')
  await must('hostPlant', host, { gameId: game, pot: 0 }).catch(() => undefined)

  // 사람 쪽. 가운데로 걸어가 여덟 자리를 한 화면에 담는다
  await walkTo(page, game, meUid, { x: 26, y: 101 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/4-자라는-중.png` })
  console.log('  찍었다 4-자라는-중.png')
  await tap(page, '.sc-ct__act', '화분')
  await page.waitForSelector('.sc-gd', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/5-화분-시트.png` })
  console.log('  찍었다 5-화분-시트.png')
  await tap(page, '.sc-sheet__panel button', '닫기')
  await page.waitForTimeout(600)

  // 열매 하나를 딴다. 세 번 화분 앞으로
  await walkTo(page, game, meUid, POT_CELLS[3])
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/6-열매.png` })
  console.log('  찍었다 6-열매.png')

  await tap(page, '.sc-ct__act', '화분')
  await page.waitForSelector('.sc-gd', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/7-따기.png` })
  console.log('  찍었다 7-따기.png')

  await tap(page, '.sc-gd__list button', '따기')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/8-땄다.png` })
  console.log('  찍었다 8-땄다.png')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
