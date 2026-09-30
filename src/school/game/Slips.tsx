// 쪽지 — 주운 것을 읽고, 처리한다.
//
// **줍는 것은 맵에서 한다.** 바닥의 쪽지는 칸에 그려지고, 옆에 서서
// 짚으면 줍는다. 여기서 「바닥에 몇 장」을 세어 주면 방에 들어서자마자
// 있는지 없는지가 드러난다 — 둘러봐야 찾는 것이 바닥의 종이다.
//
// 화면은 서버가 준 것만 보여 준다. 안 읽은 쪽지는 문장 자리에 아무것도
// 없다 — 가려 둔 것이 아니라 **오지 않았다.** 개발자도구를 열어도 없다.
import { useState } from 'react'

import { isBlank } from '../../../shared/reveal/slips'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import { Sure } from './Sheet'
import { buzz } from './Controls'

export interface SlipsProps {
  view: PlayerViewDoc | null
  seats: readonly SeatEntry[]
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
}

export function Slips({ view, seats, act, onSaid }: SlipsProps) {
  const [busy, setBusy] = useState(false)

  const mine = view?.mySlips ?? []
  // 찢긴 종이는 여기서 안 센다 — 맵 바닥에 그려지고, 옆에서 짚어 테이프로 붙인다
  if (mine.length === 0) return null

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      buzz('ok')
      onSaid(what)
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (id: string) => seats.find((s) => s.playerId === id)?.name ?? '누군가'

  return (
    <section className="sc-sl">
      <h2>쪽지</h2>


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
                {/* 찢은 쪽지는 영영 사라진다. 한 번 더 누르게 한다 */}
                <Sure
                  className="sc-sl__tear"
                  disabled={busy}
                  warn="영영 사라진다."
                  onGo={() => void run('찢었다.', () => act.tearSlip(s.id))}
                >
                  찢기
                </Sure>
              </div>

              {/*
                **건네는 것은 거래로만.** 옆 칸에 마주 서서 거래창에 올린다 —
                그냥 주는 길을 두면 쪽지가 값 없이 돈다. 값을 0으로 부르면 그냥
                주는 것과 같으니 선물도 거래창으로 한다
              */}
              <p className="sc-sl__note">남에게 주려면 옆 칸에 서서 거래창에 올린다.</p>
            </li>
          ))}
        </ul>
      )}

    </section>
  )
}
