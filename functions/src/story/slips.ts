// 쪽지에 적힌 것. **서버 전용.**
//
// 학교 여기저기에 떨어지는 종이 한 장이다. 누군가의 비밀이 적혀 있고,
// 주운 사람은 찢거나, 두고 가거나, 사람에게 건넨다 — 비밀의 주인에게
// 건네면서 값을 부를 수도 있다.
//
// **이 파일이 번들에 실리면 안 된다.** 여기 열넷이 통째로 실려 나가면
// 개발자도구를 열 줄 아는 한 사람이 첫날 아침에 다 읽는다. check:bundle
// 이 functions/src/story/** 를 훑으므로, 문장을 채우면 자동으로 검사에 든다.
//
// {이름}은 서버가 그 쪽지 주인의 이름으로 바꾼다. 주인은 뿌려질 때
// 정해지므로 **문장은 누구에게나 들어맞게** 써야 한다.
//
//   예)  {이름}이(가) 그날 밤 옥상에 있었다는 걸 나는 안다.
//
// [작성 예정]은 비워 둔 자리다. 게임의 이야기라 사람이 쓴다.

export interface SlipText {
  id: string
  line: string
}

export const SLIP_TEXTS: readonly SlipText[] = [
  { id: 's01', line: '[작성 예정]' },
  { id: 's02', line: '[작성 예정]' },
  { id: 's03', line: '[작성 예정]' },
  { id: 's04', line: '[작성 예정]' },
  { id: 's05', line: '[작성 예정]' },
  { id: 's06', line: '[작성 예정]' },
  { id: 's07', line: '[작성 예정]' },
  { id: 's08', line: '[작성 예정]' },
  { id: 's09', line: '[작성 예정]' },
  { id: 's10', line: '[작성 예정]' },
  { id: 's11', line: '[작성 예정]' },
  { id: 's12', line: '[작성 예정]' },
  { id: 's13', line: '[작성 예정]' },
  { id: 's14', line: '[작성 예정]' },
]

export const SLIP_BY_ID: Readonly<Record<string, SlipText>> = Object.fromEntries(
  SLIP_TEXTS.map((s) => [s.id, s]),
)

/** 그 쪽지의 날것 그대로. 없는 것을 물으면 빈 자리로 답한다. */
export const rawLine = (textId: string): string => SLIP_BY_ID[textId]?.line ?? '[작성 예정]'
