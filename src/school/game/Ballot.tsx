// 오늘의 투명인간 — 투표용지 한 장.
//
// **신뢰·호감 표와는 다른 화면이다.** 그쪽은 마주 서야 주는 호의고,
// 이쪽은 만나지 않고 하는 배제다. 한 화면에 담으면 「좋아한다」와
// 「지워라」가 같은 목록에 나란히 선다.
//
// 기권 단추는 없다. 마감 전까지 몇 번이든 바꿀 수 있고, 마지막에 적은
// 이름만 남는다. **누가 누구를 적었는지는 나에게도 내 것만 보인다.**
//
// ── 왜 연출을 넣었나 ────────────────────────────────────────
// 목록에서 이름을 누르고 끝나면 표를 던진 일이 설거지 같아진다.
// 접어서 넣는 데 1.4초가 걸리고, 그동안 화면이 다른 것을 못 하게
// 막는다. **되돌릴 수 없는 일에는 시간이 들어야 한다.**
//
// 다만 연출은 연출일 뿐이다. **서버에는 단추를 누른 그 순간 보낸다** —
// 다 접히기를 기다렸다가 보내면, 그 사이에 앱이 꺼진 사람의 표가
// 사라진다. 서버가 거절하면 그때 되감는다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { VOTE_FOOT, VOTE_TITLE, murmursUpTo } from '../../../shared/story/vote'
import { josa } from '../../../shared/text'
import { BOX_H, FOLD_FRAMES, SLOT_Y, boxSprite, boxWidthFor, foldSheet } from './boxArt'
import { PaperSheet } from './Paper'
import { SFX, armSfx } from './sfx'
import { buzzOn, motionOff } from './Controls'
import type { GameActions } from './useGame'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'

/**
 * 투표함이 올라올 때 종이가 밀려 올라가는 높이(css px).
 *
 * 크게 잡으면 667 짜리 화면에서 종이가 맨 윗줄을 덮는다. 밀려났다는
 * 것만 보이면 되므로 24 면 충분하다.
 */
const LIFT = 24
/** 투표함의 화면 높이(css px). 도트 1 배를 정확히 2 배로 늘린다. */
const BOX_PX = BOX_H * 2

/** 지금 무엇이 보이는가. 숫자는 스프라이트 시트의 몇 번째 칸인가. */
type Show = 'paper' | 'half' | 0 | 1 | 2 | 3 | 'gone'

/** 한 박. 무엇을 그리고 얼마나 머무는가. */
interface Beat {
  ms: number
  /** 투표함이 화면 아래에서 올라온 높이(css px). */
  box: number
  /** 종이가 밀려 올라간 높이(css px). */
  lift: number
  show: Show
  /** 접힌 조각이 날아가는 단계(0‥4). null 이면 제자리. */
  fly?: number
  /** 흔들림(css px). 도트가 뭉개지지 않게 정수만 쓴다. */
  jx?: number
  jy?: number
  /** 투표함이 한 번 흔들린다. */
  hit?: boolean
  sfx?: 'fold' | 'drop'
}

/**
 * 넣는 연출. 전부 1.4초다.
 *
 * 프레임 사이를 보간하지 않는다 — 한 박이 통째로 한 그림이고, 다음
 * 박에서 통째로 갈린다. 도트 그림에서 중간 값을 만들면 화소가 흐려진다.
 */
const CAST: readonly Beat[] = [
  // 1 · 투표함이 올라온다 (0.3초)
  { ms: 75, box: 36, lift: 6, show: 'paper' },
  { ms: 75, box: 74, lift: 13, show: 'paper' },
  { ms: 75, box: 112, lift: 19, show: 'paper' },
  { ms: 75, box: BOX_PX, lift: LIFT, show: 'paper' },
  // 2 · 접는다 (0.5초). 여섯 장 — 앞의 둘은 진짜 종이를 깎아 내고,
  //     뒤의 넷은 미리 구워 둔 그림으로 갈아 끼운다
  { ms: 60, box: BOX_PX, lift: LIFT, show: 'paper' },
  { ms: 100, box: BOX_PX, lift: LIFT, show: 'half', jx: 1, sfx: 'fold' },
  { ms: 90, box: BOX_PX, lift: LIFT, show: 0, jx: -1, jy: 1 },
  { ms: 90, box: BOX_PX, lift: LIFT, show: 1, jy: -1, sfx: 'fold' },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 2, jx: 1, jy: 1 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3 },
  // 3 · 넣는다 (0.4초)
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 0 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 1 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 2 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 3, hit: true, sfx: 'drop' },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 4 },
  // 4 · 내려간다 (0.2초)
  { ms: 70, box: 96, lift: 16, show: 'gone' },
  { ms: 70, box: 48, lift: 7, show: 'gone' },
  { ms: 60, box: 0, lift: 0, show: 'gone' },
]

/** 다시 꺼내는 연출. 0.6초로 줄인다 — 되돌리는 일에 뜸을 들일 것 없다. */
const UNDO: readonly Beat[] = [
  { ms: 60, box: BOX_PX, lift: LIFT, show: 'gone' },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 3 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3, fly: 1 },
  { ms: 80, box: BOX_PX, lift: LIFT, show: 3 },
  { ms: 70, box: BOX_PX, lift: LIFT, show: 1, jx: 1, sfx: 'fold' },
  { ms: 70, box: BOX_PX, lift: LIFT, show: 'half', jx: -1 },
  { ms: 80, box: 72, lift: 12, show: 'paper' },
  { ms: 80, box: 0, lift: 0, show: 'paper' },
]

interface Geo {
  home: { x: number; y: number }
  mouth: { x: number; y: number }
  slotY: number
  sw: number
  sh: number
}

/** 날아가는 다섯 자리. 집 → 투입구 → 슬롯 안. */
function flyAt(step: number, g: Geo): { x: number; y: number } {
  if (step <= 1) {
    const t = step === 0 ? 0.35 : 0.72
    return {
      x: Math.round(g.home.x + (g.mouth.x - g.home.x) * t),
      y: Math.round(g.home.y + (g.mouth.y - g.home.y) * t),
    }
  }
  if (step === 2) return g.mouth
  if (step === 3) return { x: g.mouth.x, y: g.slotY - Math.round(g.sh / 2) }
  return { x: g.mouth.x, y: g.slotY + 6 }
}

export interface BallotProps {
  me: SeatEntry
  seats: readonly SeatEntry[]
  /** 오늘 팀장들. 팀장은 적을 수 없다. */
  captainIds: readonly string[]
  /** 어제 지워진 사람. 이틀 연속은 없다. */
  invisibleId: string | null
  day: number
  view: PlayerViewDoc | null
  act: GameActions
  onSaid: (text: string) => void
  /** 오늘 표가 이미 집계됐는가. 마지막 교시가 닫히면 끝이다. */
  closed: boolean
  /** 마감까지 몇 분. 언제 닫힐지 모르면 null 이다. */
  closesInMin: number | null
  /** 종이 위에 얹는 줄. 팀장 판이 여기로 들어온다. */
  head?: ReactNode
}

export function Ballot(props: BallotProps) {
  const { me, seats, captainIds, invisibleId, day, view, act, onSaid, closed, closesInMin } = props
  const mine = view?.myBallot ?? null

  const [pick, setPick] = useState<string | null>(null)
  /** 이미 넣은 표를 다시 꺼내 펴 놓았는가. */
  const [open, setOpen] = useState(false)
  /** 지금 재생 중인 박. -1 이면 연출이 없다. */
  const [beat, setBeat] = useState(-1)
  const [script, setScript] = useState<readonly Beat[]>(CAST)
  /** 방금 넣었다 — 한 줄만 띄우는 짧은 사이. */
  const [just, setJust] = useState(false)
  const [oops, setOops] = useState(false)
  /**
   * 서버가 물린 이름들.
   *
   * 화면이 아는 팀장은 **우리 팀 팀장뿐이다.** 다른 팀 팀장은 누구인지
   * 안 내려오므로 종이에는 그대로 올라오고, 적고 나서야 물린다. 그럼
   * 같은 이름을 또 누르게 되므로 물린 것은 기억해 둔다.
   */
  const [refused, setRefused] = useState<readonly string[]>([])

  const stageRef = useRef<HTMLDivElement>(null)
  const midRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<Geo | null>(null)
  const timer = useRef<number | null>(null)

  // 적을 수 있는 사람만 종이에 오른다. 나, 팀장, 어제 지워진 사람은 빠진다
  const named = useMemo(
    () =>
      seats.filter(
        (s) => s.playerId !== me.playerId && !captainIds.includes(s.playerId) && s.playerId !== invisibleId,
      ),
    [seats, me.playerId, captainIds, invisibleId],
  )

  const chosen = pick ?? mine
  const chosenName = named.find((s) => s.playerId === chosen)?.name ?? null
  const playing = beat >= 0
  // 넣어 둔 표가 있고 다시 펴지 않았으면 투표함만 보인다
  const shut = mine !== null && !open && !playing

  // ── 종이 크기 ──────────────────────────────────────────────
  // 가로는 화면의 84%. **짝수로 떨군다** — 도트를 정확히 2 배로 늘리려면
  // 1 배 화소 수가 정수여야 한다. 홀수면 한 줄이 1.5 화소가 된다
  const [wide, setWide] = useState(0)
  const [tall, setTall] = useState(0)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => setWide(Math.max(160, Math.round((el.clientWidth * 0.84) / 2) * 2))
    fit()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = paperRef.current
    if (!el) return
    const h = Math.round(el.offsetHeight / 2) * 2
    if (h > 0 && h !== tall) setTall(h)
  }, [wide, named.length, day, tall, shut])

  // 스프라이트 시트는 크기가 정해지는 즉시 굽는다. 단추를 누른 뒤에
  // 구우면 첫 접힘에서 한 박 밀린다
  const sheet = useMemo(() => (wide > 0 && tall > 0 ? foldSheet(wide / 2, tall / 2) : ''), [wide, tall])

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  // ── 연출 ──────────────────────────────────────────────────
  /**
   * 종이가 있는(또는 있을) 자리를 잰다.
   *
   * **종이를 직접 재지 않는다.** 넣어 둔 상태에서는 종이가 자리를
   * 비켜 서 있어서(is-away) 제자리가 아니다 — 그걸 재면 다시 꺼내는
   * 연출이 엉뚱한 데서 시작한다. 가운데 칸은 위아래로 늘 같은 자리에
   * 있으므로, 거기에서 가운데를 계산한다.
   */
  function measure(): Geo | null {
    const st = stageRef.current?.getBoundingClientRect()
    const mid = midRef.current?.getBoundingClientRect()
    if (!st || !mid) return null
    const sw = wide / 2
    const sh = tall / 2
    const slotY = Math.round(st.height - BOX_PX + SLOT_Y * 2)
    return {
      home: {
        x: Math.round(mid.left - st.left + (mid.width - wide) / 2),
        y: Math.round(mid.top - st.top + (mid.height - tall) / 2 - LIFT),
      },
      mouth: { x: Math.round(st.width / 2 - sw / 2), y: slotY - sh + 2 },
      slotY,
      sw,
      sh,
    }
  }

  function play(list: readonly Beat[], done: () => void) {
    geoRef.current = measure()
    setScript(list)
    let i = 0
    const step = () => {
      if (i >= list.length) {
        setBeat(-1)
        done()
        return
      }
      const b = list[i]
      setBeat(i)
      if (b.sfx === 'fold') SFX.fold()
      if (b.sfx === 'drop') {
        SFX.drop()
        if (buzzOn()) navigator.vibrate?.(14)
      }
      i += 1
      timer.current = window.setTimeout(step, b.ms)
    }
    step()
  }

  function cast() {
    if (!chosen || playing) return
    armSfx()
    setOops(false)
    // **서버에는 지금 보낸다.** 연출이 끝나기를 기다리지 않는다.
    // 거절도 그 자리에서 받아 둔다 — 1.4초 동안 떠도는 약속을 두면
    // 그사이에 화면을 떠났을 때 처리되지 않은 거절로 남는다
    const sent: Promise<Error | null> = act
      .castBallot(chosen)
      .then(() => null)
      .catch((e: unknown) => e as Error)

    const settle = (err: Error | null, rewind: boolean) => {
      if (err === null) {
        setOpen(false)
        setPick(null)
        setJust(true)
        window.setTimeout(() => setJust(false), 1600)
        return
      }
      onSaid(err.message)
      setRefused((xs) => (xs.includes(chosen) ? xs : [...xs, chosen]))
      setPick(null)
      // 못 넣었으면 되감는다. 넣은 척 두면 다음 사람이 뽑힌다
      if (rewind) play(UNDO, () => { setOpen(true); setOops(true) })
      else { setOpen(true); setOops(true) }
    }

    if (motionOff()) {
      void sent.then((err) => settle(err, false))
      return
    }
    play(CAST, () => { void sent.then((err) => settle(err, true)) })
  }

  function undo() {
    if (playing) return
    armSfx()
    setPick(mine)
    if (motionOff()) {
      setOpen(true)
      return
    }
    play(UNDO, () => setOpen(true))
  }

  // ── 그리기 ────────────────────────────────────────────────
  const now: Beat | null = playing ? script[beat] : null
  const show: Show = now ? now.show : shut || closed ? 'gone' : 'paper'
  // 쉬고 있을 때의 투표함은 화면 가운데에 선다. 연출 중에만 아래에서 오르내린다
  const boxUp = now ? now.box : 0
  const resting = !playing && !just && (shut || closed)
  const lift = now ? now.lift : 0
  const g = geoRef.current
  const fly = now?.fly != null && g ? flyAt(now.fly, g) : null

  const rows = Math.ceil(Math.max(named.length, 1) / 2)
  const sheetW = wide * FOLD_FRAMES
  // 접힌 종이 가로(1 배)에서 통 가로가 나온다. **종이보다 좁으면
  // 종이가 통을 뚫고 들어가는 그림이 된다**
  const slipW1 = Math.ceil(wide / 2 / 2)
  const boxW1 = boxWidthFor(slipW1)
  const boxCss = { w: boxW1 * 2, h: BOX_PX }

  return (
    <div className="sc-bt" ref={stageRef} style={{ ['--bt-w' as string]: `${wide}px` }}>
      <p className="sc-bt__top">
        DAY {day} · {VOTE_TITLE}
      </p>
      {props.head}

      <div className="sc-bt__mid" ref={midRef}>
        {/* 종이. 연출 중에는 깎이고, 넣고 나면 아예 빠진다 */}
        <div
          className={
            'sc-bt__hold' +
            (show === 'half' ? ' is-half' : '') +
            /* 감출 때도 **레이아웃에서는 안 뺀다.** display:none 이면 높이가
               0 이 되어 접힘 그림을 구울 크기를 알 수 없다 */
            (show === 'paper' || show === 'half' ? '' : ' is-away')
          }
          style={{ transform: `translate3d(${now?.jx ?? 0}px, ${-lift + (now?.jy ?? 0)}px, 0)` }}
        >
          <div className="sc-bt__paper" ref={paperRef}>
            <PaperSheet cls="sc-bt" />
            <div className="sc-bt__in">
              <p className="sc-bt__label">투 표 용 지</p>
              <span className="sc-bt__fold" aria-hidden="true" />
              <ul className="sc-bt__names" style={{ ['--bt-rows' as string]: rows }}>
                {named.map((s) => (
                  <li key={s.playerId}>
                    <button
                      type="button"
                      className={
                        'sc-bt__name' +
                        (chosen === s.playerId ? ' is-on' : '') +
                        (refused.includes(s.playerId) ? ' is-no' : '')
                      }
                      disabled={playing || closed || refused.includes(s.playerId)}
                      aria-pressed={chosen === s.playerId}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPick(s.playerId)}
                    >
                      <span>{s.name}</span>
                      <i aria-hidden="true">{refused.includes(s.playerId) ? '✕' : '✓'}</i>
                    </button>
                  </li>
                ))}
              </ul>
              {/* 날마다 한 줄씩 늘어난다. 늘어나는 것 자체가 이 게임이
                  하려는 말이라, 종이 위에 연필로 적힌 것처럼 둔다 */}
              <div className="sc-bt__murmur">
                {murmursUpTo(day).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <p className="sc-bt__foot">{VOTE_FOOT}</p>
            </div>
          </div>
          {/* 첫 번째 접힘. 오른쪽 절반이 넘어오면서 뒷면이 보인다 */}
          {show === 'half' && (
            <>
              <span className="sc-bt__back" aria-hidden="true" />
              <span className="sc-bt__line" aria-hidden="true" />
            </>
          )}
        </div>

        {/* 한 줄만 남는 사이. 투표함도 종이도 없다 */}
        {just && !playing && (
          <p className="sc-bt__done" aria-live="polite">
            넣었다.
          </p>
        )}

        {/* 넣고 난 뒤 · 마감된 뒤. 닫힌 투표함 하나만 남는다 */}
        {resting && (
          <span
            className="sc-bt__rest"
            aria-hidden="true"
            style={{
              width: `${boxCss.w}px`,
              height: `${boxCss.h}px`,
              backgroundSize: `${boxCss.w}px ${boxCss.h}px`,
              backgroundImage: `url(${boxSprite(closed ? 'lock' : 'shut', boxW1)})`,
            }}
          />
        )}
        {resting && (
          <p className="sc-bt__done" aria-live="polite">
            {closed ? '마감되었다' : '이미 넣었다.'}
            {!closed && closesInMin !== null && <em>마감까지 {closesInMin}분</em>}
          </p>
        )}

      </div>

      {/* 다 접힌 뒤. 미리 구워 둔 네 장을 갈아 끼운다.
          **무대 바로 아래에 둔다** — 가운데 칸 안에 두면 위의 한 줄만큼
          자리가 밀리고, 구르는 칸이라 잘리기까지 한다 */}
      {typeof show === 'number' && fly === null && g && (
        <span
          className="sc-bt__slip"
          aria-hidden="true"
          style={{
            width: `${wide}px`,
            height: `${tall}px`,
            transform: `translate3d(${g.home.x + (now?.jx ?? 0)}px, ${g.home.y + (now?.jy ?? 0)}px, 0)`,
            backgroundImage: `url(${sheet})`,
            backgroundSize: `${sheetW}px ${tall}px`,
            backgroundPosition: `${-wide * show}px 0`,
          }}
        />
      )}

      {/* 투입구 아래로는 안 보인다. 잘라 내는 자리다 */}
      {g && typeof show === 'number' && fly && (
        <div className="sc-bt__air" style={{ height: `${g.slotY}px` }} aria-hidden="true">
          {(
            <span
              className="sc-bt__slip"
              style={{
                width: `${g.sw}px`,
                height: `${g.sh}px`,
                transform: `translate3d(${fly.x}px, ${fly.y}px, 0)`,
                backgroundImage: `url(${sheet})`,
                backgroundSize: `${sheetW}px ${tall}px`,
                backgroundPosition: `${-wide * show}px 0`,
              }}
            />
          )}
        </div>
      )}

      {/* 투표함. 연출 중에는 화면 아래에서 오르내리고, 쉴 때는 가운데에 선다 */}
      {playing && (
        <span
          className={`sc-bt__box${now?.hit ? ' is-hit' : ''}`}
          aria-hidden="true"
          style={{
            width: `${boxCss.w}px`,
            height: `${boxCss.h}px`,
            backgroundSize: `${boxCss.w}px ${boxCss.h}px`,
            marginLeft: `${-boxCss.w / 2 + (now?.hit ? 1 : 0)}px`,
            transform: `translate3d(0, ${BOX_PX - boxUp}px, 0)`,
            backgroundImage: `url(${boxSprite(show === 'gone' && boxUp > 0 ? 'shut' : 'open', boxW1)})`,
          }}
        />
      )}

      {/* 아래에 남는 한 줄 */}
      <div className={`sc-bt__base${playing ? ' is-play' : ''}`}>
        {/* 마감된 뒤에는 아래에 아무것도 안 둔다. 눌러도 안 되는 단추를
            남겨 두면 눌러 보게 된다 */}
        {closed ? null : shut ? (
          <button type="button" className="sc-bt__again" onMouseDown={(e) => e.preventDefault()} onClick={undo}>
            다시 넣기
          </button>
        ) : (
          <button
            type="button"
            className="sc-bt__go"
            disabled={!chosen || playing}
            onMouseDown={(e) => e.preventDefault()}
            onClick={cast}
          >
            {chosen ? '접 어 서 넣 기' : '이름을 고르세요'}
          </button>
        )}
        {oops && !playing && <p className="sc-bt__oops">넣지 못했다</p>}
        {!closed && !shut && !just && chosenName && (
          <p className="sc-bt__picked">「{chosenName}」{josa(chosenName, '이라고/라고')} 적혀 있다</p>
        )}
      </div>
    </div>
  )
}
