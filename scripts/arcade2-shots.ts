// 오락실 2단계 — 새 게임 일곱을 폰 화면으로 끝까지 한다. **재면서 찍는다.**
//
//   뱀 · 1 to 50(봇과) · 두더지 · 둘이서 한 곡(봇과 번갈아) · 먼저 쏴(봇과)
//   · 눈치 게임(봇 둘과) · 탑 쌓기(봇과)
//
// 봇은 서버에 바로 둔다(API). 나는 화면을 눌러 둔다 — 결과는 늘 서버가
// 기록을 다시 돌려 낸 것이다.
//
//   npx vite-node scripts/arcade2-shots.ts
//
// ── 아래 머리는 arcade-shots 와 같다(골목까지 걸어가기) ──
//
//
//   ㆍ 급식실에서 방향키로 걸어 나가 동쪽 계단 옆 샛길로 뒷골목에 든다.
//     이름표가 「뒷골목」이 되고, 골목 끝 기계에 앉은 사람까지 보인다
//   ㆍ 기계 앞자리에 서면 「오락기」 단추가 뜬다. 앉은 사람은 기계를 본다
//   ㆍ 고르는 화면에 열 개 — 들어가는 것은 셋, 나머지는 「준비 중」
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
import { pickOnMap } from './lib/walk'
import { relayTimes, relayWho, type RelayState } from '../shared/rules/arcadeBeat'
import { MOLE_MS } from '../shared/rules/arcadeMole'
import { fiftyBoard, fiftyStart, fiftyTap, type FiftyTap } from '../shared/rules/arcadeFifty'
import { towerHitT } from '../shared/rules/arcadeTower'
import { doorHere, isWalkable } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'arcade-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const W = Number(process.env.W ?? 390)
const H = Number(process.env.H ?? 844)
const TAG = `2-${W}`
/** 한 판만 돌린다(ONLY=mole 처럼). 비우면 다 */
const ONLY = process.env.ONLY ?? ''

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

  // 나는 급식실로 옮겨 두고 화면에서 걸어 나간다
  await call('roamTo', meTok, { gameId: game, tileId: 'cafeteria' })

  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [화면] ${m.text().slice(0, 160)}`)
  })
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
  // 아래 칸에는 오락기가 없다. 기계를 짚으면 옆에 「켠다」가 뜬다
  if ((await page.locator('.sc-ct__act', { hasText: '오락기' }).count()) > 0) missed.push('아래 칸에 「오락기」가 남아 있다')
  await shot('골목')

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
  const openSheet = async () => {
    if ((await page.locator('.sc-ar').count()) === 0) await pickOnMap(page, ARCADE_MACHINES[2].cell, '켠다')
    await page.waitForSelector('.sc-ar', { timeout: 5000 })
  }
  const toMenu = async () => {
    const b = page.locator('.sc-ar__row button', { hasText: '게임 고르기' })
    if (await b.count()) await b.first().click()
    await page.waitForSelector('.sc-ar__menu', { timeout: 8000 })
  }
  const pick = (name: string) => page.locator('.sc-ar__menu button:not([disabled])', { hasText: name }).first().click()
  /** 지금 열린 방(운영자 열쇠로). 봇의 박자를 맞추는 데만 쓴다 */
  const liveRoom = async (g: string) => {
    for (let i = 0; i < 20; i++) {
      const r = (await roomsOf(game)).filter((x) => x.game === g && (x.status === 'lobby' || x.status === 'playing')).sort((a, b) => b.atMs - a.atMs)[0]
      if (r) return r
      await sleep(250)
    }
    throw new Error(`${g} 방이 안 섰다`)
  }
  const full = async (id: string) => {
    const j = (await fetch(`${FS}/games/${game}/arcadeRooms/${id}`, { headers: ADMIN }).then((r) => r.json())) as { fields: Record<string, unknown> }
    const flat = (v: unknown): unknown => {
      const x = v as Record<string, unknown>
      if (!x || typeof x !== 'object') return v
      if ('stringValue' in x) return x.stringValue
      if ('integerValue' in x) return Number(x.integerValue)
      if ('doubleValue' in x) return x.doubleValue
      if ('booleanValue' in x) return x.booleanValue
      if ('nullValue' in x) return null
      if ('arrayValue' in x) return ((x.arrayValue as { values?: unknown[] }).values ?? []).map(flat)
      if ('mapValue' in x) return Object.fromEntries(Object.entries((x.mapValue as { fields?: Record<string, unknown> }).fields ?? {}).map(([k, w]) => [k, flat(w)]))
      return v
    }
    return Object.fromEntries(Object.entries(j.fields).map(([k, v]) => [k, flat(v)])) as Record<string, any>
  }
  /** 판이 열릴 때까지(시작을 누른 뒤 서버가 넘기는 데 잠깐 걸린다) */
  const playing = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      const r = await full(id)
      if (r.status === 'playing' && r.startAtMs) return r
      await sleep(200)
    }
    throw new Error('판이 안 열렸다')
  }
  /** 봇을 불러 들이고 시작까지 — 방장은 나 */
  const withBots = async (g: string, name: string, n: number) => {
    await toMenu()
    await pick(name)
    await page.waitForSelector('.sc-lb__cabs', { timeout: 5000 })
    const r = await liveRoom(g)
    for (let i = 0; i < n; i++) {
      await page.locator('.sc-lb__cabs button', { hasText: nameOf(uidOf(bots[i])) }).click()
      await sleep(400)
      await call('arcadeAnswer', botTok[i], { gameId: game, roomId: r.id, accept: true })
    }
    await sleep(700)
    await page.locator('.sc-ar__row button.is-go', { hasText: '시작' }).click()
    await sleep(500)
    return r.id
  }
  /** 치는 동안 스크롤할 수는 없다 — 누르는 것이 처음부터 화면 안에 있어야 한다 */
  const onScreen = async (sel: string, label: string) => {
    const b = await page.locator(sel).first().boundingBox()
    if (!b) missed.push(`${label}: ${sel} 이 없다`)
    else if (b.y + b.height > H + 0.5) missed.push(`${label}: 누르는 것이 화면 아래로 ${Math.round(b.y + b.height - H)}px 잘린다`)
  }
  const endLine = async () => (await page.locator('.sc-kit__end').innerText().catch(() => '')).replace(/\s+/g, ' ')
  const expectEnd = async (label: string, want: RegExp) => {
    const ok = await page.waitForSelector('.sc-kit__end', { timeout: 20000 }).then(() => true).catch(() => false)
    const t = ok ? await endLine() : ''
    console.log(`  ${label}: ${t.slice(0, 90)}`)
    if (!want.test(t)) missed.push(`${label} 결과가 이상하다: ${t.slice(0, 80)}`)
  }
  await openSheet()

  if (!ONLY || ONLY === 'snake') {
    console.log('\n── 뱀 ──')
    await pick('뱀')
    await page.waitForSelector('.sc-sn__canvas', { timeout: 5000 })
    const snakeRoom = await liveRoom('snake')
    const sr = await playing(snakeRoom.id)
    await sleep(sr.startAtMs - Date.now() + 500)
    await page.keyboard.press('ArrowUp')
    await sleep(450)
    await shot('뱀')
    await onScreen('.sc-sn__pad', '뱀')
    // 벽에 박을 때까지 둔다
    await expectEnd('뱀', /FAILED|CLEAR/)
    await shot('뱀끝')
  }

  if (!ONLY || ONLY === 'fifty') {
    console.log('\n── 1 to 50 — 봇과 ──')
    const ffId = await withBots('oneToFifty', '1 to 50', 1)
    const fr = await playing(ffId)
    await sleep(fr.startAtMs - Date.now() + 200)
    for (let n = 1; n <= 50; n++) {
      const cell = page.locator('.sc-ff__grid button', { hasText: new RegExp(`^${n}$`) })
      if (!(await cell.count())) {
        const grid = await page.locator('.sc-ff__grid button').allInnerTexts()
        throw new Error(`${n} 이 판에 없다: ${grid.join(' ')} / ${await page.locator('.sc-ff').innerText()}`)
      }
      await cell.dispatchEvent('pointerdown')
      await sleep(60)
      if (n === 20) {
        await shot('1to50')
        await onScreen('.sc-ff__grid', '1 to 50')
      }
    }
    // 봇은 느리게(0.8초 간격) 끝낸 기록을 낸다
    const b = fiftyBoard(fr.seed)
    let st = fiftyStart(b)
    const botTaps: FiftyTap[] = []
    for (let n = 1; n <= 50; n++) {
      const tap = { t: n * 800, cell: st.cells.indexOf(n) }
      botTaps.push(tap)
      st = fiftyTap(b, st, tap).s
    }
    await sleep(1500)
    const midWait = await page.locator('.sc-rh__over').innerText().catch(() => '')
    if (!midWait.includes('기다린다')) missed.push(`1 to 50 끝낸 뒤 「다른 사람을 기다린다」가 아니다: ${midWait}`)
    await sleep(fr.startAtMs + 50 * 800 + 300 - Date.now())
    await call('arcadeSubmit', botTok[0], { gameId: game, roomId: ffId, log: botTaps })
    await expectEnd('1 to 50', /YOU WIN/)
    await shot('1to50끝')
  }

  if (!ONLY || ONLY === 'mole') {
    console.log('\n── 두더지 ──')
    await toMenu()
    await pick('두더지')
    await page.waitForSelector('.sc-lb', { timeout: 5000 })
    await page.locator('.sc-ar__row button.is-go', { hasText: '시작' }).click()
    const mr = await playing((await liveRoom('mole')).id)
    await sleep(mr.startAtMs - Date.now() + 100)
    let moleShot = false
    while (Date.now() < mr.startAtMs + MOLE_MS) {
      const up = await page.locator('.sc-ml__hole.is-mole, .sc-ml__hole.is-gold').all()
      // 그새 숨은 두더지를 붙들고 기다리지 않는다
    for (const h of up) await h.dispatchEvent('pointerdown', undefined, { timeout: 100 }).catch(() => undefined)
      if (!moleShot && Date.now() > mr.startAtMs + 10_000) {
        moleShot = true
        await shot('두더지')
        await onScreen('.sc-ml__grid', '두더지')
      }
      await sleep(70)
    }
    await expectEnd('두더지', /CLEAR!/)
    await shot('두더지끝')
  }

  if (!ONLY || ONLY === 'duet') {
    console.log('\n── 둘이서 한 곡 — 봇과 번갈아 ──')
    const dId = await withBots('duet', '둘이서 한 곡', 1)
    await playing(dId)
    const PAD_KEY = ['d', 'f', 'j', 'k']
    // 나는 곡을 따라 치고 두 칸 뒤에 「딱」을 보탠다. 봇은 두 번 잘 치고 그다음부터 틀린다
    let botTurns = 0
    let shotListen = false
    let shotMine = false
    for (let i = 0; i < 12; i++) {
      const r = await full(dId)
      if (r.status !== 'playing') break
      const st = r.relay as RelayState
      const tm = relayTimes(st)
      const last = st.notes.at(-1)!.step
      if (relayWho(st) === uidOf(me)) {
        if (!shotListen) {
          await sleep(tm.listenZero + st.notes[1].step * tm.e + 40 - Date.now())
          shotListen = true
          await shot('둘이서-듣기')
          await onScreen('.sc-bt__pads', '둘이서 한 곡')
        }
        for (const n of st.notes) {
          await sleep(tm.answerZero + n.step * tm.e - Date.now() - 8)
          await page.keyboard.press(PAD_KEY[n.pad])
        }
        await sleep(tm.answerZero + (last + 2) * tm.e - Date.now())
        if (!shotMine) {
          shotMine = true
          await shot('둘이서-보태기')
        }
        await page.keyboard.press('k')
      } else {
        const good = botTurns++ < 2
        const taps = st.notes.map((n) => ({ t: Math.round(tm.answerZero + n.step * tm.e - st.turnAtMs), pad: n.pad }))
        if (good) taps.push({ t: Math.round(tm.answerZero + (last + 1) * tm.e - st.turnAtMs), pad: 1 })
        await sleep(tm.closeAt + 150 - Date.now())
        await call('arcadePlay', botTok[0], { gameId: game, roomId: dId, move: { taps } })
      }
      await sleep(tm.closeAt + 1200 - Date.now())
    }
    await expectEnd('둘이서 한 곡', /FAILED|CLEAR/)
    const endText = await endLine()
    if (!/\d+박짜리 곡/.test(endText)) missed.push(`둘이서 한 곡 결과에 곡 길이가 없다: ${endText}`)
    await shot('둘이서끝')
  }

  if (!ONLY || ONLY === 'draw') {
    console.log('\n── 먼저 쏴 — 봇과 ──')
    const qId = await withBots('quickdraw', '먼저 쏴', 1)
    for (let round = 0; round < 3; round++) {
      const q = await full(qId)
      if (q.status !== 'playing') break
      await sleep(q.draw.signalAtMs - Date.now() - 600)
      if (round === 0) {
        await shot('먼저쏴-준비')
        await onScreen('.sc-qd__field', '먼저 쏴')
      }
      await page.waitForSelector('.sc-qd__field.is-go', { timeout: 8000 })
      if (round === 0) await shot('먼저쏴-신호')
      await page.locator('.sc-qd__field').dispatchEvent('pointerdown')
      await sleep(300)
      await call('arcadePlay', botTok[0], { gameId: game, roomId: qId, move: { round: q.draw.round, shot: 900 } })
      await sleep(900)
      if (round === 0) await shot('먼저쏴-한판')
    }
    await expectEnd('먼저 쏴', /YOU WIN/)
    await shot('먼저쏴끝')
  }

  if (!ONLY || ONLY === 'nunchi') {
    console.log('\n── 눈치 게임 — 봇 둘과 ──')
    const nId = await withBots('nunchi', '눈치 게임', 2)
    const nr = await playing(nId)
    await sleep(nr.startAtMs - Date.now() + 300)
    await page.locator('.sc-nc__shout').dispatchEvent('pointerdown')
    await sleep(900)
    await call('arcadePlay', botTok[0], { gameId: game, roomId: nId })
    await sleep(500)
    await shot('눈치')
    await onScreen('.sc-nc__shout', '눈치 게임')
    await expectEnd('눈치 게임', /YOU WIN/)
    await shot('눈치끝')
  }

  if (!ONLY || ONLY === 'tower') {
    console.log('\n── 탑 쌓기 — 봇과 ──')
    const tId = await withBots('tower', '탑 쌓기', 1)
    let towerShot = false
    for (let i = 0; i < 14; i++) {
      const t = await full(tId)
      if (t.status !== 'playing') break
      const who = t.tower.order[t.tower.turn % t.tower.order.length]
      const h = t.tower.blocks.length - 1
      const hitT = towerHitT(h, t.tower.blocks[h].x)
      if (who === uidOf(me)) {
        // 사람처럼 — 딱 맞는 때에 누르되 화면·손 늦음이 조금 섞인다
        await sleep(t.tower.turnAtMs + hitT - Date.now() - 20)
        await page.locator('.sc-tw__drop').dispatchEvent('pointerdown')
      } else {
        // 봇은 열한 층을 넘기면 끝에서 떨어뜨려 무너뜨린다
        await sleep(t.tower.turnAtMs + (h >= 11 ? 30 : hitT) - Date.now())
        await call('arcadePlay', botTok[0], { gameId: game, roomId: tId, move: { t: h >= 11 ? 0 : hitT } })
      }
      await sleep(600)
      if (!towerShot && h >= 6) {
        towerShot = true
        await shot('탑')
        await onScreen('.sc-tw__drop', '탑 쌓기')
      }
    }
    await expectEnd('탑 쌓기', /CLEAR/)
    await shot('탑끝')
  }
  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed, null, 0)}`)
  if (missed.length > 0) process.exitCode = 1
  console.log('찍었다')
}

void main()
