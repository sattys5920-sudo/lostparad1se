// A의 기록 다섯 장. **서버 전용.**
//
// 날마다 자정에 한 장씩 열린다. 공개 시각 전에는 어떤 API로도 내려보내지
// 않는다. 조각은 역할 이름을 말하지 않는다 — 숨긴 사실과 겹치는 장면을
// 비출 뿐이다.
//
// 본문 출처: personal_missions_v3.md 4장.
// DAY 3과 DAY 5는 scenario_reveal.md 6장이 덮는다(시간선 수정과 반전 단서).
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
        lines: ['투표 용지는 늘 접혀서 오지만, 글씨는 숨길 수가 없어.'],
      },
    ],
  },
  {
    day: 2,
    papers: [
      {
        kind: 'note',
        lines: [
          '끌려오면서 복도 끝을 봤어. 누가 서 있었어. 눈이 마주쳤는데, 먼저 고개를 돌린 건 그쪽이었어.',
        ],
      },
    ],
  },
  {
    // scenario_reveal.md 6장이 v3 본문을 덮는다.
    // v3에서는 「음악실 피아노 뒤에서 보냈어」였는데, 그러면 고발자의 숨긴
    // 사실(창고 앞에서 기다리던 중)과 어긋난다.
    day: 3,
    papers: [
      {
        kind: 'diary',
        lines: [
          '창고 앞에서 기다리다가 용기를 내서 보냈어. 읽음 표시가 떴어. 답장 대신, 몇 분 뒤 단톡방에 내 메시지가 올라왔어.',
        ],
      },
    ],
  },
  {
    day: 4,
    papers: [
      {
        kind: 'note',
        lines: [
          '내 휴대폰이 네 주머니로 들어가는 걸 봤어. 겁만 주려는 거라고 했지.',
          '먼저 나간 사람이 문을 닫았어. 내가 부르는 소리 위로 웃음소리가 멀어졌어.',
        ],
      },
    ],
  },
  {
    // scenario_reveal.md 6장. 「철컥」 줄이 잠근 사람이 따로 있다는 것만
    // 알려 준다. 지킴이는 여전히 가리켜지는 역할이 아니다.
    day: 5,
    papers: [
      {
        kind: 'note',
        lines: [
          '한참 뒤에 철컥, 소리가 났어. 문을 닫은 사람은 벌써 한참 전에 나갔는데.',
          '누가 지나갔어. 두드렸는데, 발소리가 잠깐 멈췄다가 다시 멀어졌어. 다섯 시에는 열어 준다고 했는데, 다섯 시야. 조금만 더 기다려 볼게.',
        ],
      },
    ],
  },
]

export const FRAGMENT_BY_DAY: Record<number, FragmentData | undefined> = Object.fromEntries(
  FRAGMENTS.map((f) => [f.day, f]),
)
