// 팀 점수 — 차지한 방 수.
//
// **늘 떠 있고, 바뀌는 순간 번쩍인다.** 방 주인은 페이즈가 닫힐 때
// 한꺼번에 바뀐다(closePhase). 그때 어느 팀이 몇 곳을 얻고 잃었는지를
// 숫자 옆 「+1」·「−2」로 몇 초 보여 준다 — 무전 한 줄을 찾아 읽지
// 않아도 판이 어떻게 움직였는지가 머리 위에서 보인다.
//
// 세는 재료는 공개 문서(tiles)뿐이다. 누가 어느 방을 쥐었는지는 이미
// 지도 테두리 색으로 누구에게나 보이므로, 여기서 새로 새는 것은 없다.
import { teamName, teamNo, TEAM_ORDER } from '../../../shared/rules/bundan'
import { useEffect, useRef, useState } from 'react'

import { TEAMS } from '../char/palette'
import { colorOfTeam } from './MapPlan'
import { TEAM_IDS, type TeamId } from '../../../shared/rules/v2'
import type { TileDoc } from '../../../shared/model'
import type { TileId } from '../types'

/** 번쩍임이 남아 있는 시간. 페이즈가 닫히고 다들 화면을 볼 틈이다. */
export const SCORE_FLASH_MS = 4000

const TEAM_NAME = Object.fromEntries(TEAMS.map((t) => [t.id, teamName(t.id)])) as Record<TeamId, string>

/** 팀마다 쥔 방 수. 넷이 **늘 다 있다** — 0 인 팀도 0 으로 선다. */
export function teamCounts(tiles: Partial<Record<TileId, TileDoc>>): Record<TeamId, number> {
  const out = Object.fromEntries(TEAM_IDS.map((t) => [t, 0])) as Record<TeamId, number>
  for (const t of Object.values(tiles)) {
    const owner = t?.ownerTeam as TeamId | null | undefined
    if (owner && owner in out) out[owner] += 1
  }
  return out
}

/** 앞뒤 차이. 안 바뀐 팀은 빠진다 — 빈 객체면 아무 일도 없었다. */
export function scoreDelta(
  before: Record<TeamId, number>,
  after: Record<TeamId, number>,
): Partial<Record<TeamId, number>> {
  const out: Partial<Record<TeamId, number>> = {}
  for (const t of TEAM_IDS) if (after[t] !== before[t]) out[t] = after[t] - before[t]
  return out
}

/**
 * 번쩍이는 동안 들어온 차이를 **더한다.** 얻었다 잃어서 0 이 되면 뺀다.
 *
 * 전에는 새 차이가 앞의 것을 통째로 갈아 끼웠다. 주인이 두 번에 나눠
 * 바뀌면(문서 둘이 따로 도착하면) 먼저 바뀐 팀의 「+2」가 나중 팀의
 * 「+1」에 지워졌다 — 캡처에서 내 팀 숫자는 2 로 올랐는데 +2 가 없었다.
 */
export function addDelta(
  shown: Partial<Record<TeamId, number>>,
  more: Partial<Record<TeamId, number>>,
): Partial<Record<TeamId, number>> {
  const out: Partial<Record<TeamId, number>> = { ...shown }
  for (const t of TEAM_IDS) {
    if (more[t] === undefined) continue
    const n = (out[t] ?? 0) + (more[t] as number)
    if (n === 0) delete out[t]
    else out[t] = n
  }
  return out
}

export function ScoreBar({ tiles, myTeam, off = false }: { tiles: Partial<Record<TileId, TileDoc>>; myTeam: TeamId; off?: boolean }) {
  const counts = teamCounts(tiles)
  const loaded = Object.keys(tiles).length > 0
  const key = TEAM_IDS.map((t) => counts[t]).join(',')
  /*
   * **처음 받은 것은 비교 기준일 뿐이다.** 들어오자마자 번쩍이면 「방금
   * 무슨 일이 있었나」로 읽힌다 — 실제로는 판이 이미 그랬던 것이다.
   */
  const base = useRef<Record<TeamId, number> | null>(null)
  const [flash, setFlash] = useState<Partial<Record<TeamId, number>>>({})

  useEffect(() => {
    if (!loaded) return
    if (base.current === null) {
      base.current = counts
      return
    }
    const d = scoreDelta(base.current, counts)
    base.current = counts
    if (Object.keys(d).length === 0) return
    setFlash((shown) => addDelta(shown, d))
    // 마지막으로 바뀐 때부터 다시 센다 — 앞 타이머는 아래 정리에서 걷힌다
    const id = window.setTimeout(() => setFlash({}), SCORE_FLASH_MS)
    return () => window.clearTimeout(id)
    // counts 는 key 가 같으면 같은 값이다 — 매 그림마다 새 객체라 key 로 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded])

  if (!loaded) return null
  /*
   * **마지막 여섯 시간은 점수판을 끈다**(운영자 달력의 「점수판 끄기」).
   * 숫자 대신 꺼졌다는 것만 남긴다 — 줄이 통째로 사라지면 고장으로 읽힌다
   */
  if (off) return <div className="sc-sb is-off" role="status">점수판 꺼짐</div>
  return (
    <div className="sc-sb" role="status" aria-live="polite" aria-label="분단마다 차지한 방">
      {TEAM_ORDER.map((t) => {
        const d = flash[t]
        return (
          <span
            key={t}
            className={['sc-sb__team', t === myTeam ? 'is-mine' : '', d ? 'is-hit' : ''].filter(Boolean).join(' ')}
            aria-label={`${TEAM_NAME[t]} ${counts[t]} 곳${d ? `, ${d > 0 ? d + ' 곳 얻음' : -d + ' 곳 잃음'}` : ''}`}
          >
            {/* 색만으로는 안 가른다 — 색맹이면 붉은 팀과 초록 팀이 같다. 네모 안에 글자 */}
            <i style={{ background: colorOfTeam(t) }} aria-hidden>
              {teamNo(t)}
            </i>
            <b aria-hidden>{counts[t]}</b>
            {d !== undefined && (
              <em className={d > 0 ? 'is-up' : 'is-down'} aria-hidden>
                {d > 0 ? `+${d}` : `−${-d}`}
              </em>
            )}
          </span>
        )
      })}
    </div>
  )
}
