// 색이 두 군데 살면 반드시 어긋난다.
//
// CSS 는 skin.ts 를 못 읽으므로 같은 값을 controls.css 에도 적어 둔다.
// 이 시험이 그 두 벌을 맞대 본다 — 한쪽만 고치면 여기서 넘어진다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TEAMS } from './char/palette'
import { TEAM_COLOR } from './game/MapPlan'
import { MAP, TYPE, UI } from './skin'

const CSS = readFileSync(join(__dirname, 'game', 'controls.css'), 'utf8')
const PLAY = readFileSync(join(__dirname, 'game', 'play.css'), 'utf8')
const THEME = readFileSync(join(__dirname, 'theme.css'), 'utf8')

/** `--이름: #값;` 을 찾아 소문자 hex 로 돌려준다. */
function cssVar(name: string): string | null {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`))
  return m ? m[1].toLowerCase() : null
}

describe('맵과 UI 가 같은 팔레트를 본다', () => {
  it.each([
    ['ct-bg', UI.bg],
    ['ct-face', UI.face],
    ['ct-line', UI.line],
    ['ct-text', UI.text],
    ['ct-gold', UI.gold],
    ['ct-ice', UI.ice],
    ['ct-down', UI.down],
    ['ct-bevel-lit', UI.bevelLit],
    ['ct-bevel-dim', UI.bevelDim],
    ['ct-log', UI.logText],
    ['mp-floor', MAP.floor],
    ['mp-wall', MAP.wall],
    ['mp-outline', MAP.outline],
  ])('--%s 가 skin.ts 와 같다', (name, want) => {
    expect(cssVar(name), `controls.css 의 --${name}`).toBe(want.toLowerCase())
  })

  it('CSS 에서 못 찾은 변수가 하나도 없다 — 정규식이 헛돌면 전부 통과한다', () => {
    expect(cssVar('ct-bg')).not.toBeNull()
    expect(cssVar('없는변수')).toBeNull()
  })
})

describe('색이 한 계열이다', () => {
  /** hex → 0..255 셋 */
  const rgb = (h: string): [number, number, number] => {
    const n = parseInt(h.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  it('맵 바닥이 흰색이 아니다 — 흰 바닥이 화면을 위아래로 갈랐다', () => {
    const [r, g, b] = rgb(MAP.floor)
    expect(Math.min(r, g, b), '너무 밝으면 흰색이다').toBeLessThan(230)
    // 차가운 쪽으로 기울어 있어야 한다
    expect(b).toBeGreaterThan(r)
  })

  it('맵도 UI 도 파랑이 빨강보다 높다 — 같은 계열이라는 뜻', () => {
    for (const c of [MAP.floor, MAP.floorHall, MAP.wall, MAP.outline, UI.bg, UI.face]) {
      const [r, , b] = rgb(c)
      expect(b, `${c} 가 차갑지 않다`).toBeGreaterThan(r)
    }
  })

  it('UI 배경이 맵 바닥보다 어둡다 — 아래로 갈수록 저녁이 깊어진다', () => {
    const lum = (h: string) => { const [r, g, b] = rgb(h); return r + g + b }
    expect(lum(UI.bg)).toBeLessThan(lum(MAP.wall))
    expect(lum(MAP.wall)).toBeLessThan(lum(MAP.floorHall))
    expect(lum(MAP.floorHall)).toBeLessThan(lum(MAP.floor))
    expect(lum(MAP.floor)).toBeLessThan(lum(MAP.floorOut))
  })

  it('외곽선이 순수 검정이 아니다', () => {
    expect(MAP.outline).not.toBe('#000000')
    const [r, , b] = rgb(MAP.outline)
    expect(b).toBeGreaterThan(r)
  })

  it('글자 크기는 세 단계뿐이고 전부 정수다', () => {
    const sizes = Object.values(TYPE)
    expect(sizes).toHaveLength(3)
    for (const n of sizes) expect(Number.isInteger(n)).toBe(true)
    expect([...sizes].sort((a, b) => a - b)).toEqual([9, 12, 16])
  })
})

describe('팔레트가 한 벌이다', () => {
  it('조작부 아이콘도 skin.ts 의 UI 를 그대로 쓴다', async () => {
    // 전에는 uiArt.ts 가 같은 값을 따로 적어 두고 있었다. 두 벌이
    // 되면 한쪽만 고쳐지는 날이 온다 — 그날 조작부만 색이 어긋난다
    const art = (await import('./game/uiArt')) as { UI: unknown }
    expect(art.UI).toBe(UI)
  })
})

describe('완장 색도 한 벌이다', () => {
  it('play.css 의 --pl-* 가 char/palette.ts 의 TEAMS 와 같다', () => {
    // 같은 팀이 지도에서는 붉고 조작부에서는 다른 붉은색이면, 그
    // 미묘한 차이가 제일 먼저 눈에 띈다
    for (const t of TEAMS) {
      const got = PLAY.match(new RegExp(`--pl-${t.id.toLowerCase()}:\\s*([^;]+);`))
      expect(got?.[1].trim()).toBe(t.color)
    }
  })

  it('지도의 TEAM_COLOR 도 같은 네 값이다', () => {
    for (const t of TEAMS) expect(TEAM_COLOR[t.id]).toBe(t.color)
  })

  it('theme.css 에는 완장 색이 없다 — 쓰지도 않는 다섯째 벌이었다', () => {
    expect(THEME).not.toMatch(/--team-[abcd]\s*:/)
  })
})
