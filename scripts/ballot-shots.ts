// 투표용지 — 찍고 재 본다.
//
// 에뮬레이터에 판을 세우고 사람으로 들어가서 투표 탭을 연다. 접히는
// 장면은 **실제로 돌아가는 동안 연달아 찍는다** — 찍을 때마다 화면이
// 지금 몇 번째 장을 보이고 있는지도 같이 적어 둔다. 느리게 돌리는
// 장치를 앱에 심지 않는다. 심으면 그 장치가 그대로 배포된다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve/lostparad1se
//   4. npx vite-node scripts/ballot-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'ballot-shot-pass1'
const SEED_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
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

type Page = import('playwright').Page
type Browser = import('playwright').Browser

/** 판 하나를 세우고 아침까지 밀어 넣는다. */
async function setUp(tag: string): Promise<{ game: string; me: string; host: string }> {
  const game = `bt${tag}${Date.now()}`
  const me = `bt${tag}${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'bt' })
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
  return { game, me, host }
}

/** 로그인하고 아침을 넘겨 투표 탭에 선다. */
async function enter(page: Page, game: string, me: string): Promise<void> {
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
  await page.locator('.sc-ct__tab').nth(3).click()
  await page.waitForTimeout(600)
}

/** 지금 화면이 무엇을 보이고 있는가. 찍은 장마다 같이 적는다. */
const LOOK = `(() => {
  const hold = document.querySelector('.sc-bt__hold')
  const slip = document.querySelector('.sc-bt__slip')
  const box = document.querySelector('.sc-bt__box')
  const air = document.querySelector('.sc-bt__air')
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const m = (el) => {
    const t = cs(el)?.transform
    if (!t || t === 'none') return null
    const n = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number)
    return n.length === 6 ? n : [n[0], n[1], n[4], n[5], n[12], n[13]]
  }
  let frame = null
  if (slip) {
    const bp = cs(slip).backgroundPosition
    const w = parseFloat(cs(slip).backgroundSize)
    frame = Math.round(-parseFloat(bp) / (w / 4))
  }
  return {
    paper: hold ? (hold.className.includes('is-away') ? 'away' : hold.className.includes('is-half') ? 'half' : 'flat') : null,
    frame,
    flying: !!(air && slip && air.contains(slip)),
    slipM: m(slip),
    boxM: m(box),
    holdM: m(hold),
    render: slip ? cs(slip).imageRendering : null,
    boxRender: box ? cs(box).imageRendering : null,
    go: (() => { const b = document.querySelector('.sc-bt__go'); return b ? (b.disabled ? 'off' : 'on') : null })(),
    names: [...document.querySelectorAll('.sc-bt__name')].filter((b) => !b.disabled).length,
    done: document.querySelector('.sc-bt__done')?.textContent ?? null,
  }
})()`

interface Look {
  paper: string | null
  frame: number | null
  flying: boolean
  slipM: number[] | null
  boxM: number[] | null
  holdM: number[] | null
  render: string | null
  boxRender: string | null
  go: string | null
  names: number
  done: string | null
}

const whole = (n: number) => Math.abs(n - Math.round(n)) < 0.001
/** 화소가 뭉개지는가. 회전·확대가 섞였거나 자리가 소수면 뭉갠다. */
function mushy(m: number[] | null): boolean {
  if (!m) return false
  const [a, b, c, d, tx, ty] = m
  return a !== 1 || b !== 0 || c !== 0 || d !== 1 || !whole(tx) || !whole(ty)
}

async function shoot(w: number, h: number, browser: Browser) {
  const { game, me, host } = await setUp(`${w}`)
  const page: Page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const boom: string[] = []
  page.on('pageerror', (e) => boom.push(e.message))
  await enter(page, game, me)

  const tag = `${w}`
  // 1 · 기본
  await page.screenshot({ path: `${OUT}/bt-${tag}-1-기본.png` })

  // 종이 안에 이름이 다 들어갔는가. 구르지 않아야 한다
  const fit = (await page.evaluate(`(() => {
    const mid = document.querySelector('.sc-bt__mid')
    const paper = document.querySelector('.sc-bt__paper')
    const names = [...document.querySelectorAll('.sc-bt__name')]
    const pb = paper.getBoundingClientRect()
    const last = names[names.length - 1].getBoundingClientRect()
    return {
      수: names.length,
      구름: mid.scrollHeight - mid.clientHeight,
      종이밖: Math.round(last.bottom - pb.bottom),
      종이폭: Math.round(pb.width),
      화면폭: window.innerWidth,
    }
  })()`)) as Record<string, number>

  // 2 · 이름 선택됨.
  // **팀장은 적을 수 없는데 다른 팀 팀장은 화면이 모른다** — 서버가
  // 물리면 그 이름은 줄이 그어지므로, 통과하는 이름이 나올 때까지
  // 눌러 본다. 사람이 하는 것과 같은 길이다
  let slot = 0
  for (; slot < 13; slot++) {
    if (await page.locator('.sc-bt__name').nth(slot).isDisabled()) continue
    break
  }
  await page.locator('.sc-bt__name').nth(slot).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/bt-${tag}-2-고름.png` })

  // 3~4 · 접히는 중과 투입 순간. 돌아가는 동안 연달아 찍는다
  const burst: { at: number; look: Look }[] = []
  const t0 = Date.now()
  await page.locator('.sc-bt__go').click()
  // 누르자마자 잠겼는지부터 본다
  const locked = (await page.evaluate(LOOK)) as Look
  for (let i = 0; i < 14; i++) {
    const look = (await page.evaluate(LOOK)) as Look
    const at = Date.now() - t0
    await page.screenshot({ path: `${OUT}/burst-${tag}-${String(i).padStart(2, '0')}.png` })
    burst.push({ at, look })
    if (at > 1500) break
  }

  // 물렸으면 다음 이름으로. 통과할 때까지
  let tries = 0
  while ((await page.locator('.sc-bt__oops').count()) > 0 && tries < 6) {
    tries += 1
    const free = page.locator('.sc-bt__name:not([disabled])').first()
    await free.click()
    await page.locator('.sc-bt__go').click()
    await page.waitForTimeout(1700)
  }

  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/bt-${tag}-5-넣었다.png` })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/bt-${tag}-6-이미넣었다.png` })
  const rest = (await page.evaluate(LOOK)) as Look

  // 다시 넣기 — 역재생이 돌고 종이가 돌아오는가.
  // 도중에 한 장 찍어서 **접힌 조각이 종이가 설 자리에서 시작하는지**를 본다
  await page.locator('.sc-bt__again').click()
  await page.waitForTimeout(260)
  await page.screenshot({ path: `${OUT}/bt-${tag}-7a-되감는중.png` })
  const mid = (await page.evaluate(LOOK)) as Look
  await page.waitForTimeout(600)
  const back = (await page.evaluate(LOOK)) as Look
  await page.screenshot({ path: `${OUT}/bt-${tag}-7-다시.png` })

  // 6 · 마감 후. 열 교시를 열고 닫으면 표가 세어진다
  for (let i = 0; i < 10; i++) {
    await must('openPhase', host, { gameId: game })
    await must('closePhase', host, { gameId: game })
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/bt-${tag}-8-마감.png` })
  const shut = (await page.evaluate(LOOK)) as Look

  // 연출 줄이기 — 켜면 바로 넘어가는가
  const p2: Page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await p2.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
  await p2.evaluate(`localStorage.setItem('sc-plain','on')`)
  const g2 = await setUp(`p${w}`)
  await enter(p2, g2.game, g2.me)
  // 여기서도 팀장은 물린다. 통과하는 이름이 나올 때까지
  let plainMs = -1
  for (let i = 0; i < 6; i++) {
    await p2.locator('.sc-bt__name:not([disabled])').first().click()
    const q0 = Date.now()
    await p2.locator('.sc-bt__go').click()
    await p2.waitForSelector('.sc-bt__done, .sc-bt__oops', { timeout: 5000 })
    if ((await p2.locator('.sc-bt__done').count()) > 0) {
      plainMs = Date.now() - q0
      break
    }
    await p2.waitForTimeout(300)
  }
  await p2.screenshot({ path: `${OUT}/bt-${tag}-9-연출줄이기.png` })
  await p2.close()

  // 저사양. CPU 를 6배 느리게 걸고 같은 연출을 돌린다
  const p3: Page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const g3 = await setUp(`s${w}`)
  await enter(p3, g3.game, g3.me)
  const cdp = await p3.context().newCDPSession(p3)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await p3.locator('.sc-bt__name').nth(0).click()
  const slow = (await p3.evaluate(`(async () => {
    const seen = []
    const read = () => {
      const hold = document.querySelector('.sc-bt__hold')
      const slip = document.querySelector('.sc-bt__slip')
      const box = document.querySelector('.sc-bt__box')
      if (!hold) return 'x'
      if (slip) {
        const cs = getComputedStyle(slip)
        return 'f' + Math.round(-parseFloat(cs.backgroundPosition) / (parseFloat(cs.backgroundSize) / 4)) + cs.transform
      }
      return (hold.className.includes('away') ? 'a' : hold.className.includes('half') ? 'h' : 'p') + (box ? getComputedStyle(box).transform : '-')
    }
    const t0 = performance.now()
    document.querySelector('.sc-bt__go').click()
    let last = ''
    while (performance.now() - t0 < 2200) {
      const v = read()
      if (v !== last) { seen.push(Math.round(performance.now() - t0)); last = v }
      await new Promise((r) => requestAnimationFrame(r))
    }
    return { 장수: seen.length, 바뀐때: seen, 총: Math.round(performance.now() - t0) }
  })()`)) as { 장수: number; 바뀐때: number[]; 총: number }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await p3.close()

  const frames = burst.filter((b) => b.look.frame !== null).map((b) => b.look.frame)
  const out = {
    화면: `${w}×${h}`,
    이름: fit,
    잠김: { 누른직후: locked.go, 이름단추: locked.names },
    물린이름수: tries,
    연출: burst.map((b) => `${b.at}ms ${b.look.paper}${b.look.frame === null ? '' : `/f${b.look.frame}`}${b.look.flying ? '/날아감' : ''}`),
    뭉갬: burst
      .filter((b) => mushy(b.look.slipM) || mushy(b.look.boxM) || mushy(b.look.holdM))
      .map((b) => `${b.at}ms ${JSON.stringify([b.look.slipM, b.look.boxM, b.look.holdM])}`),
    화소: { 조각: burst.find((b) => b.look.render)?.look.render ?? '—', 투표함: burst.find((b) => b.look.boxRender)?.look.boxRender ?? '—' },
    본프레임: [...new Set(frames)].sort(),
    쉼: rest.done,
    되감는중: `${mid.paper}${mid.frame === null ? '' : `/f${mid.frame}`}`,
    다시폈나: back.paper,
    마감: shut.done,
    연출줄이기ms: plainMs,
    저사양: slow,
    터짐: boom,
  }
  console.log(JSON.stringify(out, null, 1))
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
