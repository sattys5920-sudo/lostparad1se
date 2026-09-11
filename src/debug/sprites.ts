// 스프라이트 검수 페이지. 게임에서 쓰지 않는 개발용 화면이다.
//
// 눈으로 볼 것 — 같은 성별 안에서 머리 실루엣이 1배율로도 갈리는가,
// 옷을 바꿔도 몸 덩치가 그대로인가.
// 자동으로 셀 것 — 모든 복장 × 스타일 × 방향에서 완장 픽셀이 남아 있는가,
// 몸 실루엣이 복장에 상관없이 똑같은가.
import { BAND_TONES, HAIR_COLORS, TEAMS } from '../school/char/palette'
import {
  DIRS,
  HAIR_BY_ID,
  HAIR_IDS_F,
  HAIR_IDS_M,
  NECKWEAR_NAMES,
  OUTFITS,
  OUTFIT_NAMES,
  PX,
  WEAR_STYLE_NAMES,
  pixelFrame,
} from '../school/char/pixel'
import type { AvatarLook, StyleSet, TeamId } from '../school/types'

const out = document.getElementById('out') as HTMLDivElement
const check = document.getElementById('check') as HTMLDivElement
const colorSel = document.getElementById('color') as HTMLSelectElement
const teamSel = document.getElementById('team') as HTMLSelectElement

HAIR_COLORS.forEach((c, i) => colorSel.add(new Option(c.name, String(i))))
TEAMS.forEach((t) => teamSel.add(new Option(t.name, t.id)))

const base = (o: Partial<AvatarLook> = {}): AvatarLook => ({
  styleSet: 'F',
  hairStyle: 'F00',
  hairColor: Number(colorSel.value),
  expression: 0,
  outfit: 1,
  wearStyle: 1,
  bottom: 0,
  neckwear: 0,
  ...o,
})

const team = () => teamSel.value as TeamId
const zoom = () => Number((document.querySelector('input[name=zoom]:checked') as HTMLInputElement).value)

/** 한 사람의 네 방향 서기 자세를 가로로 잇는다. */
function fourWays(look: AvatarLook, z: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PX * 4 * z
  c.height = PX * z
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingEnabled = false
  DIRS.forEach((dir, i) => {
    ctx.drawImage(pixelFrame(look, team(), dir, 0), 0, 0, PX, PX, i * PX * z, 0, PX * z, PX * z)
  })
  return c
}

function card(look: AvatarLook, caption: string, z: number): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'cardbox'
  box.appendChild(fourWays(look, z))
  const cap = document.createElement('div')
  cap.className = 'cap'
  cap.textContent = caption
  box.appendChild(cap)
  return box
}

function section(title: string): HTMLDivElement {
  const h = document.createElement('h2')
  h.textContent = title
  out.appendChild(h)
  const row = document.createElement('div')
  row.className = 'row'
  out.appendChild(row)
  return row
}

// ── 자동 점검 ───────────────────────────────────────────────────

const pixels = (c: HTMLCanvasElement): Uint8ClampedArray =>
  (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, PX, PX).data

const hexOf = (d: Uint8ClampedArray, i: number) =>
  `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** 완장 색이 몇 칸이나 살아 있는지. */
function bandCount(look: AvatarLook, t: TeamId, dir: (typeof DIRS)[number]): number {
  const tone = BAND_TONES[t]
  const want = new Set([tone.base, tone.shade, tone.light, tone.line])
  const d = pixels(pixelFrame(look, t, dir, 0))
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && want.has(hexOf(d, i))) n++
  return n
}

/** 실루엣 — 색을 빼고 칠해진 칸의 자리만 본다. */
function silhouette(look: AvatarLook, dir: (typeof DIRS)[number]): string {
  const d = pixels(pixelFrame(look, team(), dir, 0))
  let s = ''
  for (let i = 3; i < d.length; i += 4) s += d[i] > 0 ? '#' : '.'
  return s
}

/**
 * 칠까지 본 그림. 짧은 머리끼리는 윤곽이 같을 수밖에 없다 — 이마를 얼마나
 * 드러냈는지, 어디를 눌러 칠했는지로 갈린다. 서로 구분되는지 물으려면
 * 윤곽이 아니라 칠해진 결과를 봐야 한다.
 */
function inked(look: AvatarLook, dir: (typeof DIRS)[number]): string {
  const d = pixels(pixelFrame(look, team(), dir, 0))
  let s = ''
  for (let i = 0; i < d.length; i += 4) s += d[i + 3] > 0 ? hexOf(d, i) : '.'
  return s
}

function runChecks(): void {
  const lines: string[] = []
  let bad = 0
  const t = team()

  // 1) 모든 복장 × 스타일 × 하의 × 목장식 × 방향에서 완장이 보여야 한다
  let worstBand = 99
  let worstWhere = ''
  for (let outfit = 0; outfit < OUTFITS.length; outfit++) {
    for (let wearStyle = 0; wearStyle < WEAR_STYLE_NAMES.length; wearStyle++) {
      for (let bottom = 0; bottom < 2; bottom++) {
        for (let neckwear = 0; neckwear < NECKWEAR_NAMES.length; neckwear++) {
          for (const dir of DIRS) {
            const n = bandCount(base({ outfit, wearStyle, bottom, neckwear }), t, dir)
            if (n < worstBand) {
              worstBand = n
              worstWhere = `${OUTFIT_NAMES[outfit]}·${WEAR_STYLE_NAMES[wearStyle]}·${dir}`
            }
          }
        }
      }
    }
  }
  if (worstBand < 6) bad++
  lines.push(
    `완장  가장 적게 보인 조합 ${worstWhere} → ${worstBand}칸 ` + (worstBand >= 6 ? '(3×2 그대로)' : '(가려졌다)'),
  )

  // 2) 옷을 바꿔도 몸 실루엣은 그대로여야 한다
  //    머리 부분(위 20줄)은 머리 모양이 정하므로 몸만 본다
  const bodyOf = (s: string) => s.slice(20 * PX)
  let shapeBad = 0
  for (const dir of DIRS) {
    const ref = bodyOf(silhouette(base({ outfit: 1, wearStyle: 1 }), dir))
    for (let outfit = 0; outfit < OUTFITS.length; outfit++) {
      for (let wearStyle = 0; wearStyle < WEAR_STYLE_NAMES.length; wearStyle++) {
        const got = bodyOf(silhouette(base({ outfit, wearStyle }), dir))
        if (got !== ref) {
          shapeBad++
          lines.push(`  · ${OUTFIT_NAMES[outfit]}·${WEAR_STYLE_NAMES[wearStyle]}·${dir} 실루엣이 다르다`)
        }
      }
    }
  }
  if (shapeBad) bad++
  lines.push(`몸 실루엣  복장 6 × 스타일 3 × 4방향 = 72가지 중 어긋난 것 ${shapeBad}가지`)

  // 3) 같은 성별 안에서 머리 실루엣이 서로 달라야 한다
  for (const [set, ids] of [
    ['여', HAIR_IDS_F],
    ['남', HAIR_IDS_M],
  ] as [string, string[]][]) {
    const seen = new Map<string, string>()
    const dup: string[] = []
    for (const id of ids) {
      const s = DIRS.map((d) => inked(base({ hairStyle: id, styleSet: id[0] as StyleSet }), d)).join('')
      const prev = seen.get(s)
      if (prev) dup.push(`${prev}=${id}`)
      else seen.set(s, id)
    }
    if (dup.length) bad++
    lines.push(`${set}자 머리 ${ids.length}종  똑같이 그려지는 짝: ${dup.length ? dup.join(', ') : '없음'}`)
  }

  check.innerHTML = lines.map((l) => l).join('\n')
  check.className = bad ? 'bad' : 'ok'
}

// ── 그리기 ──────────────────────────────────────────────────────

function draw(): void {
  out.innerHTML = ''
  const z = zoom()

  for (const [title, ids] of [
    ['여자 머리 15종 — 아래 · 왼쪽 · 오른쪽 · 위', HAIR_IDS_F],
    ['남자 머리 15종 — 아래 · 왼쪽 · 오른쪽 · 위', HAIR_IDS_M],
  ] as [string, string[]][]) {
    const row = section(title)
    for (const id of ids) {
      const look = base({ hairStyle: id, styleSet: id[0] as StyleSet, bottom: id[0] === 'F' ? 1 : 0 })
      row.appendChild(card(look, `${id} ${HAIR_BY_ID[id].name}`, z))
    }
  }

  for (let wearStyle = 0; wearStyle < WEAR_STYLE_NAMES.length; wearStyle++) {
    const row = section(`교복 — ${WEAR_STYLE_NAMES[wearStyle]}`)
    for (let outfit = 0; outfit < OUTFITS.length; outfit++) {
      for (const bottom of [0, 1]) {
        row.appendChild(
          card(
            base({ outfit, wearStyle, bottom, hairStyle: bottom ? 'F00' : 'M00', styleSet: bottom ? 'F' : 'M' }),
            `${OUTFIT_NAMES[outfit]} ${bottom ? '치마' : '바지'}`,
            z,
          ),
        )
      }
    }
  }

  const neckRow = section('목 장식')
  for (let neckwear = 0; neckwear < NECKWEAR_NAMES.length; neckwear++) {
    for (const wearStyle of [0, 2]) {
      neckRow.appendChild(
        card(base({ neckwear, wearStyle, outfit: 2 }), `${NECKWEAR_NAMES[neckwear]} ${WEAR_STYLE_NAMES[wearStyle]}`, z),
      )
    }
  }

  runChecks()
}

for (const el of document.querySelectorAll('input[name=zoom], #color, #team')) {
  el.addEventListener('change', draw)
}
draw()
