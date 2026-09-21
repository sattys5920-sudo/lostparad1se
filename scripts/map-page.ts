// 전개도 한 장. **브라우저로 그린다.**
//
// 파이썬으로 그려 봤더니 한글이 통째로 두부였다 — 이 상자에는 한글
// 글꼴이 없고 IPAGothic(일본어)만 있다. 화면 캡처가 멀쩡했던 것은
// 크로뮴이 제 글꼴을 쓰기 때문이라, 지도도 크로뮴에게 그리게 한다.
//
//   npx vite-node scripts/map-page.ts
import { mkdirSync, writeFileSync } from 'node:fs'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { MAP_W, MAP_H, tileAt, stairHere } from '../src/school/map/world'
import { TILES, FLOOR_NAME, FLOORS, roomOfCell, type Floor } from '../shared/rules/board'
import { BOARDS } from '../shared/rules/errand'
import { VENDINGS } from '../shared/rules/shop'
import { POT_CELLS, GARDEN_TILE } from '../shared/rules/crop'
import { START_TILE } from '../shared/rules/v2'
import { capacityOf } from '../shared/rules/occupy'

const { chromium } = pw as typeof import('playwright')
const OUT = '/tmp/claude-0/mapshot'
/** 한 칸 화소. 스물다섯 방 이름이 들어가려면 이쯤은 돼야 한다 */
const S = 12

/** 학교와 같은 잿빛 남색. 화면에서 쓰는 톤 그대로다 */
const C = {
  bg: '#0e1016',
  wall: '#1e222e',
  floor: '#c4c8d6',
  hall: '#8c92a8',
  door: '#e8c66e',
  stair: '#6c789c',
  edge: '#3a4054',
  ink: '#e8eaf4',
  dim: '#7c86a0',
  board: '#d6d0b4',
  vending: '#78beeb',
  pot: '#78be82',
}

/** 층마다 전개도에서 차지하는 y 범위. 방들의 위아래 끝으로 잰다 */
function bandOf(floor: Floor): { y0: number; y1: number } {
  const rs = TILES.filter((t) => t.floor === floor)
  return {
    y0: Math.min(...rs.map((t) => t.plan.y)),
    y1: Math.max(...rs.map((t) => t.plan.y + t.plan.h)),
  }
}

function build(): string {
  const cells: string[] = []
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = tileAt(x, y)
      // 계단은 벽으로 오지만 지나가는 곳이다. 따로 칠한다
      const fill =
        stairHere(x, y) ? C.stair
        : k === 'wall' ? C.wall
        : k === 'door' ? C.door
        : k === 'hall' ? C.hall
        : roomOfCell(x, y) !== null ? C.floor
        : null
      if (!fill) continue
      cells.push(`<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" fill="${fill}"/>`)
    }
  }

  const rooms = TILES.map((t) => {
    const r = t.plan
    const cx = (r.x + r.w / 2) * S
    const cy = (r.y + r.h / 2) * S
    const note = `${t.id === START_TILE ? '시작 · ' : ''}${capacityOf(t.id)}명`
    return (
      `<rect x="${r.x * S}" y="${r.y * S}" width="${r.w * S}" height="${r.h * S}" ` +
      `fill="none" stroke="${C.edge}" stroke-width="2"/>` +
      `<text class="rm" x="${cx}" y="${cy - 3}">${t.name}</text>` +
      `<text class="nt" x="${cx}" y="${cy + 13}">${note}</text>`
    )
  })

  // 복도에 선 것 — 한 칸 폭, 두 칸 높이(화면에서 그리는 것과 같다)
  const spots = [
    ...BOARDS.map((b) => ({ ...b.cell, fill: C.board, label: '게시판' })),
    ...VENDINGS.map((v) => ({ ...v.cell, fill: C.vending, label: '자판기' })),
  ].map(
    (s) =>
      `<rect x="${s.x * S}" y="${(s.y - 1) * S}" width="${S}" height="${S * 2}" fill="${s.fill}" stroke="#0e1016"/>` +
      `<text class="sp" x="${s.x * S + S + 4}" y="${(s.y - 1) * S + 11}" fill="${s.fill}">${s.label}</text>`,
  )
  const pots = POT_CELLS.map(
    (c) => `<circle cx="${c.x * S + S / 2}" cy="${c.y * S + S / 2}" r="${S / 2 - 1}" fill="${C.pot}"/>`,
  )

  const bands = FLOORS.map((f) => {
    const { y0, y1 } = bandOf(f)
    return (
      `<line x1="-46" y1="${y0 * S}" x2="-46" y2="${y1 * S}" stroke="${C.edge}" stroke-width="3"/>` +
      `<text class="fl" x="-60" y="${((y0 + y1) / 2) * S}">${FLOOR_NAME[f]}</text>`
    )
  })

  const legend = [
    ['방', C.floor],
    ['복도', C.hall],
    ['문', C.door],
    ['계단', C.stair],
    ['게시판', C.board],
    ['자판기', C.vending],
    ['화분', C.pot],
  ]
    .map(([name, fill], i) => {
      const x = i * 92
      return (
        `<rect x="${x}" y="0" width="14" height="14" fill="${fill}"/>` +
        `<text class="lg" x="${x + 20}" y="11">${name}</text>`
      )
    })
    .join('')

  const gardenNote = `${TILES.find((t) => t.id === GARDEN_TILE)?.name}의 화분 여덟 자리`

  return `<!doctype html><meta charset="utf-8"><title>학교 전개도</title>
<style>
  body { margin: 0; background: ${C.bg}; color: ${C.ink};
         font: 13px/1.4 system-ui, -apple-system, "Noto Sans KR", sans-serif; }
  .wrap { padding: 20px 24px 28px 96px; display: inline-block; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; letter-spacing: .02em; }
  .sub { color: ${C.dim}; font-size: 12px; margin: 0 0 14px; }
  text { dominant-baseline: middle; }
  .rm { fill: ${C.ink}; font-size: 13px; font-weight: 600; text-anchor: middle;
        paint-order: stroke; stroke: #161922; stroke-width: 5px; stroke-linejoin: round; }
  .nt { fill: ${C.dim}; font-size: 11px; text-anchor: middle;
        paint-order: stroke; stroke: #161922; stroke-width: 4px; stroke-linejoin: round; }
  .sp { font-size: 11px; paint-order: stroke; stroke: #0e1016; stroke-width: 4px; }
  .fl { fill: ${C.ink}; font-size: 17px; font-weight: 600; text-anchor: end; }
  .lg { fill: ${C.dim}; font-size: 12px; }
</style>
<div class="wrap">
  <h1>남겨진 아이들 — 학교 전개도</h1>
  <p class="sub">층을 위아래로 펼쳐 놓은 한 장이다. 계단이 층과 층을 잇는다 · ${gardenNote}</p>
  <svg width="${(7 * 92)}" height="16" style="display:block;margin-bottom:10px">${legend}</svg>
  <svg width="${MAP_W * S}" height="${MAP_H * S}" style="overflow:visible;display:block">
    ${cells.join('')}
    ${pots.join('')}
    ${rooms.join('')}
    ${spots.join('')}
    ${bands.join('')}
  </svg>
</div>`
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const file = `${OUT}/map.html`
  writeFileSync(file, build(), 'utf8')

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`file://${file}`)
  await page.waitForTimeout(400)
  const el = page.locator('.wrap')
  await el.screenshot({ path: `${OUT}/school-map.png` })
  await browser.close()
  console.log(`${OUT}/school-map.png 에 담았다.`)
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
