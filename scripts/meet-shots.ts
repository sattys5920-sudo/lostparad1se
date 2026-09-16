// 만나서 거래하기까지 — 375×667 열 장.
//
// 거래창 낱장은 deal-shots.ts 가 찍는다. 여기서 찍는 것은 **이야기**다.
// 자유 시간에 혼자 있던 방에 누가 들어오고, 그 사람을 짚고, 탁자에
// 마주 앉고, 값을 올리고, 성립하기까지가 한 줄기로 이어진다.
//
// 가짜 화면을 찍지 않는다. 에뮬레이터에 판을 세우고 두 계정으로 각각
// 들어가서, 진짜 서버가 오가게 한 것을 본다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir <어딘가>/lostparad1se
//      해서 그 위 디렉터리를 8899 로 서빙한다
//   4. npx vite-node scripts/meet-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { ADJACENCY, TILE_IDS } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/meetshots'

const QA_PW = 'shots-password'
const GAME = `meet${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
}
async function auth(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}
function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plain)
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) {
    return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  }
  return o
}
async function pawns(): Promise<Record<string, Record<string, unknown>>> {
  const r = await fetch(`${FS}/games/${GAME}/pawns?pageSize=50`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: { name: string }[] }
  return Object.fromEntries(
    (j.documents ?? []).map((d) => [d.name.split('/').pop() as string, plain(d) as Record<string, unknown>]),
  )
}
/** 말 하나를 원하는 자리에 놓는다. **판을 차리는 것**이지 화면을 고치는 것이 아니다. */
async function put(uid: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/games/${GAME}/pawns/${uid}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) },
        ]),
      ),
    }),
  })
}

type Page = import('playwright').Page

async function enter(page: Page, id: string): Promise<void> {
  await page.goto(`${SITE}/play.html?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-pl__gate', { timeout: 20_000 })
  await page.fill('input[placeholder="아이디"]', id)
  await page.fill('input[placeholder="비밀번호"]', QA_PW)
  await page.locator('.sc-pl__gate button.sc-pl__go').click()
  // 아침 시퀀스를 지난다. **누르기마다 기다리는 시간을 짧게 둔다** —
  // 기본 30초로 두면 사라진 장을 누르려다 몇 분씩 멈춰 선다
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    const skip = page.locator('.sc-rv__skip')
    if (await skip.count()) await skip.first().click({ timeout: 1500 }).catch(() => undefined)
    else await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  if ((await page.locator('.sc-pl__today').count()) === 0) {
    await page.screenshot({ path: `${OUT}/x-${id}-막힌자리.png` })
    console.log(`  ${id} 막힌 자리: ` + (await page.locator('body').innerText()).slice(0, 200))
    throw new Error(`${id}: 오늘 하루까지 못 갔다`)
  }
  console.log(`  ${id} 들어왔다`)
  await page.waitForTimeout(800)
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(400)
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const shot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: `${OUT}/${name}.png` })
    console.log(`  ${name}.png`)
  }

  console.log(`판 ${GAME} 을 세운다`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'meet' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  const tick = async (ms = 0): Promise<void> => {
    clock += ms
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
    await must('tick', host, { gameId: GAME })
  }
  await tick()

  const mine = uidOf('qa01')
  const first = await pawns()
  const myTeam = String(first[mine].team)
  const room = String(first[mine].tileId)
  const otherId = ['qa02', 'qa03', 'qa04', 'qa05', 'qa06', 'qa07', 'qa08'].find(
    (id) => String(first[uidOf(id)]?.team ?? myTeam) !== myTeam,
  )
  if (!otherId) throw new Error('다른 팀 사람을 못 찾았다')
  const yours = uidOf(otherId)

  /**
   * 나머지 열둘을 다른 방으로 흩는다.
   *
   * 열넷이 한 교실에 서 있으면 「누가 들어왔다」가 안 보인다. 판을
   * 차리는 것이지 화면을 고치는 것이 아니다 — 서버 문서를 옮긴다.
   */
  const away = TILE_IDS.filter((t) => t !== room && (ADJACENCY[t] ?? []).length > 0)
  let n = 0
  for (const uid of Object.keys(first)) {
    if (uid === mine || uid === yours) continue
    await put(uid, { tileId: away[n % away.length] })
    n += 1
  }
  // 그 사람은 **옆방**에 둔다. 거기서 걸어 들어오는 것을 찍는다
  const next = (ADJACENCY[room] ?? [])[0] ?? away[0]
  await put(yours, { tileId: next })
  // 값을 올릴 것이 보이게 개인 토큰을 넉넉히
  await put(mine, { dealTokens: 8 })
  await put(yours, { dealTokens: 8 })
  await tick(60_000)

  const seats = ((plain(await (await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })).json()) as {
    seats: { playerId: string; name: string }[]
  }).seats ?? []) as { playerId: string; name: string }[]
  const myName = seats.find((x) => x.playerId === mine)?.name ?? '나'
  const yourName = seats.find((x) => x.playerId === yours)?.name ?? '상대'
  console.log(`  ${myName}(${myTeam}팀)은 ${room}, ${yourName}는 옆방 ${next}`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const view = {
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
  }
  const p1 = await (await browser.newContext(view)).newPage()
  const p2 = await (await browser.newContext(view)).newPage()
  const boom: string[] = []
  p1.on('pageerror', (e) => boom.push(`${myName}: ${e.message}`))
  p2.on('pageerror', (e) => boom.push(`${yourName}: ${e.message}`))

  await enter(p1, 'qa01')
  await enter(p2, otherId)
  console.log('둘 다 들어왔다')

  // ── 1. 자유 시간, 혼자 있는 방 ───────────────────────────
  await p1.waitForTimeout(1200)
  await shot(p1, '1-혼자-자유시간')

  // ── 2. 옆방에서 누가 들어온다 ────────────────────────────
  // 자유 시간의 방 이동에는 시간이 들지 않는다. 문을 지나면 옆방이다
  const yourToken = await (async () => {
    const custom = String((await must('logInAccount', host, { id: otherId, password: QA_PW })).token ?? '')
    const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    })
    return ((await swap.json()) as { idToken: string }).idToken
  })()
  await must('roamTo', yourToken, { gameId: GAME, tileId: room })
  await p1.waitForTimeout(2500)
  await shot(p1, '2-누가-들어왔다')

  // ── 3. 그 사람을 짚는다 ──────────────────────────────────
  //
  // 화면 한가운데부터 더듬어 찾으면 안 된다. **누를 때마다 내가 그쪽으로
  // 걸어가고** 카메라가 나를 따라오므로, 상대가 있는 자리가 누를 때마다
  // 달라진다 — 쫓아다니다 끝난다.
  //
  // 그려진 것을 그대로 읽는다. 상대 팀 색 점을 캔버스에서 찾아 그 자리를
  // 짚는다. 사람이 눈으로 하는 것과 같은 일이다.
  const canvas = p1.locator('canvas').first()
  const theirTeam = String((await pawns())[yours].team)
  const TEAM_RGB: Record<string, [number, number, number]> = {
    A: [224, 69, 63],
    B: [63, 122, 224],
    C: [47, 168, 102],
    D: [224, 160, 42],
  }
  const findDot = async (): Promise<{ x: number; y: number } | null> =>
    await canvas.evaluate((el, rgb) => {
      const c = el as HTMLCanvasElement
      const ctx = c.getContext('2d')
      if (!ctx) return null
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sx = 0
      let sy = 0
      let n = 0
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const o = (y * c.width + x) * 4
          if (
            Math.abs(d[o] - rgb[0]) < 12 &&
            Math.abs(d[o + 1] - rgb[1]) < 12 &&
            Math.abs(d[o + 2] - rgb[2]) < 12
          ) {
            sx += x
            sy += y
            n += 1
          }
        }
      }
      if (n === 0) return null
      // 캔버스 화소를 CSS 자리로. 배율은 정수라 나누기만 하면 된다
      const k = c.clientWidth / c.width
      return { x: (sx / n) * k, y: (sy / n) * k }
    }, TEAM_RGB[theirTeam] ?? TEAM_RGB.B)

  let tapped = false
  for (let i = 0; i < 6 && !tapped; i++) {
    const at = await findDot()
    if (!at) {
      await p1.waitForTimeout(600)
      continue
    }
    await canvas.click({ position: at }).catch(() => undefined)
    await p1.waitForTimeout(500)
    if (!(await p1.locator('.sc-pr__go').count())) continue
    const who = await p1.locator('.sc-sheet__head h2').innerText().catch(() => '')
    if (who.trim() === yourName) tapped = true
    else {
      await p1.locator('.sc-sheet__head button').click().catch(() => undefined)
      await p1.waitForTimeout(300)
    }
  }
  if (!tapped) {
    await shot(p1, 'x-못-짚었다')
    throw new Error('맵에서 그 사람을 못 짚었다')
  }
  await shot(p1, '3-사람을-짚었다')

  // ── 4~5. 청하고 앉는다 ──────────────────────────────────
  const seat = async (): Promise<boolean> => {
    await p1.locator('.sc-pr__go').click().catch(() => undefined)
    if (!(await p2.waitForSelector('.sc-da', { timeout: 8_000 }).then(() => true).catch(() => false))) return false
    await shot(p2, '4-요청이-왔다')
    await p2.locator('.sc-da__row button.is-on').click()
    return await p1
      .waitForSelector('.sc-dr__bag li', { timeout: 8_000 })
      .then(() => true)
      .catch(() => false)
  }
  let open = await seat()
  for (let i = 0; i < 3 && !open; i++) {
    console.log('  (놓쳤다 — 다시 건다)')
    await p1.locator('.sc-dr__go').click().catch(() => undefined)
    await p1.waitForTimeout(600)
    const again = await findDot()
    if (again) await canvas.click({ position: again }).catch(() => undefined)
    await p1.waitForTimeout(500)
    open = await seat()
  }
  if (!open) throw new Error('거래창이 안 열렸다')
  await p1.waitForTimeout(400)
  await shot(p1, '5-빈-탁자')

  // ── 6. 각자 올린다 ──────────────────────────────────────
  const steps = p1.locator('.sc-dr__bag li .sc-dr__step button:nth-child(3)')
  await steps.nth(0).click()
  await p1.waitForTimeout(150)
  await steps.nth(1).click()
  await p2.locator('.sc-dr__bag li .sc-dr__step button:nth-child(3)').nth(0).click()
  await p1.waitForTimeout(1400)
  await shot(p1, '6-양쪽이-올렸다')

  // ── 7. 한쪽만 준비 ──────────────────────────────────────
  await p2.locator('.sc-dr__go').click()
  await p1.waitForTimeout(2000)
  await shot(p1, '7-상대만-준비')

  // ── 8. 세는 중 ──────────────────────────────────────────
  await p1.locator('.sc-dr__go').click()
  await p1.waitForSelector('.sc-dr__count', { timeout: 5_000 })
  await shot(p1, '8-세는-중')

  // ── 9~10. 성립 ─────────────────────────────────────────
  await p1.waitForSelector('.sc-dr.is-over', { timeout: 20_000 })
  await p1.waitForTimeout(500)
  await shot(p1, '9-성립했다')
  await p2.waitForTimeout(500)
  await shot(p2, '10-상대-쪽')

  await browser.close()
  if (boom.length > 0) {
    console.log('\n화면이 터진 자리')
    for (const b of boom) console.log(`  ✗ ${b}`)
    process.exitCode = 1
  } else {
    console.log('\n열 장. 화면이 터진 곳은 없다')
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
