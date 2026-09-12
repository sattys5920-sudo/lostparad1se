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
import { useCallback, useEffect, useRef, useState } from 'react'

import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import { CHAT_POLL_MS } from './timing'
import type { GameActions } from './useGame'

export interface ChatLine {
  playerId: string
  name: string
  team: string
  atMs: number
  text: string
  /** 전해지지 않은 줄. 지워진 채로 친 말이다. */
  muted: boolean
}

export interface ChatProps {
  me: { playerId: string; team: string }
  /** 지금 선 방 이름. 걷는 중이면 null. */
  hereName: string | null
  act: GameActions
  onSaid: (text: string) => void
}

export function Chat({ me, hereName, act, onSaid }: ChatProps) {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sinceRef = useRef(0)
  const pullingRef = useRef(false)
  const tailRef = useRef<HTMLDivElement | null>(null)

  // 채팅은 secret/ 아래에 있어서 구독할 수 없다. 규칙이 막아서가
  // 아니라 원문을 그대로 내려보내면 「…」가 의미를 잃기 때문이다.
  // 그래서 서버에 물어보는 수밖에 없다
  const pull = useCallback(async () => {
    // 보내고 나서 바로 한 번, 그리고 주기적으로 한 번. 둘이 겹치면
    // 같은 줄을 두 번 붙인다 — 먼저 들어온 쪽이 끝날 때까지 기다린다
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      const res = (await act.chatLines(sinceRef.current)) as { lines?: ChatLine[] }
      const fresh = res.lines ?? []
      if (fresh.length === 0) return
      sinceRef.current = Math.max(sinceRef.current, ...fresh.map((l) => l.atMs))
      setLines((old) => [...old, ...fresh])
    } catch {
      // 잠깐 끊긴 것뿐이다. 다음 번에 다시 가져온다
    } finally {
      pullingRef.current = false
    }
  }, [act])

  useEffect(() => {
    void pull()
    const t = setInterval(() => void pull(), CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [pull])

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      const res = (await act.say(text)) as { heard?: boolean }
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
      <h2 className="sc-ch__head">{hereName ?? '걷는 중'}</h2>

      <div className="sc-ch__log">
        {lines.length === 0 && (
          <p className="sc-ch__none">
            {hereName ? '여기서는 아직 아무 말도 없다.' : '걷는 중에는 말할 수 없다.'}
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
          placeholder={hereName ? `${hereName}에서` : '걷는 중'}
          disabled={!hereName}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        <button disabled={busy || draft.trim().length === 0} onClick={() => void send()}>
          보내기
        </button>
      </div>
      <p className="sc-ch__note">
        이 방에서 한 말이다. 옆 방에는 가지 않고, 나중에 들어온 사람은 보지 못한다.
        점수에도 들어가지 않는다.
      </p>
    </div>
  )
}
