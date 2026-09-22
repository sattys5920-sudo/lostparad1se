// 겉모습 — 바꾸기 전과 후를 나란히 찍는다.
//
// 같은 판, 같은 자리, 같은 크기로 두 번 찍어야 무엇이 달라졌는지
// 보인다. 앞것은 8898, 뒷것은 8899 에서 뜬다.
//
//   npx vite-node scripts/skin-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const AFTER = 'http://127.0.0.1:8899/lostparad1se'
const BEFORE = 'http://127.0.0.1:8898/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'alone-say-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }
/** 스크린샷의 그 방 */
const ROOM = 'newBuilding'

async function call(name: string, tk: string | null, data: unknown): Promise<{ ok: boolean; result?: Record<string, unknown>; err?: string }> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false, err: j.error.message } : { ok: true, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result ?? {}
}

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

async function main() {
  const game = `sk${Date.now()}`
  const me = `sk${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'sk' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const boom: string[] = []

  for (const [tag, site] of [['전', BEFORE], ['후', AFTER]] as const) {
    for (const size of [{ w: 375, h: 667 }, { w: 390, h: 844 }]) {
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
      })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => boom.push(`${tag}${size.w}: ${e.message}`))
      await page.goto(`${site}/?game=${game}`, { waitUntil: 'networkidle' })
      await page.fill('#gt-id', me)
      await page.fill('#gt-pw', MY_PW)
      await page.click('.sc-gt__submit')
      await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(2000)

      // 실내
      await page.screenshot({ path: `${OUT}/skin-${size.w}-실내-${tag}.png` })

      // 실외로 걸어 나간다. 눈 덮인 바닥이 실내와 갈리는지 본다
      const gone = await call('roamTo', meTok, { gameId: game, tileId: 'garden' })
      if (gone.ok) {
        await page.waitForTimeout(2400)
        await page.screenshot({ path: `${OUT}/skin-${size.w}-실외-${tag}.png` })
        await call('roamTo', meTok, { gameId: game, tileId: 'centralPlaza' })
        await page.waitForTimeout(2000)
      } else {
        console.log(`  실외로 못 갔다(${tag}${size.w}): ${gone.err ?? ''}`)
      }
      await ctx.close()
    }
  }
  console.log('터짐', JSON.stringify(boom))
  await browser.close()
  console.log('찍었다')
}

void main()
