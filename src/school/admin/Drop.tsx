// 바닥에 한 장 놓는다 — 문제 종이 또는 메모.
//
// 평소에는 서버가 페이즈가 닫힐 때 알아서 뿌린다. 어디에 떨어질지는
// 씨앗이 정하고, 무엇이 떨어질지는 미리 등록해 둔 것 중에서 고른다.
//
// **여기는 운영자가 그 자리에서 정하는 길이다.** 자유 시간에 「저기
// 미술실에 이런 쪽지가 있으면 좋겠다」가 생기는데, 그때 기다릴 수
// 있는 것은 다음 페이즈가 닫힐 때까지다.
//
// 놓는 것까지가 전부다. 줍고 읽고 찢는 것도, 문제를 펴고 푸는 것도
// 원래 규칙 그대로다 — 운영자가 놓았다고 해서 다르게 굴지 않는다.
import { useState } from 'react'

import { FLOOR_NAME, TILES } from '../../../shared/rules/board'
import type { GameActions } from '../game/useGame'

/** 메모 한 장에 적을 수 있는 길이. 서버(drop.ts)와 같은 값이다. */
const MEMO_MAX = 300

/** 주관식뿐이다. kind 는 서버 문서 모양을 맞추려고 남아 있다 */
const EMPTY = {
  kind: 'short' as const,
  prompt: '',
  answers: '',
  explain: '',
}

export function DropHost({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  /** 문제인가 메모인가. 한 번에 하나만 놓는다 */
  const [what, setWhat] = useState<'memo' | 'quiz'>('memo')
  const [tileId, setTileId] = useState<string>(TILES[0]?.id ?? '')
  const [memo, setMemo] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  async function drop() {
    setBusy(true)
    try {
      const res = (await act.hostDrop(
        what === 'memo'
          ? { tileId, kind: 'memo', text: memo }
          : {
              tileId,
              kind: 'quiz',
              quiz: {
                kind: form.kind,
                prompt: form.prompt,
                choices: [],
                // 정답은 줄바꿈으로 여럿 적는다 — 동의어와 표기 차이를
                // 미리 적어 두는 편이 채점을 똑똑하게 만드는 것보다 정확하다
                answers: form.answers.split('\n').map((a) => a.trim()).filter((a) => a !== ''),
                explain: form.explain,
              },
            },
      )) as { where?: string }
      onSaid(`${res.where ?? tileId} 바닥에 놓았다.`)
      if (what === 'memo') setMemo('')
      else setForm(EMPTY)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready =
    tileId !== '' &&
    (what === 'memo'
      ? memo.trim().length > 0
      : form.prompt.trim().length > 0 && form.answers.trim().length > 0)

  return (
    <div className="sc-dr">
      <div className="sc-dr__what">
        <button className={what === 'memo' ? 'is-on' : ''} onClick={() => setWhat('memo')}>
          메모
        </button>
        <button className={what === 'quiz' ? 'is-on' : ''} onClick={() => setWhat('quiz')}>
          문제
        </button>
      </div>

      <label className="sc-dr__row">
        <span>어느 방</span>
        <select value={tileId} onChange={(e) => setTileId(e.target.value)}>
          {TILES.map((t) => (
            <option key={t.id} value={t.id}>
              {FLOOR_NAME[t.floor]} · {t.name}
            </option>
          ))}
        </select>
      </label>

      {what === 'memo' && (
        <>
          <label className="sc-dr__row sc-dr__row--tall">
            <span>적을 말</span>
            <textarea
              rows={4}
              maxLength={MEMO_MAX}
              value={memo}
              placeholder="주운 사람만 읽는다"
              onChange={(e) => setMemo(e.target.value.slice(0, MEMO_MAX))}
            />
          </label>
          <p className="sc-dr__hint">{MEMO_MAX - memo.length}자 남았다.</p>
        </>
      )}

      {what === 'quiz' && (
        <>
          <label className="sc-dr__row sc-dr__row--tall">
            <span>문제</span>
            <textarea
              rows={2}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>

          <label className="sc-dr__row sc-dr__row--tall">
            <span>정답</span>
            <textarea
              rows={2}
              value={form.answers}
              placeholder="한 줄에 하나 — 동의어와 표기 차이를 여럿 적는다"
              onChange={(e) => setForm({ ...form, answers: e.target.value })}
            />
          </label>

          <label className="sc-dr__row">
            <span>해설</span>
            <input value={form.explain} onChange={(e) => setForm({ ...form, explain: e.target.value })} />
          </label>

        </>
      )}

      <button className="sc-dr__go" disabled={busy || !ready} onClick={() => void drop()}>
        떨어뜨리기
      </button>
      <p className="sc-dr__hint">
        접힌 채로 놓인다. 그 방에 선 사람에게는 「한 장 있다」까지만 보이고, 펴거나
        주워야 무엇이 적혔는지 안다.
      </p>
    </div>
  )
}
