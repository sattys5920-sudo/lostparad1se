// 진짜 시계로 도는 판에서 자유 시간에 문을 넘는다.
//
// 여태 시험은 전부 개발용 시계를 걸어 놓고 했다. 실제 판은 그냥
// 실제 시각으로 돈다 — 거기서만 생기는 일이 있는지 본다.
//
// 자유 시간 걸음(roamTo)은 공짜고 즉시다. 페이즈 중에는 토큰이 들고
// 10분이 걸린다 — 그 10분 동안 사람은 어디에도 서 있지 않다.
// **시계가 안 가면 영영 안 도착한다.** 그러면 밖에서 보기에는
// 그냥 「방에서 방으로 안 건너가진다」이다.
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

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

async function main() {
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he); const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'pw' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: Date.now() })
  // **개발용 시계를 안 건다. 페이즈도 안 연다.** 실제 판 그대로다
  console.log(`판 ${GAME} · 진짜 시계 · 자유 시간`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  ✗ 화면이 터졌다: ${e.message}`))

  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.sc-pl__gate', { timeout: 20_000 })
  await page.fill('input[placeholder="아이디"]', 'qa01')
  await page.fill('input[placeholder="비밀번호"]', QA_PW)
  await page.locator('.sc-pl__gate button.sc-pl__go').click()
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

  console.log('\n── 자유 시간에 문으로 걸어 들어간다 ──')
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
  console.log(`  선 방: ${await room()}`)

  await page.screenshot({ path: '/tmp/claude-0/phase-walk.png' })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
