// 방 이름표. **화면 위에 떠 있는 글씨가 아니라 방 안에 선 물건이다.**
//
// 예전에는 방 이름을 캔버스 위에 그냥 얹었다. 글씨가 벽을 뚫고 떠
// 있어서 게임 화면이 아니라 설계 도면처럼 보였다. 이제는 문 옆에
// 팻말을 세우고 거기에 글자를 새긴다 — 걸어가서 읽는 것이다.
//
// 왼쪽 위 안내(방 이름·등급·머릿수)는 그대로 둔다. 그건 UI 고
// 이건 배경이다.
import { TILES } from '../../../shared/rules/board'
import { PAL } from './sprites'

/** 픽셀 글꼴은 이 크기에서만 또렷하다. 배수로만 키운다. */
export const SIGN_FONT_PX = 11
/** 글자 양옆에 남기는 여백(px). */
export const SIGN_PAD = 10

const WIDE = /[ᄀ-ᇿ　-〿㄰-㆏가-힣＀-￯]/

/**
 * 11px 갈무리에서 그 글자가 차지하는 너비.
 *
 * **글꼴을 읽지 않고 센다.** 판 너비가 곧 막히는 칸 수라, 글꼴이
 * 늦게 도착하는 바람에 판이 한 칸 넓어지거나 좁아지면 벽이 움직인다.
 * 한글·전각은 11, 나머지는 6이다.
 */
export const signTextPx = (s: string): number =>
  [...s].reduce((n, c) => n + (WIDE.test(c) ? SIGN_FONT_PX : 6), 0)

/** 판이 몇 칸짜리인가. 글자가 안 들어가면 옆으로 늘린다. */
export const signTiles = (name: string): number =>
  Math.max(2, Math.ceil((signTextPx(name) + SIGN_PAD) / 16))

/**
 * 글꼴 이름. **CSS 가 쓰는 이름과 일부러 다르게 둔다.**
 *
 * play.css 에도 같은 파일로 Galmuri11 이 선언돼 있는데, CSS 의
 * @font-face 는 그 글꼴로 그리는 글자가 화면에 나올 때까지 파일을
 * 받지 않는다. 캔버스는 그 「나올 때」에 들지 않아서, 같은 이름을
 * 쓰면 아직 안 받은 얼굴을 집고 기본 글꼴로 새겨진다. 이름을
 * 따로 두고 여기서 직접 받는다.
 */
export const SIGN_FONT = 'Galmuri11 Plate'

let loading: Promise<void> | null = null

/** 픽셀 글꼴을 불러온다. 두 번 불러도 한 번만 받는다. */
export function loadSignFont(): Promise<void> {
  if (loading) return loading
  const url = `${import.meta.env.BASE_URL}fonts/Galmuri11.woff2`
  const face = new FontFace(SIGN_FONT, `url(${url})`)
  loading = face
    .load()
    .then((f) => {
      document.fonts.add(f)
    })
    .catch(() => {
      // 글꼴을 못 받아도 팻말은 선다. 기본 글꼴로 새긴다
    })
  return loading
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const INK = rgb(PAL.ink)
const MID = rgb(PAL.mid)

/**
 * 팻말 한 장을 굽는다. 높이는 한 칸, 너비는 이름이 정한다.
 *
 * 어두운 방에서도 읽히도록 판 뒤에 아주 옅은 빛 판을 깐다.
 *
 * **글자는 팔레트 세 톤으로 눌러 담는다.**
 *
 * 브라우저는 11px 갈무리도 가장자리를 흐리게 문지른다. 한때 그 반투명한
 * 점을 통째로 버려 두 색으로 만들었더니 가는 획이 같이 날아갔다 —
 * 도서관이 「도시관」이 되고 기술실이 「기슬실」이 됐다. 버리는 대신
 * 진한 점은 윤곽색, 옅은 점은 중간색으로 내려놓는다. 획이 살아남고,
 * 판 위에 도트 아닌 색이 섞이지도 않는다.
 */
export function bakeSign(name: string): HTMLCanvasElement {
  const tiles = signTiles(name)
  const w = tiles * 16
  const c = document.createElement('canvas')
  c.width = w
  c.height = 16
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.imageSmoothingEnabled = false

  // 뒤에 깔린 옅은 빛. 판보다 한 픽셀씩 넓다
  g.fillStyle = 'rgba(238,240,242,0.16)'
  g.fillRect(0, 0, w, 16)

  // 판 — 벽보다 밝게, 1px 윤곽
  g.fillStyle = PAL.ink
  g.fillRect(0, 1, w, 15)
  g.fillStyle = PAL.light
  g.fillRect(1, 2, w - 2, 13)
  g.fillStyle = PAL.paper
  g.fillRect(1, 2, w - 2, 1)
  g.fillStyle = PAL.mid
  g.fillRect(1, 14, w - 2, 1)

  // 나사 둘
  g.fillStyle = PAL.mid
  g.fillRect(2, 3, 1, 1)
  g.fillRect(w - 3, 3, 1, 1)

  // 글자를 따로 찍어 세 톤으로 눌러 담는다
  const cut = document.createElement('canvas')
  cut.width = w
  cut.height = 16
  const t = cut.getContext('2d') as CanvasRenderingContext2D
  t.font = `${SIGN_FONT_PX}px "${SIGN_FONT}", monospace`
  t.textBaseline = 'alphabetic'
  t.textAlign = 'left'
  t.fillStyle = '#ffffff'
  // 갈무리11 은 글자가 밑줄 위로 10줄이다. 밑줄을 13에 두면 3~12 줄을
  // 쓰고, 위의 반짝임(2줄)과 아래 그늘(14줄)에 닿지 않는다
  t.fillText(name, Math.round((w - signTextPx(name)) / 2), 13)

  const src = t.getImageData(0, 0, w, 16)
  const dst = g.getImageData(0, 0, w, 16)
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3]
    if (a < 64) continue
    const [r, gg, bb] = a >= 160 ? INK : MID
    dst.data[i] = r
    dst.data[i + 1] = gg
    dst.data[i + 2] = bb
    dst.data[i + 3] = 255
  }
  g.putImageData(dst, 0, 0)

  return c
}

let sheet: Record<string, HTMLCanvasElement> | null = null

/**
 * 방마다 한 장씩 구운 팻말.
 *
 * 글꼴이 늦게 도착하므로 처음에는 기본 글꼴로 굽고, 갈무리가 오면
 * 한 번 더 굽는다. 판 너비는 글꼴과 상관없이 정해져 있어서(signTiles)
 * 다시 구워도 막히는 칸은 그대로다.
 */
export function signSheet(): Record<string, HTMLCanvasElement> {
  if (!sheet) {
    sheet = Object.fromEntries(TILES.map((t) => [t.id, bakeSign(t.name)]))
    void loadSignFont().then(() => {
      sheet = Object.fromEntries(TILES.map((t) => [t.id, bakeSign(t.name)]))
    })
  }
  return sheet
}
