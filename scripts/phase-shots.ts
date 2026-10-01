// 페이즈의 행동 칸 — **점령과 연구뿐이다.**
//
// 생산·공부를 없앤 뒤로 페이즈에 토큰을 쓰는 길은 방을 먹는 것과
// 연구 둘이다. 그 둘이 화면에 남아 있고 없앤 둘은 사라졌는지를,
// 가짜 화면이 아니라 진짜 판에 들어가서 본다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir <serve>/lostparad1se
//   4. npx vite-node scripts/phase-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'phase-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
void uidOf

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

async function hostToken(tag: string) {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const up = await fetch(`${SITE}/`).then((r) => r.ok).catch(() => false)
  if (!up) throw new Error(`서버가 없다(${SITE})`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const missed: string[] = []
  const size = { w: 390, h: 844 }

  const game = `ph${Date.now()}`
  const me = `ph${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await call('createGame', host, { gameId: game, seed: 'ph' })
  await call('signUpAccount', host, { id: me, password: MY_PW })
  const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  const meTok = ((await swap.json()) as { idToken: string }).idToken
  await call('saveCharacter', meTok, { nickname: '수아', avatar: { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 } })
  await call('joinGame', meTok, { gameId: game, name: '수아' })
  await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await call('assignAll', host, { gameId: game })
  await call('startGame', host, { gameId: game, startAtMs: START })
  await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await call('tick', host, { gameId: game })
  await call('markMorning', meTok, { gameId: game, read: [1] })

  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1500)

  /** 행동 칸에 적힌 이름들. 「더보기」 뒤에 숨은 것까지 센다 */
  async function labels(): Promise<string[]> {
    const shown = await page.locator('.sc-ct__act').allInnerTexts()
    const out = shown.map((t) => t.split('\n').pop()?.trim() ?? '')
    if (out.includes('더 보기')) {
      await page.locator('.sc-ct__act', { hasText: '더 보기' }).click()
      const sheet = page.locator('.sc-sheet[aria-label="더 보기"]')
      await sheet.waitFor({ timeout: 5000 })
      const more = await sheet.locator('button').allInnerTexts()
      out.push(...more.map((t) => t.split('\n').pop()?.trim() ?? ''))
      /*
       * **시트를 제대로 닫아야 한다.** Escape 로는 안 닫혔고, 열린
       * 채로 두 번째로 부르니 시트가 「더보기」 단추를 덮어서 클릭이
       * 56번 되튕겼다.
       */
      await sheet.locator('.sc-sheet__back').click()
      await sheet.waitFor({ state: 'detached', timeout: 5000 })
    }
    return out.filter((t) => t !== '' && t !== '더 보기' && t !== '닫기')
  }

  console.log('\n── 자유 시간 ──')
  const free = await labels()
  console.log(`  ${free.join(' · ')}`)
  await page.screenshot({ path: `${OUT}/phase-자유시간.png` })

  console.log('\n── 페이즈 ──')
  await call('openPhase', host, { gameId: game })
  await call('tick', host, { gameId: game })
  await page.waitForTimeout(2000)
  const inPhase = await labels()
  console.log(`  ${inPhase.join(' · ')}`)
  await page.screenshot({ path: `${OUT}/phase-페이즈.png` })

  /*
   * **없앤 둘이 어디에도 없어야 한다.** 행동 칸만이 아니라 화면
   * 전체를 본다 — 시트 안이나 도움말에 남아 있으면 그것도 유령이다.
   */
  for (const gone of ['생산', '공부']) {
    if (inPhase.some((t) => t.startsWith(gone))) missed.push(`페이즈 행동 칸에 「${gone}」가 남아 있다`)
    if (free.some((t) => t.startsWith(gone))) missed.push(`자유 시간 행동 칸에 「${gone}」가 남아 있다`)
  }
  /*
   * **값이 이름 뒤에 붙는다.** 토큰이 드는 단추는 「자리 차지1」로
   * 읽힌다 — 통째로 같은지 보면 있는 것도 없다고 나온다.
   */
  const has = (list: readonly string[], name: string) => list.some((t) => t.startsWith(name))
  for (const stay of ['자리 차지', '가방']) {
    if (!has(inPhase, stay)) missed.push(`페이즈 행동 칸에 「${stay}」가 없다`)
  }

  // **자리 차지 시트에 연구가 있다.** 로봇으로 가는 유일한 길이다
  await page.locator('.sc-ct__act', { hasText: '자리 차지' }).click()
  await page.waitForTimeout(1200)
  const sheet = await page.locator('.sc-sheet, .sc-pl__sheet').first().innerText().catch(() => '')
  await page.screenshot({ path: `${OUT}/phase-자리차지.png` })
  if (!sheet.includes('연구')) missed.push('자리 차지 시트에 「연구」가 없다')
  for (const gone of ['생산', '공부']) {
    if (sheet.includes(gone)) missed.push(`자리 차지 시트에 「${gone}」가 남아 있다`)
  }

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed, null, 0)}`)
  if (missed.length > 0) process.exitCode = 1
  console.log('찍었다')
}

void main()
