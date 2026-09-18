// 하단 조작부 — 바꾸기 전과 후, 두 화면 크기, 다섯 상태.
//
// 가짜 화면을 찍지 않는다. 에뮬레이터에 판을 세우고 진짜로 들어가서
// 찍는다. **전은 이전 커밋을 그대로 빌드해 /before 로 올려 둔 것**이라
// 같은 판, 같은 자리에서 나란히 찍힌다.
//
//   1. cd functions && npm run build
//   2. firebase emulators:start --only firestore,functions,auth --project demo-goei
//   3. 두 벌을 빌드해 8899 로 서빙: /lostparad1se(지금) 와 /before(이전 커밋)
//   4. npx vite-node scripts/ctl-shots.ts
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { SHOP_TILE } from '../shared/rules/shop'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const HOST = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/ctlshots'

const QA_PW = 'ctl-password'
/**
 * 찍는 사람은 **사람 계정**이다.
 *
 * qa01 은 한 에뮬레이터 안에서 판을 넘어 살아남아, 비밀번호가 맨
 * 처음 차린 판의 것으로 굳는다. 그 계정으로 들어가려 들면 다음 판
 * 부터는 문 앞에서 막힌다. 사람 하나를 먼저 앉히고 나머지를 봇으로
 * 채운다 — 지금 판을 차리는 길과 같은 순서다.
 */
const ME = `shot${String(Date.now()).slice(-6)}`
const MY_PW = 'ctl-shot-pass1'
/** 찍는 사람 얼굴. 점이 아니라 사람으로 나와야 한다 */
const qaFace = {
  styleSet: 'F',
  hairStyle: 'F03',
  hairColor: 2,
  expression: 1,
  outfit: 2,
  wearStyle: 0,
  bottom: 1,
  neckwear: 1,
}
const GAME = `ctl${Date.now()}`
const START = Date.UTC(2026, 2, 1, 23, 0, 0)

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function signUp(email: string): Promise<string> {
  await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return email
}
async function setAdmin(email: string): Promise<void> {
  const r = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await r.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
}
async function authTok(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password', returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.status} ${j.error.message}`)
  return j.result ?? {}
}
/** 페이즈 상자를 비운다. **판을 차리는 것**이지 화면을 고치는 것이 아니다. */
async function setPhaseTokens(team: string, n: number): Promise<void> {
  await fetch(`${FS}/games/${GAME}/teams/${team}?updateMask.fieldPaths=phaseTokens`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { phaseTokens: { integerValue: String(n) } } }),
  })
}
/**
 * 오늘 내 몫을 다 쓴 것으로 적는다.
 *
 * 상자를 비우는 것은 소용이 없다 — tick 이 시간만큼 도로 채운다.
 * **하루 몫은 새벽에만 초기화되므로** 이쪽을 적어야 그대로 남는다.
 * 실제로 세 번 쓴 사람과 같은 자리다.
 */
async function useUpDaily(team: string, uid: string, n: number): Promise<void> {
  await fetch(`${FS}/games/${GAME}/secret/tokens/items/${team}?updateMask.fieldPaths=usedToday.${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { usedToday: { mapValue: { fields: { [uid]: { integerValue: String(n) } } } } } }),
  })
}
/** 그 사람 자신으로 서버를 부른다. 화면이 하는 것과 같은 길이다. */
async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: MY_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}
async function myTeamOf(uid: string): Promise<string> {
  const r = await fetch(`${FS}/games/${GAME}/pawns/${uid}`, { headers: ADMIN })
  const j = (await r.json()) as { fields?: { team?: { stringValue?: string } } }
  return j.fields?.team?.stringValue ?? 'A'
}

type Page = import('playwright').Page

/**
 * 한 걸음 떼었다가 돌아온다.
 *
 * **tick 은 바뀐 것이 없으면 각자 몫을 다시 안 짠다**(catchup 의
 * `applied > 0`). 문서를 손으로 고쳐 놓고 tick 만 불러서는 화면이
 * 그대로다. 걸음은 standAt 을 부르고 standAt 은 몫을 다시 짠다 —
 * 사람이 하는 것과 같은 길로 화면을 깨운다.
 */
async function nudge(page: Page): Promise<void> {
  await page.locator('.sc-ct__key.is-right').click().catch(() => undefined)
  await page.waitForTimeout(500)
  await page.locator('.sc-ct__key.is-left').click().catch(() => undefined)
  await page.waitForTimeout(1600)
}

async function enter(page: Page, site: string, id: string): Promise<void> {
  await page.goto(`${site}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
  // **두 벌이 같은 origin 이라 로그인이 그대로 남는다.** 전을 찍고 후로
  // 옮겨 가면 문이 아예 안 뜬다 — 문이 있을 때만 두드린다
  const gate = await page
    .waitForSelector('.sc-gt', { timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  if (gate) {
    await page.fill('#gt-id', id)
    await page.fill('#gt-pw', MY_PW)
    await page.locator('.sc-gt__submit').click()
  }
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    // **건너뛰기는 없다.** 아침은 탭으로만 넘어간다 — 사람이 하는 것과 같다
    await page.locator('.sc-rv__sheet').first().click({ timeout: 1500 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  if ((await page.locator('.sc-pl__today').count()) === 0) {
    await page.screenshot({ path: `${OUT}/x-막힌자리.png` })
    console.log('  막힌 자리: ' + (await page.locator('body').innerText()).slice(0, 400))
    throw new Error(`${id}: 오늘 하루까지 못 갔다`)
  }
  await page.waitForTimeout(800)
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(600)
}

/** 조작부가 실제로 몇 px 인가. 눈이 아니라 자로 잰다. */
async function measure(page: Page): Promise<Record<string, unknown>> {
  return await page.evaluate(() => {
    const px = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : null)
    const ct = document.querySelector('.sc-ct')
    const bar = document.querySelector('.sc-ct__bar')
    const ctl = document.querySelector('.sc-ct__ctl')
    const tabs = document.querySelector('.sc-ct__tabs')
    const room = document.querySelector('.sc-pl__room')
    // 히트박스. 보이는 면이 아니라 ::after 까지 친 판정 영역을 잰다
    const hits: { what: string; w: number; h: number }[] = []
    for (const k of document.querySelectorAll('.sc-ct__key:not(.is-mid)')) {
      const a = getComputedStyle(k, '::after')
      hits.push({
        what: k.className.replace('sc-ct__key ', ''),
        w: parseFloat(a.width) || Math.round(k.getBoundingClientRect().width),
        h: parseFloat(a.height) || Math.round(k.getBoundingClientRect().height),
      })
    }
    for (const a of document.querySelectorAll('.sc-ct__act')) {
      const r = a.getBoundingClientRect()
      hits.push({ what: `act:${a.textContent?.trim().slice(0, 6)}`, w: Math.round(r.width), h: Math.round(r.height) })
    }
    for (const t of document.querySelectorAll('.sc-ct__tab')) {
      const r = t.getBoundingClientRect()
      hits.push({ what: `tab:${t.textContent?.trim()}`, w: Math.round(r.width), h: Math.round(r.height) })
    }
    // 십자 모양인가 — 네 칸의 중심 좌표를 그대로 적는다
    const cross: Record<string, [number, number]> = {}
    for (const d of ['up', 'left', 'right', 'down']) {
      const el = document.querySelector(`.sc-ct__key.is-${d}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      const p = (document.querySelector('.sc-ct__pad') as Element).getBoundingClientRect()
      cross[d] = [Math.round(r.left - p.left), Math.round(r.top - p.top)]
    }
    const pad = document.querySelector('.sc-ct__pad')?.getBoundingClientRect()
    return {
      총높이: px(ct) !== null && px(tabs) !== null ? (px(ct) as number) + (px(tabs) as number) : null,
      자원줄: px(bar),
      조작영역: px(ctl),
      탭바: px(tabs),
      맵: px(room),
      십자칸: pad ? `${Math.round(pad.width)}×${Math.round(pad.height)}` : null,
      십자자리: cross,
      최소히트박스: hits.length ? Math.min(...hits.map((h) => Math.min(h.w, h.h))) : null,
      작은것: hits.filter((h) => h.w < 44 || h.h < 44),
      토큰라벨: document.querySelector('.sc-ct__res i')?.textContent ?? null,
      토큰값: document.querySelector('.sc-ct__res b')?.textContent ?? null,
    }
  })
}

const VIEWS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
]

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  console.log(`판 ${GAME} 을 세운다`)
  const he = await signUp(`h-${GAME}@x.test`)
  await setAdmin(he)
  const host = await authTok(he)
  await must('createGame', host, { gameId: GAME, seed: 'ctl' })
  await must('signUpAccount', host, { id: ME, password: MY_PW })
  // **얼굴부터 만든다.** 안 만들면 앱이 「나」 화면(캐릭터 만들기)에서
  // 멈춰 서고, 지도까지 못 간다
  const meTok = await asPlayer(host, ME)
  await must('saveCharacter', meTok, { nickname: '나', avatar: qaFace })
  await must('joinGame', meTok, { gameId: GAME, name: '나' })
  await must('seedPlayers', host, { gameId: GAME, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  let clock = dayHourMs(START, 1, 10)
  const tick = async (ms = 0): Promise<void> => {
    clock += ms
    await must('setDevClock', host, { gameId: GAME, anchorGameMs: clock, speed: 1 })
    await must('tick', host, { gameId: GAME })
  }
  await tick()

  const mine = uidOf(ME)
  const myTeam = await myTeamOf(mine)
  const myToken = await asPlayer(host, ME)
  console.log(`  ${ME} 은 ${myTeam}팀`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const notes: Record<string, unknown> = {}
  const boom: string[] = []

  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => boom.push(`${v.name}: ${e.message}`))

    // ── 전 ────────────────────────────────────────────────
    await enter(page, `${HOST}/before`, ME)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/before-${v.name}.png` })
    console.log(`  before-${v.name}.png`)

    // ── 후 · 1 보통 ───────────────────────────────────────
    await enter(page, `${HOST}/lostparad1se`, ME)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/after-${v.name}-1보통.png` })
    notes[`${v.name}/자유시간`] = await measure(page)

    // ── 후 · 2 막힌 방향 ──────────────────────────────────
    //
    // 벽을 만들지 않는다. **벽 쪽으로 걸어가서** 실제로 막힌 자리에
    // 선다 — 없는 상태를 억지로 칠하면 찍은 것이 거짓이 된다.
    const pad = page.locator('.sc-ct__pad')
    for (let i = 0; i < 14; i++) {
      if (await page.locator('.sc-ct__key.is-shut').count()) break
      await pad.locator('.sc-ct__key.is-up').click().catch(() => undefined)
      await page.waitForTimeout(260)
    }
    for (let i = 0; i < 14 && (await page.locator('.sc-ct__key.is-shut').count()) < 2; i++) {
      await pad.locator('.sc-ct__key.is-left').click().catch(() => undefined)
      await page.waitForTimeout(260)
    }
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/after-${v.name}-2막힌방향.png` })
    notes[`${v.name}/막힌방향`] = {
      막힌쪽: await page.locator('.sc-ct__key.is-shut').count(),
      ...(await measure(page)),
    }

    // ── 후 · 3 비활성 액션 ────────────────────────────────
    //
    // **가짜로 흐리게 칠하지 않는다.** 토큰 상자를 실제로 비워서,
    // 서버가 정말 거절할 자리를 만든 다음 찍는다. 눌러서 사유가
    // 뜨는 것까지 한 장에 담는다
    await useUpDaily(myTeam, mine, 3)
    await nudge(page)
    const off = page.locator('.sc-ct__act.is-off').first()
    if (await off.count()) await off.click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${OUT}/after-${v.name}-3비활성액션.png` })
    notes[`${v.name}/비활성액션`] = {
      흐린칸: await page.locator('.sc-ct__act.is-off').count(),
      토스트: (await page.locator('.sc-ct__toast').textContent().catch(() => null)) ?? null,
    }
    await useUpDaily(myTeam, mine, 0)
    await nudge(page)

    // ── 후 · 4 더보기 시트 (상점에 서면 여섯을 넘친다) ────
    // 상점까지 실제로 걸어간다. 자유 시간의 방 이동은 공짜고 즉시다
    await must('roamTo', myToken, { gameId: GAME, tileId: SHOP_TILE }).catch(() => undefined)
    await tick(0)
    await page.waitForTimeout(2600)
    await page.locator('.sc-ct__act', { hasText: '더보기' }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/after-${v.name}-4더보기.png` })
    notes[`${v.name}/더보기`] = {
      진동단추: await page.locator('.sc-pl__more button', { hasText: '진동' }).count(),
      넘친행동: await page.locator('.sc-pl__spill button').count(),
    }
    await page.locator('.sc-sheet__head button').click().catch(() => undefined)
    await page.waitForTimeout(400)

    // ── 후 · 5 팀 상세 ────────────────────────────────────
    await page.locator('.sc-ct__bar').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/after-${v.name}-5팀상세.png` })
    notes[`${v.name}/팀상세`] = {
      팀원: await page.locator('.sc-pl__team li').count(),
      숫자줄: await page.locator('.sc-pl__teamNums li').allInnerTexts(),
    }
    await page.locator('.sc-sheet__head button').click().catch(() => undefined)
    await page.waitForTimeout(400)

    // ── 후 · 6 페이즈 중 — 문 쪽에만 값이 붙는다 ──────────
    await must('openPhase', host, { gameId: GAME })
    await tick(0)
    await page.waitForTimeout(3000)
    for (let i = 0; i < 8; i++) {
      const go = page.locator('.sc-ph__go')
      if (!(await go.count())) break
      await go.click().catch(() => undefined)
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/after-${v.name}-6페이즈.png` })
    notes[`${v.name}/페이즈`] = {
      값붙은쪽: await page.locator('.sc-ct__key em').count(),
      ...(await measure(page)),
    }

    // ── 후 · 7 갈 수는 있는데 못 가는 쪽 ─────────────────
    //
    // 벽과 다르다. 면은 멀쩡한 채로 두고, 누르면 까닭을 한 줄로 말한다.
    // 상자를 진짜로 비워서 만든 자리다
    await setPhaseTokens(myTeam, 0)
    await nudge(page)
    // 값이 붙은 쪽이 문 쪽이다. 거기라야 토큰을 묻는다
    const blocked = page.locator('.sc-ct__key:has(em)').first()
    if (await blocked.count()) await blocked.click().catch(() => undefined)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${OUT}/after-${v.name}-7토큰없음.png` })
    notes[`${v.name}/토큰없음`] = {
      토스트: (await page.locator('.sc-ct__toast').textContent().catch(() => null)) ?? null,
      어두운쪽: await page.locator('.sc-ct__key.is-shut').count(),
    }
    await setPhaseTokens(myTeam, 12)
    await must('closePhase', host, { gameId: GAME }).catch(() => undefined)
    await tick(0)
    await ctx.close()
  }

  await browser.close()
  writeFileSync(`${OUT}/잰-값.json`, JSON.stringify(notes, null, 2))
  console.log(JSON.stringify(notes, null, 2))
  if (boom.length > 0) {
    console.log('\n화면이 터진 자리')
    for (const b of boom) console.log(`  ✗ ${b}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
