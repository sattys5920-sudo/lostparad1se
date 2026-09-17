// 화면 아래 조작부 — 자원 줄 · 십자키와 행동 · 탭바.
//
// **지도는 여기서 한 칸도 안 건드린다.** 규칙도 마찬가지다. 여기 있는
// 것은 값을 보여 주는 방식과 손가락이 닿는 자리뿐이다.
//
// 높이를 못 박아 둔다. 36 + 96 + 48 = 180 이고, 나머지 세로는 전부
// 지도에 준다 — 조작부가 화면의 삼분의 일을 먹으면 방이 답답해진다.
// 좁은 화면(375×667)에서 지도가 280 을 못 채우면 조작 영역만 88 로
// 줄인다. **누르는 자리는 그때도 44 를 지킨다** — 보이는 칸만 작아지고
// 히트박스는 그대로다.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { uiIcon } from './uiArt'
import type { Dir } from '../map/sprites'

/** 손끝에 닿아야 하는 최소 크기. 보이는 것과 따로 잡는다. */
export const TAP_PX = 44

/** 진동을 켜 둘 것인가. 기기에만 남는다 — 판과 상관없는 취향이다. */
const BUZZ_KEY = 'sc-buzz'

export function buzzOn(): boolean {
  try {
    return localStorage.getItem(BUZZ_KEY) !== 'off'
  } catch {
    return true
  }
}
export function setBuzz(on: boolean): void {
  try {
    localStorage.setItem(BUZZ_KEY, on ? 'on' : 'off')
  } catch {
    // 사파리 비공개 창에서는 못 쓴다. 진동 설정 하나 때문에 터지면 안 된다
  }
}
/** 걸음은 짧게, 행동은 조금 길게. */
export function buzz(kind: 'step' | 'act'): void {
  if (!buzzOn()) return
  navigator.vibrate?.(kind === 'step' ? 8 : 18)
}

// ── 자원 줄 ─────────────────────────────────────────────────────

/**
 * 숫자가 바뀌면 짧게 번쩍인다.
 *
 * 토큰이 하나 줄었는지 셋 줄었는지를 숫자만 봐서는 모른다. 바뀌는
 * 순간에 색이 한 번 튀면, 화면을 안 보고 있어도 곁눈으로 잡힌다.
 * 늘면 강조색, 줄면 붉은색. 0.3초면 충분하다.
 */
function useBlink(value: number | null): 'up' | 'down' | null {
  const had = useRef(value)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    const before = had.current
    had.current = value
    if (before === null || value === null || before === value) return
    setFlash(value > before ? 'up' : 'down')
    const t = window.setTimeout(() => setFlash(null), 300)
    return () => window.clearTimeout(t)
  }, [value])
  return flash
}

function Res({
  icon,
  label,
  value,
  tone,
}: {
  icon: string
  label: string
  value: number | null
  /** 지식만 다른 색이다. 자리가 아니라 이름으로 잡는다 */
  tone?: 'know'
}) {
  const flash = useBlink(value)
  return (
    <span className={`sc-ct__res${flash ? ` is-${flash}` : ''}${tone ? ` is-${tone}` : ''}`}>
      <img src={uiIcon(icon)} alt="" width={16} height={16} />
      <b>{value ?? '—'}</b>
      <i>{label}</i>
    </span>
  )
}

export interface Mate {
  playerId: string
  /** 지금 화면을 켜 두고 있는가. */
  here: boolean
  captain: boolean
}

/**
 * 자원 줄.
 *
 * **토큰은 페이즈에만 있다.** 넷이 한 주머니를 나눠 쓰는 것이라
 * 「팀 토큰」이라 부른다. 자유 시간에는 값을 치를 일이 없어서 아예
 * 안 뜬다 — 쓸 데가 없는 숫자를 띄워 두면 무엇에 쓰는지부터 묻게 된다.
 */
export function ResourceRow({
  tokens,
  tokenLabel,
  money,
  knowledge,
  mates,
  teamColor,
  onOpen,
}: {
  /** 페이즈 상자. **자유 시간에는 null 이고, 그때는 칸이 없다.** */
  tokens: number | null
  tokenLabel: string
  money: number | null
  knowledge: number | null
  mates: readonly Mate[]
  teamColor: string
  onOpen: () => void
}) {
  return (
    <button className="sc-ct__bar" onClick={onOpen} aria-label="우리 팀 보기">
      {tokens !== null && <Res icon="token" label={tokenLabel} value={tokens} />}
      <Res icon="money" label="돈" value={money} />
      <Res icon="knowledge" label="지식" value={knowledge} tone="know" />
      <span className="sc-ct__mates" aria-hidden="true">
        {mates.map((m) => (
          <i
            key={m.playerId}
            className={`sc-ct__mate${m.here ? ' is-here' : ''}${m.captain ? ' is-cap' : ''}`}
            style={m.here ? { background: teamColor } : undefined}
          />
        ))}
      </span>
    </button>
  )
}

// ── 십자키 ──────────────────────────────────────────────────────

export interface DirState {
  /** 벽이 아니다 — 갈 수 있는 쪽이다. */
  open: boolean
  /** 갈 수는 있지만 지금은 막혀 있다 — 누르면 사유가 뜬다. */
  why?: string
  /** 이 걸음에 드는 토큰. 문·계단을 넘는 페이즈 중에만 붙는다. */
  cost?: number
}

/**
 * 네 쪽이 어떤 얼굴을 하는가.
 *
 * **벽과 「지금은 못 간다」를 가른다.** 벽은 어둡게 두고 눌리지도
 * 않는다. 갈 수는 있는데 값이 모자란 쪽은 멀쩡하게 두고, 누르면
 * 까닭을 한 줄로 말한다 — 둘을 같이 어둡게 하면 방에 갇힌 것처럼
 * 보인다.
 *
 * 값은 문·계단을 넘는 쪽에만, 페이즈 중에만 붙는다. 방 안에서 한 칸
 * 옮기는 데는 아무것도 안 든다.
 *
 * 순수 함수로 빼 둔다. 브라우저를 띄우지 않고 시험할 수 있어야 한다.
 */
export function padFace(
  ways: Readonly<Record<Dir, 'shut' | 'open' | 'door'>>,
  phaseOpen: boolean,
  tokensLeft: number,
  cost: number,
): Record<Dir, DirState> {
  const one = (w: 'shut' | 'open' | 'door'): DirState => {
    if (w === 'shut') return { open: false }
    if (!phaseOpen || w !== 'door') return { open: true }
    return {
      open: true,
      cost,
      why: tokensLeft < cost ? '페이즈 토큰이 없다 — 이번 교시에는 못 옮긴다' : undefined,
    }
  }
  return { up: one(ways.up), down: one(ways.down), left: one(ways.left), right: one(ways.right) }
}

/**
 * 십자 다섯 칸.
 *
 * 여태 ↑ 하나에 ← ↓ → 가 한 줄로 붙어 있었다. 엄지로 더듬어 누르는
 * 물건인데 모양이 십자가 아니면 손이 자리를 못 외운다.
 *
 * 가운데 칸은 비워 둔다 — 눌러도 아무 일도 안 일어난다. 그 자리가
 * 비어 있어야 나머지 넷이 십자로 읽힌다.
 *
 * **data-dir 은 지도가 읽는다.** 생김새는 여기서 정하고 걸음은
 * 지도가 가져간다(Walk 의 padRef).
 */
export function Pad({
  padRef,
  dirs,
  onBlocked,
}: {
  padRef: RefObject<HTMLDivElement | null>
  dirs: Partial<Record<Dir, DirState>>
  onBlocked: (why: string) => void
}) {
  const one = (dir: Dir, arrow: string, label: string) => {
    const d = dirs[dir]
    const shut = d !== undefined && !d.open
    return (
      <button
        data-dir={shut || d?.why ? undefined : dir}
        className={`sc-ct__key is-${dir}${shut ? ' is-shut' : ''}`}
        aria-label={label}
        aria-disabled={shut}
        onPointerDown={() => {
          if (shut) return
          if (d?.why) {
            onBlocked(d.why)
            return
          }
          buzz('step')
        }}
      >
        <span>{arrow}</span>
        {d?.cost !== undefined && !shut && <em>{d.cost}</em>}
      </button>
    )
  }
  return (
    <div className="sc-ct__pad" ref={padRef}>
      {one('up', '↑', '위')}
      {one('left', '←', '왼쪽')}
      <span className="sc-ct__key is-mid" aria-hidden="true" />
      {one('right', '→', '오른쪽')}
      {one('down', '↓', '아래')}
    </div>
  )
}

// ── 행동 여섯 ───────────────────────────────────────────────────

export interface Act {
  key: string
  icon: string
  label: string
  /** 토큰 값. 없으면 안 든다 */
  cost?: number
  /** 못 하는 까닭. 있으면 흐리게 두고 누르면 한 줄로 알려 준다 */
  why?: string
  run: () => void
}

/**
 * 3열 2행.
 *
 * **지금 이 방에서 되는 것이 앞 칸에 온다.** 상점에 서 있으면 「구매」가
 * 첫 칸이고, 그렇지 않으면 그 칸은 다른 것이 쓴다. 여섯을 넘치면
 * 나머지는 더보기 시트로 간다 — 잘라 버리지 않는다.
 */
export function ActionGrid({ acts, onBlocked }: { acts: readonly Act[]; onBlocked: (why: string) => void }) {
  return (
    <div className="sc-ct__acts" role="group" aria-label="할 수 있는 일">
      {acts.map((a) => (
        <button
          key={a.key}
          className={`sc-ct__act${a.why ? ' is-off' : ''}`}
          aria-disabled={a.why !== undefined}
          onClick={() => {
            if (a.why) {
              onBlocked(a.why)
              return
            }
            buzz('act')
            a.run()
          }}
        >
          <img src={uiIcon(a.icon)} alt="" width={16} height={16} />
          <span>
            {a.label}
            {a.cost !== undefined && <em>{a.cost}</em>}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── 탭바 ────────────────────────────────────────────────────────

export interface TabDef {
  key: string
  icon: string
  label: string
  /** 볼 것이 새로 생겼다 — 아이콘 모서리에 점 하나 */
  dot?: boolean
}

export function TabBar({
  tabs,
  now,
  onPick,
}: {
  tabs: readonly TabDef[]
  now: string
  onPick: (key: string) => void
}) {
  return (
    <nav className="sc-ct__tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`sc-ct__tab${t.key === now ? ' is-on' : ''}`}
          aria-current={t.key === now ? 'page' : undefined}
          onClick={() => onPick(t.key)}
        >
          <span className="sc-ct__tabIcon">
            <img src={uiIcon(t.icon)} alt="" width={16} height={16} />
            {t.dot && <i className="sc-ct__dot" />}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

// ── 한 줄 알림 ──────────────────────────────────────────────────

/**
 * 못 하는 까닭 한 줄.
 *
 * **막힌 단추를 회색으로만 두면 왜 막혔는지 알 길이 없다.** 눌러 보는
 * 것이 사람이 아는 유일한 방법인데, 눌러도 아무 일이 없으면 고장난
 * 줄 안다. 그래서 막힌 단추도 눌리고, 눌리면 까닭을 말한다.
 */
export function Toast({ text }: { text: string | null }): ReactNode {
  if (!text) return null
  return <p className="sc-ct__toast">{text}</p>
}

export function useToast(): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef(0)
  const show = (t: string) => {
    setText(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(null), 2400)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [text, show]
}
