// 점령전 한 페이즈.
//
// 페이즈가 열리면 모두 제자리로 돌아와 **행동 하나**를 고른다. 남이
// 무엇을 골랐는지는 보이지 않는다 — 그래서 고르는 순간에는 늘 반쯤
// 눈을 감고 있다.
//
// 안 되는 행동은 감추지 않고 **이유를 적어 둔 채로** 보인다. 감추면
// 왜 없는지 알 수 없고, 이유 없이 막으면 왜 안 되는지 알 수 없다.
import { useState } from 'react'

import { MAX_CARRIED_ROBOTS, ROOM_KIND, capacityOf } from '../../../shared/rules/occupy'
import { ADJACENCY, TILE_BY_ID } from '../../../shared/rules/board'
import type { ActionKind } from '../../../shared/rules/occupy'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import type { TeamId, TileId } from '../types'

/** 규칙 쪽 TileId 는 string, 지도 쪽은 스물다섯 개 유니온이다. 경계를 여기 모은다. */
const asRoom = (id: string): TileId => id as TileId

export interface PhaseProps {
  me: SeatEntry
  /** 내 전투 자리. 페이즈 중에는 여기 서 있다. */
  postTile: string | null
  seats: readonly SeatEntry[]
  view: PlayerViewDoc | null
  /** 이미 낸 행동. 닫히기 전까지는 바꿀 수 있다. */
  chosen: ActionKind | null
  onChosen: (kind: ActionKind) => void
  act: GameActions
  onSaid: (text: string) => void
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
  move: '옆방으로 한 칸. 데리고 있는 로봇도 같이 간다.',
  research: '이 페이즈를 쓴다. 다음 페이즈에 로봇 1기가 붙는다.',
  summon: '같은 팀 한 명을 내 쪽으로 한 칸 끌어온다.',
  disturb: '같은 방 상대 하나를 이번 판정에서 0명으로 만든다.',
  disguise: '다른 팀에게 내 인원수가 2명으로 보인다. 판정은 그대로다.',
  dropRobot: '로봇 1기를 이 방에 남긴다. 그 자리에서 계속 1명으로 센다.',
  smashRobot: '상대 로봇 1기를 부순다.',
}

export function Phase({ me, postTile, seats, view, chosen, onChosen, act, onSaid }: PhaseProps) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<ActionKind | null>(null)

  const here: TileId | null = postTile ? asRoom(postTile) : null
  const hereName = here ? TILE_BY_ID[here].name : '어딘가'
  const pawns = view?.visiblePawns ?? []
  const robots = view?.visibleRobots ?? []

  // 같은 방 사람들. 페이즈 중에는 다들 전투 자리에 서 있다
  const withMe = pawns.filter((p) => p.playerId !== me.playerId && p.tileId !== null && asRoom(p.tileId) === here)
  const enemiesHere = withMe.filter((p) => p.team !== me.team)
  const teammates = seats.filter((s) => s.playerId !== me.playerId && s.team === me.team)
  const enemyRobotsHere = robots.filter((r) => asRoom(r.tileId) === here && r.team !== me.team)
  const myRobots = robots.filter((r) => asRoom(r.tileId) === here && r.team === me.team)
  const neighbours = here ? (ADJACENCY[here] ?? []).map(asRoom) : []

  /**
   * 왜 안 되는가. **null 이면 된다.**
   *
   * 화면이 규칙을 새로 쓰는 것이 아니다 — 서버가 볼 것과 같은 것을
   * 미리 보여 줄 뿐이고, 어긋나면 서버가 거절하고 그 말이 뜬다.
   */
  function why(kind: ActionKind): string | null {
    if (!here) return '아직 자리가 정해지지 않았다.'
    if (kind === 'research' && ROOM_KIND[here] !== 'lab') return '연구실에서만 할 수 있다.'
    if (kind === 'summon' && teammates.length === 0) return '부를 팀원이 없다.'
    if (kind === 'disturb' && enemiesHere.length === 0 && enemyRobotsHere.length === 0) {
      return '이 방에 상대가 없다.'
    }
    if (kind === 'dropRobot' && myRobots.length === 0) return '데리고 있는 로봇이 없다.'
    if (kind === 'smashRobot') {
      if (enemyRobotsHere.length === 0) return '이 방에 상대 로봇이 없다.'
      if (enemiesHere.length > 0) return '이 방에 상대 팀 사람이 있다.'
    }
    return null
  }

  async function send(kind: ActionKind, t: { targetTile?: TileId; targetPlayer?: string; targetRobot?: string } = {}) {
    setBusy(true)
    try {
      await act.submitAction(kind, t)
      onChosen(kind)
      setOpen(null)
      onSaid(`${LABEL[kind]}을(를) 골랐다. 닫히기 전까지 바꿀 수 있다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const kinds: ActionKind[] = ['move', 'research', 'summon', 'disturb', 'disguise', 'dropRobot', 'smashRobot']

  return (
    <div className="sc-ph">
      <h2>
        점령전 <span>{hereName}</span>
      </h2>
      <p className="sc-ph__hint">
        {chosen
          ? `${LABEL[chosen]}을(를) 냈다. 관리자가 닫을 때까지 바꿀 수 있다.`
          : '행동 하나를 고른다. 남이 무엇을 골랐는지는 보이지 않는다.'}
      </p>

      <ul className="sc-ph__list">
        {kinds.map((k) => {
          const no = why(k)
          const picked = chosen === k
          return (
            <li key={k} className={picked ? 'is-picked' : ''}>
              <button
                disabled={busy || no !== null}
                onClick={() => (k === 'disguise' ? void send(k) : setOpen(open === k ? null : k))}
              >
                <strong>{LABEL[k]}</strong>
                <span>{no ?? WHAT[k]}</span>
              </button>

              {open === k && k === 'move' && (
                <div className="sc-ph__targets">
                  {neighbours.map((n) => (
                    <button key={n} disabled={busy} onClick={() => void send('move', { targetTile: n })}>
                      {TILE_BY_ID[n].name}
                      <em>
                        {countIn(n)} / {capacityOf(n)}
                      </em>
                    </button>
                  ))}
                </div>
              )}

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
        데리고 다닐 수 있는 로봇은 {MAX_CARRIED_ROBOTS}기까지다.
      </p>
    </div>
  )

  /** 그 방에 지금 몇 자리가 찼는가. 안 보이는 방은 물음표다. */
  function countIn(id: TileId): string {
    if (!(view?.visibleTiles ?? []).includes(id)) return '?'
    const n = pawns.filter((p) => p.tileId !== null && asRoom(p.tileId) === id).length + robots.filter((r) => asRoom(r.tileId) === id).length
    return String(n)
  }
}

const nameOf = (seats: readonly SeatEntry[], id: string) => seats.find((s) => s.playerId === id)?.name ?? '누군가'

// ── 운영자 ──────────────────────────────────────────────────────

export function PhaseHost({
  open,
  no,
  ready,
  act,
  onSaid,
}: {
  open: boolean
  no: number
  ready: { submitted: number; total: number } | null
  act: GameActions
  onSaid: (t: string) => void
}) {
  const [busy, setBusy] = useState(false)
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
          <span className="sc-ph__count">
            {ready ? `${ready.submitted}/${ready.total} 냈다` : '세는 중'}
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
