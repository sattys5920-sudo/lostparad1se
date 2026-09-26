// 문제 종이 — 주워서 손패에서 푼다.
//
// 쪽지와 같은 방식이다. 옆에 서서 줍고, 주운 사람만 본다. 다만 쪽지는
// 남의 비밀이고 이건 문제다 — **먼저 맞히는 한 사람이 가져간다.**
// 같은 문제를 들고 있던 나머지는 그 순간 못 적게 되고, 손에서 사라진다.
//
// 전에는 줍는 것이 아니라 그 자리에서 펴는 물건이었고, 펴면 그 방에
// 선 사람 전원이 같이 봤다. 「다른 팀 앞에서 펴는 위험」이 그 설계의
// 전부였는데, 주워서 혼자 푸는 쪽으로 바꾸면서 그 긴장은 없어지고
// **먼저 줍는 사람이 임자**가 됐다.
//
// **화면은 정답을 모른다.** 채점은 서버가 하고, 여기로는 맞았는지
// 틀렸는지만 온다. 문장조차 주운 사람에게만 온다(views 의 myQuizzes).
import { useEffect, useState } from 'react'

import { Cost } from './Cost'
import { goodIcon } from './goodArt'
import { KNOWLEDGE_PER_QUIZ, QUIZ_MIN_BANK } from '../../../shared/rules/quiz'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'

export interface QuizProps {
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
}

/** 손패에 든 문제. 손패 안에 얹는다 — 탭이 아니라 주머니 속이다. */
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
        onSaid(`맞혔다. 지식 ${KNOWLEDGE_PER_QUIZ}점.${out.explain ? ` ${out.explain}` : ''}`)
      } else {
        onSaid('틀렸다. 이 문제는 다시 못 푼다.')
        setShook(id)
        window.setTimeout(() => setShook((k) => (k === id ? null : k)), 260)
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
        들고 있는 문제 <span>{papers.length}장</span>
      </h2>
      <ul className="sc-qz__list">
        {papers.map((q) => (
          <li key={q.id} className={'is-open' + (shook === q.id ? ' is-wrong' : '')}>
            {/*
              **펼친 종이 그림.** 바닥의 것은 접혀 있다 — 주운 뒤로는
              펴서 읽고 있는 것이라, 손패에서는 다르게 생겨야 한다.
              alt 가 비어 있는 것은 옆 글이 곧 문제 문장이어서다
            */}
            <div className="sc-qz__head">
              <img className="sc-qz__pic" src={goodIcon('quizOpen')} alt="" width={24} height={24} />
              <p className="sc-qz__prompt">{q.prompt}</p>
            </div>
            {q.iFailed && <p className="sc-qz__warn">한 번 틀렸다. 이 문제는 다시 못 푼다.</p>}

            {!q.iFailed && (
              <div className="sc-qz__short">
                <input
                  id={`quiz-${q.id}`}
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
          {bank.left > 0 && <p className="sc-qzh__count">아직 안 놓은 문제 {bank.left}개</p>}
          {bank.left === 0 && bank.count > 0 && <p className="sc-qzh__thin">등록한 문제를 다 놓았다.</p>}
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
