// 종이 위에 찍힌 자판기 한 대.
//
// **지도에 선 그 기계와 같은 그림이다**(map/propArt 의 VENDING) — 두
// 군데에 따로 그려 두면 한쪽만 고쳐지는 날이 온다. 다른 것은 색뿐이다:
// 학교는 잿빛 남색이고 이 종이는 누런 크림이라, 같은 팔레트로 찍으면
// 종이 위에 남의 그림이 얹힌 것으로 보인다. **종이의 잉크로 다시
// 굽는다** — 인쇄된 것처럼.
import { VENDING } from '../map/propArt'

/** 종이의 색. gate.css 와 같은 값이다 */
const INK: Record<string, string> = {
  '0': '#d5cebc', // 밝은 면 — 종이색 그대로
  '1': '#b8b09a', // 옅은 잉크
  '2': '#8a8371', // 중간
  '3': '#2e2a20', // 윤곽
}

let baked: string | null = null

/**
 * 한 번 굽고 다시 쓴다. 화면이 다시 그려질 때마다 캔버스를 새로 만들면
 * 눈이 깜빡일 때마다 기계를 새로 찍는 셈이다.
 */
export function vendingStamp(): string {
  if (baked !== null) return baked
  const canvas = document.createElement('canvas')
  canvas.width = VENDING[0].length
  canvas.height = VENDING.length
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  for (const [y, row] of VENDING.entries()) {
    for (const [x, ch] of [...row].entries()) {
      const color = INK[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
  baked = canvas.toDataURL()
  return baked
}
