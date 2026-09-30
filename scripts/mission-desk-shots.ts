// 운영자 「미션」 탭 — 목록 · 편 줄 · 뒤집기 · 받을 모습 · 기록을 폰 두 크기로.
//
// 열넷을 앉히고 DAY 1 · DAY 2 를 넘겨서 판정을 두 날 쌓은 뒤에 연다.
// DAY 2 에 주번 · 모범생의 기록을 전날과 다르게 심어 「전날 대비」가 찍히게 한다.
// 화면에서 진짜로 뒤집고 보낸다 — 캡처는 손가락이 가는 길 그대로다.
//
//   1. cd functions && npm run build   (에뮬레이터가 떠 있어야 한다)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-mk --emptyOutDir
//   3. python3 -m http.server 8904 --bind 127.0.0.1 --directory /tmp/claude-0/serve-mk
//   4. npx vite-node scripts/mission-desk-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8904'
const OUT = '/tmp/claude-0/shots'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
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
function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  return o
}
async function plant(game: string, path: string, fields: Record<string, unknown>): Promise<void> {
  const enc = (v: unknown): unknown =>
    typeof v === 'number' ? { integerValue: String(v) }
    : typeof v === 'boolean' ? { booleanValue: v }
    : v === null ? { nullValue: null }
    : { stringValue: String(v) }
  const r = await fetch(`${FS}/games/${game}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`심기 실패 ${path}: ${r.status}`)
}

/** 열넷을 앉히고 DAY 1 · 2 를 판정까지 넘긴 판 하나 */
async function setUp(tag: string): Promise<string> {
  const GAME = `mk${tag}${Date.now().toString(36).slice(-4)}`
  const host = (await signIn(`h-${GAME}@x.test`, true)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'mk' })
  const people: { uid: string; token: string; team: TeamId }[] = []
  for (let i = 0; i < want.length; i++) {
    const a = await signIn(`p${i}-${GAME}@x.test`)
    people.push({ ...a, team: want[i] })
    await must('joinGame', a.token, { gameId: GAME, name: NAMES[i], team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  const clock = (ms: number) => must('setDevClock', host, { gameId: GAME, anchorGameMs: ms, speed: 1 })

  const roster = plain(await (await fetch(`${FS}/games/${GAME}/secret/roster/items?pageSize=50`, { headers: ADMIN })).json()) as unknown as {
    documents?: Record<string, unknown>[]
  }
  const rows = (roster.documents ?? []).map((d) => plain(d) as { playerId: string; roleId: string; team: TeamId })
  const who = (role: string) => rows.find((r) => r.roleId === role)
  const duty = who('duty')
  const model = who('model')
  const errand = async (atMs: number) => {
    if (duty) await plant(GAME, 'secret/records/items', { kind: 'errandDone', atMs, actorId: duty.playerId, actorTeam: duty.team })
  }
  const trust = async (d: number, atMs: number, k: number) => {
    if (!model) return
    const voters = people.filter((p) => p.team !== model.team).slice(0, k)
    for (const v of voters) {
      await plant(GAME, 'secret/votes/items', {
        day: d, voterId: v.uid, voterTeam: v.team, targetId: model.playerId, targetTeam: model.team, kind: 'trust', castAtMs: atMs, settled: false,
      })
    }
  }
  const pushTo = async (kind: string, d: number) => {
    for (let i = 0; i < 20; i++) {
      const r = (await must('pushDay', host, { gameId: GAME })) as { pushed: { kind: string; day: number } | null }
      if (!r.pushed || (r.pushed.kind === kind && r.pushed.day === d)) return
    }
  }

  const d1 = dayHourMs(START, 1, 12)
  await clock(d1)
  await errand(d1 - 3000)
  await errand(d1 - 2000)
  await trust(1, d1 - 1000, 1)
  await pushTo('dayStart', 2)

  const d2 = dayHourMs(START, 2, 12)
  await clock(d2)
  await errand(d2 - 2000)
  await trust(2, d2 - 1000, 3)
  await pushTo('dayStart', 3)
  const out = await must('hostMissionDay', host, { gameId: GAME })
  console.log(`${tag}: 판 ${GAME} · 판정한 날 ${(out.days as { day: number }[]).map((d) => d.day).join(',')}`)
  return GAME
}

/** 화면이 옆으로 밀리는가. 문서와 책상 둘 다 본다 */
async function sideways(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bad: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth + 1) bad.push(`문서 ${de.scrollWidth}>${de.clientWidth}`)
    const ad = document.querySelector('.sc-ad') as HTMLElement | null
    if (ad && ad.scrollWidth > ad.clientWidth + 1) bad.push(`책상 ${ad.scrollWidth}>${ad.clientWidth}`)
    // 화면 밖으로 삐져나간 것
    for (const el of Array.from(document.querySelectorAll('.sc-md *, .sc-ad__tabs *'))) {
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const s of SIZES) {
    const tag = String(s.w)
    const GAME = await setUp(tag)
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${tag} 터짐: ${e.message}`))
    const shot = async (name: string) => {
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${OUT}/mk-${tag}-${name}.png` })
      console.log(`  찍었다 mk-${tag}-${name}.png`)
    }

    await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
    await page.locator('.sc-gt__vend').click()
    await page.waitForSelector('#gt-code')
    await page.fill('#gt-code', hostCode())
    await page.locator('.sc-gt__submit').click()
    await page.waitForSelector('.sc-ad__tabs', { timeout: 20_000 })
    await page.locator('.sc-ad__tabs button', { hasText: '미션' }).click()
    await page.waitForSelector('.sc-md__row', { timeout: 20_000 })

    // ① 목록
    const n = await page.locator('.sc-md__row').count()
    check(n === 14, `${tag}: 열넷이 한 줄씩`, String(n))
    check((await page.locator('.sc-md__days button').count()) === 2, `${tag}: 날 탭이 둘(DAY 1 · 2)`)
    check((await sideways(page)) === '', `${tag}: 목록이 옆으로 안 밀린다`, await sideways(page))
    await shot('1-list')

    // ② 편 줄 — 주번이 있으면 주번(전날 대비가 찍힌다)
    const duty = page.locator('.sc-md__row', { hasText: '주번' }).first()
    const row = (await duty.count()) ? duty : page.locator('.sc-md__row').first()
    await row.locator('.sc-md__toggle').click()
    await row.scrollIntoViewIfNeeded()
    const deltas = (await row.locator('.sc-md__delta').allInnerTexts()).filter(Boolean)
    check(deltas.length > 0, `${tag}: 전날 대비가 찍힌다`, deltas.join(' '))
    await row.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 120))
    await shot('2-row')
    check((await sideways(page)) === '', `${tag}: 편 줄이 옆으로 안 밀린다`, await sideways(page))

    // ③ 뒤집기 칸
    await row.locator('.sc-md__body button', { hasText: '뒤집기' }).click()
    await row.locator('.sc-md__to button', { hasText: '실패' }).click()
    check(await row.locator('.sc-md__do').isDisabled(), `${tag}: 까닭 없이는 못 누른다`)
    await row.locator('.sc-md__form textarea').fill('심부름 한 번은 같은 팀이 대신 했다')
    await row.locator('.sc-md__form').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await shot('3-override')
    await row.locator('.sc-md__do').click()
    await page.waitForSelector('.sc-ad__said', { timeout: 10_000 })
    await row.locator('.sc-md__flip').waitFor({ timeout: 10_000 })
    check((await row.locator('.sc-md__flip').count()) === 1, `${tag}: 뒤집음 표시가 뜬다`)
    await page.locator('.sc-ad__said').click()

    // ④ 받을 모습 — 한 사람
    await row.locator('.sc-md__body button', { hasText: '보내기' }).click()
    await page.waitForSelector('.sc-md__sheet .sc-md__mail')
    const result = await page.locator('.sc-md__sheet .sc-md__result').innerText()
    check(result === '끝났다', `${tag}: 뒤집은 결과가 받을 모습에 간다`, result)
    const sheetText = await page.locator('.sc-md__sheet').innerText()
    check(!sheetText.includes('같은 팀이 대신'), `${tag}: 까닭은 받을 모습에 없다`)
    await shot('4-preview')
    await page.locator('.sc-md__sheet .sc-md__do').click()
    await page.waitForSelector('.sc-md__sheet', { state: 'detached' })
    await row.locator('.sc-md__sent', { hasText: '보냄' }).waitFor({ timeout: 10_000 })

    // 보낸 뒤에 되돌린다 — 「다시 보내야」가 떠야 한다
    await row.locator('.sc-md__body button', { hasText: '뒤집기' }).click()
    await row.locator('.sc-md__to button', { hasText: '되돌리기' }).click()
    await row.locator('.sc-md__form textarea').fill('다시 보니 본인이 했다')
    await row.locator('.sc-md__do').click()
    await row.locator('.sc-md__sent.is-stale').waitFor({ timeout: 10_000 })
    check(true, `${tag}: 보낸 뒤 뒤집으면 「다시 보내야」`)
    await page.locator('.sc-ad__said').click().catch(() => undefined)
    await row.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 120))
    await shot('3b-stale')

    // 고른 사람 · 전부 — 확인 시트
    await page.locator('.sc-md__row').nth(1).locator('.sc-md__pick input').check()
    await page.locator('.sc-md__row').nth(2).locator('.sc-md__pick input').check()
    await page.locator('.sc-md__send button', { hasText: '고른 2 명' }).click()
    await page.waitForSelector('.sc-md__peek')
    check((await page.locator('.sc-md__peek > li').count()) === 2, `${tag}: 고른 둘만 확인에 뜬다`)
    await page.locator('.sc-md__veil').click({ position: { x: 10, y: 10 } })
    await page.locator('.sc-md__send button', { hasText: '전부 보내기' }).click()
    await page.waitForSelector('.sc-md__peek')
    await page.locator('.sc-md__peek > li button').nth(1).click()
    await shot('4b-send-all')
    await page.locator('.sc-md__sheet .sc-md__do').click()
    await page.waitForSelector('.sc-md__sheet', { state: 'detached' })
    await page.waitForTimeout(800)
    const unsent = await page.locator('.sc-md__chips button', { hasText: '안 보냄' }).innerText()
    check(/안 보냄 0/.test(unsent), `${tag}: 전부 보낸 뒤 안 보냄 0`, unsent)

    // ⑤ 기록 — 알림 한 줄이 아래를 가리지 않게 먼저 닫는다
    await page.locator('.sc-ad__said').click().catch(() => undefined)
    await page.locator('.sc-md__log').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    const logN = await page.locator('.sc-md__log li').count()
    check(logN === 4, `${tag}: 기록 넷(뒤집음 · 보냄 · 되돌림 · 전부)`, String(logN))
    await shot('5-log')
    check((await sideways(page)) === '', `${tag}: 기록까지 옆으로 안 밀린다`, await sideways(page))

    // 날을 옮긴다 — DAY 1 은 전날이 없다
    await page.locator('.sc-md__days button', { hasText: 'DAY 1' }).click()
    await page.waitForSelector('.sc-md__row')
    await page.locator('.sc-md__row').first().locator('.sc-md__toggle').click()
    const d1delta = (await page.locator('.sc-md__row').first().locator('.sc-md__delta').allInnerTexts()).filter(Boolean)
    check(d1delta.length === 0, `${tag}: DAY 1 은 전날 대비가 없다`)
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop = 0))
    await shot('6-day1')

    await ctx.close()
  }

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
