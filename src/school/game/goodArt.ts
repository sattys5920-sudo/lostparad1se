// 거래 탁자에 오르는 것들의 도트 아이콘.
//
// **팔레트는 넷뿐이다**(map/sprites.ts 의 PAL). 0 은 밝은 면, 1 은 회색,
// 2 는 중간 톤, 3 은 윤곽이다. 빈칸은 투명이다 — 방 소품과 같은 규칙이라
// 같은 학교에서 온 그림으로 보인다.
//
// 한 칸은 12×12 다. 소품은 16 칸이지만 이것들은 글자 옆에 서는 것이라,
// 11px 글줄 높이에 맞춰 한 단계 작게 그린다. 화면에서는 두 배(24px)로
// 늘려 붙인다 — **정수 배로만 늘린다.** 1.5배로 늘리면 도트가 뭉개진다.
//
// 글자만 있던 때는 슬롯 넷이 다 똑같이 생겨서, 탁자에 무엇이 올라왔는지
// 읽어야 알았다. 흥정은 흘깃 보는 것이라 읽을 틈이 없다.
import { PAL } from '../map/sprites'
import { ITEMS } from '../../../shared/rules/items'

/** 12×12 한 칸. 짧게 적은 줄은 오른쪽을 공백으로 채운다. */
const P = (rows: string[]): string[] => rows.map((r) => r.padEnd(12, ' ').slice(0, 12))

/** 돈 — 가운데가 뚫린 옛 동전. */
const COIN = P([
  '            ',
  '    3333    ',
  '  33111133  ',
  ' 3111111113 ',
  ' 3112222113 ',
  ' 3112  2113 ',
  ' 3112  2113 ',
  ' 3112222113 ',
  ' 3111111113 ',
  '  33111133  ',
  '    3333    ',
  '            ',
])

/** 지식 — 학사모. 널찍한 판 아래 모자가 있고 오른쪽에 술이 늘어진다. */
const CAP = P([
  '            ',
  '     33     ',
  '   331133   ',
  ' 3311111133 ',
  '331111111133',
  ' 3333333333 ',
  '   333333 3 ',
  '   322223 3 ',
  '   333333 3 ',
  '         333',
  '         333',
  '            ',
])

/** 거래 토큰 — 한 번 쓰고 떼는 표. */
const TICKET = P([
  '            ',
  '            ',
  '  33333333  ',
  ' 3111111113 ',
  ' 3133333313 ',
  ' 3130000313 ',
  ' 3130000313 ',
  ' 3133333313 ',
  ' 3111111113 ',
  '  33333333  ',
  '            ',
  '            ',
])

/** 호루라기 — 입에 무는 쪽이 왼쪽, 바람 나가는 구멍이 위에 있다. */
const WHISTLE = P([
  '            ',
  '            ',
  '       33   ',
  '     333333 ',
  '  3331111113',
  ' 31111111113',
  ' 31111111113',
  '  3331111113',
  '     333333 ',
  '            ',
  '            ',
  '            ',
])

/** 남의 명찰 — 위에 집게가 달린 이름표. */
const NAMETAG = P([
  '            ',
  '     33     ',
  '    3  3    ',
  '  33333333  ',
  '  31111113  ',
  '  31333113  ',
  '  31111113  ',
  '  31333313  ',
  '  31111113  ',
  '  33333333  ',
  '            ',
  '            ',
])

/** 쪽지 — **접힌 채로 간다.** 가운데 금이 접은 자리다. */
const NOTE = P([
  '            ',
  '            ',
  '  33333333  ',
  '  31111113  ',
  '  31222113  ',
  '  31111113  ',
  '  33333333  ',
  '  31111113  ',
  '  31221113  ',
  '  33333333  ',
  '            ',
  '            ',
])

/** 짝 — 데리고 다니는 것. 더듬이 달린 머리 하나. */
const ROBOT = P([
  '            ',
  '     33     ',
  '  33333333  ',
  '  31111113  ',
  '  33111133  ',
  '  31311313  ',
  '  31111113  ',
  '  31333313  ',
  '  31111113  ',
  '  33333333  ',
  '            ',
  '            ',
])

/**
 * 무엇에 어떤 그림이 붙는가. **거래창의 슬롯 이름과 하나씩 맞는다.**
 *
 * 물건이 하나 늘면 여기도 늘어야 한다 — 아래 자기 검사가 빠진 것을
 * 잡는다. 안 잡으면 그림 없는 칸이 조용히 빈 채로 나간다.
 */
export const GOOD_ART: Readonly<Record<string, readonly string[]>> = {
  money: COIN,
  knowledge: CAP,
  tokens: TICKET,
  slips: NOTE,
  robots: ROBOT,
  whistle: WHISTLE,
  nameTag: NAMETAG,
}

export const ICON_PX = 12

// 그림이 틀어진 채로 나가지 않게 여기서 막는다. 12줄 12칸이 아니거나
// 아는 색이 아니면 화면이 뜨기 전에 터진다
for (const [key, rows] of Object.entries(GOOD_ART)) {
  if (rows.length !== ICON_PX) throw new Error(`${key}: ${rows.length}줄이다. ${ICON_PX}줄이어야 한다`)
  for (const [i, r] of rows.entries()) {
    if (r.length !== ICON_PX) throw new Error(`${key} ${i}번째 줄이 ${r.length}칸이다`)
    for (const c of r) if (!' 0123'.includes(c)) throw new Error(`${key}: 모르는 색 ${c}`)
  }
}
for (const i of ITEMS) {
  if (!GOOD_ART[i.kind]) throw new Error(`${i.name}(${i.kind})에 그림이 없다`)
}

const CH: Record<string, string | null> = {
  ' ': null,
  '0': PAL.paper,
  '1': PAL.light,
  '2': PAL.mid,
  '3': PAL.ink,
}

const baked = new Map<string, string>()

/**
 * 그 그림을 한 번 구워 두고 다시 쓴다.
 *
 * 화면이 다시 그려질 때마다 캔버스를 새로 만들면, 슬롯 여덟 개짜리
 * 탁자가 상대의 손끝을 따라 초당 몇 번씩 구워진다.
 */
export function goodIcon(key: string): string {
  const has = baked.get(key)
  if (has) return has
  const rows = GOOD_ART[key]
  if (!rows) return ''
  const canvas = document.createElement('canvas')
  canvas.width = ICON_PX
  canvas.height = ICON_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  for (const [y, row] of rows.entries()) {
    for (const [x, c] of [...row].entries()) {
      const color = CH[c]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
  const url = canvas.toDataURL()
  baked.set(key, url)
  return url
}
