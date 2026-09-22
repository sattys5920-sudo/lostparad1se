// 무전 탭 — 다섯 모습과 다섯 가지 확인.
//
// 판을 세우고 시작까지 밀어 넣은 뒤 창 하나로 찍는다. 같은 팀 사람은
// **창을 띄우지 않고 서버만 두드린다** — 「수신 n」이 세는 것이 바로
// 그 두드림이다(무전을 가져가는 일 자체가 맥이다). 창을 둘 띄우면
// 아침 넘기기부터 다시 하느라 느리고 잘 엉킨다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//   4. npx vite-node scripts/radio-shots.ts
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

/** 판은 **크기마다 새로 세운다.** 한 판을 나눠 쓰면 앞 크기에서 켜 둔
 *  맥이 25초 안 지났을 때 뒤 크기의 「혼자」가 「수신 3」으로 찍힌다 */
let GAME = ''
const MY_PW = 'radio-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
const FACE = {
  styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1,
  outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1,
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

async function hostToken(): Promise<string> {
  const email = `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@x.test`
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

async function asPlayer(host: string, id: string, password: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 판 문서를 직접 읽는다. 누가 어느 팀인지 알아야 같은 팀을 고른다 */
async function seatsOf(): Promise<{ playerId: string; name: string; team: string }[]> {
  const r = await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })
  const j = (await r.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } }[] } } }
  }
  return (j.fields?.seats?.arrayValue?.values ?? []).map((v) => ({
    playerId: v.mapValue?.fields?.playerId?.stringValue ?? '',
    name: v.mapValue?.fields?.name?.stringValue ?? '',
    team: v.mapValue?.fields?.team?.stringValue ?? '',
  }))
}

type Page = import('playwright').Page

/** 문을 지나 아침을 넘기고 판 화면까지 간다. 사람이 하는 것과 같은 길이다 */
async function enter(page: Page, id: string, password: string): Promise<void> {
  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#gt-id', { timeout: 20_000 })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', password)
  await page.click('.sc-gt__submit')
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(800)
}

/** 무전 탭으로 간다. 탭 차례는 맵·나·무전·투표·메모 */
const toRadio = (page: Page) => page.locator('.sc-ct__tab').nth(2).click()

/** 막대 열셋의 높이를 여러 번 재서 가장 큰 것과 가장 작은 것의 차를 본다 */
async function swing(page: Page, times = 12): Promise<number> {
  let lo = 999
  let hi = 0
  for (let i = 0; i < times; i++) {
    const hs = await page.$$eval('.sc-rd__wave span', (els) =>
      els.map((e) => parseInt((e as HTMLElement).style.height || '0', 10)),
    )
    lo = Math.min(lo, ...hs)
    hi = Math.max(hi, ...hs)
    await page.waitForTimeout(140)
  }
  return hi - lo
}

async function main() {
  const host = await hostToken()
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const notes: Record<string, unknown> = {}

  /** 판 하나를 세우고 나와 같은 팀 사람들의 증표를 돌려준다 */
  async function setUp(tag: string): Promise<{ me: string; mateToks: string[] }> {
    GAME = `rd${tag}${Date.now()}`
    const id = `rd${tag}${String(Date.now()).slice(-5)}`
    await must('createGame', host, { gameId: GAME, seed: 'rd' })
    await must('signUpAccount', host, { id, password: MY_PW })
    const meTok = await asPlayer(host, id, MY_PW)
    await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
    await must('joinGame', meTok, { gameId: GAME, name: '수아' })
    await must('seedPlayers', host, { gameId: GAME, password: SEED_PW, leaveSeats: 0 })
    // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
    await must('assignAll', host, { gameId: GAME })
    await must('startGame', host, { gameId: GAME, startAtMs: START })
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
    await must('tick', host, { gameId: GAME })

    const seats = await seatsOf()
    const mine = seats.find((x) => x.name === '수아')
    const crew = seats
      .filter((x) => x.name !== '수아')
      .map((x, i) => ({ ...x, id: `qa${String(i + 1).padStart(2, '0')}` }))
      .filter((x) => x.team === mine?.team)
    const mateToks: string[] = []
    for (const x of crew) mateToks.push(await asPlayer(host, x.id, SEED_PW))
    console.log(`${tag}: 나는 ${mine?.team}팀 · 같은 팀 ${crew.map((x) => `${x.name}(${x.id})`).join(' ')}`)
    return { me: id, mateToks }
  }

  for (const s of SIZES) {
    const tag = String(s.w)
    const { me: myId, mateToks } = await setUp(tag)
    const me = await browser.newPage({
      viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    })
    const boom: string[] = []
    me.on('pageerror', (e) => boom.push(e.message))
    await enter(me, myId, MY_PW)
    await toRadio(me)
    await me.waitForTimeout(900)

    // ① 아무도 안 켜 두었을 때 — 「수신 없음」에 파형이 가라앉는다
    await me.screenshot({ path: `${OUT}/rd-${tag}-1-혼자.png` })
    const alone = { 표시: await me.textContent('.sc-rd__conn'), 흔들림: await swing(me) }

    // ② 같은 팀이 켰을 때 — 「수신 n」이 오르고 파형이 커져야 한다
    let beating = true
    const beat = (async () => {
      while (beating) {
        for (const tk of mateToks) await must('radioLines', tk, { gameId: GAME, sinceMs: 0 })
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()
    await me.waitForTimeout(4000)
    const together = { 표시: await me.textContent('.sc-rd__conn'), 흔들림: await swing(me) }
    await me.screenshot({ path: `${OUT}/rd-${tag}-2-수신.png` })

    // ③ 시스템 줄 — 진짜로 교시를 열고 닫는다
    await must('openPhase', host, { gameId: GAME })
    await me.waitForTimeout(2500)
    await must('closePhase', host, { gameId: GAME })
    await me.waitForTimeout(2500)
    await me.screenshot({ path: `${OUT}/rd-${tag}-3-시스템.png` })

    /*
     * ④ 말이 쌓여 구르는 상태.
     *
     * **손가락으로만 보낸다.** 엔터로 보내면 단추가 눌리는지 모른다.
     * 안 눌렸으면 그 자리에서 멈추지 말고 까닭을 적어 둔다 — 한 번
     * 실패로 나머지 캡처를 다 못 찍으면 손해다.
     */
    const trouble: string[] = []
    for (const line of ['도서관 비었어', '나 3층', '2교시에 도서관 같이 치자', '토큰 둘 남았다', '알겠어']) {
      await me.fill('.sc-rd__bar input', line)
      await me.waitForTimeout(250)
      const off = await me.getAttribute('.sc-rd__send', 'disabled')
      if (off !== null) trouble.push(`${line}: 단추가 막혀 있다`)
      await me
        .locator('.sc-rd__send')
        .click({ timeout: 4000 })
        .catch((e) => trouble.push(`${line}: ${String(e).slice(0, 90)}`))
      await me.waitForTimeout(700)
    }
    /*
     * 목록이 넘치도록 더 쌓는다. **넘치지 않으면 「새 메시지 n」을
     * 볼 수 없다** — 구를 자리가 없으면 언제나 맨 아래에 있는 셈이라
     * 따라가지 않을 일도 없다. 나머지는 팀원 이름으로 서버에 바로 넣는다.
     */
    const chatter = [
      '3층 복도 비었다', '누가 연구실 봤어?', '나 토큰 하나 남음', '급식실에 둘 있었어',
      '2교시 전에 모이자', '미술실 우리 거 맞지', '방송실 누가 갔어', '체육관 비었대',
      '나 지금 계단', '옥상은 아직', '도서관 다시 보자', '토큰 모자라',
      '정원 쪽으로 갈게', '상점 들렀다 감', '연구 걸어 뒀어', '누구 같이 갈래',
      '학생회실 봤어?', '나 먼저 간다',
    ]
    const spills = () =>
      me.evaluate(() => {
        const el = document.querySelector('.sc-rd__log') as HTMLElement
        return el.scrollHeight > el.clientHeight + 8
      })
    let overflows = false
    // **넘칠 때까지 채운다.** 화면이 길면 스무 줄로는 모자란다
    for (let i = 0; i < 60 && !overflows; i++) {
      await must('radio', mateToks[i % mateToks.length], {
        gameId: GAME,
        text: chatter[i % chatter.length],
      })
      if (i % 6 === 5) {
        await me.waitForTimeout(3000)
        overflows = await spills()
      }
    }
    await me.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await me.waitForTimeout(3000)
    overflows = await spills()
    await me.screenshot({ path: `${OUT}/rd-${tag}-4-쌓임.png` })

    // 위로 올려 읽는 중에 새 줄이 오면 따라가지 않는다
    await me.evaluate(() => ((document.querySelector('.sc-rd__log') as HTMLElement).scrollTop = 0))
    await me.waitForTimeout(300)
    await must('radio', mateToks[0], { gameId: GAME, text: '나 지금 간다' })
    await me.waitForTimeout(3500)
    const behind = await me.locator('.sc-rd__behind').count()
    await me.screenshot({ path: `${OUT}/rd-${tag}-5-새메시지.png` })
    await me.locator('.sc-rd__behind').click().catch(() => undefined)

    // ⑤ 키보드가 올라온 셈 — 초점을 주고 화면을 깎는다
    await me.click('.sc-rd__bar input')
    await me.setViewportSize({ width: s.w, height: Math.round(s.h * 0.55) })
    await me.waitForTimeout(600)
    const barTop = await me.evaluate(() => Math.round(document.querySelector('.sc-rd__bar')!.getBoundingClientRect().bottom))
    await me.screenshot({ path: `${OUT}/rd-${tag}-6-키보드.png` })
    await me.setViewportSize({ width: s.w, height: s.h })
    await me.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await me.waitForTimeout(400)

    /*
     * ⑥ 화면이 안 보이면 파형이 멈추는가.
     *
     * **높낮이 차로는 못 잰다** — 멈춘 막대들도 서로 높이가 다르니
     * 차이는 그대로 남는다. 같은 자리를 두 번 떠서 **바뀌었는지**를 본다.
     */
    const bars = () => me.$$eval('.sc-rd__wave span', (els) => els.map((e) => (e as HTMLElement).style.height).join(','))
    await me.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await me.waitForTimeout(500)
    const a1 = await bars()
    await me.waitForTimeout(900)
    const a2 = await bars()
    const frozen = a1 === a2
    await me.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    notes[tag] = {
      혼자: alone,
      같이: together,
      파형이커졌나: together.흔들림 > alone.흔들림,
      넘쳤나: overflows,
      새메시지단추: behind === 1,
      송신칸이화면안: barTop <= Math.round(s.h * 0.55),
      숨으면멈춤: frozen,
      보내기문제: trouble,
      앱틀: await me.evaluate(() => {
        const box = (sel: string) => {
          const e = document.querySelector(sel)
          if (!e) return null
          const r = e.getBoundingClientRect()
          const c = getComputedStyle(e)
          return `${Math.round(r.left)}..${Math.round(r.right)} pad${c.padding} margin${c.margin}`
        }
        return {
          html: box('html'),
          body: box('body'),
          root: box('#root'),
          school: box('.school-root'),
          today: box('.sc-pl__today'),
          무전: box('.sc-rd'),
        }
      }),
      가로구름: await me.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      터짐: boom,
    }
    console.log(tag, JSON.stringify(notes[tag]))
    beating = false
    await beat
    await me.close()
  }
  await browser.close()
  console.log('찍었다')
}

void main()
