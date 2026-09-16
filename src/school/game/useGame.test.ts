import { describe, expect, it } from 'vitest'
import { nextGame } from './useGame'
import type { GameDoc } from '../../../shared/model'

const game = { phase: 'running', day: 1 } as unknown as GameDoc
const other = { phase: 'running', day: 2 } as unknown as GameDoc

describe('nextGame', () => {
  it('서버가 준 것은 그대로 받는다', () => {
    expect(nextGame(null, { exists: true, fromCache: false, data: game })).toBe(game)
    expect(nextGame(game, { exists: true, fromCache: false, data: other })).toBe(other)
  })

  /**
   * **이것이 「번쩍거리며 튕긴다」의 정체다.**
   *
   * 끊겼다 붙는 사이 캐시가 빈 답을 한 번 흘린다. 그것을 받으면
   * 판이 없어진 것이 되어 화면이 로비로 갔다가 다음 스냅샷에 돌아온다.
   * 그 한 번에 아침 시퀀스가 처음부터 다시 돈다.
   */
  it('들고 있는 판이 있으면 캐시의 빈 답을 무시한다', () => {
    expect(nextGame(game, { exists: false, fromCache: true, data: undefined })).toBe(game)
  })

  it('서버가 없다고 하면 없는 것이다', () => {
    expect(nextGame(game, { exists: false, fromCache: false, data: undefined })).toBeNull()
  })

  /**
   * 아직 아무것도 못 받았으면 캐시 말이라도 받는다. 판이 정말 없을
   * 수도 있는데 「불러오는 중」에 영영 묶어 두면 안 된다.
   */
  it('아직 들고 있는 것이 없으면 캐시의 빈 답도 받는다', () => {
    expect(nextGame(null, { exists: false, fromCache: true, data: undefined })).toBeNull()
  })

  it('캐시가 준 것이라도 내용이 있으면 받는다 — 끊긴 동안 보던 화면이 남는다', () => {
    expect(nextGame(null, { exists: true, fromCache: true, data: game })).toBe(game)
  })
})
