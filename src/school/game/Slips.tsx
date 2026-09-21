// 쪽지 — 바닥에 떨어진 것을 줍고, 읽고, 처리한다.
//
// 화면은 서버가 준 것만 보여 준다. 안 읽은 쪽지는 문장 자리에 아무것도
// 없다 — 가려 둔 것이 아니라 **오지 않았다.** 개발자도구를 열어도 없다.
import { useState } from 'react'

import { isBlank } from '../../../shared/reveal/slips'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'

export interface SlipsProps {
  view: PlayerViewDoc | null
  seats: readonly SeatEntry[]
  /** 같은 방에 선 사람들. 건넬 수 있는 상대다. */
  hereIds: readonly string[]
  meId: string
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
  ask: (text: string) => Promise<boolean>
}

export function Slips({ view, seats, hereIds, meId, act, onSaid, ask }: SlipsProps) {
  const [busy, setBusy] = useState(false)
  const [giving, setGiving] = useState<string | null>(null)

  const floor = view?.slipsHere ?? []
  const mine = view?.mySlips ?? []
  /** 이 방에 남은 찢긴 조각. 붙이는 것은 테이프가 한다(주머니 쪽). */
  const scraps = view?.scrapsHere ?? []
  if (floor.length === 0 && mine.length === 0 && scraps.length === 0) return null

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      setGiving(null)
      onSaid(what)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (id: string) => seats.find((s) => s.playerId === id)?.name ?? '누군가'
  const others = hereIds.filter((id) => id !== meId)

  return (
    <section className="sc-sl">
      <h2>쪽지</h2>

      {floor.length > 0 && (
        <>
          <p className="sc-sl__hint">
            바닥에 {floor.length}장 떨어져 있다. 주워야 무엇이 적혔는지 안다.
          </p>
          <div className="sc-sl__row">
            {floor.map((s) => (
              <button key={s.id} disabled={busy} onClick={() => void run('주웠다.', () => act.takeSlip(s.id))}>
                줍기
              </button>
            ))}
          </div>
        </>
      )}

      {/*
        찢긴 조각. **여기에는 단추가 없다** — 붙이는 것은 테이프가
        하는 일이고, 테이프는 주머니에 있다. 여기서 또 누르게 두면
        물건 없이도 붙일 수 있는 것처럼 보인다
      */}
      {scraps.length > 0 && (
        <p className="sc-sl__hint">
          찢긴 조각이 {scraps.length}무더기 남아 있다. 테이프가 있으면 붙일 수 있다.
        </p>
      )}

      {mine.length > 0 && (
        <ul className="sc-sl__list">
          {mine.map((s) => (
            <li key={s.id}>
              {!s.read ? (
                <>
                  <p className="sc-sl__folded">접힌 쪽지. 아직 안 읽었다.</p>
                  <div className="sc-sl__row">
                    <button disabled={busy} onClick={() => void run('읽었다.', () => act.readSlip(s.id))}>
                      읽기
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* 아직 안 쓴 문장이면 그대로 보여 주지 않는다 — 준비 중이라고 말한다 */}
                  <p className="sc-sl__line">
                    {isBlank(s.line ?? '') ? '(이 쪽지에 적힐 말은 아직 준비 중이다)' : s.line}
                  </p>
                  {s.subjectId && <p className="sc-sl__whose">{nameOf(s.subjectId)}의 일이다.</p>}
                </>
              )}

              <div className="sc-sl__row">
                <button disabled={busy} onClick={() => void run('여기 두었다.', () => act.dropSlip(s.id))}>
                  여기 두기
                </button>
                <button
                  disabled={busy || others.length === 0}
                  onClick={() => setGiving(giving === s.id ? null : s.id)}
                >
                  {others.length === 0 ? '건넬 사람이 없다' : '건네기'}
                </button>
                {/* 찢은 쪽지는 영영 사라진다. 한 번 묻는다 */}
                <button
                  className="sc-sl__tear"
                  disabled={busy}
                  onClick={() => {
                    void ask('이 쪽지를 찢는다. 영영 사라진다.').then((ok) => {
                      if (ok) void run('찢었다.', () => act.tearSlip(s.id))
                    })
                  }}
                >
                  찢기
                </button>
              </div>

              {giving === s.id && (
                <div className="sc-sl__row sc-sl__to">
                  {others.map((id) => (
                    <button
                      key={id}
                      disabled={busy}
                      onClick={() => void run(`${nameOf(id)}에게 건넸다.`, () => act.giveSlip(s.id, id))}
                    >
                      {nameOf(id)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="sc-sl__note">
        값을 부르려면 그냥 건네지 말고 교역에 실어 보낸다. 찢은 쪽지는 영영 사라진다.
      </p>
    </section>
  )
}
