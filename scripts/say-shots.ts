// 말줄 — 아무것도 안 눌러도 거기 있는가, 혼자여도 말이 되는가.
//
//   npx vite-node scripts/say-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'say-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }
/** 아무도 없는 방. 2-3 교실에는 열넷이 다 서 있다 */
const ALONE = 'artRoom'

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

const LOOK = `(() => {
  const at = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  }
  const box = document.querySelector('.sc-sy__box')
  const send = document.querySelector('.sc-sy__send')
  return {
    말줄있나: !!box,
    누르지않고보이나: box ? box.getBoundingClientRect().height > 0 : false,
    칸이꺼졌나: box ? box.disabled : null,
    안내말: box ? box.placeholder : null,
    글씨: box ? getComputedStyle(box).fontSize : null,
    보내기높이: send ? Math.round(send.getBoundingClientRect().height) : null,
    말줄: at('.sc-sy'),
    탭바: at('.sc-ct__tabs'),
    화면높이: innerHeight,
    세로구름: Math.round(document.documentElement.scrollHeight - innerHeight),
    격자에말있나: [...document.querySelectorAll('.sc-ct__act')].some((b) => b.textContent.includes('말')),
    남은줄: [...document.querySelectorAll('.sc-sy__line')].map((e) => e.textContent.trim()),
    풍선: [...document.querySelectorAll('.sc-wk__say')]
      .filter((e) => getComputedStyle(e).display !== 'none')
      .map((e) => {
        const r = e.getBoundingClientRect()
        const map = document.querySelector('.sc-wk').getBoundingClientRect()
        return {
          글: e.textContent.trim(),
          지도안: r.top >= map.top - 1 && r.bottom <= map.bottom + 1 && r.left >= map.left - 1 && r.right <= map.right + 1,
          안눌린다: getComputedStyle(e).pointerEvents === 'none',
        }
      }),
  }
})()`

interface Look {
  말줄있나: boolean
  누르지않고보이나: boolean
  칸이꺼졌나: boolean | null
  안내말: string | null
  글씨: string | null
  보내기높이: number | null
  말줄: { top: number; bottom: number; h: number } | null
  탭바: { top: number; bottom: number; h: number } | null
  화면높이: number
  세로구름: number
  격자에말있나: boolean
  남은줄: string[]
  풍선: { 글: string; 지도안: boolean; 안눌린다: boolean }[]
}

type Page = import('playwright').Page

async function main() {
  const tag = `sy${Date.now()}`
  const game = `sy${tag}`
  const me = `sy${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'sy' })
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
  await must('openAllTiles', host, { gameId: game }).catch(() => ({}))

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page: Page = await browser.newPage({
    viewport: { width: 390, height: 664 },
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
  await page.waitForTimeout(1500)

  // 1 · 아무것도 안 눌렀는데 있는가
  const first = (await page.evaluate(LOOK)) as Look
  await page.screenshot({ path: `${OUT}/sy-1-그냥떠있다.png` })

  // 2 · 혼자인 방으로 간다. **사람이 없어도 말은 되어야 한다**
  await must('roamTo', meTok, { gameId: game, tileId: ALONE })
  await page.waitForTimeout(1800)
  const aloneLook = (await page.evaluate(LOOK)) as Look

  // 손가락으로만 친다. 엔터는 안 쓴다. 여섯 줄을 치면 다섯만 남아야 한다
  const said = ['아무도 없네', '여기 조용하다', '누가 왔었나', '이젤이 하나', '창밖이 밝다', '가 봐야겠다']
  for (const [i, t] of said.entries()) {
    await page.locator('.sc-sy__box').click()
    await page.locator('.sc-sy__box').type(t, { delay: 15 })
    if (i === 0) await page.screenshot({ path: `${OUT}/sy-2-치는중.png` })
    await page.locator('.sc-sy__send').click()
    await page.waitForTimeout(900)
  }
  await page.waitForTimeout(1200)
  const sent = (await page.evaluate(LOOK)) as Look
  // **손을 뗀 뒤에 재야 한다.** 치는 동안에는 탭바가 숨으므로,
  // 그때 재면 「화면 안에 있다」가 0 을 보고 통과해 버린다
  await page.evaluate(`document.activeElement && document.activeElement.blur()`)
  await page.waitForTimeout(600)
  const after = (await page.evaluate(LOOK)) as Look
  await page.screenshot({ path: `${OUT}/sy-3-혼자말했다.png` })

  // 3 · 떠 있는 줄을 누르면 전체가 열리는가
  await page.locator('.sc-sy__peek').click()
  await page.waitForTimeout(900)
  const sheet = await page.locator('.sc-ch').count()
  await page.screenshot({ path: `${OUT}/sy-4-펴본다.png` })

  // 풍선은 잠깐이다. 시간이 지나면 사라져야 한다
  await page.waitForTimeout(9000)
  const later = (await page.evaluate(LOOK)) as Look

  console.log(
    JSON.stringify(
      {
        '들어오자마자': {
          말줄있나: first.말줄있나,
          누르지않고보이나: first.누르지않고보이나,
          격자에말있나: first.격자에말있나,
          안내말: first.안내말,
          글씨: first.글씨,
          보내기높이: first.보내기높이,
        },
        '혼자일때': { 칸이꺼졌나: aloneLook.칸이꺼졌나, 안내말: aloneLook.안내말 },
        '여섯줄치고나서': {
          친것: said.length,
          남은줄수: sent.남은줄.length,
          남은줄: sent.남은줄,
          풍선: sent.풍선,
        },
        '조금뒤': { 풍선: later.풍선 },
        '전체창열렸나': sheet > 0,
        틀: {
          화면높이: after.화면높이,
          세로구름: after.세로구름,
          말줄: after.말줄,
          탭바: after.탭바,
          탭바가화면안: after.탭바 !== null && after.탭바.h > 0 && after.탭바.bottom <= after.화면높이,
          '치는동안탭바숨나': sent.탭바 !== null && sent.탭바.h === 0,
        },
        터짐: boom,
      },
      null,
      1,
    ),
  )
  await browser.close()
  console.log('찍었다')
}

void main()
