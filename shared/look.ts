// 사람이 만든 캐릭터의 생김새.
//
// **서버도 이것을 알아야 한다.** 자리에 앉을 때 서버가 그 사람 계정에서
// 생김새를 꺼내 명단에 적어 주고, 그래야 남들 화면에 그 사람이 제 얼굴로
// 선다. 그래서 그림 그리는 쪽(src/school/char)이 아니라 여기에 둔다 —
// 양쪽이 같은 한 벌을 본다.
//
// 숫자는 전부 목록의 몇 번째인가다. 목록 길이는 화면 쪽이 쥐고 있고,
// 범위를 벗어난 값은 normalizeLook 이 접어 넣는다. **그래서 서버는
// 검사하지 않고 그대로 옮긴다** — 이상한 값이 와도 화면이 안 터진다.

/** 남자 머리·여자 머리 목록을 가르는 값. 몸 픽셀 맵은 남녀가 같다. */
export type StyleSet = 'F' | 'M'

export interface AvatarLook {
  /** 헤어·교복 목록의 기본 거름망. 자유 조합을 막지는 않는다 */
  styleSet: StyleSet
  /** 머리 모양 'F00'~'M14' */
  hairStyle: string
  /** 머리색 0..8 */
  hairColor: number
  /** 표정 0..5 */
  expression: number
  /** 복장 0..5 — 하복·춘추복·동복·가디건·후드집업·체육복 */
  outfit: number
  /** 착용 스타일 0 단정 · 1 보통 · 2 껄렁 */
  wearStyle: number
  /** 하의 — 0 바지, 1 치마 */
  bottom: number
  /** 목 장식 0 넥타이 · 1 리본 · 2 없음 */
  neckwear: number
}
