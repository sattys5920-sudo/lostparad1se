// 겹침 캡처 — 한 칸에 한 사람 · 기물 그림이 막힌 칸에 선다.
//
//   1 같은 문으로 여섯이 한꺼번에 들어온다 — 서버 칸도, 화면의 이름표도 겹치지 않는다
//   2 남의 칸을 가리키는 낡은 실시간 자리 — 화면이 그 사람을 비켜 그린다
//   3 게시판 · 자판기 — 그림이 막힌 칸(기물 칸)에 그려지고, 그림을 짚으면 차림표가 뜬다
//   4 종이 치면 제자리 — 끌려 온 사람들이 서로 다른 칸에 선다
//
//   1. VITE_FIREBASE_EMULATOR=true npx vite build --outDir /tmp/claude-0/serve-ov --emptyOutDir
//   2. python3 -m http.server 8906 --bind 127.0.0.1 --directory /tmp/claude-0/serve-ov
//   3. npx vite-node scripts/overlap-shots.ts          (SITE=… 로 다른 빌드를 찍는다)
//
// 찍은 것: /tmp/claude-0/shots/ov-*.png (TAG=before 면 ov-before-*.png)
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { tapCell, walkTo as walkToCell } from './lib/walk'
import { dayHourMs } from '../shared/rules/clock'
import { BOARDS } from '../shared/rules/errand'
import { VENDINGS } from '../shared/rules/shop'
import { START_TILE, canRoamTo, TILE_IDS, roomOfCell } from '../shared/rules/board'
import { entryCellOf, seatIn } from '../shared/rules/seat'
import { TILE } from '../src/school/map/world'

const { chromium } = pw as typeof import('playwright')
type Page = import('playwright').Page

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SITE = process.env.SITE ?? 'http://127.0.0.1:8906'
const OUT = '/tmp/claude-0/shots'
const TAG = process.env.TAG ? `${process.env.TAG}-` : ''
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

const missed: string[] = []
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) missed.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
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
  const email = `ov-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

/** 그 사람 자신으로 서버를 부른다. 화면이 하는 것과 같은 길이다 */
async function asPlayer(host: string, id: string): Promise<string> {
  const custom = String((await must('logInAccount', host, { id, password: QA_PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

interface Row { id: string; tileId: string | null; at: { x: number; y: number } | null }
async function pawns(game: string): Promise<Row[]> {
  const r = await fetch(`${FS}/games/${game}/pawns?pageSize=50`, { headers: ADMIN })
  const j = (await r.json()) as { documents?: { name: string; fields: Record<string, { stringValue?: string; nullValue?: null; mapValue?: { fields: Record<string, { integerValue: string }> } }> }[] }
  return (j.documents ?? []).map((d) => {
    const m = d.fields.at?.mapValue?.fields
    return {
      id: d.name.split('/').pop() as string,
      tileId: d.fields.tileId?.stringValue ?? null,
      at: m ? { x: Number(m.x.integerValue), y: Number(m.y.integerValue) } : null,
    }
  })
}
const stackedOn = (rows: Row[]) => {
  const n = new Map<string, number>()
  for (const r of rows) if (r.tileId && r.at) n.set(`${r.at.x},${r.at.y}`, (n.get(`${r.at.x},${r.at.y}`) ?? 0) + 1)
  return [...n].filter(([, k]) => k > 1).map(([c, k]) => `${c}×${k}`)
}

/** 화면의 이름표 자리(발끝). 두 이름표가 한 점에 있으면 두 사람이 한 칸에 그려진 것이다 */
async function tagSpots(page: Page): Promise<{ t: string; x: number; y: number }[]> {
  // 화면 안에 떠 있는 것만 — 안 보이는 사람의 이름표는 화면 밖에 치워 둔다
  return (await page.evaluate(`(() => [...document.querySelectorAll('.sc-wk__tag')]
    .filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth })
    .map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top) } }))()`)) as {
    t: string
    x: number
    y: number
  }[]
}
function tagClash(tags: { t: string; x: number; y: number }[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++)
      if (Math.abs(tags[i].x - tags[j].x) < 6 && Math.abs(tags[i].y - tags[j].y) < 6) out.push(`${tags[i].t}/${tags[j].t}@${tags[i].x},${tags[i].y}`)
  return out
}

async function enter(page: Page, game: string, id: string): Promise<void> {
  page.on('pageerror', (e) => missed.push('화면 터짐: ' + String(e).slice(0, 200)))
  await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sc-gt__title', { timeout: 20_000 })
  await page.fill('#gt-id', id)
  await page.fill('#gt-pw', QA_PW)
  await page.locator('.sc-gt__submit').click()
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.sc-pl__today').count()) break
    await page.locator('.sc-dl__go').click({ timeout: 800 }).catch(() => undefined)
    await page.locator('.sc-rv__sheet').first().click({ timeout: 800 }).catch(() => undefined)
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1000)
  await page.locator('.sc-home__panel button').click({ timeout: 2000 }).catch(() => undefined)
  await page.waitForTimeout(800)
}

/**
 * 기물 그림이 **어느 칸에** 그려졌나 — 캔버스 픽셀로 잰다. 기물 칸과 그 윗칸을
 * 옆의 빈 복도 칸과 견줘서, 바닥과 다른 칸이 그림이 선 칸이다.
 */
async function drawnRow(page: Page, cell: { x: number; y: number }): Promise<{ on: number; above: number }> {
  return (await page.evaluate(
    ([cx, cy, tile]) => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const g = c.getContext('2d') as CanvasRenderingContext2D
      const [camX, camY] = (c.dataset.cam ?? '0,0').split(',').map(Number)
      // 캔버스 픽셀 = (지도 px - 카메라). 한 칸 안의 가운데 8×8 을 본다
      const diff = (ax: number, ay: number, bx: number, by: number) => {
        const a = g.getImageData(ax * tile - camX + 4, ay * tile - camY + 4, 8, 8).data
        const b = g.getImageData(bx * tile - camX + 4, by * tile - camY + 4, 8, 8).data
        let d = 0
        for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
        return Math.round(d / (a.length / 4))
      }
      // 견줄 바닥: 두 칸 오른쪽의 같은 줄. 복도 바닥 무늬가 칸마다 같다(나는 네다섯 칸
      // 오른쪽에 서 있다). 왼쪽은 카메라가 벽 끝에 붙으면 화면 밖이라 못 쓴다
      return { on: diff(cx, cy, cx + 2, cy), above: diff(cx, cy - 1, cx + 2, cy - 1) }
    },
    [cell.x, cell.y, TILE] as const,
  )) as { on: number; above: number }
}

/** 기물 앞에 서서 **그림을 짚고** 차림표에서 한 줄을 누른다 */
async function tryFixture(page: Page, game: string, me: string, name: string, cell: { x: number; y: number }, row: string, opened: string): Promise<void> {
  /*
   * 먼저 **멀찍이** 선다(오른쪽 네 칸). 가까이 서면 「!」가 그림 윗칸에 떠서
   * 픽셀로 그림 자리를 잴 수 없다 — 멀리서 잰다
   */
  await walkToCell({ page, fs: FS, admin: ADMIN, game, uid: me, want: { x: cell.x + 5, y: cell.y }, what: `${name} 오른쪽` })
  await page.waitForTimeout(1200)
  const d = await drawnRow(page, cell)
  await page.screenshot({ path: `${OUT}/ov-${TAG}${name === '게시판' ? '3a-board-far' : '4a-vending-far'}.png` })
  await walkToCell({ page, fs: FS, admin: ADMIN, game, uid: me, want: cell, what: name })
  await page.waitForTimeout(1200)
  // 그림이 선 칸 — 픽셀이 바닥과 다른 쪽
  const sprite = d.on >= d.above ? cell : { x: cell.x, y: cell.y - 1 }
  check(d.on > d.above, `${name} 그림이 막힌 칸(${cell.x},${cell.y})에 그려졌다`, `기물 칸 차이 ${d.on} · 윗칸 차이 ${d.above}`)
  const at = (await page.locator('canvas').first().getAttribute('data-at')) ?? ''
  if (process.env.DEBUG) console.log('   debug', JSON.stringify(await page.evaluate(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { cam: c.dataset.cam, at: c.dataset.at, w: c.width, h: c.height, bw: r.width, left: r.left, top: r.top } })()`)))
  const [mx, my] = at.split(',').map(Number)
  check(!(mx === sprite.x && my === sprite.y), `나는 ${name} 그림 위에 서 있지 않다`, `나 ${at} · 그림 ${sprite.x},${sprite.y}`)
  await page.screenshot({ path: `${OUT}/ov-${TAG}${name === '게시판' ? '3-board' : '4-vending'}.png` })
  // **보이는 그림을 짚는다** — 사람이 누르는 곳이다
  await tapCell(page, sprite)
  const b = page.locator('.sc-mt__row', { hasText: row })
  const menu = await b.first().waitFor({ timeout: 3000 }).then(() => true, () => false)
  check(menu, `${name} 그림을 짚으면 「${row}」가 뜬다`)
  if (menu && !(await b.first().isDisabled())) await b.first().click()
  const sheet = await page.waitForSelector(opened, { timeout: 5000 }).then(() => true, () => false)
  check(sheet, `${name} 창이 열린다`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/ov-${TAG}${name === '게시판' ? '3b-board-open' : '4b-vending-open'}.png` })
  // 닫는다
  await page.locator('.sc-sheet__back, .sc-vd__out').first().click({ timeout: 2000 }).catch(() => undefined)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(600)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const game = `ov${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ov' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('assignAll', host, { gameId: game })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 9), speed: 1 })
  await must('tick', host, { gameId: game })
  console.log(`판 ${game}  ${SITE}`)

  const botIds = ['qa02', 'qa03', 'qa04', 'qa05', 'qa06', 'qa07']
  const bots = await Promise.all(botIds.map(async (id) => ({ id, uid: uidOf(id), token: await asPlayer(host, id) })))
  const out = TILE_IDS.find((t) => t !== START_TILE && canRoamTo(START_TILE, t) && roomOfCell(entryCellOf(t).x, entryCellOf(t).y) === t) as string

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' })
  const page = await ctx.newPage()
  await enter(page, game, 'qa01')
  const me = uidOf('qa01')

  console.log('\n── 1 같은 문으로 여섯이 한꺼번에 ──')
  for (const b of bots) await must('roamTo', b.token, { gameId: game, tileId: out })
  await page.waitForTimeout(1500)
  // 여섯이 **같은 칸(문 바로 안쪽)에 들어섰다고** 동시에 말한다
  const door = entryCellOf(START_TILE)
  await Promise.all(bots.map((b) => must('roamTo', b.token, { gameId: game, tileId: START_TILE, at: door })))
  await page.waitForTimeout(3000)
  let rows = await pawns(game)
  const six = rows.filter((r) => bots.some((b) => b.uid === r.id))
  check(six.every((r) => r.tileId === START_TILE && r.at !== null), '여섯 모두 교실에 칸을 받고 들어왔다', six.map((r) => JSON.stringify(r.at)).join(' '))
  check(stackedOn(rows).length === 0, '서버에 한 칸에 둘이 선 곳이 없다', stackedOn(rows).join(' '))
  let tags = await tagSpots(page)
  check(tags.length >= 7, '이름표가 다 떴다', `${tags.length}개`)
  check(tagClash(tags).length === 0, '화면에 한 점에 겹친 이름표가 없다', tagClash(tags).join(' '))
  await page.screenshot({ path: `${OUT}/ov-${TAG}1-entry.png` })
  // 문 바로 안쪽(들어선 칸)에 선 한 사람은 사람처럼 걸어 비킨다 — 거기 서 있으면 문이 막힌다
  const onStep = six.find((r) => r.at?.x === door.x && r.at?.y === door.y)
  if (onStep) {
    const taken = new Set((await pawns(game)).filter((r) => r.at).map((r) => `${r.at!.x},${r.at!.y}`))
    const aside = seatIn(START_TILE, taken, null)!
    await must('standAt', bots.find((b) => b.uid === onStep.id)!.token, { gameId: game, x: aside.x, y: aside.y })
  }

  console.log('\n── 2 남의 칸을 가리키는 낡은 실시간 자리 ──')
  // 거절당하고도 도로 안 적은 화면처럼 — qa02 의 실시간 자리를 qa03 의 칸에 박는다
  rows = await pawns(game)
  const victim = rows.find((r) => r.id === bots[1].uid)?.at as { x: number; y: number }
  await fetch(`${FS}/games/${game}/live/${bots[0].uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({
      fields: {
        tileId: { stringValue: START_TILE },
        x: { doubleValue: victim.x + 0.5 },
        y: { doubleValue: victim.y + 0.5 },
        dir: { stringValue: 'down' },
        moving: { booleanValue: false },
        ms: { integerValue: String(Date.now() + 60_000) },
      },
    }),
  })
  await page.waitForTimeout(1500)
  tags = await tagSpots(page)
  check(tagClash(tags).length === 0, '남의 칸을 가리켜도 비켜 그린다 — 겹친 이름표가 없다', tagClash(tags).join(' '))
  {
    // 비켜 그린 자리는 **서버가 아는 그 사람의 칸**이다 — 이름표 가운데가 그 칸 가운데
    const seats = ((await (await fetch(`${FS}/games/${game}`, { headers: ADMIN })).json()) as {
      fields: { seats: { arrayValue: { values: { mapValue: { fields: { playerId: { stringValue: string }; name: { stringValue: string } } } }[] } } }
    }).fields.seats.arrayValue.values.map((v) => ({ id: v.mapValue.fields.playerId.stringValue, name: v.mapValue.fields.name.stringValue }))
    const name = seats.find((x) => x.id === bots[0].uid)?.name ?? ''
    const own = (await pawns(game)).find((r) => r.id === bots[0].uid)?.at as { x: number; y: number }
    const want = (await page.evaluate(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const [cx, cy] = c.dataset.cam.split(',').map(Number); const k = r.width / c.width; return { x: Math.round(r.left + ((${own.x} + 0.5) * ${TILE} - cx) * k) } })()`)) as { x: number }
    const got = tags.find((t) => t.t === name)
    check(!!got && Math.abs(got.x - want.x) <= 3, `비켜 그린 ${name} 은 서버가 아는 제 칸(${own.x},${own.y})에 선다`, got ? `이름표 ${got.x} · 칸 ${want.x}` : '이름표 없음')
  }
  await page.screenshot({ path: `${OUT}/ov-${TAG}2-stale-live.png` })

  console.log('\n── 3 게시판 · 자판기 ──')
  const board = BOARDS.find((b) => b.id === 'f2w')!
  await tryFixture(page, game, me, '게시판', board.cell, '심부름 보기', '[role=dialog][aria-label="게시판"]')
  const vend = VENDINGS.find((v) => v.floor === 'f2')!
  await tryFixture(page, game, me, '자판기', vend.cell, '고른다', '.sc-vd')

  console.log('\n── 4 종이 치면 제자리 ──')
  // 여섯을 다른 방으로 보내 두고 연다. 한꺼번에 교실로 끌려 온다
  for (const b of bots) await must('roamTo', b.token, { gameId: game, tileId: out }).catch(() => undefined)
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('openPhase', host, { gameId: game })
  // 나도 교실로 돌아온다(제자리 — 복도에 있었어도 방 안 칸에 선다). 그 교실을 찍는다
  await page.waitForTimeout(3500)
  const mineNow = (await pawns(game)).find((r) => r.id === me)?.at
  const drawnMe = (await page.locator('canvas').first().getAttribute('data-at')) ?? ''
  check(!!mineNow && roomOfCell(mineNow.x, mineNow.y) === START_TILE, '복도에 있던 나도 교실 안 칸에 섰다', JSON.stringify(mineNow))
  check(drawnMe === `${mineNow?.x},${mineNow?.y}`, '화면의 내 칸 = 서버의 내 칸', `화면 ${drawnMe}`)
  rows = await pawns(game)
  check(rows.every((r) => r.at !== null), '열넷 모두 칸이 있다', rows.filter((r) => !r.at).map((r) => r.id).join(' '))
  check(stackedOn(rows).length === 0, '서버에 한 칸에 둘이 선 곳이 없다', stackedOn(rows).join(' '))
  tags = await tagSpots(page)
  check(tagClash(tags).length === 0, '화면에 한 점에 겹친 이름표가 없다', tagClash(tags).join(' '))
  await page.screenshot({ path: `${OUT}/ov-${TAG}5-phase-open.png` })

  await browser.close()
  if (missed.length) {
    console.log('\n놓친 것:')
    for (const x of missed) console.log(`  ✗ ${x}`)
    process.exitCode = 1
  } else console.log('\n다 찍었다.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
