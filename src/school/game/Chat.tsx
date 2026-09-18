// 말.
//
// **이 방에서, 내가 들어온 뒤에 나온 말만 보인다.** 옆 방 이야기는 오지
// 않고, 늦게 들어왔으면 앞서 나눈 말도 오지 않는다. 그 자리에 없었으면
// 못 들은 것이다 — 서버가 애초에 보내지 않는다.
//
// 여기서 한 말은 **어떤 판정에도 쓰이지 않는다.** 「나 털어놓을게」라고
// 치는 것과 실제로 털어놓는 것은 다른 일이고, 게임은 후자만 센다.
//
// 지워진 사람의 말은 서버가 「…」로 바꿔 보낸다. 본인 화면에만 원문이
// 남는다. 자기가 무슨 말을 했는지는 안다. 다만 아무도 듣지 않았다.
import { useEffect, useRef, useState } from 'react'

import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import { useChatLines, type ChatLine } from './useChat'
import type { GameActions } from './useGame'

export type { ChatLine }

export interface ChatProps {
  me: { playerId: string; team: string }
  /** 지금 선 방 이름. 걷는 중이면 null. */
  hereName: string | null
  act: GameActions
  onSaid: (text: string) => void
  /**
   * 어느 줄인가. **방**은 그 자리에 그때 있던 사람에게만 남고,
   * **팀**(무전)은 학교 어디에 있든 같은 팀에게 닿는다.
   *
   * 화면은 똑같이 생겼다 — 다른 것은 어디로 가느냐뿐이라, 창을 둘
   * 그리면 같은 것을 두 군데서 고치게 된다.
   */
  channel?: 'room' | 'team'
}

export function Chat({ me, hereName, act, onSaid, channel = 'room' }: ChatProps) {
  const team = channel === 'team'
  // 무전은 걷는 중에도 된다. 자리가 아니라 팀에 매인 줄이다
  const open = team ? true : hereName !== null
  const { lines, pull } = useChatLines(act, channel)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      const res = (await (team ? act.radio(text) : act.say(text))) as { heard?: boolean }
      setDraft('')
      // 들리지 않았다는 것만은 알려 준다. 허공에 대고 친 줄 모르면
      // 대답이 없는 이유를 영영 알 수 없다
      if (res.heard === false) onSaid('아무도 듣지 못했다.')
      await pull()
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ch">
      <h2 className="sc-ch__head">{team ? `${me.team}팀 무전` : (hereName ?? '걷는 중')}</h2>

      <div className="sc-ch__log">
        {lines.length === 0 && (
          <p className="sc-ch__none">
            {team
              ? '오늘 오간 무전이 없다.'
              : hereName
                ? '여기서는 아직 아무 말도 없다.'
                : '걷는 중에는 말할 수 없다.'}
          </p>
        )}
        <ul>
          {lines.map((l, i) => (
            <li
              key={`${l.atMs}-${l.playerId}-${i}`}
              className={[l.playerId === me.playerId ? 'is-me' : '', l.muted ? 'is-muted' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="sc-ch__who">{l.name}</span>
              <span className="sc-ch__text">{l.text}</span>
              {l.muted && l.playerId === me.playerId && <span className="sc-ch__gone">전해지지 않았다</span>}
            </li>
          ))}
        </ul>
        <div ref={tailRef} />
      </div>

      <div className="sc-ch__bar">
        <input
          value={draft}
          maxLength={CHAT_MAX_LEN}
          placeholder={team ? `${me.team}팀에게` : hereName ? `${hereName}에서` : '걷는 중'}
          disabled={!open}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        {/*
          **누르는 동안 적던 칸에서 손을 떼지 않는다.**

          손가락으로 「보내기」를 누르면 먼저 입력칸이 초점을 잃는다.
          그 순간 브라우저가 화면을 도로 굴려서 단추가 58px 위로
          올라가고, 손을 뗀 자리에는 이미 단추가 없다 — 누른 것이
          눌리지 않는다. 엔터로는 보내지는데 단추로는 안 보내졌다.
        */}
        <button
          disabled={busy || draft.trim().length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void send()}
        >
          보내기
        </button>
      </div>
      <p className="sc-ch__note">
        {team
          ? '같은 팀에게만 간다. 학교 어디에 있든 닿고, 걷는 중에도 된다. 점수에는 들어가지 않는다.'
          : '이 방에서 한 말이다. 옆 방에는 가지 않고, 나중에 들어온 사람은 보지 못한다. 점수에도 들어가지 않는다.'}
      </p>
    </div>
  )
}
