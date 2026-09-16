import { describe, expect, it } from 'vitest'
import { josa } from './text'

describe('josa', () => {
  it('받침이 있으면 앞엣것, 없으면 뒤엣것', () => {
    // 화면에 실제로 「내 자리을(를)」이 떴던 그 말이다
    expect(`내 자리${josa('내 자리', '을/를')}`).toBe('내 자리를')
    expect(`판${josa('판', '을/를')}`).toBe('판을')
    expect(`내 계정${josa('내 계정', '을/를')}`).toBe('내 계정을')
  })

  it('네 쌍 모두 같은 규칙으로 고른다', () => {
    expect(josa('가온', '이/가')).toBe('이')
    expect(josa('차오', '이/가')).toBe('가')
    expect(josa('하람', '은/는')).toBe('은')
    expect(josa('나래', '은/는')).toBe('는')
    expect(josa('마루', '와/과')).toBe('와')
    expect(josa('바람', '와/과')).toBe('과')
  })

  it('앞뒤 공백은 세지 않는다', () => {
    expect(josa('자리 ', '을/를')).toBe('를')
  })

  /**
   * 사람 이름은 나중에 서버에서 온다. 영어나 숫자나 빈 문자열이 와도
   * 화면이 터지면 안 된다 — 받침을 셀 수 없으면 덜 어색한 쪽으로 둔다.
   */
  it('한글이 아니면 받침 있는 쪽으로 둔다', () => {
    expect(josa('qa01', '을/를')).toBe('을')
    expect(josa('', '을/를')).toBe('을')
    expect(josa('ㅎ', '을/를')).toBe('을')
  })
})
