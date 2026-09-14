// 투명인간 투표 화면에 뜨는 말.
//
// **문구는 전부 여기 있다.** 화면에 박아 두면 고칠 때마다 컴포넌트를
// 뒤져야 하고, 한 군데를 놓치면 날마다 다른 말이 뜬다.
//
// 회색 글씨는 날마다 한 줄씩 늘어난다. 늘어나는 것 자체가 이 게임이
// 하려는 말이라, 하루치씩 따로 적어 둔다.

/** 화면 제목. */
export const VOTE_TITLE = '오늘의 투명인간'

/** 이름 하나를 적으라는 말. */
export const VOTE_GUIDE = '한 명을 적어 주세요. 왜인지는 적지 않아도 됩니다.'

/**
 * 날마다 한 줄씩 늘어나는 회색 글씨.
 *
 * 1일차에는 첫 줄만, 5일차에는 다섯 줄이 다 보인다. 마지막 줄은
 * 칠판에 적혀 있던 말과 같다 — 그때 알아보는 사람이 있으면 된다.
 */
export const VOTE_MURMURS: readonly string[] = [
  '금요일마다 하던 거예요.',
  '그때도 아무도 이유를 적지 않았어요.',
  '일주일이면 끝나요. 다음 주엔 다른 애가 되겠죠.',
  '그 애는 몇 주째였더라.',
  '이번엔 너희가 해 봐.',
]

/** 그날까지 쌓인 줄. 날짜가 넘쳐도 있는 만큼만 돌려준다. */
export function murmursUpTo(day: number): readonly string[] {
  return VOTE_MURMURS.slice(0, Math.max(0, Math.min(day, VOTE_MURMURS.length)))
}

/** 마지막 페이즈가 닫힌 뒤 전원에게. */
export const announceInvisible = (name: string): string => `오늘의 투명인간은 ${name}입니다.`

/** 아무도 안 뽑힌 날에도 그대로 알린다. */
export const ANNOUNCE_NOBODY = '오늘은 아무도 지워지지 않았습니다.'

/** 본인에게만. */
export const INVISIBLE_NOTICE =
  '내일 하루 당신은 보이지 않습니다. 누구와도 거래하거나 표를 주고받을 수 없습니다. ' +
  '쪽지는 바닥에 두는 것만 가능합니다.'

/** 처음 들어올 때 한 번. 확인해야 넘어간다. */
export const CONTENT_NOTE =
  '이 게임은 학교 따돌림과 한 학생의 죽음을 다룹니다. 힘들어지면 언제든 운영자에게 알려 주세요.'
