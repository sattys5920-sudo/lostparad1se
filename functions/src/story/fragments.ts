// A의 기록 나흘치. **서버 전용.**
//
// 날마다 자정에 한 장씩 열린다. 공개 시각 전에는 어떤 API로도 내려보내지
// 않는다. 조각은 역할 이름을 말하지 않는다 — 숨긴 사실과 겹치는 장면을
// 비출 뿐이다.
import type { PaperKind } from '../../../shared/reveal/paper'

/** 한 장의 종이. 조각 하나에 두 장일 수 있다(DAY 2). */
export interface Paper {
  kind: PaperKind
  /**
   * 본문. 한 줄씩 타자로 찍는다.
   * 원문 그대로다 — 한 글자도 고치지 않는다.
   */
  lines: readonly string[]
  /**
   * 괄호 안 지문. 본문이 아니라 작은 회색 캡션으로 띄운다.
   * 「(창고 안, 연필로 적은 메모)」 같은 것.
   */
  caption?: string
  /**
   * 같은 종이 맨 위에 따로 적힌 줄. 탭을 한 번 더 하면 카메라가 위로
   * 올라가며 나타난다. 손글씨 느낌의 픽셀 폰트로 찍는다.
   */
  topLines?: readonly string[]
  topCaption?: string
}

export interface FragmentData {
  day: number
  papers: readonly Paper[]
}

export const FRAGMENTS: readonly FragmentData[] = [
  {
    day: 1,
    papers: [
      {
        kind: 'diary',
        lines: ['종이는 늘 접혀서 오지만, 글씨는 숨길 수가 없어.'],
      },
    ],
  },
  {
    day: 2,
    papers: [
      {
        kind: 'note',
        lines: [
          '이상한 건, 아무도 나한테 나쁜 짓을 안 한다는 거야.',
          '때리지도 않고 욕하지도 않아. 그냥 안 볼 뿐이야.',
        ],
      },
    ],
  },
  {
    day: 3,
    papers: [
      {
        kind: 'diary',
        lines: ['다음을 기약하는 건 쉽지만, 다음이라는 건 도대체 언제 올까?'],
      },
    ],
  },
  {
    day: 4,
    papers: [
      {
        kind: 'note',
        lines: [
          '편지를 받고 하루 종일 웃었어. 다섯 시, 창고 앞.',
          '너희가 나쁘다고는 생각하지 않아.',
        ],
      },
    ],
  },
]

export const FRAGMENT_BY_DAY: Record<number, FragmentData | undefined> = Object.fromEntries(
  FRAGMENTS.map((f) => [f.day, f]),
)
