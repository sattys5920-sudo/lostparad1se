// 거래창. **마주 앉아 양쪽이 각자 물건을 올린다.**
//
// 전에는 한 사람이 「줄 것」과 「받을 것」을 혼자 다 적어 보내는
// 주문서였다. 상대가 무엇을 내놓을지 고를 수 없으니 흥정이 아니라
// 청구서였다. 이제 탁자가 있고, 각자 자기 것만 올린다.
//
// 화면은 세로 세 단이다 — 위가 상대, 가운데가 오가는 방향, 아래가 나.
// 상대의 것이 위에 있어야 「내가 이걸 주고 저걸 받는다」가 눈에 그려진다.
//
// **올린 것은 선언일 뿐이다.** 서버가 맡아 두지 않는다. 그래서 창이
// 닫히거나 한 사람이 자리를 뜨면 돌려줄 것이 없다 — 애초에 움직인 적이
// 없다. 대신 성립 직전에 서버가 양쪽 소지품을 다시 센다.
import { useEffect, useMemo, useRef, useState } from 'react'

import { DEAL_COUNTDOWN_MS, stakeIsEmpty, type Stake } from '../../../shared/rules/deal'
import { ITEMS, type ItemKind } from '../../../shared/rules/items'
import { CROPS } from '../../../shared/rules/crop'
import type { TeamId } from '../../../shared/rules/v2'
import type { PlayerViewDoc } from '../../../shared/model'
import { TEAM_COLOR } from './MapPlan'
import { cropIcon, goodIcon } from './goodArt'
import { SFX } from './sfx'
import type { LiveDeal } from './useDeal'
import type { GameActions } from './useGame'
import { teamName } from '../../../shared/rules/bundan'

/**
 * 탁자에 올릴 수 있는 것들. **서버가 아는 것과 하나씩 맞는다.**
 *
 * 아이템과 작물은 목록에서 뽑는다 — 하나 늘 때 여기를 같이 고치는 것을
 * 잊으면, 가진 것인데 올릴 칸이 없는 채로 조용히 지나간다.
 *
 * 작물 칸의 열쇠는 `crop:감자아이디` 꼴이다. 물건 이름과 겹치지 않게.
 */
interface Slot {
  key: string
  name: string
  from: string
  icon: () => string
}

const CROP_KEY = (id: string) => `crop:${id}`

const SLOTS: readonly Slot[] = [
  { key: 'money', name: '돈', from: '내 것', icon: () => goodIcon('money') },
  { key: 'knowledge', name: '지식', from: '분단 금고', icon: () => goodIcon('knowledge') },
  ...ITEMS.map((i) => ({ key: i.kind, name: i.name, from: '내 것', icon: () => goodIcon(i.kind) })),
  { key: 'slips', name: '쪽지', from: '접힌 채', icon: () => goodIcon('slips') },
  { key: 'robots', name: '로봇', from: '들고 있는', icon: () => goodIcon('robots') },
  ...CROPS.map((c) => ({ key: CROP_KEY(c.id), name: c.name, from: '딴 것', icon: () => cropIcon(c.id) })),
]

type Pile = Record<string, number>

const ZERO: Pile = Object.fromEntries(SLOTS.map((s) => [s.key, 0]))

/** 탁자 위의 한 더미를 화면이 세는 모양으로. */
function pileOf(stake: Stake | undefined): Pile {
  const out = { ...ZERO }
  if (!stake) return out
  out.money = stake.money ?? 0
  out.knowledge = stake.knowledge ?? 0
  out.slips = stake.slips ?? 0
  out.robots = stake.robots ?? 0
  for (const i of ITEMS) out[i.kind] = stake.items?.[i.kind] ?? 0
  for (const c of CROPS) out[CROP_KEY(c.id)] = stake.crops?.[c.id] ?? 0
  return out
}

/** 화면이 센 것을 서버가 아는 모양으로. 쪽지는 고른 것 하나하나를 보낸다 */
function stakeOf(p: Pile, slipIds: readonly string[]): Stake {
  const items: Partial<Record<ItemKind, number>> = {}
  for (const i of ITEMS) if (p[i.kind] > 0) items[i.kind] = p[i.kind]
  const crops: Record<string, number> = {}
  for (const c of CROPS) if (p[CROP_KEY(c.id)] > 0) crops[c.id] = p[CROP_KEY(c.id)]
  return { money: p.money, knowledge: p.knowledge, slips: slipIds.length, slipIds: [...slipIds], robots: p.robots, items, crops }
}

/** 손에 든 쪽지 한 장을 고를 때 붙이는 이름. 읽은 것은 첫 줄 몇 자, 안 읽은 것은 「접힌 쪽지」 */
function slipLabel(s: { read: boolean; line: string | null }, i: number): string {
  if (!s.read) return `접힌 쪽지 ${i + 1}`
  const line = (s.line ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 18 ? `「${line.slice(0, 18)}…」` : `「${line || '빈 쪽지'}」`
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** 내가 지금 내놓을 수 있는 양. **이만큼만 집힌다.** */
function haveOf(view: PlayerViewDoc | null): Pile {
  const out = { ...ZERO }
  out.money = view?.myMoney ?? 0
  out.knowledge = view?.teamVault?.knowledge ?? 0
  out.slips = view?.mySlips?.length ?? 0
  out.robots = view?.myCarriedRobots ?? 0
  for (const i of ITEMS) out[i.kind] = view?.myItems?.[i.kind] ?? 0
  for (const c of CROPS) out[CROP_KEY(c.id)] = view?.myCrops?.[c.id] ?? 0
  return out
}

const same = (a: Pile, b: Pile) => SLOTS.every((s) => a[s.key] === b[s.key])
const count = (p: Pile) => SLOTS.reduce((n, s) => n + p[s.key], 0)

export interface DealRoomProps {
  me: { playerId: string; team: TeamId }
  deal: LiveDeal
  view: PlayerViewDoc | null
  /** 마주 앉은 사람 이름. 팀은 거래판이 안다. */
  otherName: string
  nowMs: number
  act: GameActions
  onSaid: (text: string) => void
  onClose: () => void
}

export function DealRoom({ me, deal, view, otherName, nowMs, act, onSaid, onClose }: DealRoomProps) {
  const iAmA = deal.a.playerId === me.playerId
  const mySide = iAmA ? deal.a : deal.b
  const theirSide = iAmA ? deal.b : deal.a

  const have = haveOf(view)
  const theirs = useMemo(() => pileOf(theirSide.stake), [theirSide.stake])
  const onTable = useMemo(() => pileOf(mySide.stake), [mySide.stake])

  // 손끝이 먼저 움직이고 서버가 따라온다. **다만 서버가 거절하면 서버
  // 것으로 돌아간다** — 화면에만 올려 둔 물건이 있으면 안 된다
  const [draft, setDraft] = useState<Pile>(onTable)
  /** 올리려고 고른 쪽지 — 한 장씩 다르다 */
  const tableSlips = useMemo(() => mySide.stake.slipIds ?? [], [mySide.stake.slipIds])
  const [slipDraft, setSlipDraft] = useState<string[]>(tableSlips)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) {
      setDraft(onTable)
      setSlipDraft(tableSlips)
    }
  }, [onTable, tableSlips])

  // 누를 때마다 부르지 않는다. 한 개씩 다섯 번 누르면 다섯 번 오간다
  useEffect(() => {
    if (!dirty.current || (same(draft, onTable) && sameIds(slipDraft, tableSlips))) return
    const t = setTimeout(() => {
      act
        .stakeDeal(deal.id, stakeOf(draft, slipDraft))
        .then(() => {
          dirty.current = false
        })
        .catch((e) => {
          dirty.current = false
          setDraft(onTable)
          setSlipDraft(tableSlips)
          onSaid((e as Error).message)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [draft, slipDraft, onTable, tableSlips, act, deal.id, onSaid])

  /** 내 손의 쪽지. 그새 손을 떠난 것은 고른 데서도 뺀다 */
  const mySlips = useMemo(() => view?.mySlips ?? [], [view?.mySlips])
  const toggleSlip = (id: string) => {
    dirty.current = true
    setSlipDraft((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  // 상대가 무언가 올리면 반짝인다. 「지금 바뀌었다」가 안 보이면 탁자를
  // 계속 노려보게 된다
  const [flash, setFlash] = useState(false)
  const theirLast = useRef(theirs)
  useEffect(() => {
    if (same(theirLast.current, theirs)) return
    theirLast.current = theirs
    setFlash(true)
    SFX.put()
    const t = setTimeout(() => setFlash(false), 420)
    return () => clearTimeout(t)
  }, [theirs])

  // 세는 소리. 3 · 2 · 1 로 한 번씩
  // 셋을 세는 판에 4가 뜨면 안 된다. 서버 시계와 내 시계가 몇 밀리초
  // 어긋난 것뿐인데, 올림하면 그 몇 밀리초가 한 칸이 된다
  const left = deal.settleAtMs === null ? null : Math.max(0, deal.settleAtMs - nowMs)
  const secs = left === null ? null : Math.min(DEAL_COUNTDOWN_MS / 1000, Math.ceil(left / 1000))
  const lastTick = useRef<number | null>(null)
  useEffect(() => {
    if (secs === null || secs <= 0) {
      lastTick.current = null
      return
    }
    if (lastTick.current !== secs) {
      lastTick.current = secs
      SFX.tick()
    }
  }, [secs])

  // 다 세면 성립시킨다. **둘 다 부른다** — 한쪽 화면이 잠들어 있어도
  // 탁자가 멈추면 안 된다. 서버가 한 번만 먹는다
  const asked = useRef(false)
  useEffect(() => {
    if (deal.status !== 'settling' || deal.settleAtMs === null) {
      asked.current = false
      return
    }
    if (nowMs < deal.settleAtMs || asked.current) return
    asked.current = true
    act.settleDeal(deal.id).catch((e) => onSaid((e as Error).message))
  }, [deal.status, deal.settleAtMs, deal.id, nowMs, act, onSaid])

  // 끝난 소리는 한 번만
  const rang = useRef<string | null>(null)
  useEffect(() => {
    if (deal.status !== 'done' && deal.status !== 'gone') return
    if (rang.current === deal.status) return
    rang.current = deal.status
    if (deal.status === 'done') SFX.done()
    else SFX.gone()
  }, [deal.status])

  const step = (key: string, by: number) => {
    dirty.current = true
    setDraft((cur) => ({ ...cur, [key]: Math.min(have[key], Math.max(0, cur[key] + by)) }))
  }
  const setTo = (key: string, n: number) => {
    dirty.current = true
    setDraft((cur) => ({ ...cur, [key]: Math.min(have[key], Math.max(0, n)) }))
  }

  const empty = stakeIsEmpty(deal.a.stake) && stakeIsEmpty(deal.b.stake)
  const over = deal.status === 'done' || deal.status === 'gone'

  if (over) {
    return (
      <div className="sc-dr is-over">
        <p className="sc-dr__end">
          {deal.status === 'done' ? '거래가 성립했다.' : (deal.why ?? '거래가 사라졌다.')}
        </p>
        {deal.status === 'done' && (
          <ul className="sc-dr__ledger">
            <li><span>받은 것</span><b>{pileText(theirs)}</b></li>
            <li><span>준 것</span><b>{pileText(pileOf(mySide.stake))}</b></li>
          </ul>
        )}
        <button className="sc-dr__go" onClick={onClose}>닫는다</button>
      </div>
    )
  }

  return (
    <div className="sc-dr">
      {/* ── 위: 상대가 올린 것 ────────────────────────────── */}
      <section className={'sc-dr__side' + (flash ? ' is-flash' : '')}>
        <header>
          <b>{otherName}</b>
          <span>{teamName(theirSide.team)}</span>
          <em className={theirSide.ready ? 'is-ready' : ''}>{theirSide.ready ? '준비됨' : '고르는 중'}</em>
        </header>
        <Slots
          pile={theirs}
          team={theirSide.team}
          lit={theirSide.ready}
          none="아직 아무것도 올리지 않았다."
        />
      </section>

      {/* ── 가운데: 오가는 방향과 세는 수 ─────────────────── */}
      <div className="sc-dr__mid">
        <span aria-hidden="true">↓</span>
        {secs !== null && secs > 0 ? (
          <b className="sc-dr__count">{secs}</b>
        ) : (
          <i>{empty ? '탁자가 비었다' : ''}</i>
        )}
        <span aria-hidden="true">↑</span>
      </div>

      {/* ── 아래: 내가 올린 것과 내 소지품 ────────────────── */}
      <section className="sc-dr__side is-mine">
        <header>
          <b>나</b>
          <span>{teamName(me.team)}</span>
          <em className={mySide.ready ? 'is-ready' : ''}>{mySide.ready ? '준비됨' : '고르는 중'}</em>
        </header>
        <Slots pile={{ ...draft, slips: slipDraft.length }} team={me.team} lit={mySide.ready} none="여기에 올린다." />

        <ul className="sc-dr__bag">
          {SLOTS.filter((s) => have[s.key] > 0).map((s) =>
            s.key === 'slips' ? (
              /* **쪽지는 한 장씩 고른다.** 저마다 다른 쪽지라 몇 장이 아니라 어느 것인지가 거래다 */
              <li key={s.key} className="sc-dr__slips">
                <span className="sc-dr__what">
                  <img src={s.icon()} alt="" width={24} height={24} />
                  {s.name}
                  <em>골라서 올린다 · {slipDraft.length}/{mySlips.length}</em>
                </span>
                <span className="sc-dr__picks">
                  {mySlips.map((sl, i) => {
                    const on = slipDraft.includes(sl.id)
                    return (
                      <button
                        key={sl.id}
                        className={'is-inline' + (on ? ' is-on' : '')}
                        aria-pressed={on}
                        onClick={() => toggleSlip(sl.id)}
                      >
                        {on ? '✓ ' : ''}
                        {slipLabel(sl, i)}
                      </button>
                    )
                  })}
                </span>
              </li>
            ) : (
            <li key={s.key}>
              <span className="sc-dr__what">
                <img src={s.icon()} alt="" width={24} height={24} />
                {s.name}
                <em>{s.from} · {have[s.key]}</em>
              </span>
              <span className="sc-dr__step">
                <button
                  className="is-inline"
                  disabled={draft[s.key] <= 0}
                  onClick={() => step(s.key, -1)}
                  aria-label={`${s.name} 하나 내린다`}
                >
                  −
                </button>
                <b>{draft[s.key]}</b>
                <button
                  className="is-inline"
                  disabled={draft[s.key] >= have[s.key]}
                  onClick={() => step(s.key, 1)}
                  aria-label={`${s.name} 하나 올린다`}
                >
                  ＋
                </button>
              </span>
              {/* 열 개 스무 개를 한 개씩 누르게 두지 않는다 */}
              {have[s.key] > 3 && (
                <input
                  className="sc-dr__slide"
                  type="range"
                  min={0}
                  max={have[s.key]}
                  value={draft[s.key]}
                  aria-label={`${s.name} 몇 개`}
                  onChange={(e) => setTo(s.key, Number(e.target.value))}
                />
              )}
            </li>
            ),
          )}
          {count(have) === 0 && <li className="sc-dr__none">내놓을 것이 없다.</li>}
        </ul>
      </section>


      <div className="sc-dr__foot">
        <button
          className={'sc-dr__go' + (mySide.ready ? ' is-on' : '')}
          disabled={empty}
          onClick={() => {
            const next = !mySide.ready
            if (next) SFX.ready()
            act.readyDeal(deal.id, next).catch((e) => onSaid((e as Error).message))
          }}
        >
          {mySide.ready ? '준비 취소' : '준비'}
        </button>
        <button
          className="sc-dr__out"
          onClick={() => {
            act.cancelDeal(deal.id).catch((e) => onSaid((e as Error).message))
            onClose()
          }}
        >
          나가기
        </button>
      </div>
    </div>
  )
}

/** 더미 하나를 사람이 읽는 말로. 빈 더미는 「없음」이다. */
function pileText(p: Pile): string {
  const parts = SLOTS.filter((s) => p[s.key] > 0).map((s) => `${s.name} ${p[s.key]}`)
  return parts.length > 0 ? parts.join(' · ') : '없음'
}

/** 올린 것을 칸으로 보여 준다. 빈 칸은 점선이다 — 더 올릴 자리가 있다는 뜻이다. */
function Slots({ pile, team, lit, none }: { pile: Pile; team: TeamId; lit: boolean; none: string }) {
  const put = SLOTS.filter((s) => pile[s.key] > 0)
  const blanks = Math.max(0, 4 - put.length)
  return (
    <ul
      className={'sc-dr__slots' + (lit ? ' is-ready' : '')}
      style={lit ? { borderColor: TEAM_COLOR[team] } : undefined}
    >
      {put.map((s) => (
        <li key={s.key} className="sc-dr__slot">
          <img src={s.icon()} alt="" width={24} height={24} />
          <span>{s.name}</span>
          <b>{pile[s.key]}</b>
        </li>
      ))}
      {Array.from({ length: blanks }, (_, i) => (
        <li key={`blank${i}`} className="sc-dr__slot is-blank" aria-hidden="true" />
      ))}
      {put.length === 0 && <li className="sc-dr__none">{none}</li>}
    </ul>
  )
}
