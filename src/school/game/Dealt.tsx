// 배정이 끝났다 — 학생증 한 장이 넘어온다.
//
// 열넷이 차는 순간 서버가 팀과 역할을 나눈다(lobby.ts 의 settleRoster).
// **그 사실을 화면이 알려 주지 않으면 아무 일도 안 일어난 것과 같다.**
// 전에는 배정이 운영자의 시작 단추에 매여 있었고, 시작한 뒤에도 본인이
// 「나」 탭을 열어 봐야 자기가 누구인지 알았다.
//
// 공개 범위는 여기서도 갈린다. 카드에 적히는 것은 **내 것뿐**이다 —
// 팀은 어차피 모두가 아는 것이고(games/{id}.seats), 역할과 숨긴 사실은
// 서버가 나에게만 꺼내 준다(myPaper). 남의 카드는 어디에도 없다.
import { useEffect, useState } from 'react'

import { IdCard } from './Me'
import { Snow } from '../reveal/Snow'
import type { MyPaper } from './useMyPaper'
import type { AvatarLook } from '../../../shared/look'
import type { TeamId } from '../types'

/** 한 번 본 판은 다시 안 띄운다. 새로고침마다 나오면 그건 공지가 아니다. */
const SEEN = 'sc.dealt.seen'

const keyOf = (gameId: string, uid: string) => `${SEEN}:${gameId}:${uid}`

export function dealtSeen(gameId: string, uid: string): boolean {
  try {
    return localStorage.getItem(keyOf(gameId, uid)) === '1'
  } catch {
    // 사파리 사생활 보호 모드에서는 읽기부터 막힌다. 그러면 늘 띄운다 —
    // 두 번 보는 것이 한 번도 못 보는 것보다 낫다
    return false
  }
}

export function markDealtSeen(gameId: string, uid: string): void {
  try {
    localStorage.setItem(keyOf(gameId, uid), '1')
  } catch {
    // 저장이 막히면 다음에 또 뜬다
  }
}

export interface DealtProps {
  name: string
  team: TeamId
  look: AvatarLook | null
  paper: MyPaper
  snowLevel: number
  onClose: () => void
}

export function Dealt({ name, team, look, paper, snowLevel, onClose }: DealtProps) {
  const [open, setOpen] = useState(false)
  /**
   * **바로 못 닫는다.**
   *
   * 자리가 차기를 기다리며 화면을 두드리고 있던 손가락이, 카드가 뜨는
   * 그 프레임에 한 번 더 닿으면 학생증을 못 보고 지나간다. 짧게 잠근다.
   */
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 700)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="sc-dl" role="dialog" aria-label="배정된 학생증">
      <Snow level={snowLevel} />
      <div className="sc-dl__in">
        <p className="sc-dl__top">열넷이 찼다 · 반과 역할이 정해졌다</p>
        <IdCard
          name={name}
          team={team}
          look={look}
          paper={paper}
          err={null}
          open={open}
          onFold={() => setOpen((v) => !v)}
        />
        <p className="sc-dl__mine">
          역할과 숨긴 사실은 <b>나만 본다.</b> 팀은 모두가 안다.
        </p>
        <button
          type="button"
          className="sc-dl__go"
          disabled={!armed}
          onClick={() => {
            onClose()
          }}
        >
          {armed ? '접어 넣는다' : '…'}
        </button>
        <p className="sc-dl__again">「나」 탭에서 언제든 다시 본다.</p>
      </div>
    </div>
  )
}
