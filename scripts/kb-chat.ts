// 채팅과 키보드 — **키보드가 떠도 아무것도 안 움직이는가.**
//
// 열릴 때 일어나야 하는 일은 딱 셋이다:
//   1) 말줄이 키보드를 따라 올라가며 입력칸이 된다
//   2) 로그가 세 줄에서 다섯 줄로 펼쳐진다
//   3) 필요할 때만 카메라가 위로 밀린다
// 그 밖에는 지도도 자원 줄도 십자키도 탭바도 한 픽셀도 안 움직인다.
//
//   npx vite-node scripts/kb-chat.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'alone-say-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }
/** 스크린샷의 그 방 */
const ROOM = 'newBuilding'

async function call(name: string, tk: string | null, data: unknown): Promise<{ ok: boolean; result?: Record<string, unknown>; err?: string }> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false, err: j.error.message } : { ok: true, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result ?? {}
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

/** 키보드가 먹었다고 칠 높이. 한글 키보드가 대충 이만하다 */
const KB = 300

/** 재는 것들. 지도 상자는 **한 픽셀도** 안 움직여야 한다 */
const LOOK = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const seen = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const st = getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0
  }
  const tappable = (sel) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).pointerEvents !== 'none' : null
  }
  const bar = document.querySelector('.sc-sy')
  const input = document.querySelector('.sc-sy__box')
  return {
    지도: box('.sc-pl__room'),
    캔버스: box('.sc-wk__canvas'),
    자원줄: box('.sc-ct__bar'),
    십자키: box('.sc-ct__ctl'),
    탭바: box('.sc-ct__tabs'),
    말줄: box('.sc-sy'),
    바: box('.sc-sy__bar'),
    로그줄수: document.querySelectorAll('.sc-sy__line').length,
    로그배경: (() => { const e = document.querySelector('.sc-sy__log'); return e ? getComputedStyle(e).backgroundColor : null })(),
    채팅모드: bar ? bar.classList.contains('is-open') : null,
    글씨: input ? getComputedStyle(input).fontSize : null,
    칸막힘: input ? input.disabled : null,
    칸값: input ? input.value : null,
    초점: document.activeElement ? document.activeElement.className : null,
    안내말: input ? input.placeholder : null,
    상한: input ? input.maxLength : null,
    보인다: { 자원줄: seen('.sc-ct__bar'), 십자키: seen('.sc-ct__ctl'), 탭바: seen('.sc-ct__tabs') },
    눌린다: { 자원줄: tappable('.sc-ct__bar'), 십자키: tappable('.sc-ct__ctl'), 탭바: tappable('.sc-ct__tabs') },
    화면: { w: innerWidth, h: innerHeight },
    세로구름: Math.round(document.documentElement.scrollHeight - innerHeight),
    끌린높이: Math.round(window.scrollY),
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
  }
})()`

interface Box { x: number; y: number; w: number; h: number }
interface Look {
  칸막힘: boolean | null; 칸값: string | null; 초점: string | null
  지도: Box | null; 캔버스: Box | null; 자원줄: Box | null; 십자키: Box | null
  탭바: Box | null; 말줄: Box | null; 바: Box | null
  로그줄수: number; 로그배경: string | null; 채팅모드: boolean | null
  글씨: string | null; 안내말: string | null; 상한: number | null
  보인다: Record<string, boolean | null>; 눌린다: Record<string, boolean | null>
  화면: { w: number; h: number }; 세로구름: number; 끌린높이: number; kb: string
}

const same = (a: Box | null, b: Box | null) =>
  a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** 아이폰이 하는 것과 같은 일을 시킨다: 보이는 창을 줄이고 알린다 */
const RAISE = (px: number) => `(() => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - ${px} })
  vv.dispatchEvent(new Event('resize'))
})()`

async function main() {
  const game = `kb${Date.now()}`
  const me = `kb${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'kb' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  /*
   * **로그를 미리 채운다.** 비어 있으면 세 줄이 다섯 줄로 펼쳐지는
   * 것을 잴 수가 없다 — 0 과 0 을 비교하고 통과해 버린다.
   */
  const botTok = tokenFor(host, QA_PW)
  const myRoom = String(((await must('chatLines', meTok, { gameId: game })) as { here?: string }).here ?? '')
  let seeded = 0
  for (let i = 1; i <= 13 && seeded < 6; i += 1) {
    const tok = await botTok(`qa${String(i).padStart(2, '0')}`)
    const here = String(((await must('chatLines', tok, { gameId: game })) as { here?: string }).here ?? '')
    if (here !== myRoom) continue
    await must('say', tok, { gameId: game, text: `깔아 둔 말 ${seeded + 1}` })
    seeded += 1
  }
  if (seeded < 6) throw new Error(`같은 방에서 ${seeded} 줄밖에 못 깔았다. 3↔5 펼침을 재지 못한다`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const out: Record<string, unknown>[] = []
  const boom: string[] = []

  for (const size of [
    { w: 375, h: 667, 이름: '375×667 SE' },
    { w: 390, h: 844, 이름: '390×844' },
    { w: 430, h: 932, 이름: '430×932' },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => boom.push(`${size.이름}: ${e.message}`))

    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
    await page.fill('#gt-id', me)
    await page.fill('#gt-pw', MY_PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1600)

    // ── 1 · 평소 ────────────────────────────────────────────
    const 평소 = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/kb-${size.w}-1-평소.png` })

    // ── 2 · 채팅 모드 ───────────────────────────────────────
    await page.locator('.sc-sy__box').click()
    await page.evaluate(RAISE(KB))
    // 전환이 0.25초다. 다 올라간 뒤에 잰다
    await page.waitForTimeout(700)
    const 열림 = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/kb-${size.w}-2-키보드.png` })

    // ── 3 · 두 번 보낸다. 키보드가 유지되는가 ───────────────
    await page.locator('.sc-sy__box').type('하나', { delay: 20 })
    await page.locator('.sc-sy__send').click()
    await page.waitForTimeout(700)
    const 보낸뒤 = (await page.evaluate(LOOK)) as Look
    await page.locator('.sc-sy__box').type('둘', { delay: 20 })
    await page.locator('.sc-sy__send').click()
    await page.waitForTimeout(900)
    const 두번뒤 = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/kb-${size.w}-3-두번보냄.png` })

    /*
     * ── 3.5 · 카메라 밀기 ─────────────────────────────────
     *
     * 카메라가 캐릭터를 세로 가운데 두므로 보통은 바 위에 있어서 안
     * 민다(그게 맞다 — 쓸데없는 움직임이 제일 거슬린다). 낮은 화면에
     * 높은 키보드를 얹어 **밀어야만 하는 자리**를 만든다.
     *
     * 재는 것: 지도 상자는 그대로인데 캔버스 그림만 바뀌었는가.
     * 그래야 「크기도 배율도 안 바뀌고 카메라만 움직였다」가 된다.
     */
    let 카메라: Record<string, unknown> | null = null
    if (size.w === 375) {
      const 전그림 = (await page.locator('.sc-wk__canvas').screenshot()).toString('base64')
      const 전 = (await page.evaluate(LOOK)) as Look
      await page.evaluate(RAISE(430))
      await page.waitForTimeout(800)
      const 후 = (await page.evaluate(LOOK)) as Look
      const 후그림 = (await page.locator('.sc-wk__canvas').screenshot()).toString('base64')
      await page.screenshot({ path: `${OUT}/kb-${size.w}-35-카메라.png` })
      카메라 = {
        '지도 상자 그대로': same(전.지도, 후.지도),
        '캔버스 상자 그대로': same(전.캔버스, 후.캔버스),
        '그림이 움직였나': 전그림 !== 후그림,
        '바가 더 올라갔나': 전.말줄 !== null && 후.말줄 !== null && 후.말줄.y < 전.말줄.y,
      }
      await page.evaluate(RAISE(KB))
      await page.waitForTimeout(600)
    }

    // ── 4 · 맵을 짚어 닫는다 ────────────────────────────────
    await page.locator('.sc-pl__room').click({ position: { x: 40, y: 60 } })
    await page.evaluate(RAISE(0))
    await page.waitForTimeout(700)
    const 닫힘 = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/kb-${size.w}-4-닫힘.png` })

    const 키보드선 = size.h - KB
    out.push({
      화면: size.이름,
      '움직이지 않았나': {
        지도: same(평소.지도, 열림.지도),
        캔버스: same(평소.캔버스, 열림.캔버스),
        자원줄: same(평소.자원줄, 열림.자원줄),
        십자키: same(평소.십자키, 열림.십자키),
        탭바: same(평소.탭바, 열림.탭바),
        '닫고 나서 지도': same(평소.지도, 닫힘.지도),
      },
      '평소': {
        바높이: 평소.바?.h, 로그줄수: 평소.로그줄수, 로그배경: 평소.로그배경,
        채팅모드: 평소.채팅모드, 안내말: 평소.안내말,
      },
      '채팅 모드': {
        바높이: 열림.바?.h, 로그줄수: 열림.로그줄수, 로그배경: 열림.로그배경,
        채팅모드: 열림.채팅모드, kb: 열림.kb,
        '바가 키보드 위': 열림.말줄 !== null && 열림.말줄.y + 열림.말줄.h <= 키보드선 + 1,
        '바 아랫변': 열림.말줄 === null ? null : 열림.말줄.y + 열림.말줄.h,
        '키보드 윗변': 키보드선,
      },
      '덮이되 사라지지 않는다': {
        보인다: 열림.보인다,
        눌린다: 열림.눌린다,
      },
      '보낸 뒤': {
        '채팅모드 유지': 보낸뒤.채팅모드 === true && 두번뒤.채팅모드 === true,
        '두 줄 다 들어왔나': 두번뒤.로그줄수 >= 2,
      },
      '카메라': 카메라,
      '닫은 뒤': { 바높이: 닫힘.바?.h, 로그줄수: 닫힘.로그줄수, 채팅모드: 닫힘.채팅모드 },
      '칸': { 글씨: 평소.글씨, 상한: 평소.상한 },
      '틀': { 세로구름: 열림.세로구름, 끌린높이: 열림.끌린높이 },
    })
    await ctx.close()
  }

  console.log(JSON.stringify(out, null, 1))
  console.log('터짐', JSON.stringify(boom))
  await browser.close()
  console.log('찍었다')
}

void main()
