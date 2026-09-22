// 메모 탭(수첩)과 팀장 공지를 찍고 재 본다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//   4. npx vite-node scripts/note-shots.ts
import { createHash } from 'node:crypto'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'note-shot-pass1'
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

/** 내 팀과, 우리 팀 팀장 투표가 닫히는 시각. */
async function myTeamVote(gameId: string, meId: string): Promise<{ team: string; closesAtMs: number } | null> {
  type Val = {
    stringValue?: string
    integerValue?: string
    doubleValue?: number
    mapValue?: { fields?: Record<string, Val> }
    arrayValue?: { values?: Val[] }
  }
  const game = (await (await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })).json()) as {
    fields?: Record<string, Val>
  }
  let team = ''
  for (const s of game.fields?.seats?.arrayValue?.values ?? []) {
    if (s.mapValue?.fields?.playerId?.stringValue === meId) team = s.mapValue?.fields?.team?.stringValue ?? ''
  }
  if (!team) return null
  const t = (await (await fetch(`${FS}/games/${gameId}/teams/${team}`, { headers: ADMIN })).json()) as {
    fields?: Record<string, Val>
  }
  const v = t.fields?.captainVote?.mapValue?.fields
  if (!v) return null
  const closes = Number(v.closesAtMs?.integerValue ?? v.closesAtMs?.doubleValue ?? 0)
  return closes > 0 ? { team, closesAtMs: closes } : null
}

/** 판 문서가 들고 있는 팀장 넷. 서버가 적은 그대로 본다. */
/** 그 팀 사람들. 나는 뺀다. */
async function teammates(gameId: string, team: string, meId: string): Promise<{ id: string; name: string }[]> {
  type Val = { stringValue?: string; mapValue?: { fields?: Record<string, Val> }; arrayValue?: { values?: Val[] } }
  const game = (await (await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })).json()) as {
    fields?: Record<string, Val>
  }
  const out: { id: string; name: string }[] = []
  for (const s of game.fields?.seats?.arrayValue?.values ?? []) {
    const f = s.mapValue?.fields
    const id = f?.playerId?.stringValue ?? ''
    if (f?.team?.stringValue !== team || id === meId || id === '') continue
    out.push({ id, name: f?.name?.stringValue ?? '' })
  }
  return out
}

async function captainsOf(gameId: string): Promise<Record<string, string | null>> {
  type Val = { stringValue?: string; nullValue?: null; mapValue?: { fields?: Record<string, Val> } }
  const game = (await (await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })).json()) as {
    fields?: Record<string, Val>
  }
  const out: Record<string, string | null> = {}
  for (const [t, v] of Object.entries(game.fields?.captains?.mapValue?.fields ?? {})) {
    out[t] = v.stringValue ?? null
  }
  return out
}

type Page = import('playwright').Page

async function shoot(w: number, h: number, browser: import('playwright').Browser) {
  const tag = `${w}`
  const game = `nt${tag}${Date.now()}`
  const me = `nt${tag}${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'nt' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await asPlayer(host, me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: SEED_PW, leaveSeats: 0 })
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })

  const page: Page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(1200)

  // 메모 탭
  await page.locator('.sc-ct__tab').nth(4).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/nt-${tag}-1-수첩.png` })
  await page.locator('.sc-ar__person-note').first().click()
  await page.locator('.sc-ar__person-note').first().type('쉬는 시간에 혼자 있었다', { delay: 25 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/nt-${tag}-2-적는중.png` })
  const note = await page.evaluate(`(() => {
    const page = document.querySelector('.sc-nb__page')
    const rings = document.querySelector('.sc-nb__rings')
    const first = document.querySelector('.sc-ar__person')
    const inp = document.querySelector('.sc-ar__person-note')
    const sel = document.querySelector('.sc-ar__guess')
    const pr = page.getBoundingClientRect()
    const rr = rings.getBoundingClientRect()
    const ir = inp.getBoundingClientRect()
    const sr = sel.getBoundingClientRect()
    const cs = getComputedStyle(rings)
    return {
      사람수: document.querySelectorAll('.sc-ar__person').length,
      종이폭: Math.round(pr.width),
      화면폭: window.innerWidth,
      스프링이종이를문다: Math.round(rr.left) < Math.round(pr.left) && Math.round(rr.right) > Math.round(pr.left),
      스프링화소: cs.imageRendering,
      스프링칸: cs.backgroundSize,
      메모높이: Math.round(ir.height),
      메모글씨: getComputedStyle(inp).fontSize,
      태그높이: Math.round(sr.height),
      가로구름: document.documentElement.scrollWidth - window.innerWidth,
      첫칸높이: Math.round(first.getBoundingClientRect().height),
    }
  })()`)

  // 치는 동안에는 탭바가 숨는다. 사람이 하듯 먼저 손을 뗀다
  await page.evaluate(`document.activeElement && document.activeElement.blur()`)
  await page.waitForTimeout(400)

  // ── 팀장 투표까지 밀어 넣는다 ─────────────────────────────
  // **DAY 1 에는 투표가 없다.** 3인 팀 주장은 시작할 때 앉는다 —
  // 뽑히는 것을 보려면 하루를 넘겨야 한다
  // **한 번 민다고 하루가 넘어가지 않는다.** 예정표의 다음 한 칸을
  // 밀 뿐이라, 날짜가 바뀔 때까지 되풀이한다
  for (let i = 0; i < 14; i += 1) {
    const r = await must('pushDay', host, { gameId: game })
    if (Number(r.day ?? 1) >= 2) break
    if (r.pushed === null && r.next === null) break
  }
  await new Promise((r) => setTimeout(r, 600))
  const mine = await myTeamVote(game, uidOf(me))
  let elected = ''
  if (mine) {
    // 창이 열린 동안으로 시계를 옮기고 한 표를 던진다
    await must('setDevClock', host, { gameId: game, anchorGameMs: mine.closesAtMs - 60_000, speed: 1 })
    const mates = await teammates(game, mine.team, uidOf(me))
    elected = mates[0]?.name ?? ''
    if (mates[0]) await must('voteCaptain', meTok, { gameId: game, targetId: mates[0].id })
    // 창이 닫힌 뒤로 옮기면 따라잡기가 표를 센다
    await must('setDevClock', host, { gameId: game, anchorGameMs: mine.closesAtMs + 60_000, speed: 1 })
    await must('tick', host, { gameId: game })
    await page.waitForTimeout(2500)
  }
  const caps = await captainsOf(game)
  const capCount = Object.values(caps).filter((x) => typeof x === 'string' && x !== '').length

  // 나 탭 — 알림이 뜨는가
  await page.locator('.sc-ct__tab').nth(1).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/nt-${tag}-3-알림.png` })
  const notices = (await page.locator('.sc-pl__notices li').allTextContents()).map((t) => t.trim())

  // 투표 탭 — 팀장 줄과, 종이에서 팀장이 빠졌는가
  await page.locator('.sc-ct__tab').nth(3).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/nt-${tag}-4-투표.png` })
  const ballot = await page.evaluate(`(() => ({
    이름수: document.querySelectorAll('.sc-bt__name').length,
    팀장줄: (document.querySelector('.sc-cv--done')?.textContent ?? '').trim(),
  }))()`)

  // 무전 탭 — 팀장 시스템 줄
  await page.locator('.sc-ct__tab').nth(2).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/nt-${tag}-5-무전.png` })
  const sys = (await page.locator('.sc-rd__sys').allTextContents()).map((t) => t.trim())

  console.log(
    JSON.stringify(
      {
        화면: `${w}×${h}`,
        팀장: caps,
        뽑은사람: elected,
        수첩: note,
        알림: notices,
        투표: ballot,
        기대이름수: 13 - capCount + (Object.values(caps).includes(uidOf(me)) ? 1 : 0),
        무전팀장줄: sys.filter((t) => t.includes('팀장')),
        터짐: boom,
      },
      null,
      1,
    ),
  )
  await page.close()
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  await shoot(375, 667, browser)
  await shoot(390, 844, browser)
  await browser.close()
  console.log('찍었다')
}

void main()
