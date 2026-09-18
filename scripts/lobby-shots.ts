// 문 앞 — 판이 없을 때, 자리가 남았을 때, 다 찼을 때, 그리고 들어간 뒤.
//
// 에뮬레이터에 진짜 판을 세우고 사람으로 들어가서 찍는다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//      그리고 /tmp/claude-0/serve 를 8899 로 서빙
//   4. npx vite-node scripts/lobby-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
const SEED_PW = 'seed-password-1'
const MY_PW = 'lobby-shot-1'

async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

/** 운영자 증표. 코드는 안 쓴다 — 에뮬레이터 Auth 에 직접 표를 붙인다 */
async function hostToken(): Promise<string> {
  const email = `host${Date.now()}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

type Page = import('playwright').Page

/*
 * 두 번째 이동부터는 networkidle 을 못 쓴다.
 *
 * 들어가고 나면 Firestore 가 판을 계속 듣고 있어서 **그물이 영영
 * 조용해지지 않는다.** 처음 여는 순간에만 아직 아무것도 안 듣는다.
 */
const READY = { waitUntil: 'domcontentloaded' } as const

/** 가입하고 나를 만들어 문 앞까지 간다. 사람이 하는 것과 같은 길이다. */
async function enter(page: Page, game: string, id: string): Promise<void> {
  await page.goto(`${SITE}/?game=${game}`, READY)
  await page.click('.sc-gt__link')
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-cc', { timeout: 10_000 })
  await page.fill('#cc-name', '수아')
  await page.click('.sc-cc__done')
  await page.waitForSelector('.sc-lb', { timeout: 10_000 })
  await page.waitForTimeout(900)
}

async function main() {
  const host = await hostToken()
  const stamp = Date.now()
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const s of SIZES) {
    /*
     * 판을 **크기마다 새로 세운다.**
     *
     * 한 판을 둘이 나눠 쓰면 앞 크기에서 마지막 자리를 채워 버려서,
     * 뒤 크기는 「들어가기」가 막힌 채로 온다. 자리는 열넷뿐이다.
     */
    const some = `lb${stamp}a${s.w}`
    const full = `lb${stamp}b${s.w}`
    await must('createGame', host, { gameId: some, seed: 'lba' })
    await must('seedPlayers', host, { gameId: some, password: SEED_PW })
    await must('createGame', host, { gameId: full, seed: 'lbb' })
    await must('seedPlayers', host, { gameId: full, password: SEED_PW })
    // 마지막 한 자리까지 채운다 — 「자리가 다 찼다」를 보려면 열넷이어야 한다
    await must('joinGame', host, { gameId: full, name: '열넷째' })

    const page = await browser.newPage({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })

    // 1 열린 판이 없다
    await enter(page, `none${stamp}`, `lbn${stamp % 100000}${s.w}`)
    await page.screenshot({ path: `${OUT}/lb-${s.w}-1-판없음.png` })

    // 2 자리가 남았다
    await page.goto(`${SITE}/?game=${some}`, READY)
    await page.waitForSelector('.sc-lb__go', { timeout: 10_000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/lb-${s.w}-2-문앞.png` })

    // 3 다 찼다 — 들어가기가 막혀 있어야 한다
    await page.goto(`${SITE}/?game=${full}`, READY)
    await page.waitForSelector('.sc-lb__go', { timeout: 10_000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/lb-${s.w}-3-가득.png` })
    const shut = await page.getAttribute('.sc-lb__go', 'disabled')

    // 4 들어간 뒤 — 명단은 같은 격자를 시트 위에서 쓴다
    await page.goto(`${SITE}/?game=${some}`, READY)
    await page.waitForSelector('.sc-lb__go', { timeout: 10_000 })
    await page.click('.sc-lb__go')
    await page.waitForSelector('.sc-pl__before', { timeout: 15_000 })
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${OUT}/lb-${s.w}-4-DAY0.png` })
    await page.click('text=모인 사람')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/lb-${s.w}-5-명단.png` })

    console.log(
      s.w,
      JSON.stringify({
        가득할때막힘: shut !== null,
        가로구름: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        자리: await page.locator('.sc-roll__one').count(),
      }),
    )
    await page.close()
  }
  await browser.close()
  console.log('찍었다')
}

void main()
