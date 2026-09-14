// 방에서 방으로 못 간다는 말을 눈으로 확인한다.
//
// 세 갈래를 따로 잰다 — 십자키 한 번에 한 칸 가는가, 문을 넘어가는가,
// 먼 방을 눌렀을 때 갈 길이 생기는가. 어디가 막혔는지 알아야 고친다.
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const QA_PW = 'shots-password'

async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
}
async function auth(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) })
  return ((await r.json()) as { idToken: string }).idToken
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}

const GAME = `walk${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function main(): Promise<void> {
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'walk' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  console.log(`판 ${GAME}`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  ✗ 화면이 터졌다: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  · 콘솔: ${m.text().slice(0, 160)}`) })

  await page.goto(`${SITE}/play.html?game=${GAME}`, { waitUntil: 'networkidle' })
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
  const room = () => page.locator('.sc-wk__here').textContent({ timeout: 1500 }).catch(() => null)

  console.log('\n── 십자키 ──')
  const pad = await page.locator('.sc-pl__pad button').count()
  console.log(`  십자키 단추 ${pad}개`)
  for (const dir of ['up', 'down', 'left', 'right']) {
    const was = await at()
    await page.locator(`.sc-pl__pad button[data-dir="${dir}"]`).click({ force: true })
    await page.waitForTimeout(500)
    const now = await at()
    console.log(`  ${dir}: ${was} → ${now} ${was === now ? '✗ 안 움직였다' : '✓'}`)
  }

  console.log('\n── 십자키 꾹 누르기 ──')
  {
    const btn = page.locator('.sc-pl__pad button[data-dir="right"]')
    const b = await btn.boundingBox()
    if (b) {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      // 톡 — 한 칸이어야 한다
      const t0 = await at()
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(600)
      console.log(`  톡: ${t0} → ${await at()} (한 칸이어야 한다)`)
      // 꾹 — 이어 걸어야 한다
      const h0 = await at()
      await page.mouse.down()
      await page.waitForTimeout(1400)
      await page.mouse.up()
      await page.waitForTimeout(400)
      const h1 = await at()
      console.log(`  꾹 1.4초: ${h0} → ${h1}`)
      // 떼고 나서도 혼자 가는지
      await page.waitForTimeout(900)
      console.log(`  뗀 뒤 0.9초: ${h1} → ${await at()} (같아야 한다)`)
    }
  }

  console.log('\n── 키보드 방향키 ──')
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a']) {
    const was = await at()
    await page.keyboard.press(key)
    await page.waitForTimeout(500)
    const now = await at()
    console.log(`  ${key}: ${was} → ${now} ${was === now ? '✗ 안 움직였다' : '✓'}`)
  }
  console.log('  — 누르고 있으면 이어 걷는가')
  const held0 = await at()
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(1200)
  await page.keyboard.up('ArrowRight')
  await page.waitForTimeout(300)
  console.log(`  1.2초 누르고 있기: ${held0} → ${await at()}`)

  console.log('\n── 글 쓰는 중에 방향키 ──')
  await page.locator('.sc-pl__acts button:nth-child(3)').click({ force: true })
  await page.waitForTimeout(600)
  const box0 = page.locator('.sc-sheet__body input, .sc-sheet__body textarea').first()
  if ((await box0.count()) > 0) {
    await box0.fill('가나다라')
    await box0.focus()
    const wasAt = await at()
    // 글 가운데로 커서를 옮기려고 왼쪽을 누른다
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    const caret = await box0.evaluate((el) => (el as HTMLInputElement).selectionStart)
    console.log(`  커서 자리: ${caret} (4면 방향키를 화면이 가로챘다)`)
    console.log(`  사람: ${wasAt} → ${await at()} ${wasAt === (await at()) ? '✓ 안 움직였다' : '✗ 글 쓰는데 걸어갔다'}`)
  } else {
    console.log('  입력창을 못 찾았다')
  }
  await page.locator('.sc-sheet__head button').first().click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(400)

  console.log('\n── 캔버스를 눌러 걷기 ──')
  const box = await page.locator('.sc-wk__canvas').boundingBox()
  if (box) {
    const was = await at()
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5)
    await page.waitForTimeout(1500)
    console.log(`  오른쪽을 눌렀다: ${was} → ${await at()}`)
  }

  console.log('\n── 문 넘기 ──')
  console.log(`  지금 방: ${await room()}`)
  // 옆방을 눌러 본다 — 캔버스 가장자리 쪽
  for (const [fx, fy, label] of [[0.5, 0.03, '위쪽 끝'], [0.97, 0.5, '오른쪽 끝'], [0.5, 0.97, '아래쪽 끝'], [0.03, 0.5, '왼쪽 끝']] as [number, number, string][]) {
    if (!box) break
    const was = await room()
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(2500)
    const now = await room()
    const said = await page.locator('.sc-pl__said').textContent().catch(() => null)
    console.log(`  ${label}: ${was} → ${now}${said ? ` · 「${said}」` : ''}`)
    if (was !== now) break
  }

  console.log('\n── 십자키로 걸어서 문 넘기 ──')
  {
    // 쯔꾸르처럼. 문 쪽으로 계속 걸으면 저절로 옆방이어야 한다
    const crossed: string[] = []
    for (const dir of ['up', 'down', 'left', 'right', 'up', 'left', 'down', 'right']) {
      const was = await room()
      const wasAt = await at()
      const btn = page.locator(`.sc-pl__pad button[data-dir="${dir}"]`)
      const b = await btn.boundingBox()
      if (!b) continue
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(3000)
      await page.mouse.up()
      await page.waitForTimeout(1500)
      const now = await room()
      const said = await page.locator('.sc-pl__said').textContent().catch(() => null)
      console.log(`  ${dir} 3초: ${was}(${wasAt}) → ${now}(${await at()})${said ? ` · 「${said}」` : ''}`)
      if (was !== now && now) crossed.push(`${was}→${now}`)
    }
    console.log(`  걸어서 넘은 문 ${crossed.length}개: ${crossed.join(', ')}`)
  }

  console.log('\n── 먼 방을 눌렀을 때 ──')
  await page.locator('.sc-pl__acts button:nth-child(2)').click({ force: true })
  await page.waitForTimeout(600)
  // 미니맵도 같은 class 를 쓴다. 전체 맵 안쪽으로 좁힌다
  const rooms = page.locator('.sc-atlas .sc-mp__room')
  console.log(`  전체 맵의 방 ${await rooms.count()}개`)
  const before = await page.locator('.sc-atlas__card h3').textContent().catch(() => null)
  console.log(`  열자마자 뜬 방: ${before}`)
  const names: string[] = []
  for (let i = 0; i < Math.min(8, await rooms.count()); i++) {
    names.push((await rooms.nth(i).textContent())?.replace(/\s+/g, ' ').slice(0, 14) ?? '?')
  }
  console.log(`  앞쪽 방들: ${JSON.stringify(names)}`)
  // 손가락으로 누른다. 진짜 기기가 하는 것과 같은 순서로
  const target = rooms.nth(3).locator('rect').first()
  const rb = await target.boundingBox()
  console.log(`  네모 자리: ${JSON.stringify(rb)}`)
  if (rb) {
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x as number, y as number)
        const path: string[] = []
        for (let e: Element | null = el; e; e = e.parentElement) {
          path.push(`${e.tagName}.${typeof e.className === 'string' ? e.className : (e.className as unknown as SVGAnimatedString)?.baseVal}`)
          if (path.length > 6) break
        }
        return path
      },
      [rb.x + rb.width / 2, rb.y + rb.height / 2],
    )
    console.log(`  그 점에 있는 것: ${JSON.stringify(hit)}`)
    await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2)
  }
  await page.waitForTimeout(700)
  console.log(`  손가락 뒤 카드: ${await page.locator('.sc-atlas__card h3').textContent().catch(() => null)}`)
  await target.click({ force: true }).catch((e) => console.log(`  누르다 실패: ${e}`))
  await page.waitForTimeout(700)
  console.log(`  누른 뒤 카드: ${await page.locator('.sc-atlas__card h3').textContent().catch(() => null)}`)
  console.log(`  is-picked 개수: ${await page.locator('.sc-atlas .sc-mp__room.is-picked').count()}`)
  const goBtn = await page.locator('.sc-atlas__sheet button').allTextContents()
  console.log(`  거기서 누를 수 있는 것: ${JSON.stringify(goBtn)}`)

  const go = page.locator('.sc-atlas__go')
  if ((await go.count()) === 0) {
    console.log('  ✗ 「여기로 간다」가 없다 — 지도에서 방으로 못 간다')
  } else {
    await go.click({ force: true })
    await page.waitForTimeout(700)
    const title = await page.locator('.sc-sheet__head h2').textContent().catch(() => null)
    const inSheet = await page.locator('.sc-sheet__body button').allTextContents()
    console.log(`  시트 제목: ${title} · 단추 ${JSON.stringify(inSheet.slice(0, 6))}`)
    const walk = page.locator('.sc-sheet__body button', { hasText: '걸어가기' }).first()
    if ((await walk.count()) === 0) {
      console.log('  ✗ 「걸어가기」가 없다')
    } else {
      const was = await room()
      await walk.click({ force: true })
      await page.waitForTimeout(2000)
      const said = await page.locator('.sc-pl__said').textContent().catch(() => null)
      console.log(`  걸어가기: ${was} → ${await room()} · 「${said ?? ''}」`)
    }
  }

  await page.screenshot({ path: '/tmp/claude-0/walk-probe.png' })
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
