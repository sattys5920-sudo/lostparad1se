// 스크린샷 그대로 다시 세워 본다 — 혼자, 무용실로 걸어 들어가서,
// 실제 시계(배속 1)로 한마디. 로그가 쌓이나, 풍선이 뜨나.
//
//   npx vite-node scripts/alone-say.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
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
  const game = `al${Date.now()}`
  const me = `al${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'al' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '이름없음', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '이름없음' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  // **배속 1.** 스크린샷의 판이 어떤지 모르니 실제 시계부터 본다
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))
  // **서버가 뭐라고 대답하는지 그대로 본다.** 화면만 보면 「안 뜬다」에서 멈춘다
  const replies: { 무엇: string; 줄수: number; 방: unknown }[] = []
  page.on('response', async (r) => {
    if (!r.url().includes('/chatLines')) return
    try {
      const j = (await r.json()) as { result?: { lines?: unknown[]; here?: unknown } }
      replies.push({ 무엇: 'chatLines', 줄수: (j.result?.lines ?? []).length, 방: j.result?.here ?? null })
    } catch { /* 본문이 없을 수도 */ }
  })

  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1600)

  // 스크린샷처럼 혼자인 방으로 걸어 들어간다
  const moved = await call('roamTo', meTok, { gameId: game, tileId: ROOM })
  await page.waitForTimeout(2600)

  // 서버가 직접 보면 뭐라고 하나 (화면과 따로)
  const before = (await must('chatLines', meTok, { gameId: game, sinceMs: 0 })) as { lines?: unknown[]; here?: string }

  // 손가락으로 친다
  await page.locator('.sc-sy__box').click()
  await page.locator('.sc-sy__box').type('여기 아무도 없네', { delay: 20 })
  await page.locator('.sc-sy__send').click()
  await page.waitForTimeout(3000)

  const after = (await must('chatLines', meTok, { gameId: game, sinceMs: 0 })) as { lines?: unknown[]; here?: string }
  const 친직후 = await page.evaluate(`[...document.querySelectorAll('.sc-sy__line')].map((e) => e.textContent.trim())`)

  /*
   * **연결이 끊겼다 돌아온다.** 폰을 잠그거나 앱을 내렸다 올리면
   * 늘 일어나는 일이다. 그때 view 가 잠깐 비고, 선 방이 null 이 된다 —
   * 로그를 그때마다 버리면 쌓이질 않는다. 실제로 폰에서 그랬다.
   */
  await page.context().setOffline(true)
  await page.waitForTimeout(2600)
  await page.context().setOffline(false)
  await page.waitForTimeout(4000)
  const 돌아온뒤 = await page.evaluate(`[...document.querySelectorAll('.sc-sy__line')].map((e) => e.textContent.trim())`)
  const seen = await page.evaluate(`(() => ({
    로그줄: [...document.querySelectorAll('.sc-sy__line')].map((e) => e.textContent.trim()),
    풍선: [...document.querySelectorAll('.sc-wk__say')].map((e) => ({
      글: e.textContent.trim(), 보이나: getComputedStyle(e).display !== 'none',
    })),
    토스트: (() => { const t = document.querySelector('.sc-ct__toast, .sc-toast'); return t ? t.textContent.trim() : null })(),
    선방: (() => { const h = document.querySelector('.sc-wk__here'); return h ? h.textContent.trim() : null })(),
  }))()`)
  await page.screenshot({ path: `${OUT}/alone-말했다.png` })

  console.log(JSON.stringify({
    걸어갔나: moved.ok ? 'ok' : moded(moved.err),
    '서버 · 치기 전': { 줄수: (before.lines ?? []).length, 방: before.here },
    '서버 · 치고 나서': { 줄수: (after.lines ?? []).length, 방: after.here, 줄: after.lines },
    화면: seen,
    '친 직후 로그': 친직후,
    '끊겼다 돌아온 뒤 로그': 돌아온뒤,
    '화면이 받은 대답': replies.slice(-6),
    터짐: boom,
  }, null, 1))
  await browser.close()
  console.log('찍었다')
}

const moded = (s: string | undefined) => s ?? '?'

void main()
