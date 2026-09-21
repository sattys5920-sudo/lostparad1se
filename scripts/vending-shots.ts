// 자판기 — 일곱 장면, 두 화면 크기.
//
// 기본 · 칸 선택 · 구매 연출 두 프레임 · 배출 완료 · 돈 부족 ·
// 하루 한도 소진 · 형광등 꺼진 프레임.
//
// **연출 중 프레임은 시각으로 잡는다.** 누르고 나서 몇 밀리초 뒤에
// 찍느냐로 어느 프레임인지가 갈린다 — 눈으로 보고 「그쯤」 찍으면
// 매번 다른 그림이 나온다.
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
const OUT = '/tmp/claude-0/vendshots'

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


/** 자판기를 연다. 상점 칸에 서 있어야 「구매」가 선다 */
async function openVending(page: Page): Promise<void> {
  await page.locator('.sc-ct__act', { hasText: '구매' }).first().click()
  await page.waitForSelector('.sc-vd__body', { timeout: 10_000 })
  // 들어오면 형광등이 두 번 깜빡인다. 켜진 뒤에 찍는다
  await page.waitForTimeout(900)
}

/** 화면 전체. 자판기는 화면을 통째로 쓰므로 조각이 아니라 한 장이다 */
async function full(page: Page, file: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

/** 한 칸이 스크롤 없이 다 들어왔는가. **눈이 아니라 자로 잰다.** */
async function measure(page: Page): Promise<Record<string, unknown>> {
  return await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null
    const body = box('.sc-vd__body')
    const cells = [...document.querySelectorAll('.sc-vd__cell')].map((c) => c.getBoundingClientRect())
    const doc = document.documentElement
    return {
      칸: cells.length,
      // 마지막 칸의 아래가 본체 안에 들어오는가
      마지막칸아래: cells.length ? Math.round(cells[cells.length - 1].bottom) : null,
      본체아래: body ? Math.round(body.bottom) : null,
      보이는높이: doc.clientHeight,
      세로스크롤: doc.scrollHeight > doc.clientHeight,
      가로스크롤: doc.scrollWidth > doc.clientWidth,
      아이콘: (() => {
        const i = document.querySelector('.sc-vd__icon') as HTMLImageElement | null
        if (!i) return null
        const r = i.getBoundingClientRect()
        // 12px 그림을 정수 배로 늘렸는가
        return { 그린크기: Math.round(r.width), 원본: i.naturalWidth, 배수: Math.round(r.width) / i.naturalWidth }
      })(),
    }
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `vd${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'vd' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const meUid = uidOf('qa01')
  const myTeam = await teamOf(game, meUid)
  await fund(game, myTeam, 40)
  await standAt(game, meUid, SHOP_TILE)
  /*
   * 지우개는 남이 오늘 몫을 사 갔다고 해 둔다. **판을 차리는 것**이지
   * 화면을 속이는 것이 아니다 — 서버가 세는 자리에 그대로 적는다
   */
  await fetch(`${FS}/games/${game}/secret/shopStock/items/d1:eraser`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { day: { integerValue: '1' }, itemId: { stringValue: 'eraser' }, n: { integerValue: '1' } },
    }),
  })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const [w, h] of [[375, 667], [390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))
    await enter(page, game, 'qa01')
    await openVending(page)

    console.log(`\n── ${w}×${h} ──`)
    console.log('  잰 것:', JSON.stringify(await measure(page), null, 0))
    await full(page, `${w}-1-기본.png`)

    // 칸 선택
    await page.locator('.sc-vd__cell').nth(2).click()
    await page.waitForTimeout(300)
    await full(page, `${w}-2-칸선택.png`)

    // 구매 연출. **누르고 나서 시각으로 프레임을 잡는다**
    await page.locator('.sc-vd__push').click()
    await page.waitForTimeout(70)
    await full(page, `${w}-3-동전.png`)
    await page.waitForTimeout(180)
    await full(page, `${w}-4-표시창.png`)
    await page.waitForSelector('.sc-vd__out2', { timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(250)
    await full(page, `${w}-5-배출.png`)
    await page.waitForTimeout(4000)

    /*
     * 돈 부족 — 금고를 비운다.
     *
     * **문서만 고치면 화면이 안 바뀐다.** 내 몫(views)은 무슨 일이
     * 일어날 때 다시 만들어지므로, 서버가 한 번 일하게 해서 깨운다.
     * 앞서 한 번 여기서 속았다 — 칸이 멀쩡해 보여서 CSS 를 의심했다
     */
    await fund(game, myTeam, 1)
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await full(page, `${w}-6-돈부족.png`)

    // 하루 한도 — 지우개를 남이 사 간 판
    await fund(game, myTeam, 40)
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await page.locator('.sc-vd__cell').nth(4).click()
    await page.waitForTimeout(400)
    await full(page, `${w}-7-한도.png`)

    await ctx.close()
  }

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
