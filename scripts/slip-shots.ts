// 쪽지 56장 — 운영자 배포 탭과, 주워서 읽는 화면.
//
//   1 목록 닫힘   역할 열넷이 한 줄씩 — 「01 반장   뿌림 n / 4」
//   2 펼침        넉 장 표 — 짝 · 종류 · 문안 · 상태 · 위치 · 단추
//   3 위치 고름   방을 고르면 「뿌리기」가 켜진다. 문안을 탭하면 전문
//   4 2짝 확인    DAY 3 전 2짝은 한 번 더 누른다
//   5 무작위      n장을 빈 방에 흩는다
//   6 경고        완성 가능(노란 점) · 몰림
//   7 읽음        주운 사람 손패 — {이름}이 실제 이름으로
//   8 이력 목록   「이력」 탭 — 한 장에 한 줄(종류 · 이름 · 발견 · 지금 · 상태)
//   9 이력 팝업   줄을 누르면 아래에서 올라온다 — 누가 언제 무엇을 했나
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve --emptyOutDir
//   3. python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp/claude-0/serve
//   4. npx vite-node scripts/slip-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { roomOfCell } from '../shared/rules/board'
import { pickOnMap, walkTo } from './lib/walk'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = 'http://127.0.0.1:8899'
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

  // 판 차리기 — 경고가 보이게. 모범생 2짝 두 장(완성 가능 + 같은 날 몰림), 반장 1짝 한 장
  await must('hostScatterSlip', host, { gameId: game, noteId: 'r02-p2-role', tileId: 'library', confirmEarly: true })
  await must('hostScatterSlip', host, { gameId: game, noteId: 'r02-p2-name', tileId: 'gym', confirmEarly: true })
  await must('hostScatterSlip', host, { gameId: game, noteId: 'r01-p1-name', tileId: 'cafeteria' })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
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
  await desk.locator('.sc-ad__tabs button', { hasText: '쪽지' }).click()
  await desk.waitForSelector('.sc-sd__roles', { timeout: 10_000 })
  await desk.waitForTimeout(500)
  const heads = await desk.locator('.sc-sd__head').allInnerTexts()
  console.log(`  닫힌 줄 ${heads.length}개 — ${heads[0]?.replace(/\s+/g, ' ')}`)
  if (heads.length !== 14) missed.push(`역할 줄이 ${heads.length}개다`)
  if (!/01\s*반장[\s\S]*뿌림 1 \/ 4/.test(heads[0] ?? '')) missed.push(`첫 줄 모양이 다르다: ${heads[0]}`)
  await desk.screenshot({ path: `${OUT}/notes-${W}-1-목록-닫힘.png`, fullPage: true })

  // 2 펼침
  await desk.locator('.sc-sd__head').first().click()
  await desk.waitForTimeout(300)
  const role1 = desk.locator('.sc-sd__role').first()
  const rows = await role1.locator('tbody tr').count()
  if (rows !== 4) missed.push(`펼친 표가 ${rows}줄이다`)
  await role1.screenshot({ path: `${OUT}/notes-${W}-2-펼침.png` })
  console.log(`  찍었다 2-펼침 — ${rows}줄`)

  // 3 위치 고름 + 전문
  const waitingRow = role1.locator('tbody tr.is-waiting').first()
  const go = waitingRow.locator('button', { hasText: '뿌리기' })
  if (!(await go.isDisabled())) missed.push('방을 안 골랐는데 뿌리기가 켜져 있다')
  await waitingRow.locator('select').selectOption('musicRoom')
  if (await go.isDisabled()) missed.push('방을 골랐는데 뿌리기가 꺼져 있다')
  await waitingRow.locator('.sc-sd__text').click()
  await desk.waitForTimeout(200)
  const full = await waitingRow.locator('.sc-sd__text').innerText()
  if (full.includes('{이름}')) missed.push('전문에 {이름}이 그대로 있다')
  await role1.screenshot({ path: `${OUT}/notes-${W}-3-위치-전문.png` })
  console.log(`  찍었다 3-위치-전문 — ${full.slice(0, 30)}`)
  await go.click()
  await desk.waitForTimeout(1500)

  // 4 2짝 확인 — 반장 2짝 역할형
  const p2 = role1.locator('tbody tr.is-waiting').filter({ has: desk.locator('td:first-child', { hasText: '2' }) }).first()
  await p2.locator('select').selectOption('artRoom')
  await p2.locator('button', { hasText: '뿌리기' }).click()
  await desk.waitForTimeout(150)
  await role1.screenshot({ path: `${OUT}/notes-${W}-4-2짝-확인.png` })
  const armed = await p2.locator('.sc-sure.is-armed').count()
  console.log(`  찍었다 4-2짝-확인 — 한 번 더 누르라는 표시 ${armed ? '있음' : '없음'}`)
  if (!armed) missed.push('2짝을 DAY 3 전에 누르면 한 번 더 묻지 않는다')

  // 5 무작위
  await desk.locator('.sc-sd__head').first().click()
  await desk.fill('#sd-n', '5')
  await desk.locator('.sc-sd__rand button').click()
  await desk.waitForTimeout(2500)
  const said = (await desk.locator('.sc-ad__said').innerText().catch(() => '')).trim()
  console.log(`  무작위: ${said}`)
  if (!said.includes('5장을 뿌렸다')) missed.push(`무작위 5장이 아니다: ${said}`)
  await desk.locator('.sc-ad__said').click().catch(() => undefined)
  await desk.screenshot({ path: `${OUT}/notes-${W}-5-무작위.png` })

  // 6 경고 — 모범생 줄
  const model = desk.locator('.sc-sd__role').nth(1)
  const warnDot = await model.locator('.sc-sd__dot').count()
  const warnCrowd = await model.locator('.sc-sd__crowd').count()
  if (!warnDot) missed.push('모범생 2짝 두 장이 나갔는데 완성 가능 점이 없다')
  if (!warnCrowd) missed.push('같은 날 두 장인데 몰림 표시가 없다')
  await desk.locator('.sc-sd__roles').screenshot({ path: `${OUT}/notes-${W}-6-경고.png` })
  console.log(`  찍었다 6-경고 — 완성 가능 ${warnDot} · 몰림 ${warnCrowd}`)

  // 7 사람 — 반장 1짝 이름형(급식실)을 주워 읽는다
  const slips = (await fetch(`${FS}/games/${game}/secret/slips/items?pageSize=300`, { headers: ADMIN }).then((r) => r.json())) as {
    documents: { name: string; fields: Record<string, { stringValue?: string; integerValue?: string }> }[]
  }
  const doc = slips.documents.find((d) => d.fields.noteId?.stringValue === 'r01-p1-name')
  if (!doc) throw new Error('반장 쪽지가 없다')
  const sx = Number(doc.fields.x.integerValue)
  const sy = Number(doc.fields.y.integerValue)
  const room = roomOfCell(sx, sy) as string
  const reader = 'qa07'
  await fetch(`${FS}/games/${game}/pawns/${uidOf(reader)}?updateMask.fieldPaths=tileId&updateMask.fieldPaths=postTile`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { tileId: { stringValue: room }, postTile: { stringValue: room } } }),
  })
  const meCtx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const me = await meCtx.newPage()
  me.on('pageerror', (e) => missed.push(`화면 터짐: ${e.message}`))
  await me.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await me.fill('#gt-id', reader)
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
  // 화면이 아바타를 쥐고 있다 — 십자키로 걸어가서 옆에 선다
  await walkTo({ page: me, fs: FS, admin: ADMIN, game, uid: uidOf(reader), want: { x: sx, y: sy }, what: '쪽지' })
  await me.waitForTimeout(800)
  if (!(await pickOnMap(me, { x: sx, y: sy }, '줍는다'))) missed.push('쪽지 옆에서 짚었는데 「줍는다」가 없다')
  await me.waitForTimeout(1200)
  await me.evaluate(() => {
    const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === '나')
    ;(t as HTMLElement | undefined)?.click()
  })
  await me.locator('.sc-mi__have').click({ timeout: 5000 }).catch(() => undefined)
  await me.waitForSelector('.sc-sl', { timeout: 15_000 })
  const before = (await me.locator('.sc-sl').innerText()).trim()
  if (before.includes('빠뜨린 적이')) missed.push('읽기 전에 문장이 보인다')
  await me.locator('.sc-sl__list button', { hasText: '읽기' }).first().click()
  await me.waitForSelector('.sc-sl__line', { timeout: 10_000 })
  await me.locator('.sc-sl').scrollIntoViewIfNeeded()
  await me.waitForTimeout(400)
  await me.locator('.sc-sl').screenshot({ path: `${OUT}/notes-${W}-7-읽음.png` })
  const line = (await me.locator('.sc-sl__line').first().innerText()).trim()
  console.log(`  찍었다 7-읽음 — ${line}`)
  if (line.includes('{이름}') || !line.includes('빠뜨린 적이')) missed.push(`읽은 문장이 이상하다: ${line}`)

  // 8·9 이력 — 메모 한 장 · 문제 한 장을 더 놓고, 운영자 「이력」 탭을 연다
  await must('hostDrop', host, { gameId: game, kind: 'memo', tileId: 'library', text: '도서관 창가 셋째 칸을 봐라.' })
  await must('hostDrop', host, {
    gameId: game,
    kind: 'quiz',
    x: sx + 1,
    y: sy + 1,
    quiz: { kind: 'short', prompt: '학교 종이 몇 번 울리면 점심인가', answers: ['네 번'], explain: '' },
  }).catch((e) => missed.push(`문제 놓기 실패: ${(e as Error).message}`))
  await desk.locator('.sc-ad__tabs button', { hasText: '이력' }).click()
  await desk.waitForSelector('.sc-pt__list', { timeout: 10_000 })
  await desk.waitForTimeout(400)
  const lines = await desk.locator('.sc-pt__row').allInnerTexts()
  console.log(`  이력 ${lines.length}줄 — ${lines[0]?.replace(/\s+/g, ' ')}`)
  if (lines.length < 5) missed.push(`이력 줄이 ${lines.length}개다`)
  if (!/발견 \S+/.test(lines[0] ?? '') || !/손에/.test(lines[0] ?? '')) missed.push(`첫 줄이 든 쪽지가 아니다: ${lines[0]}`)
  await desk.screenshot({ path: `${OUT}/notes-${W}-8-이력-목록.png`, fullPage: true })
  await desk.locator('.sc-pt__row').first().click()
  await desk.waitForSelector('.sc-pt__sheet', { timeout: 5000 })
  await desk.waitForTimeout(300)
  const sheet = await desk.locator('.sc-pt__sheet').innerText()
  if (!sheet.includes('주웠다') || !sheet.includes('읽었다')) missed.push(`팝업에 줍기·읽기가 없다: ${sheet}`)
  await desk.screenshot({ path: `${OUT}/notes-${W}-9-이력-팝업.png` })
  await desk.locator('.sc-pt__veil').click({ position: { x: 10, y: 10 } })
  if (await desk.locator('.sc-pt__sheet').count()) missed.push('바깥을 눌러도 팝업이 안 닫힌다')

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
