// 운영자가 바닥에 한 장 놓는 자리 — 책상과, 그것을 줍는 사람.
//
// 판정은 drop-e2e 가 본다. 여기서 보는 것은 **사람이 실제로 보는
// 화면**이다. 운영자 책상의 「떨어뜨리기」 칸과, 그 방에 서 있던
// 사람이 줍고 읽기까지.
//
//   1. cd functions && npm run build  (에뮬레이터 다시 띄우기)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/drop-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/dropshots'

const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
/** 아침에는 열넷이 여기 서 있다. 주울 사람이 있는 방이라야 흐름이 보인다 */
const HERE = 'centralPlaza'
const MEMO = '3층 계단 밑 사물함, 자물쇠 번호는 0412다.'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

/** 저장소에 없는 코드. 읽기만 하고 어디에도 안 적는다 */
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}

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
  const email = `shot-${tag}@x.test`
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

/** 그 칸 하나만 찍는다. 책상 전체는 길어서 무엇을 보라는지가 안 보인다 */
async function shotCard(page: Page, title: string, file: string): Promise<void> {
  const card = page.locator('.sc-ad__card').filter({ has: page.locator(`h2:text-is("${title}")`) })
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await card.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

/** 내 몫. 운영자 열쇠로 읽는다 — 규칙은 본인에게만 열어 준다 */
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/games/${game}/views/${uid}`,
    { headers: ADMIN },
  )
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? {}
}
const arrLen = (f: unknown): number =>
  (f as { arrayValue?: { values?: unknown[] } })?.arrayValue?.values?.length ?? 0

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `ds${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ds' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  console.log(`판 ${game} — DAY 1 10시, 자유 시간`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  // ── 운영자 책상 ───────────────────────────────────────────
  const deskCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const desk = await deskCtx.newPage()
  await desk.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await desk.waitForSelector('.sc-gt__title')
  // 제목을 다섯 번 두드려야 운영자 자리가 나온다
  for (let i = 0; i < 5; i++) {
    await desk.locator('.sc-gt__title').click()
    await desk.waitForTimeout(80)
  }
  await desk.waitForSelector('#gt-code')
  await desk.fill('#gt-code', hostCode())
  await desk.locator('.sc-gt__submit').click()
  await desk.waitForSelector('.sc-ad__card', { timeout: 20_000 })
  await desk.waitForTimeout(1200)

  await shotCard(desk, '떨어뜨리기', '1-빈칸.png')

  // 메모를 적는다
  const card = desk.locator('.sc-ad__card').filter({ has: desk.locator('h2:text-is("떨어뜨리기")') })
  await card.locator('select').selectOption(HERE)
  await card.locator('textarea').fill(MEMO)
  await desk.waitForTimeout(200)
  await shotCard(desk, '떨어뜨리기', '2-메모적음.png')

  await card.locator('.sc-dr__go').click()
  await desk.waitForTimeout(1500)
  await shotCard(desk, '떨어뜨리기', '3-놓았다.png')

  // 문제 쪽도 한 장
  await card.locator('.sc-dr__what button', { hasText: '문제' }).first().click()
  await desk.waitForTimeout(200)
  const boxes = card.locator('textarea')
  await boxes.nth(0).fill('2-3 교실 뒤 게시판에 붙은 시간표에서, 금요일 6교시는?')
  await card.locator('.sc-dr__row input').nth(0).fill('체육')
  await card.locator('.sc-dr__row input').nth(1).fill('미술')
  await card.locator('.sc-dr__row input').nth(2).fill('자습')
  await card.locator('.sc-dr__row input').nth(3).fill('음악')
  await boxes.nth(1).fill('자습\n자율학습')
  await card.locator('.sc-dr__row input').last().fill('금요일 6교시 칸만 손글씨로 덧칠돼 있다.')
  await desk.waitForTimeout(200)
  await shotCard(desk, '떨어뜨리기', '4-문제적음.png')

  // ── 주운 사람 ────────────────────────────────────────────
  const meCtx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 })
  const me = await meCtx.newPage()
  await me.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await me.waitForSelector('#gt-id')
  await me.fill('#gt-id', 'qa01')
  await me.fill('#gt-pw', QA_PW)
  await me.locator('.sc-gt__submit').click()
  // 들어오면 덮이는 것들 — 배정된 학생증, 아침 알림. 사람이 하듯 넘긴다
  for (let i = 0; i < 40; i++) {
    if (await me.locator('.sc-pl__today').count()) break
    await me.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await me.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await me.waitForTimeout(300)
  }
  if ((await me.locator('.sc-pl__today').count()) === 0) {
    await me.screenshot({ path: `${OUT}/x-막힌자리.png` })
    throw new Error('오늘 하루까지 못 갔다: ' + (await me.locator('body').innerText()).slice(0, 300))
  }
  await me.waitForTimeout(1200)
  // 「홈 화면에 추가」 판이 덮고 있다. 사람도 이걸 먼저 닫는다
  await me.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await me.waitForTimeout(600)
  // 서버에 정말 한 장 놓였는지 먼저 본다. 화면부터 의심하지 않는다
  const v = await viewOf(game, uidOf('qa01'))
  console.log(`  서버가 본 qa01 의 발밑: ${arrLen(v.slipsHere)}장`)
  // 「나」 탭. 쪽지는 거기 있다
  await me.evaluate(() => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '나')
    ;(t as HTMLElement | undefined)?.click()
  })
  // 쪽지는 「가진 것」 안에 접혀 있다. 열어야 보인다
  await me.locator('.sc-mi__have').click()
  await me.waitForSelector('.sc-sl', { timeout: 15_000 })
  await me.locator('.sc-sl').scrollIntoViewIfNeeded()
  await me.waitForTimeout(400)
  await me.locator('.sc-sl').screenshot({ path: `${OUT}/5-바닥에한장.png` })
  console.log('  찍었다 5-바닥에한장.png')

  await me.locator('.sc-sl__row button', { hasText: '줍기' }).first().click()
  await me.waitForSelector('.sc-sl__folded', { timeout: 10_000 })
  await me.waitForTimeout(400)
  await me.locator('.sc-sl').screenshot({ path: `${OUT}/6-주웠다.png` })
  console.log('  찍었다 6-주웠다.png')

  await me.locator('.sc-sl__list button', { hasText: '읽기' }).first().click()
  await me.waitForSelector('.sc-sl__line', { timeout: 10_000 })
  await me.waitForTimeout(400)
  await me.locator('.sc-sl').screenshot({ path: `${OUT}/7-읽었다.png` })
  const line = (await me.locator('.sc-sl__line').first().innerText()).trim()
  console.log(`  찍었다 7-읽었다.png — ${line}`)
  if (line !== MEMO) throw new Error(`화면에 다른 말이 떴다: ${line}`)
  // 누구의 일이다가 안 붙어야 한다 — 주인 없는 종이다
  const whose = await me.locator('.sc-sl__whose').count()
  console.log(`  「누구의 일이다」 ${whose === 0 ? '없다 — 맞다' : '붙었다 — 틀렸다'}`)

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
