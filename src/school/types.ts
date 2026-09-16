// ── 지도가 쓰는 타입 둘.
//
// 규칙 쪽(shared/)에도 TeamId·TileId 가 있다. **일부러 둘이다** —
// 규칙 쪽 TileId 는 string 이고 여기 것은 스물다섯 방짜리 유니온이다.
// 그림을 그리는 쪽은 없는 방을 그릴 수 없어야 한다.
//
// 생김새(AvatarLook)는 shared/look.ts 에 있다. 서버도 그것을 읽는다.

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
