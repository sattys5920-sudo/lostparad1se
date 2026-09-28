// 학생증 앞뒤 · 판정 팝업 · 지난 판정 — 두 크기로 찍는다.
//
//   mp-{w}-1-앞면      학생증 앞면(사진 4배 · 이름 · 반 · 역할 · 소개)
//   mp-{w}-2-뒷면      뒤집은 면(그해 겨울 · 미션 한 줄 · 조건)
//   mp-{w}-3-해냈다    DAY 1 을 달성으로 뒤집어 보냈다 — 팝업
//   mp-{w}-4-끝났다    DAY 2 를 실패로 뒤집어 보냈다 — 팝업
//   mp-{w}-5-지난판정  「나」 탭의 지난 판정 목록
//   mp-{w}-6-다시보기  목록을 눌러 다시 띄운 DAY 1
//   mp-{w}-7-나흘표    마지막 날 판정이 온 뒤의 나흘 표
//   mp-{w}-8-최종      판이 끝나고 온 진짜 마지막 날 팝업(엔딩 위)
//
// 7 의 DAY 4 는 **에뮬레이터 우편함에 직접 적은 것**이다. 진짜 마지막 날
// 판정은 판이 끝나야 나오는데(missionDays.ts), 끝나면 「나」 탭이 없다.
// 표 모양을 보려고 흉내만 낸다 — 8 에서 진짜를 따로 찍는다.
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-mp --emptyOutDir
//   3. python3 -m http.server 8905 --bind 127.0.0.1 --directory /tmp/claude-0/serve-mp
//   4. npx vite-node scripts/mission-popup-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8905'
const TAG = process.env.TAG ?? 'mp'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = (process.env.SIZES ?? '375x667,390x844').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})

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
  const email = `mpop-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function roleOf(game: string, id: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(id)}`, { headers: ADMIN })
  const j = (await r.json()) as { fields?: { roleId?: { stringValue?: string } } }
  return j.fields?.roleId?.stringValue ?? ''
}

// ── Firestore REST 값 ──
type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
function enc(v: Json): unknown {
  if (v === null) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
}
function plain(v: unknown): Json {
  if (v === null || typeof v !== 'object') return v as Json
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue as string
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return o.doubleValue as number
  if ('booleanValue' in o) return o.booleanValue as boolean
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plain)
  if ('mapValue' in o) return Object.fromEntries(Object.entries((o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}).map(([k, x]) => [k, plain(x)]))
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return null
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const size of SIZES) {
    const game = `mp${Date.now()}${size.w}`
    const host = await hostToken(game)
    await must('createGame', host, { gameId: game, seed: 'mp' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    await must('assignAll', host, { gameId: game })
    await must('startGame', host, { gameId: game, startAtMs: START })
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
    await must('tick', host, { gameId: game })
    console.log(`판 ${game} (${size.w}×${size.h})`)

    // 짝사랑을 쥔 사람 — 뒷면에 그 사람 이름이 뜬다. 없으면 qa01
    let who = 'qa01'
    for (let i = 1; i <= 14; i++) {
      const id = `qa${String(i).padStart(2, '0')}`
      if ((await roleOf(game, id)) === 'crush') {
        who = id
        break
      }
    }
    const uid = uidOf(who)
    console.log(`  ${who} (${await roleOf(game, who)})`)

    const pushTo = async (kind: string, d: number) => {
      for (let i = 0; i < 20; i++) {
        const r = (await must('pushDay', host, { gameId: game })) as { pushed: { kind: string; day: number } | null }
        if (!r.pushed || (r.pushed.kind === kind && r.pushed.day === d)) return
      }
    }
    const send = async (day: number, status: 'met' | 'failed') => {
      await must('hostMissionOverride', host, { gameId: game, day, playerId: uid, status, reason: '찍기용' })
      await must('hostMissionSend', host, { gameId: game, day, playerIds: [uid] })
    }

    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${size.w} 터짐: ${e.message}`))
    const pastMorning = async () => {
      for (let i = 0; i < 40; i++) {
        if (await page.locator('.sc-ct__tab').count()) break
        await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
        await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
        await page.waitForTimeout(300)
      }
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(1200)
    }
    const tab = (label: string) =>
      page.evaluate((l) => {
        const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === l)
        ;(t as HTMLElement | undefined)?.click()
      }, label)
    /** 팝업 안에서 잘리는 것 · 넘치는 것 */
    const popupFit = async (label: string) => {
      const r = await page.evaluate(() => {
        const sheet = document.querySelector('.sc-jd__sheet') as HTMLElement | null
        const inn = document.querySelector('.sc-jd__in') as HTMLElement | null
        if (!sheet || !inn) return null
        const sb = sheet.getBoundingClientRect()
        const wide = [...inn.querySelectorAll('li, p, h2, button')].filter((e) => {
          const b = e.getBoundingClientRect()
          return b.right > sb.right + 1 || b.left < sb.left - 1 || (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1
        }).length
        return {
          top: Math.round(sb.top),
          bottom: Math.round(sb.bottom),
          vh: innerHeight,
          scrolls: inn.scrollHeight > inn.clientHeight + 1,
          wide,
          word: document.querySelector('.sc-jd__word')?.getAttribute('aria-label'),
          // 종이가 반 화소에 서면 모서리 조각 옆에 틈이 벌어진다
          frac: +((sb.left % 1) + (sb.top % 1)).toFixed(3),
        }
      })
      console.log(`  ${label} ${JSON.stringify(r)}`)
      if (!r) missed.push(`${size.w} ${label}: 팝업이 없다`)
      else {
        if (r.wide > 0) missed.push(`${size.w} ${label}: 옆으로 넘친다 ${r.wide}`)
        if (r.top < 0 || r.bottom > r.vh) missed.push(`${size.w} ${label}: 화면 밖으로 나간다`)
        if (r.frac !== 0) missed.push(`${size.w} ${label}: 종이가 반 화소에 섰다 ${r.frac}`)
      }
    }
    const shot = (name: string) => page.screenshot({ path: `${OUT}/${TAG}-${size.w}-${name}.png` })

    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', who)
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    await pastMorning()
    await tab('나')
    await page.waitForSelector('.sc-mi__idcard', { timeout: 10_000 })
    await page
      .waitForFunction(() => !document.querySelector('.sc-mi__idcard .sc-dots') && document.querySelector('.sc-mi__intro'), null, { timeout: 20_000 })
      .catch(() => missed.push(`${size.w}: 학생증이 20초 안에 안 찼다`))
    await page.waitForTimeout(500)

    // ── 1 앞면 ──
    const card = page.locator('.sc-mi__idcard')
    await card.screenshot({ path: `${OUT}/${TAG}-${size.w}-1-앞면.png` })
    const front = await page.evaluate(() => {
      const f = document.querySelector('.sc-mi__face') as HTMLElement
      const cs = getComputedStyle(f)
      return { w: f.offsetWidth, h: f.offsetHeight, render: cs.imageRendering, intro: document.querySelector('.sc-mi__intro')?.textContent }
    })
    console.log(`  앞면 ${JSON.stringify(front)}`)
    if (front.w !== 128 || !/pixelated/.test(front.render)) missed.push(`${size.w}: 사진이 4배 · 도트가 아니다`)

    // ── 2 뒷면 ── 키보드로 뒤집는다(단추에 aria-pressed)
    await page.locator('.sc-mi__fold').focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    const back = await page.evaluate(() => ({
      pressed: document.querySelector('.sc-mi__fold')?.getAttribute('aria-pressed'),
      head: document.querySelector('.sc-mi__winter')?.textContent,
      paras: document.querySelectorAll('.sc-mi__para').length,
      line: document.querySelector('.sc-mi__back .sc-mi__line')?.textContent,
      target: document.querySelector('.sc-mi__target')?.textContent ?? null,
      clauses: document.querySelectorAll('.sc-mi__back .sc-mi__clauses li').length,
    }))
    console.log(`  뒷면 ${JSON.stringify(back)}`)
    if (back.pressed !== 'true' || back.head !== '그해 겨울, 나는' || back.paras === 0 || !back.line) missed.push(`${size.w}: 뒷면이 이상하다 ${JSON.stringify(back)}`)
    await card.screenshot({ path: `${OUT}/${TAG}-${size.w}-2-뒷면.png` })
    // 면을 눌러도 도로 뒤집힌다
    await page.locator('.sc-mi__face2').click()
    await page.waitForTimeout(300)
    if ((await page.locator('.sc-mi__intro').count()) === 0) missed.push(`${size.w}: 면을 눌러 앞면으로 안 돌아온다`)

    // ── 3 해냈다 ── DAY 2 로 넘기고 DAY 1 을 달성으로 보낸다
    await pushTo('dayStart', 2)
    await send(1, 'met')
    await page.waitForSelector('.sc-jd', { timeout: 15_000 }).catch(() => missed.push(`${size.w}: DAY 1 팝업이 안 떴다`))
    await page.waitForTimeout(250)
    await shot('3a-해냈다-오르는중')
    await page.waitForTimeout(1800)
    await popupFit('해냈다')
    await shot('3-해냈다')
    await page.locator('.sc-jd__close').click()
    await page.waitForTimeout(400)
    if (await page.locator('.sc-jd').count()) missed.push(`${size.w}: 닫기로 안 닫힌다`)

    // ── 4 끝났다 ── 다른 탭에 있어도 뜬다. 바깥을 눌러 닫는다
    await tab('맵')
    await pushTo('dayStart', 3)
    await send(2, 'failed')
    await page.waitForSelector('.sc-jd', { timeout: 15_000 }).catch(() => missed.push(`${size.w}: DAY 2 팝업이 안 떴다`))
    await page.waitForTimeout(2000)
    await popupFit('끝났다')
    await shot('4-끝났다')
    await page.mouse.click(size.w / 2, 6)
    await page.waitForTimeout(400)
    if (await page.locator('.sc-jd').count()) missed.push(`${size.w}: 바깥을 눌러 안 닫힌다`)

    // 서버에 「봤다」가 적혔는가
    await page.waitForTimeout(800)
    const inbox = plain(await (await fetch(`${FS}/games/${game}/inbox/${uid}`, { headers: ADMIN })).json()) as {
      seen?: Record<string, boolean>
      missions?: Record<string, Record<string, Json>>
    }
    console.log(`  봤다 ${JSON.stringify(inbox.seen)}`)
    if (!inbox.seen?.d1 || !inbox.seen?.d2) missed.push(`${size.w}: 닫았는데 seen 이 안 적혔다`)

    // ── 5 지난 판정 ──
    await tab('나')
    await page.waitForSelector('.sc-mi__past', { timeout: 10_000 })
    const past = page.locator('.sc-mi__card', { has: page.locator('.sc-mi__past') })
    await past.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await past.screenshot({ path: `${OUT}/${TAG}-${size.w}-5-지난판정.png` })
    const rows = await page.locator('.sc-mi__past li').allInnerTexts()
    console.log(`  지난 판정 ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' ')))}`)
    if (rows.length !== 2) missed.push(`${size.w}: 지난 판정이 ${rows.length}줄이다`)

    // ── 6 다시 보기 ── seen 을 안 건드린다
    await page.locator('.sc-mi__past button').first().click()
    await page.waitForSelector('.sc-jd', { timeout: 5000 })
    await page.waitForTimeout(1800)
    await popupFit('다시보기')
    await shot('6-다시보기')
    // 아래로 쓸어 닫기
    const box = await page.locator('.sc-jd__day').boundingBox()
    if (box) {
      const cdp = await ctx.newCDPSession(page)
      const x = box.x + box.width / 2
      const y0 = box.y + 4
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
      for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + k * 25 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(400)
      if (await page.locator('.sc-jd').count()) missed.push(`${size.w}: 쓸어서 안 닫힌다`)
    }

    // ── 7 나흘 표 ── DAY 3 은 진짜로, DAY 4 는 흉내(위 머리말)
    await pushTo('dayStart', 4)
    await send(3, 'met')
    await page.waitForSelector('.sc-jd', { timeout: 15_000 }).catch(() => missed.push(`${size.w}: DAY 3 팝업이 안 떴다`))
    await page.waitForTimeout(1600)
    await page.locator('.sc-jd__close').click()
    await page.waitForTimeout(600)
    const now = plain(await (await fetch(`${FS}/games/${game}/inbox/${uid}`, { headers: ADMIN })).json()) as {
      missions?: Record<string, Record<string, Json>>
    }
    const d3 = now.missions?.d3
    if (d3) {
      const fake = { ...d3, day: 4, final: true, status: 'failed', choice: 'met', sentAtMs: Date.now() }
      const r = await fetch(`${FS}/games/${game}/inbox/${uid}?updateMask.fieldPaths=missions.d4&updateMask.fieldPaths=seen.d4`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ADMIN },
        body: JSON.stringify({ fields: { missions: enc({ d4: fake }), seen: enc({ d4: true }) } }),
      })
      if (!r.ok) missed.push(`${size.w}: DAY 4 흉내 적기 실패 ${r.status}`)
    }
    await page.waitForSelector('.sc-mi__days', { timeout: 10_000 }).catch(() => missed.push(`${size.w}: 나흘 표가 안 폈다`))
    const pastCard = page.locator('.sc-mi__card', { has: page.locator('.sc-mi__past') })
    await pastCard.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await pastCard.screenshot({ path: `${OUT}/${TAG}-${size.w}-7-나흘표.png` })
    const table = await page.evaluate(() => {
      const t = document.querySelector('.sc-mi__days') as HTMLElement | null
      const card = t?.closest('.sc-mi__in') as HTMLElement | null
      return t && card ? { tw: t.scrollWidth, cw: card.clientWidth, rows: t.querySelectorAll('tbody tr').length } : null
    })
    console.log(`  나흘 표 ${JSON.stringify(table)}`)
    if (!table || table.rows !== 4) missed.push(`${size.w}: 나흘 표 줄이 넷이 아니다`)
    else if (table.tw > table.cw) missed.push(`${size.w}: 나흘 표가 카드보다 넓다`)

    // ── 8 최종 ── 판을 끝내고 진짜 DAY 4 를 보낸다. 엔딩 위에 뜬다
    for (let i = 0; i < 40; i++) {
      const r = (await must('pushDay', host, { gameId: game })) as { phase: string; pushed: unknown }
      if (r.phase === 'finished' || r.pushed === null) break
    }
    await must('hostMissionSend', host, { gameId: game, day: 4, playerIds: [uid] })
    await page.waitForSelector('.sc-jd', { timeout: 20_000 }).catch(() => missed.push(`${size.w}: 끝난 뒤 DAY 4 팝업이 안 떴다`))
    await page.waitForTimeout(2200)
    await popupFit('최종')
    await shot('8-최종')

    await ctx.close()
  }

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify([...new Set(missed)])}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
