// 점령전 한 페이즈.
//
// **한 시간짜리 라이브 판이다.** 열려 있는 동안 토큰만큼 움직이고
// 행동한다. 움직이는 것은 맵에서 걸어서 하고, 여기 있는 것은 그 자리에서
// 쓰는 행동들이다. 누르면 바로 일어난다 — 기다렸다 한꺼번에 까는
// 것이 아니다.
//
// 안 되는 행동은 감추지 않고 **이유를 적어 둔 채로** 보인다. 감추면
// 왜 없는지 알 수 없고, 이유 없이 막으면 왜 안 되는지 알 수 없다.
import { useEffect, useState } from 'react'

import {
  ACT_COST,
  ACT_MINUTES,
  ENTER_MINUTES,
  EXIT_MINUTES,
  MAX_CARRIED_ROBOTS,
  ROBOTS_PER_ROOM,
  ROBOTS_PER_TEAM,
  ROOM_KIND,
  SMASHES_PER_PHASE,
  researchKnowledge,
  leftBehindCount,
} from '../../../shared/rules/occupy'
import { ROAM_TO, TILE_BY_ID, TILES } from '../../../shared/rules/board'
import { ITEMS, ITEM_BY_KIND, ITEM_FOR } from '../../../shared/rules/items'
import type { ActionKind } from '../../../shared/rules/occupy'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import type { TeamId, TileId } from '../types'
import { uiIcon } from './uiArt'

/** 규칙 쪽 TileId 는 string, 지도 쪽은 스물다섯 개 유니온이다. 경계를 여기 모은다. */
const asRoom = (id: string): TileId => id as TileId

export interface PhaseProps {
  me: SeatEntry
  /** 지금 서 있는 방. 페이즈 중에는 이것이 곧 전선이다. */
  here: string | null
  seats: readonly SeatEntry[]
  view: PlayerViewDoc | null
  /** 방 주인. 발전소를 쥐었는지 보려고 받는다 — 주인은 어차피 공개다. */
  tiles: Partial<Record<string, { ownerTeam: TeamId | null }>>
  /** 페이즈가 끝나는 게임 시각. */
  endsAtMs: number | null
  /** 게임 속 지금. **실제 시각이 아니다** — 판마다 시계가 따로 돈다. */
  nowMs: number
  act: GameActions
  onSaid: (text: string) => void
  /** 되돌릴 수 없는 것은 한 번 묻는다. */
  ask: (text: string) => Promise<boolean>
}

const LABEL: Record<ActionKind, string> = {
  move: '이동',
  research: '연구',
  summon: '호출',
  disturb: '방해',
  disguise: '위장',
  dropRobot: '로봇 두고 가기',
  smashRobot: '로봇 부수기',
}

const WHAT: Record<ActionKind, string> = {
  move: `학교 안 어느 방이든. 맵에서 걸어서 가고 ${EXIT_MINUTES + ENTER_MINUTES}분 걸린다. 계단은 문이라 값이 없다.`,
  research: `연구실에서만. ${ACT_MINUTES.research}분 뒤에 이 방에 완성품이 놓인다 — 그때 여기 서 있어야 받는다. 발전소를 쥐었으면 바로 나온다.`,
  summon: `같은 팀 한 명을 내 쪽으로 한 칸 끌어온다. ${ACT_MINUTES.summon}분 — 부른 쪽도 불린 쪽도 그동안 못 움직인다.`,
  disturb: `${ITEM_BY_KIND.whistle.name} 하나. 같은 방 상대 하나를 이번 판정에서 0명으로 만든다.`,
  disguise: `${ITEM_BY_KIND.nameTag.name} 하나. 다른 팀에게 내 인원수가 2명으로 보인다.`,
  dropRobot: '로봇 1기를 이 방에 남긴다. 그 자리에서 계속 1명으로 센다.',
  smashRobot: '상대 로봇 1기를 부순다.',
}

/** 그 자리에서 쓰는 것들. 이동은 여기 없다 — 맵에서 걸어서 한다. */
const KINDS: ActionKind[] = ['research', 'summon', 'disturb', 'disguise', 'dropRobot', 'smashRobot']

/** 남은 시간을 분·초로. 초까지 보여야 마지막 한 칸을 갈지 말지 정한다. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Phase({ me, here: hereIn, seats, view, tiles, endsAtMs, nowMs: now, act, onSaid, ask }: PhaseProps) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<ActionKind | null>(null)

  const here: TileId | null = hereIn ? asRoom(hereIn) : null
  const hereName = here ? TILE_BY_ID[here].name : '걷는 중'
  // 발전소를 쥐면 연구한 로봇이 그 자리에서 바로 나온다.
  // 방 주인은 누구나 보이는 값이라 화면이 직접 세도 새는 것이 없다
  const hasPlant = TILES.some((t) => ROOM_KIND[t.id] === 'plant' && tiles[t.id]?.ownerTeam === me.team)
  /** 지금 선 연구실을 누가 쥐고 있는가. 값이 여기서 갈린다. */
  const labOwner = here && ROOM_KIND[here] === 'lab' ? (tiles[here]?.ownerTeam ?? null) : null
  const ownsLab = labOwner === me.team
  const tokens = view?.myTeamTokens ?? 0
  const pawns = view?.visiblePawns ?? []
  const robots = view?.visibleRobots ?? []
  const overAt = endsAtMs != null && now >= endsAtMs

  // 같은 방 사람들
  const withMe = pawns.filter((p) => p.playerId !== me.playerId && p.tileId !== null && asRoom(p.tileId) === here)
  const enemiesHere = withMe.filter((p) => p.team !== me.team)
  const teammates = seats.filter((s) => s.playerId !== me.playerId && s.team === me.team)
  const enemyRobotsHere = robots.filter((r) => asRoom(r.tileId) === here && r.team !== me.team)
  const myRobots = robots.filter((r) => asRoom(r.tileId) === here && r.team === me.team)

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
    if (!here) return '걷는 중이다. 도착해야 할 수 있다.'
    if (tokens < ACT_COST[kind]) return `팀 토큰이 모자란다. ${ACT_COST[kind]}개가 든다.`
    // 물건이 드는 행동은 물건이 먼저다. 없으면 상점에 가야 한다
    const need = ITEM_FOR[kind]
    if (need && (view?.myItems?.[need] ?? 0) <= 0) {
      return `${ITEM_BY_KIND[need].name}이(가) 없다. 자판기에서 산다.`
    }
    if (kind === 'research') {
      if (ROOM_KIND[here] !== 'lab') return '연구실에서만 할 수 있다.'
      // 지식은 팀이 함께 번다. 모자라면 토큰이 있어도 못 건다
      const need = researchKnowledge(ownsLab)
      if ((view?.myVault?.knowledge ?? 0) < need) return `지식이 모자란다. ${need}점이 든다.`
      if ((view?.myTeamRobots ?? 0) >= ROBOTS_PER_TEAM) return `로봇은 팀당 ${ROBOTS_PER_TEAM}기까지다.`
    }
    if (kind === 'summon' && teammates.length === 0) return '부를 팀원이 없다.'
    if (kind === 'disturb' && enemiesHere.length === 0 && enemyRobotsHere.length === 0) {
      return '이 방에 상대가 없다.'
    }
    if (kind === 'dropRobot' && myRobots.length === 0) return '데리고 있는 로봇이 없다.'
    if (kind === 'smashRobot') {
      if (enemyRobotsHere.length === 0) return '이 방에 상대 로봇이 없다.'
      // 상대가 보고 있어도 부순다. 대신 한 사람 한 페이즈에 한 기다
      if ((view?.mySmashes ?? 0) >= SMASHES_PER_PHASE) return '이번 페이즈에는 이미 부쉈다.'
    }
    return null
  }

  async function send(kind: ActionKind, t: { targetPlayer?: string; targetRobot?: string } = {}) {
    // 부순 로봇은 돌아오지 않는다. 손가락이 스친 것만으로 일어나면 안 된다
    if (kind === 'smashRobot' && !(await ask('로봇을 부순다. 되돌릴 수 없다.'))) return
    setBusy(true)
    try {
      const out = (await act.phaseAct(kind, t)) as { tokens?: number }
      setOpen(null)
      onSaid(`${LABEL[kind]}. 팀 토큰 ${out.tokens ?? '?'}개 남았다.`)
    } catch (e) {
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
        <strong>팀 토큰 {tokens}</strong>
        {endsAtMs != null && <em>{overAt ? '시간 끝' : `${leftText(endsAtMs - now)} 남았다`}</em>}
      </p>
      <p className="sc-ph__hint">
        <b>토큰은 넷이 한 주머니를 나눠 쓴다.</b> 먼저 쓰는 사람이 임자라, 누가 몇 번 움직일지를 말로
        정하지 않으면 마지막 사람은 아무것도 못 한다.{' '}
        <b>방에</b> 들어설 때만 토큰 {ACT_COST.move}개와 {EXIT_MINUTES + ENTER_MINUTES}분이 든다. 나가는 것도
        복도도 계단도 값이 없으니, 지하든 옥상이든 어디로 가도 토큰 하나에 {EXIT_MINUTES + ENTER_MINUTES}분이다.
        들어가는 동안은 어느 방에도 없다 — 닫히는 순간 <b>서 있는 방</b>의 머릿수로 주인이 정해진다.
      </p>

      <ul className="sc-ph__list">
        {KINDS.map((k) => {
          const no = why(k)
          const fold = k === 'summon' || k === 'disturb' || k === 'dropRobot' || k === 'smashRobot'
          return (
            <li key={k}>
              <button
                disabled={busy || no !== null}
                onClick={() => (fold ? setOpen(open === k ? null : k) : void send(k))}
              >
                <img className="sc-ph__art" src={uiIcon(k)} alt="" width={32} height={32} />
                <span className="sc-ph__say">
                  <strong>
                    {LABEL[k]} <i>{ACT_COST[k]}</i>
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

              {open === k && k === 'disturb' && (
                <div className="sc-ph__targets">
                  {enemiesHere.map((p) => (
                    <button key={p.playerId} disabled={busy} onClick={() => void send('disturb', { targetPlayer: p.playerId })}>
                      {nameOf(seats, p.playerId)} <em>{p.team}</em>
                    </button>
                  ))}
                  {enemyRobotsHere.map((r) => (
                    <button key={r.id} disabled={busy} onClick={() => void send('disturb', { targetRobot: r.id })}>
                      로봇 <em>{r.team}</em>
                    </button>
                  ))}
                </div>
              )}

              {open === k && (k === 'dropRobot' || k === 'smashRobot') && (
                <div className="sc-ph__targets">
                  {(k === 'dropRobot' ? myRobots : enemyRobotsHere).map((r) => (
                    <button key={r.id} disabled={busy} onClick={() => void send(k, { targetRobot: r.id })}>
                      로봇 <em>{r.team}</em>
                    </button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="sc-ph__note">
        연구 한 번에 토큰 {ACT_COST.research} · 지식 <b>{researchKnowledge(ownsLab)}</b>
        {ownsLab ?
          ' (우리 연구실이라 한 점)'
        : labOwner ?
          ` (${labOwner}팀 연구실이다 — 우리 것이 아니라 한 점 더 든다)`
        : ''}
        {' · '}내 지식 {view?.myVault?.knowledge ?? 0}
      </p>
      <p className="sc-ph__note">
        가진 물건{' '}
        {ITEMS.map((i) => `${i.name} ${view?.myItems?.[i.kind] ?? 0}`).join(' · ')}
      </p>
      <p className="sc-ph__note">
        우리 팀 로봇 <b>{view?.myTeamRobots ?? 0}/{ROBOTS_PER_TEAM}</b>
        {hasPlant && ' · 발전소를 쥐어 그 자리에서 바로 난다'}
        {' · '}데리고 있는 것 {view?.myCarriedRobots ?? 0}기(최대 {MAX_CARRIED_ROBOTS})
        {' · '}한 방에 {ROBOTS_PER_ROOM}기까지
      </p>
      {here && (
        <p className="sc-ph__note">
          갈 수 있는 곳:{' '}
          {(ROAM_TO[here] ?? []).map((n, i) => {
            // **옮기기 전에 알려 준다.** 저쪽에 로봇 자리가 모자라면
            // 사람은 가고 넘치는 로봇만 이 방에 남는다
            const seen = view?.robotCounts?.[asRoom(n)]
            const drop = seen === undefined ? 0 : leftBehindCount(view?.myCarriedRobots ?? 0, seen)
            return (
              <span key={n}>
                {i > 0 && ' · '}
                {TILE_BY_ID[n].name}
                {drop > 0 && <em className="sc-ph__warn"> 로봇 {drop}기를 두고 간다</em>}
              </span>
            )
          })}
        </p>
      )}
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
}: {
  open: boolean
  no: number
  endsAtMs: number | null
  act: GameActions
  onSaid: (t: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(`${label} 했다.`)
    } catch (e) {
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
  disturbed: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 누군가를 붙잡았다.`,
  disturbFailed: (l, s) => `${who(l, s)}의 방해가 빗나갔다 — ${l.why ?? ''}`,
  disguised: (l, s) => `${who(l, s)}이(가) 수를 부풀렸다.`,
  robotLeft: (l, s) => `${who(l, s)}이(가) ${room(l)}에 로봇을 두고 갔다.`,
  robotSmashed: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 로봇을 부쉈다.`,
  smashFailed: (l, s) => `${who(l, s)}이(가) 로봇을 못 부쉈다 — ${l.why ?? ''}`,
  researchStarted: (l, s) => `${who(l, s)}이(가) ${room(l)}에서 연구를 걸었다.`,
  researchDone: (l, s) => `${who(l, s)}에게 로봇 1기가 붙었다.`,
  researchFailed: (l, s) => `${who(l, s)}의 연구가 안 됐다 — ${l.why ?? ''}`,
  captured: (l) => `${room(l)}이(가) ${l.team}팀 것이 됐다.`,
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
  return (
    <div className="sc-ph__log">
      <h2>
        지난 페이즈 <span>{last.no}번</span>
      </h2>
      <ul>
        {last.lines.map((l, i) => (
          <li key={i} className={l.kind === 'captured' ? 'is-big' : ''}>
            {(SAYS[l.kind] ?? (() => l.kind))(l, seats)}
          </li>
        ))}
      </ul>
    </div>
  )
}
