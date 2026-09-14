// 모바일 화면 캡처 — 세 해상도로 전 화면을 찍는다.
//
// 가짜 화면을 찍지 않는다. 에뮬레이터에 판을 세우고, 진짜 계정으로
// 들어가서, 진짜 서버가 준 것을 본다. **화면이 스크롤되는지, 탭바가
// 홈 바에 가리는지, 키보드가 입력창을 가리는지는 그렇게만 알 수 있다.**
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//      (4000번이 막힌 곳에서는 emulators.ui.enabled 를 false 로 둔 설정을
//       --config 로 넘긴다. UI 가 못 뜨면 에뮬레이터가 통째로 내려간다)
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir <어딘가>/lostparad1se
//      해서 그 위 디렉터리를 8899 로 서빙한다
//   4. npx vite-node scripts/shots.ts
import { mkdirSync, writeFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

/** 자리 수만큼 계정을 만든다. 첫 자리로 들어가서 찍는다. */
const QA_PW = 'shots-password'
const ME = 'qa01'

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
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

/** 흩어진 것 한 장을 내가 선 자리로 옮긴다. 운영자 권한으로 직접 쓴다. */
async function moveToMe(sub: string, tileId: string): Promise<void> {
  const r = await fetch(`${FS}/games/${GAME}/${sub}?pageSize=10`, { headers: ADMIN })
  if (!r.ok) throw new Error(`${sub}: 못 읽었다`)
  const j = (await r.json()) as { documents?: { name: string }[] }
  const first = j.documents?.[0]
  if (!first) throw new Error(`${sub}: 흩어진 것이 없다`)
  const put = await fetch(
    `${first.name.replace('projects/', 'http://127.0.0.1:8080/v1/projects/')}?updateMask.fieldPaths=tileId`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { tileId: { stringValue: tileId } } }),
    },
  )
  if (!put.ok) throw new Error(`${sub}: 못 옮겼다`)
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

/** 찍을 해상도. 기준은 첫 줄이다. */
const SIZES = [
  { tag: 'se', w: 375, h: 667, dpr: 2 },
  { tag: 'i14', w: 390, h: 844, dpr: 3 },
  { tag: 'and', w: 412, h: 915, dpr: 2.625 },
]

interface Shot {
  name: string
  /** 찍기 전에 화면을 그 상태로 만든다. */
  set?: (page: import('playwright').Page) => Promise<void>
}

const GAME = `shot${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const problems: string[] = []

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  console.log(`판 ${GAME} 을 세운다`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await auth(he)
  await must('createGame', host, { gameId: GAME, seed: 'shots' })
  const seeded = await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  console.log(`  ${seeded.seated}명이 앉았다`)
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })

  // 문제 종이가 바닥에 떨어져 있어야 시험지 화면을 찍는다.
  // 페이즈를 한 번 열었다 닫으면 쪽지와 종이가 흩어진다
  for (let i = 0; i < 3; i++) {
    await must('hostQuizUpsert', host, {
      gameId: GAME,
      quiz: { kind: 'short', prompt: `${i + 1}번. 겨울에 학교 창문이 얼면 무엇으로 녹이는가`, choices: [], answers: ['입김'], explain: '' },
    })
  }
  await must('openPhase', host, { gameId: GAME })
  await must('closePhase', host, { gameId: GAME })
  // 흩어진 것은 기지에 떨어지지 않는다. 찍으려면 내가 선 자리로
  // 한 장씩 옮겨 둬야 한다 — 화면을 고치는 것이 아니라 판을 차리는 것이다
  await moveToMe('secret/quiz/floor', 'baseA')
  await moveToMe('secret/slips/items', 'baseA')
  // **views 는 손으로 고친 것을 모른다.** 시계를 조금 밀고 따라잡기를
  // 불러야 서버가 다시 깎아 내려보낸다
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10) + 60_000, speed: 1 })
  await must('tick', host, { gameId: GAME })
  console.log('  한 교시를 돌려 쪽지와 종이를 흩고, 한 장씩 발밑으로 옮겼다')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: size.dpr,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => problems.push(`[${size.tag}] 화면이 터졌다: ${e.message}`))

    await page.goto(`${SITE}/play.html?game=${GAME}`, { waitUntil: 'networkidle' })

    // 로그인. 가입이 아니라 이미 있는 계정으로 들어간다
    await page.waitForSelector('.sc-pl__gate', { timeout: 20_000 })
    await page.fill('input[placeholder="아이디"]', ME)
    await page.fill('input[placeholder="비밀번호"]', QA_PW)
    await page.locator('.sc-pl__gate button.sc-pl__go').click()

    // 아침 시퀀스를 지나야 오늘 하루가 나온다. 볼 것이 없으면 저절로
    // 지나가지만, 있으면 눌러서 넘긴다
    for (let i = 0; i < 30; i++) {
      if (await page.locator('.sc-pl__today').count()) break
      await page.mouse.click(size.w / 2, size.h / 2).catch(() => undefined)
      await page.keyboard.press('Enter').catch(() => undefined)
      await page.waitForTimeout(500)
    }
    if ((await page.locator('.sc-pl__today').count()) === 0) {
      await page.screenshot({ path: `${OUT}/${size.tag}-막힌자리.png` })
      throw new Error(`[${size.tag}] 오늘 하루까지 못 갔다`)
    }
    // 첫 접속 안내를 한 번 치운다. 이것도 한 장 찍고 나서
    await page.waitForTimeout(900)
    await shoot(page, size.tag, '00-홈화면안내')
    await page.locator('.sc-home__panel button').click().catch(() => undefined)
    await page.waitForTimeout(400)

    const shots: Shot[] = [
      { name: '01-맵탭' },
      { name: '02-행동시트', set: async (p) => void (await tap(p, '.sc-pl__acts button:nth-child(1)')) },
      { name: '03-말시트', set: async (p) => void (await tap(p, '.sc-pl__acts button:nth-child(3)')) },
      { name: '04-더보기시트', set: async (p) => void (await tap(p, '.sc-pl__acts button:nth-child(4)')) },
      {
        name: '05-거래시트',
        set: async (p) => {
          await tap(p, '.sc-pl__acts button:nth-child(4)')
          await tap(p, '.sc-pl__more button:nth-child(1)')
        },
      },
      { name: '06-전체맵', set: async (p) => void (await tap(p, '.sc-pl__acts button:nth-child(2)')) },
      { name: '07-나탭', set: async (p) => void (await tap(p, '.sc-pl__tabbar button:nth-child(2)')) },
      { name: '08-수첩탭', set: async (p) => void (await tap(p, '.sc-pl__tabbar button:nth-child(3)')) },
      {
        name: '09-투명인간투표',
        set: async (p) => {
          await tap(p, '.sc-pl__tabbar button:nth-child(2)')
          await p.locator('.sc-bl').scrollIntoViewIfNeeded().catch(() => undefined)
        },
      },
      {
        name: '10-한번묻기',
        set: async (p) => {
          await tap(p, '.sc-pl__tabbar button:nth-child(2)')
          await p.locator('.sc-bl').scrollIntoViewIfNeeded().catch(() => undefined)
          await tap(p, '.sc-bl__names button')
        },
      },
      {
        name: '11-보관함',
        set: async (p) => {
          await tap(p, '.sc-pl__tabbar button:nth-child(3)')
          await tap(p, '.sc-pl__wide')
        },
      },
      {
        name: '12-시험지',
        set: async (p) => {
          await tap(p, '.sc-pl__tabbar button:nth-child(2)')
          await p.locator('.sc-qz').scrollIntoViewIfNeeded().catch(() => undefined)
        },
      },
    ]

    // 시험지에 키보드가 올라온 상태. **진짜 키보드는 못 띄우지만**
    // 키보드가 하는 일은 화면을 그만큼 줄이는 것이라, 뷰포트를 줄이고
    // 입력창이 그래도 보이는지를 본다
    const keyboard: Shot = {
      name: '14-시험지-키보드',
      set: async (p) => {
        await tap(p, '.sc-pl__tabbar button:nth-child(2)')
        await tap(p, '.sc-qz button')
        // 펼치는 데 서버 왕복이 한 번 든다. 기다리지 않으면 접힌 채로 찍힌다
        const box = p.locator('.sc-qz input, .sc-qz textarea').first()
        await box.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
        if ((await box.count()) === 0) return
        await p.setViewportSize({ width: size.w, height: size.h - 300 })
        await box.focus()
        await box.fill('입김')
        await p.waitForTimeout(700)
      },
    }
    shots.push(keyboard)

    for (const s of shots) {
      await reset(page)
      if (s.set) await s.set(page)
      await page.waitForTimeout(450)
      await shoot(page, size.tag, s.name)
      await audit(page, size.tag, s.name)
      if (s === keyboard) {
        const seen = await page.evaluate(() => {
          // 키보드로 줄어든 세로를 가로로 착각하면 글을 쓰는 내내
          // "세로로 돌려 주세요"가 뜬다
          const turn = document.querySelector('.sc-turn')
          if (turn && getComputedStyle(turn).display !== 'none') return '키보드를 가로로 착각했다'
          const el = document.querySelector('.sc-qz input, .sc-qz textarea')
          if (!el) return '입력창을 못 찾았다'
          const r = el.getBoundingClientRect()
          if (r.top < 0 || r.bottom > innerHeight) return `입력창이 화면 밖이다 (${Math.round(r.top)}~${Math.round(r.bottom)} / ${innerHeight})`
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          if (at !== el && !el.contains(at)) return `입력창을 ${(at as HTMLElement)?.className || '무언가'}가 덮었다`
          return ''
        })
        if (seen) problems.push(`[${size.tag}] ${s.name}: ${seen}`)
        await page.setViewportSize({ width: size.w, height: size.h })
        await page.waitForTimeout(250)
      }
    }

    // 가로로 돌렸을 때
    await reset(page)
    await page.setViewportSize({ width: size.h, height: size.w })
    await page.waitForTimeout(300)
    await shoot(page, size.tag, '13-가로안내')
    const turn = await page.locator('.sc-turn').isVisible()
    if (!turn) problems.push(`[${size.tag}] 가로로 돌렸는데 안내가 안 뜬다`)
    await page.setViewportSize({ width: size.w, height: size.h })

    await ctx.close()
  }

  await browser.close()

  console.log('\n── 확인 ──')
  if (problems.length === 0) console.log('  ✓ 모두 통과')
  for (const p of problems) console.log(`  ✗ ${p}`)
  writeFileSync(`${OUT}/report.txt`, problems.join('\n') || '모두 통과\n')
  process.exit(problems.length === 0 ? 0 : 1)
}

/** 시트와 오버레이를 걷고 맵 탭으로 돌아간다. */
async function reset(page: import('playwright').Page): Promise<void> {
  // **먼저 포커스를 뺀다.** 입력창을 잡은 채로 두면 글 쓰는 중으로 남아
  // 탭바가 숨겨진 채고, 그러면 아래 탭 누르기가 통째로 헛돈다
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 4; i++) {
    const sheet = page.locator('.sc-sheet__head button')
    if (await sheet.count().then((n) => n > 0)) {
      await sheet.first().click({ force: true }).catch(() => undefined)
      continue
    }
    const ask = page.locator('.sc-ask__row button').first()
    if (await ask.count().then((n) => n > 0)) {
      await ask.click({ force: true }).catch(() => undefined)
      continue
    }
    const atlas = page.locator('.sc-atlas__done')
    if (await atlas.count().then((n) => n > 0)) {
      await atlas.click({ force: true }).catch(() => undefined)
      continue
    }
    // 보관함은 오늘 하루를 통째로 덮는다. 닫아야 탭바가 돌아온다
    const ar = page.locator('.sc-ar__close')
    if (await ar.count().then((n) => n > 0)) {
      await ar.click({ force: true }).catch(() => undefined)
      continue
    }
    break
  }
  await page.locator('.sc-pl__tabbar button').first().click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(200)
}

async function tap(page: import('playwright').Page, sel: string): Promise<void> {
  const el = page.locator(sel).first()
  if ((await el.count()) === 0) return
  await el.click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(350)
}

async function shoot(page: import('playwright').Page, tag: string, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png` })
}

/**
 * 캡처한 상태 그대로 재 본다.
 *
 * - 세로로 구르지 않는가
 * - 하단 탭바가 안전 영역 안에 있는가
 * - 누를 수 있는 것이 44px 이상인가
 */
async function audit(page: import('playwright').Page, tag: string, name: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollHeight > doc.clientHeight + 1) {
      out.push(`앱이 세로로 구른다 (${doc.scrollHeight} > ${doc.clientHeight})`)
    }
    if (doc.scrollWidth > doc.clientWidth + 1) {
      out.push(`앱이 가로로 구른다 (${doc.scrollWidth} > ${doc.clientWidth})`)
    }
    const small: string[] = []
    for (const el of Array.from(document.querySelectorAll('button, select, [role="button"]'))) {
      const r = el.getBoundingClientRect()
      // 안 보이는 것은 세지 않는다
      if (r.width === 0 || r.height === 0) continue
      if (r.bottom < 0 || r.top > innerHeight) continue
      // 줄 안에 끼어 있는 작은 단추는 보이지 않는 여백으로 넓혀 뒀다
      if ((el as HTMLElement).classList.contains('is-inline')) continue
      if (r.height < 43.5 || r.width < 43.5) {
        small.push(`${el.className || el.tagName}=${Math.round(r.width)}×${Math.round(r.height)}`)
      }
    }
    if (small.length > 0) out.push(`터치 영역 44px 미만: ${[...new Set(small)].slice(0, 6).join(', ')}`)
    return out
  })
  for (const b of bad) problems.push(`[${tag}] ${name}: ${b}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
