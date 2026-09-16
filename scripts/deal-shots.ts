// 거래창 캡처 — 375×667 여섯 장.
//
// 가짜 화면을 찍지 않는다. 에뮬레이터에 판을 세우고, 두 계정으로
// 각각 들어가서, 진짜 서버가 오가게 한 것을 본다. 창이 열리는지,
// 상대가 올린 것이 그 자리에 보이는지, 세는 수가 도는지는 그렇게만
// 알 수 있다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir <어딘가>/lostparad1se
//      해서 그 위 디렉터리를 8899 로 서빙한다
//   4. npx vite-node scripts/deal-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { TILE_IDS } from '../shared/rules/board'
import { dayHourMs } from '../shared/rules/clock'
import { DEAL_COUNTDOWN_MS } from '../shared/rules/deal'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/dealshots'

const QA_PW = 'shots-password'
const GAME = `deal${Date.now()}`
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

/** 그 계정으로 들어가 오늘 하루까지 간다. */
async function enter(page: Page, id: string): Promise<void> {
  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.sc-pl__gate', { timeout: 20_000 })
  await page.fill('input[placeholder="아이디"]', id)
  await page.fill('input[placeholder="비밀번호"]', QA_PW)
  await page.locator('.sc-pl__gate button.sc-pl__go').click()
  // 아침 시퀀스를 지나야 오늘 하루가 나온다. 「이 날 건너뛰기」가
  // 있으면 그것부터 누른다 — 가운데를 탭해 넘기는 것은 장수만큼 걸린다
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    const skip = page.locator('.sc-rv__skip')
    if (await skip.count()) await skip.first().click().catch(() => undefined)
    else await page.locator('.sc-rv__sheet').first().click().catch(() => undefined)
    await page.waitForTimeout(350)
  }
  if ((await page.locator('.sc-pl__today').count()) === 0) throw new Error(`${id}: 오늘 하루까지 못 갔다`)
  await page.waitForTimeout(700)
  // 첫 접속 안내를 한 번 치운다
  await page.locator('.sc-home__panel button').click().catch(() => undefined)
  await page.waitForTimeout(300)
}

const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  ${name}.png`)
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  console.log(`판 ${GAME} 을 세운다`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'dealshots' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })

  // 둘을 마주 세운다. 누가 어느 팀인지는 판이 정하므로, 다른 팀 첫
  // 사람을 골라 내가 선 방으로 옮긴다
  const mine = uidOf('qa01')
  const now = await pawns()
  const myTeam = String(now[mine].team)
  const room = String(now[mine].tileId)
  const otherId = ['qa02', 'qa03', 'qa04', 'qa05', 'qa06', 'qa07', 'qa08'].find(
    (id) => String(now[uidOf(id)]?.team ?? myTeam) !== myTeam,
  )
  if (!otherId) throw new Error('다른 팀 사람을 못 찾았다')
  const yours = uidOf(otherId)
  await put(yours, { tileId: room })
  // 나머지 열둘은 다른 방으로 흩는다. **한 방에 그 팀이 하나라야**
  // 화면에서 색으로 그 사람을 찾을 수 있다
  const away = TILE_IDS.filter((t) => t !== room)
  let n = 0
  for (const uid of Object.keys(now)) {
    if (uid === mine || uid === yours) continue
    await put(uid, { tileId: away[n % away.length] })
    n += 1
  }
  // 올릴 것이 보이게 개인 토큰을 넉넉히 둔다
  await put(mine, { dealTokens: 8 })
  await put(yours, { dealTokens: 8 })
  clock += 60_000
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
  await must('tick', host, { gameId: GAME })
  // 그 사람의 이름. 손끝이 **그 사람을** 짚었는지 이것으로 가린다 —
  // 넓은 방에는 다른 팀 사람이 여럿 서 있다
  const seats = ((plain(await (await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })).json()) as {
    seats: { playerId: string; name: string }[]
  }).seats ?? []) as { playerId: string; name: string }[]
  const yourName = seats.find((x) => x.playerId === yours)?.name ?? ''
  console.log(`  qa01(${myTeam}팀)과 ${otherId}·${yourName}(${String(now[yours].team)}팀)이 ${room} 에 마주 섰다`)

  // 계정 증표는 한 번 더 바꿔야 서버가 받는다
  const tokenOf = async (id: string): Promise<string> => {
    const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
    const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    })
    return ((await swap.json()) as { idToken: string }).idToken
  }
  const myToken = await tokenOf('qa01')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const view = {
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
  }
  const c1 = await browser.newContext(view)
  const c2 = await browser.newContext(view)
  const p1 = await c1.newPage()
  const p2 = await c2.newPage()
  const boom: string[] = []
  p1.on('pageerror', (e) => boom.push(`qa01: ${e.message}`))
  p2.on('pageerror', (e) => boom.push(`${otherId}: ${e.message}`))
  p1.on('console', (m) => { if (m.type() === 'error') console.log(`  qa01 콘솔: ${m.text()}`) })
  p2.on('console', (m) => { if (m.type() === 'error') console.log(`  ${otherId} 콘솔: ${m.text()}`) })

  await enter(p1, 'qa01')
  await enter(p2, otherId)
  console.log('둘 다 들어왔다')

  // 들어오는 동안 한쪽이 움직였을 수 있다. 다시 마주 세우고 화면이
  // 따라오기를 기다린다 — 안 그러면 손끝이 빈 바닥을 짚는다
  const standing = String((await pawns())[mine].tileId ?? room)
  await put(yours, { tileId: standing })
  clock += 30_000
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
  await must('tick', host, { gameId: GAME })
  await p1.waitForTimeout(1500)

  // ── 1. 거래 요청 ─────────────────────────────────────────
  //
  // 그려진 것을 그대로 읽는다. 상대 팀 색 점을 캔버스에서 찾아, **한 칸
   // 옆으로 걸어간 뒤** 짚는다 — 같은 방으로는 못 걸고 바로 옆 칸이라야
  // 한다. 서버에 좌표를 적어 봐야 소용없다: 화면이 제 자리를 다시 적는다
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
      const k = c.clientWidth / c.width
      return { x: (sx / n) * k, y: (sy / n) * k }
    }, TEAM_RGB[theirTeam] ?? TEAM_RGB.B)

  const tilePx = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    return (c.clientWidth / c.width) * 16
  })
  const near = await findDot()
  if (near) {
    await canvas.click({ position: { x: Math.max(4, near.x - tilePx), y: near.y } }).catch(() => undefined)
    await p1.waitForTimeout(2500)
  }
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
  if (tapped) await shot(p1, '0-사람을짚었다')
  else console.log('  (맵 탭이 빗나갔다 — 서버로 건다)')

  /**
   * 청하고, 받고, 탁자가 열릴 때까지.
   *
   * 청은 열다섯 초짜리다. 그 사이에 브라우저 둘이 주고받아야 하는데
   * 한 번씩 놓친다 — 놓치면 처음부터 다시 건다. **여기서 재는 것은
   * 화면이지 운이 아니다.**
   */
  const seat = async (): Promise<boolean> => {
    if (tapped && (await p1.locator('.sc-pr__go').count())) await p1.locator('.sc-pr__go').click()
    else await must('askDeal', myToken, { gameId: GAME, toPlayerId: yours }).catch(() => ({}))
    if (!(await p2.waitForSelector('.sc-da', { timeout: 8_000 }).then(() => true).catch(() => false))) return false
    await shot(p2, '1-거래요청')
    await p2.locator('.sc-da__row button.is-on').click()
    return await p1
      .waitForSelector('.sc-dr__bag li', { timeout: 8_000 })
      .then(() => true)
      .catch(() => false)
  }
  let open = false
  for (let i = 0; i < 4 && !open; i++) {
    if (i > 0) {
      console.log('  (놓쳤다 — 다시 건다)')
      await p1.locator('.sc-dr__go').click().catch(() => undefined)
      await p1.waitForTimeout(600)
    }
    open = await seat()
  }
  if (!open) {
    await shot(p1, 'x-창이안열렸다')
    throw new Error('거래창이 안 열렸다')
  }
  await p1.waitForTimeout(400)
  await shot(p1, '2-빈거래창')

  // ── 3. 양쪽이 올린 상태 ──────────────────────────────────
  // 내 것은 손으로 올린다 — 집게가 실제로 먹는지 함께 본다
  const steps = p1.locator('.sc-dr__bag li .sc-dr__step button:nth-child(3)')
  await steps.nth(0).click()
  await p1.waitForTimeout(150)
  await steps.nth(1).click()
  await p2.locator('.sc-dr__bag li .sc-dr__step button:nth-child(3)').nth(0).click()
  await p1.waitForTimeout(1200)
  await shot(p1, '3-양쪽올린상태')

  // ── 4. 한쪽만 준비 ───────────────────────────────────────
  await p2.locator('.sc-dr__go').click()
  await p2.waitForTimeout(1500)
  await shot(p2, '7-상대쪽화면')
  console.log(`  ${otherId} 준비 단추: ${await p2.locator('.sc-dr__go').innerText().catch(() => '?')}`)
  console.log(`  ${otherId} 이 본 말: ${await p2.locator('.sc-pl__said').innerText().catch(() => '(없음)')}`)
  await p1.waitForTimeout(600)
  await shot(p1, '4-한쪽만준비')

  // ── 5. 카운트다운 ────────────────────────────────────────
  await p1.locator('.sc-dr__go').click()
  await p1.waitForSelector('.sc-dr__count', { timeout: 5_000 })
  await shot(p1, '5-카운트다운')

  // ── 6. 성립 직후 ─────────────────────────────────────────
  await p1.waitForSelector('.sc-dr.is-over', { timeout: DEAL_COUNTDOWN_MS + 15_000 })
  await p1.waitForTimeout(400)
  await shot(p1, '6-성립직후')

  await browser.close()
  if (boom.length > 0) {
    console.log('\n화면이 터진 자리')
    for (const b of boom) console.log(`  ✗ ${b}`)
    process.exitCode = 1
  } else {
    console.log('\n여섯 장. 화면이 터진 곳은 없다')
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
