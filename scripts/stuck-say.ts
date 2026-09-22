// 서버가 chatLines 를 계속 거절하면 화면이 **말해 주는가.**
//
// 실제 Firestore 에 색인이 없어서 이 호출이 매번 거절됐을 때, 화면은
// 그 오류를 삼켜서 로그도 풍선도 그냥 비어 있었다 — 며칠을 잃었다.
// 이제는 세 번 연달아 실패하면 말줄 밑에 이유가 떠야 한다.
//
//   npx vite-node scripts/stuck-say.ts
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
  const game = `st${Date.now()}`
  const me = `st${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'st' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  // **서버가 거절한다.** 실제 Firestore 가 색인 없는 복합 쿼리에 하는 일이다
  let refused = 0
  await page.route('**/chatLines', (route) => {
    refused += 1
    void route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'The query requires an index.', status: 'INTERNAL' } }),
    })
  })

  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)

  // 보내기는 된다(say 는 막지 않았다) — 옛날엔 여기서 끝이었다
  await page.locator('.sc-sy__box').click()
  await page.locator('.sc-sy__box').type('들리나', { delay: 20 })
  await page.locator('.sc-sy__send').click()

  // 세 번 연달아 실패해야 뜬다. 2.5초 간격이니 넉넉히 기다린다
  const stuck = page.locator('.sc-sy__stuck')
  await stuck.waitFor({ timeout: 15000 }).catch(() => undefined)
  const seen = await page.evaluate(`(() => ({
    막힘글: (() => { const e = document.querySelector('.sc-sy__stuck'); return e ? e.textContent.trim() : null })(),
    입력칸: document.querySelector('.sc-sy__box').value,
    로그줄수: document.querySelectorAll('.sc-sy__line').length,
    풍선수: document.querySelectorAll('.sc-wk__say').length,
  }))()`) as { 막힘글: string | null; 입력칸: string; 로그줄수: number; 풍선수: number }
  await page.screenshot({ path: `${OUT}/stuck-막혔다.png` })

  const ok = seen.막힘글 !== null && seen.막힘글.includes('index') && seen.입력칸 === '' && refused >= 3
  console.log(JSON.stringify({ 거절횟수: refused, ...seen, 통과: ok, 터짐: boom }, null, 1))
  await browser.close()
  console.log(ok ? '찍었다' : '틀렸다')
  process.exit(ok ? 0 : 1)
}

void main()
