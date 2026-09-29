// 무전 탭과 키보드 — **입력줄이 키보드에 가려지지 않는가.**
//
// 아이폰 사파리는 판마다 키보드를 다르게 알린다. 세 가지를 다 흉내 낸다:
//   A) 보이는 창(visualViewport)만 준다 — innerHeight 는 그대로
//   B) innerHeight 까지 같이 준다 — 옛 셈(--kb)으로는 키보드가 0 이 된다
//   C) 보이는 창이 아래로 밀린다(offsetTop > 0)
// 어느 쪽이든 입력칸의 아래 끝이 보이는 창의 아래 끝에 붙어야 하고,
// 마지막 무전 줄이 입력줄 바로 위에 보여야 한다.
//
//   npx vite-node scripts/kb-radio.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = process.env.SITE ?? 'http://127.0.0.1:8907'
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

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 아이폰이 하는 일을 흉내 낸다. mode 에 따라 innerHeight · offsetTop 도 속인다 */
const FAKE = (px: number, mode: 'A' | 'B' | 'C') => `(() => {
  const vv = window.visualViewport
  const full = window.__fullH ?? (window.__fullH = window.innerHeight)
  Object.defineProperty(vv, 'height', { configurable: true, get: () => full - ${px} })
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => ${mode === 'C' ? 120 : 0} })
  ${mode === 'B' ? `Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => full - ${px} })` : ''}
  vv.dispatchEvent(new Event('resize'))
})()`

const LOOK_RD = `(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) } }
  const vv = window.visualViewport
  const lines = [...document.querySelectorAll('.sc-rd__log li')]
  const last = lines.length ? lines[lines.length - 1].getBoundingClientRect() : null
  return {
    field: r('.sc-rd__field'), bar: r('.sc-rd__bar'), log: r('.sc-rd__log'), top: r('.sc-rd__top'),
    vvTop: Math.round(vv.offsetTop), vvBottom: Math.round(vv.offsetTop + vv.height),
    lastBottom: last ? Math.round(last.bottom) : null,
    typing: document.documentElement.getAttribute('data-typing'),
    focus: document.activeElement && document.activeElement.id,
  }
})()`

async function main() {
  const game = `kr${Date.now()}`
  const me = `kr${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'kr' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('markPrologueSeen', meTok, {})
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })
  // 무전 몇 줄
  for (let i = 0; i < 12; i++) await must('radio', meTok, { gameId: game, channel: 'team', text: `무전 ${i + 1}` }).catch(() => undefined)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const size of [{ w: 375, h: 667 }, { w: 390, h: 844 }]) {
    for (const mode of ['A', 'B', 'C'] as const) {
      console.log(`\n── ${size.w}×${size.h} · ${mode} ──`)
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
      const page = await ctx.newPage()
      await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
      await page.fill('#gt-id', me)
      await page.fill('#gt-pw', MY_PW)
      await page.click('.sc-gt__submit')
      await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(1200)
      // 무전 탭
      await page.locator('.sc-ct__tab', { hasText: '무전' }).first().click()
      await page.waitForSelector('#rd-say', { timeout: 8000 })
      await page.waitForTimeout(400)
      const before = (await page.evaluate(LOOK_RD)) as Record<string, any>
      await page.locator('#rd-say').click()
      await page.evaluate(FAKE(300, mode))
      await page.waitForTimeout(600)
      const on = (await page.evaluate(LOOK_RD)) as Record<string, any>
      await page.screenshot({ path: `${OUT}/kr-${size.w}-${mode}.png` })
      check(on.typing === 'rd', '적는 중 표시가 붙었다', String(on.typing))
      check(on.bar && Math.abs(on.bar.bottom - on.vvBottom) <= 1, '입력줄 아래 끝 = 보이는 창 아래 끝', `${on.bar?.bottom} / ${on.vvBottom}`)
      check(on.field && on.field.top >= on.vvTop && on.field.bottom <= on.vvBottom, '입력칸이 보이는 창 안에 있다', JSON.stringify(on.field))
      check(on.top && on.top.top >= on.vvTop, '무전 머리(주파수 줄)도 보인다', JSON.stringify(on.top))
      check(on.lastBottom === null || (on.lastBottom <= on.bar.top && on.lastBottom > on.vvTop), '마지막 무전 줄이 입력줄 위에 보인다', `${on.lastBottom} / 줄 ${on.bar?.top}`)
      // 키보드를 내린다
      await page.evaluate(`(() => { const vv = window.visualViewport; Object.defineProperty(vv, 'height', { configurable: true, get: () => window.__fullH }); Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 }); Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => window.__fullH }); document.activeElement.blur(); vv.dispatchEvent(new Event('resize')) })()`)
      await page.waitForTimeout(600)
      const off = (await page.evaluate(LOOK_RD)) as Record<string, any>
      check(off.typing === null, '다 적으면 표시가 떨어진다')
      check(JSON.stringify(off.bar) === JSON.stringify(before.bar), '키보드가 내려가면 입력줄이 제자리로', `${JSON.stringify(before.bar)} → ${JSON.stringify(off.bar)}`)
      await ctx.close()
    }
  }
  await browser.close()
  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
