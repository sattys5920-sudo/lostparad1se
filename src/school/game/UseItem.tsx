// 주머니 — 가진 물건과, 쓰는 자리.
//
// 물건이 둘로 갈린다. 호루라기와 명찰은 **행동에 딸려 있어서** 여기
// 단추가 없다 — 페이즈에서 방해나 위장을 걸 때 저절로 하나가 빠진다.
// 나머지 넷은 여기서 쓴다.
//
// **되는지 안 되는지는 서버가 말한다.** 화면이 미리 재서 단추를 잠그면,
// 규칙이 두 군데 적히고 언젠가 한쪽만 고쳐진다. 여기서 잠그는 것은
// 하나뿐이다 — 테이프는 붙일 조각이 눈앞에 없으면 누를 데가 없다.
import { useState } from 'react'

import { ITEM_BY_KIND, PAPER_MAX, isHandItem, type ItemKind, type Satchel } from '../../../shared/rules/items'
import { TILE_BY_ID } from '../../../shared/rules/board'
import { CROP_BY_ID, HARVEST_LIMIT } from '../../../shared/rules/crop'
import { goodIcon } from './goodArt'
import type { GameActions } from './useGame'
import type { PlayerViewDoc } from '../../../shared/model'

export interface BagProps {
  items: Satchel
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
  ask: (text: string) => Promise<boolean>
}

export function Bag({ items, view, act, onSaid, ask }: BagProps) {
  const [busy, setBusy] = useState(false)
  /** 빈 종이를 펼쳐 놓은 상태. 적는 중에는 목록이 안 접힌다 */
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')

  const scraps = view?.scrapsHere ?? []
  const rows = (Object.entries(items) as [ItemKind, number][]).filter(([, n]) => (n ?? 0) > 0)
  /*
   * 들고 있는 심부름 물건. **여기 한 줄로 선다.**
   *
   * 산 물건과 같은 칸에 있지만 같은 것은 아니다 — 남에게 못 넘기고,
   * 쓰는 것도 아니고, 정해진 방에 놓는 것으로 끝난다. 그래서 줄은
   * 여기 있고 판정은 서버가 한다.
   */
  const errand = view?.myErrand ?? null
  const carrying = errand?.carrying === true ? errand : null
  /*
   * 딴 작물. **여기서는 보여 주기만 한다** — 파는 것은 자판기가 하고,
   * 쓰는 물건도 아니다. 손에 몇 개 들었는지가 다음에 딸 수 있는지를
   * 정하므로 한도를 같이 적는다.
   */
  const crops = Object.entries(view?.myCrops ?? {}).filter(([, n]) => n > 0)
  const held = crops.reduce((a, [, n]) => a + n, 0)
  if (rows.length === 0 && carrying === null && crops.length === 0) {
    return <p className="sc-mi__none">가진 것이 없다.</p>
  }

  async function use(kind: ItemKind, more: { text?: string; scrapId?: string } = {}) {
    setBusy(true)
    try {
      const out = (await act.useItem(kind, more)) as { said?: string }
      onSaid(out.said ?? '썼다.')
      if (kind === 'paper') {
        setWriting(false)
        setText('')
      }
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function drop() {
    setBusy(true)
    try {
      const out = (await act.dropThing()) as { coins?: number }
      onSaid(`놓았다. ${out.coins ?? 0}코인.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ul className="sc-mi__bag">
      {carrying && (
        <li className="is-errand">
          <b>
            <img className="sc-mi__icon" src={goodIcon(carrying.icon)} alt="" width={18} height={18} />
            {carrying.thing}
          </b>
          <span>심부름</span>
          <p>
            {TILE_BY_ID[carrying.to].name}에 놓으면 끝난다. 먼저 놓는 사람이 {carrying.coins}코인을
            받는다. 남에게 넘길 수는 없다.
          </p>
          {/* **놓을 수 있는지는 서버가 안다.** 여기서 방을 재서 잠그면
              규칙이 두 군데 적힌다 — 다른 방에서 누르면 어디에 놓아야
              하는지를 서버가 말해 준다 */}
          <button className="sc-mi__use" disabled={busy} onClick={() => void drop()}>
            {TILE_BY_ID[carrying.to].name}에 놓기
          </button>
        </li>
      )}
      {crops.length > 0 && (
        <li className="is-crop">
          <b>딴 것</b>
          <span>
            {held}/{HARVEST_LIMIT}
          </span>
          <p>{crops.map(([id, n]) => `${CROP_BY_ID[id]?.name ?? id} ${n}`).join(' · ')}</p>
        </li>
      )}
      {rows.map(([kind, n]) => {
        const spec = ITEM_BY_KIND[kind]
        return (
          <li key={kind}>
            <b>{spec?.name ?? kind}</b>
            <span>{n}개</span>
            <p>{spec?.text ?? ''}</p>

            {/* 행동에 딸린 물건. 여기서는 쓸 일이 없다 */}
            {!isHandItem(kind) && (
              <p className="sc-mi__howto">페이즈에서 그 행동을 걸 때 한 개 쓰인다.</p>
            )}

            {kind === 'lock' && (
              <button className="sc-mi__use" disabled={busy} onClick={() => void use('lock')}>
                이 방 문에 걸기
              </button>
            )}

            {kind === 'eraser' && (
              <button
                className="sc-mi__use"
                disabled={busy}
                onClick={() => {
                  // **몇 장 적혔는지는 끝내 안 나온다.** 그래서 한 번 묻는다 —
                  // 쓰고 나서 「아무 일도 없었다」로 보이는 것이 정상이다
                  void ask('오늘 내 이름이 적힌 표를 한 장 지운다. 몇 장이었는지는 알려 주지 않는다.').then(
                    async (yes) => {
                      if (yes) await use('eraser')
                    },
                  )
                }}
              >
                한 장 지우기
              </button>
            )}

            {kind === 'paper' && !writing && (
              <button className="sc-mi__use" disabled={busy} onClick={() => setWriting(true)}>
                적어서 놓기
              </button>
            )}
            {kind === 'paper' && writing && (
              <div className="sc-mi__write">
                <textarea
                  rows={3}
                  maxLength={PAPER_MAX}
                  value={text}
                  placeholder="주운 사람만 읽는다"
                  onChange={(e) => setText(e.target.value.slice(0, PAPER_MAX))}
                />
                <div className="sc-mi__writeRow">
                  <button disabled={busy || text.trim() === ''} onClick={() => void use('paper', { text })}>
                    바닥에 놓기
                  </button>
                  <button
                    className="sc-mi__cancel"
                    disabled={busy}
                    onClick={() => {
                      setWriting(false)
                      setText('')
                    }}
                  >
                    그만두기
                  </button>
                </div>
              </div>
            )}

            {kind === 'tape' &&
              (scraps.length === 0 ? (
                <p className="sc-mi__howto">이 방에는 붙일 조각이 없다.</p>
              ) : (
                <button
                  className="sc-mi__use"
                  disabled={busy}
                  onClick={() => void use('tape', { scrapId: scraps[0]?.id })}
                >
                  조각 붙이기 ({scraps.length}무더기)
                </button>
              ))}
          </li>
        )
      })}
    </ul>
  )
}
