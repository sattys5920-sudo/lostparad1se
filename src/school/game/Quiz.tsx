// 문제 종이 — 펼쳐 보고 가방에서 푼다.
//
// 옆에 서서 펼치면 문제가 내 가방에 뜬다. **종이는 바닥에 그대로 있다**
// — 다른 사람도 와서 펼쳐 볼 수 있고, **먼저 맞히는 한 사람이 가져간다.**
// 맞히는 순간 바닥에서 사라지고, 펼쳐 본 나머지 가방에서도 사라진다.
//
// 전에는 먼저 줍는 사람이 임자였다. 주운 사람이 틀리면 종이가 그 손에
// 묶여 아무도 못 풀었다.
//
// **화면은 정답을 모른다.** 채점은 서버가 하고, 여기로는 맞았는지
// 틀렸는지만 온다. 문장조차 펼친 사람에게만 온다(views 의 myQuizzes).
import { useState } from 'react'

import { Cost } from './Cost'
import { goodIcon } from './goodArt'
import { KNOWLEDGE_PER_QUIZ } from '../../../shared/rules/quiz'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'
import { buzz } from './Controls'

export interface QuizProps {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
}

/** 가방에 든 문제. 가방 안에 얹는다 — 탭이 아니라 주머니 속이다. */
export function Quiz({ view, act, onSaid }: QuizProps) {
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState<Record<string, string>>({})
  /**
   * 방금 틀린 문제. **종이가 한 화소 흔들린다.**
   *
   * 답을 내면 화면은 그대로고 아래쪽에 글줄 하나가 뜰 뿐이었다 —
   * 맞았는지 틀렸는지를 글을 읽어야 알았다. 흔들림은 읽기 전에 온다.
   */
  const [shook, setShook] = useState<string | null>(null)
  const papers = view?.myQuizzes ?? []
  if (papers.length === 0) return null

  async function run(fn: () => Promise<unknown>, id: string) {
    setBusy(true)
    try {
      const out = (await fn()) as { correct?: boolean; explain?: string | null }
      if (out?.correct === true) {
        buzz('ok')
        onSaid(`맞혔다. 지식 ${KNOWLEDGE_PER_QUIZ} 점.${out.explain ? ` ${out.explain}` : ''}`)
      } else {
        onSaid('틀렸다. 다시 풀 수 있다.')
        setShook(id)
        window.setTimeout(() => setShook((k) => (k === id ? null : k)), 260)
      }
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-qz">
      <h2>
        들고 있는 문제 <span>{papers.filter((q) => !q.solvedByOther).length} 장</span>
      </h2>
      <ul className="sc-qz__list">
        {papers.map((q) => (
          <li key={q.id} className={'is-open' + (shook === q.id ? ' is-wrong' : '')}>
            {/*
              **펼친 종이 그림.** 바닥의 것은 접혀 있다 — 주운 뒤로는
              펴서 읽고 있는 것이라, 가방에서는 다르게 생겨야 한다.
              alt 가 비어 있는 것은 옆 글이 곧 문제 문장이어서다
            */}
            <div className="sc-qz__head">
              <img className="sc-qz__pic" src={goodIcon('quizOpen')} alt="" width={24} height={24} />
              <p className="sc-qz__prompt">{q.prompt}</p>
            </div>
            {q.solvedByOther && <p className="sc-qz__warn">누군가가 해결한 문제다.</p>}
            {!q.solvedByOther && (
              <div className="sc-qz__short">
                <input
                  id={`quiz-${q.id}`}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={typed[q.id] ?? ''}
                  placeholder="답을 적는다"
                  onChange={(e) => setTyped((t) => ({ ...t, [q.id]: e.target.value }))}
                />
                <button
                  disabled={busy || (typed[q.id] ?? '').trim() === ''}
                  onClick={() => void run(() => act.answerQuiz(q.id, typed[q.id] ?? ''), q.id)}
                >
                  낸다
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="sc-qz__note">
        맞히면 <Cost of="knowledge" n={KNOWLEDGE_PER_QUIZ} /> · 먼저 맞히는 한 사람이 가져간다
      </p>
    </div>
  )
}
