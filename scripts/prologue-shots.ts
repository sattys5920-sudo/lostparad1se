// 프롤로그 · 칠판 — 진짜 흐름으로 두 크기를 찍고, 박자를 잰다.
//
//   pg-{w}-0-안내          가입 → 나를 만든 직후 바로 뜬 콘텐츠 안내
//   pg-{w}-1a-화면1-타자중 · 1b-화면1-완료(▼)
//   pg-{w}-2a · 2b         화면 2
//   pg-{w}-3a · 3b         화면 3 (완료 — ▼ 없음)
//   pg-{w}-4-암전          3초 암전 한가운데
//   pg-{w}-5a-칠판-적는중 · 5b-칠판-완료(들어간다)
//
// 확인하는 것
//   - 나를 만든 바로 다음에 뜬다(다른 화면을 안 거친다)
//   - 화면 3 뒤 2초는 아무것도 없고(▼도 없다) 그 뒤 3초에 걸쳐 어두워진다
//   - 건너뛰기는 칠판 앞에서 멈춘다(칠판에는 건너뛰기가 없다)
//   - 중간에 닫으면(새로고침) 다음에 처음부터 다시 돈다
//   - 들어간 뒤 두 번째 접속에는 안 뜬다
//   - 375px 에서 가로로 넘치지 않는다
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-pg --emptyOutDir
//   3. python3 -m http.server 8906 --bind 127.0.0.1 --directory /tmp/claude-0/serve-pg
//   4. npx vite-node scripts/prologue-shots.ts
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8906'
const OUT = process.env.OUT ?? '/tmp/claude-0/shots'
const PW = 'prologue-pass-1'
const SIZES = (process.env.SIZES ?? '375x667,390x844').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function call(name: string, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
  return (await r.json()) as { result?: unknown; error?: { message: string } }
}

const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms))

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  for (const size of SIZES) {
    const who = `pg${size.w}${Date.now() % 100000}`
    const made = await call('signUpAccount', { id: who, password: PW })
    if (made.error) throw new Error(made.error.message)
    console.log(`\n── ${size.w}×${size.h} · ${who} ──`)
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const shot = (name: string) => page.screenshot({ path: `${OUT}/pg-${size.w}-${name}.png` })
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

    await page.goto(`${SITE}/?game=pg-none`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', who)
    await page.fill('#gt-pw', PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('#cc-name', { timeout: 20000 })
    await page.fill('#cc-name', '눈사람')
    await page.click('.sc-cc__done')

    // ── 나를 만든 바로 다음 ──
    await page.waitForSelector('.sc-pg__notice', { timeout: 20000 })
    check(true, '나를 만든 바로 다음에 안내가 뜬다')
    await sleep(400)
    await shot('0-안내')
    check((await overflow()) <= 0, '안내 — 가로로 넘치지 않는다', String(await overflow()))

    // ── 중간에 닫으면 처음부터 ──
    await page.click('.sc-pg__ok')
    await sleep(900)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sc-pg__notice', { timeout: 20000 })
    check(true, '중간에 닫았다 열면 안내부터 다시 돈다')
    await page.click('.sc-pg__ok')

    // ── 화면 1 · 2 · 3 ──
    for (let i = 1; i <= 3; i++) {
      await sleep(i === 1 ? 900 : 700)
      await shot(`${i}a-화면${i}-타자중`)
      // 탭 — 남은 글자가 한 번에
      await page.locator('.sc-pg__screen').click()
      await sleep(80)
      const ghost = await page.evaluate(() =>
        [...document.querySelectorAll('.sc-pg__screen .sc-pg__ghost')].map((g) => g.textContent ?? '').join(''),
      )
      check(ghost === '', `화면 ${i} — 탭하면 남은 글자가 다 나온다`, ghost.slice(0, 20))
      const more = await page.locator('.sc-pg__more').count()
      if (i < 3) check(more === 1, `화면 ${i} — 다 나오면 ▼`)
      else check(more === 0, '화면 3 — ▼ 가 없다')
      check((await overflow()) <= 0, `화면 ${i} — 가로로 넘치지 않는다`)
      await shot(`${i}b-화면${i}-완료`)
      if (i < 3) {
        await page.locator('.sc-pg__screen').click()
        await sleep(700)
      }
    }

    // ── 2초 정적 · 3초 암전 ──
    const t0 = Date.now()
    await sleep(1500)
    const veil15 = await page.evaluate(() => getComputedStyle(document.querySelector('.sc-pg__veil') as Element).opacity)
    check(Number(veil15) === 0, '마지막 줄 뒤 1.5초 — 아직 안 어둡다', veil15)
    await sleep(2000)
    const veil35 = Number(await page.evaluate(() => getComputedStyle(document.querySelector('.sc-pg__veil') as Element).opacity))
    check(veil35 > 0.1 && veil35 < 0.9, '3.5초 — 어두워지는 중이다', veil35.toFixed(2))
    await shot('4-암전')
    await page.waitForSelector('.sc-pg__board', { timeout: 8000 })
    const boardAt = Date.now() - t0
    check(boardAt >= 5800, '칠판은 2초 + 3초 + 1초 뒤에 오른다', `${boardAt}ms`)
    check((await page.locator('.sc-pg__skip').count()) === 0, '칠판에는 건너뛰기가 없다')

    // ── 칠판 ──
    await sleep(1400)
    const typed = await page.evaluate(() => document.querySelector('.sc-pg__chalk > span')?.textContent ?? '')
    check(typed.length > 0 && typed.length < 11, '분필이 한 글자씩 적는 중', typed)
    await page.mouse.click(size.w / 2, size.h / 2)
    await sleep(60)
    const afterTap = await page.evaluate(() => document.querySelector('.sc-pg__chalk > span')?.textContent ?? '')
    check(afterTap.length <= typed.length + 1, '탭해도 빨라지지 않는다', afterTap)
    await shot('5a-칠판-적는중')
    await page.waitForSelector('.sc-pg__go', { timeout: 12000 })
    check((await page.locator('.sc-pg__go').textContent())?.trim() === '들어간다', '다 적히고 3초 뒤 「들어간다」')
    await shot('5b-칠판-완료')
    await page.click('.sc-pg__go')
    await page.waitForSelector('.sc-pg', { state: 'detached', timeout: 10000 })
    check(true, '들어간다 — 게임으로')

    // ── 두 번째 접속 ──
    await sleep(1500)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(4000)
    check((await page.locator('.sc-pg').count()) === 0, '두 번째 접속에는 안 뜬다')

    await ctx.close()
  }

  // ── 건너뛰기는 칠판 앞에서 멈춘다 ── (한 크기만)
  {
    const who = `pgs${Date.now() % 100000}`
    await call('signUpAccount', { id: who, password: PW })
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } })
    const page = await ctx.newPage()
    await page.goto(`${SITE}/?game=pg-none`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', who)
    await page.fill('#gt-pw', PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('#cc-name', { timeout: 20000 })
    await page.fill('#cc-name', '건너뛰기')
    await page.click('.sc-cc__done')
    await page.waitForSelector('.sc-pg__notice', { timeout: 20000 })
    check((await page.locator('.sc-pg__skip').count()) === 0, '안내에는 건너뛰기가 없다 — 확인을 눌러야 넘어간다')
    await page.click('.sc-pg__ok')
    await sleep(500)
    await page.click('.sc-pg__skip')
    await page.waitForSelector('.sc-pg__board', { timeout: 3000 })
    check(true, '건너뛰기 — 곧장 칠판')
    await page.waitForSelector('.sc-pg__go', { timeout: 12000 })
    check(true, '칠판은 끝까지 적는다')
    await ctx.close()
  }

  // ── 연출 줄이기 ──
  {
    const who = `pgr${Date.now() % 100000}`
    await call('signUpAccount', { id: who, password: PW })
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${SITE}/?game=pg-none`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', who)
    await page.fill('#gt-pw', PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('#cc-name', { timeout: 20000 })
    await page.fill('#cc-name', '줄이기')
    await page.click('.sc-cc__done')
    await page.waitForSelector('.sc-pg__notice', { timeout: 20000 })
    await page.click('.sc-pg__ok')
    await sleep(150)
    const ghost = await page.evaluate(() =>
      [...document.querySelectorAll('.sc-pg__screen .sc-pg__ghost')].map((g) => g.textContent ?? '').join(''),
    )
    check(ghost === '', '연출 줄이기 — 문단이 한 번에 뜬다')
    await page.locator('.sc-pg__screen').click()
    await page.locator('.sc-pg__screen').click()
    await page.waitForSelector('.sc-pg__board', { timeout: 6000 })
    await sleep(100)
    const chalk = await page.evaluate(() => document.querySelector('.sc-pg__chalk > span')?.textContent ?? '')
    check(chalk === '이번엔 너희가 해 봐.', '칠판 글씨도 한 번에', chalk)
    await page.screenshot({ path: `${OUT}/pg-375-6-줄이기-칠판.png` })
    await ctx.close()
  }

  await browser.close()
  console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`)
  if (failures > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
