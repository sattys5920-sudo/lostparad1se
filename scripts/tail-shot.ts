// 꼬리 하나를 크게 들여다본다 — 끝이 한 화소로 모이는가, 머리에
// 닿는가.
//
//   npx vite-node scripts/tail-shot.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'tail-shot-pass1'
const QA_PW = 'seed-password-1'
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

const tokenFor = (host: string, pwd: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: pwd })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

async function main() {
  const game = `tl${Date.now()}`
  const me = `tl${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'tl' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  // **네 배로 찍는다.** 꼬리는 3화소짜리라 두 배로는 계단이 안 보인다
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 4,
    isMobile: true,
    hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1600)

  // 내가 한마디 한다. 내 자리는 늘 화면 가운데라 찾기 쉽다
  await must('say', meTok, { gameId: game, text: '여기다' })
  await page.locator('.sc-wk__say').first().waitFor({ timeout: 9000 })
  await page.waitForTimeout(250)

  const box = await page.locator('.sc-wk__say').first().boundingBox()
  if (!box) throw new Error('풍선을 못 찾았다. 이 시험은 아무것도 재지 못한다')
  // 풍선 아래쪽과 머리만 크게. 위아래로 넉넉히 두고 자른다
  await page.screenshot({
    path: `${OUT}/tail-크게.png`,
    clip: { x: box.x - 16, y: box.y - 4, width: box.width + 32, height: box.height + 34 },
  })
  await page.screenshot({ path: `${OUT}/tail-전체.png` })

  const seen = (await page.evaluate(`(() => {
    const el = document.querySelector('.sc-wk__say')
    const r = el.getBoundingClientRect()
    const b = getComputedStyle(el, '::before')
    const a = getComputedStyle(el, '::after')
    return {
      풍선아래: Math.round(r.bottom),
      어두운꼬리: { w: b.width, h: b.height, bottom: b.bottom, 자름: b.clipPath.slice(0, 24) },
      흰꼬리: { w: a.width, h: a.height, bottom: a.bottom, 자름: a.clipPath.slice(0, 24) },
      모서리: getComputedStyle(el).borderTopLeftRadius,
    }
  })()`))
  console.log(JSON.stringify({ ...(seen as object), 터짐: boom }, null, 1))
  await browser.close()
  console.log('찍었다')
}

void main()
