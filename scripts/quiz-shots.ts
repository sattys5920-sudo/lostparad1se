// 시험지 한 장 — **복도에서 줍고 손패에서 푼다.**
//
// 운영자가 놓은 종이를 복도에서 주워 손패에 넣고, 거기서 답을 적는
// 한 줄기를 찍는다. 복도를 쓰는 것은 일부러다 — 복도에 놓을 수 있게
// 하려고 주소를 방에서 칸으로 옮겼고, 그게 도는지는 복도에서만 보인다.
//
// **본 대본(look-shots)에서 떼어 냈다.** 거기서는 아침 시퀀스를 지나고
// 화면을 다시 불러온 뒤라, 탭을 눌러도 「나」로 안 넘어갔다. 무엇이
// 붙들고 있는지는 아직 모른다 — 시험지 한 장 찍자고 그것부터 파는 대신,
// 아침을 건너뛴 깨끗한 판에서 따로 찍는다.
//
//   npx vite-node scripts/quiz-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { createHash } from 'node:crypto'

import { dayHourMs } from '../shared/rules/clock'
import { HALLS, START_TILE, TILE_BY_ID, roomOfCell } from '../shared/rules/board'
import { canDropQuizAt } from '../shared/rules/quiz'
import { cellNow, tap, walkTo } from './lib/walk'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

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
      // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
      await call('assignAll', host, { gameId: game })
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
      /*
       * **시작 교실에서 가장 가까운 복도 칸.** 방이 아니라 복도다 —
       * 방에 놓는 것은 전에도 됐고, 이번에 새로 되는 것이 복도다.
       */
      const CELL = (() => {
        const r = TILE_BY_ID[START_TILE].plan
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        let best: { x: number; y: number; d: number } | null = null
        for (const h of HALLS) {
          for (let y = h.rect.y; y < h.rect.y + h.rect.h; y++)
            for (let x = h.rect.x; x < h.rect.x + h.rect.w; x++) {
              if (!canDropQuizAt(x, y) || roomOfCell(x, y) !== null) continue
              const d = Math.abs(x - cx) + Math.abs(y - cy)
              if (!best || d < best.d) best = { x, y, d }
            }
        }
        if (!best) throw new Error('복도 칸을 못 찾았다')
        return { x: best.x, y: best.y }
      })()
      await fetch(`${FS}/games/${game}/secret/quiz/floor?documentId=p1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
        body: JSON.stringify({ fields: {
          quizId: { stringValue: 'q1' },
          x: { integerValue: String(CELL.x) },
          y: { integerValue: String(CELL.y) },
          heldBy: { nullValue: null },
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

      // 십자키로 종이 옆까지 간다 — 옆에 서야 「문제 종이」 칸이 뜬다
      await walkTo({ page, fs: FS, admin: ADMIN, game, uid: uidOf(me), want: CELL, what: '종이' })
      await page.waitForTimeout(800)
      /*
       * 바닥에 놓인 종이. **여기서 찍는다** — 복도 것은 복도에 서야
       * 보이므로, 교실에서 찍으면 아무것도 안 나온다. 전에 그랬다
       */
      await page.screenshot({ path: `${OUT}/quiz-${size.w}-바닥-${tag}.png` })
      /* 종이 한 칸만 크게. 12×12 스프라이트가 어떻게 보이나 확인용 */
      const box = await page.locator('canvas').first().boundingBox()
      if (box) {
        const side = 170
        await page.screenshot({
          path: `${OUT}/quiz-${size.w}-바닥확대-${tag}.png`,
          clip: {
            x: box.x + box.width / 2 - side / 2,
            y: box.y + box.height / 2 - side / 2,
            width: side, height: side,
          },
        })
      }
      /*
       * **종이 위로는 못 지나간다.** 옆에 선 채로 종이 쪽 십자키를
       * 눌러도 자리가 그대로여야 한다 — 기물과 같은 자다.
       */
      const beside = await cellNow(FS, ADMIN, game, uidOf(me))
      if (beside && (beside.x !== CELL.x || beside.y !== CELL.y)) {
        const dir =
          CELL.y > beside.y ? 'is-down'
          : CELL.y < beside.y ? 'is-up'
          : CELL.x > beside.x ? 'is-right'
          : 'is-left'
        // 대각선이면 먼저 한 축을 맞춘다 — 십자키는 한 방향씩이다
        if (CELL.x !== beside.x && CELL.y !== beside.y) {
          await page.locator(`.sc-ct__key.${CELL.x > beside.x ? 'is-right' : 'is-left'}`).click().catch(() => undefined)
          await page.waitForTimeout(700)
        }
        const before = await cellNow(FS, ADMIN, game, uidOf(me))
        await page.locator(`.sc-ct__key.${dir}`).click().catch(() => undefined)
        await page.waitForTimeout(900)
        const after = await cellNow(FS, ADMIN, game, uidOf(me))
        const onPaper = after?.x === CELL.x && after?.y === CELL.y
        console.log(`  종이 쪽으로 밀어 봄 — ${before?.x},${before?.y} → ${after?.x},${after?.y} ${onPaper ? '✗ 종이 위에 섰다' : '✓ 막혔다'}`)
        if (onPaper) missed.push(`${tag}${size.w}: 종이 위로 지나갔다`)
      }
      /*
       * **줍는다.** 행동 칸이 「문제 종이를 줍는다」로 바뀌었다 —
       * 전에는 그 자리에서 펴는 물건이라 시트가 열렸다.
       */
      await tap(page, '.sc-ct__act', '문제 종이를 줍는다')
      await page.waitForTimeout(1600)
      await page.screenshot({ path: `${OUT}/quiz-${size.w}-주웠다-${tag}.png` })

      /*
       * **손패에서 푼다.** 어디에 서 있는지는 이제 안 본다 —
       * 주머니 속 물건이라 걸어 다니며 생각해도 된다.
       */
      await tap(page, '.sc-ct__act', '손패')
      await page.waitForTimeout(1200)
      const up = await page.locator('.sc-qz__prompt').first().isVisible().catch(() => false)
      if (!up) {
        missed.push(`${tag}${size.w}: 손패에 문제가 안 뜸`)
      } else {
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-손패-${tag}.png` })
        /*
         * **펼친 종이 그림.** goodIcon 이 모르는 이름을 받으면 빈
         * 문자열을 주고, 화면에는 깨진 그림이 조용히 남는다 — 눈으로는
         * 안 보이니 그린 크기를 잰다.
         */
        const pic = await page.evaluate(() => {
          const img = document.querySelector('.sc-qz__pic') as HTMLImageElement | null
          if (!img) return '(없다)'
          return `${img.naturalWidth}x${img.naturalHeight}`
        })
        if (pic !== '12x12') missed.push(`${tag}${size.w}: 펼친 종이 그림이 ${pic}`)

        /*
         * **흔들림은 260ms 만 산다.** 누른 뒤에 자를 대면 대개 이미
         * 지나간 뒤라, 같은 코드가 한 번은 「틀린표시」 한 번은
         * 「표시없음」을 냈다 — 게임이 아니라 검사가 흔들린 것이다.
         * 누르기 전에 지켜보게 해 두고 나중에 묻는다.
         */
        await page.evaluate(() => {
          const w = window as unknown as { __shook?: boolean }
          w.__shook = false
          const ul = document.querySelector('.sc-qz__list')
          if (!ul) return
          new MutationObserver(() => {
            if (ul.querySelector('li.is-wrong')) w.__shook = true
          }).observe(ul, { attributes: true, subtree: true, attributeFilter: ['class'] })
        })
        // 틀린 답을 적어 낸다(정답은 「한 달」). 종이가 한 화소 흔들린다
        await page.locator('.sc-qz__short input').fill('열두 달')
        await page.locator('.sc-qz__short button').click()
        // 채점은 서버가 한다. 글줄이 뜨는 것이 「돌아왔다」는 신호다
        const warned = await page
          .waitForSelector('.sc-qz__warn', { timeout: 5000 })
          .then(() => true)
          .catch(() => false)
        if (!warned) missed.push(`${tag}${size.w}: 틀렸는데 글줄이 안 떴다`)
        const shook = await page.evaluate(
          () => (window as unknown as { __shook?: boolean }).__shook === true,
        )
        if (!shook) missed.push(`${tag}${size.w}: 틀렸는데 안 흔들렸다`)
        if (warned) {
          const warn = (await page.locator('.sc-qz__warn').first().innerText()).trim()
          if (warn !== '한 번 틀렸다. 이 문제는 다시 못 푼다.') {
            missed.push(`${tag}${size.w}: 틀린 글줄이 다르다 — ${warn}`)
          }
        }
        // **다시 못 낸다.** 글줄만 뜨고 칸이 남아 있으면 소용없다
        const canRetry = await page.locator('.sc-qz__short').count()
        if (canRetry !== 0) missed.push(`${tag}${size.w}: 틀린 뒤에도 답을 낼 수 있다`)
        console.log(`  ${tag}${size.w} 흔들림 ${shook ? '봤다' : '못 봤다'} · 다시내기 ${canRetry}칸`)
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-오답-${tag}.png` })
        await page.waitForTimeout(700)
        await page.screenshot({ path: `${OUT}/quiz-${size.w}-오답뒤-${tag}.png` })

        /*
         * **맞히면 손에서 사라진다.** 한 번 틀린 사람은 다시 못 내므로
         * 새 종이를 하나 더 놓고, 그걸 주워서 맞힌다.
         */
        /*
         * 서 있는 칸의 **이웃 중 놓을 수 있는 칸.** 그냥 x+1 로 잡았더니
         * 벽이어서 서버가 안 받았고, 둘째 문제를 못 주웠다.
         */
        const at = await cellNow(FS, ADMIN, game, uidOf(me))
        const here2 = at ?? CELL
        const next = (() => {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const c = { x: here2.x + dx, y: here2.y + dy }
            if (canDropQuizAt(c.x, c.y)) return c
          }
          throw new Error('옆에 놓을 칸이 없다')
        })()
        /*
         * **진짜 hostDrop 으로 놓는다.** Firestore 에 직접 쓰면
         * refreshViews 가 안 돌아서 화면에 안 뜬다 — 문서는 생겼는데
         * 「줍는다」 칸이 안 나와서 한참 헤맸다.
         */
        const put2 = await call('hostDrop', host, {
          gameId: game,
          kind: 'quiz',
          x: next.x,
          y: next.y,
          quiz: {
            kind: 'short',
            prompt: '창고 문을 잠근 사람은 누구인가?',
            choices: [],
            answers: ['아무도'],
            explain: '아무도 잠그지 않았다. 문은 원래 그랬다.',
          },
        })
        if (!put2 || (put2 as { where?: string }).where === undefined) {
          missed.push(`${tag}${size.w}: 둘째 문제를 못 놓았다 ${JSON.stringify(put2)}`)
        }
        await call('tick', host, { gameId: game })
        await page.waitForTimeout(1800)
        await tap(page, '.sc-ct__act', '문제 종이를 줍는다')
        await page.waitForTimeout(1600)
        await tap(page, '.sc-ct__act', '손패')
        await page.waitForTimeout(1200)
        const boxes = page.locator('.sc-qz__short input')
        const n = await boxes.count()
        if (n === 0) {
          missed.push(`${tag}${size.w}: 둘째 문제를 못 주웠다`)
        } else {
          await boxes.last().fill('아무도')
          await page.locator('.sc-qz__short button').last().click()
          await page.waitForTimeout(2200)
          const left = await page.locator('.sc-qz__prompt').count()
          console.log(`  ${tag}${size.w} 맞힌 뒤 손에 남은 문제 ${left}장`)
          await page.screenshot({ path: `${OUT}/quiz-${size.w}-맞혔다-${tag}.png` })
        }
      }
      await ctx.close()
    }
  }

  await browser.close()
  console.log('놓침', JSON.stringify(missed))
  console.log('찍었다')
}
void main()
