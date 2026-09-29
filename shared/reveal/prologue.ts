// 프롤로그 — 가입하고 나를 만든 직후 한 번 도는 글.
//
// **본문은 한 글자도 바꾸지 않는다.** 운영자가 적어 준 그대로다. 문단은
// 빈 줄로 나뉜 덩어리이고, 문단 안의 줄바꿈도 그대로 살린다.
//
// 화면과 보관함이 같은 이 파일을 본다 — 보관함에는 연출 없이 글만 남는다.

/** 프롤로그 앞에 한 번만 뜨는 안내. 다시 보기에는 안 나온다 */
export const PROLOGUE_NOTICE = '이 게임은 학교 따돌림과 한 학생의 죽음을 다룹니다. 힘들어지면 운영자에게 알려 주세요.'

/** 세 화면. 화면 하나는 문단 몇 개, 문단 하나는 줄 몇 개다 */
export const PROLOGUE_SCREENS: readonly (readonly (readonly string[])[])[] = [
  [
    ['우리 반에는 투명인간이 있었다.'],
    [
      '금요일마다 접힌 종이에 이름 하나를 적는다.',
      '가장 많이 나온 사람은 일주일 동안 없는 사람이 된다.',
      '말을 걸지 않고, 대답하지 않고, 쳐다보지 않는다.',
    ],
    ['누가 적었는지는 아무도 모른다. 이유를 적는 칸도 없었다.', '그냥 장난이었다. 일주일이면 끝나니까.'],
  ],
  [
    ['가을에 A의 이름이 나왔다.', '그다음 주에도 A였다. 그다음 주에도.'],
    ['겨울이 됐고, A는 학교에 있으면서 없는 사람이었다.', '우리는 그게 이상하다고 생각하지 않았다. 여전히 장난이었으니까.'],
  ],
  [
    ['방학식 전날, 첫눈이 왔다.', '그날 A는 창고 앞에 있었다. 무엇을 기다렸는지는 아무도 몰랐다.'],
    ['다음 날 아침, 창고 문은 잠겨 있었다.', '그 안에서 A가 발견됐다.'],
  ],
]

/** 칠판에 적히는 한 줄. 건너뛸 수 없다 */
export const CHALK_LINE = '이번엔 너희가 해 봐.'

// ── 시간 ────────────────────────────────────────────────────────

/** 본문 타자. 초당 20자 */
export const PROLOGUE_MS_PER_CHAR = 50
/** 한 문단이 다 뜬 뒤 다음 문단까지 */
export const PARAGRAPH_GAP_MS = 600
/** 화면 전환 — 나가는 데 0.3초, 들어오는 데 0.3초 */
export const SCREEN_FADE_MS = 300
/** 화면 3 마지막 줄 뒤 아무것도 안 하는 시간. 「▼」도 없다 */
export const HUSH_MS = 2000
/** 검게 어두워지는 데 */
export const DARKEN_MS = 3000
/** 다 어두워진 뒤 정적 */
export const SILENCE_MS = 1000
/** 칠판이 올라오는 세 프레임 — 한 프레임 길이 */
export const BOARD_FRAME_MS = 160
/** 분필 글씨. 초당 4자. 탭해도 안 빨라진다 */
export const CHALK_MS_PER_CHAR = 250
/** 다 적힌 뒤 「들어간다」가 나오기까지 */
export const CHALK_HOLD_MS = 3000

/** 보관함에 남기는 글. 연출 없이 문단 그대로 — 화면 사이에는 빈 줄 */
export function prologueText(): string[] {
  const out: string[] = []
  PROLOGUE_SCREENS.forEach((screen, i) => {
    if (i > 0) out.push('')
    screen.forEach((para, j) => {
      if (j > 0) out.push('')
      out.push(...para)
    })
  })
  out.push('', CHALK_LINE)
  return out
}
