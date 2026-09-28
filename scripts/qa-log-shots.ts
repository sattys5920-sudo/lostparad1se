// 운영자 「로그」 탭 — 시각순 로그 · 불변식 빨간 띠 · 거르기 · 따라가기를 375×667 로 찍는다.
//
// 열넷을 앉히고 몇 가지 일을 일으킨 뒤(방 옮김 · 표 · 쪽지 뿌림 · 달력) 금고를
// 음수로 고쳐 두고 연다 — 띠가 떠야 찍힌다.
//
//   1. cd functions && npm run build   (에뮬레이터가 떠 있어야 한다)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-qa --emptyOutDir
//   3. python3 -m http.server 8908 --bind 127.0.0.1 --directory /tmp/claude-0/serve-qa
//   4. npx vite-node scripts/qa-log-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { START_TILE, TILE_IDS, canRoamTo } from '../shared/rules/board'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8908'
const OUT = '/tmp/claude-0/shots'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZE = { w: 375, h: 667 }
const NAMES = ['서윤', '하준', '지우', '도윤', '서아', '이안', '하린', '시우', '아린', '유준', '채원', '은우', '다온', '로하']

const missed: string[] = []
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) missed.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function signIn(email: string, admin = false): Promise<{ uid: string; token: string }> {
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (admin) {
    const look = await fetch(`${AUTH}/accounts:lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }),
    })
    const { users } = (await look.json()) as { users: { localId: string }[] }
    await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
    })
  }
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}
/** 문서 몇 칸을 고친다 — 불변식을 깨뜨리려고 */
async function patch(game: string, path: string, fields: Record<string, unknown>): Promise<void> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? { integerValue: String(v) }
    : typeof v === 'boolean' ? { booleanValue: v }
    : v === null ? { nullValue: null }
    : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, enc(x)])) } }
    : { stringValue: String(v) }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/games/${game}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`patch ${path}: ${r.status}`)
}

/** 열넷을 앉히고 일을 몇 가지 일으킨 판 하나. 금고 하나는 음수로 깨 둔다 */
async function setUp(): Promise<string> {
  const GAME = `ql${Date.now().toString(36).slice(-5)}`
  const host = (await signIn(`h-${GAME}@x.test`, true)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'ql' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < want.length; i++) {
    const a = await signIn(`p${i}-${GAME}@x.test`)
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: NAMES[i], team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })
  const t = dayHourMs(START, 1, 10)
  await clock(t)
  const other = TILE_IDS.find((x) => x !== START_TILE && canRoamTo(START_TILE as never, x)) as string
  await must('roamTo', people[2].token, { gameId: GAME, tileId: other })
  await must('roamTo', people[3].token, { gameId: GAME, tileId: other })
  await clock(t + 5 * 60_000)
  await must('hostScatterRandom', host, { gameId: GAME, n: 3 })
  await must('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: other, text: '복도 끝 자판기 뒤를 봐라' })
  await clock(t + 12 * 60_000)
  await must('hostOpenBallot', host, { gameId: GAME })
  await must('castBallot', people[0].token, { gameId: GAME, targetId: people[1].uid })
  await must('castBallot', people[4].token, { gameId: GAME, targetId: people[1].uid })
  await must('hostNotice', host, { gameId: GAME, text: '오늘 첫 페이즈는 열한 시다.' })
  await clock(t + 20 * 60_000)
  await must('openPhase', host, { gameId: GAME })
  await clock(t + 30 * 60_000)
  await must('closePhase', host, { gameId: GAME })
  await clock(t + 40 * 60_000)
  // 띠가 뜨게 — A팀 금고를 음수로
  await patch(GAME, 'teams/A', { resources: { money: -3, knowledge: 0 } })
  return GAME
}

/** 화면이 옆으로 밀리는가 · 탭이 두 줄로 접히는가 */
async function layout(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bad: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth + 1) bad.push(`문서 ${de.scrollWidth}>${de.clientWidth}`)
    const ad = document.querySelector('.sc-ad') as HTMLElement | null
    if (ad && ad.scrollWidth > ad.clientWidth + 1) bad.push(`책상 ${ad.scrollWidth}>${ad.clientWidth}`)
    for (const el of Array.from(document.querySelectorAll('.sc-ad__tabs button'))) {
      const b = el as HTMLElement
      const r = b.getBoundingClientRect()
      if (r.right > window.innerWidth + 1) bad.push(`탭 ${b.textContent} → ${Math.round(r.right)}`)
      if (b.scrollWidth > b.clientWidth + 1) bad.push(`탭 ${b.textContent} 글자 잘림`)
      if (r.height > 48) bad.push(`탭 ${b.textContent} 두 줄 ${Math.round(r.height)}`)
    }
    for (const el of Array.from(document.querySelectorAll('.sc-lg *'))) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        bad.push(`${(el as HTMLElement).className || el.tagName} → ${Math.round(r.right)}`)
        if (bad.length > 6) break
      }
    }
    return bad.join(' · ')
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const GAME = await setUp()
  console.log(`판 ${GAME}`)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: SIZE.w, height: SIZE.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  const shot = async (name: string) => {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/qa-log-${name}.png` })
    console.log(`  찍었다 qa-log-${name}.png`)
  }

  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await page.locator('.sc-gt__vend').click()
  await page.waitForSelector('#gt-code')
  await page.fill('#gt-code', hostCode())
  await page.locator('.sc-gt__submit').click()
  await page.waitForSelector('.sc-ad__tabs', { timeout: 20_000 })
  const tabs = await page.locator('.sc-ad__tabs button').count()
  check(tabs === 9, '탭이 아홉', String(tabs))
  check((await layout(page)) === '', '탭 아홉이 375px 한 줄에 선다', await layout(page))
  await page.locator('.sc-ad__tabs button', { hasText: '로그' }).click()
  await page.waitForSelector('.sc-lg__row', { timeout: 20_000 })
  await page.waitForSelector('.sc-lg__alarm', { timeout: 20_000 })

  // ① 빨간 띠 — 금고 음수 한 건
  const badN = await page.locator('.sc-lg__bad li').count()
  check(badN === 1, '어긋남 한 건이 띠에 뜬다', String(badN))
  const badText = await page.locator('.sc-lg__alarm').innerText()
  check(badText.includes('금고가 음수다') && badText.includes('직전'), '띠에 종류 · 자세히 · 직전 로그가 있다', badText.replace(/\n/g, ' | ').slice(0, 120))
  check((await layout(page)) === '', '띠가 옆으로 안 밀린다', await layout(page))
  await shot('375-1-violations')

  // ② 시각순 목록 — 아래로 내려 본다
  const rows = await page.locator('.sc-lg__row').count()
  check(rows >= 15, '줄이 열다섯 넘게 있다', String(rows))
  const texts = await page.locator('.sc-lg__row span').allInnerTexts()
  check(texts.some((t) => t.includes('페이즈 1 열림')) && texts.some((t) => t.includes('페이즈 1 닫힘')), '페이즈 열림 · 닫힘이 보인다')
  check(texts.some((t) => t.includes('표 적음')) && !texts.some((t) => t.includes('투명인간 표 적음') && t.includes(NAMES[1])), '표 적음은 적은 사람만')
  check(!texts.some((t) => t.includes('자판기 뒤')), '메모 문안은 없다')
  const times = await page.locator('.sc-lg__row time').allInnerTexts()
  check(times.every((t) => /D\d+\s*\d{2}:\d{2}:\d{2}/.test(t.replace(/\n/g, ' '))), 'DAY 와 HH:mm:ss 가 붙어 있다', times[0])
  await page.locator('.sc-lg__list').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 60))
  await shot('375-2-list')

  // ③ 종류 칩으로 거른다 · 사람으로 거른다
  await page.locator('.sc-lg__chips button', { hasText: '쪽지 뿌림' }).click()
  const only = await page.locator('.sc-lg__row').count()
  check(only === 3, '「쪽지 뿌림」만 남는다', String(only))
  await page.locator('.sc-lg__chips button', { hasText: '전부' }).click()
  await page.locator('.sc-lg__bar select').selectOption({ label: NAMES[2] })
  const mine = await page.locator('.sc-lg__row span').allInnerTexts()
  check(mine.length > 0 && mine.every((t) => t.includes(NAMES[2])), `${NAMES[2]} 줄만 남는다`, `${mine.length}줄`)
  await page.locator('.sc-lg__bar select').selectOption({ label: '모두' })
  await page.fill('#lg-search', '페이즈')
  const found = await page.locator('.sc-lg__row').count()
  check(found >= 2, '찾기가 먹는다', String(found))
  await page.locator('.sc-lg__chips').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 60))
  await shot('375-3-filter')
  await page.fill('#lg-search', '')

  // ④ 따라가기 — 켜고 서버에 일을 하나 더 일으키면 3초 안에 붙는다
  await page.locator('.sc-lg__follow').click()
  const before = await page.locator('.sc-lg__row').count()
  const host = (await signIn(`h-${GAME}@x.test`, true)).token
  await must('hostDrop', host, { gameId: GAME, kind: 'memo', tileId: START_TILE, text: '따라가기 시험' })
  await page.waitForFunction((n) => document.querySelectorAll('.sc-lg__row').length > n, before, { timeout: 12_000 })
  // 로비 때(실제 시각) 적힌 줄은 게임 시각보다 뒤라 맨 끝에 흐리게 선다 — 그 앞이 「지금」의 끝이다
  const last = await page.locator('.sc-lg__row:not(.is-future)').last().innerText()
  check(last.includes('메모 놓음'), '새 줄이 끝에 붙는다', last.replace(/\n/g, ' '))
  check((await layout(page)) === '', '끝까지 옆으로 안 밀린다', await layout(page))
  await shot('375-4-follow')

  await ctx.close()
  await browser.close()
  if (missed.length) {
    console.log('\n놓친 것:')
    for (const x of missed) console.log(`  ✗ ${x}`)
    process.exitCode = 1
  } else console.log('\n전부 통과')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
