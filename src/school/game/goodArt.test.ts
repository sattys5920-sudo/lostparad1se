// 거래 아이콘 — **불러오기만 해도 자기 검사가 돈다.**
//
// goodArt.ts 는 모듈을 읽는 순간 그림이 12×12 인지, 물건마다 그림이
// 있는지를 보고 없으면 터진다. 그런데 어느 시험도 이 파일을 안 불러서,
// 물건을 넷 늘렸을 때 **시험 938개가 모두 통과한 채로 화면이 백지가
// 됐다.** 브라우저를 열어 보고서야 알았다.
//
// 여기서 한 번 불러 둔다. 이제 물건만 늘리고 그림을 안 그리면 시험이
// 먼저 터진다 — 화면을 열기 전에.
import { describe, expect, it } from 'vitest'

import { GOOD_ART, ICON_PX } from './goodArt'
import { ITEM_KINDS } from '../../../shared/rules/items'

describe('거래 아이콘', () => {
  it('물건마다 그림이 있다', () => {
    for (const kind of ITEM_KINDS) expect(GOOD_ART[kind], kind).toBeDefined()
  })

  it('거래 탁자에 오르는 자원에도 그림이 있다', () => {
    for (const key of ['money', 'knowledge', 'tokens', 'slips', 'robots']) {
      expect(GOOD_ART[key], key).toBeDefined()
    }
  })

  it('모두 12×12 다', () => {
    for (const [key, rows] of Object.entries(GOOD_ART)) {
      expect(rows.length, key).toBe(ICON_PX)
      for (const r of rows) expect(r.length, key).toBe(ICON_PX)
    }
  })
})
