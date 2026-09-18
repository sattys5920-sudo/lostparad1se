// 말줄 — 화면 아래에 늘 떠 있는 한 줄.
//
// 전에는 조작부의 「말」 단추를 눌러 창을 열어야 말할 수 있었다.
// 그러면 말하는 일이 **행동 하나**가 된다 — 생산·공부와 같은 칸에
// 나란히 서서, 마음먹고 골라야 하는 것이 된다. 옆에 누가 서 있어도
// 한마디 건네려면 두 번을 눌러야 했다.
//
// 지금은 입력칸이 그냥 거기 있다. 방에 서 있기만 하면 언제든 친다 —
// **아무도 없어도 친다.** 빈 교실에 대고 한 말도 그 방에 남고, 뒤에
// 들어온 사람은 못 본다. 그게 이 게임의 규칙이고, 그 규칙은 사람이
// 있을 때만 켜지는 것이 아니다.
//
// 오간 말은 지도 아래에 몇 줄 떠 있다가 지워진다. 전체를 보려면
// 그 줄을 누른다 — 창은 없어진 것이 아니라 두 번째 자리로 갔다.
import { useRef, useState } from 'react'

import { CHAT_MAX_LEN } from '../../../shared/rules/v2'
import { useChatLines } from './useChat'
import type { GameActions } from './useGame'

/** 지도 위에 띄워 두는 줄 수. 더 쌓이면 지도가 안 보인다. */
const PEEK = 3

export interface SayProps {
  me: { playerId: string }
  /** 지금 선 방 이름. 걷는 중이면 null. */
  hereName: string | null
  act: GameActions
  onSaid: (text: string) => void
  /** 전체를 펴 본다. */
  onOpen: () => void
}

export function Say({ me, hereName, act, onSaid, onOpen }: SayProps) {
  const { lines, pull } = useChatLines(act, 'room')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLInputElement | null>(null)

  // **서 있기만 하면 된다.** 누가 듣는지는 보내고 나서 알 일이다
  const can = hereName !== null
  const peek = lines.slice(-PEEK)

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
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
      // 한 줄 치고 나면 이어 친다. 칸에서 손을 떼지 않는다
      boxRef.current?.focus()
    }
  }

  return (
    <div className="sc-sy">
      {peek.length > 0 && (
        <button type="button" className="sc-sy__peek" onClick={onOpen}>
          {peek.map((l, i) => (
            <span
              key={`${l.atMs}-${l.playerId}-${i}`}
              className={
                'sc-sy__line' +
                (l.playerId === me.playerId ? ' is-me' : '') +
                (l.muted ? ' is-muted' : '')
              }
            >
              <b>{l.name}</b>
              {l.text}
            </span>
          ))}
        </button>
      )}

      <div className="sc-sy__bar">
        <input
          ref={boxRef}
          className="sc-sy__box"
          value={draft}
          maxLength={CHAT_MAX_LEN}
          placeholder={can ? `${hereName}에서 말한다` : '어딘가에 서면 말할 수 있다'}
          disabled={!can}
          aria-label="이 방에 말하기"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        {/*
          **누르는 동안 적던 칸에서 손을 떼지 않는다.** 손가락으로
          누르면 먼저 입력칸이 초점을 잃고, 그 순간 탭바가 돌아오면서
          단추가 위로 뛴다 — 손을 뗀 자리에는 이미 단추가 없다.
          로그인과 무전에서 같은 자리로 두 번 막혔다.
        */}
        <button
          type="button"
          className="sc-sy__send"
          disabled={!can || busy || draft.trim().length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void send()}
          aria-label="보내기"
        >
          ▲
        </button>
      </div>
    </div>
  )
}
