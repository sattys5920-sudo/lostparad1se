// 고른 칸에 할 수 있는 일.
//
// **화면이 무엇을 할 수 있는지 판단하지 않는다.** 단추는 다 보이고,
// 안 되는 것은 서버가 거절하며 그 이유를 말해 준다. 화면이 미리
// 막으면 서버와 화면이 두 벌의 규칙을 갖게 되고, 둘이 어긋나는 날
// 사람은 왜 안 되는지 알 수 없다.
import { useState, type ReactNode } from 'react'

import { TILE_BY_ID, type TileId } from '../../../shared/rules/board'
import { SHOP_ITEMS, SHOP_TILE, shopPriceFor } from '../../../shared/rules/shop'
import { ACTION_TOKEN_COST } from '../../../shared/rules/actions'
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
 * 생산은 **내가 선 자리**에서 한다. 고른 칸과 상관없다.
 *
 * 처음에는 이것도 칸 패널에 넣었는데, 「교실」을 골라 두고 생산을
 * 누르면 교실에서 무언가 나는 것처럼 보였다. 실제로는 내가 선 칸이
 * 우리 땅이기만 하면 된다. 자리를 갈라 놓는다.
 *
 * **연구는 여기 없다.** 페이즈에, 연구실에서만 한다.
 */
export function Standing({ standingOn, act, onSaid }: { standingOn: TileId | null; act: GameActions; onSaid: (t: string) => void }) {
  const { busy, run } = useRun(onSaid)
  return (
    <div className="sc-ac__standing">
      {/* 방 이름은 바로 위 제목이 이미 말한다. 여기서는 서 있는 자리에서만
          되는 일이라는 것만 밝힌다 */}
      <span className="sc-ac__where">{standingOn ? '선 자리에서' : '걷는 중'}</span>
      <button disabled={busy || !standingOn} onClick={() => run('생산', () => act.produce(standingOn as TileId))}>
        생산 <em>{ACTION_TOKEN_COST.produce}</em>
      </button>
      <button disabled={busy || !standingOn} onClick={() => run('공부', () => act.study(standingOn as TileId))}>
        공부 <em>{ACTION_TOKEN_COST.study}</em>
      </button>
    </div>
  )
}

export interface QuickProps {
  /** 서버가 아는 내가 선 방. 생산·깃발·탐색이 전부 여기에 걸린다. */
  standingOn: TileId | null
  /** 화면에서 내가 선 방. 복도에 있으면 null 이다. */
  standingRoom: TileId | null
  phaseOpen: boolean
  /** 판에서 고른 먼 방. 있으면 거기로 가는 것이 먼저다. */
  far: TileId | null
  act: GameActions
  onSaid: (text: string) => void
  /** 더 고를 것이 남은 일은 시트를 연다. */
  onSheet: (id: 'act' | 'deal' | 'shop') => void
}

/**
 * 맵 밑에 늘 떠 있는 행동 줄.
 *
 * **무엇을 할 수 있는지는 눌러 보기 전에 보여야 한다.** 전에는 전부
 * 「행동」 단추 뒤에 있어서, 처음 들어온 사람은 거래라는 것이 있는
 * 줄도 몰랐다 — 거래는 「더보기」 안의 또 한 겹 아래였다.
 *
 * 여기서도 화면이 되는지 안 되는지를 판단하지 않는다. 걷는 중이라
 * 선 방이 없을 때만 잠그고, 나머지는 서버가 거절하며 이유를 말한다.
 */
export function QuickActions({
  standingOn,
  standingRoom,
  phaseOpen,
  far,
  act,
  onSaid,
  onSheet,
}: QuickProps) {
  const { busy, run } = useRun(onSaid)
  const walking = standingOn === null

  // **먼 방을 눌러도 여기서 보내 주지 않는다.**
  //
  // 전에는 「○○(으)로」와 「등교 예약」이 떴다. 칸마다 15분씩 여러
  // 칸을 걷던 시절의 단추인데, 복도가 생기고 계단이 문이 된 뒤로는
  // 어느 방이든 한 걸음이라 예약할 「두 칸」이 없어졌다. 자유 시간에는
  // 그냥 맵에서 걸어가면 공짜고 즉시다
  if (far && far !== standingRoom) {
    return (
      <div className="sc-pl__quick" role="group" aria-label="할 수 있는 일">
        <button className="is-lead" onClick={() => onSheet('act')}>
          {TILE_BY_ID[far].name} 보기
        </button>
      </div>
    )
  }

  // 페이즈 중에는 자리 차지하기가 전부다. 토큰 계산이 붙어 있어
  // 한 줄에 못 담는다 — 시트를 연다
  if (phaseOpen) {
    return (
      <div className="sc-pl__quick" role="group" aria-label="할 수 있는 일">
        <button className="is-lead" onClick={() => onSheet('act')}>자리 차지하기</button>
        <button onClick={() => onSheet('deal')}>거래</button>
      </div>
    )
  }

  return (
    <div className="sc-pl__quick" role="group" aria-label="할 수 있는 일">
      <button disabled={busy || walking} onClick={() => run('생산', () => act.produce(standingOn as TileId))}>
        생산 <em>{ACTION_TOKEN_COST.produce}</em>
      </button>
      <button disabled={busy || walking} onClick={() => run('공부', () => act.study(standingOn as TileId))}>
        공부 <em>{ACTION_TOKEN_COST.study}</em>
      </button>
      {standingOn === SHOP_TILE && (
        <button className="is-lead" onClick={() => onSheet('shop')}>
          상점
        </button>
      )}
      <button onClick={() => onSheet('deal')}>거래</button>
    </div>
  )
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
                  <b>{i.name}</b>
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

export function Actions({ tileId, where, onClose, children }: ActionsProps) {
  const spec = TILE_BY_ID[tileId]

  return (
    <div className="sc-ac">
      <h2>
        {spec.name} <span>{spec.value}점</span>
        {onClose && (
          <button className="sc-ac__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        )}
      </h2>
      {children}

      {where === 'there' && (
        <p className="sc-ac__note">맵에서 걸어서 간다. 자유 시간에는 값도 시간도 안 든다.</p>
      )}

    </div>
  )
}
