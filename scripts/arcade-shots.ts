// 오락기 — 진짜 판에 들어가 기계 앞에 서서 논다. **재면서 찍는다.**
//
//   ㆍ 기계 옆에 서면 「오락기」 단추가 뜬다(떠나면 못 두는 것은 arcade-e2e 가 잰다)
//   ㆍ 고르는 화면에 열 개 — 둘은 들어가고 여덟은 「준비 중」
//   ㆍ 업다운을 끝까지 한다(반씩 잘라 부른다). 답은 끝나야 화면에 온다
//   ㆍ 옆 봇에게 가위바위보를 건다 — 봇이 받고, 내가 먼저 내면 봇 쪽은
//     「고민 중」, 봇이 내면 판이 갈린다
//   ㆍ 봇이 나에게 걸면 창이 닫혀 있어도 신청 띠가 뜬다
//
// 사람은 식당(1층, 문이 기계 바로 옆)으로 옮겨 두고 방향키로 걸어 나온다.
// 화면은 서버의 「방」만 따라가고 칸은 따라가지 않는다 — 칸은 걸음이 적는다.
//
//   npx vite-node scripts/arcade-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { ARCADE_CELL } from '../shared/rules/arcade'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'arcade-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}

async function hostToken(tag: string) {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const up = await fetch(`${SITE}/`).then((r) => r.ok).catch(() => false)
  if (!up) throw new Error(`서버가 없다(${SITE})`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const missed: string[] = []
  const size = { w: Number(process.env.W ?? 390), h: Number(process.env.H ?? 844) }

  const game = `as${Date.now()}`
  const me = `as${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await call('createGame', host, { gameId: game, seed: 'as' })
  await call('signUpAccount', host, { id: me, password: MY_PW })
  const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  const meTok = ((await swap.json()) as { idToken: string }).idToken
  await call('saveCharacter', meTok, { nickname: '수아', avatar: { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 } })
  await call('joinGame', meTok, { gameId: game, name: '수아' })
  await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await call('assignAll', host, { gameId: game })
  await call('startGame', host, { gameId: game, startAtMs: START })
  await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await call('tick', host, { gameId: game })
  await call('markMorning', meTok, { gameId: game, read: [1] })

  // 봇 하나를 기계 옆에 세운다 — 대결 상대다
  const bot = 'qa01'
  const botTok = await (async () => {
    const c = String((await call('logInAccount', host, { id: bot, password: QA_PW })).token ?? '')
    const s = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: c, returnSecureToken: true }),
    })
    return ((await s.json()) as { idToken: string }).idToken
  })()
  const botUid = uidOf(bot)
  const botName = await (async () => {
    const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/games/${game}`, { headers: ADMIN })
    const j = (await r.json()) as { fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } }[] } } } }
    const seat = (j.fields?.seats?.arrayValue?.values ?? []).find((v) => v.mapValue?.fields?.playerId?.stringValue === botUid)
    return seat?.mapValue?.fields?.name?.stringValue ?? bot
  })()
  // 둘 다 식당으로 — 식당 문이 오락기 바로 옆이다. 봇은 서버에서 기계
  // 옆 복도에 세우고, 나는 화면에서 방향키로 걸어 나간다(걸음이 서버에
  // 자리를 적는 것까지 같이 잰다)
  await call('roamTo', meTok, { gameId: game, tileId: 'cafeteria' })
  await call('roamTo', botTok, { gameId: game, tileId: 'cafeteria' })
  await call('standAt', botTok, { gameId: game, x: ARCADE_CELL.x - 1, y: ARCADE_CELL.y + 1 })

  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1800)

  // 식당 문(29,78)으로 가서 한 칸 내려선다 — 기계 오른쪽 아래
  const DOOR = { x: ARCADE_CELL.x + 1, y: ARCADE_CELL.y - 1 }
  const GOAL = { x: ARCADE_CELL.x + 1, y: ARCADE_CELL.y }
  const cell = async () => {
    const a = (await page.locator('.sc-wk__canvas').getAttribute('data-at')) ?? '0,0'
    const [x, y] = a.split(',').map(Number)
    return { x, y }
  }
  for (let i = 0; i < 60; i++) {
    const c = await cell()
    if (c.x === GOAL.x && c.y === GOAL.y) break
    const t = c.y < DOOR.y && c.x !== DOOR.x ? DOOR : GOAL
    const key = c.x < t.x ? 'ArrowRight' : c.x > t.x ? 'ArrowLeft' : c.y < t.y ? 'ArrowDown' : 'ArrowUp'
    await page.keyboard.press(key)
    await page.waitForTimeout(220)
  }
  const stood = await cell()
  console.log(`  선 자리 ${stood.x},${stood.y}`)
  if (stood.x !== GOAL.x || stood.y !== GOAL.y) missed.push(`기계 옆까지 못 걸었다(${stood.x},${stood.y})`)
  await page.waitForTimeout(1500)

  const hasButton = () => page.locator('.sc-ct__act', { hasText: '오락기' }).count().then((n) => n > 0)
  console.log('\n── 기계 앞 ──')
  if (!(await hasButton())) {
    // 행동 칸이 넘치면 「더보기」 안에 있다
    missed.push('기계 옆인데 「오락기」 단추가 행동 칸에 없다')
  }
  await page.screenshot({ path: `${OUT}/arcade-앞.png` })

  console.log('\n── 고르는 화면 ──')
  await page.locator('.sc-ct__act', { hasText: '오락기' }).click()
  await page.waitForSelector('.sc-ar__menu', { timeout: 5000 })
  const menu = await page.locator('.sc-ar__menu button').evaluateAll((bs) =>
    bs.map((b) => ({ text: (b as HTMLElement).innerText.replace(/\s+/g, ' '), off: (b as HTMLButtonElement).disabled })),
  )
  console.log(`  ${menu.length}개 · 들어가는 것 ${menu.filter((m) => !m.off).map((m) => m.text.split(' ')[0]).join(', ')}`)
  if (menu.length !== 10) missed.push(`고르는 화면이 ${menu.length}개다`)
  if (menu.filter((m) => !m.off).length !== 2) missed.push('들어가는 게임이 둘이 아니다')
  if (menu.filter((m) => m.off && m.text.includes('준비 중')).length !== 8) missed.push('「준비 중」이 여덟이 아니다')
  await page.screenshot({ path: `${OUT}/arcade-고르기.png` })

  console.log('\n── 업다운 ──')
  await page.locator('.sc-ar__menu button', { hasText: '업다운' }).click()
  await page.waitForSelector('.sc-ud__pad', { timeout: 5000 })
  // 낮은 화면에서 숫자판이 기계 화면 밖으로 흘러 나온 적이 있다
  const padBox = await page.locator('.sc-ud__pad').boundingBox()
  const scrBox = await page.locator('.sc-ar__screen').boundingBox()
  if (padBox && scrBox && padBox.y + padBox.height > scrBox.y + scrBox.height + 0.5) {
    missed.push(`숫자판이 기계 화면 밖으로 ${Math.round(padBox.y + padBox.height - scrBox.y - scrBox.height)}px 나온다`)
  }
  let lo = 1, hi = 100, tries = 0, shotMid = false
  for (;;) {
    const mid = Math.floor((lo + hi) / 2)
    for (const d of String(mid)) await page.locator('.sc-ud__pad button', { hasText: new RegExp(`^${d}$`) }).click()
    // 끝나기 전에는 화면 어디에도 「정답」이 없어야 한다
    if ((await page.locator('.sc-ud__answer').count()) > 0) missed.push('끝나기 전에 정답이 보인다')
    await page.locator('.sc-ud__pad button.is-go').click()
    await page.waitForTimeout(700)
    tries++
    const big = (await page.locator('.sc-ud__big').innerText()).trim()
    if (!shotMid && tries === 2) { await page.screenshot({ path: `${OUT}/arcade-업다운.png` }); shotMid = true }
    if (big.includes('WIN') || big.includes('OVER')) { console.log(`  ${tries}번 만에 ${big}`); break }
    if (big.includes('UP')) lo = mid + 1
    else if (big.includes('DOWN')) hi = mid - 1
    else { missed.push(`업다운 알림을 못 읽었다: ${big}`); break }
    if (tries > 7) { missed.push('업다운이 여섯 번 넘게 이어졌다'); break }
  }
  const answer = await page.locator('.sc-ud__answer').innerText().catch(() => '')
  console.log(`  ${answer.replace(/\s+/g, ' ')}`)
  if (!answer.includes('정답')) missed.push('끝났는데 정답이 안 보인다')
  await page.screenshot({ path: `${OUT}/arcade-업다운끝.png` })

  console.log('\n── 가위바위보 — 내가 건다 ──')
  await page.locator('.sc-ar__row button', { hasText: '게임 고르기' }).click()
  await page.locator('.sc-ar__menu button:not([disabled])', { hasText: '가위바위보' }).click()
  await page.waitForTimeout(500)
  const foes = await page.locator('.sc-ar__foes button').allInnerTexts()
  console.log(`  상대 후보: ${foes.map((f) => f.split('에게')[0]).join(', ') || '없음'}`)
  if (!foes.some((f) => f.includes(botName))) missed.push(`옆에 선 ${botName}이 상대 후보에 없다`)
  await page.locator('.sc-ar__foes button', { hasText: botName }).click()
  await page.waitForSelector('.sc-du', { timeout: 5000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/arcade-신청.png` })

  // 봇이 받는다
  const FSX = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
  const list = await fetch(`${FSX}/games/${game}/arcadeMatches`, { headers: ADMIN }).then((r) => r.json()) as { documents?: { name: string }[] }
  const matchId = (list.documents ?? [])[0]?.name.split('/').pop() ?? ''
  await call('arcadeAnswer', botTok, { gameId: game, matchId, accept: true })
  await page.waitForSelector('.sc-du__picks', { timeout: 5000 })
  await page.locator('.sc-du__picks button', { hasText: '바위' }).click()
  await page.waitForTimeout(900)
  const waiting = await page.locator('.sc-du').innerText()
  if (!waiting.includes('냈다. 상대를 기다린다')) missed.push('내가 낸 뒤 「기다린다」가 없다')
  if (!waiting.includes('고민 중')) missed.push('봇이 아직 안 냈는데 「고민 중」이 아니다')
  await page.screenshot({ path: `${OUT}/arcade-냈다.png` })
  await call('arcadePick', botTok, { gameId: game, matchId, pick: 'scissors' })
  await page.waitForTimeout(1200)
  const result = (await page.locator('.sc-du').innerText()).replace(/\s+/g, ' ')
  console.log(`  ${result.slice(0, 80)}`)
  if (!result.includes('YOU WIN')) missed.push('바위로 가위를 이겼는데 YOU WIN 이 아니다')
  await page.screenshot({ path: `${OUT}/arcade-이김.png` })

  console.log('\n── 봇이 나에게 건다 — 창이 닫혀 있어도 ──')
  await page.locator('.sc-ar__row button', { hasText: '게임 고르기' }).click()
  await page.locator('.sc-sheet__back').first().click().catch(() => undefined)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(400)
  await call('arcadeChallenge', botTok, { gameId: game, game: 'rps', toPlayerId: uidOf(me) })
  const ask = await page.waitForSelector('.sc-da--arcade', { timeout: 6000 }).then(() => true).catch(() => false)
  if (!ask) missed.push('창이 닫혀 있을 때 대결 신청 띠가 안 뜬다')
  await page.screenshot({ path: `${OUT}/arcade-받음.png` })

  if (ask) await page.locator('.sc-da--arcade button', { hasText: '안 한다' }).click()

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed, null, 0)}`)
  if (missed.length > 0) process.exitCode = 1
  console.log('찍었다')
}

void main()
