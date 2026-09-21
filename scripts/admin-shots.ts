// 운영자 화면 — 칸마다 한 장씩.
//
// **판을 차려 놓고 찍는다.** 빈 판에서 찍으면 카드가 전부 「아직 판이
// 없다」라, 무엇을 만지는 화면인지가 한 장도 안 담긴다. 열넷을 앉히고
// 시작하고 심부름을 붙이고 화분에 심은 다음에 연다.
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/admin-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { BOARDS, ERRANDS } from '../shared/rules/errand'
import { TILES } from '../shared/rules/board'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/adminshots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
/** 운영자 화면은 주소의 game 을 본다. 없으면 live */
const GAME = 'live'

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
  const email = `ad-${tag}@x.test`
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

/** 저장소에 없는 코드. 읽기만 하고 어디에도 안 적는다 */
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}

const W = 420

/**
 * 찍기 전에 화면을 그것만큼 늘린다.
 *
 * **화면보다 긴 조각은 아래가 까맣게 잘린다.** 심부름 카드는 열 줄이
 * 서 있어서 900 높이에 안 들어갔고, 그 아래 절반이 검은 판으로
 * 찍혔다 — 자르고 나서야 알았다.
 */
async function fit(page: Page, sel: string): Promise<boolean> {
  const el = page.locator(sel).first()
  if ((await el.count()) === 0) return false
  await el.scrollIntoViewIfNeeded()
  const h = await el.evaluate((n) => Math.ceil((n as HTMLElement).getBoundingClientRect().height))
  await page.setViewportSize({ width: W, height: Math.min(Math.max(h + 80, 600), 12_000) })
  await page.waitForTimeout(300)
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  return true
}

/** 그 카드 하나만. 화면 전체는 무엇을 보라는지가 안 보인다 */
async function card(page: Page, title: string, file: string): Promise<void> {
  const sel = `.sc-ad__card:has(h2:text-is("${title}"))`
  if (!(await fit(page, sel))) {
    console.log(`  ✗ ${title} 카드가 없다`)
    return
  }
  await page.locator(sel).first().screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const host = await hostToken(String(Date.now()))

  console.log('── 판을 차린다 ──')
  /*
   * **같은 이름으로 다시 돌릴 수 있어야 한다.** 운영자 화면은 주소의
   * game 을 보고, 없으면 live 다 — 이름이 고정이라 두 번째부터는
   * 「같은 이름의 판이 있다」로 막힌다. 있으면 로비로 되돌린다
   * (resetGame 은 판 문서를 남기므로 createGame 은 그때 안 부른다).
   */
  const made = await fetch(`${FN}/createGame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host}` },
    body: JSON.stringify({ data: { gameId: GAME, seed: 'admin' } }),
  })
  if (!made.ok) await must('resetGame', host, { gameId: GAME })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: GAME })

  // 심부름 두 장과 화분 셋 — 빈 카드는 무엇을 하는 자리인지 안 보인다
  // 도착지는 붙일 때 고른다 — 여기서는 물건이 있는 방이 아닌 첫 방
  for (const [i, e] of ERRANDS.slice(0, 2).entries()) {
    const to = TILES.find((t) => t.id !== e.from)!.id
    await must('hostPostErrand', host, { gameId: GAME, specId: e.id, boardId: BOARDS[i].id, to }).catch((x) =>
      console.log(`  심부름 못 붙였다 — ${(x as Error).message}`),
    )
  }
  for (const [i, crop] of ['corn', 'strawberry', 'hers'].entries()) {
    await must('hostPlant', host, { gameId: GAME, pot: i, cropId: crop }).catch(() => undefined)
  }
  await must('openPhase', host, { gameId: GAME }).catch(() => undefined)
  console.log('  열넷 · DAY 1 · 1번 페이즈 열림 · 심부름 2 · 화분 3')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))

  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  // 종이 구석의 자판기 도장이 운영자 문이다
  await page.locator('.sc-gt__vend').click()
  await page.waitForSelector('#gt-code')
  await page.fill('#gt-code', hostCode())
  await page.locator('.sc-gt__submit').click()
  await page.waitForSelector('.sc-ad', { timeout: 20_000 })
  await page.waitForTimeout(2000)

  console.log('\n── 정말 구르는가 ──')
  /*
   * **scrollIntoView 로는 못 잰다.** 그건 잘린 상자도 프로그램으로
   * 밀어 버려서, 손가락으로는 못 내리는 화면에서도 캡처가 됐다 —
   * 그래서 「스크롤이 안 된다」를 한참 못 봤다. 휠로 밀고 scrollTop
   * 을 읽는다. 0 이면 손가락으로도 안 내려간다.
   */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.sc-ad__tabs button', { hasText: '놓기' }).click()
  await page.waitForTimeout(600)
  await page.mouse.move(195, 500)
  await page.mouse.wheel(0, 1500)
  await page.waitForTimeout(400)
  const top = await page.locator('.sc-ad').evaluate((n) => (n as HTMLElement).scrollTop)
  const max = await page.locator('.sc-ad').evaluate((n) => (n as HTMLElement).scrollHeight - (n as HTMLElement).clientHeight)
  console.log(`  놓기 탭을 휠로 밀었다 — scrollTop ${top} / 끝까지 ${max} → ${top > 0 ? '구른다 ✓' : '안 구른다 ✗'}`)
  await page.screenshot({ path: `${OUT}/0-폰에서-내린-뒤.png` })
  console.log('  찍었다 0-폰에서-내린-뒤.png')

  console.log('\n── 탭마다 한 장 ──')
  for (const [name, file] of [
    ['진행', '1-진행.png'],
    ['놓기', '2-놓기.png'],
    ['관리', '3-관리.png'],
  ] as const) {
    await page.setViewportSize({ width: W, height: 844 })
    await page.locator('.sc-ad__tabs button', { hasText: name }).click()
    await page.waitForTimeout(700)
    // 폰 크기 그대로 한 장 — 처음 열었을 때 보이는 만큼
    await page.locator('.sc-ad').evaluate((n) => ((n as HTMLElement).scrollTop = 0))
    await page.screenshot({ path: `${OUT}/${file.replace('.png', '-폰.png')}` })
    // 끝까지 펼친 한 장
    await fit(page, '.sc-ad')
    await page.locator('.sc-ad').screenshot({ path: `${OUT}/${file}` })
    console.log(`  찍었다 ${file} (+ 폰 크기)`)
  }

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
