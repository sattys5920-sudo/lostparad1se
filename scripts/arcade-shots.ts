// 오락실 — 진짜 판에 들어가 뒷골목까지 걸어가서 논다. **재면서 찍는다.**
//
//   ㆍ 급식실에서 방향키로 걸어 나가 동쪽 계단 옆 샛길로 뒷골목에 든다.
//     이름표가 「뒷골목」이 되고, 골목 끝 기계에 앉은 사람까지 보인다
//   ㆍ 기계 앞자리에 서면 「오락기」 단추가 뜬다. 앉은 사람은 기계를 본다
//   ㆍ 고르는 화면에 열 개 — 다 들어간다(2단계에서 일곱을 채웠다)
//   ㆍ 리듬 스타를 악보대로 쳐서 서버가 CLEAR 를 준다(화면 점수가 아니라
//     서버가 누른 기록을 다시 돌린 결과다)
//   ㆍ 가위바위보를 골라 옆 기계의 봇을 부른다 — 봇이 받고, 시작하고, 이긴다
//   ㆍ 봇이 나를 부르면 창 안에도, 창을 닫아도 부름이 뜬다
//   ㆍ 낮은 화면(375×667)에서 숫자판·누르는 판이 기계 밖으로 안 나간다
//
//   npx vite-node scripts/arcade-shots.ts          (390×844)
//   W=375 H=667 npx vite-node scripts/arcade-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { ARCADE_MACHINES } from '../shared/rules/arcade'
import { RHYTHM_END_MS, rhythmChart } from '../shared/rules/arcadeRhythm'
import { doorHere, isWalkable } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'arcade-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const W = Number(process.env.W ?? 390)
const H = Number(process.env.H ?? 844)
const TAG = `${W}`

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

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

async function hostToken(tag: string) {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function swapToken(custom: string) {
  const s = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await s.json()) as { idToken: string }).idToken
}

/** 방 문서 하나(운영자 열쇠). 검사와 박자 맞추기에만 쓴다 */
async function roomOf(game: string, id: string) {
  const j = (await fetch(`${FS}/games/${game}/arcadeRooms/${id}`, { headers: ADMIN }).then((r) => r.json())) as {
    fields: Record<string, { integerValue?: string; stringValue?: string; doubleValue?: number }>
  }
  return {
    seed: Number(j.fields.seed?.integerValue ?? 0),
    startAtMs: Number(j.fields.startAtMs?.integerValue ?? j.fields.startAtMs?.doubleValue ?? 0),
    status: j.fields.status?.stringValue ?? '',
  }
}

async function roomsOf(game: string) {
  const j = (await fetch(`${FS}/games/${game}/arcadeRooms?pageSize=100`, { headers: ADMIN }).then((r) => r.json())) as {
    documents?: { name: string; fields: Record<string, { stringValue?: string; integerValue?: string }> }[]
  }
  return (j.documents ?? []).map((d) => ({
    id: d.name.split('/').pop() as string,
    game: d.fields.game?.stringValue ?? '',
    status: d.fields.status?.stringValue ?? '',
    hostId: d.fields.hostId?.stringValue ?? '',
    atMs: Number(d.fields.atMs?.integerValue ?? 0),
  }))
}

/** 걸어서 닿는 길(같은 층). 문도 밟는다. 화면의 걷기와 같은 자다 */
function route(from: { x: number; y: number }, to: { x: number; y: number }) {
  const key = (x: number, y: number) => `${x},${y}`
  const prev = new Map<string, string>()
  const seen = new Set([key(from.x, from.y)])
  let edge = [from]
  while (edge.length) {
    const next: { x: number; y: number }[] = []
    for (const c of edge) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy }
        const k = key(n.x, n.y)
        if (seen.has(k) || !(isWalkable(n.x, n.y) || doorHere(n.x, n.y))) continue
        seen.add(k)
        prev.set(k, key(c.x, c.y))
        if (n.x === to.x && n.y === to.y) {
          const out: { x: number; y: number }[] = []
          for (let at = k; at !== key(from.x, from.y); at = prev.get(at) as string) {
            const [x, y] = at.split(',').map(Number)
            out.unshift({ x, y })
          }
          return out
        }
        next.push(n)
      }
    }
    edge = next
  }
  return []
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const up = await fetch(`${SITE}/`).then((r) => r.ok).catch(() => false)
  if (!up) throw new Error(`서버가 없다(${SITE})`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const missed: string[] = []
  const shot = (name: string) => page.screenshot({ path: `${OUT}/arcade-${TAG}-${name}.png` })

  const game = `as${Date.now()}`
  const me = `as${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await call('createGame', host, { gameId: game, seed: 'as' })
  await call('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await swapToken(String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? ''))
  await call('saveCharacter', meTok, { nickname: '수아', avatar: { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 } })
  await call('joinGame', meTok, { gameId: game, name: '수아' })
  await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await call('assignAll', host, { gameId: game })
  await call('startGame', host, { gameId: game, startAtMs: START })
  await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await call('tick', host, { gameId: game })
  await call('markMorning', meTok, { gameId: game, read: [1] })

  // 봇 셋을 골목 기계에 앉힌다. 0번·5번·9번 — 골목 양끝까지 보이는지 잰다
  const bots = ['qa01', 'qa02', 'qa03']
  const botTok = await Promise.all(bots.map(async (b) => swapToken(String((await call('logInAccount', host, { id: b, password: QA_PW })).token ?? ''))))
  const botAt = [0, 5, 9]
  for (let i = 0; i < bots.length; i++) {
    const s = ARCADE_MACHINES[botAt[i]].seat
    await call('standAt', botTok[i], { gameId: game, x: s.x, y: s.y })
  }
  const gameDoc = (await fetch(`${FS}/games/${game}`, { headers: ADMIN }).then((r) => r.json())) as {
    fields: { seats: { arrayValue: { values: { mapValue: { fields: Record<string, { stringValue?: string }> } }[] } } }
  }
  const nameOf = (uid: string) =>
    gameDoc.fields.seats.arrayValue.values.find((v) => v.mapValue.fields.playerId?.stringValue === uid)?.mapValue.fields.name?.stringValue ?? '?'
  const botName = nameOf(uidOf(bots[0]))

  // 나는 급식실로 옮겨 두고 화면에서 걸어 나간다
  await call('roamTo', meTok, { gameId: game, tileId: 'cafeteria' })

  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1800)

  console.log('\n── 걸어서 뒷골목으로 ──')
  const cell = async () => {
    const [x, y] = ((await page.locator('.sc-wk__canvas').getAttribute('data-at')) ?? '0,0').split(',').map(Number)
    return { x, y }
  }
  const mySeat = ARCADE_MACHINES[2].seat
  const path = route(await cell(), mySeat)
  if (path.length === 0) missed.push('급식실에서 2번 기계까지 길이 없다')
  const KEY = (dx: number, dy: number) => (dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp')
  for (const step of path) {
    const c = await cell()
    await page.keyboard.press(KEY(step.x - c.x, step.y - c.y))
    for (let i = 0; i < 20; i++) {
      const n = await cell()
      if (n.x === step.x && n.y === step.y) break
      await page.waitForTimeout(40)
    }
  }
  const at = await cell()
  console.log(`  ${path.length}걸음 · 선 자리 ${at.x},${at.y}`)
  if (at.x !== mySeat.x || at.y !== mySeat.y) missed.push(`2번 기계 앞자리까지 못 걸었다(${at.x},${at.y})`)
  await page.waitForTimeout(1800)

  const where = (await page.locator('.sc-pl__where').first().innerText().catch(() => '')).trim()
  console.log(`  이름표: ${where}`)
  if (where !== '뒷골목') missed.push(`이름표가 「뒷골목」이 아니다: ${where}`)
  if ((await page.locator('.sc-ct__act', { hasText: '오락기' }).count()) === 0) missed.push('앞자리에 앉았는데 「오락기」 단추가 없다')
  await shot('골목')

  console.log('\n── 고르는 화면 ──')
  await page.locator('.sc-ct__act', { hasText: '오락기' }).click()
  await page.waitForSelector('.sc-ar__menu', { timeout: 5000 })
  const marquee = (await page.locator('.sc-ar__marquee').innerText()).trim()
  if (!marquee.includes('3번 기계')) missed.push(`간판에 3번 기계가 아니다: ${marquee}`)
  const menu = await page.locator('.sc-ar__menu button').evaluateAll((bs) =>
    bs.map((b) => ({ text: (b as HTMLElement).innerText.replace(/\s+/g, ' '), off: (b as HTMLButtonElement).disabled })),
  )
  const open = menu.filter((m) => !m.off).map((m) => m.text.split(' ')[0])
  console.log(`  ${menu.length}개 · 들어가는 것 ${open.join(', ')}`)
  if (menu.length !== 10) missed.push(`고르는 화면이 ${menu.length}개다`)
  if (open.length !== 10) missed.push(`열 개가 다 열려야 한다: ${open.join(',')}`)
  if (menu.some((m) => m.text.includes('준비 중'))) missed.push('「준비 중」이 남아 있다')
  if (!menu.some((m) => m.text.includes('2~4P'))) missed.push('넷까지 하는 게임 딱지(2~4P)가 없다')
  await shot('고르기')

  console.log('\n── 리듬 스타 ──')
  await page.locator('.sc-ar__menu button', { hasText: '리듬 스타' }).click()
  await page.waitForSelector('.sc-rh__canvas', { timeout: 5000 })
  // 낮은 화면에서도 누르는 판이 기계 안에 있어야 한다
  const pads = await page.locator('.sc-rh__pads').boundingBox()
  const scr = await page.locator('.sc-ar__screen').boundingBox()
  if (pads && scr && pads.y + pads.height > scr.y + scr.height + 0.5) missed.push('누르는 판이 기계 화면 밖으로 나온다')
  // 치는 동안 스크롤할 수는 없다 — 판이 처음부터 화면 안에 보여야 한다
  if (pads && pads.y + pads.height > H) missed.push(`누르는 판이 화면 아래로 ${Math.round(pads.y + pads.height - H)}px 잘린다`)
  const rooms = await roomsOf(game)
  const rhythmRoom = rooms.find((r) => r.game === 'rhythm' && r.hostId === uidOf(me))
  if (!rhythmRoom) throw new Error('리듬 방이 안 섰다')
  const rr = await roomOf(game, rhythmRoom.id)
  const chart = rhythmChart(rr.seed)
  const LANE_KEY = ['d', 'f', 'j']
  // 음표 시각마다 키를 누른다. 화면이 시계를 들고 판정하고, 나중에 서버가 다시 채점한다
  const begin = Date.now()
  const shotAt = rr.startAtMs + 18_000
  let shotMid = false
  for (const n of chart) {
    const when = rr.startAtMs + n.t
    const wait = when - Date.now()
    if (!shotMid && when > shotAt) {
      shotMid = true
      await shot('리듬')
      continue
    }
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    await page.keyboard.press(LANE_KEY[n.lane])
  }
  const left = rr.startAtMs + RHYTHM_END_MS - Date.now()
  await page.waitForTimeout(Math.max(0, left) + 500)
  const result = await page.waitForSelector('.sc-rh__grade', { timeout: 15000 }).then(() => true).catch(() => false)
  const line = result ? (await page.locator('.sc-rh').innerText()).replace(/\s+/g, ' ') : ''
  console.log(`  ${Math.round((Date.now() - begin) / 1000)}초 · ${line.slice(0, 80)}`)
  if (!line.includes('CLEAR')) missed.push(`악보대로 쳤는데 CLEAR 가 아니다: ${line}`)
  await shot('리듬끝')

  console.log('\n── 가위바위보 — 옆 기계를 부른다 ──')
  await page.locator('.sc-ar__row button', { hasText: '게임 고르기' }).click()
  await page.locator('.sc-ar__menu button:not([disabled])', { hasText: '가위바위보' }).click()
  await page.waitForSelector('.sc-lb__cabs', { timeout: 5000 })
  const cabs = await page.locator('.sc-lb__cabs button').allInnerTexts()
  const shown = cabs.map((t) => t.replace(/\s+/g, ' '))
  console.log(`  ${shown.join(' | ')}`)
  for (let i = 0; i < bots.length; i++) {
    if (!shown[botAt[i]]?.includes(nameOf(uidOf(bots[i])))) missed.push(`${botAt[i] + 1}번 기계에 ${nameOf(uidOf(bots[i]))}가 안 보인다`)
  }
  if (!shown[2]?.includes('나')) missed.push('3번 기계가 「나」로 안 보인다')
  await page.locator('.sc-lb__cabs button', { hasText: botName }).click()
  await page.waitForTimeout(700)
  await shot('부르기')
  const rpsRoom = (await roomsOf(game)).find((r) => r.game === 'rps' && r.status === 'lobby')
  if (!rpsRoom) throw new Error('가위바위보 방이 안 섰다')
  await call('arcadeAnswer', botTok[0], { gameId: game, roomId: rpsRoom.id, accept: true })
  await page.waitForTimeout(900)
  const startBtn = page.locator('.sc-ar__row button.is-go', { hasText: '시작' })
  if ((await startBtn.count()) === 0) missed.push('봇이 들어왔는데 「시작」이 안 켜진다')
  await shot('들어옴')
  await startBtn.click()
  await page.waitForSelector('.sc-du__picks', { timeout: 5000 })
  await page.locator('.sc-du__picks button', { hasText: '바위' }).click()
  await page.waitForTimeout(800)
  const waiting = await page.locator('.sc-du').innerText()
  if (!waiting.includes('고민 중')) missed.push('봇이 아직 안 냈는데 「고민 중」이 아니다')
  await call('arcadePick', botTok[0], { gameId: game, roomId: rpsRoom.id, pick: 'scissors' })
  await page.waitForTimeout(1200)
  const won = (await page.locator('.sc-du').innerText()).replace(/\s+/g, ' ')
  if (!won.includes('YOU WIN')) missed.push(`바위로 가위를 이겼는데 YOU WIN 이 아니다: ${won.slice(0, 60)}`)
  await shot('이김')

  console.log('\n── 봇이 나를 부른다 ──')
  await page.locator('.sc-ar__row button', { hasText: '게임 고르기' }).click()
  const r2 = String((await call('arcadeOpen', botTok[1], { gameId: game, game: 'rps' })).roomId)
  await call('arcadeInvite', botTok[1], { gameId: game, roomId: r2, playerId: uidOf(me) })
  const inSheet = await page.waitForSelector('.sc-ar__ask', { timeout: 6000 }).then(() => true).catch(() => false)
  if (!inSheet) missed.push('창이 열려 있을 때 부름 띠가 안 뜬다')
  await shot('부름-창안')
  await page.locator('.sc-sheet__back').first().click().catch(() => undefined)
  const outside = await page.waitForSelector('.sc-da--arcade', { timeout: 6000 }).then(() => true).catch(() => false)
  if (!outside) missed.push('창을 닫아도 부름이 떠야 한다')
  await shot('부름-밖')
  if (outside) {
    await page.locator('.sc-da--arcade button.is-on').click()
    const lobby = await page.waitForSelector('.sc-lb', { timeout: 6000 }).then(() => true).catch(() => false)
    if (!lobby) missed.push('부름을 받으면 창이 열려 기다리는 화면이 떠야 한다')
    const text = lobby ? await page.locator('.sc-lb').innerText() : ''
    if (lobby && !text.includes('시작하기를 기다린다')) missed.push(`받은 쪽 화면이 기다림이 아니다: ${text.slice(0, 60)}`)
    await shot('받음')
  }

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed, null, 0)}`)
  if (missed.length > 0) process.exitCode = 1
  console.log('찍었다')
}

void main()
