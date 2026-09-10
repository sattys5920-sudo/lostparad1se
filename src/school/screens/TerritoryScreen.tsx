import { useMemo, useState } from 'react'
import './TerritoryScreen.css'
import './ActionSheet.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { TILES, tileById } from '../data/tiles'
import { TEAMS, teamById } from '../data/teams'
import { BUILDING_CATEGORY_LABEL, BUILDINGS, buildingByKind } from '../data/buildings'
import { cardByKind, TARGETED_CARDS } from '../data/cards'
import { fragmentByDay } from '../data/fragments'
import { canExpand, expandCost, finalScores, RESOURCE_LABEL, tileValue } from '../engine/territory'
import type { BuildingKind, ResourceBundle, SabotageEffectKind, TeamId, TileId } from '../types'

const RESOURCE_KEYS: (keyof ResourceBundle)[] = ['money', 'food', 'knowledge', 'culture', 'influence', 'actionPoints']

function ResourceBar({ resources }: { resources: ResourceBundle }) {
  return (
    <div className="sc-terr__resbar">
      {RESOURCE_KEYS.map((k) => (
        <span key={k} className="sc-terr__res">
          <span className="sc-terr__res-label">{RESOURCE_LABEL[k]}</span>
          <span className="sc-terr__res-value">{resources[k]}</span>
        </span>
      ))}
    </div>
  )
}

function costLine(cost: Partial<ResourceBundle>): string {
  return (Object.entries(cost) as [keyof ResourceBundle, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${RESOURCE_LABEL[k]} ${v}`)
    .join(' · ')
}

export function TerritoryScreen() {
  const {
    isHost,
    session,
    myTeamId,
    myTeam,
    hasActedToday,
    doExpand,
    doBuild,
    doUpgrade,
    doResearch,
    doExplore,
    doProduce,
    doSabotage,
    doPlayCard,
    doProposeTrade,
    doRespondTrade,
    doWithdrawTrade,
    doProposeAlliance,
    doRespondAlliance,
    doBreakAlliance,
  } = useSchoolGame()
  const territory = session.territory
  const [subview, setSubview] = useState<'map' | 'action' | 'trade' | 'card'>('map')
  const [openTile, setOpenTile] = useState<TileId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const scores = useMemo(() => finalScores(territory), [territory])

  async function run(fn: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await fn()
      setOpenTile(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '실행할 수 없다.')
    } finally {
      setBusy(false)
    }
  }

  const zoneTiles = TILES.filter((t) => t.homeOf === null)
  const openTileSpec = openTile ? tileById[openTile] : null
  const openTileState = openTile ? territory.tiles[openTile] : null

  return (
    <div className="sc-terr">
      <div className="sc-terr__scores">
        {TEAMS.map((t) => (
          <span key={t.id} className="sc-terr__score">
            <span className="sc-terr__dot" style={{ background: t.color }} />
            {t.name} {scores[t.id].total}
          </span>
        ))}
      </div>

      {myTeamId && myTeam && (
        <div className="sc-terr__mine">
          <span className="sc-terr__mine-label" style={{ color: teamById[myTeamId].color }}>
            우리 팀 · {teamById[myTeamId].name}
          </span>
          <ResourceBar resources={myTeam.resources} />
        </div>
      )}

      <div className="sc-terr__subnav">
        {(['map', 'action', 'trade', 'card'] as const).map((v) => (
          <button key={v} className={`sc-terr__subtab ${subview === v ? 'is-active' : ''}`} onClick={() => setSubview(v)}>
            {{ map: '지도', action: '행동', trade: '교역·동맹', card: '카드' }[v]}
          </button>
        ))}
      </div>

      {error && <p className="sc-terr__error">{error}</p>}

      {subview === 'map' && (
        <div className="sc-terr__list">
          <div className="sc-terr__bases">
            {TEAMS.map((t) => (
              <span key={t.id} className="sc-terr__base" style={{ borderColor: t.color, color: t.color }}>
                {t.name} 기지
              </span>
            ))}
          </div>
          {zoneTiles.map((spec) => {
            const tileState = territory.tiles[spec.id]
            const owner = tileState.ownerTeam ? teamById[tileState.ownerTeam] : null
            const locked = !territory.unlockedTiles.includes(spec.id)
            const fragmentMarked = territory.releasedFragments.some((d) => fragmentByDay[d]?.tileId === spec.id)
            return (
              <button
                key={spec.id}
                className={`sc-terr__tile ${myTeamId && owner?.id === myTeamId ? 'is-mine' : ''}`}
                onClick={() => setOpenTile(spec.id)}
              >
                <span className="sc-terr__tile-main">
                  <span className="sc-terr__tile-name">
                    {spec.name}
                    {fragmentMarked && <span className="sc-terr__marked"> · A가 남긴 곳</span>}
                  </span>
                  <span className="sc-terr__tile-value">가치 {tileValue(territory, spec.id)}</span>
                </span>
                <span className="sc-terr__tile-sub">
                  {locked ? (
                    <span className="sc-terr__lock">A의 기록이 열어야 들어갈 수 있다</span>
                  ) : owner ? (
                    <span className="sc-terr__owner" style={{ color: owner.color }}>
                      {owner.name} 소유
                    </span>
                  ) : (
                    <span className="sc-terr__neutral">중립</span>
                  )}
                  {tileState.buildings.length > 0 && (
                    <span className="sc-terr__buildings">
                      {tileState.buildings.map((b) => `${buildingByKind[b.kind].name} Lv.${b.level}`).join(', ')}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {subview === 'action' && myTeamId && myTeam && (
        <div className="sc-terr__actions">
          {hasActedToday && <p className="sc-terr__hint">오늘은 이미 행동을 마쳤다. 내일 다시 할 수 있다.</p>}
          <button
            className="sc-terr__action"
            disabled={busy || hasActedToday}
            onClick={() => run(doResearch)}
          >
            <span>연구하기</span>
            <span className="sc-terr__action-cost">지식 {2 + myTeam.researchTier} · 행동력 1</span>
          </button>
          <button className="sc-terr__action" disabled={busy || hasActedToday} onClick={() => run(doExplore)}>
            <span>탐색하기</span>
            <span className="sc-terr__action-cost">행동력 1</span>
          </button>
          <button className="sc-terr__action" disabled={busy || hasActedToday} onClick={() => run(doProduce)}>
            <span>생산하기</span>
            <span className="sc-terr__action-cost">행동력 1</span>
          </button>
          <div className="sc-terr__sabotage">
            <span className="sc-terr__label">견제하기 · 영향력 2 · 행동력 1</span>
            {TEAMS.filter((t) => t.id !== myTeamId).map((t) => (
              <div key={t.id} className="sc-terr__sabotage-row">
                <span style={{ color: t.color }}>{t.name}</span>
                {(['expandCostUp', 'productionDown', 'tradeBlocked'] as SabotageEffectKind[]).map((kind) => (
                  <button
                    key={kind}
                    disabled={busy || hasActedToday}
                    onClick={() => run(() => doSabotage(t.id, kind))}
                  >
                    {{ expandCostUp: '확장 방해', productionDown: '생산 방해', tradeBlocked: '교역 차단' }[kind]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {subview === 'trade' && myTeamId && (
        <TradeAndAlliancePanel
          myTeamId={myTeamId}
          territory={territory}
          busy={busy}
          run={run}
          doProposeTrade={doProposeTrade}
          doRespondTrade={doRespondTrade}
          doWithdrawTrade={doWithdrawTrade}
          doProposeAlliance={doProposeAlliance}
          doRespondAlliance={doRespondAlliance}
          doBreakAlliance={doBreakAlliance}
        />
      )}

      {subview === 'card' && myTeam && (
        <div className="sc-terr__cards">
          {myTeam.hand.length === 0 && <p className="sc-terr__hint">가지고 있는 카드가 없다. 연구로 얻을 수 있다.</p>}
          {myTeam.hand.map((card) => {
            const spec = cardByKind[card.kind]
            const targeted = TARGETED_CARDS.includes(card.kind)
            return (
              <div key={card.id} className="sc-terr__card">
                <span className="sc-terr__card-name">{spec.name}</span>
                <span className="sc-terr__card-desc">{spec.description}</span>
                {targeted ? (
                  <div className="sc-terr__card-targets">
                    {TEAMS.filter((t) => t.id !== myTeamId).map((t) => (
                      <button
                        key={t.id}
                        disabled={busy}
                        onClick={() => run(() => doPlayCard(card.id, t.id))}
                      >
                        {t.name}에 쓰기
                      </button>
                    ))}
                  </div>
                ) : (
                  <button disabled={busy} onClick={() => run(() => doPlayCard(card.id, null))}>
                    쓰기
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isHost && (
        <p className="sc-terr__hint sc-terr__hint--host">
          진행자는 팀 행동을 대신 할 수 없다. 지도로 진행 상황만 확인한다.
        </p>
      )}

      {openTile && openTileSpec && openTileState && (
        <TileSheet
          tileId={openTile}
          myTeamId={myTeamId}
          territory={territory}
          busy={busy}
          onClose={() => setOpenTile(null)}
          onExpand={() => run(() => doExpand(openTile))}
          onBuild={(kind) => run(() => doBuild(openTile, kind))}
          onUpgrade={(kind) => run(() => doUpgrade(openTile, kind))}
        />
      )}
    </div>
  )
}

function TileSheet({
  tileId,
  myTeamId,
  territory,
  busy,
  onClose,
  onExpand,
  onBuild,
  onUpgrade,
}: {
  tileId: TileId
  myTeamId: TeamId | null
  territory: ReturnType<typeof useSchoolGame>['session']['territory']
  busy: boolean
  onClose: () => void
  onExpand: () => void
  onBuild: (kind: BuildingKind) => void
  onUpgrade: (kind: BuildingKind) => void
}) {
  const spec = tileById[tileId]
  const tileState = territory.tiles[tileId]
  const owner = tileState.ownerTeam ? teamById[tileState.ownerTeam] : null
  const isMine = myTeamId !== null && tileState.ownerTeam === myTeamId
  const expandCheck = myTeamId ? canExpand(territory, myTeamId, tileId) : { ok: false as const, reason: '' }
  const cost = myTeamId ? expandCost(territory, myTeamId, tileId) : null

  return (
    <div className="sc-sheet__backdrop" onClick={onClose}>
      <div className="sc-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sc-sheet__head">
          <span>{spec.name}</span>
          <button className="sc-sheet__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sc-sheet__body">
          <p className="sc-terr__sheet-value">
            가치 {tileValue(territory, tileId)} · {owner ? `${owner.name} 소유` : '중립'}
          </p>

          {!isMine && myTeamId && (
            <div className="sc-sheet__form">
              {expandCheck.ok ? (
                <>
                  <p>확장 비용 · {cost ? costLine(cost) : ''}</p>
                  <button className="sc-sheet__submit" disabled={busy} onClick={onExpand}>
                    확장한다
                  </button>
                </>
              ) : (
                <p className="sc-terr__hint">{expandCheck.reason}</p>
              )}
            </div>
          )}

          {isMine && (
            <div className="sc-sheet__form">
              <span className="sc-sheet__rumors-label">
                건물 슬롯 {tileState.buildings.length}/{spec.buildingSlots}
              </span>
              {tileState.buildings.map((b) => {
                const bSpec = buildingByKind[b.kind]
                return (
                  <div key={b.kind} className="sc-terr__building-row">
                    <span>
                      {bSpec.name} Lv.{b.level}
                    </span>
                    {b.level < 2 && (
                      <button disabled={busy} onClick={() => onUpgrade(b.kind)}>
                        업그레이드 · {costLine(bSpec.cost)}
                      </button>
                    )}
                  </div>
                )
              })}
              {tileState.buildings.length < spec.buildingSlots && (
                <div className="sc-terr__build-grid">
                  {BUILDINGS.filter((b) => !tileState.buildings.some((built) => built.kind === b.kind)).map((b) => (
                    <button key={b.kind} disabled={busy} onClick={() => onBuild(b.kind)}>
                      <span className="sc-sheet__option-label">
                        {b.name} · {BUILDING_CATEGORY_LABEL[b.category]}
                      </span>
                      <span className="sc-sheet__option-desc">{costLine(b.cost)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TradeAndAlliancePanel({
  myTeamId,
  territory,
  busy,
  run,
  doProposeTrade,
  doRespondTrade,
  doWithdrawTrade,
  doProposeAlliance,
  doRespondAlliance,
  doBreakAlliance,
}: {
  myTeamId: TeamId
  territory: ReturnType<typeof useSchoolGame>['session']['territory']
  busy: boolean
  run: (fn: () => Promise<void>) => Promise<void>
  doProposeTrade: ReturnType<typeof useSchoolGame>['doProposeTrade']
  doRespondTrade: ReturnType<typeof useSchoolGame>['doRespondTrade']
  doWithdrawTrade: ReturnType<typeof useSchoolGame>['doWithdrawTrade']
  doProposeAlliance: ReturnType<typeof useSchoolGame>['doProposeAlliance']
  doRespondAlliance: ReturnType<typeof useSchoolGame>['doRespondAlliance']
  doBreakAlliance: ReturnType<typeof useSchoolGame>['doBreakAlliance']
}) {
  const [toTeam, setToTeam] = useState<TeamId>(TEAMS.find((t) => t.id !== myTeamId)?.id ?? 'A')
  const [offerKey, setOfferKey] = useState<keyof ResourceBundle>('money')
  const [offerAmount, setOfferAmount] = useState(1)
  const [requestKey, setRequestKey] = useState<keyof ResourceBundle>('knowledge')
  const [requestAmount, setRequestAmount] = useState(1)

  const myProposals = territory.tradeProposals.filter(
    (p) => (p.fromTeam === myTeamId || p.toTeam === myTeamId) && p.status === 'pending',
  )
  const myAlliances = territory.alliances.filter((a) => a.teams.includes(myTeamId))

  return (
    <div className="sc-terr__trade">
      <section>
        <span className="sc-terr__label">교역 제안</span>
        <div className="sc-terr__trade-form">
          <select value={toTeam} onChange={(e) => setToTeam(e.target.value as TeamId)}>
            {TEAMS.filter((t) => t.id !== myTeamId).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="sc-terr__trade-row">
            <span>준다</span>
            <select value={offerKey} onChange={(e) => setOfferKey(e.target.value as keyof ResourceBundle)}>
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={offerAmount}
              onChange={(e) => setOfferAmount(Number(e.target.value) || 1)}
            />
          </div>
          <div className="sc-terr__trade-row">
            <span>받는다</span>
            <select value={requestKey} onChange={(e) => setRequestKey(e.target.value as keyof ResourceBundle)}>
              {RESOURCE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={requestAmount}
              onChange={(e) => setRequestAmount(Number(e.target.value) || 1)}
            />
          </div>
          <button
            disabled={busy}
            onClick={() =>
              run(() => doProposeTrade(toTeam, { [offerKey]: offerAmount }, { [requestKey]: requestAmount }, null))
            }
          >
            제안 보내기
          </button>
        </div>
      </section>

      <section>
        <span className="sc-terr__label">진행 중인 제안</span>
        {myProposals.length === 0 && <p className="sc-terr__hint">없다.</p>}
        {myProposals.map((p) => (
          <div key={p.id} className="sc-terr__proposal">
            <span>
              {teamById[p.fromTeam].name} → {teamById[p.toTeam].name} · 줌 {costLine(p.offer)} / 받음{' '}
              {costLine(p.request)}
            </span>
            {p.toTeam === myTeamId ? (
              <div>
                <button disabled={busy} onClick={() => run(() => doRespondTrade(p.id, true))}>
                  수락
                </button>
                <button disabled={busy} onClick={() => run(() => doRespondTrade(p.id, false))}>
                  거절
                </button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => run(() => doWithdrawTrade(p.id))}>
                취소
              </button>
            )}
          </div>
        ))}
      </section>

      <section>
        <span className="sc-terr__label">동맹 · 강제력은 없다</span>
        <div className="sc-terr__trade-form">
          {TEAMS.filter((t) => t.id !== myTeamId).map((t) => (
            <button key={t.id} disabled={busy} onClick={() => run(() => doProposeAlliance(t.id))}>
              {t.name}에 동맹 제안
            </button>
          ))}
        </div>
        {myAlliances.length === 0 && <p className="sc-terr__hint">없다.</p>}
        {myAlliances.map((a) => {
          const other = a.teams.find((t) => t !== myTeamId) as TeamId
          return (
            <div key={a.id} className="sc-terr__proposal">
              <span>
                {teamById[other].name} · {{ proposed: '제안됨', active: '동맹 중', broken: '깨짐' }[a.status]}
              </span>
              {a.status === 'proposed' && (
                <div>
                  <button disabled={busy} onClick={() => run(() => doRespondAlliance(a.id, true))}>
                    수락
                  </button>
                  <button disabled={busy} onClick={() => run(() => doRespondAlliance(a.id, false))}>
                    거절
                  </button>
                </div>
              )}
              {a.status === 'active' && (
                <button disabled={busy} onClick={() => run(() => doBreakAlliance(a.id))}>
                  동맹 깨기
                </button>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
