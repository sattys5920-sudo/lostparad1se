import { describe, expect, it } from 'vitest'

import { CHALK_LINE, PROLOGUE_NOTICE, PROLOGUE_SCREENS, prologueText } from './prologue'

// **본문은 한 글자도 바꾸지 않는다.** 운영자가 준 원문 그대로인지 여기서 붙든다
const ORIGINAL = `우리 반에는 투명인간이 있었다.

금요일마다 접힌 종이에 이름 하나를 적는다.
가장 많이 나온 사람은 일주일 동안 없는 사람이 된다.
말을 걸지 않고, 대답하지 않고, 쳐다보지 않는다.

누가 적었는지는 아무도 모른다. 이유를 적는 칸도 없었다.
그냥 장난이었다. 일주일이면 끝나니까.

가을에 A의 이름이 나왔다.
그다음 주에도 A였다. 그다음 주에도.

겨울이 됐고, A는 학교에 있으면서 없는 사람이었다.
우리는 그게 이상하다고 생각하지 않았다. 여전히 장난이었으니까.

방학식 전날, 첫눈이 왔다.
그날 A는 창고 앞에 있었다. 무엇을 기다렸는지는 아무도 몰랐다.

다음 날 아침, 창고 문은 잠겨 있었다.
그 안에서 A가 발견됐다.

이번엔 너희가 해 봐.`

describe('프롤로그', () => {
  it('원문 그대로다 — 세 화면과 칠판', () => {
    expect(prologueText().join('\n')).toBe(ORIGINAL)
  })

  it('세 화면이다', () => {
    expect(PROLOGUE_SCREENS).toHaveLength(3)
    expect(CHALK_LINE).toBe('이번엔 너희가 해 봐.')
  })

  it('안내 문구', () => {
    expect(PROLOGUE_NOTICE).toBe('이 게임은 학교 따돌림과 한 학생의 죽음을 다룹니다. 힘들어지면 운영자에게 알려 주세요.')
  })
})
