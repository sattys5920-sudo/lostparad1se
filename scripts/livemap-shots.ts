// 운영자 「지도」 탭 — 층 지도 · 넓힌 지도 · 누른 사람 · 누른 방의 말 · 전체 말 · 목록을 폰 두 크기로.
//
// 열넷을 앉히고 여러 방으로 흩는다. 둘은 마주 서서 거래하고, 하나는 덫에
// 걸리고, 하나는 걷는 중이고, 하나는 오락기 앞에 앉는다. 방마다 말도 몇 줄.
//
//   1. cd functions && npm run build   (에뮬레이터가 떠 있어야 한다)
//   2. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-lm --emptyOutDir
//   3. python3 -m http.server 8907 --bind 127.0.0.1 --directory /tmp/claude-0/serve-lm
//   4. npx vite-node scripts/livemap-shots.ts
//
// **운영자 코드는 이 파일에 없다.** functions/.env 에서 그때 읽는다.
import { mkdirSync, readFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { dayHourMs } from '../shared/rules/clock'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { START_TILE, TILES, TILE_BY_ID, canRoamTo, type TileId } from '../shared/rules/board'
import { dropCellsIn } from '../shared/rules/quiz'
import { isBlockedCell } from '../shared/rules/blocked'
import { isFixture } from '../shared/rules/fixtures'
import { ARCADE_MACHINES } from '../shared/rules/arcade'
import { defaultLook } from '../src/school/char/look'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8907'
const OUT = '/tmp/claude-0/shots'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const M = 60_000
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
]
const NAMES = ['서윤', '하준', '지우', '도윤', '서아', '이안', '하린', '시우', '아린', '유준', '채원', '은우', '다온', '로하']

const missed: string[] = []
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) missed.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function must(name: string, tk: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function signIn(email: string, admin = false): Promise<{ uid: string; token: string }> {
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (admin) {
    const look = await fetch(`${AUTH}/accounts:lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }),
    })
    const { users } = (await look.json()) as { users: { localId: string }[] }
    await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
      body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
    })
  }
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const j = (await r.json()) as { idToken: string; localId: string }
  return { uid: j.localId, token: j.idToken }
}
function hostCode(): string {
  const line = readFileSync(new URL('../functions/.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HOST_CODE='))
  if (!line) throw new Error('functions/.env 에 HOST_CODE 가 없다')
  return line.slice('HOST_CODE='.length).trim().replace(/^["']|["']$/g, '')
}
function enc(v: unknown): unknown {
  if (v === null) return { nullValue: null }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { stringValue: String(v) }
}
async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!r.ok) throw new Error(`patch ${path}: ${r.status}`)
}

/**
 * 시험 계정은 캐릭터를 안 만들었다 — 명단의 얼굴이 비어 있으면 점으로 선다.
 * 이름에서 뽑은 기본 얼굴을 명단에 바로 적는다(찍어 볼 것이 얼굴이다).
 */
async function giveFaces(game: string): Promise<void> {
  const raw = (await (await fetch(`${FS}/games/${game}`, { headers: ADMIN })).json()) as {
    fields: { seats: { arrayValue: { values: { mapValue: { fields: Record<string, unknown> } }[] } } }
  }
  const seats = raw.fields.seats.arrayValue.values
  for (const s of seats) {
    const name = (s.mapValue.fields.name as { stringValue: string }).stringValue
    const look = defaultLook(`${name}-look`)
    s.mapValue.fields.look = {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(look).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]),
        ),
      },
    }
  }
  const r = await fetch(`${FS}/games/${game}?updateMask.fieldPaths=seats`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { seats: { arrayValue: { values: seats } } } }),
  })
  if (!r.ok) throw new Error(`얼굴 적기 실패 ${r.status}`)
}

/** 열넷을 흩어 둔 판 하나 */
async function setUp(tag: string): Promise<string> {
  const GAME = `lm${tag}${Date.now().toString(36).slice(-4)}`
  const host = (await signIn(`h-${GAME}@x.test`, true)).token
  const want: TeamId[] = []
  for (const [t, n] of Object.entries(STARTING_TEAM_SIZES) as [TeamId, number][]) for (let i = 0; i < n; i++) want.push(t)
  await must('createGame', host, { gameId: GAME, seed: 'lm' })
  const people: { uid: string; token: string; team: TeamId; name: string }[] = []
  for (let i = 0; i < want.length; i++) {
    const a = await signIn(`p${i}-${GAME}@x.test`)
    people.push({ ...a, team: want[i], name: NAMES[i] })
    await must('joinGame', a.token, { gameId: GAME, name: NAMES[i], team: want[i] })
  }
  await must('assignAll', host, { gameId: GAME })
  await must('startGame', host, { gameId: GAME, startAtMs: START })
  await giveFaces(GAME)
  const T0 = dayHourMs(START, 1, 14)
  await must('setDevClock', host, { gameId: GAME, anchorGameMs: T0, speed: 1 })

  // 같은 층 방 몇 개 — 2-3 교실에서 복도로 닿는 곳
  const home = TILE_BY_ID[START_TILE].floor
  const reach = TILES.map((t) => t.id as TileId).filter((t) => t !== START_TILE && canRoamTo(START_TILE as TileId, t))
  const same = reach.filter((t) => TILE_BY_ID[t].floor === home)
  const rooms = same.slice(0, 4)
  const taken = new Set<string>()
  const freeIn = (room: TileId, n: number) => {
    const cells = dropCellsIn(room).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y) && !taken.has(`${c.x},${c.y}`))
    // 가운데쯤에서 고른다
    const mid = cells[Math.floor(cells.length / 2)]
    return cells
      .slice()
      .sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))
      .slice(0, n)
  }
  const place = async (who: (typeof people)[number], room: TileId, cell?: { x: number; y: number }) => {
    await must('roamTo', who.token, { gameId: GAME, tileId: room })
    const c = cell ?? freeIn(room, 3)[2]
    taken.add(`${c.x},${c.y}`)
    const r = await must('standAt', who.token, { gameId: GAME, ...c })
    if (r.ok !== true) console.log(`  (standAt 안 섰다 ${who.name} ${String(r.why ?? '')})`)
  }

  // 방 0 — 거래하는 둘과 구경꾼 하나
  const r0 = rooms[0]
  const pair = (() => {
    const cells = dropCellsIn(r0).filter((c) => !isBlockedCell(c.x, c.y) && !isFixture(c.x, c.y))
    const ok = new Set(cells.map((c) => `${c.x},${c.y}`))
    return cells.find((c, i) => i > cells.length / 3 && ok.has(`${c.x + 1},${c.y}`)) as { x: number; y: number }
  })()
  await place(people[0], r0, pair)
  await place(people[5], r0, { x: pair.x + 1, y: pair.y })
  await place(people[9], r0)
  // 말 — 구경꾼이 먼저 한 말, 그다음 거래
  await must('say', people[9].token, { gameId: GAME, text: '여기 깃발 누가 꽂았어?' })
  await must('say', people[0].token, { gameId: GAME, text: '쪽지 한 장이랑 바꿀래?' })
  await must('say', people[5].token, { gameId: GAME, text: '돈 2 더 얹으면.' })
  const asked = await must('askDeal', people[0].token, { gameId: GAME, toPlayerId: people[5].uid })
  await must('answerDeal', people[5].token, { gameId: GAME, dealId: String(asked.id), accept: true })

  // 방 1 — 셋. 하나는 덫
  for (const i of [1, 6, 10]) await place(people[i], rooms[1])
  await patch(`games/${GAME}/pawns/${people[6].uid}`, { busyKind: '덫', busyUntilMs: T0 + 7 * M })
  await must('say', people[1].token, { gameId: GAME, text: '누가 여기 덫 놨냐' })
  await must('say', people[10].token, { gameId: GAME, text: 'B팀 짓이다 분명히' })

  // 방 2 — 둘
  for (const i of [2, 11]) await place(people[i], rooms[2])
  await must('say', people[2].token, { gameId: GAME, text: '다음 페이즈에 여기 지키자' })

  // 방 3 — 하나 (투명인간)
  await place(people[3], rooms[3])
  await patch(`games/${GAME}`, { invisibleId: people[3].uid })
  await must('say', people[3].token, { gameId: GAME, text: '아무도 내 말 못 듣지?' })

  // 오락기 앞
  await must('standAt', people[4].token, { gameId: GAME, ...ARCADE_MACHINES[2].seat })
  // 걷는 중 — 다른 층으로
  const other = reach.find((t) => TILE_BY_ID[t].floor !== home) ?? rooms[3]
  await patch(`games/${GAME}/pawns/${people[7].uid}`, { tileId: null, fromTile: rooms[2], path: [rooms[3], other], arriveAtMs: T0 + 12 * M })
  // 나머지(8 · 12 · 13)는 2-3 교실에 그대로 — 칸을 지운 하나는 「칸 모름」
  await patch(`games/${GAME}/pawns/${people[13].uid}`, { at: null })
  await must('say', people[8].token, { gameId: GAME, text: '다들 어디 갔어' })
  console.log(`${tag}: 판 ${GAME} · 방 ${rooms.map((r) => TILE_BY_ID[r].name).join(', ')}`)
  return GAME
}

/** 화면이 옆으로 밀리는가 */
async function sideways(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bad: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth + 1) bad.push(`문서 ${de.scrollWidth}>${de.clientWidth}`)
    const ad = document.querySelector('.sc-ad') as HTMLElement | null
    if (ad && ad.scrollWidth > ad.clientWidth + 1) bad.push(`책상 ${ad.scrollWidth}>${ad.clientWidth}`)
    for (const el of Array.from(document.querySelectorAll('.sc-lvm > *:not(.sc-lvm__box), .sc-lvm__card *, .sc-lvm__list *, .sc-ad__tabs *'))) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        bad.push(`${(el as HTMLElement).className || el.tagName} → ${Math.round(r.right)}`)
        if (bad.length > 6) break
      }
    }
    const box = document.querySelector('.sc-lvm__box') as HTMLElement | null
    if (box && box.getBoundingClientRect().right > window.innerWidth + 1) bad.push('지도 상자')
    return bad.join(' · ')
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const s of SIZES) {
    const tag = String(s.w)
    const GAME = await setUp(tag)
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => missed.push(`${tag} 터짐: ${e.message}`))
    const shot = async (name: string) => {
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/lm-${tag}-${name}.png` })
      console.log(`  찍었다 lm-${tag}-${name}.png`)
    }

    await page.goto(`${SITE}/?game=${GAME}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
    await page.locator('.sc-gt__vend').click()
    await page.waitForSelector('#gt-code')
    await page.fill('#gt-code', hostCode())
    await page.locator('.sc-gt__submit').click()
    await page.waitForSelector('.sc-ad__tabs', { timeout: 20_000 })
    check((await page.locator('.sc-ad__tabs button').count()) === 8, `${tag}: 탭 여덟`)
    await page.locator('.sc-ad__tabs button', { hasText: '지도' }).click()
    await page.waitForSelector('.sc-lvm__who', { timeout: 20_000 })
    await page.waitForTimeout(900)

    // ① 층 지도
    const rows = await page.locator('.sc-lvm__row').count()
    check(rows === 14, `${tag}: 목록 열넷`, String(rows))
    const onMap = await page.locator('.sc-lvm__who').count()
    check(onMap >= 10, `${tag}: 이 층 지도에 사람이 선다`, String(onMap))
    check((await sideways(page)) === '', `${tag}: 옆으로 안 밀린다`, await sideways(page))
    await shot('1-map')

    // ② 넓힌 지도 — 얼굴과 이름표
    await page.locator('.sc-lvm__zoom button[aria-label="넓히기"]').click()
    await page.locator('.sc-lvm__zoom button[aria-label="넓히기"]').click()
    await page.waitForTimeout(300)
    check((await page.locator('.sc-lvm__who img').count()) > 0, `${tag}: 넓히면 도트 얼굴`)
    await shot('2-zoom')

    // ③ 목록에서 거래하는 사람을 누른다 — 그 사람에게 다가가고 카드가 뜬다
    const dealer = page.locator('.sc-lvm__row', { hasText: '거래 중' }).first()
    check((await dealer.count()) === 1, `${tag}: 목록에 「거래 중」`)
    await dealer.click()
    await page.waitForSelector('.sc-lvm__card')
    const card = await page.locator('.sc-lvm__card').innerText()
    check(/거래 중 · /.test(card), `${tag}: 카드에 하는 일`, card.replace(/\n/g, ' / '))
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop = 0))
    await page.locator('.sc-lvm__box').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 60))
    await shot('3-person')
    check((await sideways(page)) === '', `${tag}: 카드가 옆으로 안 밀린다`, await sideways(page))

    // 덫 · 걷는 중 · 오락기 한 줄
    const listText = await page.locator('.sc-lvm__list').innerText()
    check(/덫에 걸림 \d+ 분/.test(listText), `${tag}: 목록에 덫`)
    check(/걷는 중 → /.test(listText), `${tag}: 목록에 걷는 중`)
    check(/오락기 앞/.test(listText), `${tag}: 목록에 오락기`)

    // ④ 카드에서 그 방 채팅으로
    await page.locator('.sc-lvm__go').click()
    await page.waitForSelector('.sc-lvm__log li', { timeout: 10_000 })
    const log = await page.locator('.sc-lvm__log').innerText()
    check(/바꿀래/.test(log) && /깃발 누가/.test(log), `${tag}: 그 방에서 오간 말 전부`, log.replace(/\n/g, ' / '))
    await page.locator('.sc-lvm__card').last().evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await shot('4-room')

    // ⑤ 전체 채팅 — 방 이름이 줄마다, 투명인간 줄은 「안 보임」
    await page.locator('.sc-lvm__chatall').click()
    await page.waitForFunction(() => document.querySelectorAll('.sc-lvm__log .sc-lvm__where').length > 0, null, { timeout: 10_000 })
    await page.waitForTimeout(500)
    const all = await page.locator('.sc-lvm__log').innerText()
    check(/안 보임/.test(all), `${tag}: 투명인간의 말에 「안 보임」`)
    check((await page.locator('.sc-lvm__log li').count()) >= 8, `${tag}: 전체는 방을 섞어서`, String(await page.locator('.sc-lvm__log li').count()))
    await page.locator('.sc-lvm__card').last().evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await shot('5-chat-all')
    check((await sideways(page)) === '', `${tag}: 채팅이 옆으로 안 밀린다`, await sideways(page))

    // ⑥ 지도에서 방을 눌러 본다 — 층 전체로 돌려놓고 방 한가운데
    await page.locator('.sc-lvm__x').last().click()
    // 머리줄이 붙어 있다 — 그 밑으로 지도를 내려 둬야 누른 곳이 탭이 아니다
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop = 0))
    await page.locator('.sc-lvm__zoom button[aria-label="층 전체"]').click()
    // 사람이 없는 방 — 사람 위를 누르면 그 사람이 골라진다
    const label = page.locator('.sc-lvm__rn', { hasText: '시청각실' }).first()
    if (await label.count()) {
      const bb = await label.boundingBox()
      if (bb) await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height + 10)
      await page.waitForSelector('.sc-lvm__card', { timeout: 5000 }).catch(() => undefined)
      check((await page.locator('.sc-lvm__pick').count()) === 1, `${tag}: 누른 방에 테두리`)
      const head = await page.locator('.sc-lvm__card header b').first().innerText().catch(() => '')
      check(head === '시청각실', `${tag}: 누른 방의 카드`, head)
      await page.locator('.sc-lvm__box').evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 60))
      await shot('7-tap-room')
    } else check(false, `${tag}: 방 이름표가 없다`)

    // ⑦ 팀으로 거른 목록
    await page.locator('.sc-lvm__chips button', { hasText: 'B' }).click()
    await page.locator('.sc-lvm__chips').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.locator('.sc-ad').evaluate((el) => (el.scrollTop -= 110))
    const bRows = await page.locator('.sc-lvm__row').count()
    check(bRows > 0 && bRows < 14, `${tag}: B팀만`, String(bRows))
    await shot('6-list')
    check((await sideways(page)) === '', `${tag}: 목록이 옆으로 안 밀린다`, await sideways(page))

    await ctx.close()
  }

  await browser.close()
  if (missed.length) {
    console.log('\n놓친 것:')
    for (const x of missed) console.log(`  ✗ ${x}`)
    process.exitCode = 1
  } else console.log('\n전부 통과')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
