// 말줄과 무전 — 키보드가 떠도 손이 안 끊기는가.
//
// 재는 것:
//   · 다섯 번 잇달아 보내도 초점이 입력칸에서 안 떨어진다(키보드가 안 내려간다)
//   · 단추를 누르는 순간(pointerdown) 로그에 줄이 먼저 선다 — 서버 대답 전에
//   · 서버 줄이 오면 그 줄과 합쳐진다. 두 번 안 뜬다
//   · 같은 말을 날아가는 중에 또 누르면 한 번만 간다
//   · 실패한 줄은 붉게 남고, 누르면 다시 간다
//   · 맵 탭은 키보드가 떠도 지도 상자가 한 픽셀도 안 움직인다
//   · 무전 탭은 입력줄이 키보드 위에 앉고 목록이 그만큼 줄며 맨 아래에 붙는다
//
// **헤드리스에는 소프트 키보드가 없다.** 아이폰이 하는 것과 같은 일을
// 시킨다 — visualViewport.height 를 키보드만큼 줄이고 resize 를 쏜다.
// 그러면 화면의 useKeyboardInset 이 --kb 를 스스로 적는다(--kb 를 손으로
// 적지 않는다 — 그러면 훅이 안 도는 것을 못 잡는다).
//
//   1. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-chat --emptyOutDir
//   2. python3 -m http.server 8901 --bind 127.0.0.1 --directory /tmp/claude-0/serve-chat
//   3. npx vite-node scripts/chat-shots.ts
//
// **운영자 코드는 안 쓴다.** 판은 운영자 권한 증표(에뮬레이터)로 세운다.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8901'
const OUT = '/tmp/claude-0/shots'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
/** 키보드가 먹었다고 칠 높이. 한글 키보드가 대충 이만하다 */
const KB = 300
/** 서버 대답을 이만큼 붙든다. 그 사이에 줄이 먼저 서 있어야 낙관이다 */
const HOLD_MS = 1200

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function must(name: string, tk: string | null, data: unknown) {
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
  const email = `chat-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

async function seatsOf(game: string): Promise<{ playerId: string; team: string }[]> {
  const r = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
  const j = (await r.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } }[] } } }
  }
  return (j.fields?.seats?.arrayValue?.values ?? []).map((v) => ({
    playerId: v.mapValue?.fields?.playerId?.stringValue ?? '',
    team: v.mapValue?.fields?.team?.stringValue ?? '',
  }))
}

/** 아이폰이 하는 것과 같은 일을 시킨다: 보이는 창을 줄이고 알린다 */
const RAISE = (page: Page, px: number) =>
  page.evaluate((kb) => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - kb })
    vv.dispatchEvent(new Event('resize'))
  }, px)

const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }, sel)

type Box = { x: number; y: number; w: number; h: number } | null
const same = (a: Box, b: Box) => a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

interface Chan {
  name: string
  input: string
  send: string
  log: string
  /** 서버 쪽 callable 이름 */
  fn: string
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const missed: string[] = []
  const report: Record<string, unknown> = {}
  const host = await hostToken(`h${Date.now()}`)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const s of SIZES) {
    const tag = String(s.w)
    const game = `ch${tag}${Date.now()}`
    await must('createGame', host, { gameId: game, seed: 'ch' })
    await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    await must('assignAll', host, { gameId: game })
    await must('startGame', host, { gameId: game, startAtMs: START })
    await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
    await must('tick', host, { gameId: game })
    const seats = await seatsOf(game)
    const meId = 'qa01'
    const myTeam = seats.find((x) => x.playerId === uidOf(meId))?.team
    const mateIds = Array.from({ length: 14 }, (_, i) => `qa${String(i + 1).padStart(2, '0')}`)
      .filter((id) => id !== meId && seats.find((x) => x.playerId === uidOf(id))?.team === myTeam)
    const mateToks: string[] = []
    for (const id of mateIds) mateToks.push(await asPlayer(host, id))
    console.log(`${tag}: 판 ${game} · 나 ${meId}(${myTeam}팀) · 같은 팀 ${mateIds.join(' ')}`)

    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${tag} 화면 터짐: ${e.message}`))

    /*
     * 보내는 줄의 대답을 붙든다. **붙든 동안에 로그를 본다** — 거기
     * 줄이 서 있으면 화면이 서버를 안 기다린 것이다.
     * failNext 가 서 있으면 한 번은 끊는다(붉은 줄과 다시 보내기).
     */
    let failNext = false
    let held = 0
    await page.route(/\/asia-northeast3\/(say|radio)$/, async (route) => {
      if (failNext) {
        failNext = false
        await route.abort('failed')
        return
      }
      held += 1
      await new Promise((r) => setTimeout(r, HOLD_MS))
      held -= 1
      await route.continue()
    })

    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#gt-id', { timeout: 20_000 })
    await page.fill('#gt-id', meId)
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    for (let i = 0; i < 60; i++) {
      if (await page.locator('.sc-ct__tab').count()) break
      await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
      await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
      await page.waitForTimeout(300)
    }
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1500)

    /** 다섯 번 잇달아. 매번 pointerdown 순간의 로그와 초점을 본다 */
    async function burst(ch: Chan, words: string[]) {
      const rows: Record<string, unknown>[] = []
      for (const w of words) {
        await page.locator(ch.input).pressSequentially(w, { delay: 10 })
        const b = (await box(page, ch.send))!
        await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
        const heldBefore = held
        await page.mouse.down()
        // 서버 대답 전에 줄이 섰는가. 대답은 HOLD_MS 뒤에야 온다
        const seen = await page
          .waitForFunction(
            ([sel, t]) => [...document.querySelectorAll(sel)].some((e) => e.textContent?.includes(t)),
            [ch.log, w] as const,
            { timeout: 400 },
          )
          .then(() => true)
          .catch(() => false)
        const heldNow = held
        await page.mouse.up()
        await page.waitForTimeout(60)
        const after = await page.evaluate((sel) => {
          const a = document.activeElement as HTMLInputElement | null
          const box = document.querySelector(sel) as HTMLInputElement | null
          return { focus: a === box, value: box?.value ?? null, disabled: box?.disabled ?? null }
        }, ch.input)
        rows.push({ w, 먼저섰다: seen, 붙든대답: heldNow, ...after })
        if (!seen) missed.push(`${tag} ${ch.name}: 「${w}」가 pointerdown 뒤 400ms 안에 안 섰다`)
        if (heldNow <= heldBefore && seen) {
          // 붙든 요청이 아직 안 나갔다는 뜻일 수도 있다 — 서버가 대답 안 한 것만 확인하면 된다
        }
        if (!after.focus) missed.push(`${tag} ${ch.name}: 「${w}」 뒤 초점이 칸을 떠났다`)
        if (after.value !== '') missed.push(`${tag} ${ch.name}: 「${w}」 뒤 칸이 안 비었다(${after.value})`)
        if (after.disabled) missed.push(`${tag} ${ch.name}: 보내는 중에 칸이 잠겼다`)
      }
      return rows
    }

    /** 서버 줄이 온 뒤, 같은 말이 몇 번 보이는가 */
    const countOf = (ch: Chan, w: string) =>
      page.evaluate(
        ([sel, t]) => [...document.querySelectorAll(sel)].filter((e) => e.textContent?.endsWith(t)).length,
        [ch.log, w] as const,
      )

    async function dupAndFail(ch: Chan, stamp: string) {
      const out: Record<string, unknown> = {}
      // 같은 말을 날아가는 중에 또 — 한 번만 가야 한다
      const twice = `두번${stamp}`
      await page.locator(ch.input).pressSequentially(twice, { delay: 5 })
      await page.keyboard.press('Enter')
      await page.locator(ch.input).pressSequentially(twice, { delay: 5 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(150)
      out['같은 말 두 번(날아가는 중)'] = await countOf(ch, twice)
      out['막힌 뒤 칸에 남은 글'] = await page.locator(ch.input).inputValue()
      await page.locator(ch.input).fill('')
      // 실패 — 붉은 줄, 누르면 다시
      const bad = `끊긴말${stamp}`
      failNext = true
      await page.locator(ch.input).pressSequentially(bad, { delay: 5 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      const red = await page.locator('.is-failed', { hasText: bad }).count()
      out['실패 줄(붉음)'] = red
      if (red !== 1) missed.push(`${tag} ${ch.name}: 실패한 줄이 붉게 안 남았다`)
      out['실패 뒤 초점'] = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), ch.input)
      await page.screenshot({ path: `${OUT}/chat-${tag}-${ch.name}-실패.png` })
      await page
      .locator('.is-failed', { hasText: bad })
      .first()
      .dispatchEvent('pointerdown', { button: 0, isPrimary: true }, { timeout: 2000 })
      .catch(() => missed.push(`${tag} ${ch.name}: 다시 보낼 붉은 줄이 없다`))
      await page.waitForTimeout(HOLD_MS + 4000)
      out['다시 보낸 뒤 붉은 줄'] = await page.locator('.is-failed').count()
      out['다시 보낸 뒤 그 말 개수'] = await countOf(ch, bad)
      out['같은 말 두 번 — 서버 뒤 개수'] = await countOf(ch, twice)
      if ((await countOf(ch, twice)) !== 1) missed.push(`${tag} ${ch.name}: 날아가는 중 같은 말이 ${await countOf(ch, twice)}번 보인다`)
      if ((await countOf(ch, bad)) !== 1) missed.push(`${tag} ${ch.name}: 다시 보낸 말이 ${await countOf(ch, bad)}번 보인다`)
      return out
    }

    // ── 맵 탭 ───────────────────────────────────────────────
    const map: Chan = { name: 'map', input: '.sc-sy__box', send: '.sc-sy__send', log: '.sc-sy__line', fn: 'say' }
    const room0 = await box(page, '.sc-pl__room')
    await page.screenshot({ path: `${OUT}/chat-${tag}-map-kb-closed-empty.png` })
    await page.locator(map.input).tap()
    await RAISE(page, KB)
    await page.waitForTimeout(500)
    const kbVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb').trim())
    const room1 = await box(page, '.sc-pl__room')
    const words = ['하나', '둘', '셋', '넷', '다섯'].map((w) => `${w}${tag}`)
    const mapRows = await burst(map, words)
    await page.waitForTimeout(HOLD_MS + 3500)
    const dupes: Record<string, number> = {}
    for (const w of words) dupes[w] = await countOf(map, w)
    for (const [w, n] of Object.entries(dupes)) if (n !== 1) missed.push(`${tag} map: 「${w}」가 ${n}번 보인다`)
    const mapBar = await box(page, '.sc-sy__bar')
    await page.screenshot({ path: `${OUT}/chat-${tag}-map-kb-open.png` })
    const mapExtra = await dupAndFail(map, `m${tag}`)
    // 닫는다 — 지도를 짚고 키보드를 내린다
    await page.locator('.sc-pl__room').click({ position: { x: 40, y: 120 } })
    await RAISE(page, 0)
    await page.waitForTimeout(600)
    const room2 = await box(page, '.sc-pl__room')
    const logBox = await box(page, '.sc-sy__log')
    const ctBox = await box(page, '.sc-ct')
    await page.screenshot({ path: `${OUT}/chat-${tag}-map-kb-closed.png` })
    if (!same(room0, room1) || !same(room0, room2)) missed.push(`${tag} map: 지도 상자가 움직였다 ${JSON.stringify([room0, room1, room2])}`)
    if (mapBar && mapBar.y + mapBar.h > s.h - KB + 1) missed.push(`${tag} map: 바가 키보드 밑에 있다`)
    if (logBox && room2 && logBox.y + logBox.h > room2.y + room2.h + 1) missed.push(`${tag} map: 로그가 지도 밖(아래)으로 나갔다`)
    report[`${tag} map`] = {
      '--kb(키보드 열림)': kbVar, 지도: [room0, room1, room2], 바: mapBar, 로그: logBox, 조작부: ctBox,
      보내기: mapRows, 서버뒤개수: dupes, ...mapExtra,
    }

    // ── 무전 탭 ─────────────────────────────────────────────
    const radio: Chan = { name: 'radio', input: '#rd-say', send: '.sc-rd__send', log: '.sc-rd__line', fn: 'radio' }
    // 같은 팀이 무전을 켜 둔다 — 파형이 사람 수만큼 흔들려야 한다
    let beating = true
    const beat = (async () => {
      while (beating) {
        for (const tk of mateToks) await must('radioLines', tk, { gameId: game, sinceMs: 0 }).catch(() => undefined)
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()
    await page.locator('.sc-ct__tab').nth(2).click()
    await page.waitForTimeout(3500)
    const empty = (await page.locator('.sc-rd__none').innerText().catch(() => '')).trim()
    const conn = (await page.locator('.sc-rd__conn').innerText().catch(() => '')).trim()
    await page.screenshot({ path: `${OUT}/chat-${tag}-radio-empty.png` })
    if (empty !== '아직 아무도 말하지 않았다') missed.push(`${tag} radio: 빈 목록 문구가 「${empty}」`)

    // 목록을 채운다 — 줄어드는 것과 맨 아래에 붙는 것을 보려면 넘쳐야 한다
    for (let i = 0; i < 14; i++) {
      await must('radio', mateToks[i % mateToks.length], { gameId: game, text: `깔아 둔 무전 ${i + 1} — 식당 뒤 창고로 모이자` })
    }
    await page.waitForTimeout(3500)
    const barClosed0 = await box(page, '.sc-rd__bar')
    await page.screenshot({ path: `${OUT}/chat-${tag}-radio-kb-closed-full.png` })
    await page.locator(radio.input).tap()
    await RAISE(page, KB)
    await page.waitForTimeout(600)
    const rWords = ['가', '나', '다', '라', '마'].map((w) => `무전${w}${tag}`)
    const radioRows = await burst(radio, rWords)
    await page.waitForTimeout(HOLD_MS + 3500)
    const rDupes: Record<string, number> = {}
    for (const w of rWords) rDupes[w] = await countOf(radio, w)
    for (const [w, n] of Object.entries(rDupes)) if (n !== 1) missed.push(`${tag} radio: 「${w}」가 ${n}번 보인다`)
    const rBar = await box(page, '.sc-rd__bar')
    const rLog = await box(page, '.sc-rd__log')
    const rGap = await page.evaluate(() => {
      const el = document.querySelector('.sc-rd__log')!
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)
    })
    const fontPx = await page.evaluate(() => getComputedStyle(document.querySelector('#rd-say')!).fontSize)
    const sendBox = await box(page, '.sc-rd__send')
    await page.screenshot({ path: `${OUT}/chat-${tag}-radio-kb-open.png` })
    if (!rBar || rBar.y + rBar.h > s.h - KB + 1) missed.push(`${tag} radio: 입력줄이 키보드 밑에 있다 ${JSON.stringify(rBar)}`)
    if (rBar && rLog && rLog.y + rLog.h > rBar.y + 1) missed.push(`${tag} radio: 목록이 입력줄 뒤로 들어갔다`)
    if (rGap > 2) missed.push(`${tag} radio: 키보드가 뜬 뒤 목록이 맨 아래에 안 붙었다(${rGap}px)`)
    if (parseFloat(fontPx) < 16) missed.push(`${tag} radio: 입력 글씨가 ${fontPx}`)
    if (!sendBox || sendBox.w !== 44 || sendBox.h !== 44) missed.push(`${tag} radio: 보내기 단추가 ${JSON.stringify(sendBox)}`)
    const radioExtra = await dupAndFail(radio, `r${tag}`)
    // 닫는다
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await RAISE(page, 0)
    await page.waitForTimeout(600)
    const barClosed = await box(page, '.sc-rd__bar')
    const rGap2 = await page.evaluate(() => {
      const el = document.querySelector('.sc-rd__log')!
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)
    })
    await page.screenshot({ path: `${OUT}/chat-${tag}-radio-kb-closed.png` })
    if (!same(barClosed0, barClosed)) missed.push(`${tag} radio: 닫은 뒤 입력줄이 제자리가 아니다 ${JSON.stringify([barClosed0, barClosed])}`)
    beating = false
    await beat
    report[`${tag} radio`] = {
      빈문구: empty, 수신: conn, 입력줄: { 닫힘: barClosed0, 열림: rBar, 다시닫힘: barClosed }, 목록: rLog,
      '열림 맨아래까지': rGap, '닫힘 맨아래까지': rGap2, 글씨: fontPx, 보내기단추: sendBox,
      보내기: radioRows, 서버뒤개수: rDupes, ...radioExtra,
    }
    await ctx.close()
  }

  await browser.close()
  console.log(JSON.stringify(report, null, 1))
  console.log(`\n놓침 ${JSON.stringify(missed, null, 1)}`)
  if (missed.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
