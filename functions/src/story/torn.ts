// 찢긴 한 장. **서버 전용.**
//
// 도서부가 숨긴 한 장. A의 기록 중 가장 처음 쓰인 페이지다. 게임에서
// 공개되는 마지막 A의 글이, 모든 일의 시작이다.
//
// 엔딩 8번 장면에서만 열린다. 그 전에는 어디에도 내려보내지 않는다.
// 출처: scenario_reveal.md 5장.

/** 소개 문구는 도서부가 털어놓았는지로 갈린다. */
export const TORN_INTRO = {
  revealed: '도서부가 끝내 내놓은 한 장.',
  hidden: '도서부의 사물함 안쪽에서 나온 한 장.',
} as const

export const TORN_LINES: readonly string[] = [
  '오늘 처음으로 투명인간에 내 이름이 나왔다. 한 표.',
  '도서관 창가 자리 그 애 글씨다.',
  '괜찮아. 일주일이면 끝나. 다음 주엔 다른 애가 되겠지.',
  '그 애한테 미안하다. 누군지는 몰라도.',
]

export function tornIntro(librarianRevealed: boolean): string {
  return librarianRevealed ? TORN_INTRO.revealed : TORN_INTRO.hidden
}
