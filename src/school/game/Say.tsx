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
// **평소에는 세 줄, 칸을 누르면 들어온 뒤의 말 전부.** 채팅 모드에서는
// 로그가 위로 펼쳐지고 굴려서 읽는다. 대신 **방을 나가면 버린다** —
// 다시 들어오면 다시 들어온 뒤의 말만 보인다(useChat 의 stay). 그 자리에
// 있던 사람만 안다는 것은 그대로다.
//
// ── 두 모습 ────────────────────────────────────────────────────
//
// 평소에는 지도 아래쪽에 얇은 바 하나(40px)와 로그 세 줄이다. 로그는
// **지도 위에 얹는다** — 반투명한 면을 깔아서 지도 그림이 비쳐 보이게
// 한다. 전에는 면 없이 글자에 검은 테만 둘렀는데, 지도 아래 복도의 회색
// 바닥 위에서는 글자가 허공에 떠 있는 것처럼 보였다.
//
// 칸을 누르면 채팅 모드다. 바가 키보드 위로 올라가며 48px 이 되고,
// 로그가 다섯 줄로 펼쳐지며 면이 짙어진다. **자리를 잡는 것은
// CSS 다**(controls.css 의 .sc-sy) — 여기서는 모습만 고른다.
//
// 칸은 늘 거기 있다. 「누르면 열리는 단추」를 따로 두지 않는 이유는,
// 아이폰이 **사용자가 직접 누른 것이 아니면 키보드를 안 열어 주기**
// 때문이다 — 단추를 누른 뒤 코드로 초점을 옮기면 한 번 씹힌다.
//
// ── 보내기 ─────────────────────────────────────────────────────
//
// 누르는 순간 로그에 줄이 먼저 서고 칸이 빈다(useOutbox). 서버 대답을
// 기다리지 않는다. 칸은 잠그지 않는다 — 잠그면 초점이 떨어지고, 폰에서는
// 그게 곧 키보드가 내려가는 일이다. 실패한 줄은 붉게 남고 누르면 다시 간다.
import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

import { ROOM_SAY_MAX } from '../../../shared/rules/v2'
import { buzz } from './Controls'
import { TEAM_COLOR } from './MapPlan'
import type { ChatLine } from './useChat'
import type { GameActions } from './useGame'
import { useOutbox, useSendBox, type Outgoing } from './useOutbox'
import { MUTE_WHILE_INVISIBLE } from '../../../shared/rules/invisible'

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
  /**
   * 나. 먼저 세운 줄에 이름과 완장 색을 붙이고, 서버 줄이 왔을 때
   * **내 줄만** 짝으로 집는 데 쓴다 — 옆 사람이 같은 「ㅇㅇ」를 쳤다고
   * 내 줄이 사라지면 안 된다.
   */
  self?: { playerId: string; name: string; team: string | null }
  /** 보이지 않는 동안이다. 칸 대신 「말할 수 없다」를 적는다 — 듣기만 한다 */
  mute?: boolean
  /** 칸 대신 적을 말. 없으면 투명인간의 말이다 */
  muteText?: string
}

/** 평소에 남기는 줄 수. 채팅 모드에서는 들어온 뒤의 말 전부를 펼친다 */
const PEEK_REST = 3

type Row = { kind: 'line'; l: ChatLine } | { kind: 'out'; o: Outgoing }

const toneOf = (team: string | null | undefined) =>
  (TEAM_COLOR as Record<string, string>)[team ?? ''] ?? 'var(--text-1)'

export function Say({ hereName, act, onSaid, lines, pull, open, onClose, stuck, self, mute = false, muteText }: SayProps) {
  const meId = self?.playerId ?? null
  // **서 있기만 하면 된다.** 누가 듣는지는 보내고 나서 알 일이다
  const can = hereName !== null

  const mine = useCallback(
    (l: ChatLine, text: string) => l.text === text && (meId === null || l.playerId === meId),
    [meId],
  )
  const post = useCallback(
    async (text: string) => {
      try {
        await act.say(text)
        buzz('ok')
      } catch (e) {
        onSaid((e as Error).message)
        buzz('no')
        throw e
      }
      // 서버 줄을 바로 한 번 당긴다. 오면 먼저 세운 줄이 그 줄로 바뀐다
      void pull()
    },
    [act, onSaid, pull],
  )
  const outbox = useOutbox({ lines, mine, post, scope: hereName })

  const { draft, box, button } = useSendBox({
    max: ROOM_SAY_MAX,
    send: (text) => {
      /*
       * **막힌 단추는 까닭을 말한다.** 비어 있거나 못 말하는 자리여도 단추는
       * 눌린다 — 회색으로 죽여 두면 왜 안 되는지 알 길이 없다.
       */
      if (!can) {
        onSaid('어딘가에 서야 말할 수 있다.')
        buzz('no')
        return false
      }
      if (!text) {
        // 닫혀 있을 때의 말풍선은 「말하기를 연다」다. 열려 있을 때만 꾸중한다
        if (open) {
          onSaid('내용을 적어 주세요.')
          buzz('no')
        }
        return false
      }
      /*
       * 도배 막이는 **같은 말이 날아가는 중에 또 누른 것** 하나뿐이다.
       * 전에는 3초에 세 번을 넘기면 칸을 4초 잠갔는데, 잠긴 칸은 초점을
       * 잃고 키보드가 내려갔다 — 빨리 말하는 사람일수록 손이 끊겼다.
       */
      if (!outbox.submit(text)) return false
      return true
    },
  })

  const rows: Row[] = [
    ...lines.map((l): Row => ({ kind: 'line', l })),
    ...outbox.waiting.map((o): Row => ({ kind: 'out', o })),
  ]
  const shown = open ? rows : rows.slice(-PEEK_REST)
  const left = ROOM_SAY_MAX - draft.length

  /** 로그를 아래로 쓸어내리면 닫는다. 맵 탭·완료와 함께 셋째 길이다. */
  const swipeRef = useRef<number | null>(null)

  // 펼쳤으면 맨 아래(가장 최근 말)부터 보인다. 새 줄이 오면 따라 내려간다 —
  // 위로 올려 읽는 중이면 안 건드린다
  const logRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  useEffect(() => {
    const el = logRef.current
    if (el && open && stickRef.current) el.scrollTop = el.scrollHeight
  }, [open, shown.length])

  return (
    <div className={'sc-sy' + (open ? ' is-open' : '')}>
      {shown.length > 0 && (
        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
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
          {shown.map((r, i) => {
            // 펼쳐 읽을 때는 옅게 하지 않는다 — 위로 굴려 읽는 줄이 흐리면 못 읽는다
            const fade = { '--fade': String(open ? 1 : faded(i, shown.length)) }
            if (r.kind === 'out') {
              const { o } = r
              const tone = toneOf(self?.team)
              const failed = o.state === 'failed'
              return (
                <span
                  key={`o-${o.id}`}
                  className={'sc-sy__line is-out' + (o.state === 'sending' ? ' is-sending' : '') + (failed ? ' is-failed' : '')}
                  style={{ ...fade, '--say-team': tone } as CSSProperties}
                  role={failed ? 'button' : undefined}
                  aria-label={failed ? `못 보냈다. 눌러서 다시 보내기: ${o.text}` : undefined}
                  /* 누르는 순간 다시 보낸다. 칸의 초점은 그대로 둔다 */
                  onPointerDown={
                    failed
                      ? (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          outbox.retry(o.id)
                        }
                      : undefined
                  }
                >
                  {self && <b style={{ color: tone }}>{self.name}</b>}
                  {/* 줄이 길면 뒤가 잘리므로 표시는 글 앞에 둔다 */}
                  {failed && <i className="sc-sy__retry">못 감 · 다시</i>}
                  {o.text}
                </span>
              )
            }
            const { l } = r
            /* 판이 적은 줄에는 이름이 없다. 가운데에 회색으로 둔다 —
               사람이 한 말과 같은 모양이면 누가 한 말인지 헷갈린다 */
            const sys = isSystem(l)
            const tone = toneOf(l.team)
            return (
              <span
                key={`${l.atMs}-${l.playerId}-${i}`}
                className={
                  'sc-sy__line' +
                  (sys ? ' is-sys' : '') +
                  (l.muted ? ' is-muted' : '') +
                  // 내 줄은 먼저 세운 줄이 이미 올라와 있었다. 한 번 더 올라오면 깜빡인다
                  (meId !== null && l.playerId === meId ? ' is-mine' : '')
                }
                /* 위로 갈수록 옅다. 맨 위는 거의 지워진 것으로 보인다.
                   왼쪽 2px 막대도 완장 색이다 — 이름을 읽기 전에
                   「우리 편이 말했다」가 먼저 보인다 */
                style={{ ...fade, ...(sys ? {} : { '--say-team': tone }) } as CSSProperties}
              >
                {!sys && <b style={{ color: tone }}>{l.name}</b>}
                {l.text}
              </span>
            )
          })}
        </div>
      )}

      <div className="sc-sy__bar">
        {/*
          **칸을 잠그지 않는다.** 서 있는 자리를 잠깐 모르는 순간(view 가
          다시 오는 중)에도 disabled 를 걸면 초점이 떨어지고 키보드가
          내려간다. 못 말하는 자리면 보낼 때 까닭을 말한다.
        */}
        {/* 보이지 않는 동안에는 칸 대신 까닭을 적는다. 서버도 거절한다 */}
        {mute ? (
          <p className="sc-sy__mute" role="status">{muteText ?? MUTE_WHILE_INVISIBLE}</p>
        ) : (
          <input
            {...box}
            className="sc-sy__box"
            placeholder={hereName !== null ? `${hereName}에서 말한다` : '어딘가에 서면 말할 수 있다'}
            aria-label="이 방에 말하기"
          />
        )}
        {/* 상한에 닿기 전에 미리 보여 준다. 다 치고 나서 「더 못 친다」를
            알면 이미 늦다 */}
        {!mute && left <= COUNT_FROM && <span className={'sc-sy__left' + (left === 0 ? ' is-full' : '')}>{left}</span>}
        {/* 누르는 순간 보낸다 — 손을 뗄 때까지 기다리면 칸이 초점을 잃는다(useSendBox) */}
        {!mute && <button
          {...button}
          className={'sc-sy__send' + (!can || draft.trim().length === 0 ? ' is-empty' : '')}
          aria-label={open ? '보내기' : '말하기'}
        >
          {open ? '▲' : '💬'}
        </button>}
      </div>
      {/* 보내기는 되는데 아무것도 안 돌아오면, 여기 말고는 알 데가 없다 */}
      {stuck && <p className="sc-sy__stuck" role="alert">말을 못 받아온다 — {stuck}</p>}
    </div>
  )
}

/**
 * 판이 적은 줄인가. **이름이 없으면 판이 적은 것이다** — 사람이 친
 * 줄에는 서버가 언제나 이름을 붙인다(functions/src/chat.ts).
 */
export function isSystem(l: Pick<ChatLine, 'name'>): boolean {
  return l.name.trim() === ''
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
