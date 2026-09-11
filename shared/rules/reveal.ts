// 털어놓기로 영향력이 얼마나 오르는가.
//
// 규칙이 한 줄이 아니라 누적 상태에 걸려 있어서 함수로 뺀다.
// 서버가 이걸로 정산하고, 화면의 확인창이 같은 함수로 "이번엔 얼마나
// 오르는지"를 미리 보여 준다. 둘이 다른 말을 하면 사람이 속는다.
import {
  REVEAL_INFLUENCE_CAP,
  REVEAL_INFLUENCE_FIRST_PRIVATE,
  type RevealScope,
} from './v2'

/**
 * 이번 털어놓기로 오르는 영향력.
 *
 * @param alreadyGained 이 사람이 지금까지 털어놓기로 받은 총량
 * @param scope 1:1인가 전체인가
 *
 *   첫 1:1        → +3
 *   그다음 1:1    → 0   (약점만 늘어난다)
 *   전체          → 남은 만큼을 6까지 채운다
 */
export function revealInfluenceGain(alreadyGained: number, scope: RevealScope): number {
  const gained = Math.max(0, Math.min(REVEAL_INFLUENCE_CAP, alreadyGained))
  if (scope === 'class') return REVEAL_INFLUENCE_CAP - gained
  // 1:1은 처음 한 번만 오른다
  if (gained > 0) return 0
  return Math.min(REVEAL_INFLUENCE_FIRST_PRIVATE, REVEAL_INFLUENCE_CAP)
}

/** 확인창에 띄우는 말. 누르기 전에 무엇을 잃는지 알아야 한다. */
export const REVEAL_PRIVATE_WARNING =
  '영향력은 처음 한 번만 오르고, 듣는 사람마다 약점을 쥔다.'
