// 메모 탭(수첩)을 찍고 재 본다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve
//   4. npx vite-node scripts/note-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'note-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }

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

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
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

async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

type Page = import('playwright').Page

async function shoot(w: number, h: number, browser: import('playwright').Browser) {
  const tag = `${w}`
  const game = `nt${tag}${Date.now()}`
  const me = `nt${tag}${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'nt' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await asPlayer(host, me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: SEED_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })

  const page: Page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1200)

  // 메모 탭
  await page.locator('.sc-ct__tab').nth(4).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/nt-${tag}-1-수첩.png` })
  await page.locator('.sc-ar__person-note').first().click()
  await page.locator('.sc-ar__person-note').first().type('쉬는 시간에 혼자 있었다', { delay: 25 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/nt-${tag}-2-적는중.png` })
  const note = await page.evaluate(`(() => {
    const page = document.querySelector('.sc-nb__page')
    const rings = document.querySelector('.sc-nb__rings')
    const first = document.querySelector('.sc-ar__person')
    const inp = document.querySelector('.sc-ar__person-note')
    const sel = document.querySelector('.sc-ar__guess')
    const pr = page.getBoundingClientRect()
    const rr = rings.getBoundingClientRect()
    const ir = inp.getBoundingClientRect()
    const sr = sel.getBoundingClientRect()
    const cs = getComputedStyle(rings)
    return {
      사람수: document.querySelectorAll('.sc-ar__person').length,
      종이폭: Math.round(pr.width),
      화면폭: window.innerWidth,
      스프링이종이를문다: Math.round(rr.left) < Math.round(pr.left) && Math.round(rr.right) > Math.round(pr.left),
      스프링화소: cs.imageRendering,
      스프링칸: cs.backgroundSize,
      메모높이: Math.round(ir.height),
      메모글씨: getComputedStyle(inp).fontSize,
      태그높이: Math.round(sr.height),
      가로구름: document.documentElement.scrollWidth - window.innerWidth,
      첫칸높이: Math.round(first.getBoundingClientRect().height),
    }
  })()`)

  // 치는 동안에는 탭바가 숨는다. 사람이 하듯 먼저 손을 뗀다
  await page.evaluate(`document.activeElement && document.activeElement.blur()`)
  await page.waitForTimeout(400)

  // 나 탭 — 알림이 뜨는가
  await page.locator('.sc-ct__tab').nth(1).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/nt-${tag}-3-알림.png` })
  const notices = (await page.locator('.sc-pl__notices li').allTextContents()).map((t) => t.trim())

  // 투표 탭 — 종이에 이름이 뜨는가
  await page.locator('.sc-ct__tab').nth(3).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/nt-${tag}-4-투표.png` })
  const ballot = await page.evaluate(`(() => ({
    이름수: document.querySelectorAll('.sc-bt__name').length,
  }))()`)

  // 무전 탭
  await page.locator('.sc-ct__tab').nth(2).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/nt-${tag}-5-무전.png` })

  console.log(
    JSON.stringify(
      {
        화면: `${w}×${h}`,
        수첩: note,
        알림: notices,
        투표: ballot,
        기대이름수: 13,
        터짐: boom,
      },
      null,
      1,
    ),
  )
  await page.close()
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  await shoot(375, 667, browser)
  await shoot(390, 844, browser)
  await browser.close()
  console.log('찍었다')
}

void main()
