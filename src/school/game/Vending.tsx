// 자판기 — 주인 없는 기계 한 대.
//
// 목록에 값을 붙여 늘어놓던 상점을 기계로 바꾼다. **파는 것도 값도
// 규칙에서 그대로 온다**(SHOP_ITEMS, shopPriceFor) — 여기서 새로
// 정하는 것은 하나도 없고, 사는 길도 buyShopItem 그대로다. 바뀐 것은
// 보이는 것뿐이다.
//
// 기계로 만든 값이 하나 있다. 목록은 여섯 줄을 위에서 아래로 읽게
// 하는데, 자판기는 **여섯 칸이 한눈에 들어온다.** 무엇을 살지 고르는
// 일이 읽는 일에서 보는 일이 된다.
//
// 연출은 전부 **정수 화소**로 움직인다. 프레임마다 위치를 배열에서
// 꺼내 쓴다 — 도트 그림을 0.5픽셀씩 밀면 그 순간 도트가 아니게 된다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SHOP_ITEMS, priceOf } from '../../../shared/rules/shop'
import { CROP_BY_ID } from '../../../shared/rules/crop'
import { josa } from '../text'
import { goodIcon } from './goodArt'
import type { GameActions } from './useGame'

/** 칸 번호. 왼쪽부터 오른쪽, 위에서 아래로 — 기계에 적힌 순서다. */
const CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/**
 * 한 프레임. **자판기는 초당 60번 부드럽게 움직이지 않는다.**
 * 끊어서 움직여야 기계로 보인다.
 */
const FRAME = 60

/** 동전이 떨어지는 세 자리. 정수 화소다. */
const COIN_FALL = [0, 5, 11]
/** 튕겨 나오는 두 자리. 슬롯 앞에서 되돌아 나온다. */
const COIN_BOUNCE = [-4, -9]
/** 배출구에서 물건이 나오는 두 자리. */
const BIN_DROP = [-9, 0]

type Step = 'idle' | 'coin' | 'think' | 'shake' | 'drop' | 'done' | 'reject'

export interface VendingProps {
  money: number
  /** 오늘 다 나간 품목. 서버가 보내 준다. */
  soldOut: readonly string[]
  /** 지금 손에 든 작물. 키가 작물 아이디다 — 매입구에 넣을 것들이다. */
  crops?: Readonly<Record<string, number>>
  act: GameActions
  onSaid: (text: string) => void
  onClose: () => void
}

/**
 * 소리. **첫 탭 전에는 만들지도 않는다.**
 *
 * 소리 상자를 미리 열어 두면 브라우저가 막고, 막힌 채로 두면 첫
 * 소리가 안 난다. 사람이 처음 누를 때 열면 그 손짓이 허락이 된다.
 */
function makeNoise() {
  let ctx: AudioContext | null = null
  const open = (): AudioContext | null => {
    if (ctx) return ctx
    const C = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
    if (!C) return null
    ctx = new C()
    return ctx
  }
  const tone = (freq: number, ms: number, kind: OscillatorType, vol: number, at = 0): void => {
    const c = open()
    if (!c) return
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = kind
    o.frequency.value = freq
    g.gain.value = 0
    o.connect(g).connect(c.destination)
    const t = c.currentTime + at
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    o.start(t)
    o.stop(t + ms / 1000 + 0.02)
  }
  const hiss = (ms: number, vol: number): void => {
    const c = open()
    if (!c) return
    const n = Math.floor((c.sampleRate * ms) / 1000)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = c.createBufferSource()
    const g = c.createGain()
    g.gain.value = vol
    src.buffer = buf
    src.connect(g).connect(c.destination)
    src.start()
  }
  return {
    wake: () => void open(),
    coin: () => {
      tone(1040, 70, 'square', 0.05)
      tone(760, 90, 'square', 0.05, 0.07)
    },
    bounce: () => tone(420, 110, 'square', 0.05),
    dispense: () => {
      tone(150, 130, 'sawtooth', 0.06)
      hiss(90, 0.03)
    },
    buzz: () => hiss(70, 0.02),
  }
}

export function Vending({ money, soldOut, crops = {}, act, onSaid, onClose }: VendingProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [frame, setFrame] = useState(0)
  /** 배출구에 나와 있는 것. 탭하거나 3초 뒤에 사라진다. */
  const [bin, setBin] = useState<string | null>(null)
  /** 표시창에 띄운 말. 비어 있으면 기본 상태다. */
  const [note, setNote] = useState<string | null>(null)
  /** 형광등이 꺼진 프레임인가. 진열창도 같이 어두워진다. */
  const [dark, setDark] = useState(true)
  const [jitter, setJitter] = useState(false)
  /** 기본 문구를 둘로 번갈아 보여 준다. */
  const [alt, setAlt] = useState(false)
  /**
   * 방금 사서 다 나간 품목. **서버가 보내 줄 때까지의 사이를 메운다** —
   * 사자마자 칸이 그대로면 한 번 더 누르게 된다.
   */
  const [justGone, setJustGone] = useState<string[]>([])

  const noise = useMemo(makeNoise, [])
  const slow = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  /** 걸어 둔 시계 전부. 화면을 닫을 때 한꺼번에 끈다 */
  const timers = useRef<number[]>([])
  const later = useCallback(
    (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, slow ? 0 : ms))
    },
    [slow],
  )
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // 들어오면 형광등이 두 번 깜빡이고 켜진다
  useEffect(() => {
    if (slow) {
      setDark(false)
      return
    }
    const t = [
      window.setTimeout(() => setDark(false), 100),
      window.setTimeout(() => setDark(true), 200),
      window.setTimeout(() => setDark(false), 300),
      window.setTimeout(() => setDark(true), 360),
      window.setTimeout(() => setDark(false), 400),
    ]
    return () => t.forEach(clearTimeout)
  }, [slow])

  // 3~5초에 한 번 불규칙하게. **규칙적이면 기계가 아니라 신호등이다**
  useEffect(() => {
    if (slow) return
    let live = true
    let id = 0
    const again = () => {
      id = window.setTimeout(() => {
        if (!live) return
        setDark(true)
        noise.buzz()
        window.setTimeout(() => live && setDark(false), FRAME)
        again()
      }, 3000 + Math.random() * 2000)
    }
    again()
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [slow, noise])

  // 표시창 글자가 2초에 한 번 1px 흔들린다. 오래된 기계다
  useEffect(() => {
    if (slow) return
    const id = window.setInterval(() => {
      setJitter(true)
      window.setTimeout(() => setJitter(false), 90)
    }, 2000)
    return () => clearInterval(id)
  }, [slow])

  // 기본 문구 둘을 4초마다 번갈아
  useEffect(() => {
    const id = window.setInterval(() => setAlt((v) => !v), 4000)
    return () => clearInterval(id)
  }, [])

  const gone = useMemo(() => new Set([...soldOut, ...justGone]), [soldOut, justGone])

  /** 이 칸을 지금 살 수 있는가. 못 사면 그 사유가 표시창에 뜬다. */
  const reasonFor = useCallback(
    (id: string, cost: number): string | null => {
      if (gone.has(id)) return '오늘은 끝'
      if (money < cost) return '돈 부족'
      return null
    },
    [gone, money],
  )

  const rows = useMemo(
    () =>
      SHOP_ITEMS.map((item, i) => {
        const cost = priceOf(item)
        return { item, code: CODES[i] ?? '??', cost, why: reasonFor(item.id, cost) }
      }),
    [reasonFor],
  )

  const chosen = rows.find((r) => r.item.id === picked) ?? null
  const busy = step !== 'idle'
  /** 매입구에 넣을 수 있는 것. 값이 비싼 것부터 */
  const hand = Object.entries(crops)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (CROP_BY_ID[b[0]]?.price ?? 0) - (CROP_BY_ID[a[0]]?.price ?? 0))

  function tapCell(id: string) {
    noise.wake()
    if (busy) return
    setPicked(id)
    setNote(null)
    setSold(null)
  }

  /*
   * 매입구. **넣으면 값이 표대로 떨어진다** — 흥정도 떨이도 없다.
   *
   * 사는 쪽과 달리 고르는 단계가 없다. 손에 든 것을 눌러 넣는 것이
   * 전부다: 기계 앞에서 무엇을 팔지 고민하는 시간이 길 이유가 없다.
   */
  const [sold, setSold] = useState<{ name: string; paid: number } | null>(null)
  async function sell(cropId: string) {
    noise.wake()
    if (busy) return
    setStep('coin')
    setFrame(0)
    try {
      const out = (await act.sellCrop(cropId)) as { paid?: number }
      const name = CROP_BY_ID[cropId]?.name ?? cropId
      const paid = Number(out.paid ?? 0)
      // **표시창은 sold 가 맡는다.** 여기서 note 를 같이 채우면 note 가
      // 먼저 걸려 「+2 / 옥수수 받았다」가 영영 안 뜬다 — 한 번 그랬다
      setNote(null)
      setSold({ name, paid })
      noise.coin()
      onSaid(`${name}${josa(name, '을/를')} 넣었다. ${paid}코인.`)
    } catch (e) {
      setSold(null)
      setNote((e as Error).message)
      noise.bounce()
    } finally {
      later(() => {
        setStep('idle')
        setFrame(0)
      }, FRAME * 3)
      // 영수증은 잠깐만. 기계는 곧 제자리로 돌아간다
      later(() => setSold(null), 3000)
    }
  }

  /** 배출구에서 꺼낸다. 물건은 이미 주머니에 있다 — 연출을 닫는 일이다 */
  const clearBin = useCallback(() => {
    setBin(null)
  }, [])

  function buy() {
    noise.wake()
    if (busy || !chosen) return
    if (chosen.why) {
      setStep('reject')
      setFrame(0)
      setNote(chosen.why)
      noise.bounce()
      later(() => setFrame(1), FRAME)
      later(() => {
        setStep('idle')
        setFrame(0)
      }, FRAME * 2)
      return
    }

    // **서버 요청은 누른 즉시.** 연출이 끝나기를 기다렸다 보내면,
    // 같은 순간 둘이 마지막 하나를 노렸을 때 늦게 누른 쪽이 이긴다
    const ask = act.buyShopItem(chosen.item.id)
    const id = chosen.item.id
    setStep('coin')
    setFrame(0)
    setNote(null)
    noise.coin()
    later(() => setFrame(1), FRAME)
    later(() => setFrame(2), FRAME * 2)
    later(() => {
      setStep('think')
      setNote('···')
    }, FRAME * 3)

    void ask
      .then(() => {
        if (chosen.item.stockPerDay !== undefined) setJustGone((g) => [...g, id])
        later(() => setStep('shake'), FRAME * 5)
        later(() => {
          setStep('drop')
          setFrame(0)
          noise.dispense()
        }, FRAME * 7)
        later(() => setFrame(1), FRAME * 8)
        later(() => {
          setStep('done')
          setBin(id)
          setNote('꺼내 가세요')
        }, FRAME * 10)
        later(() => {
          setStep('idle')
          setNote(null)
        }, FRAME * 10 + 1000)
        // 안 꺼내도 3초 뒤에 저절로 들어간다
        later(clearBin, FRAME * 10 + 3000)
      })
      .catch((e) => {
        // 서버가 거절했다. **연출을 되감고 사유를 그대로 띄운다**
        const why = (e as Error).message
        setStep('reject')
        setFrame(0)
        setNote(why)
        onSaid(why)
        noise.bounce()
        later(() => setFrame(1), FRAME)
        later(() => {
          setStep('idle')
          setFrame(0)
        }, FRAME * 2)
      })
  }

  const coinY =
    step === 'coin' ? (COIN_FALL[frame] ?? 0)
    : step === 'reject' ? (COIN_BOUNCE[frame] ?? 0)
    : null

  /**
   * 기본 상태에 뜨는 오른쪽 한 줄. 둘을 번갈아 보여 준다.
   *
   * **주인이 없다.** 복도에 서 있는 기계라 차지할 수가 없고, 그래서
   * 값이 누구에게나 같고 낸 돈은 아무 데도 가지 않는다.
   */
  const houseLine = '주인 없는 기계다. 낸 돈은 아무 데도 가지 않는다.'

  return (
    <div className="sc-vd">
      <button className="sc-vd__out" onClick={onClose}>
        ← 나가기
      </button>

      <div className={`sc-vd__body${dark ? ' is-dark' : ''}`}>
        {/* ── 간판 ─────────────────────────────────────── */}
        <div className="sc-vd__sign">
          <i className="sc-vd__tube" aria-hidden />
          <span className="sc-vd__signText">자 판 기</span>
          <span className="sc-vd__room">2-3</span>
        </div>

        {/* ── 진열창 ───────────────────────────────────── */}
        <div className="sc-vd__case">
          <div className="sc-vd__grid">
            {rows.map((r) => (
              <button
                key={r.item.id}
                className={
                  'sc-vd__cell' +
                  (picked === r.item.id ? ' is-on' : '') +
                  (r.why ? ' is-off' : '') +
                  (step === 'shake' && picked === r.item.id ? ' is-shake' : '')
                }
                aria-pressed={picked === r.item.id}
                onClick={() => tapCell(r.item.id)}
              >
                <img className="sc-vd__icon" src={goodIcon(r.item.gives ?? '')} alt="" />
                <b>{r.item.name}</b>
                <em>{r.why ? r.why : `${r.code} · ${r.cost}`}</em>
              </button>
            ))}
          </div>
          {/* 유리 반사. 그라데이션 없이 1px 점선 두 줄 */}
          <i className="sc-vd__glass sc-vd__glass--a" aria-hidden />
          <i className="sc-vd__glass sc-vd__glass--b" aria-hidden />
        </div>

        {/* ── 표시창 ───────────────────────────────────── */}
        <div className={`sc-vd__panel${jitter ? ' is-jit' : ''}`}>
          {/* **영수증이 고른 칸보다 앞이다.** 뒤에 두었더니 아까 눌러
              둔 칸이 그대로 떠 있어서, 넣어도 표시창이 안 바뀌었다 */}
          {note ?
            <span className="sc-vd__line">{note}</span>
          : sold ?
            <>
              <span className="sc-vd__line">{`+${sold.paid}`}</span>
              <span className="sc-vd__sub">{`${sold.name} 받았다`}</span>
            </>
          : chosen ?
            <>
              <span className="sc-vd__line">{`${chosen.code} ${chosen.item.name} · ${chosen.cost}`}</span>
              <span className="sc-vd__sub">{chosen.item.text}</span>
            </>
          : <>
              <span className="sc-vd__line">돈 {money}</span>
              <span className="sc-vd__sub">{alt ? houseLine : '거스름돈 없음'}</span>
            </>
          }
        </div>

        {/* ── 동전 투입구 ──────────────────────────────── */}
        <div className="sc-vd__coinRow">
          <button className="sc-vd__push" disabled={busy || !chosen} onClick={buy}>
            넣기
          </button>
          <span className="sc-vd__coinLab">돈</span>
          <button
            className="sc-vd__slot is-inline"
            disabled={busy || !chosen}
            onClick={buy}
            aria-label="동전 넣기"
          >
            {coinY !== null && <i className="sc-vd__coin" style={{ transform: `translateY(${coinY}px)` }} />}
          </button>
        </div>

        {/* ── 배출구 ───────────────────────────────────── */}
        <button className="sc-vd__bin is-inline" onClick={clearBin} aria-label="꺼내기">
          <span className="sc-vd__push2">PUSH</span>
          {(bin || step === 'drop') && (
            <img
              className="sc-vd__out2"
              style={{ transform: `translateY(${step === 'drop' ? (BIN_DROP[frame] ?? 0) : 0}px)` }}
              src={goodIcon(SHOP_ITEMS.find((i) => i.id === (bin ?? picked))?.gives ?? '')}
              alt=""
            />
          )}
        </button>

        {/* ── 매입구 ───────────────────────────────────
            **배출구 아래 한 줄.** 넣는 구멍과 나오는 구멍이 따로다 —
            같은 자리에 두면 산 것을 도로 넣는 것처럼 보인다 */}
        <div className="sc-vd__buy">
          <span className="sc-vd__buyLab">매입구</span>
          {hand.length === 0 ?
            <span className="sc-vd__buyNone">넣을 것 없음</span>
          : <div className="sc-vd__buyRow">
              {hand.map(([id, n]) => (
                <button
                  key={id}
                  className="sc-vd__crop is-inline"
                  disabled={busy}
                  onClick={() => void sell(id)}
                  aria-label={`${CROP_BY_ID[id]?.name ?? id} 넣기`}
                >
                  <i style={{ background: CROP_BY_ID[id]?.color ?? '#888' }} aria-hidden />
                  {CROP_BY_ID[id]?.name ?? id}
                  {n > 1 && <b>×{n}</b>}
                  <em>· {CROP_BY_ID[id]?.price ?? 0}</em>
                </button>
              ))}
            </div>
          }
        </div>

        {/* 흠집과 스티커 자국. 새 기계가 아니다 */}
        <i className="sc-vd__scr sc-vd__scr--1" aria-hidden />
        <i className="sc-vd__scr sc-vd__scr--2" aria-hidden />
        <i className="sc-vd__scr sc-vd__scr--3" aria-hidden />
        <i className="sc-vd__sticker" aria-hidden />
      </div>
    </div>
  )
}
