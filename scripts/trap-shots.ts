// 덫 — 기술실 제조기에서 만들어 손에 들고, 복도에서 걸리는 것까지.
//
// 판정은 garden-e2e 가 본다. 여기서 보는 것은 **화면**이다. 운영자
// 책상의 화분 여덟, 정원의 빈 화분, 흙, 열매, 그리고 따는 자리.
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
import { tap, walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { MAKERS, LAB_MACHINE, TECH_TILE, LAB_TILE } from '../shared/rules/trap'
import { isHallCell } from '../shared/rules/board'
import { isWalkable, tileAt } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/trapshots'

const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const MEMO = '3층 계단 밑 사물함, 자물쇠 번호는 0412다.'

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
  const email = `tshot-${tag}@x.test`
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

/** 그 조각만 찍는다. 화면 전체는 무엇을 보라는지가 안 보인다 */
async function shot(page: Page, sel: string, file: string): Promise<void> {
  const el = page.locator(sel).first()
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.screenshot({ path: `${OUT}/${file}` })
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



/** 저장소에 없는 코드. 읽기만 하고 어디에도 안 적는다 */
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}

/** 들어와서 화면을 덮는 것들을 사람이 하듯 넘긴다. */
async function enter(page: Page, game: string, id: string): Promise<void> {
  page.on('pageerror', (e) => console.log('  [터짐] ' + String(e).slice(0, 200)))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', QA_PW)
  await page.locator('.sc-gt__submit').click()
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1000)
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

/** 그 방에 세운다. 방 안에 서 있으면 화면이 군말 없이 따라온다 */
async function putIn(game: string, uid: string, tileId: string): Promise<void> {
  const mask = ['tileId', 'arriveAtMs', 'at'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  await fetch(`${FS}/games/${game}/pawns/${uid}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null }, at: { nullValue: null } },
    }),
  })
}

/**
 * 서버가 한 번 일하게 해서 몫을 다시 쓴다.
 *
 * 문서만 손으로 고치면 views 는 옛 값 그대로다 — 화면은 아직
 * 2-3 교실에 서 있다고 믿는다. 여기서 또 속았다.
 */
async function wake(game: string, host: string): Promise<void> {
  await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
}

/**
 * 화분을 그 단계까지 당긴다. **자랄 시간은 문서에만 있다** —
 * 셋으로 나눠 넘어가므로(stageOf) 그만큼씩 심은 시각을 앞당긴다.
 */
async function ageTo(game: string, i: number, stage: 'sprout' | 'leaf' | 'fruit'): Promise<void> {
  const r = await fetch(`${FS}/games/${game}/pots/${i}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const planted = Number((f.plantedMs as { integerValue?: string })?.integerValue ?? 0)
  const growMs = Number((f.growMs as { integerValue?: string })?.integerValue ?? 0)
  const by = stage === 'sprout' ? growMs / 3 : stage === 'leaf' ? (growMs * 2) / 3 : growMs
  await fetch(`${FS}/games/${game}/pots/${i}?updateMask.fieldPaths=plantedMs`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { plantedMs: { integerValue: String(Math.round(planted - by - 60_000)) } } }),
  })
}

/** 그 칸 앞까지 걸어간다. 손은 lib/walk 에 있다 — 셋이 같이 쓴다 */
const walkTo = (page: Page, game: string, uid: string, want: { x: number; y: number }, what = '자리') =>
  walkToCell({ page, fs: FS, admin: ADMIN, game, uid, want, what })


async function pawnField(game: string, uid: string, field: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, { stringValue?: string }> }).fields ?? {}
  return f[field]?.stringValue ?? ''
}
async function fund(game: string, team: string, n: number): Promise<void> {
  await fetch(`${FS}/games/${game}/teams/${team}?updateMask.fieldPaths=phaseTokens`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { phaseTokens: { integerValue: String(n) } } }),
  })
}
/** 남의 팀 덫을 복도 한 칸에 몰래 놓는다 — 밟히는 쪽을 찍는다 */
async function plantTrap(game: string, team: string, c: { x: number; y: number }): Promise<void> {
  await fetch(`${FS}/games/${game}/secret/traps/set?documentId=shot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: {
      x: { integerValue: String(c.x) }, y: { integerValue: String(c.y) },
      team: { stringValue: team }, byPlayerId: { stringValue: 'someone' }, atMs: { integerValue: String(Date.now()) },
    } }),
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `ts${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ts' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  const T0 = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: game, anchorGameMs: T0, speed: 1 })
  await must('tick', host, { gameId: game })

  const meUid = uidOf('qa01')
  const myTeam = await pawnField(game, meUid, 'team')
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')

  // 페이즈를 열고 기술실로 옮겨 세운다. 만드는 것은 페이즈의 일이다
  await must('openPhase', host, { gameId: game })
  await fund(game, myTeam, 5)
  await page.waitForTimeout(1500)
  await putIn(game, meUid, TECH_TILE)
  await wake(game, host)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/1-기술실.png` })
  console.log('  찍었다 1-기술실.png')

  // 1번 제조기 옆으로
  await walkTo(page, game, meUid, MAKERS[0].cell, '제조기')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/2-제조기-옆.png` })
  console.log('  찍었다 2-제조기-옆.png')
  await tap(page, '.sc-ct__act', '제조기')
  await page.waitForSelector('.sc-mk', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/3-제조기-시트.png` })
  console.log('  찍었다 3-제조기-시트.png')
  await tap(page, '.sc-mk__list button', '맡기기')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/4-맡겼다.png` })
  console.log('  찍었다 4-맡겼다.png')
  await tap(page, '.sc-sheet__panel button', '닫기')

  // 20분 뒤. 찾는다
  await must('setDevClock', host, { gameId: game, anchorGameMs: T0 + 22 * 60_000, speed: 1 })
  await wake(game, host)
  await page.waitForTimeout(2500)
  await tap(page, '.sc-ct__act', '제조기')
  await page.waitForSelector('.sc-mk', { timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/5-다-됐다.png` })
  console.log('  찍었다 5-다-됐다.png')
  await tap(page, '.sc-mk__list button', '찾기')
  await page.waitForTimeout(2000)
  await tap(page, '.sc-sheet__panel button', '닫기')
  await page.waitForTimeout(400)
  // 손에 든 것은 「나」 탭 가진 것 안에 있다. 펼쳐야 목록이 나온다
  await page.evaluate(() => (document.querySelectorAll('.sc-ct__tab')[1] as HTMLElement | undefined)?.click())
  await page.waitForTimeout(1200)
  await page.locator('.sc-mi__have').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  await page.locator('.sc-mi__bag').first().scrollIntoViewIfNeeded().catch(() => undefined)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/6-가진-것-덫.png` })
  console.log('  찍었다 6-가진-것-덫.png')
  await page.evaluate(() => (document.querySelectorAll('.sc-ct__tab')[0] as HTMLElement | undefined)?.click())
  await page.waitForTimeout(800)

  // 남의 덫을 문 앞 복도에 놓아 두고, 걸어 나가서 밟는다
  const door = { x: 30, y: 122 }
  let hall: { x: number; y: number } | null = null
  for (let dy = 1; dy <= 4 && !hall; dy++) if (isHallCell(door.x, door.y + dy)) hall = { x: door.x, y: door.y + dy }
  if (!hall) throw new Error('기술실 문 앞에 복도가 없다')
  const enemy = myTeam === 'A' ? 'B' : 'A'
  await plantTrap(game, enemy, hall)
  // 덫 칸 바로 앞(문 쪽)까지 간다. 옆에 서면 멈춘다
  await walkTo(page, game, meUid, hall, '덫 앞')
  await page.waitForTimeout(1000)
  const at = await (await import('./lib/walk')).cellNow(FS, ADMIN, game, meUid)
  if (at) {
    const dir = hall.y > at.y ? 'is-down' : hall.y < at.y ? 'is-up' : hall.x > at.x ? 'is-right' : 'is-left'
    if (at.x !== hall.x && at.y !== hall.y) {
      await page.locator(`.sc-ct__key.${hall.x > at.x ? 'is-right' : 'is-left'}`).click().catch(() => undefined)
      await page.waitForTimeout(700)
    }
    await page.locator(`.sc-ct__key.${dir}`).click().catch(() => undefined)
    await page.waitForTimeout(700)
    // 한 칸 더 — 덫을 지나쳐 간 걸음도 덫 칸으로 되돌아온다
    await page.locator(`.sc-ct__key.${dir}`).click().catch(() => undefined)
  }
  await page.waitForSelector('.sc-pl__busy', { timeout: 10_000 }).catch(() => console.log('  ✗ 걸린 표시가 안 떴다'))
  await page.waitForTimeout(1500)
  const where = await (await import('./lib/walk')).cellNow(FS, ADMIN, game, meUid)
  console.log(`  걸린 자리 ${where?.x},${where?.y} — 덫은 ${hall.x},${hall.y}`)
  await page.screenshot({ path: `${OUT}/7-덫에-걸렸다.png` })
  console.log('  찍었다 7-덫에-걸렸다.png')

  // 풀린 뒤 연구실. 연구 기계 옆에서만 연구가 된다
  await must('setDevClock', host, { gameId: game, anchorGameMs: T0 + 40 * 60_000, speed: 1 })
  await wake(game, host)
  await page.waitForTimeout(2500)
  // 복도에 선 사람은 서버가 방을 바꿔도 화면이 안 옮긴다(Walk — 어느 방에도
  // 없으면 안 건드린다). 기술실 안으로 한 번 들어갔다가 옮겨 세운다
  await walkTo(page, game, meUid, { x: 30, y: 119 }, '기술실 안')
  await page.waitForTimeout(800)
  await putIn(game, meUid, LAB_TILE)
  await wake(game, host)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/8-연구실.png` })
  console.log('  찍었다 8-연구실.png')
  await walkTo(page, game, meUid, LAB_MACHINE, '연구 기계')
  await page.waitForTimeout(1200)
  await tap(page, '.sc-ct__act', '이 방')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/9-연구.png` })
  console.log('  찍었다 9-연구.png')
  // 시트 아래쪽 — 내 지식 · 가진 물건 일곱 · 로봇. 값은 전부 그림이다
  await page.locator('.sc-sheet__body').evaluate((el) => el.scrollBy(0, 1400)).catch(() => undefined)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/10-값-그림.png` })
  console.log('  찍었다 10-값-그림.png')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
