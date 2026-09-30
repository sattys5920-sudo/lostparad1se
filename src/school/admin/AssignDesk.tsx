// 배정 — 로비에 들어온 사람마다 팀과 역할을 운영자가 고른다.
//
// **한 사람씩이다.** 「배정」을 누르는 순간 그 사람 화면에 학생증이
// 팝업으로 뜬다(자리의 dealtAtMs 가 바뀐다). 고쳐 주면 다시 뜬다.
//
// 배정 규칙(갈래 · ★)은 없다. 지키는 것은 둘뿐이고 서버가 막는다 —
// 한 역할은 한 사람, 팀 인원 4 · 4 · 3 · 3.
//
// 역할은 비밀 문서에만 있어서 판 문서로는 안 보인다. 운영자 명단은
// hostRoster 로 따로 묻는다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ROLE_IDS, ROLE_NAMES, type RoleId } from '../../../shared/missions/roleNames'
import { STARTING_TEAM_SIZES, type TeamId } from '../../../shared/rules/v2'
import type { SeatEntry } from '../../../shared/model'
import { TEAM_COLOR } from '../game/MapPlan'
import type { GameActions } from '../game/useGame'
import { Dots } from '../game/Shell'
import { TEAM_ORDER, teamName } from '../../../shared/rules/bundan'

interface RosterRow {
  playerId: string
  team: TeamId | null
  roleId: RoleId | null
}

export function AssignDesk({ seats, act, onSaid }: { seats: readonly SeatEntry[]; act: GameActions; onSaid: (t: string) => void }) {
  const [rows, setRows] = useState<RosterRow[] | null>(null)
  /** 화면에서 고르는 중인 값. 저장 전이다 */
  const [draft, setDraft] = useState<Record<string, { team: TeamId | ''; roleId: RoleId | '' }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    void act
      .hostRoster()
      .then((r) => setRows(((r as { rows?: RosterRow[] }).rows ?? []) as RosterRow[]))
      .catch((e) => onSaid((e as Error).message))
  }, [act, onSaid])
  // 자리가 바뀌면(누가 들어오고 나가면) 다시 묻는다
  const seatKey = seats.map((s) => `${s.playerId}:${s.dealtAtMs ?? 0}`).join(',')
  useEffect(load, [load, seatKey])

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.playerId, r])), [rows])
  /** 역할 → 받은 사람. 이미 준 역할은 다른 줄에서 고를 수 없게 흐린다 */
  const holder = useMemo(() => {
    const out = new Map<RoleId, string>()
    for (const r of rows ?? []) if (r.roleId && seats.some((s) => s.playerId === r.playerId)) out.set(r.roleId, r.playerId)
    return out
  }, [rows, seats])
  const teamCount = (t: TeamId) => seats.filter((s) => s.team === t).length
  const done = seats.filter((s) => byId.get(s.playerId)?.roleId && s.team).length

  if (rows === null) return <p className="sc-ad__hint"><Dots /></p>

  async function save(s: SeatEntry) {
    const cur = byId.get(s.playerId)
    const d = draft[s.playerId]
    const team = (d?.team || s.team || '') as TeamId | ''
    const roleId = (d?.roleId || cur?.roleId || '') as RoleId | ''
    if (!team || !roleId) {
      onSaid('분단과 역할을 둘 다 골라야 한다.')
      return
    }
    setBusy(s.playerId)
    try {
      await act.hostAssignSeat(s.playerId, team, roleId)
      onSaid(`${s.name} — ${teamName(team)} · ${ROLE_NAMES[roleId]}. 그 사람 화면에 학생증이 뜬다.`)
      setDraft((x) => {
        const next = { ...x }
        delete next[s.playerId]
        return next
      })
      load()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sc-as">
      <p className="sc-ad__hint">
        들어온 사람 {seats.length} 명 · 배정 {done} 명. 누르는 순간 그 사람 화면에 학생증이 뜬다.
      </p>
      <p className="sc-as__teams">
        {TEAM_ORDER.map((t) => (
          <span key={t} className={teamCount(t) === STARTING_TEAM_SIZES[t] ? 'is-full' : ''}>
            <i style={{ background: TEAM_COLOR[t] }} aria-hidden />
            {teamName(t)} {teamCount(t)}/{STARTING_TEAM_SIZES[t]}
          </span>
        ))}
      </p>
      {seats.length === 0 && <p className="sc-ad__hint">아직 아무도 안 들어왔다. 가입한 사람이 로비에서 「들어간다」를 누르면 여기 뜬다.</p>}
      <ul className="sc-as__list">
        {seats.map((s) => {
          const cur = byId.get(s.playerId)
          const d = draft[s.playerId]
          const team = (d?.team ?? s.team ?? '') as TeamId | ''
          const roleId = (d?.roleId ?? cur?.roleId ?? '') as RoleId | ''
          const dealt = Boolean(s.team && cur?.roleId && s.dealtAtMs)
          const changed = team !== (s.team ?? '') || roleId !== (cur?.roleId ?? '')
          return (
            <li key={s.playerId} className={dealt ? 'is-dealt' : ''}>
              <b className="sc-as__name">
                <i style={{ background: s.team ? TEAM_COLOR[s.team] : 'transparent' }} aria-hidden />
                {s.name}
              </b>
              <select
                aria-label={`${s.name} 분단`}
                value={team}
                onChange={(e) => setDraft((x) => ({ ...x, [s.playerId]: { team: e.target.value as TeamId, roleId } }))}
              >
                <option value="">분단</option>
                {TEAM_ORDER.map((t) => (
                  <option key={t} value={t} disabled={t !== s.team && teamCount(t) >= STARTING_TEAM_SIZES[t]}>
                    {teamName(t)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${s.name} 역할`}
                value={roleId}
                onChange={(e) => setDraft((x) => ({ ...x, [s.playerId]: { team, roleId: e.target.value as RoleId } }))}
              >
                <option value="">역할</option>
                {ROLE_IDS.map((r) => {
                  const who = holder.get(r)
                  const taken = who !== undefined && who !== s.playerId
                  const whoName = taken ? seats.find((x) => x.playerId === who)?.name : null
                  return (
                    <option key={r} value={r} disabled={taken}>
                      {ROLE_NAMES[r]}
                      {taken ? ` · ${whoName}` : ''}
                    </option>
                  )
                })}
              </select>
              <button
                className={changed ? 'is-primary' : ''}
                disabled={busy !== null || !team || !roleId || (!changed && dealt)}
                onClick={() => void save(s)}
              >
                {busy === s.playerId ? '…' : dealt && !changed ? '배정됨' : dealt ? '고치기' : '배정'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
