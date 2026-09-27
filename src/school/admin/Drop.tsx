// 바닥에 한 장 놓는다 — 메모, 문제 종이, 비밀 쪽지.
//
// **셋 다 여기서만 나온다.** 서버가 페이즈마다 뿌리던 문제와 쪽지를
// 걷어냈다 — 어디에 무엇을 놓을지가 운영자의 수다.
//
// 자리 고르는 법이 다르다.
//
//   메모   **방** 하나를 목록에서 고른다. 그 방 어디서나 줍는다
//   문제   **칸** 하나를 작은 판에서 짚는다. 복도에도 놓인다
//   쪽지   **칸** 하나. 문제와 같다. 누구의 비밀인지 고르고, 글은 여기서 적는다.
//          한 사람 앞으로 넉 장까지다
//
// 놓는 것까지가 전부다. 줍고 읽고 찢는 것도, 문제를 줍고 푸는 것도
// 원래 규칙 그대로다 — 운영자가 놓았다고 해서 다르게 굴지 않는다.
import { useEffect, useState } from 'react'

import { FLOOR_NAME, TILES, TILE_BY_ID, roomOfCell } from '../../../shared/rules/board'
import { SLIP_SUBJECT_MARK, SLIP_TEXT_MAX } from '../../../shared/reveal/slips'
import { SpotPick, type Spot, type SpotMark } from './Spot'
import type { GameActions } from '../game/useGame'

/** 메모·쪽지 한 장에 적을 수 있는 길이. 서버(drop.ts)와 같은 값이다. */
const MEMO_MAX = SLIP_TEXT_MAX

type What = 'memo' | 'quiz' | 'slip'

/** 쪽지 판 — 사람마다 나간 장수와 바닥에 남은 것. hostSlipList 가 준다 */
interface SlipBoard {
  perPerson: number
  people: { id: string; name: string; placed: number }[]
  onFloor: (SpotMark & { id: string; subjectId: string; text: string })[]
}

const whereOf = (x: number, y: number): string => {
  const room = roomOfCell(x, y)
  return room ? TILE_BY_ID[room].name : '복도'
}

/** 주관식뿐이다. kind 는 서버 문서 모양을 맞추려고 남아 있다 */
const EMPTY = {
  kind: 'short' as const,
  prompt: '',
  answers: '',
  explain: '',
}

export function DropHost({ act, onSaid }: { act: GameActions; onSaid: (t: string) => void }) {
  /** 무엇을 놓나. 한 번에 하나만 놓는다 */
  const [what, setWhat] = useState<What>('memo')
  const [tileId, setTileId] = useState<string>(TILES[0]?.id ?? '')
  /** 문제를 놓을 칸. 작은 판에서 짚는다 */
  const [spot, setSpot] = useState<Spot | null>(null)
  /** 이미 판에 나가 있는 종이. 겹쳐 놓지 않게 점으로 찍는다 */
  const [marks, setMarks] = useState<SpotMark[]>([])
  const [memo, setMemo] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  /** 쪽지 — 누구의 비밀인가, 무엇을 적나 */
  const [who, setWho] = useState('')
  const [slipText, setSlipText] = useState('')
  const [slips, setSlips] = useState<SlipBoard | null>(null)

  /**
   * 놓여 있는 것을 읽어 온다. 칸에 놓는 쪽(문제·쪽지)을 볼 때만 필요하다.
   * **문제와 쪽지를 같이 찍는다** — 한 칸에 한 장이라, 문제가 놓인 칸에
   * 쪽지를 놓으려 하면 서버가 막는다. 판에서 미리 보여야 한다.
   */
  async function loadMarks() {
    const [q, sl] = await Promise.all([
      act.hostQuizList().catch(() => null) as Promise<{ onFloor?: SpotMark[] } | null>,
      act.hostSlipList().catch(() => null) as Promise<SlipBoard | null>,
    ])
    // 못 읽어도 놓는 데는 지장이 없다. 점이 안 찍힐 뿐이다
    setMarks([
      ...(q?.onFloor ?? []).map((m) => ({ ...m, kind: 'quiz' as const })),
      ...(sl?.onFloor ?? []).map((m) => ({ ...m, kind: 'slip' as const })),
    ])
    if (sl) setSlips(sl)
  }
  useEffect(() => {
    if (what !== 'memo') void loadMarks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what])

  /** 쪽지를 도로 거둔다. 아무도 안 주운 것만 된다 */
  async function pull(id: string) {
    setBusy(true)
    try {
      await act.hostPullSlip(id)
      onSaid('거뒀다. 그 사람 몫 한 자리가 다시 비었다.')
      await loadMarks()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function drop() {
    setBusy(true)
    try {
      const res = (await act.hostDrop(
        what === 'memo'
          ? { tileId, kind: 'memo', text: memo }
          : what === 'slip'
          ? { x: spot?.x, y: spot?.y, kind: 'slip', subjectId: who, text: slipText }
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
      } else if (what === 'slip') {
        // 사람은 그대로 둔다 — 한 사람 몫 넉 장을 이어서 깔 때가 많다
        setSlipText('')
        setSpot(null)
        await loadMarks()
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

  const person = slips?.people.find((p) => p.id === who) ?? null
  const full = person !== null && slips !== null && person.placed >= slips.perPerson
  const ready =
    what === 'memo'
      ? tileId !== '' && memo.trim().length > 0
      : what === 'slip'
      ? spot !== null && person !== null && !full && slipText.trim().length > 0
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
        <button className={what === 'slip' ? 'is-on' : ''} onClick={() => setWhat('slip')}>
          비밀 쪽지
        </button>
      </div>

      {what === 'slip' && (
        <>
          <label className="sc-dr__row">
            <span>누구의 것</span>
            <select id="dr-who" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">— 고른다 —</option>
              {(slips?.people ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={p.placed >= (slips?.perPerson ?? 0)}>
                  {p.name} · {p.placed}/{slips?.perPerson}
                </option>
              ))}
            </select>
          </label>
          {slips && (
            <p className="sc-dr__hint">
              {slips.people.reduce((n, p) => n + p.placed, 0)} / {slips.people.length * slips.perPerson}장 나갔다.
              {full && ` ${person?.name} 앞으로는 다 놓았다.`}
            </p>
          )}

          <SpotPick value={spot} onPick={setSpot} marks={marks} />

          <label className="sc-dr__row sc-dr__row--tall">
            <span>적을 말</span>
            <textarea
              id="dr-slip"
              rows={4}
              maxLength={MEMO_MAX}
              value={slipText}
              placeholder={`주운 사람만 읽는다. ${SLIP_SUBJECT_MARK}은/는 처럼 쓰면 그 사람 이름과 맞는 조사로 바뀐다`}
              onChange={(e) => setSlipText(e.target.value.slice(0, MEMO_MAX))}
            />
          </label>
          <p className="sc-dr__hint">{MEMO_MAX - slipText.length}자 남았다.</p>
        </>
      )}

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
        {what === 'slip'
          ? '접힌 채로 짚은 칸에 놓인다. 옆에 선 사람에게는 「한 장 있다」까지만 보이고, 누구의 비밀인지도 주워서 읽어야 안다.'
          : what === 'quiz'
          ? '접힌 채로 놓인다. 옆에 선 사람에게는 「한 장 있다」까지만 보이고, 주워야 무엇이 적혔는지 안다. 먼저 맞히는 한 사람이 가져간다.'
          : '접힌 채로 놓인다. 그 방에 선 사람에게는 「한 장 있다」까지만 보이고, 주워야 무엇이 적혔는지 안다.'}
      </p>

      {what === 'slip' && slips && slips.onFloor.length > 0 && (
        <ul className="sc-dr__list">
          {slips.onFloor.map((f) => (
            <li key={f.id}>
              <span>
                {slips.people.find((p) => p.id === f.subjectId)?.name ?? '?'} · {whereOf(f.x, f.y)}
              </span>
              <em>{f.text}</em>
              <button disabled={busy} onClick={() => void pull(f.id)}>
                거두기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
