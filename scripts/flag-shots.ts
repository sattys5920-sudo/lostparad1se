// 깃발 점령 — 페이즈 중에 사람이 실제로 보는 화면.
//
//   ㆍ 「깃발」 단추 → 행동 시트: 팀 토큰 · 팀 깃발 · 이 방 깃발 · 꽂기/뽑기
//   ㆍ 꽂고 나서 이 방 깃발 수가 바뀌는가
//
// 판을 차리는 것은 손으로 한다 — 그 방에 선 자리와 꽂혀 있는 깃발을
// 서버 문서에 직접 적는다. 꽂기·뽑기가 맞게 도는지는 phase-e2e 가 본다.
//
//   1. cd functions && npm run build
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se --emptyOutDir
//   3. npx vite-node scripts/flag-shots.ts        (W=375 H=667 로 작은 화면)
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
const SITE = 'http://127.0.0.1:8899/lostparad1se'
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
  const email = `flag-${tag}@x.test`
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

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const game = `fl${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'fl' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })

  const me = uidOf('qa01')
  const pawn = (await fetch(`${FS}/games/${game}/pawns/${me}`, { headers: ADMIN }).then((r) => r.json())) as { fields: { team: { stringValue: string } } }
  const team = pawn.fields.team.stringValue
  const other = ['A', 'B', 'C', 'D'].filter((t) => t !== team)
  console.log(`판 ${game} · qa01 은 ${team}팀`)

  // qa01 을 도서관에 세우고(전선도 거기), 호루라기 하나를 쥐여 준다
  const { stand } = standAndSpot(ROOM)
  await patch(`games/${game}/pawns/${me}`, {
    tileId: { stringValue: ROOM },
    postTile: { stringValue: ROOM },
    at: { mapValue: { fields: { x: int(stand.x), y: int(stand.y) } } },
    visitedTiles: { arrayValue: { values: [{ stringValue: 'centralPlaza' }, { stringValue: ROOM }] } },
    items: { mapValue: { fields: { whistle: int(1) } } },
  })
  // 도서관에는 이미 깃발이 꽂혀 있다 — 우리 1, 다른 두 팀이 2와 1
  await patch(`games/${game}/secret/flags`, {
    tiles: { mapValue: { fields: { [ROOM]: { mapValue: { fields: { [team]: int(1), [other[0]]: int(2), [other[1]]: int(1) } } } } } },
  })
  await patch(`games/${game}/tiles/${ROOM}`, { ownerTeam: { stringValue: other[0] } })
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
  const tag = `flag-${W}`
  await page.screenshot({ path: `${OUT}/${tag}-맵.png` })

  // 「깃발」 단추 → 행동 시트
  await page.locator('button', { hasText: /^깃발$/ }).first().click()
  await page.waitForSelector('.sc-ph', { timeout: 5000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${tag}-시트.png` })
  const flags = await page.locator('.sc-ph__flags').innerText()
  console.log(`  이 방 깃발: ${flags.replace(/\n/g, ' ')}`)
  if (!flags.includes(`${team} 1`)) missed.push(`우리 팀 깃발 1이 안 보인다: ${flags}`)

  await page.locator('.sc-ph__list button', { hasText: '깃발 꽂기' }).click()
  await page.waitForTimeout(1500)
  const after = await page.locator('.sc-ph__flags').innerText()
  console.log(`  꽂은 뒤: ${after.replace(/\n/g, ' ')}`)
  if (!after.includes(`${team} 2`)) missed.push(`꽂았는데 우리 팀이 2가 아니다: ${after}`)
  await page.screenshot({ path: `${OUT}/${tag}-꽂음.png` })

  // 뽑기 — 다른 팀이 둘이라 고르는 줄이 펼쳐진다
  await page.locator('.sc-ph__list button', { hasText: '깃발 뽑기' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${tag}-뽑기고르기.png` })
  await page.locator('.sc-ph__targets button', { hasText: `${other[0]}팀` }).click()
  await page.waitForTimeout(1500)
  const pulled = await page.locator('.sc-ph__flags').innerText()
  console.log(`  뽑은 뒤: ${pulled.replace(/\n/g, ' ')}`)
  if (!pulled.includes(`${other[0]} 1`)) missed.push(`뽑았는데 ${other[0]}이 1이 아니다: ${pulled}`)
  await page.screenshot({ path: `${OUT}/${tag}-뽑음.png` })

  // 닫으면 깃발로 주인이 정해진다 — 우리 2 · 다른 1 · 1
  await must('closePhase', host, { gameId: game })
  const owner = (await fetch(`${FS}/games/${game}/tiles/${ROOM}`, { headers: ADMIN }).then((r) => r.json())) as { fields: { ownerTeam?: { stringValue?: string } } }
  console.log(`  닫은 뒤 도서관 주인: ${owner.fields.ownerTeam?.stringValue}`)
  if (owner.fields.ownerTeam?.stringValue !== team) missed.push('닫은 뒤 우리 팀 것이 아니다')

  // 자판기에서 깃발을 사는 흐름(팀 상자 · 하루 몫)은 phase-e2e 가 본다

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
