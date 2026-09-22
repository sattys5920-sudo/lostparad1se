// 화면 틀이 보이는 만큼 안에 들어오는가.
//
// 아이폰에서 조작부 한 줄과 탭바가 통째로 툴바 뒤로 밀려났다. 판 화면이
// **보이는 높이가 아니라 「주소창을 숨겼을 때의 높이」**로 서 있었기
// 때문이다(100vh). 여기서는 그 높이를 여러 개로 바꿔 가며, 맨 아래
// 탭바의 밑동이 화면 안에 있는지를 잰다.
//
// 브라우저 창의 높이를 줄이는 것으로 인앱 브라우저의 좁은 화면을
// 흉내 낸다 — 툴바가 차지한 만큼 실제로 보이는 높이가 그만큼이다.
//
//   npx vite-node scripts/frame-shots.ts
import { createHash } from 'node:crypto'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'frame-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }
void createHash

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

/** 틀이 화면 안에 들어왔는가. 좌표로만 본다. */
const FRAME = `(() => {
  const at = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  }
  const root = document.querySelector('.sc-pl-root')
  return {
    화면높이: innerHeight,
    틀높이: root ? Math.round(root.getBoundingClientRect().height) : null,
    틀이잰값: root ? getComputedStyle(root).height : null,
    세로구름: Math.round(document.documentElement.scrollHeight - innerHeight),
    방: at('.sc-pl__room'),
    자원줄: at('.sc-ct__res, .sc-ct > :first-child'),
    십자키: at('.sc-ct__ctl'),
    탭바: at('.sc-ct__tabs'),
  }
})()`

interface Frame {
  화면높이: number
  틀높이: number | null
  틀이잰값: string | null
  세로구름: number
  방: { top: number; bottom: number; h: number } | null
  자원줄: { top: number; bottom: number; h: number } | null
  십자키: { top: number; bottom: number; h: number } | null
  탭바: { top: number; bottom: number; h: number } | null
}

type Page = import('playwright').Page

async function main() {
  const tag = `fr${Date.now()}`
  const game = `fm${tag}`
  const me = `fm${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'fm' })
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
  await must('markMorning', meTok, { gameId: game, read: [1] })

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const sizes: [number, number, string][] = [
    [390, 844, '아이폰'],
    [390, 664, '인앱브라우저'],
    [375, 600, '낮은화면'],
    [360, 540, '아주낮은화면'],
  ]
  const rows: Record<string, unknown>[] = []
  for (const [w, h, name] of sizes) {
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
    await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/fm-${h}-${name}.png` })
    const f = (await page.evaluate(FRAME)) as Frame

    // ── 키보드 ────────────────────────────────────────────
    // 진짜 키보드는 못 띄운다. **키보드가 먹는 높이를 그대로 넣어**
    // 틀이 그만큼 줄어드는지, 조작부가 그 위에 남는지를 본다.
    //
    // 누를 때 화면이 끌려가지 않는 것도 같이 본다 — 전에는 초점이
    // 가면 scrollIntoView 가 화면을 가운데로 당겼다
    const before = (await page.evaluate(
      `JSON.stringify([scrollY, Math.round(document.querySelector('.sc-pl-root').getBoundingClientRect().top)])`,
    )) as string
    await page.locator('.sc-sy__box').click()
    await page.waitForTimeout(700)
    const afterTap = (await page.evaluate(
      `JSON.stringify([scrollY, Math.round(document.querySelector('.sc-pl-root').getBoundingClientRect().top)])`,
    )) as string

    const KB = 300
    await page.evaluate(`document.documentElement.style.setProperty('--kb','${KB}px')`)
    await page.waitForTimeout(500)
    const k = (await page.evaluate(FRAME)) as Frame
    await page.screenshot({ path: `${OUT}/fm-${h}-${name}-키보드.png` })
    await page.evaluate(`document.documentElement.style.removeProperty('--kb')`)

    rows.push({
      화면: `${w}×${h} ${name}`,
      ...f,
      '탭바가화면안': f.탭바 !== null && f.탭바.bottom <= f.화면높이,
      '십자키가화면안': f.십자키 !== null && f.십자키.bottom <= f.화면높이,
      '누를때안끌려간다': before === afterTap,
      키보드: {
        '먹은높이': KB,
        틀높이: k.틀높이,
        '기대': h - KB,
        십자키: k.십자키,
        '십자키가키보드위': k.십자키 !== null && k.십자키.bottom <= h - KB + 1,
        세로구름: k.세로구름,
      },
      터짐: boom,
    })
    await page.close()
  }
  await browser.close()
  console.log(JSON.stringify(rows, null, 1))
  console.log('찍었다')
}

void main()
