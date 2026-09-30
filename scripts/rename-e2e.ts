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
const OUT = '/tmp/claude-0/renameshots'

async function login(browser: Awaited<ReturnType<typeof chromium.launch>>, game: string, id: string, bad: string[]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const pl = await ctx.newPage()
  pl.on('pageerror', (e) => bad.push(`${id} 터짐: ${e.message}`))
  await pl.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await pl.fill('#gt-id', id)
  await pl.fill('#gt-pw', QA_PW)
  await pl.click('.sc-gt__submit')
  return pl
}

// 이름 바꾸기 — 나 탭에서 바꾸면 자리 이름이 바뀌고, 남과 같은 이름은 거절된다
async function main() {
  mkdirSync(OUT, { recursive: true })
  const bad: string[] = []
  const check = (ok: boolean, what: string, detail = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`)
    if (!ok) bad.push(what)
  }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const game = `rn${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'rn' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 14), speed: 1 })
  const meTok = await tok('qa01')
  await call('markPrologueSeen', meTok, {})
  await call('markMorning', meTok, { gameId: game, read: [1] })

  const seatsOf = async () => arr((await gameDoc(game)).seats).map((s) => ({ id: str((s as Record<string, unknown>).playerId) ?? '', name: str((s as Record<string, unknown>).name) ?? '' }))
  const before = await seatsOf()
  const myUid = String(JSON.parse(Buffer.from(meTok.split('.')[1], 'base64url').toString()).user_id)
  const other = before.find((x) => x.id !== myUid)?.name ?? ''

  // 서버 — 남과 같은 이름(띄어쓰기만 다른 것 포함)은 거절
  const dup = await call('renameMe', meTok, { gameId: game, name: ` ${other.split('').join(' ')} ` })
  check(!dup.ok && /같은 이름/.test(String(dup.err)), '남과 같은 이름은 거절', String(dup.err))
  const long = await call('renameMe', meTok, { gameId: game, name: '가'.repeat(13) })
  check(!long.ok, '13 자는 거절', String(long.err))

  // 화면 — 나 탭에서 바꾼다
  const pl = await login(browser, game, 'qa01', bad)
  await pl.waitForSelector('.sc-ct__tab', { timeout: 30000 }).catch(() => bad.push('탭이 안 나온다'))
  await pl.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await pl.waitForTimeout(1500)
  if ((await pl.locator('.sc-ntc').count()) > 0) await pl.locator('.sc-ntc__ok').click()
  await pl.locator('.sc-ct__tab', { hasText: '나' }).first().click()
  await pl.waitForSelector('.sc-mi__idcard', { timeout: 15000 })
  const btn = pl.locator('.sc-mi__link button', { hasText: '이름 바꾸기' })
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await pl.fill('#me-rename', '새이름')
  await pl.locator('.sc-mi__rename').screenshot({ path: `${OUT}/1-칸.png` })
  await pl.locator('.sc-mi__rename button[type=submit]').click()
  await pl.waitForTimeout(2500)
  const after = await seatsOf()
  const mine = after.find((s) => s.name === '새이름')
  check(Boolean(mine), '자리 이름이 바뀌었다', JSON.stringify(after.slice(0, 2)))
  check(after.filter((s) => s.name === '새이름').length === 1, '다른 자리는 그대로')
  await pl.locator('.sc-mi__idcard').scrollIntoViewIfNeeded()
  await pl.waitForTimeout(800)
  const card = await pl.locator('.sc-mi__who b').first().textContent()
  check(card === '새이름', '학생증 이름이 바로 바뀐다', String(card))
  await pl.screenshot({ path: `${OUT}/2-학생증.png` })
  await browser.close()
  console.log('어긋남', JSON.stringify(bad))
  if (bad.length) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
