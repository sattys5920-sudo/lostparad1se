// 시작 전 로비에서 둘이 서로를 보는가. **진짜 서버로** 본다.
//
// 열넷이 다 차기를 기다리는 동안 같은 교실에 둘이 서 있어도 각자 빈
// 학교를 걷고 있었다. 시작 전에는 view 가 없어서(서버가 아직 말을 안
// 세운다) 「누가 보이는가」를 가려 줄 것이 없었고, 그래서 아무도 안
// 보였다 — 가릴 것이 없다는 뜻이지 보일 것이 없다는 뜻이 아니었다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   VITE_FIREBASE_EMULATOR=true npx vite build --outDir <어딘가>/lostparad1se
//   (그 위 디렉터리를 8899 로 서빙)
//   npx vite-node scripts/lobby-meet.ts
import { createHash } from 'node:crypto'
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { randomLook } from '../src/school/char/look'
const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/ctlshots'
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const TAG = String(Date.now()).slice(-6)
const GAME = `lm${TAG}`
const PW = 'meetpass1'

let bad = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function call(n: string, tk: string | null, d: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data: d }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${n}: ${j.error.message}`)
  return j.result ?? {}
}
async function tok(id: string): Promise<string> {
  const c = String((await call('logInAccount', null, { id, password: PW })).token)
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: c, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}

type Page = import('playwright').Page

/** 캔버스에서 그 팀 색이 몇 점이나 찍혔는가. 사람이 눈으로 하는 일이다. */
async function teamPixels(page: Page, rgb: [number, number, number]): Promise<number> {
  return await page.locator('canvas').first().evaluate((el, want) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) return 0
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - want[0]) < 10 && Math.abs(d[i + 1] - want[1]) < 10 && Math.abs(d[i + 2] - want[2]) < 10) n += 1
    }
    return n
  }, rgb)
}

async function enter(page: Page, id: string): Promise<void> {
  await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt', { timeout: 20_000 })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', PW)
  await page.locator('.sc-gt__submit').click()
  await page.waitForSelector('.sc-pl__before', { timeout: 20_000 })
  await page.waitForTimeout(1200)
}

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function main(): Promise<void> {
  const he = `h${TAG}`
  await call('signUpAccount', null, { id: he, password: PW })
  await tok(he)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      localId: `acct_${createHash('sha256').update(he).digest('hex').slice(0, 24)}`,
      customAttributes: JSON.stringify({ admin: true }),
    }),
  })
  const host = await tok(he)
  await call('createGame', host, { gameId: GAME, seed: 'lm' })

  // 둘만 앉는다. **열넷이 다 차기 전이다** — 그게 보려는 것이다
  const a = `aa${TAG}`
  const b = `bb${TAG}`
  for (const id of [a, b]) {
    await call('signUpAccount', null, { id, password: PW })
    await call('saveCharacter', await tok(id), { nickname: id.slice(0, 6), avatar: randomLook('F') })
  }
  await call('joinGame', await tok(a), { gameId: GAME, name: '가', team: 'A' })
  await call('joinGame', await tok(b), { gameId: GAME, name: '나', team: 'B' })
  console.log(`판 ${GAME} — 둘만 앉았다`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const view = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' }
  const p1 = await (await browser.newContext(view)).newPage()
  const p2 = await (await browser.newContext(view)).newPage()
  const boom: string[] = []
  p1.on('pageerror', (e) => boom.push('가: ' + e.message))
  p2.on('pageerror', (e) => boom.push('나: ' + e.message))

  await enter(p1, a)
  await enter(p2, b)

  // 둘 다 2-3 교실에서 시작한다. 한쪽이 한 걸음 떼어 맥을 흘린다
  for (const p of [p1, p2]) {
    await p.locator('.sc-ct__key.is-right').click().catch(() => undefined)
    await p.waitForTimeout(300)
    await p.locator('.sc-ct__key.is-left').click().catch(() => undefined)
  }
  await p1.waitForTimeout(2500)

  // A 는 붉은색(#E0453F), B 는 푸른색(#3F7AE0). 서로 상대 색이 보여야 한다
  const RED: [number, number, number] = [224, 69, 63]
  const BLUE: [number, number, number] = [63, 122, 224]
  const seenByA = await teamPixels(p1, BLUE)
  const seenByB = await teamPixels(p2, RED)
  check(seenByA > 0, '가(A팀)의 화면에 나(B팀)가 보인다', `${seenByA}점`)
  check(seenByB > 0, '나(B팀)의 화면에 가(A팀)가 보인다', `${seenByB}점`)

  await p1.screenshot({ path: `${OUT}/lobby-meet-a.png` })
  await p2.screenshot({ path: `${OUT}/lobby-meet-b.png` })

  /*
   * 가만히 서 있어도 맥이 뛰는가.
   *
   * **화면끼리 재면 안 된다.** 크로미움은 뒤에 있는 탭의 프레임을
   * 늦춘다 — 둘 중 하나는 반드시 뒤에 있으므로, 「상대가 안 보인다」가
   * 내 코드 탓인지 브라우저의 절전 탓인지 갈리지 않는다. 앞에 세운
   * 탭이 제 자리를 계속 적는지를 문서에서 직접 본다.
   */
  await p1.bringToFront()
  await p1.waitForTimeout(1200)
  const myLive = async (): Promise<number> => {
    const r = await fetch(`${FS}/games/${GAME}/live/${uidOf(a)}`, { headers: ADMIN })
    if (!r.ok) return 0
    const j = (await r.json()) as { fields?: { ms?: { integerValue?: string } } }
    return Number(j.fields?.ms?.integerValue ?? 0)
  }
  const was = await myLive()
  check(was > 0, '가만히 선 자리가 적혀 있다')
  console.log('  (가만히 7초)')
  await p1.waitForTimeout(7000)
  const nowMs2 = await myLive()
  check(nowMs2 > was, '가만히 서 있어도 맥이 뛴다 — 남의 화면에서 안 사라진다', `${nowMs2 - was}ms 만에 다시 적었다`)

  await browser.close()
  for (const x of boom) console.log(`  ✗ ${x}`)
  if (boom.length > 0) bad += boom.length
  console.log(bad === 0 ? '\n전부 통과.' : `\n${bad}개 실패.`)
  process.exit(bad === 0 ? 0 : 1)
}
void main()
