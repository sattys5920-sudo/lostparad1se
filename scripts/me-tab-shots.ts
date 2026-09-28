// 「나」 탭 — 카드 네 장을 두 크기로, 가진 것 한 줄을 가까이.
//
//   1 전체        375×667 · 390×844 fullPage
//   2 가진 것     한 줄만 가까이 — 아이콘 → 숫자 → 이름이 세로로 서는가
//   3 옛 역할     배정이 이름 바꾸기(snacker·locker) 전에 된 판 — 미션이 뜨는가
//   4 배정 전     명단에 역할이 아직 없을 때 — 「아직 배정되지 않았다」
//
// 같이 잰다.
//   - Galmuri11 이 실제로 내려왔는가(document.fonts). 안 내려오면 대체
//     글꼴로 그려져서 숫자가 뭉개진다
//   - 칸 다섯이 폭을 똑같이 나눠 갖는가, 숫자가 잘리지 않는가
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-me --emptyOutDir
//   3. python3 -m http.server 8902 --bind 127.0.0.1 --directory /tmp/claude-0/serve-me
//   4. npx vite-node scripts/me-tab-shots.ts
//
// **운영자 코드는 이 파일에 없다.** 이 판은 운영자 화면을 안 거쳐서
// 코드를 읽을 일도 없다 — 운영자 권한은 에뮬레이터 계정에 붙인다.
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
const SITE = process.env.SITE ?? 'http://127.0.0.1:8902'
/** 파일 이름 앞머리. 고치기 전 것을 따로 찍을 때 바꾼다 */
const TAG = process.env.TAG ?? 'me'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]

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
  const email = `metab-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

/** 명단 한 줄의 역할을 바꾼다. 옛 판을 흉내 낸다 */
async function setRole(game: string, id: string, roleId: string) {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(id)}?updateMask.fieldPaths=roleId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { roleId: { stringValue: roleId } } }),
  })
  if (!r.ok) throw new Error(`명단 고치기 실패 ${r.status}`)
}

async function roleOf(game: string, id: string): Promise<string> {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(id)}`, { headers: ADMIN })
  const j = (await r.json()) as { fields?: { roleId?: { stringValue?: string } } }
  return j.fields?.roleId?.stringValue ?? ''
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const size of SIZES) {
    const game = `mt${Date.now()}${size.w}`
    const host = await hostToken(game)
    await must('createGame', host, { gameId: game, seed: 'mt' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    await must('assignAll', host, { gameId: game })
    await must('startGame', host, { gameId: game, startAtMs: START })
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
    await must('tick', host, { gameId: game })
    console.log(`판 ${game} (${size.w}×${size.h})`)

    // 옛 역할을 흉내 낼 사람. 총무·옆자리 중 하나를 쥔 사람을 고른다
    let reader = 'qa07'
    for (let i = 1; i <= 14; i++) {
      const id = `qa${String(i).padStart(2, '0')}`
      if (['treasurer', 'deskmate'].includes(await roleOf(game, id))) {
        reader = id
        break
      }
    }
    const newRole = await roleOf(game, reader)

    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${size.w} 터짐: ${e.message}`))
    /** 아침 시퀀스를 넘겨 탭바까지 간다 */
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
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', reader)
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    await pastMorning()


    const tab = (label: string) =>
      page.evaluate((l) => {
        const t = [...document.querySelectorAll('.sc-ct__tab')].find((e) => e.textContent?.trim() === l)
        ;(t as HTMLElement | undefined)?.click()
      }, label)
    // 새로 들어와서 「나」 탭을 연다. 전에 받은 학생증이 화면에 남아 있으면 안 되므로 다시 읽는다
    const reopen = async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pastMorning()
      await tab('나')
      await page.waitForSelector('.sc-mi-root', { timeout: 10_000 })
      await settled()
    }
    /** 미션 카드 글 */
    const missionText = () =>
      page.evaluate(() => {
        const h = [...document.querySelectorAll('.sc-mi__head h3')].find((x) => (x.textContent ?? '').replace(/\s/g, '') === '미션')
        return ((h?.closest('.sc-mi__card') as HTMLElement | null)?.innerText ?? '(없다)').replace(/\s+/g, ' ')
      })
    /** 학생증이 올 때까지(점 세 개가 사라질 때까지) 기다린다 */
    const settled = () =>
      page
        .waitForFunction(() => document.querySelector('.sc-mi__stack .sc-mi__card:nth-child(3) .sc-mi__in > :not(header)')?.textContent?.trim(), null, { timeout: 20_000 })
        .then(() => page.waitForTimeout(600))
        .catch(() => missed.push(`${size.w}: 미션 카드가 20초 안에 안 찼다`))
    /** 구르는 상자를 풀어서 fullPage 가 탭 전체를 담게 한다 */
    const fullShot = async (path: string) => {
      const h = await page.evaluate(() => (document.querySelector('.sc-mi__scroll') as HTMLElement).scrollHeight)
      await page.setViewportSize({ width: size.w, height: Math.max(size.h, h + 160) })
      await page.waitForTimeout(400)
      await page.screenshot({ path, fullPage: true })
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.waitForTimeout(200)
    }

    await tab('나')
    await page.waitForSelector('.sc-mi-root', { timeout: 10_000 })
    await settled()

    // ── 글꼴 ──
    const font = await page.evaluate(async () => {
      await document.fonts.ready
      const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Galmuri11')
      return {
        faces: faces.map((f) => f.status),
        check: document.fonts.check('11px Galmuri11'),
        num: getComputedStyle(document.querySelector('.sc-mi__chip b') as HTMLElement).fontFamily,
      }
    })
    console.log(`  글꼴 ${JSON.stringify(font)}`)
    if (!font.faces.includes('loaded') || !font.check) missed.push(`${size.w}: Galmuri11 이 안 내려왔다`)

    // ── 가진 것 한 줄 재기 ──
    const have = await page.evaluate(() => {
      const box = (e: Element | null) => {
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      }
      const chips = [...document.querySelectorAll('.sc-mi__chip')]
      return chips.map((c) => {
        const b = c.querySelector('b') as HTMLElement
        const cs = getComputedStyle(b)
        return {
          chip: box(c),
          img: box(c.querySelector('img')),
          b: box(b),
          i: box(c.querySelector('i')),
          fs: cs.fontSize,
          lh: cs.lineHeight,
          clipped: b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1,
        }
      })
    })
    console.log(`  가진 것 ${JSON.stringify(have[0])}`)
    const widths = new Set(have.map((c) => c.chip?.w))
    if (have.length !== 5) missed.push(`${size.w}: 칸이 ${have.length}개다`)
    if (widths.size !== 1) missed.push(`${size.w}: 칸 폭이 다르다 ${[...widths].join(',')}`)
    for (const c of have) {
      if (c.clipped) missed.push(`${size.w}: 숫자가 잘린다`)
      if (c.img && c.b && c.i && !(c.img.y + c.img.h <= c.b.y && c.b.y + c.b.h <= c.i.y)) missed.push(`${size.w}: 아이콘·숫자·이름이 겹친다`)
    }

    // ── 1 전체 ──
    await fullShot(`${OUT}/${TAG}-${size.w}-1-전체.png`)
    // ── 2 가진 것 ──
    const haveCard = page.locator('.sc-mi__card').nth(1)
    await haveCard.scrollIntoViewIfNeeded()
    await haveCard.screenshot({ path: `${OUT}/${TAG}-${size.w}-2-가진것.png` })

    const now = await missionText()
    console.log(`  미션 (${newRole}) ${now.slice(0, 60)}`)
    if (now.includes('못 받아왔다')) missed.push(`${size.w}: 미션을 못 받아왔다 — ${now}`)
    const votes = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.sc-mi__head h3')].find((x) => (x.textContent ?? '').replace(/\s/g, '') === '받은표')
      return ((h?.closest('.sc-mi__card') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ')
    })
    console.log(`  받은 표 ${votes}`)
    if (!votes.includes('아직 없다')) missed.push(`${size.w}: 표 0 인데 「아직 없다」가 없다`)

    // ── 3 옛 역할 ── 이름을 바꾸기 전 판의 명단을 흉내 낸다
    const legacy = newRole === 'treasurer' ? 'snacker' : newRole === 'deskmate' ? 'locker' : null
    if (legacy) {
      await setRole(game, reader, legacy)
      await reopen()
      const old = await missionText()
      console.log(`  옛 역할 ${legacy} → ${old.slice(0, 60)}`)
      if (old.includes('못 받아왔다')) missed.push(`${size.w}: 옛 역할(${legacy})에서 미션을 못 받아왔다`)
      await fullShot(`${OUT}/${TAG}-${size.w}-3-옛역할.png`)
    } else {
      missed.push(`${size.w}: 총무·옆자리를 쥔 qa 계정을 못 찾았다`)
    }

    // ── 4 배정 전 ── 자리는 있는데 명단에 역할이 없다
    await fetch(`${FS}/games/${game}/secret/roster/items/${uidOf(reader)}`, { method: 'DELETE', headers: ADMIN })
    await reopen()
    const none = await missionText()
    console.log(`  배정 전 → ${none.slice(0, 60)}`)
    if (!none.includes('아직 배정되지 않았다')) missed.push(`${size.w}: 배정 전인데 「아직 배정되지 않았다」가 아니다 — ${none}`)
    await fullShot(`${OUT}/${TAG}-${size.w}-4-배정전.png`)

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
