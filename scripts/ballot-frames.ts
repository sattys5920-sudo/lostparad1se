// 접히는 1.4초를 한 장씩 뜯어낸다.
//
// 화면을 찍는 보통 방법(screenshot)은 한 장에 100ms 쯤 걸려서 1.4초
// 짜리 연출을 대여섯 장밖에 못 건진다. **브라우저가 다시 그릴 때마다
// 한 장씩 흘려보내게(Page.startScreencast)** 하면 그린 만큼 다 받는다 —
// 프레임을 끊어서 넘기는 연출이라, 받은 장수가 곧 그린 장수다.
//
//   npx vite-node scripts/ballot-frames.ts
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/frames'

const MY_PW = 'ballot-frame-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }

async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
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
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

async function safeNames(gameId: string, meAccountId: string): Promise<string[]> {
  const meId = uidOf(meAccountId)
  type Val = { stringValue?: string; mapValue?: { fields: Record<string, Val> }; arrayValue?: { values?: Val[] } }
  const teams = (await (await fetch(`${FS}/games/${gameId}/teams`, { headers: ADMIN })).json()) as {
    documents?: { fields?: Record<string, Val> }[]
  }
  const captains = new Set(
    (teams.documents ?? []).map((d) => d.fields?.captainId?.stringValue ?? '').filter((x) => x !== ''),
  )
  const game = (await (await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })).json()) as { fields?: Record<string, Val> }
  const out: string[] = []
  for (const s of game.fields?.seats?.arrayValue?.values ?? []) {
    const id = s.mapValue?.fields.playerId?.stringValue ?? ''
    const name = s.mapValue?.fields.name?.stringValue ?? ''
    if (id === meId || captains.has(id) || name === '') continue
    out.push(name)
  }
  return out
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const tag = `fr${Date.now()}`
  const game = `bq${tag}`
  const me = `bq${String(Date.now()).slice(-6)}`

  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'bq' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await asPlayer(host, me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: SEED_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })
  const names = await safeNames(game, me)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.locator('.sc-ct__tab').nth(3).click()
  await page.waitForTimeout(900)
  await page.locator('.sc-bt__name > span').filter({ hasText: new RegExp(`^${names[1]}$`) }).first().click()
  await page.waitForTimeout(600)

  // 그릴 때마다 한 장씩 받는다
  const cdp = await page.context().newCDPSession(page)
  const shots: { at: number; png: string }[] = []
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    shots.push({ at: (f.metadata.timestamp ?? 0) * 1000, png: f.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId })
  })
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 390, maxHeight: 844, everyNthFrame: 1 })
  await page.waitForTimeout(400)
  const mark = shots.length
  await page.locator('.sc-bt__go').click()
  await page.waitForTimeout(3600)
  await cdp.send('Page.stopScreencast')

  // 단추를 누른 뒤의 것만 남긴다
  const take = shots.slice(Math.max(0, mark - 1))
  const t0 = take[0]?.at ?? 0
  const list: { file: string; ms: number }[] = []
  for (const [i, f] of take.entries()) {
    const file = `${OUT}/f${String(i).padStart(3, '0')}.png`
    writeFileSync(file, Buffer.from(f.png, 'base64'))
    list.push({ file, ms: Math.round(f.at - t0) })
  }
  writeFileSync(`${OUT}/frames.json`, JSON.stringify(list, null, 1))
  console.log(JSON.stringify({ 장수: list.length, 길이ms: list[list.length - 1]?.ms ?? 0 }))
  await browser.close()
  console.log('뜯었다')
}

void main()
