// 공지 팝업 · 1위 발표 · 운영자 발표/공지/투명 풀기 칸을 찍는다.
//
//   1. 에뮬레이터 · 에뮬레이터용 사이트(:8899)
//   2. npx vite-node scripts/notice-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)


let bad = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false as const, err: j.error.message } : { ok: true as const, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown) {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result
}

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

const tokenFor = (host: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 내 몫. **운영자 열쇠로 읽는다** — 규칙은 본인에게만 열어 준다 */
async function viewOf(game: string, uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}/views/${uid}`, { headers: ADMIN })
  if (!r.ok) throw new Error(`view ${r.status}`)
  const j = (await r.json()) as { fields?: Record<string, unknown> }
  return j.fields ?? {}
}

/** 배열 칸 하나를 평범한 값으로. Firestore REST 는 죄다 싸서 준다 */
function arr(f: unknown): Record<string, unknown>[] {
  const v = (f as { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } })?.arrayValue
  return (v?.values ?? []).map((x) => x.mapValue?.fields ?? {})
}
const str = (f: unknown): string | null => (f as { stringValue?: string })?.stringValue ?? null



async function gameDoc(game: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  return ((await r.json()) as { fields: Record<string, unknown> }).fields
}
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`patch ${path} ${r.status}`)
}
const own = (game: string, tile: string, team: string) => patch(`games/${game}/tiles/${tile}`, { ownerTeam: { stringValue: team } })
const noticesOf = async (game: string, uid: string) => arr((await viewOf(game, uid)).notices).map((n) => ({ text: str(n.text) ?? '', leader: arr(n.leader).length > 0 || JSON.stringify(n.leader ?? '').includes('A') ? n.leader : undefined }))


function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/noticeshots'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bad: string[] = []
  const game = `ns${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'ns' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 14), speed: 1 })
  await own(game, 'library', 'A')
  await own(game, 'gym', 'A')
  await own(game, 'storage', 'B')
  const meTok = await tok('qa01')
  await call('markPrologueSeen', meTok, {})
  await call('markMorning', meTok, { gameId: game, read: [1] })
  const seats = arr((await gameDoc(game)).seats).map((s) => ({ id: str(s.playerId) as string }))
  await patch(`games/${game}`, { invisibleId: { stringValue: seats[5].id }, invisibleTeam: { stringValue: 'B' } })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const pl = await pctx.newPage()
  pl.on('pageerror', (e) => bad.push(`플레이어 터짐: ${e.message}`))
  await pl.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await pl.fill('#gt-id', 'qa01')
  await pl.fill('#gt-pw', QA_PW)
  await pl.click('.sc-gt__submit')
  await pl.waitForSelector('.sc-ct__tab', { timeout: 30000 }).catch(() => bad.push('탭이 안 나온다'))
  await pl.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await pl.waitForTimeout(2000)
  // 처음 들어온 사람에게 이미 쌓인 공지가 뜨면 닫아 둔다
  if ((await pl.locator('.sc-ntc').count()) > 0) await pl.locator('.sc-ntc__ok').click()

  await must('hostAnnounceLeader', host, { gameId: game })
  const came = await pl.waitForSelector('.sc-ntc', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!came) bad.push('1위 발표 팝업이 안 떴다')
  await pl.waitForTimeout(800)
  await pl.screenshot({ path: `${OUT}/1-1위발표.png` })
  if (came) await pl.locator('.sc-ntc__ok').click()
  await pl.waitForTimeout(500)
  if ((await pl.locator('.sc-ntc').count()) > 0) bad.push('확인을 눌러도 안 닫힌다')

  await must('hostNotice', host, { gameId: game, text: '기록을 다시 읽어 보세요.', toPlayerId: null })
  await pl.waitForSelector('.sc-ntc', { timeout: 15000 }).catch(() => bad.push('공지 팝업이 안 떴다'))
  await pl.waitForTimeout(800)
  await pl.screenshot({ path: `${OUT}/2-공지.png` })
  await pl.locator('.sc-ntc__ok').click().catch(() => undefined)

  await pl.reload({ waitUntil: 'domcontentloaded' })
  await pl.waitForTimeout(4000)
  if ((await pl.locator('.sc-ntc').count()) > 0) bad.push('새로고침하니 본 공지가 또 뜬다')
  await pl.locator('.sc-ct__tab', { hasText: '나' }).first().click()
  await pl.waitForTimeout(1500)
  const card = pl.locator('.sc-mi__card').filter({ has: pl.locator('h3', { hasText: /^공 지$/ }) })
  if ((await card.count()) === 0) bad.push('나 탭에 공지 칸이 없다')
  else {
    await card.first().evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await pl.waitForTimeout(1500)
    await pl.screenshot({ path: `${OUT}/3-나탭-공지.png` })
  }

  const actx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR' })
  const ad = await actx.newPage()
  ad.on('pageerror', (e) => bad.push(`운영자 터짐: ${e.message}`))
  await ad.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await ad.waitForSelector('.sc-gt__title', { timeout: 20000 })
  await ad.locator('.sc-gt__vend').click()
  await ad.waitForSelector('#gt-code')
  await ad.fill('#gt-code', hostCode())
  await ad.locator('.sc-gt__submit').click()
  await ad.waitForSelector('.sc-ad__tabs', { timeout: 20000 })
  await ad.locator('.sc-ad__tabs button', { hasText: '진행' }).click()
  await ad.waitForSelector('.sc-nd', { timeout: 20000 }).catch(() => bad.push('운영자 공지 칸이 없다'))
  await ad.waitForTimeout(1500)
  const ballot = ad.locator('.sc-ad__sec', { hasText: '투명인간 투표' })
  await ballot.scrollIntoViewIfNeeded()
  await ballot.screenshot({ path: `${OUT}/4-운영자-투명풀기.png` })
  const nd = ad.locator('.sc-ad__sec', { hasText: '발표 · 공지' })
  await nd.screenshot({ path: `${OUT}/5-운영자-발표공지.png` })

  await browser.close()
  console.log('어긋남', JSON.stringify(bad))
}

void main()
