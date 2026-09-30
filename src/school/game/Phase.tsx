// 점령전 한 페이즈.
//
// **한 시간짜리 라이브 판이다.** 열려 있는 동안 토큰만큼 움직이고
// 행동한다. 움직이는 것은 맵에서 걸어서 하고, 여기 있는 것은 그 자리에서
// 쓰는 행동들이다. 누르면 바로 일어난다 — 기다렸다 한꺼번에 까는
// 것이 아니다.
//
// 안 되는 행동은 감추지 않고 **이유를 적어 둔 채로** 보인다. 감추면
// 왜 없는지 알 수 없고, 이유 없이 막으면 왜 안 되는지 알 수 없다.
import { useEffect, useRef, useState } from 'react'

import type { DevClock } from '../../../shared/rules/clock'
import { useGameNow } from './Shell'

import {
  ACT_COST,
  ACT_MINUTES,
  MAX_CARRIED_ROBOTS,
  ROOM_KIND,
  researchKnowledge,
} from '../../../shared/rules/occupy'
import { TILE_BY_ID, roomOfCell, type Cell } from '../../../shared/rules/board'
import { canHoldFlags } from '../../../shared/rules/flag'
import { TEAM_COLOR } from './MapPlan'
import { atLabMachine } from '../../../shared/rules/trap'
import { ITEMS, ITEM_FOR } from '../../../shared/rules/items'
import type { ActionKind } from '../../../shared/rules/occupy'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import type { TeamId, TileId } from '../types'
import { uiIcon } from './uiArt'
import { Cost } from './Cost'
import { Sure } from './Sheet'
import { buzz } from './Controls'
import { teamName, teamNo } from '../../../shared/rules/bundan'

/** 규칙 쪽 TileId 는 string, 지도 쪽은 스물다섯 개 유니온이다. 경계를 여기 모은다. */
const asRoom = (id: string): TileId => id as TileId

export interface PhaseProps {
  me: SeatEntry
  /** 지금 서 있는 방. 페이즈 중에는 이것이 곧 전선이다. */
  here: string | null
  seats: readonly SeatEntry[]
  view: PlayerViewDoc | null
  /** 방 주인. 연구실을 쥐었는지 보려고 받는다 — 주인은 어차피 공개다. */
  tiles: Partial<Record<string, { ownerTeam: TeamId | null }>>
  /** 페이즈가 끝나는 게임 시각. */
  endsAtMs: number | null
  /** 게임 속 지금. **실제 시각이 아니다** — 판마다 시계가 따로 돈다. */
  nowMs: number
  act: GameActions
  onSaid: (text: string) => void
  /** 내가 선 칸. 연구는 연구 기계 옆에서만 — 서버도 같은 자로 잰다 */
  myCell?: Cell | null
  /**
   * 이 줄로 굴러가서 테를 두른다. 연구 기계를 짚고 「연구하기」를 누르면
   * 깃발 줄 넷을 지나 연구까지 손으로 내려가야 했다
   */
  focus?: ActionKind | null
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
}

const LABEL: Record<ActionKind, string> = {
  move: '이동',
  research: '연구',
  summon: '호출',
  plant: '깃발 꽂기',
  pull: '깃발 뽑기',
  dropRobot: '로봇 놓기',
  takeRobot: '로봇 수거',
  smashRobot: '로봇 부수기',
}

/**
 * 무엇을 하는 일인가. **드는 값은 여기 안 적는다** — 이름 옆 그림이
 * 이미 말한다(Bill). 글로도 적으면 같은 수가 한 줄에 두 번 나온다.
 */
const WHAT: Record<ActionKind, string> = {
  move: '맵에서 걸어서 간다. 복도와 계단은 값이 없다.',
  research: '20 분 뒤 이 방에 완성품이 놓인다. 이 페이즈 동안은 나만 가져간다.',
  summon: '호루라기를 불어 같은 분단 한 명을 한 칸 끌어온다. 둘 다 못 움직인다.',
  plant: '이 방에 우리 분단 깃발을 꽂는다. 페이즈가 끝나면 사라진다.',
  pull: '다른 분단 깃발에 손을 댄다. 서로 다른 두 사람이 손대야 하나가 뽑힌다.',
  dropRobot: '들고 있는 로봇 1 기를 이 방에 놓는다. 놓아야 깃발 하나로 센다.',
  takeRobot: '내가 놓은 로봇 1 기를 도로 든다. 든 로봇은 판정에 안 든다.',
  smashRobot: '드라이버로 이 방에 놓인 상대 로봇 1 기를 분해한다.',
}

/** 그 자리에서 쓰는 것들. 이동은 여기 없다 — 맵에서 걸어서 한다. */
const KINDS: ActionKind[] = ['plant', 'pull', 'summon', 'research', 'dropRobot', 'takeRobot', 'smashRobot']

/**
 * 한 행동에 드는 것 전부 — 토큰 · 지식 · 시간 · 물건.
 *
 * **0인 것은 안 그린다.** 「토큰 0」이 붙어 있으면 값이 드는 것처럼
 * 보인다. 깃발 꽂기는 토큰이 아니라 팀 깃발이 드는 행동이라 그 줄에는
 * 깃발 그림만 선다.
 */
function Bill({ kind, ownsLab }: { kind: ActionKind; ownsLab: boolean }) {
  const item = ITEM_FOR[kind]
  return (
    <span className="sc-ph__bill">
      {ACT_COST[kind] > 0 && <Cost of="token" n={ACT_COST[kind]} />}
      {kind === 'research' && <Cost of="knowledge" n={researchKnowledge(ownsLab)} />}
      {kind === 'plant' && <Cost of="flag" n={1} />}
      {ACT_MINUTES[kind] > 0 && <Cost of="clock" n={ACT_MINUTES[kind]} />}
      {item && <Cost of={item} n={1} />}
    </span>
  )
}

/** 남은 시간을 분·초로. 초까지 보여야 마지막 한 칸을 갈지 말지 정한다. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Phase({ me, here: hereIn, seats, view, tiles, endsAtMs, nowMs: now, act, onSaid, myCell = null, focus = null }: PhaseProps) {
  const focusRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focus])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<ActionKind | null>(null)

  const here: TileId | null = hereIn ? asRoom(hereIn) : null
  const hereName = here ? TILE_BY_ID[here].name : '걷는 중'
  /** 지금 선 연구실을 누가 쥐고 있는가. 값이 여기서 갈린다. */
  const labOwner = here && ROOM_KIND[here] === 'lab' ? (tiles[here]?.ownerTeam ?? null) : null
  const ownsLab = labOwner === me.team
  const tokens = view?.myTeamTokens ?? 0
  const robots = view?.visibleRobots ?? []
  const overAt = endsAtMs != null && now >= endsAtMs

  const teammates = seats.filter((s) => s.playerId !== me.playerId && s.team === me.team)
  const enemyRobotsHere = robots.filter((r) => asRoom(r.tileId) === here && r.team !== me.team)
  /** 이 방에 꽂힌 깃발 — 팀마다. 들어와 있는 방이라 서버가 보내 준다 */
  const flagsHere = (here ? view?.flagCounts?.[here] : undefined) ?? {}
  const flagRows = (Object.entries(flagsHere) as [TeamId, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  // 우리 분단 깃발도 뽑을 수 있다 — 몰래 하는 배신이다. 누가 뽑았는지는 끝나도 안 나온다
  const pullable = flagRows
  const teamFlags = view?.myTeamFlags ?? 0
  /** 이 방에 놓인 로봇 수 — 한도(ROBOTS_PER_ROOM)는 놓인 것만 먹는다 */
  const placedHere = robots.filter((r) => asRoom(r.tileId) === here).length
  /** 내가 놓아서 도로 거둘 수 있는 것 */
  const mineHere = robots.filter((r) => asRoom(r.tileId) === here && r.mine)
  const carried = view?.myCarriedRobots ?? 0

  /**
   * 왜 안 되는가. **null 이면 된다.**
   *
   * 화면이 규칙을 새로 쓰는 것이 아니다 — 서버가 볼 것과 같은 것을
   * 미리 보여 줄 뿐이고, 어긋나면 서버가 거절하고 그 말이 뜬다.
   */
  function why(kind: ActionKind): string | null {
    if (overAt) return '이 페이즈는 시간이 끝났다.'
    // 하던 일이 안 끝났으면 아무것도 못 한다. 서버도 같은 말로 거절한다
    const busyLeft = (view?.myBusyUntilMs ?? 0) - now
    if (busyLeft > 0) return `${view?.myBusyKind ?? '하는'} 중이다. ${leftText(busyLeft)} 남았다.`
    if (!here) return '걷는 중이다.'
    // 복도로 나와 있으면 방의 일은 못 한다. 서버도 서 있는 칸으로 본다
    if (kind !== 'research' && myCell && roomOfCell(myCell.x, myCell.y) !== here) return '방 안에 들어가 있어야 한다.'
    // 얼마가 드는지는 이름 옆 그림이 말한다. 여기서는 모자란다는 것만
    if (tokens < ACT_COST[kind]) return '분단 토큰이 모자란다.'
    // 물건이 드는 행동은 물건이 먼저다. 없으면 자판기에 가야 한다
    const need = ITEM_FOR[kind]
    if (need && (view?.myItems?.[need] ?? 0) <= 0) return '없다. 자판기에서 산다.'
    if (kind === 'research') {
      if (ROOM_KIND[here] !== 'lab') return '연구실에서만 할 수 있다.'
      if (!atLabMachine(myCell)) return '연구 기계 옆에 서야 한다.'
      // 지식은 팀이 함께 번다. 모자라면 토큰이 있어도 못 건다
      if ((view?.teamVault?.knowledge ?? 0) < researchKnowledge(ownsLab)) return '지식이 모자란다.'
    }
    if (kind === 'summon' && teammates.length === 0) return '부를 같은 분단 사람이 없다.'
    if (kind === 'plant') {
      if (!canHoldFlags(here)) return `${hereName}에는 깃발을 못 꽂는다.`
      if (teamFlags <= 0) return '분단 깃발이 없다. 페이즈마다 새로 채워지고, 자판기에서도 산다.'
    }
    if (kind === 'pull') {
      // 서로 다른 두 사람이 손대야 뽑힌다 — 이미 내가 손댔는지는 화면이
      // 모른다(누가 손댔는지는 안 실린다). 두 번째로 손댔으면 서버가 거절한다
      if (pullable.length === 0) return '이 방에 뽑을 깃발이 없다.'
    }
    // 이 방에 놓인 우리 로봇이 아니라 **들고 있는 것**을 본다
    if (kind === 'dropRobot') {
      if (carried === 0) return '들고 있는 로봇이 없다.'
      if (!canHoldFlags(here)) return `${hereName}에는 로봇을 못 놓는다.`
    }
    // 거두는 것은 **놓은 사람만.** 같은 팀이 놓은 것도 못 거둔다
    if (kind === 'takeRobot') {
      if (mineHere.length === 0) return '이 방에 내가 놓은 로봇이 없다.'
      if (carried >= MAX_CARRIED_ROBOTS) return `로봇은 ${MAX_CARRIED_ROBOTS} 기까지 든다.`
    }
    if (kind === 'smashRobot') {
      if (enemyRobotsHere.length === 0) return '이 방에 놓인 상대 로봇이 없다.'
      // 상대가 보고 있어도 부순다. 대신 한 사람 한 페이즈에 한 기다
    }
    return null
  }

  async function send(kind: ActionKind, t: { targetPlayer?: string; targetRobot?: string; targetTeam?: TeamId } = {}) {
    setBusy(true)
    try {
      const out = (await act.phaseAct(kind, t)) as { tokens?: number }
      setOpen(null)
      buzz('ok')
      onSaid(
        kind === 'plant' ? `${hereName}에 깃발을 꽂았다.`
        : kind === 'pull' ? `${hereName}에서 ${teamName(t.targetTeam ?? '')} 깃발에 손을 댔다.`
        : kind === 'dropRobot' ? `${hereName}에 로봇을 놓았다.`
        : kind === 'takeRobot' ? `${hereName}에서 로봇을 거뒀다.`
        : `${LABEL[kind]}. 분단 토큰 ${out.tokens ?? '?'} 개 남았다.`,
      )
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ph">
      <h2>
        점령전 <span>{hereName}</span>
      </h2>

      <p className="sc-ph__purse">
        <strong>
          <Cost of="token" n={tokens} />
          <Cost of="flag" n={teamFlags} />
        </strong>
        {endsAtMs != null && (
          <em>{overAt ? '시간 끝' : <Cost of="clock" n={leftText(endsAtMs - now)} />}</em>
        )}
      </p>
      {/*
        이 방의 깃발. **주인을 정하는 수다** — 페이즈가 끝날 때 이것과
        로봇을 세서 가장 많은 팀이 가진다. 안 보이면 아직 아무도 안 꽂았다.
      */}
      {here && canHoldFlags(here) && (
        <p className="sc-ph__flags" aria-label="이 방의 깃발">
          <span>이 방 깃발</span>
          {flagRows.length === 0 ? (
            <em>아직 없다</em>
          ) : (
            flagRows.map(([t, n]) => (
              <b key={t} className={t === me.team ? 'is-mine' : ''}>
                <i style={{ background: TEAM_COLOR[t] }} />
                {teamNo(t)} {n}
              </b>
            ))
          )}
        </p>
      )}
      <ul className="sc-ph__list">
        {KINDS.map((k) => {
          const no = why(k)
          // 뽑기는 고를 팀이 둘 이상이거나 우리 분단 깃발이 끼면 펼친다 — 제 깃발을 한 번에 잘못 뽑지 않게
          const picking = k === 'pull' && (pullable.length > 1 || pullable.some(([t]) => t === me.team))
          // 놓기·거두기는 고를 것이 없다 — 든 것도 내가 놓은 것도 서로 똑같다
          const fold = k === 'summon' || picking || k === 'smashRobot'
          return (
            <li key={k} ref={k === focus ? focusRef : undefined} className={k === focus ? 'is-focus' : undefined}>
              <button
                disabled={busy || no !== null}
                onClick={() =>
                  fold ? setOpen(open === k ? null : k)
                  : k === 'pull' ? void send(k, { targetTeam: pullable[0]?.[0] })
                  : void send(k)
                }
              >
                <img className="sc-ph__art" src={uiIcon(k)} alt="" width={32} height={32} />
                <span className="sc-ph__say">
                  <strong>
                    {LABEL[k]} <Bill kind={k} ownsLab={ownsLab} />
                  </strong>
                  <em>{no ?? WHAT[k]}</em>
                </span>
              </button>

              {open === k && k === 'summon' && (
                <div className="sc-ph__targets">
                  {teammates.map((s) => (
                    <button key={s.playerId} disabled={busy} onClick={() => void send('summon', { targetPlayer: s.playerId })}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              {open === k && k === 'pull' && (
                <div className="sc-ph__targets">
                  {pullable.map(([t, n]) => (
                    <button key={t} disabled={busy} onClick={() => void send(k, { targetTeam: t })}>
                      {t === me.team ? '우리 분단' : teamName(t)} 깃발 <em>{n}</em>
                    </button>
                  ))}
                </div>
              )}

              {open === k && k === 'smashRobot' && (
                <div className="sc-ph__targets">
                  {/* 부순 로봇은 돌아오지 않는다. 한 번 더 누르게 한다 */}
                  {enemyRobotsHere.map((r) => (
                    <Sure key={r.id} disabled={busy} warn="되돌릴 수 없다." onGo={() => void send(k, { targetRobot: r.id })}>
                      로봇 <em>{teamName(r.team)}</em>
                    </Sure>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/*
        내가 가진 것 — 지식과 물건 일곱. **드는 값은 위 행동 줄이 이미
        그렸다.** 여기는 있는 것만 센다. 이름을 다 적으면 두 줄이 넘어서
        그림과 수만 두고, 없는 것은 자리만 남기고 물러난다.
      */}
      <p className="sc-ph__note sc-ph__bag">
        <Cost of="knowledge" n={view?.teamVault?.knowledge ?? 0} />
        <span className="sc-ph__bagCut" aria-hidden />
        {ITEMS.map((i) => {
          const n = view?.myItems?.[i.kind] ?? 0
          return <Cost key={i.kind} of={i.kind} n={n} dim={n === 0} />
        })}
      </p>
      <p className="sc-ph__note">
        우리 분단 로봇 <b>{view?.myTeamRobots ?? 0}</b> · 들고 있는 것{' '}
        <b>{carried}/{MAX_CARRIED_ROBOTS}</b> · 이 방에 놓인 것 <b>{placedHere}</b>
      </p>
    </div>
  )
}

const nameOf = (seats: readonly SeatEntry[], id: string) => seats.find((s) => s.playerId === id)?.name ?? '누군가'

// ── 운영자 ──────────────────────────────────────────────────────

export function PhaseHost({
  open,
  no,
  endsAtMs,
  act,
  onSaid,
  clock,
}: {
  open: boolean
  no: number
  endsAtMs: number | null
  act: GameActions
  onSaid: (t: string) => void
  /** 판의 시계. 없으면 실제 시각 */
  clock?: DevClock
}) {
  const [busy, setBusy] = useState(false)
  // 판의 시계로 센다. 기기 시계로 세면 배속을 건 판에서 남은 시간이 안 맞는다
  const now = useGameNow(clock)
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      buzz('ok')
      onSaid(`${label} 했다.`)
    } catch (e) {
      buzz('no')
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sc-pl__hosttools">
      <span>페이즈 {no}</span>
      {open ? (
        <>
          {/* 몇 명이 무엇을 했는지는 운영자에게도 안 나간다. 시계만 본다 */}
          <span className="sc-ph__count">
            {endsAtMs == null ? '진행 중' : now >= endsAtMs ? '시간 끝' : `${leftText(endsAtMs - now)} 남았다`}
          </span>
          <button disabled={busy} onClick={() => void run('닫기', () => act.closePhase())}>
            닫고 처리
          </button>
        </>
      ) : (
        <button disabled={busy} onClick={() => void run('열기', () => act.openPhase())}>
          페이즈 열기
        </button>
      )}
    </div>
  )
}

// ── 지난 페이즈에 있었던 일 ─────────────────────────────────────

const SAYS: Record<string, (l: Line, seats: readonly SeatEntry[]) => string> = {
  moved: (l, s) => `${who(l, s)}이(가) ${room(l)}(으)로 갔다.`,
  moveBlocked: (l, s) => `${who(l, s)}은(는) ${room(l)}에 못 들어갔다 — ${l.why ?? ''}`,
  summoned: (l, s) => `${who(l, s)}이(가) ${nameOf(s, l.targetPlayer ?? '')}을(를) 불렀다.`,
  summonFailed: (l, s) => `${who(l, s)}의 호출이 불발됐다 — ${l.why ?? ''}`,
  flagPlanted: (l, s) => `${who(l, s)}이(가) ${room(l)}에 ${teamName(l.team)} 깃발을 꽂았다.`,
  flagPulled: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 ${teamName(l.team)} 깃발을 뽑았다.`,
  robotLeft: (l, s) => `${who(l, s)}이(가) ${room(l)}에 로봇을 두고 갔다.`,
  robotSmashed: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 로봇을 부쉈다.`,
  smashFailed: (l, s) => `${who(l, s)}이(가) 로봇을 못 부쉈다 — ${l.why ?? ''}`,
  researchStarted: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 연구를 걸었다.`,
  researchDone: (l, s) => `${who(l, s)}에게 로봇 1 기가 붙었다.`,
  researchFailed: (l, s) => `${who(l, s)}의 연구가 안 됐다 — ${l.why ?? ''}`,
  captured: (l) => `${room(l)}이(가) ${teamName(l.team)} 것이 됐다.`,
  held: (l) => `${room(l)}은(는) 그대로다.`,
}

interface Line {
  kind: string
  playerId?: string
  tileId?: string
  team?: TeamId
  targetPlayer?: string
  targetRobot?: string
  why?: string
}

const who = (l: Line, seats: readonly SeatEntry[]) => nameOf(seats, l.playerId ?? '')
const room = (l: Line) => (l.tileId ? (TILE_BY_ID[l.tileId]?.name ?? l.tileId) : '어딘가')

export function PhaseLog({
  rows,
  seats,
}: {
  rows: readonly { no: number; day: number; lines: Line[] }[]
  seats: readonly SeatEntry[]
}) {
  const last = rows[rows.length - 1]
  if (!last) return null
  // **누가 무엇을 했는지는 안 보인다.** 방이 어느 분단 것이 됐는지만 — 옛 기록에 사람 줄이 있어도 거른다
  const lines = last.lines.filter((l) => l.kind === 'captured')
  return (
    <div className="sc-ph__log">
      <h2>
        지난 페이즈 <span>{last.no} 번</span>
      </h2>
      <ul>
        {lines.length === 0 && <li>주인이 바뀐 방이 없다.</li>}
        {lines.map((l, i) => (
          <li key={i} className="is-big">
            {(SAYS[l.kind] ?? (() => l.kind))(l, seats)}
          </li>
        ))}
      </ul>
    </div>
  )
}
