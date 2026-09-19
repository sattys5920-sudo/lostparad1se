// 말줄 — 지도 아래에 늘 떠 있는 로그 한 덩이와 입력 한 줄.
//
// 전에는 조작부의 「말」 단추를 눌러 창을 열어야 말할 수 있었다.
// 그러면 말하는 일이 **행동 하나**가 된다 — 생산·공부와 같은 칸에
// 나란히 서서, 마음먹고 골라야 하는 것이 된다.
//
// 지금은 입력칸이 그냥 거기 있다. 방에 서 있기만 하면 언제든 친다 —
// **아무도 없어도 친다.** 빈 교실에 대고 한 말도 그 방에 남고, 뒤에
// 들어온 사람은 못 본다.
//
// **로그는 구르지 않는다.** 다섯 줄이 지나가면 앞선 줄은 사라진다.
// RPG 에서 지나간 대사가 남지 않는 것과 같다 — 다시 펴 볼 수 있으면
// 「그 자리에 있던 사람만 안다」가 「나중에 읽어도 된다」가 된다.
//
// ── 두 모습 ────────────────────────────────────────────────────
//
// 평소에는 지도 아래에 얇은 바 하나(40px)와 로그 세 줄이다. 로그는
// 배경 없이 글자에 검은 테만 둘러 지도 위에 얹는다 — 배경을 깔면
// 그만큼 지도가 잘린 것처럼 보인다.
//
// 칸을 누르면 채팅 모드다. 바가 키보드 위로 올라가며 48px 이 되고,
// 로그가 다섯 줄로 펼쳐지며 반투명 배경이 생긴다. **자리를 잡는 것은
// CSS 다**(controls.css 의 .sc-sy) — 여기서는 모습만 고른다.
//
// 칸은 늘 거기 있다. 「누르면 열리는 단추」를 따로 두지 않는 이유는,
// 아이폰이 **사용자가 직접 누른 것이 아니면 키보드를 안 열어 주기**
// 때문이다 — 단추를 누른 뒤 코드로 초점을 옮기면 한 번 씹힌다.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { ROOM_SAY_BURST, ROOM_SAY_BURST_MS, ROOM_SAY_COOL_MS, ROOM_SAY_MAX } from '../../../shared/rules/v2'
import { TEAM_COLOR } from './MapPlan'
import type { ChatLine } from './useChat'
import type { GameActions } from './useGame'

/** 남은 글자가 이보다 적으면 숫자를 띄운다. 늘 띄우면 잔소리다. */
const COUNT_FROM = 20

export interface SayProps {
  /** 지금 선 방 이름. 걷는 중이면 null. */
  hereName: string | null
  act: GameActions
  onSaid: (text: string) => void
  /**
   * 오간 말. **가져오는 일은 바깥에서 한다** — 머리 위 풍선도 같은 줄을
   * 봐야 하는데, 여기서 따로 세면 둘이 다른 것을 보게 된다.
   */
  lines: readonly ChatLine[]
  pull: () => Promise<void>
  /** 가져오기가 계속 실패할 때 그 이유. 조용히 비어 있는 것보다 낫다. */
  stuck: string | null
  /** 채팅 모드인가(칸에 초점이 가 있는가). 바와 로그의 모습을 가른다. */
  open: boolean
  /** 채팅 모드를 닫는다. 로그를 아래로 쓸어내렸을 때 부른다. */
  onClose: () => void
}

/** 평소에 남기는 줄 수와, 채팅 모드에서 펼치는 줄 수. */
const PEEK_REST = 3
const PEEK_OPEN = 5

export function Say({ hereName, act, onSaid, lines, pull, open, onClose, stuck }: SayProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** 도배로 붙들린 시각. 0 이면 풀려 있다. */
  const [heldTo, setHeldTo] = useState(0)
  const boxRef = useRef<HTMLInputElement | null>(null)
  /** 최근에 보낸 시각들. 도배 막이가 이걸 센다. */
  const sentRef = useRef<number[]>([])

  // **서 있기만 하면 된다.** 누가 듣는지는 보내고 나서 알 일이다
  const held = heldTo > 0
  const can = hereName !== null && !held
  const shown = lines.slice(-(open ? PEEK_OPEN : PEEK_REST))
  const left = ROOM_SAY_MAX - draft.length

  // 붙들린 동안에는 시계를 하나 걸어 둔다. 안 걸면 다음에 무언가
  // 칠 때까지 풀린 줄을 모른다
  useEffect(() => {
    if (heldTo === 0) return
    const t = setTimeout(() => setHeldTo(0), Math.max(0, heldTo - Date.now()))
    return () => clearTimeout(t)
  }, [heldTo])

  async function send() {
    const text = draft.trim()
    if (!text || busy || !can) return

    // 도배 막이. **화면이 먼저 손을 붙든다** — 방 안의 말은 판정에
    // 안 쓰이므로 서버가 막을 이유가 없고, 막아야 할 것은 옆 사람의
    // 로그가 한 사람 글로 채워지는 일이다
    const now = Date.now()
    const recent = [...sentRef.current.filter((t) => now - t < ROOM_SAY_BURST_MS), now]
    sentRef.current = recent
    if (recent.length > ROOM_SAY_BURST) {
      setHeldTo(now + ROOM_SAY_COOL_MS)
      onSaid('너무 빠르다. 잠깐 쉬어라.')
      return
    }

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

  /** 로그를 아래로 쓸어내리면 닫는다. 맵 탭·완료와 함께 셋째 길이다. */
  const swipeRef = useRef<number | null>(null)

  return (
    <div className={'sc-sy' + (open ? ' is-open' : '')}>
      {shown.length > 0 && (
        <div
          className="sc-sy__log"
          aria-live="polite"
          aria-label="이 방에서 오간 말"
          onPointerDown={(e) => { swipeRef.current = e.clientY }}
          onPointerUp={(e) => {
            const from = swipeRef.current
            swipeRef.current = null
            if (open && from !== null && e.clientY - from > 24) onClose()
          }}
        >
          {shown.map((l, i) => (
            <span
              key={`${l.atMs}-${l.playerId}`}
              className={'sc-sy__line' + (l.muted ? ' is-muted' : '')}
              /* 위로 갈수록 옅다. 맨 위는 거의 지워진 것으로 보인다 */
              style={{ '--fade': String(faded(i, shown.length)) } as CSSProperties}
            >
              <b style={{ color: (TEAM_COLOR as Record<string, string>)[l.team] ?? '#d8dde8' }}>{l.name}</b>
              {l.text}
            </span>
          ))}
        </div>
      )}

      <div className="sc-sy__bar">
        <input
          ref={boxRef}
          className="sc-sy__box"
          enterKeyHint="send"
          value={draft}
          maxLength={ROOM_SAY_MAX}
          placeholder={
            held ? '너무 빠르다. 잠깐 쉬어라' : hereName !== null ? `${hereName}에서 말한다` : '어딘가에 서면 말할 수 있다'
          }
          disabled={!can}
          aria-label="이 방에 말하기"
          onChange={(e) => setDraft(e.target.value.slice(0, ROOM_SAY_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
        />
        {/* 상한에 닿기 전에 미리 보여 준다. 다 치고 나서 「더 못 친다」를
            알면 이미 늦다 */}
        {left <= COUNT_FROM && <span className={'sc-sy__left' + (left === 0 ? ' is-full' : '')}>{left}</span>}
        {/*
          **누르는 동안 적던 칸에서 손을 떼지 않는다.** 손가락으로
          누르면 먼저 입력칸이 초점을 잃고, 그 순간 바가 키보드와 함께
          내려가 버린다 — 손을 뗀 자리에는 이미 단추가 없다.
          로그인과 무전에서 같은 자리로 두 번 막혔다.
        */}
        <button
          type="button"
          className="sc-sy__send"
          disabled={!can || busy || draft.trim().length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void send()}
          aria-label={open ? '보내기' : '말하기'}
        >
          {open ? '▲' : '💬'}
        </button>
      </div>
      {/* 보내기는 되는데 아무것도 안 돌아오면, 여기 말고는 알 데가 없다 */}
      {stuck && <p className="sc-sy__stuck" role="alert">말을 못 받아온다 — {stuck}</p>}
    </div>
  )
}

/**
 * 맨 위가 0.4, 맨 아래가 1. 줄 수가 둘로 줄어도 같은 기울기로 옅어진다.
 *
 * 한 줄뿐일 때는 옅게 할 이유가 없다 — 비교할 것이 없으면 「오래된
 * 줄」이라는 뜻이 안 생기고 그냥 읽기 힘든 글자가 된다.
 */
export function faded(i: number, n: number): number {
  if (n <= 1) return 1
  return Math.round((0.4 + (0.6 * i) / (n - 1)) * 100) / 100
}
