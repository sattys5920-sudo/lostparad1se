// 기물 그림이 어디에 그려지는가 — **막힌 칸과 그린 칸이 같아야 한다.**
//
// 기물(게시판 · 자판기 · 제조기 · 연구 기계 · 오락기 · 화분)은 한 칸을
// 막는다(rules/fixtures). 그림은 **발을 그 칸 바닥에 딛고 키만큼 위로
// 솟는다.** 한 칸짜리 그림은 그 칸에 딱 맞고, 두 칸짜리(오락기)는 윗칸이
// 벽으로 솟는다.
//
// 전에는 게시판과 자판기를 「두 칸 높이」로 치고 한 칸 위에서 그렸는데
// 그림은 한 칸짜리였다. 그래서 그림은 막히지 않은 복도 칸(기물 칸 바로
// 위)에 떠 있고, 정작 막힌 칸은 빈 바닥으로 보였다 — 사람이 그림 위에
// 겹쳐 서고, 그림을 짚으면 빈 칸을 짚은 것이 되어 차림표가 안 떴다.
//
// 화면(Walk)이 여기 값으로 그리고, 빌드 때 check-map 이 「그림이 덮는 칸에
// 걸을 수 있는 칸이 없다」를 본다.
import { ARCADE_MACHINES } from '../../../shared/rules/arcade'
import { POT_CELLS } from '../../../shared/rules/crop'
import { BOARDS } from '../../../shared/rules/errand'
import type { FixtureKind } from '../../../shared/rules/fixtures'
import { VENDINGS } from '../../../shared/rules/shop'
import { LAB_MACHINES, MAKERS } from '../../../shared/rules/trap'
import { propTiles, type PropKind } from './props'
import { TILE } from './world'

/** 기물마다 쓰는 그림. 화분은 자라면서 바뀌는 따로 된 그림이라 한 칸 안에 들어간다 */
export const FIXTURE_ART: Record<Exclude<FixtureKind, 'pot'>, PropKind> = {
  board: 'noticeBoard',
  vending: 'vending',
  maker: 'trapMaker',
  lab: 'labMachine',
  arcade: 'arcade',
}

/** 그 기물 그림이 몇 칸 높이인가 */
export const fixtureTall = (kind: FixtureKind): number => (kind === 'pot' ? 1 : propTiles(FIXTURE_ART[kind]).h)

/** 그림의 윗끝(지도 px). **발이 기물 칸 바닥에 닿는다** */
export const fixtureTopPx = (cellY: number, imgHeight: number): number => (cellY + 1) * TILE - imgHeight

/** 기물 전부 — 종류와 칸 */
export const FIXTURES: readonly { kind: FixtureKind; cell: { x: number; y: number } }[] = [
  ...BOARDS.map((b) => ({ kind: 'board' as const, cell: b.cell })),
  ...VENDINGS.map((v) => ({ kind: 'vending' as const, cell: v.cell })),
  ...MAKERS.map((m) => ({ kind: 'maker' as const, cell: m.cell })),
  ...LAB_MACHINES.map((c) => ({ kind: 'lab' as const, cell: c })),
  ...ARCADE_MACHINES.map((m) => ({ kind: 'arcade' as const, cell: m.cell })),
  ...POT_CELLS.map((c) => ({ kind: 'pot' as const, cell: c })),
]

/** 그 기물 그림이 덮는 칸들. 맨 아래가 기물 칸이다 */
export function fixtureFootprint(kind: FixtureKind, cell: { x: number; y: number }): { x: number; y: number }[] {
  return Array.from({ length: fixtureTall(kind) }, (_, i) => ({ x: cell.x, y: cell.y - i }))
}

/** 그림이 덮는 칸 → 기물 칸. **그림을 짚으면 그 기물이다** — 두 칸짜리의 윗칸도 */
const DRAWN = new Map<string, { x: number; y: number }>()
for (const f of FIXTURES) for (const c of fixtureFootprint(f.kind, f.cell)) DRAWN.set(`${c.x},${c.y}`, f.cell)

/** 짚은 칸에 그려진 기물의 칸. 없으면 null */
export const fixtureDrawnAt = (x: number, y: number): { x: number; y: number } | null => DRAWN.get(`${x},${y}`) ?? null
