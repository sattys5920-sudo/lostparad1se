// 「나」 탭 — 다섯 장면을 두 크기로.
//
//   기본 · 가진 것 펼침 · 숨긴 사실 펼침 · 투명인간인 날 · 마지막 날
//
// 보면서 같이 따진다.
//   - 열셋 명단이 사라졌는가
//   - 로그아웃이 눈에 안 띄는가(작은 밑줄 링크 하나)
//   - 받은 표에 **종류가 안 보이는가**(익명 규칙)
//   - 숨긴 사실이 기본으로 접혀 있는가
//
//   npx vite-node scripts/me-shots.ts
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

const MY_PW = 'me-pass1'
/** 마지막 선택이 뜨는 날. shared/rules/v2.ts 와 같은 값이다 */
const LAST_DAY = 4
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
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
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

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const bad: string[] = []

  for (const size of [{ w: 375, h: 667 }, { w: 390, h: 844 }]) {
    const game = `me${Date.now()}${size.w}`
    const me = `me${String(Date.now()).slice(-6)}${size.w}`
    const host = await hostToken(game)
    await call('createGame', host, { gameId: game, seed: 'me' })
    await call('signUpAccount', host, { id: me, password: MY_PW })
    const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
    const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    })
    const meTok = ((await swap.json()) as { idToken: string }).idToken
    await call('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
    await call('joinGame', meTok, { gameId: game, name: '수아' })
    await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
    // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
    await call('assignAll', host, { gameId: game })
    await call('startGame', host, { gameId: game, startAtMs: START })
    await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
    await call('tick', host, { gameId: game })
    await call('markMorning', meTok, { gameId: game, read: [1] })

    // 문제 종이 한 장 — 이 탭에서 제일 큰 덩어리다
    await fetch(`${FS}/games/${game}/secret/quiz/bank?documentId=q1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: {
        kind: { stringValue: 'choice' },
        prompt: { stringValue: '눈이 가장 많이 오는 달은?' },
        choices: { arrayValue: { values: ['열두 달', '한 달', '두 달', '세 달'].map((v) => ({ stringValue: v })) } },
        answers: { arrayValue: { values: [{ stringValue: '한 달' }] } },
        explain: { stringValue: '' },
      } }),
    })
    await fetch(`${FS}/games/${game}/secret/quiz/floor?documentId=p1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: {
        quizId: { stringValue: 'q1' }, tileId: { stringValue: 'centralPlaza' },
        openedBy: { nullValue: null }, openedInPhase: { nullValue: null },
        wrongBy: { arrayValue: { values: [] } }, solvedBy: { nullValue: null },
        solvedTeam: { nullValue: null }, atMs: { integerValue: String(Date.now()) },
      } }),
    })

    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => bad.push(`${size.w} 터짐: ${e.message}`))
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', me)
    await page.fill('#gt-pw', MY_PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1600)
    await call('openQuiz', meTok, { gameId: game, paperId: 'p1' })

    const toMe = async () => {
      await page.evaluate(() => (document.querySelectorAll('.sc-ct__tab')[1] as HTMLElement | undefined)?.click())
      await page.waitForSelector('.sc-mi-root', { timeout: 10000 })
      await page.waitForTimeout(2200)
    }
    const shot = (n: string) => page.screenshot({ path: `${OUT}/me-${size.w}-${n}.png`, fullPage: true })

    await toMe()

    // ── 1. 기본 ──
    await shot('1-기본')

    // 따져 볼 것들
    const look = await page.evaluate(() => {
      const t = (document.querySelector('.sc-mi-root') as HTMLElement | null)?.innerText ?? ''
      return {
        글: t,
        // 숨긴 사실이 펴져 있으면 그 문단이 이미 있다
        숨김펴짐: document.querySelector('.sc-mi__secret') !== null,
        // 로그아웃 — 큰 단추가 아니라 작은 밑줄 하나여야 한다
        나가기: (() => {
          const b = document.querySelector('.sc-mi__out') as HTMLElement | null
          if (!b) return null
          const r = b.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height), px: getComputedStyle(b).fontSize }
        })(),
        큰로그아웃: document.querySelector('.sc-out__go') !== null,
        // 열셋 명단은 여기 있으면 안 된다
        명단: document.querySelector('.sc-mi-root .sc-pe') !== null,
      }
    })
    if (look.숨김펴짐) bad.push(`${size.w}: 숨긴 사실이 처음부터 펴져 있다`)
    if (look.큰로그아웃 || look.나가기 === null) bad.push(`${size.w}: 나가기가 작은 링크가 아니다`)
    else if (look.나가기.h > 24 || look.나가기.px !== '9px') bad.push(`${size.w}: 나가기가 너무 크다 ${JSON.stringify(look.나가기)}`)
    if (look.명단) bad.push(`${size.w}: 열셋 명단이 아직 「나」 탭에 있다`)
    /*
     * **표는 합계뿐이다.** 받은 표 카드 안에 종류가 보이면 안 된다.
     * 화면 전체를 훑으면 안 된다 — 내 미션 문장에 「인연에게 신뢰표를」
     * 같은 말이 나올 수 있고, 그건 내 미션이라 보여도 되는 것이다.
     */
    const votesCard = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.sc-mi__head h3')].find(
        (x) => (x.textContent ?? '').replace(/\s/g, '') === '받은표',
      )
      return (h?.closest('.sc-mi__card') as HTMLElement | null)?.innerText ?? '(없다)'
    })
    for (const word of ['신뢰', '호감']) {
      if (votesCard.includes(word)) bad.push(`${size.w}: 받은 표 카드에 「${word}」가 보인다`)
    }
    if (votesCard === '(없다)') bad.push(`${size.w}: 받은 표 카드가 없다`)
    console.log(`  ${size.w} 나가기`, JSON.stringify(look.나가기))

    // ── 2. 가진 것 펼침 ──
    await page.evaluate(() => (document.querySelector('.sc-mi__have') as HTMLElement | null)?.click())
    await page.waitForTimeout(400)
    await shot('2-가진것')

    // ── 3. 숨긴 사실 펼침 ──
    await page.evaluate(() => (document.querySelector('.sc-mi__fold') as HTMLElement | null)?.click())
    await page.waitForTimeout(400)
    const secret = await page.evaluate(
      () => (document.querySelector('.sc-mi__secret') as HTMLElement | null)?.innerText ?? '',
    )
    if (secret.length < 8) bad.push(`${size.w}: 숨긴 사실이 안 왔다 (${secret})`)
    await shot('3-숨긴사실')

    // ── 4. 투명인간인 날 ──
    const uid = await page.evaluate(() => (window as unknown as { __uid?: string }).__uid ?? '')
    await fetch(`${FS}/games/${game}?updateMask.fieldPaths=invisibleId`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { invisibleId: { stringValue: uid || (await meUid(game, me)) } } }),
    })
    await page.waitForTimeout(2500)
    const gone = await page.evaluate(() => document.querySelector('.sc-mi__card.is-gone') !== null)
    if (!gone) bad.push(`${size.w}: 투명인간인 날인데 학생증이 안 흐려진다`)
    await shot('4-투명인간')
    await fetch(`${FS}/games/${game}?updateMask.fieldPaths=invisibleId`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ fields: { invisibleId: { nullValue: null } } }),
    })

    // ── 5. 마지막 날 ──
    //
    // **시계는 달력을 안 넘긴다.** 아무도 없는 사이에 닷새가 지나가
    // 버리지 않도록, 날이 바뀌는 것은 운영자가 pushDay 로 민다.
    // 시계가 미는 것은 걸음(도착)뿐이다.
    for (let d = 2; d <= LAST_DAY; d += 1) {
      await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, d, 8), speed: 60 })
      for (let i = 0; i < 20; i += 1) {
        const peek = (await call('peekDay', host, { gameId: game })) as { next?: { kind?: string } | null }
        if (!peek.next) break
        await call('pushDay', host, { gameId: game })
        if (peek.next.kind === 'dayStart') break
      }
      await call('markMorning', meTok, { gameId: game, read: [d] }).catch(() => undefined)
    }
    await page.waitForTimeout(3500)
    const dayNow = await fetch(`${FS}/games/${game}`, { headers: ADMIN })
      .then((r) => r.json() as Promise<{ fields?: { day?: { integerValue?: string } } }>)
      .then((j) => Number(j.fields?.day?.integerValue ?? 0))
    console.log(`  ${size.w} 날짜`, dayNow)
    const last = await page.evaluate(
      () => (document.querySelector('.sc-mi-root') as HTMLElement | null)?.innerText ?? '',
    )
    if (!last.includes('마 지 막 선 택')) bad.push(`${size.w}: 마지막 날인데 선택 카드가 없다`)
    await shot('5-마지막날')

    await ctx.close()
  }

  await browser.close()
  console.log('어긋남', JSON.stringify(bad, null, 1))
  console.log('찍었다')
}

/** 계정 아이디로 uid. functions/src/account.ts 와 같은 식이다 */
async function meUid(_game: string, id: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
}

void main()
