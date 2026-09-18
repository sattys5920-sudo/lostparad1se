// 방 안 대화 — 키보드가 올라와도 지도가 그대로인가, 로그와 풍선이
// 있어야 할 자리에 있는가, 옆 방으로는 안 새는가.
//
//   npx vite-node scripts/room-talk.ts
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

import { dayHourMs } from '../shared/rules/clock'
import { TILES, TILE_BY_ID, canRoamTo } from '../shared/rules/board'
import type { TileId } from '../shared/rules/board'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const OUT = '/tmp/claude-0/shots'

const MY_PW = 'room-talk-pass1'
const QA_PW = 'seed-password-1'
const START = Date.UTC(2026, 2, 1, 23, 0, 0)
const FACE = { styleSet: 'F', hairStyle: 'F03', hairColor: 2, expression: 1, outfit: 2, wearStyle: 0, bottom: 1, neckwear: 1 }
/** 키보드가 먹었다고 치는 높이. 한글 키보드가 대충 이만하다 */
const KB = 300

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

const tokenFor = (host: string, pwd: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: pwd })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 화면에서 재는 것들. 지도 상자는 **한 픽셀도 안 움직여야 한다** */
const LOOK = `(() => {
  const at = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const box = document.querySelector('.sc-sy__box')
  const canvas = document.querySelector('.sc-wk__canvas')
  const map = canvas ? canvas.getBoundingClientRect() : null
  const seen = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const st = getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden'
  }
  return {
    지도: at('.sc-pl__room'),
    캔버스: at('.sc-wk__canvas'),
    말줄: at('.sc-sy'),
    로그: at('.sc-sy__log'),
    화면: { w: innerWidth, h: innerHeight },
    세로구름: Math.round(document.documentElement.scrollHeight - innerHeight),
    끌린높이: Math.round(window.scrollY),
    글씨: box ? getComputedStyle(box).fontSize : null,
    안내말: box ? box.placeholder : null,
    남은수: (() => { const e = document.querySelector('.sc-sy__left'); return e ? e.textContent.trim() : null })(),
    상한: box ? box.maxLength : null,
    보인다: { 십자키: seen('.sc-ct__ctl'), 자원줄: seen('.sc-ct__bar'), 탭바: seen('.sc-ct__tabs') },
    줄: [...document.querySelectorAll('.sc-sy__line')].map((e) => ({
      글: e.textContent.trim(),
      이름색: getComputedStyle(e.querySelector('b')).color,
      옅기: Number(getComputedStyle(e).opacity.slice(0, 4)),
    })),
    풍선: [...document.querySelectorAll('.sc-wk__say')]
      .filter((e) => getComputedStyle(e).display !== 'none')
      .map((e) => {
        const r = e.getBoundingClientRect()
        return {
          글: e.textContent.trim(),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top),
          지도안: !map || (r.top >= map.top - 1 && r.bottom <= map.bottom + 1 && r.left >= map.left - 1 && r.right <= map.right + 1),
          안눌린다: getComputedStyle(e).pointerEvents === 'none',
          모서리: getComputedStyle(e).borderTopLeftRadius,
        }
      }),
  }
})()`

interface Box { x: number; y: number; w: number; h: number }
interface Bubble { 글: string; x: number; y: number; 지도안: boolean; 안눌린다: boolean; 모서리: string }
interface Look {
  지도: Box | null
  캔버스: Box | null
  말줄: Box | null
  로그: Box | null
  화면: { w: number; h: number }
  세로구름: number
  끌린높이: number
  글씨: string | null
  안내말: string | null
  남은수: string | null
  상한: number | null
  보인다: { 십자키: boolean | null; 자원줄: boolean | null; 탭바: boolean | null }
  줄: { 글: string; 이름색: string; 옅기: number }[]
  풍선: Bubble[]
}

const same = (a: Box | null, b: Box | null) =>
  a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

type Page = import('playwright').Page

async function main() {
  const tag = `rt${Date.now()}`
  const game = tag
  const me = `rt${String(Date.now()).slice(-6)}`
  const host = await hostToken(game)
  const botTok = tokenFor(host, QA_PW)

  await must('createGame', host, { gameId: game, seed: 'rt' })
  await must('signUpAccount', host, { id: me, password: MY_PW })
  const meTok = await tokenFor(host, MY_PW)(me)
  await must('saveCharacter', meTok, { nickname: '수아', avatar: FACE })
  await must('joinGame', meTok, { gameId: game, name: '수아' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  await must('startGame', host, { gameId: game, startAtMs: START })
  await must('setDevClock', host, { gameId: game, anchorGameMs: dayHourMs(START, 1, 10), speed: 1 })
  await must('tick', host, { gameId: game })
  await must('markMorning', meTok, { gameId: game, read: [1] })

  // 봇 열셋의 증표를 다 쥔다. 누가 내 방에 섰는지는 화면을 띄운 뒤
  // chatLines 의 here 로 가른다 — 서버가 「내가 선 방」을 돌려준다
  const mates: { id: string; tok: string }[] = []
  for (let i = 1; i <= 13; i += 1) {
    const id = `qa${String(i).padStart(2, '0')}`
    mates.push({ id, tok: await botTok(id) })
  }

  console.log('판을 세웠다')
  await browserRun(game, me, meTok, mates)
}

async function browserRun(
  game: string,
  me: string,
  meTok: string,
  mates: { id: string; tok: string }[],
): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const report: Record<string, unknown>[] = []
  const boom: string[] = []

  for (const size of [{ w: 375, h: 667, 이름: '375×667 SE' }, { w: 390, h: 844, 이름: '390×844 아이폰' }]) {
    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
    })
    const page: Page = await ctx.newPage()
    page.on('pageerror', (e) => boom.push(`${size.이름}: ${e.message}`))

    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'networkidle' })
    await page.fill('#gt-id', me)
    await page.fill('#gt-pw', MY_PW)
    await page.click('.sc-gt__submit')
    await page.waitForSelector('.sc-ct__tab', { timeout: 20000 })
    await page.locator('.sc-home__panel button').click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(1600)

    // 내가 선 방. **첫날 아침에는 열넷이 중앙광장에 다 모여 있다** —
    // 셋만 남기고 나머지는 옆 방으로 내보낸다. 안 그러면 「옆 방에는
    // 안 간다」를 잴 상대가 없다
    const myHere = String(((await must('chatLines', meTok, { gameId: game })) as { here?: string }).here ?? '')
    if (myHere === '') throw new Error('내가 어느 방에도 없다. 이 시험은 아무것도 재지 못한다')
    const roomMates: typeof mates = []
    const away: typeof mates = []
    for (const m of mates) {
      const h = String(((await must('chatLines', m.tok, { gameId: game })) as { here?: string }).here ?? '')
      if (h !== myHere) {
        away.push(m)
        continue
      }
      if (roomMates.length < 3) {
        roomMates.push(m)
        continue
      }
      // 내보낸다. 갈 수 있는 첫 방이면 어디든 된다
      let gone = false
      for (const t of TILES) {
        if (t.id === myHere || !canRoamTo(myHere as TileId, t.id)) continue
        gone = await must('roamTo', m.tok, { gameId: game, tileId: t.id }).then(() => true).catch(() => false)
        if (gone) break
      }
      if (gone) away.push(m)
      else roomMates.push(m)
    }
    console.log(`  내 방 ${myHere} · 같이 선 사람 ${roomMates.map((m) => m.id).join(',')} · 옆 방 ${away.map((m) => m.id).join(',')}`)
    if (roomMates.length < 2) throw new Error('같은 방에 둘도 못 세웠다. 이 시험은 풍선을 재지 못한다')
    if (away.length === 0) throw new Error('옆 방에 아무도 없다. 이 시험은 새는지를 재지 못한다')
    await page.waitForTimeout(1600)

    // ── 1 · 키보드 닫힘 ────────────────────────────────────
    const shut = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/rt-${size.w}-1-닫힘.png` })

    // ── 2 · 풍선 두셋 + 로그 다섯 줄 ───────────────────────
    // 앞 둘은 나, 뒤 셋은 다른 사람. 마지막 셋이 서로 다른 사람이라야
    // 풍선이 동시에 여럿 뜬다(풍선은 사람마다 마지막 한 줄이다)
    // **화면마다 다른 말을 쓴다.** 같은 말을 두 번 쓰면, 앞 화면에서
    // 다른 방에 두고 온 줄이 뒤 화면의 「샜나」 판정에 섞인다 —
    // 실제로 한 번 거짓 양성이 났다
    const mark = `${size.w}`
    const said = [`거기 누구야${mark}`, `나 여기 있어${mark}`, `조용히 해${mark}`, `누가 온다${mark}`, `숨자${mark}`]
    const mouths = [meTok, meTok, ...roomMates.map((m) => m.tok)]
    for (const [i, t] of said.entries()) {
      await must('say', mouths[Math.min(i, mouths.length - 1)], { gameId: game, text: t })
      await page.waitForTimeout(260)
    }
    await page.waitForTimeout(3000)
    const talked = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/rt-${size.w}-2-풍선과로그.png` })

    // ── 3 · 가장자리 사람의 풍선 ───────────────────────────
    // 방 네모의 맨 왼쪽 칸에 세운 뒤 말하게 한다
    let edge: Bubble | null = null
    const plan = TILE_BY_ID[myHere as TileId]?.plan
    if (plan && roomMates[0]) {
      await must('standAt', roomMates[0].tok, { gameId: game, x: plan.x, y: plan.y + Math.floor(plan.h / 2) })
      await page.waitForTimeout(1200)
      await must('say', roomMates[0].tok, { gameId: game, text: '문 옆이다' })
      await page.waitForTimeout(3000)
      const e = (await page.evaluate(LOOK)) as Look
      edge = e.풍선.find((b) => b.글.startsWith('문 옆')) ?? null
      await page.screenshot({ path: `${OUT}/rt-${size.w}-3-가장자리.png` })
    }

    // ── 4 · 풍선이 사람을 따라가는가 ───────────────────────
    // **풍선은 4초면 사라진다.** 자리를 옮기고 나서 다시 재려면 그
    // 안에 끝내야 한다 — 한 번은 이것 때문에 아무것도 못 쟀다
    let follow: { 전: number; 후: number; 움직였나: boolean } | null = null
    if (plan && roomMates[0]) {
      const y = plan.y + Math.floor(plan.h / 2)
      await must('standAt', roomMates[0].tok, { gameId: game, x: plan.x, y })
      await page.waitForTimeout(900)
      await must('say', roomMates[0].tok, { gameId: game, text: `따라와${mark}` })
      // **뜰 때까지 기다린다.** 줄을 가져오는 주기가 2.5초라, 딱 정해
      // 놓고 재면 아직 안 뜬 것을 「없다」로 읽는다 — 큰 화면에서 한
      // 번 그렇게 아무것도 못 쟀다
      await page
        .locator('.sc-wk__say', { hasText: `따라와${mark}` })
        .first()
        .waitFor({ timeout: 9000 })
        .catch(() => undefined)
      const before = ((await page.evaluate(LOOK)) as Look).풍선.find((b) => b.글.startsWith('따라와'))
      await must('standAt', roomMates[0].tok, { gameId: game, x: plan.x + plan.w - 1, y })
      await page.waitForTimeout(900)
      const after = ((await page.evaluate(LOOK)) as Look).풍선.find((b) => b.글.startsWith('따라와'))
      if (before && after) follow = { 전: before.x, 후: after.x, 움직였나: after.x !== before.x }
    }

    // ── 5 · 키보드 올림. **지도가 그대로인가** ──────────────
    await page.locator('.sc-sy__box').click()
    await page.waitForTimeout(260)
    /*
     * **--kb 를 손으로 적지 않는다.** CSS 변수만 바꾸면 화면은 움직여도
     * 앱의 키보드 코드(useKeyboard)는 아무것도 못 본다 — 로그가 두
     * 줄로 줄어드는 길이 통째로 안 밟힌다. 아이폰이 하는 것과 같은
     * 일을 시킨다: visualViewport 높이를 줄이고 resize 를 던진다.
     */
    await page.evaluate(`(() => {
      const vv = window.visualViewport
      Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - ${KB} })
      vv.dispatchEvent(new Event('resize'))
    })()`)
    await page.waitForTimeout(500)
    const kbSeen = await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()`)
    const open = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/rt-${size.w}-4-키보드.png` })

    // 입력칸이 키보드 위에 있는가
    const barAbove = open.말줄 !== null && open.말줄.y + open.말줄.h <= size.h - KB + 1

    await page.evaluate(`(() => {
      const vv = window.visualViewport
      Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight })
      vv.dispatchEvent(new Event('resize'))
    })()`)
    await page.evaluate(`document.activeElement && document.activeElement.blur()`)
    await page.waitForTimeout(600)
    const back = (await page.evaluate(LOOK)) as Look

    // ── 6 · 방을 옮기면 로그가 비는가 ──────────────────────
    // **옮길 방은 그때그때 고른다.** 붙박이로 적어 두면 판마다 내가
    // 서는 자리가 달라져서 「이미 그 방이다」로 넘어진다
    let went: string | null = null
    for (const t of TILES) {
      if (t.id === myHere || !canRoamTo(myHere as TileId, t.id)) continue
      const ok = await must('roamTo', meTok, { gameId: game, tileId: t.id }).then(() => true).catch(() => false)
      if (ok) { went = t.id; break }
    }
    if (went === null) throw new Error('옮겨 갈 방을 못 찾았다. 이 시험은 아무것도 재지 못한다')
    await page.waitForTimeout(2800)
    const moved = (await page.evaluate(LOOK)) as Look
    await page.screenshot({ path: `${OUT}/rt-${size.w}-5-방을옮겼다.png` })

    // ── 7 · 옆 방으로 새는가. **서버 응답을 본다** ──────────
    // **정말로 옆 방 사람이어야 한다.** 같은 방 사람을 고르면 「안
    // 샜다」가 아니라 「들려야 할 것이 들렸다」를 재게 된다
    const outsider = away[0]
    const outHere = String(((await must('chatLines', outsider.tok, { gameId: game })) as { here?: string }).here ?? '')
    if (outHere === myHere) throw new Error('고른 사람이 같은 방이다. 이 시험은 아무것도 재지 못한다')
    const theirs = (await must('chatLines', outsider.tok, { gameId: game, sinceMs: 0 })) as {
      lines?: { text: string }[]
    }
    const leaked = (theirs.lines ?? []).filter((l) => said.includes(l.text)).map((l) => l.text)
    // **같은 방 사람에게는 갔어야 한다.** 이걸 안 보면 「서버가 아무
    // 줄도 안 보낸다」와 「안 샌다」를 구별 못 하고 그냥 통과한다
    const heardBy = (await must('chatLines', roomMates[0].tok, { gameId: game, sinceMs: 0 })) as {
      lines?: { text: string }[]
    }
    const heard = (heardBy.lines ?? []).filter((l) => said.includes(l.text)).map((l) => l.text)
    if (heard.length === 0) throw new Error('같은 방 사람도 못 들었다. 이 시험은 새는지를 재지 못한다')

    report.push({
      화면: size.이름,
      '1_닫힘': {
        지도: shut.지도,
        캔버스: shut.캔버스,
        글씨: shut.글씨,
        상한: shut.상한,
        안내말: shut.안내말,
        보인다: shut.보인다,
        세로구름: shut.세로구름,
      },
      '2_말이오간뒤': {
        로그자리: talked.로그,
        '로그가폭을다쓰나': talked.로그 !== null && talked.로그.x === 0 && talked.로그.w === size.w,
        로그줄수: talked.줄.length,
        줄: talked.줄,
        '맨위가옅다': talked.줄.length > 1 && talked.줄[0].옅기 <= 0.45,
        '아래가진하다': talked.줄.length > 1 && talked.줄[talked.줄.length - 1].옅기 === 1,
        '이름색이여럿인가': new Set(talked.줄.map((l) => l.이름색)).size,
        풍선수: talked.풍선.length,
        풍선: talked.풍선,
        '풍선이각졌나': talked.풍선.every((b) => b.모서리 === '0px'),
        '풍선이지도안': talked.풍선.every((b) => b.지도안),
        '풍선이안겹친다': notStacked(talked.풍선),
      },
      '3_가장자리': edge,
      '4_따라가나': follow,
      '5_키보드': {
        '먹은높이': KB,
        '앱이잰높이': kbSeen,
        지도: open.지도,
        캔버스: open.캔버스,
        '지도가그대로': same(shut.지도, open.지도),
        '캔버스가그대로': same(shut.캔버스, open.캔버스),
        '십자키숨었나': open.보인다.십자키 === false,
        '자원줄숨었나': open.보인다.자원줄 === false,
        '탭바숨었나': open.보인다.탭바 === false,
        '로그줄수': open.줄.length,
        '두줄로줄었나': open.줄.length === 2,
        '입력칸이키보드위': barAbove,
        '판이안끌렸다': open.끌린높이 === 0,
        '확대안됨': open.글씨 === '16px',
      },
      '6_내리고나서': { '지도가돌아왔다': same(shut.지도, back.지도), 보인다: back.보인다, 로그줄수: back.줄.length },
      '7_방을옮기면': { 간방: went, 로그줄수: moved.줄.length, 안내말: moved.안내말 },
      '8_누가들었나': {
        '같은방': { 누구: roomMates[0].id, 들은줄: heard.length },
        '옆방': { 누구: outsider.id, 그사람방: outHere, 샌줄: leaked },
      },
    })

    await ctx.close()
  }

  console.log(JSON.stringify(report, null, 1))
  console.log('터짐', JSON.stringify(boom))
  await browser.close()
  console.log('찍었다')
}

/** 풍선끼리 포개지지 않았는가. 겹치면 둘 다 못 읽는다 */
function notStacked(bs: readonly Bubble[]): boolean {
  for (let i = 0; i < bs.length; i += 1) {
    for (let j = i + 1; j < bs.length; j += 1) {
      if (Math.abs(bs[i].x - bs[j].x) < 30 && Math.abs(bs[i].y - bs[j].y) < 14) return false
    }
  }
  return true
}

void main()
