// 탭 다섯 — 맵 · 나 · 무전 · 투표 · 메모.
//
// 에뮬레이터에 판을 세우고 시작까지 밀어 넣은 다음, 사람으로 들어가서
// 탭을 하나씩 눌러 찍는다. 가짜 화면을 찍지 않는다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//      그리고 /tmp/claude-0/serve 를 8899 로 서빙
//   4. npx vite-node scripts/tab-shots.ts
import { createHash } from 'node:crypto'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const GAME = `tab${Date.now()}`
const ME = `tab${String(Date.now()).slice(-6)}`
const MY_PW = 'tab-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
/** 찍는 사람 얼굴. 점이 아니라 사람으로 나와야 한다 */
const FACE = {
  styleSet: 'F',
  hairStyle: 'F03',
  hairColor: 2,
  expression: 1,
  outfit: 2,
  wearStyle: 0,
  bottom: 1,
  neckwear: 1,
}

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

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

async function hostToken(): Promise<string> {
  const email = `host-${GAME}@x.test`
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

/** 그 사람 자신으로 서버를 부른다. 화면이 하는 것과 같은 길이다. */
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

async function main() {
  const host = await hostToken()
  await must('createGame', host, { gameId: GAME, seed: 'tab' })
  await must('signUpAccount', host, { id: ME, password: MY_PW })
  // **얼굴부터 만든다.** 안 만들면 앱이 캐릭터 만들기에서 멈춰 선다
  const meTok = await asPlayer(host, ME)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: GAME, name: '수아' })
  await must('seedPlayers', host, { gameId: GAME, password: SEED_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: GAME })
  console.log(`판 ${GAME} · ${ME} 로 들어간다`)
  void uidOf

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page: Page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', ME)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')

  // 아침은 탭으로만 넘어간다. **건너뛰기는 없다** — 사람이 하는 것과 같다
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(1200)

  const tabs = ['맵', '나', '무전', '투표', '메모']
  for (const [i, name] of tabs.entries()) {
    await page.locator('.sc-ct__tab').nth(i).click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/tab-${i + 1}-${name}.png` })
  }

  console.log(
    JSON.stringify({
      탭수: await page.locator('.sc-ct__tab').count(),
      이름: (await page.locator('.sc-ct__tab').allTextContents()).map((t) => t.trim()),
      터짐: boom,
    }),
  )
  await browser.close()
  console.log('찍었다')
}

void main()
