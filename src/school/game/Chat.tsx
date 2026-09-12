// 말.
//
// 여기서 한 말은 **어떤 판정에도 쓰이지 않는다.** 「나 털어놓을게」라고
// 치는 것과 실제로 털어놓는 것은 다른 일이고, 게임은 후자만 센다. 그래서
// 이 화면은 점수와 아무 상관이 없다 — 그런데도 사람들은 여기서 제일 오래
// 머문다.
//
// 지워진 사람의 전체 채팅은 서버가 「…」로 바꿔 보낸다. 본인 화면에만
// 원문이 남는다. 자기가 무슨 말을 했는지는 안다. 다만 아무도 듣지 않았다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import { CHAT_POLL_MS } from './timing'
import type { GameActions } from './useGame'

export interface ChatLine {
  room: 'class' | 'team'
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
  act: GameActions
  onSaid: (text: string) => void
}

export function Chat({ me, act, onSaid }: ChatProps) {
  const [room, setRoom] = useState<'class' | 'team'>('class')
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
  }, [lines.length, room])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      const res = (await act.say(room, text)) as { heard?: boolean }
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

  const shown = lines.filter((l) => l.room === room)

  return (
    <div className="sc-ch">
      <div className="sc-ch__rooms">
        <button className={room === 'class' ? 'is-on' : ''} onClick={() => setRoom('class')}>
          전체
        </button>
        <button className={room === 'team' ? 'is-on' : ''} onClick={() => setRoom('team')}>
          {me.team}팀
        </button>
      </div>

      <div className="sc-ch__log">
        {shown.length === 0 && <p className="sc-ch__none">아직 아무도 말하지 않았다.</p>}
        <ul>
          {shown.map((l, i) => (
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
          placeholder={room === 'class' ? '반 전체에게' : '우리 팀에게'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        <button disabled={busy || draft.trim().length === 0} onClick={() => void send()}>
          보내기
        </button>
      </div>
      <p className="sc-ch__note">여기서 한 말은 점수에 들어가지 않는다.</p>
    </div>
  )
}
