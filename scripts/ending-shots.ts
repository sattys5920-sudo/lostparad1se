// 엔딩 — 운영자가 적는 자리와, 그 글이 뜨는 자리.
//
// 판정은 ending-e2e 가 본다. 여기서 보는 것은 **화면**이다. 관리 탭의
// 엔딩 책상(받는 사람 고르기 · 글 · 적어 둔 목록)과, 닷새가 끝난 뒤
// 사람 화면에 뜨는 종이 한 장.
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/ending-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/endshots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const GAME = 'live'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

const ALL_TEXT = [
  '눈이 그쳤다.',
  '교문이 열린 것은 아니다. 그저 하얗던 창밖에 회색이 섞이기 시작했을 뿐이다.',
  '닷새 동안 누가 무엇을 했는지는 각자 알고 있다.',
].join('\n')

const MINE_TEXT = [
  '너는 마지막 날 창고 문 앞에 서 있었다.',
  '문을 열지는 않았다. 열 수 있었는지도 이제 와서는 알 수 없다.',
  '다만 그 자리에 있었던 것은 너뿐이었다.',
].join('\n')

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
  const email = `eshot-${tag}@x.test`
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

async function shot(page: Page, sel: string, file: string): Promise<void> {
  const el = page.locator(sel).first()
  if ((await el.count()) === 0) {
    console.log(`  ✗ ${sel} 이 없다`)
    return
  }
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const host = await hostToken(String(Date.now()))

  console.log('── 판을 차린다 ──')
  const made = await fetch(`${FN}/createGame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host}` },
    body: JSON.stringify({ data: { gameId: GAME, seed: 'ending' } }),
  })
  if (!made.ok) await must('resetGame', GAME ? host : host, { gameId: GAME })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: GAME })
  console.log('  열넷 · DAY 1')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))

  console.log('\n── 운영자가 적는 자리 ──')
  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await page.locator('.sc-gt__vend').click()
  await page.waitForSelector('#gt-code')
  await page.fill('#gt-code', hostCode())
  await page.locator('.sc-gt__submit').click()
  await page.waitForSelector('.sc-ad', { timeout: 20_000 })
  await page.locator('.sc-ad__tabs button', { hasText: '관리' }).click()
  await page.waitForSelector('.sc-ad__end', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await shot(page, '.sc-ad__sec:has(h2:text-is("엔딩"))', '1-엔딩-빈-책상.png')

  // 모두에게 한 편
  await page.locator('.sc-ad__endbox').fill(ALL_TEXT)
  await page.locator('.sc-ad__end button.is-primary').click()
  await page.waitForTimeout(900)

  // 한 사람에게 한 편 — qa01
  const mine = uidOf('qa01')
  await page.selectOption('.sc-ad__end select', mine)
  await page.waitForTimeout(400)
  await page.locator('.sc-ad__endbox').fill(MINE_TEXT)
  await page.locator('.sc-ad__end button.is-primary').click()
  await page.waitForTimeout(900)
  await shot(page, '.sc-ad__sec:has(h2:text-is("엔딩"))', '2-엔딩-두-편-적은-뒤.png')

  console.log('\n── 닷새를 끝낸다 ──')
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 5, 25), speed: 1 })
  await must('tick', host, { gameId: GAME })
  for (let i = 0; i < 40; i++) {
    const r = (await must('pushDay', host, { gameId: GAME })) as { phase?: string; pushed?: string | null }
    if (r.phase === 'finished' || r.pushed === null) break
  }
  console.log('  phase finished')

  console.log('\n── 사람 화면에 뜨는 자리 ──')
  // **새 창이 아니라 새 칸이다.** 같은 칸에서 열면 운영자로 로그인한
  // 채로 열려서 로그인 종이가 아예 안 뜬다
  const pctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
  const p = await pctx.newPage()
  p.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))
  await p.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await p.fill('#gt-id', 'qa01')
  await p.fill('#gt-pw', QA_PW)
  await p.locator('.sc-gt__submit').click()
  await p.waitForSelector('.sc-en', { timeout: 30_000 }).catch(() => console.log('  ✗ 엔딩 화면이 안 떴다'))
  // 타자가 다 찍힐 때까지 탭한다
  for (let i = 0; i < 12; i++) {
    await p.locator('.sc-en__paper').click({ timeout: 800 }).catch(() => undefined)
    await p.waitForTimeout(500)
  }
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${OUT}/3-사람-화면.png` })
  console.log('  찍었다 3-사람-화면.png')

  const text = await p.locator('.sc-en').innerText().catch(() => '')
  console.log(`\n  모두에게 몫이 보이는가 — ${text.includes('눈이 그쳤다') ? '✓' : '✗'}`)
  console.log(`  제 몫이 보이는가 — ${text.includes('창고 문 앞') ? '✓' : '✗'}`)

  // 안 적어 준 사람에게는 모두에게 것만
  const qctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
  const q = await qctx.newPage()
  await q.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await q.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await q.fill('#gt-id', 'qa05')
  await q.fill('#gt-pw', QA_PW)
  await q.locator('.sc-gt__submit').click()
  await q.waitForSelector('.sc-en', { timeout: 30_000 }).catch(() => undefined)
  for (let i = 0; i < 12; i++) {
    await q.locator('.sc-en__paper').click({ timeout: 800 }).catch(() => undefined)
    await q.waitForTimeout(400)
  }
  const other = await q.locator('.sc-en').innerText().catch(() => '')
  console.log(`  남의 몫이 안 새는가 — ${other.includes('창고 문 앞') ? '✗ 샜다' : '✓'}`)
  await q.screenshot({ path: `${OUT}/4-안-적어-준-사람.png` })
  console.log('  찍었다 4-안-적어-준-사람.png')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
