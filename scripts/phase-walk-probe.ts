// 페이즈 중에 문을 넘으면 어떻게 되는가.
//
// 자유 시간 걸음(roamTo)은 공짜고 즉시다. 페이즈 중에는 토큰이 들고
// 10분이 걸린다 — 그 10분 동안 사람은 어디에도 서 있지 않다.
// **시계가 안 가면 영영 안 도착한다.** 그러면 밖에서 보기에는
// 그냥 「방에서 방으로 안 건너가진다」이다.
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const QA_PW = 'shots-password'
const J = { 'Content-Type': 'application/json' }

async function signUp(e: string) { await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: J, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return e }
async function setAdmin(e: string) {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { ...J, ...ADMIN }, body: JSON.stringify({ email: [e] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { ...J, ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(e: string) { const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: J, body: JSON.stringify({ email: e, password: 'password', returnSecureToken: true }) }); return ((await r.json()) as { idToken: string }).idToken }
async function must(n: string, tk: string, d: unknown) {
  const r = await fetch(`${FN}/${n}`, { method: 'POST', headers: { ...J, Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data: d }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}

const GAME = `pw${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main() {
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he); const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'pw' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
  await must('openPhase', host, { gameId: GAME })
  console.log(`판 ${GAME} · 페이즈를 열었다`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  ✗ 화면이 터졌다: ${e.message}`))

  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.sc-gt', { timeout: 20_000 })
  await page.fill('#gt-id', 'qa01')
  await page.fill('#gt-pw', QA_PW)
  await page.locator('.sc-gt__submit').click()
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.mouse.click(187, 333).catch(() => undefined)
    await page.waitForTimeout(500)
  }
  await page.locator('.sc-home__panel button').click().catch(() => undefined)
  await page.waitForTimeout(500)

  const at = () => page.locator('.sc-wk__canvas').getAttribute('data-at')
  const room = () => page.locator('.sc-wk__here').textContent({ timeout: 1200 }).catch(() => null)
  const said = () => page.locator('.sc-pl__said').textContent({ timeout: 1200 }).catch(() => null)
  const transit = () => page.locator('.sc-wk__transit').textContent({ timeout: 1200 }).catch(() => null)
  const tokens = () => page.locator('.sc-pl__stat li').first().textContent({ timeout: 1200 }).catch(() => null)

  console.log(`\n  시계: ${await page.locator('.sc-pl__clock').textContent().catch(() => null)}`)
  console.log(`  ${await tokens()}`)
  console.log(`  선 방: ${await room()}`)

  console.log('\n── 페이즈 중에 문으로 걸어 들어간다 ──')
  for (const dir of ['up', 'down', 'left', 'right']) {
    if (await transit()) break
    const b = await page.locator(`.sc-pl__pad button[data-dir="${dir}"]`).boundingBox()
    if (!b) continue
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(3000)
    await page.mouse.up()
    await page.waitForTimeout(1200)
    console.log(`  ${dir}: ${await at()} · 방 ${await room()} · 「${await said()}」`)
  }

  const t = await transit()
  console.log(`\n  이동 중 표시: ${t ? `「${t.replace(/\s+/g, ' ')}」` : '없다'}`)
  console.log(`  ${await tokens()}`)

  if (t) {
    // **화면이 스스로 도착해야 한다.** 시계만 밀어 두고 따라잡기는
    // 부르지 않는다 — 걷는 동안 화면이 서버를 두드리기로 했으니까
    console.log('\n── 시계만 10분 밀고, 따라잡기는 안 부른다 ──')
    clock += 11 * 60_000
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(4000)
      const still = await transit()
      console.log(`  ${i * 4}초: ${still ? `이동 중 「${still.replace(/\s+/g, ' ')}」` : `도착 · ${await room()}`}`)
      if (!still) break
    }
  }

  await page.screenshot({ path: '/tmp/claude-0/phase-walk.png' })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
