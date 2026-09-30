// 팀 점수와 미니맵 방 이름 — 진짜 판에 들어가서 **잰다.**
//
//   ㆍ 미니맵 이름끼리 안 겹치는가, 화면에서 8px 쯤으로 그려지는가
//   ㆍ 점수판에 네 팀이 다 서는가
//   ㆍ 방 주인이 바뀌면 맞는 팀에 맞는 +N 이 붙는가
//
// 주인은 공개 문서(tiles)에 직접 적어 바꾼다. 화면은 그 문서를 바로
// 듣고 있어서 누가 적었든 같이 반응한다 — 서버가 페이즈를 닫으며
// 적는 쪽은 phase-e2e 가 본다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. VITE_FIREBASE_EMULATOR=true npx vite build --outDir <serve>/lostparad1se
//   4. npx vite-node scripts/phase-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/shots'
const MY_PW = 'phase-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
void uidOf

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
  mkdirSync(OUT, { recursive: true })
  const up = await fetch(`${SITE}/`).then((r) => r.ok).catch(() => false)
  if (!up) throw new Error(`서버가 없다(${SITE})`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const missed: string[] = []
  const sizes = [{ w: 375, h: 667 }, { w: 390, h: 844 }]

  for (const size of sizes) {
    const game = `ph${Date.now()}`
    const me = `ph${String(Date.now()).slice(-6)}`
    const host = await hostToken(game)
    await call('createGame', host, { gameId: game, seed: 'ph' })
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
    await call('assignAll', host, { gameId: game })
    await call('startGame', host, { gameId: game, startAtMs: START })
    await call('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 60 })
    await call('tick', host, { gameId: game })
    await call('markMorning', meTok, { gameId: game, read: [1] })

    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`터짐: ${e.message}`))
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.fill('#gt-id', me)
    await page.fill('#gt-pw', MY_PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1500)

    const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
    const tag = `${size.w}`

    /*
     * **미니맵 이름을 잰다.** 글자 상자끼리 겹치는지, 그리고 그려진
     * 높이가 몇 px 인지. 그리는 쪽은 8px 를 노린다(MINI_FONT_PX).
     */
    const mini = await page.evaluate(() => {
      const svg = document.querySelector('.sc-mini svg')
      const r = svg?.getBoundingClientRect()
      const labels = [...document.querySelectorAll('.sc-mini .sc-mp__mini')].map((el) => {
        const b = el.getBoundingClientRect()
        return { text: el.textContent ?? '', l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }
      })
      const here = document.querySelector('.sc-mini .sc-mp__room.is-here .sc-mp__mini')?.textContent ?? null
      return { svg: r ? { w: r.width, h: r.height } : null, labels, here }
    })
    console.log(`\n── ${tag} 미니맵 ──`)
    console.log(`  그림 ${mini.svg?.w.toFixed(0)}×${mini.svg?.h.toFixed(0)}px · 이름 ${mini.labels.map((l) => `${l.text}(${l.h.toFixed(1)}px)`).join(' ')}`)
    console.log(`  내 방: ${mini.here}`)
    if (mini.labels.length === 0) missed.push(`${tag}: 미니맵에 이름이 하나도 없다`)
    if (!mini.here) missed.push(`${tag}: 내 방 이름이 없다`)
    for (let i = 0; i < mini.labels.length; i++)
      for (let j = i + 1; j < mini.labels.length; j++) {
        const a = mini.labels[i], b = mini.labels[j]
        if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) missed.push(`${tag}: ${a.text}×${b.text} 겹친다`)
      }
    // 글자 상자 높이는 글자 크기보다 조금 크다(윗선·아랫선). 8px 글자면 8~12px
    for (const l of mini.labels) if (l.h < 7 || l.h > 13) missed.push(`${tag}: ${l.text} 높이 ${l.h.toFixed(1)}px`)
    await page.screenshot({ path: `${OUT}/score-${tag}-처음.png` })
    const box = await page.locator('.sc-mini').boundingBox()
    if (box) await page.screenshot({ path: `${OUT}/score-${tag}-미니맵.png`, clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } })

    /** 점수판 네 칸의 글자. aria-label 이 곧 읽히는 말이다 */
    const chips = () => page.locator('.sc-sb__team').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
    const before = await chips()
    console.log(`\n── ${tag} 점수판 ──\n  ${before.join(' · ')}`)
    if (before.length !== 4) missed.push(`${tag}: 점수판이 ${before.length}칸이다`)

    /*
     * **주인을 바꾼다.** 내 팀이 둘을 얻고, 다른 팀 하나가 하나를 얻는다.
     * 그리고 화면이 맞는 팀에 맞는 수를 붙이는지 본다.
     */
    const meDoc = await fetch(`${FS}/games/${game}/pawns/${uidOf(me)}`, { headers: ADMIN }).then((r) => r.json()) as { fields?: { team?: { stringValue?: string } } }
    const myTeam = meDoc.fields?.team?.stringValue ?? 'A'
    const other = ['A', 'B', 'C', 'D'].find((t) => t !== myTeam) as string
    const own = async (tileId: string, team: string) => {
      await fetch(`${FS}/games/${game}/tiles/${tileId}?updateMask.fieldPaths=ownerTeam`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...ADMIN },
        body: JSON.stringify({ fields: { ownerTeam: { stringValue: team } } }),
      })
    }
    await own('library', myTeam)
    await own('artRoom', myTeam)
    await own('musicRoom', other)
    await page.waitForTimeout(900)
    const after = await chips()
    console.log(`  바꾼 뒤: ${after.join(' · ')}`)
    await page.screenshot({ path: `${OUT}/score-${tag}-바뀜.png` })
    const head = await page.locator('.sc-pl__head').boundingBox()
    if (head) await page.screenshot({ path: `${OUT}/score-${tag}-머리.png`, clip: { x: 0, y: 0, width: size.w, height: head.y + head.height + 6 } })
    const mine = after.find((s) => s.includes('2 곳 얻음')) ?? ''
    const theirs = after.filter((s) => s.includes('1 곳 얻음'))
    if (!mine) missed.push(`${tag}: 내 팀(${myTeam})에 「2곳 얻음」이 없다 — ${after.join(' / ')}`)
    if (theirs.length !== 1) missed.push(`${tag}: 「1곳 얻음」이 ${theirs.length}팀이다`)
    const flashing = await page.locator('.sc-sb__team.is-hit').count()
    if (flashing !== 2) missed.push(`${tag}: 번쩍이는 팀이 ${flashing}이다(둘이어야 한다)`)

    // **번쩍임은 사라진다.** 숫자는 남고 +N 만 걷힌다
    await page.waitForTimeout(4600)
    const settled = await page.locator('.sc-sb__team em').count()
    if (settled !== 0) missed.push(`${tag}: 4초 뒤에도 +N 이 ${settled}개 남았다`)
    const final = await chips()
    console.log(`  4초 뒤: ${final.join(' · ')}`)

    /*
     * **차지한 팀은 면 색으로.** 옆 방(과학실)을 노랑 팀에 준다 — 노랑
     * 바탕의 흰 이름이 가장 안 읽힐 자리라 거기서 본다.
     */
    await own('scienceRoom', 'D')
    await page.waitForTimeout(900)
    const TEAM_RGB: Record<string, string> = {
      A: 'rgb(224, 69, 63)', B: 'rgb(63, 122, 224)', C: 'rgb(47, 168, 102)', D: 'rgb(224, 160, 42)',
    }
    const rooms = await page.evaluate(() =>
      [...document.querySelectorAll('.sc-mini .sc-mp__room')].map((g) => {
        const rect = g.querySelector('rect') as SVGRectElement
        const b = rect.getBoundingClientRect()
        return {
          name: g.querySelector('.sc-mp__mini')?.textContent ?? '',
          fill: rect.style.fill,
          here: g.classList.contains('is-here'),
          box: { l: b.left, r: b.right, t: b.top, b: b.bottom },
        }
      }),
    )
    console.log(`\n── ${tag} 면 색 ──\n  ${rooms.map((r) => `${r.name}=${r.fill || '없음'}`).join(' · ')}`)
    const want: Record<string, string> = { 미술: TEAM_RGB[myTeam], 과학: TEAM_RGB.D, '2-3': '' }
    for (const [name, fill] of Object.entries(want)) {
      const got = rooms.find((r) => r.name === name)
      if (!got) missed.push(`${tag}: 미니맵에 「${name}」이 없다`)
      else if (got.fill !== fill) missed.push(`${tag}: 「${name}」 면 색이 ${got.fill || '없음'} — ${fill || '없음'}이어야 한다`)
    }

    /*
     * **머릿수는 들어가야만.** 미니맵의 점은 전부 내 방 안에 있어야 한다.
     * 옆 방 사람이 서버에서 안 오므로 점도 없다 — 여기서는 그 결과를 잰다.
     */
    const hereRoom = rooms.find((r) => r.here)
    const dots = await page.evaluate(() =>
      [...document.querySelectorAll('.sc-mini circle')].map((c) => {
        const b = c.getBoundingClientRect()
        return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }
      }),
    )
    const stray = dots.filter((d) => !hereRoom || d.x < hereRoom.box.l || d.x > hereRoom.box.r || d.y < hereRoom.box.t || d.y > hereRoom.box.b)
    console.log(`  점 ${dots.length}개 · 내 방 밖 ${stray.length}개`)
    if (dots.length === 0) missed.push(`${tag}: 미니맵에 점이 하나도 없다(내 방에는 있어야 한다)`)
    if (stray.length > 0) missed.push(`${tag}: 내 방 밖에 점이 ${stray.length}개`)
    const mbox = await page.locator('.sc-mini').boundingBox()
    if (mbox) await page.screenshot({ path: `${OUT}/score-${tag}-면색.png`, clip: { x: mbox.x - 4, y: mbox.y - 4, width: mbox.width + 8, height: mbox.height + 8 } })
    await ctx.close()
  }

  await browser.close()
  console.log(`\n놓침 ${JSON.stringify(missed, null, 0)}`)
  if (missed.length > 0) process.exitCode = 1
  console.log('찍었다')
}

void main()
