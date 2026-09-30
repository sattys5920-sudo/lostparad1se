// 공지 팝업 — 운영자가 보낸 말(1위 발표 · 공지 · 투명인간 발표)이 뜬다.
//
// 공지는 전부터 views 로 내려오고 있었지만 **아무 화면도 그리지 않았다.**
// 「나」 탭에 점만 찍혔다. 이제 새로 온 것은 어느 탭에서든 팝업으로 뜨고,
// 지나간 것은 「나」 탭 공지 칸(NoticeList)에서 다시 읽는다.
//
// 봤는지는 이 기기에 적는다(판 · 사람마다). 한꺼번에 여럿이 밀려 있으면
// 최근 셋만 한 장에 모아 띄운다 — 오래된 것은 공지 칸에 있다.
import { teamNo } from '../../../shared/rules/bundan'
import { useState } from 'react'

import type { NoticeLine } from '../../../shared/reveal/notice'
import { TEAM_COLOR } from './MapPlan'
import './noticePop.css'

const SEEN = 'sc.notice.seen'
/** 이 기기에 적어 둘 만큼만. 판 하나에 공지가 이보다 많을 일은 없다 */
const KEEP = 200

const keyOf = (gameId: string, uid: string) => `${SEEN}:${gameId}:${uid}`

function loadSeen(gameId: string, uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyOf(gameId, uid))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSeen(gameId: string, uid: string, seen: Set<string>): void {
  try {
    localStorage.setItem(keyOf(gameId, uid), JSON.stringify([...seen].slice(-KEEP)))
  } catch {
    // 저장이 막히면 다음에 또 뜬다 — 두 번 보는 것이 못 보는 것보다 낫다
  }
}

/** 판의 시각은 서울 시각이다. 기기 시간대를 따르면 외국에서 연 기기에서 어긋난다 */
const HM = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
const clock = (ms: number): string => HM.format(new Date(ms))

/** 1위 발표는 팀 색 네모를 앞에 세운다 */
function Leader({ teams }: { teams: readonly string[] }) {
  return (
    <p className="sc-ntc__leader" aria-hidden>
      {teams.map((t) => (
        <span key={t}>
          <i style={{ background: TEAM_COLOR[t as keyof typeof TEAM_COLOR] }} />
          {teamNo(t)}
        </span>
      ))}
    </p>
  )
}

export function NoticePop({
  gameId,
  uid,
  notices,
  waiting = false,
}: {
  gameId: string
  uid: string
  notices: readonly NoticeLine[] | undefined
  /** 다른 종이(판정)가 먼저 떠 있으면 기다린다 */
  waiting?: boolean
}) {
  const [seen, setSeen] = useState(() => loadSeen(gameId, uid))
  const fresh = (notices ?? []).filter((n) => !seen.has(n.id))
  if (waiting || fresh.length === 0) return null
  const shown = fresh.slice(-3).reverse()
  const more = fresh.length - shown.length

  function close() {
    const next = new Set(seen)
    for (const n of fresh) next.add(n.id)
    saveSeen(gameId, uid, next)
    setSeen(next)
  }

  return (
    <div className="sc-ntc" role="dialog" aria-modal="true" aria-label="공지">
      <button className="sc-ntc__back" aria-label="닫기" onClick={close} />
      <div className="sc-ntc__sheet">
        <p className="sc-ntc__eyebrow">공 지</p>
        <ul>
          {shown.map((n) => (
            <li key={n.id} className={n.leader ? 'is-leader' : ''}>
              {n.leader && <Leader teams={n.leader} />}
              <p className="sc-ntc__text">{n.text}</p>
              <span className="sc-ntc__at">{clock(n.atMs)}</span>
            </li>
          ))}
        </ul>
        {more > 0 && <p className="sc-ntc__more">지난 공지 {more}개는 「나」 탭 공지 칸에 있다.</p>}
        <button className="sc-ntc__ok" onClick={close}>
          확인
        </button>
      </div>
    </div>
  )
}

/** 「나」 탭 공지 칸. 최근 것부터 */
export function NoticeList({ notices }: { notices: readonly NoticeLine[] | undefined }) {
  const all = [...(notices ?? [])].reverse()
  if (all.length === 0) return <p className="sc-mi__none">아직 없다</p>
  return (
    <ul className="sc-ntc__list">
      {all.slice(0, 20).map((n) => (
        <li key={n.id}>
          {n.leader && <Leader teams={n.leader} />}
          <p>{n.text}</p>
          <span>{clock(n.atMs)}</span>
        </li>
      ))}
    </ul>
  )
}
