// 심부름 — 운영자가 붙이는 자리와, 사람이 받는 자리.
//
// 판정은 errand-e2e 가 본다. 여기서 보는 것은 **사람이 실제로 보는
// 화면**이다. 운영자 책상의 심부름 칸, 복도 게시판, 받아 둔 한 줄.
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
import { BOARDS } from '../shared/rules/errand'
import { isWalkable } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/errandshots'

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

/**
 * 서버가 한 번 일하게 해서 몫을 다시 만든다.
 *
 * 문서만 손으로 고치면 views 는 그대로다 — 화면은 옛 몫을 보고 있고,
 * 단추가 안 뜬다. 여기서 두 번 속았다.
 */
async function wake(game: string, host: string): Promise<void> {
  await must('hostDrop', host, { gameId: game, tileId: 'artRoom', kind: 'memo', text: '지나가는 종이' })
}

/** 방에 세운다. 칸도 같이 비운다 — 서버가 방을 옮길 때 하는 것과 같다 */
async function putIn(game: string, uid: string, tileId: string): Promise<void> {
  const mask = ['tileId', 'arriveAtMs', 'at'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  await fetch(`${FS}/games/${game}/pawns/${uid}?${mask}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: { tileId: { stringValue: tileId }, arriveAtMs: { nullValue: null }, at: { nullValue: null } },
    }),
  })
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

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `es${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'es' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  /*
   * **2층 서쪽 복도.** 사람이 2-3 교실에서 시작하는데 거기가 2층이라,
   * 1층 게시판을 고르면 계단을 찾아 내려가는 길찾기가 먼저다 — 이
   * 캡처가 볼 것은 그게 아니다.
   */
  const board = BOARDS.find((b) => b.id === 'f2w')!
  const meUid = uidOf('qa01')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  // ── 운영자 책상 ───────────────────────────────────────────
  const deskCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const desk = await deskCtx.newPage()
  await desk.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await desk.waitForSelector('.sc-gt__title')
  for (let i = 0; i < 5; i++) {
    await desk.locator('.sc-gt__title').click()
    await desk.waitForTimeout(80)
  }
  await desk.fill('#gt-code', hostCode())
  await desk.locator('.sc-gt__submit').click()
  await desk.waitForSelector('.sc-ed', { timeout: 20_000 })
  await desk.waitForTimeout(1200)
  const card = desk.locator('.sc-ad__card').filter({ has: desk.locator('h2:text-is("심부름")') })
  await card.scrollIntoViewIfNeeded()
  await desk.waitForTimeout(300)
  await card.screenshot({ path: `${OUT}/1-운영자-풀.png` })
  console.log('  찍었다 1-운영자-풀.png')

  // ── 사람 ─────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')

  /*
   * **게시판까지 걸어간다.**
   *
   * 서버에 자리를 적어 넣는 것으로는 안 된다 — 아바타는 화면이 쥐고
   * 있어서, 멈출 때마다 제 자리를 도로 적어 보낸다. 손으로 옮겨 놓은
   * 값은 다음 걸음에 덮인다. 그래서 십자키를 누른다.
   */
  await walkTo(page, game, meUid, board.cell)
  await page.waitForTimeout(1500)

  /*
   * **붙기 전과 붙은 뒤를 같은 자리에서 찍는다.** 판 그림이 바뀌는
   * 것이 이 기능의 절반이라, 두 장을 나란히 놓아야 보인다. 가까이
   * 잘라 찍는다 — 화면 전체에서는 판이 손톱만 하다.
   */
  const NEAR = { x: 100, y: 180, width: 180, height: 130 }
  await page.screenshot({ path: `${OUT}/3a-빈-게시판.png`, clip: NEAR })
  console.log('  찍었다 3a-빈-게시판.png')

  // 이제 운영자가 붙인다
  await desk.locator('.sc-ed .sc-dr__row select').nth(1).selectOption(board.id)
  await desk.locator('.sc-dr__go', { hasText: '붙이기' }).click()
  await desk.waitForTimeout(1500)
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: `${OUT}/2-운영자-붙인뒤.png` })
  console.log('  찍었다 2-운영자-붙인뒤.png')

  // 사람 쪽 몫이 새로 내려올 때까지 기다린다
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/3b-붙은-게시판.png`, clip: NEAR })
  console.log('  찍었다 3b-붙은-게시판.png')
  await page.screenshot({ path: `${OUT}/3-복도-게시판.png` })
  console.log('  찍었다 3-복도-게시판.png')

  await page.locator('.sc-ct__act', { hasText: '게시판' }).first().click()
  await page.waitForSelector('.sc-er__list', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/4a-게시판-열었을때.png` })
  console.log('  찍었다 4a-게시판-열었을때.png')
  await shot(page, '.sc-er__list', '4-붙은목록.png')

  await page.locator('.sc-er__list button', { hasText: '받기' }).first().click()
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/5-받은뒤.png` })
  console.log('  찍었다 5-받은뒤.png')

  // 출발 방으로 간다. 걸어가는 것은 이 캡처의 관심이 아니라 손으로 옮긴다
  await putIn(game, meUid, 'labRoom')
  await wake(game, host)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/6-집기.png` })
  console.log('  찍었다 6-집기.png')
  // 말줄이 그 위를 덮고 있다. 좌표로 누르지 말고 단추를 바로 누른다
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sc-er__strip button')].find((x) => x.textContent?.includes('집기'))
    ;(b as HTMLElement | undefined)?.click()
  })
  await page.waitForTimeout(1500)
  await putIn(game, meUid, 'annex')
  await wake(game, host)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/7-놓기.png` })
  console.log('  찍었다 7-놓기.png')

  await browser.close()
  console.log(`\n${OUT} 에 담았다.`)
}

/** 지금 선 칸. 서버가 아는 값이다 — 화면이 멈출 때마다 적어 보낸다 */
async function cellNow(game: string, uid: string): Promise<{ x: number; y: number } | null> {
  const r = await fetch(`${FS}/games/${game}/pawns/${uid}`, { headers: ADMIN })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const m = (f.at as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields
  if (!m) return null
  const n = (v: unknown) => Number((v as { integerValue?: string })?.integerValue ?? 0)
  return { x: n(m.x), y: n(m.y) }
}

/**
 * 십자키로 거기까지 간다. **가까워지는 쪽을 누른다.**
 *
 * 길찾기가 아니다 — 복도는 곧게 뻗어 있어서 세로를 먼저 맞추고
 * 가로로 가면 닿는다. 서른 걸음 안에 못 닿으면 포기하고 말한다.
 */
/**
 * 한 칸씩 짚어 가는 길. **BFS 로 먼저 길을 낸다.**
 *
 * 전에는 「목표 쪽으로 누른다」였다. 2층 서쪽 복도는 y29 가 통째로
 * 벽이고 x8~9 만 뚫려 있어서, 위에서 내려오던 봇이 벽에 대고 아래만
 * 계속 눌렀다. 막히면 가로로 트는 임시 처방으로는 못 돌아 나온다 —
 * 지도를 보고 가야 한다.
 */
function pathTo(from: { x: number; y: number }, want: { x: number; y: number }): { x: number; y: number }[] {
  const key = (x: number, y: number) => `${x},${y}`
  const near = (c: { x: number; y: number }) => Math.abs(c.x - want.x) <= 1 && Math.abs(c.y - want.y) <= 1
  const back = new Map<string, string | null>([[key(from.x, from.y), null]])
  let edge = [from]
  for (let step = 0; step < 400 && edge.length > 0; step++) {
    const next: { x: number; y: number }[] = []
    for (const c of edge) {
      if (near(c)) {
        // 거꾸로 따라 올라가 순서를 세운다
        const out: { x: number; y: number }[] = []
        let at: string | null = key(c.x, c.y)
        while (at !== null) {
          const [x, y] = at.split(',').map(Number)
          out.unshift({ x, y })
          at = back.get(at) ?? null
        }
        return out.slice(1)
      }
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = c.x + dx
        const ny = c.y + dy
        if (back.has(key(nx, ny)) || !isWalkable(nx, ny)) continue
        back.set(key(nx, ny), key(c.x, c.y))
        next.push({ x: nx, y: ny })
      }
    }
    edge = next
  }
  return []
}

async function walkTo(
  page: Page,
  game: string,
  uid: string,
  want: { x: number; y: number },
): Promise<void> {
  for (let leg = 0; leg < 8; leg++) {
    const at = await cellNow(game, uid)
    if (!at) {
      await page.locator('.sc-ct__key.is-down').click({ timeout: 2000 }).catch(() => undefined)
      await page.waitForTimeout(240)
      continue
    }
    if (Math.abs(at.x - want.x) <= 1 && Math.abs(at.y - want.y) <= 1) {
      console.log(`  게시판 앞에 섰다 — ${at.x},${at.y}`)
      return
    }
    const path = pathTo(at, want)
    if (path.length === 0) {
      console.log(`  ✗ ${want.x},${want.y} 로 가는 길이 없다 — 지금 ${at.x},${at.y}`)
      return
    }
    /*
     * **한 번에 다 누른다.** 걸음마다 서버를 다시 읽으려 했더니 매번
     * 제자리로 보였다 — 아바타는 화면이 쥐고 있고, 서버에는 **멈출 때**
     * 한 번 적힌다. 그래서 읽은 값은 늘 한 박자 늦다. 길은 이미
     * 지도에서 냈으니 끝까지 누르고, 도착해서 한 번 맞춰 본다.
     */
    let now = at
    for (const step of path) {
      const dir =
        step.y > now.y ? 'is-down'
        : step.y < now.y ? 'is-up'
        : step.x > now.x ? 'is-right'
        : 'is-left'
      await page.locator(`.sc-ct__key.${dir}`).click({ timeout: 2000 }).catch(() => undefined)
      await page.waitForTimeout(200)
      now = step
    }
    await page.waitForTimeout(900)
    const end = await cellNow(game, uid)
    if (end && Math.abs(end.x - want.x) <= 1 && Math.abs(end.y - want.y) <= 1) {
      console.log(`  게시판 앞에 섰다 — ${end.x},${end.y}`)
      return
    }
    console.log(`  ${leg + 1}번째 — ${end ? `${end.x},${end.y}` : '어딘지 모름'}`)
  }
  console.log(`  ✗ ${want.x},${want.y} 까지 못 갔다`)
}

/** 그 사람으로 서버를 부른다. 화면이 하는 것과 같은 길이다 */
async function playerToken(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
