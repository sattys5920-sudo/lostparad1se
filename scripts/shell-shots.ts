// 셸과 화면 틀 — 노치 있는 폰에서 사람이 실제로 보는 것.
//
//   ㆍ 로딩(스크립트가 늦게 올 때) · 로그인 · 맵 · 탭마다 · 말하기 · 전체 맵 · 연결 끊김
//   ㆍ 노치와 홈 바는 CDP 로 흉내 낸다(위 47 · 아래 34). 그 밑에 글자가 깔리는가
//   ㆍ 글꼴이 실제로 받아졌는가 · color-scheme · 입력칸 글자 크기 · 탭 하이라이트
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve --emptyOutDir
//   3. W=375 H=667 npx vite-node scripts/shell-shots.ts   (390×844 · 430×932 도)
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import type { Page } from 'playwright'
import { dayHourMs } from '../shared/rules/clock'
import { auditText, type AuditHit } from './lib/audit'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const W = Number(process.env.W ?? 390)
const H = Number(process.env.H ?? 844)
// 홈 버튼이 있는 SE 크기는 노치가 없다
const NOTCH = H <= 700 ? { top: 20, bottom: 0 } : { top: 47, bottom: 34 }


async function must(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

async function hostToken(tag: string): Promise<string> {
  const email = `shell-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function notch(page: Page) {
  const s = await page.context().newCDPSession(page)
  await s.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: NOTCH.top, bottom: NOTCH.bottom, left: 0, right: 0 } })
}

/** 노치·홈 바 밑에 깔린 글자·단추. 보이는 것만 센다 */
async function underNotch(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ top, bottom }) => {
      const out: string[] = []
      const vh = window.innerHeight
      for (const el of Array.from(document.querySelectorAll('button, a, input, textarea, h1, h2, h3, p, span, label'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
        // 자기 글자가 있는 것만 — 감싸는 상자는 빼고
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
        if (!own && !['BUTTON', 'INPUT', 'TEXTAREA'].includes(el.tagName)) continue
        if (r.top < top - 1 && r.bottom > 0) out.push(`위 ${Math.round(r.top)}px: ${el.tagName} ${(el.textContent ?? '').trim().slice(0, 16)}`)
        if (bottom > 0 && r.bottom > vh - bottom + 1 && r.top < vh) out.push(`아래 ${Math.round(vh - r.bottom)}px: ${el.tagName} ${(el.textContent ?? '').trim().slice(0, 16)}`)
      }
      return out.slice(0, 8)
    },
    NOTCH,
  )
}

async function facts(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready
    const loaded = new Set<string>()
    document.fonts.forEach((f) => {
      if (f.status === 'loaded') loaded.add(f.family.replace(/"/g, ''))
    })
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => parseFloat(getComputedStyle(el).fontSize))
    const btn = document.querySelector('button')
    return {
      fonts: [...loaded],
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      metaScheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null,
      tapHighlight: btn ? getComputedStyle(btn).getPropertyValue('-webkit-tap-highlight-color') : null,
      userSelect: getComputedStyle(document.body).userSelect,
      smallestInput: inputs.length ? Math.min(...inputs) : null,
    }
  })
}

const hits = new Map<string, AuditHit & { screen: string }>()
async function audit(page: Page, screen: string) {
  for (const h of await auditText(page)) {
    const k = `${h.kind}|${h.where}|${h.what}`
    if (!hits.has(k)) hits.set(k, { ...h, screen })
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const tag = `shell-${W}x${H}`
  const report: string[] = []
  const game = `sh${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'sh' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  await must('openPhase', host, { gameId: game })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', colorScheme: 'dark' })

  // ── 로딩 — 스크립트가 늦게 오는 망 ──
  {
    const page = await ctx.newPage()
    await notch(page)
    await page.route('**/assets/*.js', async (r) => {
      await new Promise((ok) => setTimeout(ok, 8000))
      await r.continue()
    })
    const t0 = Date.now()
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'commit' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${tag}-0로딩.png` })
    const boot = await page.evaluate(() => !!document.querySelector('#root .boot') && !document.querySelector('.sc-gt'))
    report.push(`로딩: ${boot ? '스크립트 전 로딩 화면이 보인다' : '로딩 화면이 없다'} (${Date.now() - t0}ms 시점)`)
    await page.close()
  }

  const page = await ctx.newPage()
  await notch(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#gt-id', { timeout: 15000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/${tag}-1로그인.png` })
  await audit(page, '로그인')
  report.push(`로그인 노치 밑: ${JSON.stringify(await underNotch(page))}`)
  report.push(`사실: ${JSON.stringify(await facts(page))}`)

  await page.fill('#gt-id', 'qa01')
  await page.fill('#gt-pw', QA_PW)
  await page.click('.sc-gt__submit')
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.sc-ct__tab').count()) break
    await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/${tag}-2맵.png` })
  await audit(page, '맵')

  // 시트 셋 — 깃발(페이즈 행동) · 가방 · 더보기
  for (const [label, file] of [['깃발', '7시트-깃발'], ['가방', '7시트-가방'], ['더 보기', '7시트-더보기']] as const) {
    const b = page.locator('.sc-ct__act', { hasText: label }).first()
    if (!(await b.count())) continue
    await b.evaluate((el) => (el as HTMLElement).click())
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/${tag}-${file}.png` })
    await audit(page, `시트 ${label}`)
    if (label === '더 보기') {
      // 두 번 누르기 — 한 번이면 「정말?」로 바뀌고 2초 뒤 돌아온다
      const out = page.locator('.sc-out__go').first()
      if (await out.count()) {
        await out.evaluate((el) => (el as HTMLElement).click())
        await page.waitForTimeout(150)
        const armed = await out.innerText()
        await page.screenshot({ path: `${OUT}/${tag}-8정말.png` })
        await page.waitForTimeout(2300)
        const back = await out.innerText()
        report.push(`두 번 누르기: 한 번 → 「${armed.replace(/\n/g, ' ')}」, 2초 뒤 → 「${back}」`)
      }
    }
    await page.locator('.sc-sheet__head button, button:has-text("닫기")').first().evaluate((el) => (el as HTMLElement).click()).catch(() => undefined)
    await page.waitForTimeout(400)
  }
  report.push(`맵 노치 밑: ${JSON.stringify(await underNotch(page))}`)

  // 탭마다
  const tabs = await page.locator('.sc-ct__tab').allInnerTexts()
  for (let i = 1; i < tabs.length; i++) {
    await page.locator('.sc-ct__tab').nth(i).evaluate((el) => (el as HTMLElement).click())
    await page.waitForTimeout(700)
    const name = tabs[i].trim()
    await page.screenshot({ path: `${OUT}/${tag}-3탭-${name}.png` })
    await audit(page, `탭 ${name}`)
    const under = await underNotch(page)
    if (under.length) report.push(`${name} 노치 밑: ${JSON.stringify(under)}`)
  }
  report.push(`받은 글꼴(탭을 다 돈 뒤): ${JSON.stringify((await facts(page)).fonts)}`)
  // 탭마다 구르던 자리 — 메모를 내려 두고 맵에 갔다 오면 그 자리여야 한다
  {
    const names = tabs.map((t) => t.trim())
    const memo = names.indexOf('메모')
    if (memo > 0) {
      await page.locator('.sc-ct__tab').nth(memo).evaluate((el) => (el as HTMLElement).click())
      await page.waitForTimeout(400)
      const before = await page.evaluate(() => {
        const box = Array.from(document.querySelectorAll('.sc-pl__tab:not([hidden]), .sc-pl__tab:not([hidden]) *')).find((el) => el.scrollHeight > el.clientHeight + 40)
        if (!box) return -1
        box.scrollTop = 300
        return box.scrollTop
      })
      await page.locator('.sc-ct__tab').nth(0).evaluate((el) => (el as HTMLElement).click())
      await page.waitForTimeout(300)
      await page.locator('.sc-ct__tab').nth(memo).evaluate((el) => (el as HTMLElement).click())
      await page.waitForTimeout(300)
      const after = await page.evaluate(() => {
        const box = Array.from(document.querySelectorAll('.sc-pl__tab:not([hidden]), .sc-pl__tab:not([hidden]) *')).find((el) => el.scrollHeight > el.clientHeight + 40)
        return box ? box.scrollTop : -1
      })
      report.push(`메모 탭 구른 자리: ${before} → 맵 갔다 와서 ${after}`)
    }
  }
  await page.locator('.sc-ct__tab').nth(0).evaluate((el) => (el as HTMLElement).click())
  await page.waitForTimeout(600)

  // 말하기 — 키보드는 못 띄우지만 적는 줄에 초점을 둔다
  const box = page.locator('.sc-sy__box').first()
  if (await box.count()) {
    await box.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${tag}-4말하기.png` })
    report.push(`말하기 칸 글자 ${await box.evaluate((el) => getComputedStyle(el).fontSize)}`)
    await page.keyboard.press('Escape')
  }

  // 빈 채로 보내기 — 눌리고, 까닭을 말한다
  {
    const send = page.locator('.sc-sy__send').first()
    if (await send.count()) {
      await page.locator('.sc-sy__box').first().evaluate((el) => (el as HTMLElement).focus())
      await page.waitForTimeout(300)
      await send.evaluate((el) => (el as HTMLElement).click())
      await page.waitForTimeout(400)
      if (process.env.DEBUG_SAY) {
        report.push(
          await page.evaluate(() =>
            ['.sc-sy', '.sc-sy__bar', '.sc-sy__box', '.sc-sy__send']
              .map((q) => {
                const el = document.querySelector(q) as HTMLElement
                const cs = getComputedStyle(el)
                const r = el.getBoundingClientRect()
                return `${q} ${el.className} x${Math.round(r.x)} w${Math.round(r.width)} border:${cs.borderTopWidth} ${cs.borderTopColor} outline:${cs.outlineStyle} ${cs.outlineWidth} bg:${cs.backgroundColor}`
              })
              .join('\n'),
          ),
        )
      }
      const said = await page.evaluate(() => document.body.innerText.includes('내용을 적어 주세요'))
      report.push(`빈 칸 보내기: ${said ? '「내용을 적어 주세요」가 떴다' : '아무 말도 없다'}`)
      await page.screenshot({ path: `${OUT}/${tag}-4빈보내기.png` })
    }
  }

  // 전체 맵
  const atlas = page.locator('button', { hasText: /^전체 맵$/ }).first()
  if (await atlas.count()) {
    await atlas.evaluate((el) => (el as HTMLElement).click())
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/${tag}-5전체맵.png` })
    await audit(page, '전체 맵')
    report.push(`전체 맵 닫기: ${await page.locator('.sc-at__close, .sc-atlas__done').count()}곳`)
    // 방을 누르면 뒤를 가리지 않는 낮은 시트가 뜬다
    await page.locator('.sc-at__room').nth(3).evaluate((el) => (el as HTMLElement).click()).catch(() => undefined)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${tag}-5전체맵-방.png` })
    report.push(`방 시트: ${(await page.locator('.sc-sheet.is-peek').count()) ? '낮은 시트로 떴다' : '안 떴다'}`)
    await page.locator('.sc-sheet__head button').first().evaluate((el) => (el as HTMLElement).click()).catch(() => undefined)
    await page.waitForTimeout(300)
    report.push(`전체 맵 노치 밑: ${JSON.stringify(await underNotch(page))}`)
    await page.locator('.sc-atlas__done, button:has-text("닫기")').first().click().catch(() => undefined)
    await page.waitForTimeout(500)
  }

  // 연결 끊김
  await ctx.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.waitForTimeout(2500)
  // 끊긴 동안 누르면 — 서버로 안 나가고 까닭이 뜬다. 말하기는 서버로 가는 일이다
  await page.locator('.sc-sy__box').first().fill('여기 누구 있어?').catch(() => undefined)
  await page.locator('.sc-sy__send').first().evaluate((el) => (el as HTMLElement).click())
  await page.waitForTimeout(600)
  report.push(`끊긴 동안 누르기: ${(await page.evaluate(() => document.body.innerText.includes('연결을 기다리는 중이다'))) ? '「연결을 기다리는 중이다」가 떴다' : '아무 말도 없다'}`)
  await page.screenshot({ path: `${OUT}/${tag}-6끊김.png` })
  await ctx.setOffline(false)

  await browser.close()
  console.log(report.join('\n'))
  const byKind = (k: AuditHit['kind']) => [...hits.values()].filter((h) => h.kind === k)
  for (const [k, title] of [['pixel', '픽셀 글꼴이 정수 배율이 아니다'], ['scale', '눈금 밖 글자 크기'], ['contrast', '대비 부족'], ['input', '16 아래 입력칸'], ['tap', '44 보다 작은 누를 것'], ['label', '이름 없는 단추']] as const) {
    const list = byKind(k)
    console.log(`\n${title}: ${list.length}`)
    for (const h of list) console.log(`  [${h.screen}] ${h.where} ${h.what}`)
  }
  if (errors.length) console.log(`터짐: ${JSON.stringify(errors)}`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
