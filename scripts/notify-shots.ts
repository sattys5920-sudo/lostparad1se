import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8902'
/** 파일 이름 앞머리. 고치기 전 것을 따로 찍을 때 바꾼다 */
const TAG = process.env.TAG ?? 'me'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

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
  const email = `metab-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

/** 명단 한 줄의 역할을 바꾼다. 옛 판을 흉내 낸다 */
async function setRole(game: string, id: string, roleId: string) {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(id)}?updateMask.fieldPaths=roleId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { roleId: { stringValue: roleId } } }),
  })
  if (!r.ok) throw new Error(`명단 고치기 실패 ${r.status}`)
}

async function roleOf(game: string, id: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(id)}`, { headers: ADMIN })
  const j = (await r.json()) as { fields?: { roleId?: { stringValue?: string } } }
  return j.fields?.roleId?.stringValue ?? ''
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bad: string[] = []
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const size of SIZES) {
    const game = `nt${Date.now()}${size.w}`
    const host = await hostToken(game)
    await must('createGame', host, { gameId: game, seed: 'nt' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    await must('assignAll', host, { gameId: game })
    await must('startGame', host, { gameId: game, startAtMs: START })
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
    await must('tick', host, { gameId: game })
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => bad.push(`${size.w} 터짐: ${e.message}`))
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', 'qa01')
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.sc-ct__tab').count()) break
      await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
      await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
      await page.waitForTimeout(300)
    }
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
    // 배너 — 공지 하나, 페이즈 하나
    await must('hostNotice', host, { gameId: game, text: '모두 복도로' })
    await page.waitForSelector('.sc-ntb__one', { timeout: 8000 }).catch(() => bad.push(`${size.w}: 공지 배너가 안 떴다`))
    await page.screenshot({ path: `${OUT}/nt-${size.w}-1-배너.png` })
    await must('openPhase', host, { gameId: game })
    await page.waitForSelector('.sc-ntb__one.is-big', { timeout: 8000 }).catch(() => bad.push(`${size.w}: 페이즈 배너가 안 떴다`))
    await page.screenshot({ path: `${OUT}/nt-${size.w}-2-페이즈.png` })
    await page.waitForTimeout(3500)
    if (await page.locator('.sc-ntb__one').count()) bad.push(`${size.w}: 3초 뒤에도 배너가 남았다`)
    // 나 탭 — 설정과 보관함
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '나')
      ;(t as HTMLElement | undefined)?.click()
    })
    await page.waitForSelector('.sc-np', { timeout: 10000 })
    await page.locator('.sc-np__archive').click()
    await page.waitForTimeout(500)
    await page.locator('.sc-np').scrollIntoViewIfNeeded()
    await page.locator('.sc-np').screenshot({ path: `${OUT}/nt-${size.w}-3-설정.png` })
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    if (wide) bad.push(`${size.w}: 가로로 넘친다`)
    await ctx.close()
  }
  await browser.close()
  console.log('놓침', bad)
  process.exit(bad.length ? 1 : 0)
}
void main()
