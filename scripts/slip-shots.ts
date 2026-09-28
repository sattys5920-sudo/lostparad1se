// 비밀 쪽지 — 운영자가 칸을 짚어 놓고, 옆에 선 사람이 줍기까지.
//
// 판정은 slip-e2e 가 본다. 여기서 보는 것은 **사람이 실제로 보는 화면**이다.
//
//   ㆍ 운영자 책상의 「비밀 쪽지」 — 누구 것 · 넉 장 중 몇 장 · 칸 짚기 · 거두기
//   ㆍ 맵 바닥의 쪽지 — 문제 종이와 한눈에 갈리는가
//   ㆍ 쪽지를 짚으면 옆에 「줍는다 · 그냥 둔다」가 뜨고, 주워서 읽으면 이름이 끼워진 문장
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/slip-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { HALLS, TILES, type Floor } from '../shared/rules/board'
import { canDropQuizAt } from '../shared/rules/quiz'
import { standAndSpot } from './lib/spot'
import { tapCell } from './lib/walk'
import { BOARDS } from '../shared/rules/errand'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const W = Number(process.env.W ?? 390)
const H = Number(process.env.H ?? 844)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

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
  const email = `slip-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function playerToken(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })
  return ((await r.json()) as { idToken: string }).idToken
}

/** 운영자 작은 판(Spot.tsx)과 같은 셈으로, 한 칸의 판 위 비율 자리를 낸다 */
function fracOf(floor: Floor, x: number, y: number): { fx: number; fy: number } {
  const rects = [...TILES.filter((t) => t.floor === floor).map((t) => t.plan), ...HALLS.filter((h) => h.floor === floor).map((h) => h.rect)]
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x0
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y0
  return { fx: (x - x0 + 0.5) / w, fy: (y - y0 + 0.5) / h }
}

async function shotCard(page: Page, title: string, file: string): Promise<void> {
  const card = page.locator('.sc-ad__sec').filter({ has: page.locator(`h2:text-is("${title}")`) })
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await card.screenshot({ path: `${OUT}/${file}` })
  console.log(`  찍었다 ${file}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const game = `ss${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ss' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  console.log(`판 ${game}`)

  // 판 차리기 — 누군가(qa05)의 쪽지 석 장을 미리 깔아 둔다. 책상에 「3/4」가 보이게
  const subject = uidOf('qa05')
  for (const t of ['library', 'gym', 'cafeteria'] as const) {
    const { spot } = standAndSpot(t)
    await must('hostDrop', host, { gameId: game, kind: 'slip', x: spot.x, y: spot.y, subjectId: subject, text: `${t} 쪽 {이름}은/는 거기 있었다.` })
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  // ── 운영자 책상 ─────────────────────────────────────────
  const deskCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  const desk = await deskCtx.newPage()
  desk.on('pageerror', (e) => missed.push(`책상 터짐: ${e.message}`))
  await desk.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await desk.waitForSelector('.sc-gt__title')
  for (let i = 0; i < 5; i++) {
    await desk.locator('.sc-gt__title').click()
    await desk.waitForTimeout(80)
  }
  await desk.waitForSelector('#gt-code')
  await desk.fill('#gt-code', hostCode())
  await desk.locator('.sc-gt__submit').click()
  await desk.waitForSelector('.sc-ad__tabs', { timeout: 20_000 })
  await desk.locator('.sc-ad__tabs button', { hasText: '놓기' }).click()
  await desk.waitForTimeout(600)
  const card = desk.locator('.sc-ad__sec').filter({ has: desk.locator('h2:text-is("떨어뜨리기")') })
  await card.locator('.sc-dr__what button', { hasText: '비밀 쪽지' }).click()
  await desk.waitForTimeout(1200)
  await card.locator('#dr-who').selectOption(subject)
  // 1층 급식실의 빈 칸 하나를 판에서 짚는다
  const pick = standAndSpot('cafeteria', [standAndSpot('cafeteria').spot]).spot
  const { fx, fy } = fracOf('f1', pick.x, pick.y)
  const canvas = card.locator('.sc-sp__board canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('판이 없다')
  await canvas.click({ position: { x: fx * box.width, y: fy * box.height } })
  await card.locator('#dr-slip').fill('{이름}은/는 체육관 창고 열쇠를 아직 돌려주지 않았다.')
  await desk.waitForTimeout(300)
  const where = await card.locator('.sc-sp__where').innerText()
  console.log(`  ${where}`)
  if (!where.includes('급식실')) missed.push(`짚은 자리가 급식실이 아니다: ${where}`)
  await shotCard(desk, '떨어뜨리기', `slip-${W}-책상-적음.png`)
  await card.locator('.sc-dr__go').click()
  await desk.waitForTimeout(1600)
  const said = await desk.locator('.sc-ad__said').innerText().catch(() => '')
  console.log(`  놓은 뒤: ${said}`)
  const opt = await card.locator('#dr-who option:checked').innerText()
  console.log(`  고른 사람: ${opt}`)
  if (!opt.includes('4/4')) missed.push(`넉 장을 놓았는데 ${opt}`)
  await shotCard(desk, '떨어뜨리기', `slip-${W}-책상-놓음.png`)

  // ── 주울 사람 ─────────────────────────────────────────
  // 들어와서 선 칸을 본 뒤, 그 옆 칸에 쪽지 · 다른 옆 칸에 문제 종이를 놓는다.
  // 미리 세워 두면 화면이 들어오며 제 자리로 다시 세운다
  const meCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const me = await meCtx.newPage()
  me.on('pageerror', (e) => missed.push(`화면 터짐: ${e.message}`))
  await me.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await me.fill('#gt-id', 'qa01')
  await me.fill('#gt-pw', QA_PW)
  await me.click('.sc-gt__submit')
  for (let i = 0; i < 40; i++) {
    if (await me.locator('.sc-ct__tab').count()) break
    await me.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await me.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await me.waitForTimeout(300)
  }
  await me.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await me.waitForTimeout(2500)
  const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
  const pawn = (await fetch(`${FS}/games/${game}/pawns/${uidOf('qa01')}`, { headers: ADMIN }).then((r) => r.json())) as {
    fields: { at: { mapValue: { fields: { x: { integerValue: string }; y: { integerValue: string } } } } }
  }
  const at = { x: Number(pawn.fields.at.mapValue.fields.x.integerValue), y: Number(pawn.fields.at.mapValue.fields.y.integerValue) }
  const side = [{ x: at.x + 1, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x, y: at.y + 1 }, { x: at.x, y: at.y - 1 }].filter((c) => canDropQuizAt(c.x, c.y))
  console.log(`  qa01 은 (${at.x}, ${at.y}) — 옆 빈 칸 ${side.length}`)
  if (side.length < 2) throw new Error('옆에 빈 칸이 둘 없다')
  await must('hostDrop', host, { gameId: game, kind: 'slip', x: side[0].x, y: side[0].y, subjectId: uidOf('qa03'), text: '{이름}이/가 방송실 열쇠를 가지고 있다.' })
  await must('hostDrop', host, { gameId: game, kind: 'quiz', x: side[1].x, y: side[1].y, quiz: { kind: 'short', prompt: '교실 뒤 시간표의 금요일 6교시는?', choices: [], answers: ['자습'], explain: '' } })
  await me.waitForTimeout(2000)
  await me.screenshot({ path: `${OUT}/slip-${W}-맵.png` })
  console.log(`  찍었다 slip-${W}-맵.png`)
  // 발밑만 크게 — 쪽지(봉인)와 문제 종이가 갈리는지
  const cv = await me.locator('canvas').first().boundingBox()
  if (cv) {
    await me.screenshot({ path: `${OUT}/slip-${W}-발밑.png`, clip: { x: cv.x + cv.width / 2 - 90, y: cv.y + cv.height / 2 - 70, width: 180, height: 140 } })
  }
  /*
   * **쪽지를 짚는다.** 아래 칸은 늘 같고, 쪽지 옆에 작은 차림표가 뜬다 —
   * 「줍는다」와 「그냥 둔다」. 문제 종이도 짚어서 차림표만 본다
   */
  await tapCell(me, side[1])
  await me.waitForTimeout(500)
  const quizRows = await me.locator('.sc-mt__row').allInnerTexts()
  console.log(`  문제 종이 차림표: ${quizRows.join(' / ')}`)
  if (!quizRows.some((r) => r.includes('그냥 둔다'))) missed.push('문제 종이 차림표에 「그냥 둔다」가 없다')
  await me.locator('.sc-mt__row', { hasText: '그냥 둔다' }).click().catch(() => undefined)
  await me.waitForTimeout(300)
  if ((await me.locator('.sc-mt').count()) > 0) missed.push('「그냥 둔다」를 눌렀는데 차림표가 남았다')
  await tapCell(me, side[0])
  await me.waitForTimeout(500)
  await me.screenshot({ path: `${OUT}/slip-${W}-차림표.png` })
  console.log(`  찍었다 slip-${W}-차림표.png — ${(await me.locator('.sc-mt__row').allInnerTexts()).join(' / ')}`)
  const takeBtn = me.locator('.sc-mt__row', { hasText: '줍는다' })
  if ((await takeBtn.count()) === 0) missed.push('쪽지를 짚었는데 「줍는다」가 없다')
  else {
    await takeBtn.first().click()
    await me.waitForTimeout(1200)
    await me.screenshot({ path: `${OUT}/slip-${W}-주움.png` })
    console.log(`  찍었다 slip-${W}-주움.png`)
  }
  const bottom = await me.locator('.sc-ct__act').allInnerTexts()
  console.log(`  아래 칸: ${bottom.map((b) => b.trim()).join(' / ')}`)
  if (bottom.some((b) => b.includes('줍는다'))) missed.push('아래 칸에 줍기가 아직 있다')

  // 「나」 → 가진 것 → 쪽지에서 읽는다
  await me.evaluate(() => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '나')
    ;(t as HTMLElement | undefined)?.click()
  })
  await me.locator('.sc-mi__have').click({ timeout: 5000 }).catch(() => undefined)
  await me.waitForSelector('.sc-sl', { timeout: 15_000 })
  await me.locator('.sc-sl__list button', { hasText: '읽기' }).first().click()
  await me.waitForSelector('.sc-sl__line', { timeout: 10_000 })
  await me.locator('.sc-sl').scrollIntoViewIfNeeded()
  await me.waitForTimeout(400)
  await me.locator('.sc-sl').screenshot({ path: `${OUT}/slip-${W}-읽음.png` })
  const line = (await me.locator('.sc-sl__line').first().innerText()).trim()
  console.log(`  찍었다 slip-${W}-읽음.png — ${line}`)
  if (line.includes('{이름}')) missed.push(`이름이 안 끼워졌다: ${line}`)

  /*
   * **먼 물건을 짚는다.** 걸어가 주지 않는다 — 차림표는 뜨되 줄이 흐리고
   * 몇 칸 더 가야 하는지가 적힌다. 교실에서 보이는 복도 게시판을 짚는다
   */
  await me.evaluate(() => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '맵')
    ;(t as HTMLElement | undefined)?.click()
  })
  await me.waitForTimeout(800)
  let farSeen = false
  for (const b of BOARDS) {
    if (!(await tapCell(me, b.cell))) continue
    await me.waitForTimeout(500)
    if ((await me.locator('.sc-mt').count()) === 0) continue
    const rows = await me.locator('.sc-mt__row').allInnerTexts()
    console.log(`  먼 게시판(${b.name}) 차림표: ${rows.map((r) => r.replace(/\s+/g, ' ')).join(' / ')}`)
    await me.screenshot({ path: `${OUT}/slip-${W}-먼물건.png` })
    farSeen = rows.some((r) => r.includes('가까이 가야 한다'))
    const off = await me.locator('.sc-mt__row').first().isDisabled()
    if (!off) missed.push('먼 게시판인데 줄이 눌린다')
    break
  }
  if (!farSeen) missed.push('먼 물건을 짚었는데 「가까이 가야 한다」가 안 떴다')

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
