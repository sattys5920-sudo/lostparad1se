// 운영자가 한 사람씩 배정하는 장면 — 목록 · 팝업 · 로비 학생증 · 시작 뒤.
//
// 운영자 창과 플레이어 창을 나란히 연다. 운영자가 「배정」을 누르는
// 순간 플레이어 창에 학생증이 떠야 한다.
//
//   1. 에뮬레이터 · 에뮬레이터용 사이트(:8899)
//   2. npx vite-node scripts/assign-shots.ts
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { ROLE_IDS } from '../shared/missions/roleNames'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/assignshots'
const MY_PW = 'assign-pass1'
const QA_PW = 'seed-password-1'
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }

async function call(name: string, tk: string | null, data: unknown) {
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
  const email = `as-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bad: string[] = []
  const game = `as${Date.now()}`
  const me = `as${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await call('createGame', host, { gameId: game, seed: 'as' })
  await call('signUpAccount', host, { id: me, password: MY_PW })
  const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  const meTok = ((await swap.json()) as { idToken: string }).idToken
  await call('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  // 프롤로그는 여기서 볼 것이 아니다
  await call('markPrologueSeen', meTok, {})
  await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 1 })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const pl = await pctx.newPage()
  pl.on('pageerror', (e) => bad.push(`플레이어 터짐: ${e.message}`))
  await pl.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await pl.fill('#gt-id', me)
  await pl.fill('#gt-pw', MY_PW)
  await pl.click('.sc-gt__submit')
  await pl.waitForSelector('.sc-lb__go', { timeout: 20000 })
  await pl.locator('.sc-lb__go').click()
  await pl.waitForTimeout(3000)
  if ((await pl.locator('.sc-dl').count()) > 0) bad.push('앉기만 했는데 학생증이 떴다')
  await pl.screenshot({ path: `${OUT}/1-플레이어-배정전.png` })

  const actx = await browser.newContext({ viewport: { width: 420, height: 1400 }, deviceScaleFactor: 2, locale: 'ko-KR' })
  const ad = await actx.newPage()
  ad.on('pageerror', (e) => bad.push(`운영자 터짐: ${e.message}`))
  await ad.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await ad.waitForSelector('.sc-gt__title', { timeout: 20000 })
  await ad.locator('.sc-gt__vend').click()
  await ad.waitForSelector('#gt-code')
  await ad.fill('#gt-code', hostCode())
  await ad.locator('.sc-gt__submit').click()
  await ad.waitForSelector('.sc-as__list', { timeout: 20000 })
  await ad.waitForTimeout(1500)
  await ad.screenshot({ path: `${OUT}/2-운영자-목록.png`, fullPage: true })

  // 수아에게 A팀 · 첫 역할을 준다 — 화면의 고르개로
  await ad.selectOption('select[aria-label="수아 팀"]', 'A')
  await ad.selectOption('select[aria-label="수아 역할"]', ROLE_IDS[0])
  await ad.locator('.sc-as__list li', { hasText: '수아' }).locator('button').click()
  const came = await pl.waitForSelector('.sc-dl', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!came) bad.push('배정했는데 플레이어 창에 학생증이 안 떴다')
  await pl.waitForTimeout(1400)
  await pl.screenshot({ path: `${OUT}/3-플레이어-팝업.png` })
  await ad.waitForTimeout(800)
  await ad.screenshot({ path: `${OUT}/4-운영자-한명배정.png`, fullPage: true })

  if (came) {
    await pl.locator('.sc-dl__go').click()
    await pl.waitForTimeout(1200)
    if ((await pl.locator('.sc-dl').count()) > 0) bad.push('접었는데 안 닫힌다')
    await pl.screenshot({ path: `${OUT}/5-플레이어-접은뒤.png` })
    await pl.reload({ waitUntil: 'domcontentloaded' })
    await pl.waitForTimeout(3500)
    if ((await pl.locator('.sc-dl').count()) > 0) bad.push('새로고침하면 다시 뜬다')
    const card = pl.getByText('내 학생증').first()
    if ((await card.count()) === 0) bad.push('로비에 「내 학생증」이 없다')
    else {
      await card.click()
      const back = await pl.waitForSelector('.sc-dl', { timeout: 8000 }).then(() => true).catch(() => false)
      if (!back) bad.push('「내 학생증」을 눌러도 안 뜬다')
      await pl.waitForTimeout(1000)
      await pl.screenshot({ path: `${OUT}/6-플레이어-다시보기.png` })
      await pl.locator('.sc-dl__go').click().catch(() => undefined)
    }
  }

  // 나머지 열셋은 서버로 바로 정한다
  const seats = ((await call('hostRoster', host, { gameId: game })) as { rows: { playerId: string; roleId: string | null }[] }).rows
  const snap = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/games/${game}`, { headers: ADMIN })
  const seatVals = ((await snap.json()) as { fields: { seats: { arrayValue: { values: { mapValue: { fields: Record<string, { stringValue?: string }> } }[] } } } }).fields.seats.arrayValue.values
  const used = new Set(seats.map((r) => r.roleId))
  const free = ROLE_IDS.filter((r) => !used.has(r))
  const room: Record<TeamId, number> = { ...STARTING_TEAM_SIZES, A: STARTING_TEAM_SIZES.A - 1 }
  for (const v of seatVals) {
    const f = v.mapValue.fields
    if (f.team?.stringValue) continue
    const team = (Object.keys(room) as TeamId[]).find((t) => room[t] > 0) as TeamId
    room[team] -= 1
    await call('hostAssignSeat', host, { gameId: game, playerId: f.playerId.stringValue, team, roleId: free.shift() })
  }
  await ad.waitForTimeout(2500)
  await ad.screenshot({ path: `${OUT}/7-운영자-모두배정.png`, fullPage: true })
  const startBtn = ad.getByRole('button', { name: '판 시작' })
  if (await startBtn.isDisabled()) bad.push('다 배정했는데 판 시작이 잠겨 있다')
  else await startBtn.click()
  await ad.waitForTimeout(3000)

  await call('markMorning', meTok, { gameId: game, read: [1] }).catch(() => undefined)
  await pl.reload({ waitUntil: 'domcontentloaded' })
  await pl.waitForSelector('.sc-ct__tab', { timeout: 25000 }).catch(() => bad.push('시작 뒤 탭이 안 나온다'))
  await pl.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await pl.waitForTimeout(1500)
  if ((await pl.locator('.sc-dl').count()) > 0) bad.push('시작하니 학생증이 또 떴다')
  await pl.locator('.sc-ct__tab', { hasText: '나' }).first().click().catch(() => bad.push('나 탭이 없다'))
  await pl.waitForTimeout(2000)
  await pl.screenshot({ path: `${OUT}/8-플레이어-나탭.png` })

  await browser.close()
  console.log('어긋남', JSON.stringify(bad))
}

void main()
