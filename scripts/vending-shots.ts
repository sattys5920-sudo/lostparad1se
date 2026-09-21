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
import { walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { SHOP_ITEMS, VENDINGS } from '../shared/rules/shop'

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
/** 2-3 교실과 같은 층의 기계. 걸어서 갈 수 있는 한 대다 */
const MACHINE = VENDINGS.find((v) => v.floor === 'f2')!

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


/**
 * 지갑을 채운다. 값이 모자라 못 사는 화면은 여기서 볼 것이 아니다.
 *
 * **팀 금고가 아니라 사람 주머니다.** 돈이 개인 소유로 옮겨 간 뒤에도
 * 이 손은 한참 teams/ 를 고치고 있었다 — 고쳐도 화면의 「돈」은 꿈쩍
 * 않는다. views 는 pawns 의 resources 를 읽는다.
 */
async function fund(game: string, uid: string, money: number): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=resources`, {
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

/** 손에 딴 것을 쥐여 준다. 매입구에 넣을 것이 있어야 그 줄이 산다 */
async function giveCrops(game: string, uid: string, crops: Record<string, number>): Promise<void> {
  await fetch(`${FS}/games/${game}/pawns/${uid}?updateMask.fieldPaths=crops`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        crops: {
          mapValue: {
            fields: Object.fromEntries(
              Object.entries(crops).map(([k, n]) => [k, { integerValue: String(n) }]),
            ),
          },
        },
      },
    }),
  })
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


/** 그 칸 앞까지 걸어간다. 손은 lib/walk 에 있다 — 캡처 셋이 같이 쓴다 */
const walkTo = (page: Page, game: string, uid: string, want: { x: number; y: number }, what = '자리') =>
  walkToCell({ page, fs: FS, admin: ADMIN, game, uid, want, what })

/** 자판기를 연다. **기계 앞에 서 있어야** 「자판기」가 선다 */
async function openVending(page: Page): Promise<void> {
  await page.locator('.sc-ct__act', { hasText: '자판기' }).first().click()
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
  await fund(game, meUid, 40)
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

    console.log(`\n── ${w}×${h} ──`)
    /*
     * **걸어서 간다.** 서버 문서를 고쳐 세워 봐야 소용없다 — 아바타는
     * 화면이 쥐고 있고, 「자판기」 단추는 화면이 아는 제 칸으로 판단한다.
     *
     * 걸어가는 김에 복도에 선 기계를 한 장 찍는다. **이 그림이 판에서
     * 기계를 마주치는 유일한 자리다** — 시트는 누른 뒤에나 열린다.
     */
    await walkTo(page, game, meUid, MACHINE.cell, '자판기')
    await page.waitForTimeout(1200)
    await full(page, `${w}-0-복도의-기계.png`)
    await openVending(page)
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
    await fund(game, meUid, 1)
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await full(page, `${w}-6-돈부족.png`)

    // 하루 한도 — 지우개를 남이 사 간 판
    await fund(game, meUid, 40)
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await page.locator('.sc-vd__cell').nth(4).click()
    await page.waitForTimeout(400)
    await full(page, `${w}-7-한도.png`)

    /*
     * ── 매입구 ────────────────────────────────────────────
     *
     * **빈 줄부터 찍는다.** 손에 아무것도 없을 때 「넣을 것 없음」이
     * 서 있어야, 그 줄이 무엇을 하는 자리인지 딴 것이 없는 사람도
     * 안다. 줄 자체를 감추면 정원에 다녀올 때까지 이 기계가 사는
     * 기계이기만 한 줄 안다.
     */
    // **손부터 비운다.** 두 번째 화면 크기는 같은 판을 다시 여는데,
    // 앞 바퀴에서 쥐여 준 것이 그대로 남아 「빈손」이 빈손이 아니었다
    await giveCrops(game, meUid, {})
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await full(page, `${w}-8-매입구-빈손.png`)

    // 딴 것을 쥐여 준다. 값이 다른 셋 — 줄이 값 순으로 선다
    await giveCrops(game, meUid, { corn: 1, strawberry: 2, hers: 1 })
    await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
    await page.waitForTimeout(2500)
    await full(page, `${w}-9-매입구-손에.png`)

    /*
     * 넣는다. **표시창에 값이 뜬다** — 흥정이 없으므로 「얼마에
     * 팔렸나」가 아니라 「얼마짜리였나」가 전부다.
     */
    await page.locator('.sc-vd__crop').first().click()
    await page.waitForTimeout(900)
    await full(page, `${w}-10-넣었다.png`)

    await ctx.close()
  }

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
