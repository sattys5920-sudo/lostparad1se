// 로봇 — 페이즈 중에 사람이 실제로 보는 화면.
//
//   ㆍ 행동 시트: 로봇 놓기 · 로봇 수거 · 로봇 부수기, 들고 있는 것 / 이 방에 놓인 것
//   ㆍ 놓으면 맵의 방에 팀색 로봇이 선다(든 것은 안 그린다)
//   ㆍ 수거는 내가 놓은 것만 — 남이 놓은 것은 부수기로만
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve --emptyOutDir
//   3. (cd /tmp/claude-0/serve && python3 -m http.server 8899)
//   4. npx vite-node scripts/robot-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { standAndSpot } from './lib/spot'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const W = Number(process.env.W ?? 390)
const H = Number(process.env.H ?? 844)
const ROOM = 'library'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function must(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

async function hostToken(tag: string): Promise<string> {
  const email = `robot-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

const int = (n: number) => ({ integerValue: String(n) })
async function patch(path: string, fields: Record<string, unknown>) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
}

const str = (s: string | null) => (s === null ? { nullValue: null } : { stringValue: s })
async function bot(game: string, id: string, team: string, carriedBy: string | null, placedBy: string | null) {
  await patch(`games/${game}/robots/${id}`, {
    id: str(id), team: str(team), tileId: str(ROOM), carriedBy: str(carriedBy), placedBy: str(placedBy),
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const game = `rs${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'rs' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const me = uidOf('qa01')
  const pawn = (await fetch(`${FS}/games/${game}/pawns/${me}`, { headers: ADMIN }).then((r) => r.json())) as { fields: { team: { stringValue: string } } }
  const team = pawn.fields.team.stringValue
  const enemy = ['A', 'B', 'C', 'D'].find((t) => t !== team) as string
  console.log(`판 ${game} · qa01 은 ${team}팀`)

  const { stand } = standAndSpot(ROOM)
  await patch(`games/${game}/pawns/${me}`, {
    tileId: str(ROOM),
    postTile: str(ROOM),
    at: { mapValue: { fields: { x: int(stand.x), y: int(stand.y) } } },
    visitedTiles: { arrayValue: { values: [str('centralPlaza'), str(ROOM)] } },
  })
  // 나는 두 기를 들고 있다. 방에는 다른 분단이 놓은 로봇이 분단마다 한 기씩
  await bot(game, 'bot-m1', team, me, null)
  await bot(game, 'bot-m2', team, me, null)
  const others = ['A', 'B', 'C', 'D'].filter((t) => t !== team)
  for (const [i, t] of others.entries()) await bot(game, `bot-e${i + 1}`, t, null, `someone-${t}`)
  // 부수려면 드라이버가 있어야 한다
  await patch(`games/${game}/pawns/${me}`, { items: { mapValue: { fields: { screwdriver: int(1) } } } })
  await must('openPhase', host, { gameId: game })
  await must('tick', host, { gameId: game })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
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
  await page.waitForTimeout(2000)
  const tag = `robot-${W}`
  await page.screenshot({ path: `${OUT}/${tag}-1-맵-남의로봇.png` })

  await page.locator('button', { hasText: /^깃발$/ }).first().click()
  await page.waitForSelector('.sc-ph', { timeout: 5000 })
  await page.waitForTimeout(500)
  const row = (label: string) => page.locator('.sc-ph__list li', { hasText: label })
  const noteOf = () => page.locator('.sc-ph__note', { hasText: '들고 있는 것' }).innerText()
  /** 서버가 view 를 다시 쓸 때까지 — 고정으로 기다리면 느린 판에서 한 박자 늦게 잰다 */
  const until = async (want: RegExp) => {
    for (let i = 0; i < 40; i++) {
      if (want.test(await noteOf())) return
      await page.waitForTimeout(250)
    }
  }
  await row('로봇 놓기').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${tag}-2-시트.png` })
  const takeWhy = await row('로봇 수거').innerText()
  if (!takeWhy.includes('내가 놓은 로봇이 없다')) missed.push(`수거 사유가 이상하다: ${takeWhy}`)

  await row('로봇 놓기').locator('button').first().click()
  await until(/들고 있는 것\s*1\/2/)
  await page.waitForTimeout(300)
  await row('로봇 놓기').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${tag}-3-놓음.png` })
  const note = await page.locator('.sc-ph__note', { hasText: '들고 있는 것' }).innerText()
  console.log(`  놓은 뒤: ${note.replace(/\n/g, ' ')}`)
  if (!note.includes('1/2') || !note.includes('2/2')) missed.push(`놓은 뒤 수가 이상하다: ${note}`)

  await row('로봇 수거').locator('button').first().click()
  await until(/들고 있는 것\s*2\/2/)
  const after = await page.locator('.sc-ph__note', { hasText: '들고 있는 것' }).innerText()
  console.log(`  거둔 뒤: ${after.replace(/\n/g, ' ')}`)
  if (!after.includes('2/2')) missed.push(`거둔 뒤 든 수가 2가 아니다: ${after}`)
  await row('로봇 놓기').locator('button').first().click()
  await until(/들고 있는 것\s*1\/2/)

  await row('로봇 부수기').locator('button').first().click()
  await page.waitForTimeout(400)
  await row('로봇 부수기').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${tag}-4-부수기고르기.png` })
  const targets = await page.locator('.sc-ph__targets').innerText()
  if (!targets.includes(enemy)) missed.push(`부수기 대상이 이상하다: ${targets}`)

  await page.locator('button', { hasText: /^닫기$/ }).first().click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${tag}-5-맵-놓인로봇.png` })

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
