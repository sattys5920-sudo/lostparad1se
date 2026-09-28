// 맵 머리 표시 · 미니맵 · 이름표를 폰 두 크기로 찍는다.
//
//   1 맵 탭      머리 두 층(날짜·시계·나 / 방 이름·인원·팀 점수),
//                22% 로 줄고 옅어진 미니맵, 발 아래 반투명 이름표
//   2 전체 맵    머리를 고친 뒤에도 도면이 제자리인가
//   3 가입 목록  캐릭터를 안 만든 계정이 「이름 없음」 대신 무엇으로 뜨나
//
// 열넷이 한 교실에 선 첫 아침을 찍는다 — 이름표끼리, 이름표와 발이 겹치는지 본다.
//
//   1. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-hud --emptyOutDir
//   2. python3 -m http.server 8903 --bind 127.0.0.1 --directory /tmp/claude-0/serve-hud
//   3. npx vite-node scripts/hud-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽고,
// 찍지도 적지도 않는다.
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8903'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
/** 첫째 눈으로 찍는다. 이름표가 적어도 셋은 떠야 한다 */
const TRIO = ['qa01', 'qa02', 'qa03']

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
  const email = `hud-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

/** 점수 줄이 0 만 늘어서지 않게 방 몇 곳에 주인을 앉힌다 */
async function own(game: string, tileId: string, team: string): Promise<void> {
  await fetch(`${FS}/games/${game}/tiles/${tileId}?updateMask.fieldPaths=ownerTeam`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { ownerTeam: { stringValue: team } } }),
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const game = `hud${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'hud' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  console.log(`판 ${game}`)

  // 첫 아침은 열넷이 다 한 교실(2-3 교실)에 선다 — 따로 옮기지 않아도
  // 이름표끼리 붙는다. 옮기면 서버 자리와 화면 자리가 어긋나 오히려 흩어진다
  const tilesRes = (await fetch(`${FS}/games/${game}/tiles?pageSize=100`, { headers: ADMIN }).then((r) => r.json())) as {
    documents?: { name: string }[]
  }
  const tileIds = (tilesRes.documents ?? []).map((d) => d.name.split('/').pop() as string)
  const teams = ['A', 'B', 'C', 'D', 'A', 'B', 'A']
  for (const [i, t] of teams.entries()) if (tileIds[i + 3]) await own(game, tileIds[i + 3], t)

  // 가입만 하고 캐릭터를 안 만든 계정 — 가입 목록에서 무엇으로 뜨나
  const bare = `hb${String(Date.now()).slice(-6)}`
  await must('signUpAccount', host, { id: bare, password: 'hud-bare-pass1' })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const { w, h } of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${w}: 화면 터짐: ${e.message}`))
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', TRIO[0])
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.sc-ct__tab').count()) break
      await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
      await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
      await page.waitForTimeout(300)
    }
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(3000)

    // 잰다 — 머리 층 수, 미니맵 폭, 이름표가 발 아래인가
    const m = (await page.evaluate(`(() => {
      const head = document.querySelector('.sc-pl__head')
      const rows = head ? [...head.children].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).map((e) => e.className) : []
      const mini = document.querySelector('.sc-mini')
      const tags = [...document.querySelectorAll('.sc-wk__tag')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => {
        const r = e.getBoundingClientRect()
        return { t: e.textContent.trim(), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), bg: getComputedStyle(e).backgroundColor }
      })
      return {
        rows,
        miniW: mini ? Math.round(mini.getBoundingClientRect().width) : null,
        miniBg: mini ? getComputedStyle(mini).backgroundColor : null,
        tags,
      }
    })()`)) as { rows: string[]; miniW: number | null; miniBg: string | null; tags: { t: string; top: number; left: number; w: number; bg: string }[] }
    console.log(`  ${w}×${h} 머리 ${m.rows.length}층 [${m.rows.join(' | ')}]`)
    console.log(`    미니맵 ${m.miniW}px (화면의 ${m.miniW ? ((m.miniW / w) * 100).toFixed(1) : '-'}%) 바탕 ${m.miniBg}`)
    console.log(`    이름표 ${m.tags.map((t) => `${t.t}@${t.left},${t.top}`).join(' ')} 바탕 ${m.tags[0]?.bg ?? '-'}`)
    if (m.rows.filter((c) => /hud|sc-sb/.test(c)).length !== 2) missed.push(`${w}: 머리가 두 층이 아니다 — ${m.rows.join(' | ')}`)
    if (m.miniW && Math.abs(m.miniW - w * 0.22) > 1.5) missed.push(`${w}: 미니맵이 22% 가 아니다 (${m.miniW}px)`)
    if (m.tags.length < TRIO.length) missed.push(`${w}: 이름표가 ${m.tags.length}개뿐이다`)
    await page.screenshot({ path: `${OUT}/hud-${w}x${h}-map.png` })

    // 전체 맵
    await page.locator('.sc-mini').click({ timeout: 3000 }).catch(() => missed.push(`${w}: 미니맵을 못 눌렀다`))
    await page.waitForSelector('.sc-at', { timeout: 5000 }).catch(() => missed.push(`${w}: 전체 맵이 안 열렸다`))
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/hud-${w}x${h}-atlas.png` })
    await ctx.close()
  }

  // 가입 목록 — 운영자 책상
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const desk = await ctx.newPage()
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
    // 가입 목록은 「관리」 탭 맨 아래다. 계정을 서버가 펴 주므로 조금 기다린다
    await desk.locator('.sc-ad__tabs button', { hasText: '관리' }).first().click()
    const row = desk.locator('.sc-ad__accounts li', { hasText: bare })
    await row.first().waitFor({ timeout: 20_000 }).catch(() => undefined)
    if (await row.count()) {
      const said = (await row.innerText()).replace(/\s+/g, ' ')
      console.log(`  가입 목록: ${said}`)
      if (said.includes('이름 없음')) missed.push('캐릭터 안 만든 계정이 아직 「이름 없음」이다')
      await row.scrollIntoViewIfNeeded()
      await desk.locator('.sc-ad__accounts').screenshot({ path: `${OUT}/hud-signups.png` })
    } else missed.push('가입 목록에서 새 계정을 못 찾았다')
    await ctx.close()
  }

  await browser.close()
  if (missed.length) {
    console.log('\n놓친 것:')
    for (const x of missed) console.log(`  ✗ ${x}`)
    process.exitCode = 1
  } else console.log('\n다 찍었다.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
