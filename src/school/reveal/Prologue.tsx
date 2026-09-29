// 프롤로그 — 가입하고 나를 만든 직후 한 번 도는 장면.
//
//   화면 1 · 2 · 3 → (2초 정적 · 3초 암전 · 1초 정적) → 칠판
//
// **본문은 shared/reveal/prologue.ts 에 있다.** 한 글자도 여기서 만지지
// 않는다. 이 파일은 그 글을 어떤 박자로 내놓는지만 안다.
//
// 박자
//   - 문단 단위로 나온다. 한 문단 안은 글자마다 찍히고(초당 20자),
//     다 찍히면 0.6초 쉬고 다음 문단
//   - 탭하면 그 화면의 남은 글자가 한 번에 나온다. 다 나온 뒤의 탭이
//     다음 화면이다. 「▼」가 깜빡이며 그것을 알린다
//   - 화면 3 은 「▼」가 없다. 마지막 줄 뒤 2초 아무것도 안 하고, 3초에
//     걸쳐 어두워지고, 1초 정적 뒤 칠판이 올라온다
//   - 칠판 글씨는 초당 4자. **탭해도 안 빨라진다.** 다 적히면 3초 그대로
//     두고 「들어간다」가 나온다. 칠판에는 건너뛰기가 없다
//
// 연출 줄이기(기기 · 앱)면 타자와 페이드 없이 문단이 한 번에 뜬다. 칠판
// 글씨도 한 번에. 눈은 멈추지 않고 성기게 내린다.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import {
  BOARD_FRAME_MS,
  CHALK_HOLD_MS,
  CHALK_LINE,
  CHALK_MS_PER_CHAR,
  DARKEN_MS,
  HUSH_MS,
  PARAGRAPH_GAP_MS,
  PROLOGUE_MS_PER_CHAR,
  PROLOGUE_SCREENS,
  SCREEN_FADE_MS,
  SILENCE_MS,
} from '../../../shared/reveal/prologue'
import { motionOff } from '../game/Controls'
import { SFX, armSfx, startSnowAmbient, stopSnowAmbient } from '../game/sfx'
import { Snow } from './Snow'
import './prologue.css'

type Stage =
  | 'screen'
  /** 화면 3 을 다 찍은 뒤 가만히 있는 2초 */
  | 'hush'
  /** 3초에 걸쳐 검게 */
  | 'dark'
  /** 다 어두워진 뒤 1초 */
  | 'silence'
  /** 칠판이 올라온다(세 프레임) */
  | 'board'
  /** 분필이 적는다 */
  | 'chalk'
  /** 다 적힌 뒤 3초 */
  | 'hold'
  /** 「들어간다」 */
  | 'ready'

const LAST = PROLOGUE_SCREENS.length - 1

/**
 * 한 줄을 문장으로 나눈다 — 뒤 문장이 앞의 띄어쓰기를 들고 간다.
 * 문장마다 한 덩어리로 줄을 바꾸게 해서, 좁은 폭에서 「무엇을 / 기다렸는지는」
 * 처럼 문장 한가운데가 끊기지 않게 한다. 글자 수는 원문과 같다.
 */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.,]) (?=\S)/)
}
const lenOf = (para: readonly string[]): number => para.reduce((a, l) => a + l.length, 0)

export interface PrologueProps {
  /** 칠판의 「들어간다」를 눌렀다 */
  onDone: () => void
}

export function Prologue({ onDone }: PrologueProps) {
  const [still] = useState(motionOff)
  const [stage, setStage] = useState<Stage>('screen')
  const [screen, setScreen] = useState(0)
  /** 지금 찍는 문단과 그 문단에서 찍힌 글자 수 */
  const [para, setPara] = useState(0)
  const [chars, setChars] = useState(0)
  /** 문단 사이 0.6초를 쉬는 중인가 */
  const [resting, setResting] = useState(false)
  /** 화면이 나가는 중(0.3초) */
  const [leaving, setLeaving] = useState(false)
  const [boardFrame, setBoardFrame] = useState(0)
  const [chalked, setChalked] = useState(0)
  const goRef = useRef<HTMLButtonElement | null>(null)

  const paras = PROLOGUE_SCREENS[screen]
  const lastPara = paras.length - 1
  const complete = para >= lastPara && chars >= lenOf(paras[lastPara])

  // ── 소리 ── 손끝이 닿은 뒤에만. 칠판이 오르면 바람은 사그라든다
  useEffect(() => () => stopSnowAmbient(), [])
  useEffect(() => {
    if (stage === 'board') stopSnowAmbient()
  }, [stage])
  const touched = useCallback(() => {
    armSfx()
    if (stage === 'screen' || stage === 'hush' || stage === 'dark') startSnowAmbient()
  }, [stage])

  // ── 연출 줄이기면 첫 화면도 다 찍힌 채로 연다(다음 화면은 openScreen 이 한다) ──
  useEffect(() => {
    if (stage === 'screen' && still && screen === 0 && para === 0 && chars === 0) {
      const ps = PROLOGUE_SCREENS[0]
      setPara(ps.length - 1)
      setChars(lenOf(ps[ps.length - 1]))
    }
  }, [stage, still, screen, para, chars])

  // ── 타자 ──
  useEffect(() => {
    if (stage !== 'screen' || leaving || complete || !paras[para]) return
    const here = lenOf(paras[para])
    if (chars < here) {
      const t = window.setTimeout(() => setChars((c) => c + 1), PROLOGUE_MS_PER_CHAR)
      return () => window.clearTimeout(t)
    }
    // 이 문단은 끝났다. 쉬었다가 다음 문단
    setResting(true)
    const t = window.setTimeout(() => {
      setResting(false)
      setPara((p) => p + 1)
      setChars(0)
    }, PARAGRAPH_GAP_MS)
    return () => window.clearTimeout(t)
  }, [stage, leaving, complete, chars, para, paras])

  // ── 화면 3 을 다 찍었다 → 정적 · 암전 · 정적 · 칠판 ──
  useEffect(() => {
    if (stage === 'screen' && screen === LAST && complete) setStage('hush')
  }, [stage, screen, complete])
  useEffect(() => {
    const next: Partial<Record<Stage, [Stage, number]>> = {
      hush: ['dark', HUSH_MS],
      // 줄이기면 페이드가 없다 — 곧장 검다
      dark: ['silence', still ? 0 : DARKEN_MS],
      silence: ['board', SILENCE_MS],
    }
    const step = next[stage]
    if (!step) return
    const t = window.setTimeout(() => setStage(step[0]), step[1])
    return () => window.clearTimeout(t)
  }, [stage, still])

  // ── 칠판이 세 프레임에 걸쳐 올라온다 ──
  useEffect(() => {
    if (stage !== 'board') return
    if (still) {
      setBoardFrame(3)
      setStage('chalk')
      return
    }
    if (boardFrame >= 3) {
      setStage('chalk')
      return
    }
    const t = window.setTimeout(() => setBoardFrame((f) => f + 1), BOARD_FRAME_MS)
    return () => window.clearTimeout(t)
  }, [stage, boardFrame, still])

  // ── 분필 — 초당 4자, 탭해도 안 빨라진다 ──
  useEffect(() => {
    if (stage !== 'chalk') return
    if (still) {
      setChalked(CHALK_LINE.length)
      setStage('hold')
      return
    }
    if (chalked >= CHALK_LINE.length) {
      setStage('hold')
      return
    }
    const t = window.setTimeout(() => {
      // 빈칸은 긁지 않는다
      if (CHALK_LINE[chalked] !== ' ') SFX.chalk()
      setChalked((c) => c + 1)
    }, CHALK_MS_PER_CHAR)
    return () => window.clearTimeout(t)
  }, [stage, chalked, still])
  useEffect(() => {
    if (stage !== 'hold') return
    const t = window.setTimeout(() => setStage('ready'), CHALK_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [stage])
  useEffect(() => {
    if (stage === 'ready') goRef.current?.focus({ preventScroll: true })
  }, [stage])

  // ── 탭 ──
  /**
   * 다음 화면. **화면과 찍힌 자리를 한 번에 바꾼다** — 화면만 먼저 바꾸면
   * 한 박자 동안 앞 화면의 문단 번호로 새 화면을 읽어서(문단이 셋이던
   * 화면 1 → 둘인 화면 2) 없는 문단을 찾다가 장면이 통째로 무너졌다.
   */
  const openScreen = useCallback(
    (n: number) => {
      const ps = PROLOGUE_SCREENS[n]
      setScreen(n)
      setPara(still ? ps.length - 1 : 0)
      setChars(still ? lenOf(ps[ps.length - 1]) : 0)
      setResting(false)
    },
    [still],
  )
  const nextScreen = useCallback(() => {
    if (still) {
      openScreen(screen + 1)
      return
    }
    setLeaving(true)
    window.setTimeout(() => {
      openScreen(screen + 1)
      setLeaving(false)
    }, SCREEN_FADE_MS)
  }, [still, screen, openScreen])

  const tap = useCallback(() => {
    if (stage !== 'screen' || leaving) return
    if (!complete) {
      // 남은 글자를 한 번에
      setPara(lastPara)
      setChars(lenOf(paras[lastPara]))
      setResting(false)
      return
    }
    if (screen < LAST) nextScreen()
  }, [stage, leaving, complete, lastPara, paras, screen, nextScreen])

  const skip = useCallback(() => {
    // 칠판 앞에서 멈춘다 — 칠판은 건너뛸 수 없다
    setStage('board')
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    e.preventDefault()
    touched()
    tap()
  }

  const onScreens = stage === 'screen' || stage === 'hush' || stage === 'dark'
  const onBoard = stage === 'board' || stage === 'chalk' || stage === 'hold' || stage === 'ready'
  const canSkip = stage === 'screen' || stage === 'hush' || stage === 'dark' || stage === 'silence'

  return (
    <div
      className={'sc-pg' + (still ? ' is-still' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="프롤로그"
      tabIndex={-1}
      onPointerDown={touched}
      onKeyDown={onKey}
    >
      {/* 줄이기면 성기게, 그래도 내린다 */}
      <Snow level={still ? 1 : 3} always />

      {onScreens && (
        <div
          key={screen}
          className={'sc-pg__screen' + (leaving ? ' is-leaving' : '')}
          onClick={tap}
          aria-live="polite"
        >
          {/*
            **아직 안 나온 문단도 자리를 잡아 둔다**(보이지 않게). 안 그러면
            문단이 하나 뜰 때마다 가운데 맞춘 글 전체가 위로 밀린다.
          */}
          {paras.map((lines, pi) => {
            // 이 문단에서 몇 글자까지 보이는가. 앞 문단은 다 보이고 뒷 문단은 하나도 안 보인다
            let left = pi < para ? Infinity : pi > para ? 0 : chars
            return (
              <p key={pi} className="sc-pg__para" aria-hidden={pi > para || undefined}>
                {lines.map((line, li) => (
                  <span key={li} className="sc-pg__line">
                    {sentencesOf(line).map((seg, si) => {
                      // 문장 사이 띄어쓰기도 한 글자다. 덩어리 **밖에** 둬야 거기서 줄이 바뀐다
                      if (si > 0) left -= 1
                      const take = Math.max(0, Math.min(seg.length, left))
                      left -= seg.length
                      return (
                        <Fragment key={si}>
                          {si > 0 && ' '}
                          <span className="sc-pg__seg">
                            {seg.slice(0, take)}
                            {/* 자리를 미리 잡는다 — 찍히는 동안 줄이 안 밀린다 */}
                            <span className="sc-pg__ghost" aria-hidden>
                              {seg.slice(take)}
                            </span>
                          </span>
                        </Fragment>
                      )
                    })}
                  </span>
                ))}
              </p>
            )
          })}
          {/* 「▼」는 다 나왔고 다음 화면이 있을 때만. 화면 3 에는 없다 */}
          {stage === 'screen' && complete && !resting && screen < LAST && !leaving && (
            <span className="sc-pg__more" aria-hidden>
              ▼
            </span>
          )}
        </div>
      )}

      {/* 암전. 화면 3 위로 검은 막이 3초에 걸쳐 덮인다 */}
      <div className={'sc-pg__veil' + (stage === 'dark' || stage === 'silence' || onBoard ? ' is-on' : '')} aria-hidden />

      {onBoard && (
        <div className="sc-pg__stage">
          <div className={`sc-pg__board is-f${boardFrame}`}>
            <span className="sc-pg__slate">
              <span className="sc-pg__chalk" aria-label={CHALK_LINE}>
                <span aria-hidden>{CHALK_LINE.slice(0, chalked)}</span>
                <span className="sc-pg__ghost" aria-hidden>
                  {CHALK_LINE.slice(chalked)}
                </span>
              </span>
            </span>
            <span className="sc-pg__tray" aria-hidden>
              <i />
            </span>
          </div>
          {stage === 'ready' && (
            <button type="button" ref={goRef} className="sc-pg__go" onClick={onDone}>
              들어간다
            </button>
          )}
        </div>
      )}

      {canSkip && (
        <button type="button" className="sc-pg__skip" onClick={skip}>
          건너뛰기
        </button>
      )}
    </div>
  )
}

/**
 * 「프롤로그 다시 보기」 단추. 누르면 화면 1 부터 다시 돈다.
 *
 * 다시 봐도 「봤다」는 안 건드린다 — 이미 봤다.
 */
export function ReplayPrologue({ onOpen }: { onOpen?: () => void }) {
  const [on, setOn] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onOpen?.()
          setOn(true)
        }}
      >
        프롤로그 다시 보기
      </button>
      {on && <Prologue onDone={() => setOn(false)} />}
    </>
  )
}
