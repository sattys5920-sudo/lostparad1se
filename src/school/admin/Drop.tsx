// 바닥에 한 장 놓는다 — 문제 종이 또는 메모.
//
// **문제는 여기서만 나온다.** 서버가 페이즈마다 뿌리던 것을 걷어냈다 —
// 어디에 무엇을 놓을지가 운영자의 수다. 쪽지는 아직 서버도 뿌린다.
//
// 둘의 자리 고르는 법이 다르다.
//
//   메모   **방** 하나를 목록에서 고른다. 쪽지와 같은 규칙이다
//   문제   **칸** 하나를 작은 판에서 짚는다. 복도에도 놓인다
//
// 놓는 것까지가 전부다. 줍고 읽고 찢는 것도, 문제를 줍고 푸는 것도
// 원래 규칙 그대로다 — 운영자가 놓았다고 해서 다르게 굴지 않는다.
import { useEffect, useState } from 'react'

import { FLOOR_NAME, TILES } from '../../../shared/rules/board'
import { SpotPick, type Spot, type SpotMark } from './Spot'
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
  /** 문제를 놓을 칸. 작은 판에서 짚는다 */
  const [spot, setSpot] = useState<Spot | null>(null)
  /** 이미 판에 나가 있는 종이. 겹쳐 놓지 않게 점으로 찍는다 */
  const [marks, setMarks] = useState<SpotMark[]>([])
  const [memo, setMemo] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  /** 놓여 있는 것을 읽어 온다. 문제 쪽을 볼 때만 필요하다 */
  async function loadMarks() {
    try {
      const out = (await act.hostQuizList()) as { onFloor?: SpotMark[] }
      setMarks(out.onFloor ?? [])
    } catch {
      // 못 읽어도 놓는 데는 지장이 없다. 점이 안 찍힐 뿐이다
    }
  }
  useEffect(() => {
    if (what === 'quiz') void loadMarks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what])

  async function drop() {
    setBusy(true)
    try {
      const res = (await act.hostDrop(
        what === 'memo'
          ? { tileId, kind: 'memo', text: memo }
          : {
              x: spot?.x,
              y: spot?.y,
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
      if (what === 'memo') {
        setMemo('')
      } else {
        setForm(EMPTY)
        // 방금 놓은 것이 점으로 찍히게. 자리는 그대로 둔다 —
        // 한 방에 여러 장 깔 때 층을 다시 찾지 않아도 된다
        await loadMarks()
      }
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready =
    what === 'memo'
      ? tileId !== '' && memo.trim().length > 0
      : spot !== null && form.prompt.trim().length > 0 && form.answers.trim().length > 0

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

      {what === 'memo' && (
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
      )}

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
          {/* 자리를 먼저 짚는다. 복도도 여기서 고른다 */}
          <SpotPick value={spot} onPick={setSpot} marks={marks} />

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
        {what === 'quiz'
          ? '접힌 채로 놓인다. 옆에 선 사람에게는 「한 장 있다」까지만 보이고, 주워야 무엇이 적혔는지 안다. 먼저 맞히는 한 사람이 가져간다.'
          : '접힌 채로 놓인다. 그 방에 선 사람에게는 「한 장 있다」까지만 보이고, 주워야 무엇이 적혔는지 안다.'}
      </p>
    </div>
  )
}
