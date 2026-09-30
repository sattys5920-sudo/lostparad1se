// 점령전 중 방에서 걸어 나가면 문 앞에서 5분 묶이는가 — 실제 화면으로 걷는다.
//   (에뮬레이터 + 에뮬레이터용 빌드를 :8899 에 띄운 뒤) npx vite-node scripts/exit-walk-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { DOORS, roomAt, tileAt } from '../src/school/map/world'

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
const ROOM = 'library'
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function must(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function hostToken(tag: string): Promise<string> {
  const email = `exit-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}
const int = (n: number) => ({ integerValue: String(n) })
const str = (s: string | null) => (s === null ? { nullValue: null } : { stringValue: s })
async function patch(path: string, fields: Record<string, unknown>) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ fields }) })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // 도서관에서 복도로 나가는 문 하나 — 문 안쪽 칸 · 문 · 바깥 복도 칸이 한 줄인 것
  const dirs = [[0, 1, 'ArrowDown'], [0, -1, 'ArrowUp'], [1, 0, 'ArrowRight'], [-1, 0, 'ArrowLeft']] as const
  let plan: { inside: { x: number; y: number }; key: string } | null = null
  for (const d of DOORS.filter((d) => d.a === ROOM && d.b === null)) {
    for (const t of d.tiles) for (const [dx, dy, key] of dirs) {
      const inside = { x: t.x - dx, y: t.y - dy }
      const out1 = { x: t.x + dx, y: t.y + dy }
      if (roomAt(inside.x, inside.y)?.id === ROOM && tileAt(inside.x, inside.y) === 'floor' && tileAt(out1.x, out1.y) === 'hall') plan = plan ?? { inside, key }
    }
  }
  if (!plan) throw new Error('나갈 문이 없다')
  const game = `ex${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ex' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  const me = uidOf('qa01')
  await patch(`games/${game}/pawns/${me}`, {
    tileId: str(ROOM), postTile: str(ROOM), at: { mapValue: { fields: { x: int(plan.inside.x), y: int(plan.inside.y) } } },
    visitedTiles: { arrayValue: { values: [str('centralPlaza'), str(ROOM)] } },
  })
  await must('openPhase', host, { gameId: game })
  await must('tick', host, { gameId: game })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' })).newPage()
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
  // 문을 지나 복도로 두 걸음 — 멈추지 않고 네 걸음째까지 누른다
  await page.keyboard.down(plan.key)
  await page.waitForTimeout(700)
  await page.keyboard.up(plan.key)
  await page.waitForTimeout(2500)
  const p = ((await fetch(`${FS}/games/${game}/pawns/${me}`, { headers: ADMIN }).then((r) => r.json())) as { fields: Record<string, { stringValue?: string; integerValue?: string; mapValue?: { fields: Record<string, { integerValue: string }> } }> }).fields
  console.log('busyKind', p.busyKind?.stringValue, 'at', JSON.stringify(p.at?.mapValue?.fields))
  await page.screenshot({ path: `${OUT}/exit-walk.png` })
  const busyShown = await page.locator('.sc-pl__busy').innerText().catch(() => '')
  console.log('화면', JSON.stringify(busyShown))
  await browser.close()
  process.exit(p.busyKind?.stringValue === '방에서 나가는' ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
