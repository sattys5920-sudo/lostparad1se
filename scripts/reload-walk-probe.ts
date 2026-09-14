// 걸어서 옮긴 뒤에 화면을 새로 열면 어떻게 되는가.
//
// **여기서 나던 일이다.** 아바타는 늘 우리 팀 출발 자리에 서고,
// 서버는 그 사이 걸어간 방을 기억한다. 둘이 어긋난 채로 문을 넘으면
// 「이미 그 방이다」가 뜬다 — 내가 선 방으로 가자고 말하고 있으니까.
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

const GAME = `rl${Date.now()}`

async function main() {
  const he = await signUp(`h-${GAME}@x.test`); await setAdmin(he); const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'rl' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: Date.now() })
  console.log(`판 ${GAME}`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  ✗ 화면이 터졌다: ${e.message}`))

  const enter = async () => {
    await page.goto(`${SITE}/play.html?game=${GAME}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    if (await page.locator('.sc-pl__gate').count()) {
      await page.fill('input[placeholder="아이디"]', 'qa01')
      await page.fill('input[placeholder="비밀번호"]', QA_PW)
      await page.locator('.sc-pl__gate button.sc-pl__go').click()
    }
    // 아침 시퀀스는 넘기되, **아무 데나 누르지 않는다** — 기다리는
    // 화면에 「다시 해 본다」가 떠 있으면 그것을 눌러 새로고침이
    // 돌고 돌았다
    for (let i = 0; i < 24; i++) {
      if (await page.locator('.sc-pl__today').count()) break
      if (await page.locator('.sc-wait').count()) {
        const why = await page.locator('.sc-wait').textContent().catch(() => '')
        throw new Error(`기다리는 화면에서 멈췄다: ${why?.replace(/\s+/g, ' ').slice(0, 80)}`)
      }
      // 아침은 아무 데나 눌러 넘긴다. 기다리는 화면일 때만 손을 뗀다
      await page.mouse.click(187, 333).catch(() => undefined)
      await page.waitForTimeout(500)
    }
    await page.locator('.sc-home__panel button').click().catch(() => undefined)
    await page.waitForTimeout(900)
  }
  const room = () => page.locator('.sc-wk__here').textContent({ timeout: 1500 }).catch(() => null)
  const said = () => page.locator('.sc-pl__said').textContent({ timeout: 1200 }).catch(() => null)
  const hold = async (dir: string, ms: number) => {
    const b = await page.locator(`.sc-pl__pad button[data-dir="${dir}"]`).boundingBox()
    if (!b) return
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(ms)
    await page.mouse.up()
    await page.waitForTimeout(1500)
  }

  await enter()
  console.log(`\n  처음 선 방: ${await room()}`)

  console.log('\n── 걸어서 옆방으로 옮긴다 ──')
  for (const d of ['up', 'down', 'left', 'right']) {
    const was = await room()
    await hold(d, 3000)
    const now = await room()
    console.log(`  ${d}: ${was} → ${now}`)
    if (was !== now && now) break
  }
  const moved = await room()

  console.log('\n── 화면을 새로 연다 ──')
  await enter()
  const after = await room()
  console.log(`  옮긴 방 ${moved} · 새로 연 뒤 ${after} ${moved === after ? '✓ 같다' : '✗ 어긋났다'}`)

  console.log('\n── 새로 연 뒤에 문으로 걸어 본다 ──')
  const crossed: string[] = []
  for (const d of ['up', 'down', 'left', 'right']) {
    const was = await room()
    await hold(d, 3000)
    const now = await room()
    const msg = await said()
    console.log(`  ${d}: ${was} → ${now}${msg ? ` · 「${msg.replace(/\s+/g, ' ')}」` : ''}`)
    if (was !== now && now) crossed.push(`${was}→${now}`)
  }
  console.log(`\n  넘은 문 ${crossed.length}개: ${crossed.join(', ') || '없다'}`)
  await page.screenshot({ path: '/tmp/claude-0/reload-walk.png' })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
