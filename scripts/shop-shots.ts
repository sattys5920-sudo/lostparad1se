// 상점 여섯 품목 — 파는 자리와, 산 물건을 쓰는 자리.
//
// 판정은 shop-e2e 가 본다. 여기서 보는 것은 **사람이 실제로 보는
// 화면**이다. 상점 목록 여섯 줄과, 주머니에서 물건을 쓰는 칸.
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/drop-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { SHOP_ITEMS, SHOP_TILE } from '../shared/rules/shop'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shopshots'

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
  const email = `shot-${tag}@x.test`
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


/** 말을 그 방에 세운다. 걸어가는 데 드는 값은 이 캡처의 관심이 아니다 */
async function standAt(game: string, uid: string, tileId: string): Promise<void> {
  await fetch(
    `${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=arriveAtMs`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null } } }),
    },
  )
}
/** 금고를 채운다. 값이 모자라 못 사는 화면은 여기서 볼 것이 아니다 */
async function fund(game: string, team: string, money: number): Promise<void> {
  await fetch(`${FS}/games/${game}/teams/${team}?updateMask.fieldPaths=resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        resources: {
          mapValue: { fields: { money: { integerValue: String(money) }, knowledge: { integerValue: '9' } } },
        },
      },
    }),
  })
}
async function teamOf(game: string, uid: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  return (f.team as { stringValue?: string })?.stringValue ?? 'A'
}

/** 들어와서 화면을 덮는 것들을 사람이 하듯 넘긴다. */
async function enter(page: Page, game: string, id: string): Promise<void> {
  page.on('console', (m) => m.type() === 'error' && console.log('  [브라우저] ' + m.text().slice(0, 300)))
  page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 300)))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/x-문이없다.png` })
    console.log('  문이 안 떴다: ' + (await page.locator('body').innerText()).slice(0, 300))
  })
  // 로그인 칸이 접혀 있으면 「이미 계정이 있다」 쪽으로 넘긴다
  if ((await page.locator('#gt-id').count()) === 0) {
    await page.locator('.sc-gt__link').click().catch(() => undefined)
  }
  await page.waitForSelector('#gt-id')
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

/** 「나」 탭의 가진 것을 펼친다. 물건은 거기 있다. */
async function openBag(page: Page): Promise<void> {
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '나')
    ;(t as HTMLElement | undefined)?.click()
  })
  await page.waitForSelector('.sc-mi__have', { timeout: 15_000 })
  if ((await page.locator('.sc-mi__open').count()) === 0) await page.locator('.sc-mi__have').click()
  await page.waitForSelector('.sc-mi__open')
  await page.waitForTimeout(400)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `ss${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ss' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const meUid = uidOf('qa01')
  const myTeam = await teamOf(game, meUid)
  await fund(game, myTeam, 40)
  await standAt(game, meUid, SHOP_TILE)
  console.log(`판 ${game} — qa01(${myTeam}팀)이 상점에 서 있다`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')

  // ── 상점 ─────────────────────────────────────────────────
  // 상점 칸에 서 있으면 조작부에 「구매」가 선다
  await page.locator('.sc-ct__act', { hasText: '구매' }).first().click()
  await page.waitForSelector('.sc-shop', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await shot(page, '.sc-shop', '1-상점여섯.png')

  // 넷을 산다. 호루라기와 명찰은 이미 아는 물건이라 새 넷만 담는다
  for (const id of ['lock', 'paper', 'eraser', 'tape']) {
    await page.locator('.sc-shop__list button', { hasText: nameOf(id) }).first().click()
    await page.waitForTimeout(900)
  }
  await shot(page, '.sc-shop', '2-사고난뒤.png')
  await page.locator('.sc-sh__x, .sc-sheet__x, [aria-label="닫기"]').first().click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(500)

  // ── 주머니 ───────────────────────────────────────────────
  await openBag(page)
  await shot(page, '.sc-mi__bag', '3-주머니.png')

  // 빈 종이를 펼쳐 적는다
  await page.locator('.sc-mi__use', { hasText: '적어서 놓기' }).first().click()
  await page.waitForSelector('.sc-mi__write textarea')
  await page.locator('.sc-mi__write textarea').fill(MEMO)
  await page.waitForTimeout(300)
  await shot(page, '.sc-mi__bag', '4-빈종이.png')
  await page.locator('.sc-mi__write button', { hasText: '바닥에 놓기' }).click()
  await page.waitForTimeout(1500)

  // 놓은 종이를 줍고 찢으면 조각이 남는다 — 테이프가 쓸 자리가 생긴다
  await page.waitForSelector('.sc-sl__row button', { timeout: 10_000 })
  await page.locator('.sc-sl__row button', { hasText: '줍기' }).first().click()
  await page.waitForTimeout(1200)
  await page.locator('.sc-sl__list button', { hasText: '읽기' }).first().click()
  await page.waitForTimeout(1200)
  await shot(page, '.sc-sl', '5-내가쓴쪽지.png')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

/** 상점 줄에 뜨는 이름. 목록이 원본이라 여기서 지어내지 않는다 */
function nameOf(id: string): string {
  const it = SHOP_ITEMS.find((i) => i.id === id)
  if (!it) throw new Error(`그런 물건이 없다: ${id}`)
  return it.name
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
