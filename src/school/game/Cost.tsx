// 값 한 칸 — 그림과 수.
//
// **단위 말을 글로 적지 않는다.** 「팀 토큰 2개 · 20분 · 호루라기
// 하나」는 읽어야 알지만, 같은 것을 그림 셋과 숫자 셋으로 늘어놓으면
// 눈이 한 번에 집는다. 화면마다 제 식으로 적던 것을 여기 하나로 모은다.
//
// **말이 아주 없어지지는 않는다.** 그림만 있으면 눈이 안 보이는 사람과
// 처음 보는 사람이 막힌다 — 이름은 title 과 화면 낭독기용 글자로 남고,
// 눈에만 안 보인다.
import { goodIcon } from './goodArt'
import { ITEM_BY_KIND, type ItemKind } from '../../../shared/rules/items'
import { uiIcon } from './uiArt'

/** 그림에 붙는 이름. 눈에는 안 보이고 낭독기와 툴팁에만 나온다. */
const WORD: Record<string, string> = {
  token: '팀 토큰',
  money: '돈',
  knowledge: '지식',
  clock: '분',
}

export type CostOf = 'token' | 'money' | 'knowledge' | 'clock' | ItemKind

const wordOf = (of: CostOf): string => WORD[of] ?? ITEM_BY_KIND[of as ItemKind]?.name ?? of
const srcOf = (of: CostOf): string => (of in WORD ? uiIcon(of) : goodIcon(of))

export function Cost({ of, n, dim = false }: { of: CostOf; n: number | string; dim?: boolean }) {
  const word = wordOf(of)
  return (
    <span className={'sc-cost' + (dim ? ' is-dim' : '')} title={`${word} ${n}`}>
      <img src={srcOf(of)} alt="" width={12} height={12} />
      <b>{n}</b>
      <i>{word}</i>
    </span>
  )
}
