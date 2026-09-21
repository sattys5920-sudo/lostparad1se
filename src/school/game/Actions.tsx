// 고른 칸에 할 수 있는 일.
//
// **화면이 무엇을 할 수 있는지 판단하지 않는다.** 단추는 다 보이고,
// 안 되는 것은 서버가 거절하며 그 이유를 말해 준다. 화면이 미리
// 막으면 서버와 화면이 두 벌의 규칙을 갖게 되고, 둘이 어긋나는 날
// 사람은 왜 안 되는지 알 수 없다.
import { useState, type ReactNode } from 'react'

import { TILE_BY_ID, type TileId } from '../../../shared/rules/board'
import { SHOP_ITEMS, shopPriceFor } from '../../../shared/rules/shop'
import { capacityOf } from '../../../shared/rules/occupy'
import type { GameActions } from './useGame'
import type { TeamId } from '../types'

export interface ActionsProps {
  tileId: TileId
  /**
   * 'here' 는 내가 서 있는 방, 'there' 는 판에서 고른 먼 칸이다.
   *
   * 먼 칸에서는 보여 주기만 한다 — 거기로 보내 주는 단추는 없앴다.
   * 자유 시간에는 맵에서 그냥 걸어가면 되고, 페이즈에는 문을 넘을 때
   * 값이 붙으므로 맵 쪽에서 치러야 한다.
   */
  where: 'here' | 'there'
  /**
   * 그 방을 잠근 팀. 자물쇠가 없으면 null 이다.
   *
   * **보이는 방만 온다**(서버의 lockedTiles). 안 보이는 방의 자물쇠는
   * 애초에 안 내려와서 여기에도 안 뜬다.
   */
  lockedBy?: TeamId | null
  /**
   * 그 방을 차지한 팀. 없으면 null 이다.
   *
   * **안개가 가리지 않는다.** 누가 어디를 차지했는지는 판에 드러난
   * 것이라 tiles 를 아무나 읽는다. 가려지는 것은 사람과 머릿수다.
   */
  owner?: TeamId | null
  /** 먼 방 패널에만 있다. 잘못 눌렀으면 닫는다. */
  onClose?: () => void
  /** 제목 바로 아래에 끼울 것. 선 자리의 생산이 여기 들어온다. */
  children?: ReactNode
}

/** 서버가 한 말을 그대로 올린다. 화면이 문구를 지어내지 않는다. */
function useRun(onSaid: (t: string) => void) {
  const [busy, setBusy] = useState(false)
  return {
    busy,
    run: async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await fn()
        onSaid(`${label} 했다.`)
      } catch (e) {
        onSaid((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
  }
}

/**
 * 상점. **서 있어야 산다.**
 *
 * 값은 상점을 누가 쥐고 있느냐로 갈린다 — 차지한 팀은 무엇이든
 * 1코인이고, 나머지는 붙은 값을 그대로 주인 팀에게 낸다. 화면이
 * 미리 재 보이기만 하고, 되는지 안 되는지는 서버가 정한다.
 */
export function Shop({
  myTeam,
  owner,
  money,
  act,
  onSaid,
}: {
  myTeam: TeamId
  /** 상점을 쥔 팀. 아무도 안 쥐고 있으면 null. */
  owner: TeamId | null
  money: number
  act: GameActions
  onSaid: (text: string) => void
}) {
  const { busy, run } = useRun(onSaid)
  return (
    <div className="sc-shop">
      <p className="sc-shop__who">
        {owner === myTeam ?
          '우리 상점이다. 무엇이든 1코인.'
        : owner ?
          `${owner}팀 상점이다. 낸 돈은 그 팀 금고로 간다.`
        : '주인 없는 상점이다. 낸 돈은 아무 데도 가지 않는다.'}
        {' · '}돈 {money}
      </p>
      {SHOP_ITEMS.length === 0 ?
        <p className="sc-pl__none">아직 파는 것이 없다.</p>
      : <ul className="sc-shop__list">
          {SHOP_ITEMS.map((i) => {
            const price = shopPriceFor(i, myTeam, owner)
            return (
              <li key={i.id}>
                <button disabled={busy} onClick={() => run(`${i.name} 사기`, () => act.buyShopItem(i.id))}>
                  <b>
                    {i.name}
                    {/* 하루 몫이 걸린 물건. 몇 개 남았는지는 안 온다 —
                        「오늘 한 개」라는 규칙만 알려 주면 된다 */}
                    {i.stockPerDay !== undefined && <i>하루 {i.stockPerDay}개</i>}
                  </b>
                  <span>{i.text}</span>
                  <em>{price.cost.money ?? 0}코인</em>
                </button>
              </li>
            )
          })}
        </ul>
      }
    </div>
  )
}

export function Actions({ tileId, where, owner = null, lockedBy = null, onClose, children }: ActionsProps) {
  const spec = TILE_BY_ID[tileId]

  return (
    <div className="sc-ac">
      <h2>
        {spec.name}
        {/* 자물쇠. 값보다 먼저 눈에 들어야 한다 — 걸어갔다가 문 앞에서
            돌아서는 것이 제일 아깝다 */}
        {lockedBy && <span className="sc-ac__locked">{lockedBy}팀이 잠갔다</span>}
        {where === 'here' && <span>{spec.value}점</span>}
        {onClose && (
          <button className="sc-ac__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        )}
      </h2>
      {children}

      {/* **먼 방은 두 가지만 알려 준다.** 누가 차지했는지와 정원.
          거기로 보내 주는 단추도, 그 방에서 할 수 있는 일도 여기 없다 —
          가서 서야 알 수 있는 것이다 */}
      {where === 'there' && (
        <dl className="sc-ac__facts">
          <div>
            <dt>차지한 팀</dt>
            <dd>{owner ? `${owner}팀` : '없다'}</dd>
          </div>
          <div>
            <dt>정원</dt>
            <dd>{capacityOf(tileId)}명</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
