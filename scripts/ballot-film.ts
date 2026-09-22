// 투표 한 판을 통째로 찍는다 — 들어가서, 적고, 접어 넣고, 다시 꺼내고,
// 마감될 때까지.
//
// 캡처 한 장으로는 연출이 안 보인다. **실제로 돌아가는 화면을 그대로
// 녹화한다** — 느리게 돌리는 장치를 앱에 심지 않는다.
//
// 아홉 교시는 녹화 전에 미리 열고 닫는다. 그래야 녹화 중에 마지막
// 교시 하나만 여닫으면 되고, 화면이 멈춘 채로 40초를 보내지 않는다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//   4. npx vite-node scripts/ballot-film.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/film'

const MY_PW = 'ballot-film-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

const FACE = {
  styleSet: 'F',
  hairStyle: 'F03',
  hairColor: 2,
  expression: 1,
  outfit: 2,
  wearStyle: 0,
  bottom: 1,
  neckwear: 1,
}

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

/**
 * 적을 수 있는 이름 둘을 고른다.
 *
 * **화면은 다른 팀 팀장을 모른다.** 그래서 종이에는 올라오지만 서버는
 * 물린다 — 영상에서 그걸 밟으면 이야기가 딴 데로 샌다. 여기서는
 * 에뮬레이터 안을 직접 들여다보고 안전한 이름만 고른다.
 */
async function safeNames(gameId: string, meAccountId: string): Promise<string[]> {
  const meId = uidOf(meAccountId)
  type Val = { stringValue?: string; mapValue?: { fields: Record<string, Val> }; arrayValue?: { values?: Val[] } }
  const teams = (await (await fetch(`${FS}/games/${gameId}/teams`, { headers: ADMIN })).json()) as {
    documents?: { fields?: Record<string, Val> }[]
  }
  const captains = new Set(
    (teams.documents ?? []).map((d) => d.fields?.captainId?.stringValue ?? '').filter((x) => x !== ''),
  )
  const game = (await (await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })).json()) as {
    fields?: Record<string, Val>
  }
  const seats = game.fields?.seats?.arrayValue?.values ?? []
  const out: string[] = []
  for (const s of seats) {
    const id = s.mapValue?.fields.playerId?.stringValue ?? ''
    const name = s.mapValue?.fields.name?.stringValue ?? ''
    if (id === meId || captains.has(id) || name === '') continue
    out.push(name)
  }
  return out
}

/** 손끝이 닿은 자리에 동그라미를 한 번 그린다. 영상에서만 쓴다. */
const FINGER = `
document.addEventListener('pointerdown', (e) => {
  const d = document.createElement('div')
  d.style.cssText = [
    'position:fixed', 'left:' + (e.clientX - 22) + 'px', 'top:' + (e.clientY - 22) + 'px',
    'width:44px', 'height:44px', 'border:2px solid #E8D9A0', 'border-radius:50%',
    'pointer-events:none', 'z-index:99999', 'opacity:0.9',
    'transition:transform .45s ease-out, opacity .45s ease-out',
  ].join(';')
  document.body.appendChild(d)
  requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0' })
  setTimeout(() => d.remove(), 500)
}, true)
`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const tag = `film${Date.now()}`
  const game = `bf${tag}`
  const me = `bf${String(Date.now()).slice(-6)}`

  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'bf' })
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
  // 아침 진상은 이미 본 것으로 둔다. 영상은 투표 이야기다
  await must('markMorning', meTok, { gameId: game, read: [1] })

  // 아홉 교시를 미리 돌린다. 녹화 중에는 마지막 하나만 여닫는다
  for (let i = 0; i < 9; i += 1) {
    await must('openPhase', host, { gameId: game })
    await must('closePhase', host, { gameId: game })
  }
  const names = await safeNames(game, me)
  console.log(`판 ${game} · 적을 수 있는 이름 ${names.length}: ${names.slice(0, 4).join(' ')}`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
  })
  await ctx.addInitScript(FINGER)
  const page = await ctx.newPage()
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))

  const beat = (ms: number) => page.waitForTimeout(ms)

  // ── 1 · 들어간다 ─────────────────────────────────────────
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await beat(1400)
  await page.locator('#gt-id').click()
  await page.locator('#gt-id').type(me, { delay: 55 })
  await beat(250)
  await page.locator('#gt-pw').click()
  await page.locator('#gt-pw').type(MY_PW, { delay: 45 })
  await beat(500)
  await page.locator('.sc-gt__submit').click()
  await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
  // 「홈 화면에 추가」 안내가 탭바를 덮는다. 사람이 하듯 먼저 닫는다
  await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
  await beat(1600)

  // ── 2 · 투표 탭 ──────────────────────────────────────────
  await page.locator('.sc-ct__tab').nth(3).click()
  await beat(2000)

  // ── 3 · 이름을 고른다 ────────────────────────────────────
  const pick = async (name: string) => {
    // 단추 안에는 이름과 ✓ 가 같이 들어 있다. 이름 칸만 짚는다
    await page.locator('.sc-bt__name > span').filter({ hasText: new RegExp(`^${name}$`) }).first().click()
  }
  await pick(names[2] ?? names[0])
  await beat(1500)

  // ── 4 · 접어서 넣는다 ────────────────────────────────────
  await page.locator('.sc-bt__go').click()
  // 연출 1.4초 + 「넣었다.」 1.6초 + 쉬는 화면
  await beat(4200)

  // ── 5 · 다시 꺼낸다 ──────────────────────────────────────
  await page.locator('.sc-bt__again').click()
  await beat(2200)

  // ── 6 · 다른 이름으로 바꿔 넣는다 ────────────────────────
  await pick(names[5] ?? names[1])
  await beat(1400)
  await page.locator('.sc-bt__go').click()
  await beat(4200)

  // ── 7 · 마지막 교시가 열린다 — 「마감까지 n분」 ──────────
  await must('openPhase', host, { gameId: game })
  await beat(3200)

  // ── 8 · 닫히면 표가 세어진다 — 자물쇠 ────────────────────
  await must('closePhase', host, { gameId: game })
  await beat(4000)

  const end = (await page.evaluate(`document.querySelector('.sc-bt__done')?.textContent ?? ''`)) as string
  console.log(JSON.stringify({ 끝화면: end, 터짐: boom }))

  await page.close()
  await ctx.close()
  await browser.close()
  console.log('찍었다')
}

void main()
