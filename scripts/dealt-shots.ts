// 배정된 학생증이 넘어오는 화면 — 열넷째로 앉아 본다.
//
// 봇 열셋을 앉혀 두고 마지막 자리에 들어간다. 그 순간 서버가 팀과
// 역할을 나누고(lobby.ts 의 settleRoster) 화면 가운데로 카드가 온다.
//
//   npx vite-node scripts/dealt-shots.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'dealt-pass1'
const QA_PW = 'seed-password-1'
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
    const game = `dt${Date.now()}${size.w}`
    const me = `dt${String(Date.now()).slice(-6)}${size.w}`
    const host = await hostToken(game)
    await call('createGame', host, { gameId: game, seed: 'dt' })
    await call('signUpAccount', host, { id: me, password: MY_PW })
    const custom = String((await call('logInAccount', host, { id: me, password: MY_PW })).token ?? '')
    const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    })
    const meTok = ((await swap.json()) as { idToken: string }).idToken
    await call('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
    // 봇 열셋. 마지막 한 자리를 남긴다
    await call('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 1 })

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

    // 문 앞 — 열셋이 앉아 있고 한 자리 남았다
    await page.waitForSelector('.sc-lb__go', { timeout: 20000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/dealt-${size.w}-1-문앞.png` })

    // 열넷째로 앉는다. 그 순간 나뉜다
    await page.locator('.sc-lb__go').click()
    const came = await page
      .waitForSelector('.sc-dl', { timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    if (!came) bad.push(`${size.w}: 학생증이 안 넘어왔다`)
    await page.waitForTimeout(1400)
    await page.screenshot({ path: `${OUT}/dealt-${size.w}-2-학생증.png` })

    if (came) {
      // 숨긴 사실을 펴 본다
      await page.evaluate(() => (document.querySelector('.sc-mi__fold') as HTMLElement | null)?.click())
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/dealt-${size.w}-3-숨긴사실.png` })

      // 접어 넣으면 학교로 들어간다. **다시 열어도 안 뜬다**
      await page.locator('.sc-dl__go').click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/dealt-${size.w}-4-접은뒤.png` })
      const still = await page.locator('.sc-dl').count()
      if (still > 0) bad.push(`${size.w}: 접었는데 안 닫힌다`)

      /*
       * ── 시작 전의 2-3 교실 ────────────────────────────────
       * 갇힌 교실 하나만 보이고, 거기서 말은 된다.
       */
      // 먼저 서버만 따로 두드려 본다. 화면이 문제인지 서버가
      // 문제인지 가르지 않으면 엉뚱한 데를 고친다
      const said = await call('say', meTok, { gameId: game, text: '서버로 직접' }).catch((e) => ({ err: String(e) }))
      const got = await call('chatLines', meTok, { gameId: game, sinceMs: 0 }).catch((e) => ({ err: String(e) }))
      console.log(`  ${size.w} 서버 say`, JSON.stringify(said), '· chatLines', JSON.stringify(got).slice(0, 200))

      const bar = await page.locator('.sc-sy__box').count()
      if (bar === 0) bad.push(`${size.w}: 시작 전에 말줄이 없다`)
      else {
        await page.locator('.sc-sy__box').fill('여기 있다')
        await page.locator('.sc-sy__send').click()
        // 보내고 한 번, 주기적으로 한 번. 넉넉히 기다린다
        await page.waitForTimeout(4000)
        const log = await page.evaluate(
          () => (document.querySelector('.sc-sy__log') as HTMLElement | null)?.innerText ?? '',
        )
        if (!log.includes('여기 있다')) bad.push(`${size.w}: 시작 전에 친 말이 안 돌아온다 (${log.slice(0, 40)})`)
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.waitForTimeout(800)
      }
      await page.screenshot({ path: `${OUT}/dealt-${size.w}-5-교실.png` })

      /*
       * **밖이 보이면 안 된다.**
       *
       * 캔버스에서 교실 바닥색(#c8cdd8 계열)과 복도색(#8a90a4)이
       * 각각 몇 점인지 센다. 복도가 한 점이라도 보이면 밖이 보이는
       * 것이다 — 전에는 복도가 어느 방에도 안 속해서 안개도 안 덮고
       * 그냥 그려졌다.
       */
      const seenOut = await page.evaluate(() => {
        const c = document.querySelector('.sc-wk__canvas') as HTMLCanvasElement | null
        if (!c) return null
        const g = c.getContext('2d')
        if (!g) return null
        const d = g.getImageData(0, 0, c.width, c.height).data
        let room = 0
        let hall = 0
        for (let i = 0; i < d.length; i += 4) {
          const [r, gg, b] = [d[i], d[i + 1], d[i + 2]]
          // 방 바닥 #c8cdd8 · 격자 #bec3ce
          if (Math.abs(r - 200) < 8 && Math.abs(gg - 205) < 8 && Math.abs(b - 216) < 8) room += 1
          if (Math.abs(r - 190) < 6 && Math.abs(gg - 195) < 6 && Math.abs(b - 206) < 6) room += 1
          // 복도 #8a90a4
          if (Math.abs(r - 138) < 6 && Math.abs(gg - 144) < 6 && Math.abs(b - 164) < 6) hall += 1
        }
        return { room, hall }
      })
      if (seenOut === null) bad.push(`${size.w}: 캔버스를 못 읽었다`)
      else {
        if (seenOut.room < 200) bad.push(`${size.w}: 교실이 안 보인다 (방 ${seenOut.room}점)`)
        if (seenOut.hall > 0) bad.push(`${size.w}: 복도가 보인다 (${seenOut.hall}점)`)
        console.log(`  ${size.w} 바닥 점수`, JSON.stringify(seenOut))
      }

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      const again = await page.locator('.sc-dl').count()
      if (again > 0) bad.push(`${size.w}: 새로고침할 때마다 다시 뜬다`)

      /*
       * ── 운영자가 시작을 누르면 ─────────────────────────────
       * 밖이 보이고 나갈 수 있다. 복도가 한 점도 안 보이던 화면에
       * 복도가 나타나는지로 잰다.
       */
      await call('startGame', host, { gameId: game })
      // 아침 시퀀스는 여기서 볼 것이 아니다. 봤다고 적어 두고 지나간다
      await call('markMorning', meTok, { gameId: game, read: [1] }).catch(() => undefined)
      await page.waitForTimeout(1200)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.sc-ct__tab', { timeout: 25000 })
      await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(2500)
      const after = await page.evaluate(() => {
        const c = document.querySelector('.sc-wk__canvas') as HTMLCanvasElement | null
        if (!c) return null
        const g = c.getContext('2d')
        if (!g) return null
        const d = g.getImageData(0, 0, c.width, c.height).data
        let hall = 0
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - 138) < 6 && Math.abs(d[i + 1] - 144) < 6 && Math.abs(d[i + 2] - 164) < 6) hall += 1
        }
        return hall
      })
      if (after === null) bad.push(`${size.w}: 시작 뒤 캔버스를 못 읽었다`)
      else if (after === 0) bad.push(`${size.w}: 시작했는데도 복도가 안 보인다`)
      console.log(`  ${size.w} 시작 뒤 복도`, after)
      await page.screenshot({ path: `${OUT}/dealt-${size.w}-6-시작뒤.png` })
    }

    await ctx.close()
  }

  await browser.close()
  console.log('어긋남', JSON.stringify(bad))
  console.log('찍었다')
}

void main()
