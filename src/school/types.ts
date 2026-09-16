// ── 지도와 캐릭터가 함께 쓰는 타입 네 가지.
//
// 규칙 쪽(shared/)에도 TeamId·TileId 가 있다. **일부러 둘이다** —
// 규칙 쪽 TileId 는 string 이고 여기 것은 스물다섯 방짜리 유니온이다.
// 그림을 그리는 쪽은 없는 방을 그릴 수 없어야 한다.

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

export type TeamId = 'A' | 'B' | 'C' | 'D'

export type TileId =
  | 'baseA'
  | 'baseB'
  | 'baseC'
  | 'baseD'
  | 'classroom' // 상점
  | 'hallway' // 가사실
  | 'library' // 도서관
  | 'gym' // 체육관
  | 'scienceRoom' // 과학실
  | 'artRoom' // 미술실
  | 'musicRoom' // 음악실
  | 'cafeteria' // 급식실
  | 'rooftop' // 옥상
  | 'clubRoom' // 동아리실
  | 'garden' // 정원
  | 'storage' // 창고
  | 'oldBuilding' // 경비실
  | 'labRoom' // 연구실 — 학교에 하나뿐이다
  | 'playground' // 운동장 — 핵심 지역
  | 'auditorium' // 강당 — 핵심 지역
  | 'broadcastRoom' // 방송실 — 핵심 지역
  | 'studentCouncil' // 학생회실 — 핵심 지역
  | 'centralPlaza' // 2-3 교실 — 핵심 지역
  | 'newBuilding' // 무용실 — 교차로
  | 'annex' // 양호실 — 교차로
