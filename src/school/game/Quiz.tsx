// 문제 종이 — 그 자리에서 펴서 같이 푼다.
//
// 쪽지와 반대다. 쪽지는 주워서 혼자 읽고 감추지만, 문제는 펼치는
// 순간 **그 방에 선 사람 전원**이 같이 본다. 들고 갈 수도, 건넬 수도
// 없다. 다른 팀 사람 앞에서 여는 것이 이 물건의 전부다 — 열지 않으면
// 아무도 못 풀고, 열면 상대도 같이 본다.
//
// **화면은 정답을 모른다.** 채점은 서버가 하고, 여기로는 맞았는지
// 틀렸는지만 온다.
import { useEffect, useState } from 'react'

import { KNOWLEDGE_PER_QUIZ, QUIZ_MIN_BANK, atPaper } from '../../../shared/rules/quiz'
import type { Cell } from '../../../shared/rules/board'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'

export interface QuizProps {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
  /** 내가 선 칸. 종이 옆이어야 펼치고 답을 낸다 — 서버도 같은 자로 잰다 */
  myCell: Cell | null
}

export function Quiz({ view, act, onSaid, myCell }: QuizProps) {
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState<Record<string, string>>({})
  /**
   * 방금 틀린 문제. **종이가 한 화소 흔들린다.**
   *
   * 답을 내면 화면은 그대로고 아래쪽에 글줄 하나가 뜰 뿐이었다 —
   * 맞았는지 틀렸는지를 글을 읽어야 알았다. 흔들림은 읽기 전에 온다.
   */
  const [shook, setShook] = useState<string | null>(null)
  const papers = view?.quizzesHere ?? []
  if (papers.length === 0) return <p className="sc-qz__shut">이 방에 문제 종이가 없다.</p>

  async function run(label: string, fn: () => Promise<unknown>, id: string | null = null) {
    setBusy(true)
    try {
      const out = (await fn()) as { correct?: boolean; explain?: string | null }
      if (out?.correct === true) {
        onSaid(`맞혔다. 지식 ${KNOWLEDGE_PER_QUIZ}점.${out.explain ? ` ${out.explain}` : ''}`)
      } else if (out?.correct === false) {
        onSaid('틀렸다. 이 문제는 다시 못 푼다.')
        setShook(id)
        window.setTimeout(() => setShook((k) => (k === id ? null : k)), 260)
      } else {
        onSaid(`${label} 했다.`)
      }
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-qz">
      <h2>
        문제 종이 <span>{papers.length}장</span>
      </h2>
      <ul className="sc-qz__list">
        {papers.map((q) => {
          // 자리가 없는 옛 종이는 방 어디서나 닿는다
          const near = q.cell === null || atPaper(myCell, q.cell)
          return (
          <li
            key={q.id}
            className={(q.opened ? 'is-open' : '') + (shook === q.id ? ' is-wrong' : '')}
          >
            {!q.opened && (
              <>
                <p className="sc-qz__shut">접힌 문제가 한 장 있다.</p>
                <button disabled={busy || !near} onClick={() => void run('펼치기', () => act.openQuiz(q.id))}>
                  펼치기
                </button>
                <p className="sc-qz__warn">
                  {near ? '펼치면 이 방에 있는 사람 모두가 같이 본다.' : '종이 옆에 서야 펼칠 수 있다.'}
                </p>
              </>
            )}

            {q.opened && (
              <>
                <p className="sc-qz__prompt">{q.prompt}</p>
                {q.iFailed && <p className="sc-qz__warn">한 번 틀렸다. 이 문제는 다시 못 푼다.</p>}
                {!q.iFailed && !near && <p className="sc-qz__warn">종이 옆에 서야 답을 낼 수 있다.</p>}

                {!q.iFailed && q.kind === 'choice' && (
                  <div className="sc-qz__choices">
                    {q.choices.map((c) => (
                      <button key={c} disabled={busy || !near} onClick={() => void run('답', () => act.answerQuiz(q.id, c), q.id)}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {!q.iFailed && q.kind === 'short' && (
                  <div className="sc-qz__short">
                    <input
                      id={`quiz-${q.id}`}
                      value={typed[q.id] ?? ''}
                      placeholder="답을 적는다"
                      disabled={!near}
                      onChange={(e) => setTyped((t) => ({ ...t, [q.id]: e.target.value }))}
                    />
                    <button
                      disabled={busy || !near || (typed[q.id] ?? '').trim() === ''}
                      onClick={() => void run('답', () => act.answerQuiz(q.id, typed[q.id] ?? ''), q.id)}
                    >
                      낸다
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
          )
        })}
      </ul>
      <p className="sc-qz__note">
        맞히면 <b>내</b> 지식 {KNOWLEDGE_PER_QUIZ}점. 한 장은 한 팀만 가져간다 — 먼저 내는 쪽이 이긴다.
      </p>
    </div>
  )
}

// ── 운영자 ──────────────────────────────────────────────────────

interface BankItem {
  id: string
  kind: 'choice' | 'short'
  prompt: string
  choices: string[]
  answers: string[]
  explain: string
  /** 이미 판에 나간 문제. 지울 수 없다. */
  used: boolean
}

/** 주관식뿐이다. kind 는 서버 문서 모양을 맞추려고 남아 있다 */
const EMPTY_FORM = { kind: 'short' as const, prompt: '', answers: '', explain: '' }

/**
 * 문제를 등록·수정·삭제한다. **운영자만.**
 *
 * 정답과 해설은 이 화면에서만 보인다 — 서버가 운영자 토큰을 확인하고
 * 내려보낸다. 플레이어의 어떤 응답에도 섞이지 않는다.
 */
export function QuizHost({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  const [bank, setBank] = useState<{ count: number; left: number; thin: boolean; items: BankItem[] } | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 심부름·화분 책상과 같다 — 운영자가 여기 왔으면 은행부터 본다
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setBusy(true)
    try {
      setBank((await act.hostQuizList()) as typeof bank)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      await act.hostQuizUpsert(
        {
          kind: form.kind,
          prompt: form.prompt,
          choices: [],
          // 정답은 줄바꿈으로 여럿 적는다 — 동의어와 표기 차이를
          // 미리 적어 두는 편이 채점을 똑똑하게 만드는 것보다 정확하다
          answers: form.answers.split('\n').map((a) => a.trim()).filter((a) => a !== ''),
          explain: form.explain,
        },
        editing ?? undefined,
      )
      setForm(EMPTY_FORM)
      setEditing(null)
      onSaid(editing ? '고쳤다.' : '등록했다.')
      await load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-qzh">
      <h2>문제 은행</h2>
      {/* 열자마자 읽는다. 실패했을 때만 다시 읽는 단추가 남는다 */}
      {!bank && !busy && (
        <button onClick={() => void load()}>
          다시 불러오기
        </button>
      )}
      {!bank && busy && <p className="sc-qzh__count">불러오는 중</p>}

      {bank && (
        <>
          <p className={bank.thin ? 'sc-qzh__thin' : 'sc-qzh__count'}>
            등록된 문제 <b>{bank.count}개</b> · 권장 최소 {QUIZ_MIN_BANK}개
            {bank.thin && ' — 모자란다'}
          </p>
          {bank.left === 0 && bank.count > 0 && (
            <p className="sc-qzh__thin">남은 문제가 없다. 이제 문제 종이가 안 떨어진다.</p>
          )}
          {bank.left > 0 && <p className="sc-qzh__count">아직 안 나온 문제 {bank.left}개</p>}
        </>
      )}

      <div className="sc-qzh__form">
        <label htmlFor="quiz-prompt">문제 — 답을 적어 내는 주관식</label>
        <textarea
          id="quiz-prompt"
          rows={2}
          value={form.prompt}
          onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
        />

        <label htmlFor="quiz-answers">정답 (한 줄에 하나 — 동의어와 표기 차이를 여럿 적는다)</label>
        <textarea
          id="quiz-answers"
          rows={2}
          value={form.answers}
          onChange={(e) => setForm((f) => ({ ...f, answers: e.target.value }))}
        />

        <label htmlFor="quiz-explain">해설 (없어도 된다)</label>
        <input
          id="quiz-explain"
          value={form.explain}
          onChange={(e) => setForm((f) => ({ ...f, explain: e.target.value }))}
        />

        <div className="sc-qzh__row">
          <button disabled={busy || form.prompt.trim() === ''} onClick={() => void save()}>
            {editing ? '고치기' : '등록'}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null)
                setForm(EMPTY_FORM)
              }}
            >
              그만두기
            </button>
          )}
        </div>
      </div>

      {bank && (
        <ul className="sc-qzh__list">
          {bank.items.map((q) => (
            <li key={q.id}>
              <span className="sc-qzh__prompt">{q.prompt}</span>
              <span className="sc-qzh__ans">{q.answers.join(' / ')}</span>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(q.id)
                  setForm({
                    kind: 'short',
                    prompt: q.prompt,
                    answers: q.answers.join('\n'),
                    explain: q.explain,
                  })
                }}
              >
                고치기
              </button>
              <button
                disabled={busy || q.used}
                title={q.used ? '이미 판에 나간 문제다' : ''}
                onClick={() =>
                  void act
                    .hostQuizRemove(q.id)
                    .then(() => load())
                    .catch((e: Error) => onSaid(e.message))
                }
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
