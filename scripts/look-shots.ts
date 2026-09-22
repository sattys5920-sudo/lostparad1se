// 겉모습 10단계 — 일곱 장면을 두 크기로, 바꾸기 전과 후로 찍는다.
//
//   실내 · 실외 · 채팅 중 · 방 주인 바뀜 · 시험지 오답 · 방 전환 와이프 · DAY 선택
//
// 앞것은 8898, 뒷것은 8899 에서 뜬다. 같은 판·같은 자리로 두 번 찍어야
// 무엇이 달라졌는지 보인다.
//
//   npx vite-node scripts/look-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITES = { 전: 'http://127.0.0.1:8898/lostparad1se', 후: 'http://127.0.0.1:8899/lostparad1se' }
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'look-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false as const, err: j.error.message } : { ok: true as const, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown) {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result
}

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

const tokenFor = (host: string, pwd: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: pwd })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 방 주인을 직접 갈아 끼운다. 화면이 이 변화를 어떻게 알리는지만 본다 */
async function setOwner(game: string, tile: string, team: string | null): Promise<void> {
  const value = team === null ? { nullValue: null } : { stringValue: team }
  const r = await fetch(
    `${FS}/games/${game}/tiles/${tile}?updateMask.fieldPaths=ownerTeam`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { ownerTeam: value } }) },
  )
  if (!r.ok) throw new Error(`주인 못 바꿈: ${r.status} ${await r.text()}`)
}

async function logIn(page: Page, site: string, game: string, id: string): Promise<void> {
  await page.goto(`${site}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
}

async function main() {
  const boom: string[] = []
  const missed: string[] = []
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const [tag, site] of Object.entries(SITES)) {
    for (const size of [{ w: 375, h: 667 }, { w: 390, h: 844 }]) {
      // 판을 장면마다 새로 만든다. 한 판을 이어 쓰면 앞 장면이 남는다
      const game = `lk${Date.now()}${size.w}`
      const me = `lk${String(Date.now()).slice(-6)}${size.w}`
      const host = await hostToken(game)
      await must('createGame', host, { gameId: game, seed: 'lk' })
      await must('signUpAccount', host, { id: me, password: MY_PW })
      const tok = tokenFor(host, MY_PW)
      const meTok = await tok(me)
      await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
      await must('joinGame', meTok, { gameId: game, name: '수아' })
      await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
      // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
      await must('assignAll', host, { gameId: game })
      await must('startGame', host, { gameId: game, startAtMs: START })
      await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
      await must('tick', host, { gameId: game })

      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
      })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => boom.push(`${tag}${size.w}: ${e.message}`))
      const shot = (n: string) => page.screenshot({ path: `${OUT}/look-${size.w}-${n}-${tag}.png` })

      // ── 7. DAY 선택 (아침 시퀀스) — 표시를 지우기 전에 찍는다 ──
      await logIn(page, site, game, me)
      const morning = await page
        .waitForSelector('.sc-rv', { timeout: 15000 })
        .then(() => true)
        .catch(() => false)
      if (morning) {
        await page.waitForTimeout(900)
        await shot('DAY선택')
      } else missed.push(`${tag}${size.w}:DAY선택`)

      // 아침을 치우고 오늘 화면으로
      await must('markMorning', meTok, { gameId: game, read: [1] })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(1800)

      // ── 1. 실내 ──
      await shot('실내')

      // ── 3. 채팅 중 — 봇이 먼저 몇 줄 남기고, 칸에 초점을 준다 ──
      const bots = ['qa01', 'qa02', 'qa03', 'qa04', 'qa05', 'qa06']
      let said = 0
      for (const b of bots) {
        const bt = await tokenFor(host, QA_PW)(b).catch(() => null)
        if (!bt) continue
        const r = await call('say', bt, { gameId: game, text: `${b} 여기 있다` })
        if (r.ok) said += 1
      }
      if (said < 3) missed.push(`${tag}${size.w}:채팅(${said}줄)`)
      await page.locator('.sc-sy__box').click().catch(() => undefined)
      await page.waitForTimeout(3200)
      await shot('채팅중')
      // 칸에서 손을 뗀다. **지도를 누르면 안 된다** — 그 방 시트가
      // 열리고, 그 시트가 탭바를 덮어 뒤의 탭 누르기가 통째로 먹힌다
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.waitForTimeout(700)

      // ── 4. 방 주인 바뀜 — 바닥 번쩍과 간판 옆 깃발 ──
      const here = await page.evaluate(() => document.querySelector('.sc-pl__where')?.textContent ?? '')
      await setOwner(game, 'centralPlaza', 'C').catch((e) => missed.push(`${tag}${size.w}:주인(${(e as Error).message})`))
      await page.waitForTimeout(120)
      await shot('주인바뀜')
      await page.waitForTimeout(900)
      await shot('깃발')
      if (here === '') missed.push(`${tag}${size.w}:방이름`)

      // 시험지는 따로 찍는다(scripts/quiz-shots.ts). 아침을 지나고
      // 화면을 다시 불러온 이 판에서는 탭이 「나」로 안 넘어간다

      // ── 6. 방 전환 와이프 · 2. 실외 ──
      const gone = await call('roamTo', meTok, { gameId: game, tileId: 'garden' })
      if (gone.ok) {
        // 도착하는 순간을 놓치지 않으려고 짧게 여러 장 찍는다
        for (let i = 0; i < 26; i += 1) {
          await page.screenshot({ path: `${OUT}/wipe/${size.w}-${tag}-${String(i).padStart(2, '0')}.png` })
          await page.waitForTimeout(70)
        }
        await page.waitForTimeout(1500)
        await shot('실외')
      } else missed.push(`${tag}${size.w}:실외(${gone.err})`)

      await ctx.close()
    }
  }

  await browser.close()
  console.log('터짐', JSON.stringify(boom))
  console.log('놓침', JSON.stringify(missed))
  console.log('찍었다')
}

void main()
