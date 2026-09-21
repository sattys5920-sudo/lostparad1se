// 시험지 한 장 — 펼친 것과 틀린 것.
//
// **본 대본(look-shots)에서 떼어 냈다.** 거기서는 아침 시퀀스를 지나고
// 화면을 다시 불러온 뒤라, 탭을 눌러도 「나」로 안 넘어갔다. 무엇이
// 붙들고 있는지는 아직 모른다 — 시험지 한 장 찍자고 그것부터 파는 대신,
// 아침을 건너뛴 깨끗한 판에서 따로 찍는다.
//
//   npx vite-node scripts/quiz-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITES = { 전: 'http://127.0.0.1:8898/lostparad1se', 후: 'http://127.0.0.1:8899/lostparad1se' }
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'quiz-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function hostToken(tag: string) {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const missed: string[] = []

  for (const [tag, site] of Object.entries(SITES)) {
    // 「전」 서버가 안 떠 있으면 「후」만 찍는다. 두 번 비교는 있을 때만
    const up = await fetch(`${site}/`).then((r) => r.ok).catch(() => false)
    if (!up) {
      console.log(`  ${tag} 서버가 없다(${site}) — 건너뛴다`)
      continue
    }
    for (const size of [{ w: 375, h: 667 }, { w: 390, h: 844 }]) {
      const game = `qz${Date.now()}${size.w}`
      const me = `qz${String(Date.now()).slice(-6)}${size.w}`
      const host = await hostToken(game)
      await call('createGame', host, { gameId: game, seed: 'qz' })
      await call('signUpAccount', host, { id: me, password: MY_PW })
      const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
      const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: custom, returnSecureToken: true }),
      })
      const meTok = ((await swap.json()) as { idToken: string }).idToken
      await call('saveCharacter', meTok, { nickname: '수아', avatar: { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 } })
      await call('joinGame', meTok, { gameId: game, name: '수아' })
      await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
      await call('startGame', host, { gameId: game, startAtMs: START })
      await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
      await call('tick', host, { gameId: game })
      // 아침은 건너뛴다. 이 대본이 볼 것은 시험지 한 장뿐이다
      await call('markMorning', meTok, { gameId: game, read: [1] })

      const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
      await fetch(`${FS}/games/${game}/secret/quiz/bank?documentId=q1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
        body: JSON.stringify({ fields: {
          kind: { stringValue: 'short' },
          prompt: { stringValue: '눈이 가장 많이 오는 달은?' },
          choices: { arrayValue: { values: [] } },
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
      page.on('pageerror', (e) => missed.push(`${tag}${size.w} 터짐: ${e.message}`))
      await page.goto(`${site}/?game=${game}`, { waitUntil: 'domcontentloaded' })
      await page.fill('#gt-id', me)
      await page.fill('#gt-pw', MY_PW)
      await page.click('.sc-gt__submit')
      await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(1800)

      // 펼치기까지 서버가 한다. refreshViews 가 여기서 돈다
      await call('openQuiz', meTok, { gameId: game, paperId: 'p1' })
      await page.evaluate(() => (document.querySelectorAll('.sc-ct__tab')[1] as HTMLElement | undefined)?.click())
      await page.waitForTimeout(2600)

      const up = await page.locator('.sc-qz__prompt').first().isVisible().catch(() => false)
      if (!up) {
        missed.push(`${tag}${size.w}: 시험지 안 뜸`)
      } else {
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-시험지-${tag}.png` })
        // 틀린 답을 적어 낸다(정답은 「한 달」). 종이가 한 화소 흔들린다
        await page.locator('.sc-qz__short input').fill('열두 달')
        await page.locator('.sc-qz__short button').click()
        /*
         * **답이 돌아온 다음에야 흔들린다.** 채점은 서버가 하므로,
         * 누른 직후에 재면 아직 아무 일도 안 일어난 참이다 — 70ms
         * 뒤에 쟀더니 네 번 다 「표시없음」이 나왔다.
         */
        await page.waitForSelector('.sc-qz__list > li.is-wrong', { timeout: 5000 }).catch(() => undefined)
        /*
         * **흔들리는지는 눈이 아니라 자로 잰다.** 한 화소는 캡처에서
         * 알아보기 어렵고, 오답이면 보기 단추가 사라져서 두 장을
         * 맞대 봐도 무엇이 옮겨진 것인지 안 보인다.
         */
        const shake = await page.evaluate(() => {
          const li = document.querySelector('.sc-qz__list > li')
          if (!li) return '(종이 없다)'
          const m = new DOMMatrixReadOnly(getComputedStyle(li).transform)
          return `${li.className.includes('is-wrong') ? '틀린표시' : '표시없음'} x=${m.m41}`
        })
        console.log(`  ${tag}${size.w} 흔들림 ${shake}`)
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-오답-${tag}.png` })
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-오답뒤-${tag}.png` })
      }
      await ctx.close()
    }
  }

  await browser.close()
  console.log('놓침', JSON.stringify(missed))
  console.log('찍었다')
}
void main()
