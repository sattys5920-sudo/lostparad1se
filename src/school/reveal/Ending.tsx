// 엔딩 — **운영자가 적은 한 편.**
//
// 한때 여기에 열 장면이 있었다. 종례 · 팀 결과 · 개인 엔딩 · 그날의
// 전말 · 거울 규칙 · 들리지 않았던 말 · A가 남긴 말 · 찢긴 한 장 ·
// 공동 엔딩 · 기록 보관소. 미리 적어 둔 문장을 차례로 틀어 주는 자리라,
// 무엇을 깨달을지까지 화면이 정해 주고 있었다.
//
// 지금은 종이 한 장이다. 닷새를 지켜본 사람이 쓴 글이 그대로 찍힌다.
import { useEffect, useState } from 'react'

import { PaperSheet } from './PaperSheet'
import { Snow } from './Snow'
import { useTypewriter } from './useTypewriter'
import type { GameActions } from '../game/useGame'

export interface EndingProps {
  act: GameActions
  snowLevel?: number
}

export function Ending({ act, snowLevel = 5 }: EndingProps) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    act
      .myEnding()
      .then((d) => {
        if (!live) return
        const text = String((d as { text?: string }).text ?? '').trim()
        setLines(text === '' ? [] : text.split('\n').filter((l) => l.trim() !== ''))
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [act])

  const typed = useTypewriter(lines ?? [])

  if (error) return <p className="sc-ed__none">{error}</p>
  if (lines === null) return null

  return (
    <div className="sc-en" role="dialog" aria-label="엔딩">
      <Snow level={snowLevel} />
      {/* 아직 아무것도 안 적었으면 종이만 비어 있다. 거짓말을 지어내지 않는다 */}
      <button className="sc-en__paper" onClick={() => typed.tap()} aria-label="넘기기">
        <PaperSheet kind="diary" lines={typed.shown} />
      </button>
    </div>
  )
}
