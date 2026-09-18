// 한국어 한 줄을 조립할 때 필요한 것.

/**
 * 받침이 있으면 앞엣것, 없으면 뒤엣것.
 *
 * 「내 자리을(를) 기다리고 있다」가 화면에 그대로 떴다. 괄호로 둘을
 * 나란히 쓰는 것은 **고를 줄 몰라서 미룬 것**이고, 읽는 사람은 그걸
 * 안다. 한글 음절이면 받침을 보고 고를 수 있다.
 */
type Pair = '을/를' | '이/가' | '은/는' | '와/과' | '이다/다' | '이라고/라고'

/**
 * [받침 있을 때, 없을 때].
 *
 * **와/과만 순서가 뒤집힌다.** 「을/를」은 받침 있는 쪽을 먼저 쓰는데
 * 「와/과」는 관습상 없는 쪽을 먼저 쓴다 — 쪼개서 앞엣것을 받침 쪽으로
 * 쓰면 「마루과」가 나온다. 실제로 그랬고, 시험이 잡았다.
 */
const PAIRS: Record<Pair, readonly [string, string]> = {
  '을/를': ['을', '를'],
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
  '와/과': ['과', '와'],
  // 「오늘 D팀 팀장은 새롬다.」가 화면에 그대로 떴다. 이름 끝을 보고
  // 골라야 하는 것은 조사만이 아니다
  '이다/다': ['이다', '다'],
  // 「「수아」이라고 적혀 있다」도 같은 자리다
  '이라고/라고': ['이라고', '라고'],
}

export function josa(word: string, pair: Pair): string {
  const [withJong, noJong] = PAIRS[pair]
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  // 한글 음절이 아니면 받침을 셀 수 없다. 받침 있는 쪽이 덜 어색하다
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return withJong
  return (code - 0xac00) % 28 === 0 ? noJong : withJong
}
