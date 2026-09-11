// A의 기록 다섯 장. **서버 전용.**
//
// 매일 08:00에 한 장씩 열린다. 공개 시각 전에는 어떤 API로도 내려보내지
// 않는다. 조각은 역할 이름을 말하지 않는다 — 숨긴 사실과 겹치는 장면을
// 비출 뿐이다.
//
// 본문 출처: personal_missions_v3.md 4장.
// DAY 3과 DAY 5는 scenario_reveal.md 6장이 덮는다(시간선 수정과 반전 단서).
import type { RoleId } from '../../../shared/missions/roles'
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
  /** 가치가 끝까지 +2 오르는 칸. 무작위가 아니라 고정이다. */
  spotTile: string
  /** 은근히 가리키는 역할. 정확히 짚어 의심하면 타격이 두 배다. */
  implicated: readonly RoleId[]
  papers: readonly Paper[]
}

export const FRAGMENTS: readonly FragmentData[] = [
  {
    day: 1,
    spotTile: 'library',
    implicated: ['librarian', 'buddy'],
    papers: [
      {
        kind: 'diary',
        lines: [
          '투표 용지는 늘 접혀서 오지만, 글씨는 숨길 수가 없어.',
          '처음 내 이름을 적은 건 도서관 창가 자리의 그 애. 겨우 자리 때문에.',
          '그리고 지난주 마지막 한 장. 그 글씨는 너무 잘 알아서, 모르는 척했어.',
        ],
      },
    ],
  },
  {
    day: 2,
    spotTile: 'scienceRoom',
    implicated: ['shadow', 'witness'],
    papers: [
      {
        kind: 'diary',
        lines: ['금요일마다 과학실 뒤에서 봉투를 건넸어. 이번 주엔 빈손이었어. 그래서 올린 거지?'],
      },
      {
        kind: 'note',
        caption: '(창고 안, 연필로 적은 메모)',
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
    spotTile: 'musicRoom',
    implicated: ['accuser', 'leaver'],
    papers: [
      {
        kind: 'diary',
        lines: [
          '창고 앞에서 기다리다가 보냈어. 읽음 표시가 떴어. 답장 대신, 몇 분 뒤 단톡방에 내 메시지가 올라왔어.',
          '음악실 앞에서, 같이 선생님께 가 주겠다고 했잖아. 추천서 얘기를 듣고 알았어. 난 거기까지였구나.',
        ],
      },
    ],
  },
  {
    day: 4,
    spotTile: 'storage',
    implicated: ['vanguard', 'liar'],
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
    //
    // 맨 위 줄을 마지막에 읽게 하는 이유: 그 줄은 창고에 갇히기 전,
    // 설레며 기다리던 순간에 쓰였다. 가장 먼저 쓴 줄을 가장 마지막에.
    day: 5,
    spotTile: 'hallway',
    implicated: ['bystander', 'letter'],
    papers: [
      {
        kind: 'note',
        lines: [
          '한참 뒤에 철컥, 소리가 났어. 문을 닫은 사람은 벌써 한참 전에 나갔는데.',
          '누가 지나갔어. 두드렸는데, 발소리가 잠깐 멈췄다가 다시 멀어졌어.',
        ],
        topCaption: '(같은 종이 맨 위, 다른 줄보다 또박또박한 글씨)',
        topLines: ['편지에 적힌 대로 다섯 시에 왔어. 조금만 더 기다려 볼게.'],
      },
    ],
  },
]

export const FRAGMENT_BY_DAY: Record<number, FragmentData | undefined> = Object.fromEntries(
  FRAGMENTS.map((f) => [f.day, f]),
)
