// 십자키로 걷는 손. **캡처 스크립트 셋이 같이 쓴다.**
//
// 세 벌로 베껴 두었더니 한 벌만 고친 날이 왔고, 「walkTo is not defined」로
// 캡처가 통째로 멎었다. 한 군데에 둔다.
//
// 여기서 붙드는 것 하나: **아바타는 화면이 쥐고 있다.** 서버에는 멈출 때
// 한 번 적히므로, 걸음마다 서버를 읽으면 늘 한 박자 늦은 자리가 온다.
// 길은 지도에서 미리 내고, 끝까지 누른 뒤에 한 번 맞춰 본다.
import { isWalkable, tileAt } from '../../src/school/map/world'

type Page = import('playwright').Page
export interface Cell {
  x: number
  y: number
}

/**
 * 한 칸씩 짚어 가는 길. **BFS 로 먼저 길을 낸다.**
 *
 * 전에는 「목표 쪽으로 누른다」였다. 2층 서쪽 복도는 y29 가 통째로
 * 벽이고 x8~9 만 뚫려 있어서, 위에서 내려오던 봇이 벽에 대고 아래만
 * 계속 눌렀다. 막히면 가로로 트는 임시 처방으로는 못 돌아 나온다 —
 * 지도를 보고 가야 한다.
 */
export function pathTo(from: Cell, want: Cell): Cell[] {
  const key = (x: number, y: number) => `${x},${y}`
  const near = (c: Cell) => Math.abs(c.x - want.x) <= 1 && Math.abs(c.y - want.y) <= 1
  const back = new Map<string, string | null>([[key(from.x, from.y), null]])
  let edge: Cell[] = [from]
  for (let step = 0; step < 400 && edge.length > 0; step++) {
    const next: Cell[] = []
    for (const c of edge) {
      if (near(c)) {
        // 거꾸로 따라 올라가 순서를 세운다
        const out: Cell[] = []
        let at: string | null = key(c.x, c.y)
        while (at !== null) {
          const [x, y] = at.split(',').map(Number)
          out.unshift({ x, y })
          at = back.get(at) ?? null
        }
        return out.slice(1)
      }
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const nx = c.x + dx
        const ny = c.y + dy
        if (back.has(key(nx, ny)) || !isWalkable(nx, ny)) continue
        back.set(key(nx, ny), key(c.x, c.y))
        next.push({ x: nx, y: ny })
      }
    }
    edge = next
  }
  return []
}

/** 지금 선 칸. 서버가 아는 값이다 — 화면이 멈출 때마다 적어 보낸다 */
export async function cellNow(fs: string, admin: HeadersInit, game: string, uid: string): Promise<Cell | null> {
  const r = await fetch(`${fs}/games/${game}/pawns/${uid}`, { headers: admin })
  const f = ((await r.json()) as { fields?: Record<string, unknown> }).fields ?? {}
  const m = (f.at as { mapValue?: { fields?: Record<string, unknown> } })?.mapValue?.fields
  if (!m) return null
  const n = (v: unknown) => Number((v as { integerValue?: string })?.integerValue ?? 0)
  return { x: n(m.x), y: n(m.y) }
}

export interface WalkArgs {
  page: Page
  fs: string
  admin: HeadersInit
  game: string
  uid: string
  want: Cell
  /** 로그 앞머리. 「게시판」 「자판기」처럼 무엇 앞에 서려는지 */
  what?: string
}

/** 십자키를 눌러 그 칸 옆까지 간다. 못 가면 말하고 돌아온다 */
export async function walkTo({ page, fs, admin, game, uid, want, what = '자리' }: WalkArgs): Promise<boolean> {
  for (let leg = 0; leg < 24; leg++) {
    /*
     * **문을 지난 직후에는 자리가 없다.** 서버가 방을 옮길 때 칸을
     * 비우고, 화면이 반 박자 뒤에 새 자리를 적는다(500ms 마다). 그
     * 사이에 포기하면 옆방 문턱에서 멈춘 채로 캡처가 끝난다.
     */
    let at = await cellNow(fs, admin, game, uid)
    for (let wait = 0; !at && wait < 12; wait++) {
      await page.waitForTimeout(400)
      at = await cellNow(fs, admin, game, uid)
    }
    if (!at) {
      await page.locator('.sc-ct__key.is-down').click({ timeout: 2000 }).catch(() => undefined)
      await page.waitForTimeout(240)
      continue
    }
    if (Math.abs(at.x - want.x) <= 1 && Math.abs(at.y - want.y) <= 1) {
      console.log(`  ${what} 앞에 섰다 — ${at.x},${at.y}`)
      return true
    }
    const path = pathTo(at, want)
    if (path.length === 0) {
      console.log(`  ✗ ${want.x},${want.y} 로 가는 길이 없다 — 지금 ${at.x},${at.y}`)
      return false
    }
    let now = at
    for (const step of path) {
      const dir =
        step.y > now.y ? 'is-down'
        : step.y < now.y ? 'is-up'
        : step.x > now.x ? 'is-right'
        : 'is-left'
      await page.locator(`.sc-ct__key.${dir}`).click({ timeout: 2000 }).catch(() => undefined)
      await page.waitForTimeout(200)
      now = step
      /*
       * **문을 지나면 거기서 끊는다.** 문을 넘는 순간 서버가 방을
       * 옮기고 화면이 아바타를 새 방 안쪽에 다시 세운다 — 미리
       * 눌러 둔 나머지 걸음은 엉뚱한 데서 밟힌다. 끊고 다시 잰다.
       */
      if (tileAt(step.x, step.y) === 'door') break
    }
    await page.waitForTimeout(900)
    const end = await cellNow(fs, admin, game, uid)
    if (end && Math.abs(end.x - want.x) <= 1 && Math.abs(end.y - want.y) <= 1) {
      console.log(`  ${what} 앞에 섰다 — ${end.x},${end.y}`)
      return true
    }
    console.log(`  ${leg + 1}번째 — ${end ? `${end.x},${end.y}` : '어딘지 모름'}`)
  }
  console.log(`  ✗ ${want.x},${want.y} 까지 못 갔다`)
  return false
}

/** 화면 속 단추를 이름으로 누른다. 말줄이 덮고 있어도 눌린다 */
export async function tap(page: Page, sel: string, text: string): Promise<void> {
  await page.evaluate(
    ([s, t]) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent?.includes(t))
      ;(b as HTMLElement | undefined)?.click()
    },
    [sel, text],
  )
}
