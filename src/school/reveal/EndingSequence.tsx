// 엔딩 열 장면.
//
// 종례 → 팀 결과 → 개인 엔딩 → 그날의 전말 → 거울 규칙 →
// 들리지 않았던 말 → A가 남긴 말 → 찢긴 한 장 → 공동 엔딩 → 기록 보관소
//
// 장면마다 모양이 달라서 하나씩 만든다. 공통은 진행(다음/이전)과
// 눈뿐이다. 진행은 shared/reveal/ending.ts 가 쥔다.
import { useEffect, useMemo, useState } from 'react'
import './reveal.css'
import { Snow } from './Snow'
import { PaperSheet } from './PaperSheet'
import { useTypewriter } from './useTypewriter'
import { pixelFrame } from '../char/pixel'
import {
  nextScene,
  playedScenes,
  prevScene,
  sceneIndex,
  type SceneId,
} from '../../../shared/reveal/ending'
import {
  AFTERMATH_LINE_MS,
  TORN_BLACKOUT_MS,
  TORN_TYPE_FACTOR,
  TYPE_MS_PER_CHAR,
} from '../../../shared/reveal/staging'
import type { AvatarLook } from '../types'
import type { TeamId } from '../../../shared/rules/v2'

// ── 서버가 내려보낸 엔딩 한 벌 ──────────────────────────────────

export interface EndingPerson {
  playerId: string
  name: string
  team: TeamId
  look: AvatarLook
}

export interface AftermathRow {
  when: string
  what: string
  /** 실명. 서버가 역할을 이름으로 바꿔서 준다. */
  who: string[]
}

export interface EndingData {
  /** 투명인간이 한 번이라도 있었는가. 없으면 6번 장면을 건너뛴다. */
  hadInvisible: boolean
  people: EndingPerson[]
  teamResult: { team: TeamId; rank: number; total: number }[]
  /** 내 엔딩 세 줄 — 후회 · 반성 · 깨달음. */
  personal: { band: string; lines: string[] }
  aftermath: AftermathRow[]
  aftermathClosing: string
  mirror: { rule: string; lived: string }[]
  /** 지워진 동안 「…」로만 보였던 말. */
  unheard: { name: string; day: number; text: string }[]
  /** A의 시선 열넷. 끝나면 전원이 다 본다. */
  aWords: { name: string; text: string }[]
  torn: { intro: string; lines: string[] }
  commonEnding: { title: string; text: string; chalk: string }
  /** 내 추리 결과. 본인 것만 온다. */
  myBoard: { name: string; guess: string; actual: string; correct: boolean; firstDay: number | null }[]
}

export interface EndingProps {
  data: EndingData
  onOpenArchive?: () => void
}

// ── 도트 캐릭터 한 명 ───────────────────────────────────────────

function Standee({ person, scale = 2 }: { person: EndingPerson; scale?: number }) {
  const url = useMemo(() => {
    try {
      return pixelFrame(person.look, person.team, 'down', 0).toDataURL()
    } catch {
      return ''
    }
  }, [person])
  if (!url) return null
  return (
    <img
      className="sc-en__standee"
      src={url}
      alt={person.name}
      width={32 * scale}
      height={32 * scale}
    />
  )
}

// ── 장면들 ──────────────────────────────────────────────────────

function Closing() {
  return (
    <div className="sc-en__closing">
      <span className="sc-en__clock">17:00</span>
      <p>멈춰 있던 시계가 움직인다.</p>
    </div>
  )
}

function TeamResult({ rows }: { rows: EndingData['teamResult'] }) {
  return (
    <ol className="sc-en__teams">
      {[...rows]
        .sort((a, b) => a.rank - b.rank)
        .map((r) => (
          <li key={r.team} className={`sc-en__team is-${r.team.toLowerCase()}`}>
            <span className="sc-en__rank">{r.rank}위</span>
            <span className="sc-en__team-name">{r.team}팀</span>
            <span className="sc-en__team-score">{r.total}</span>
          </li>
        ))}
    </ol>
  )
}

function Personal({ personal }: { personal: EndingData['personal'] }) {
  const LABELS = ['후회', '반성', '깨달음']
  return (
    <div className="sc-en__personal">
      <span className="sc-en__band">{personal.band}</span>
      {personal.lines.map((line, i) => (
        <div key={i} className="sc-en__personal-row">
          <span className="sc-en__personal-label">{LABELS[i] ?? ''}</span>
          <p>{line}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * 그날의 전말. 한 줄이 나타날 때마다 그 사람이 눈 속에 선다.
 * 마지막에는 열넷이 모두 서 있다.
 */
function Aftermath({ data }: { data: EndingData }) {
  const [shown, setShown] = useState(1)
  const byName = useMemo(
    () => new Map(data.people.map((p) => [p.name, p])),
    [data.people],
  )

  useEffect(() => {
    if (shown >= data.aftermath.length) return
    const t = setTimeout(() => setShown((n) => n + 1), AFTERMATH_LINE_MS)
    return () => clearTimeout(t)
  }, [shown, data.aftermath.length])

  const standing = useMemo(() => {
    const out: EndingPerson[] = []
    const seen = new Set<string>()
    for (const row of data.aftermath.slice(0, shown)) {
      for (const name of row.who) {
        const p = byName.get(name)
        if (p && !seen.has(p.playerId)) {
          seen.add(p.playerId)
          out.push(p)
        }
      }
    }
    return out
  }, [data.aftermath, shown, byName])

  const done = shown >= data.aftermath.length

  return (
    <div className="sc-en__aftermath">
      <ol className="sc-en__lines">
        {data.aftermath.slice(0, shown).map((row, i) => (
          <li key={i}>
            <span className="sc-en__when">{row.when}</span>
            <span className="sc-en__what">{row.what}</span>
            <span className="sc-en__who">{row.who.join(' · ')}</span>
          </li>
        ))}
      </ol>
      <div className="sc-en__crowd" aria-label={`${standing.length}명이 서 있다`}>
        {standing.map((p) => (
          <Standee key={p.playerId} person={p} />
        ))}
      </div>
      {done && <p className="sc-en__aftermath-closing">{data.aftermathClosing}</p>}
      {!done && (
        <button className="sc-en__more" onClick={() => setShown(data.aftermath.length)}>
          한꺼번에 보기
        </button>
      )}
    </div>
  )
}

function Mirror({ rows }: { rows: EndingData['mirror'] }) {
  return (
    <table className="sc-en__mirror">
      <thead>
        <tr>
          <th>영역전 규칙</th>
          <th>A가 겪은 일</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rule}>
            <td>{r.rule}</td>
            <td>{r.lived}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Unheard({ rows }: { rows: EndingData['unheard'] }) {
  return (
    <ul className="sc-en__unheard">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="sc-en__unheard-who">
            DAY {r.day} · {r.name}
          </span>
          <span className="sc-en__unheard-was">…</span>
          <p>{r.text}</p>
        </li>
      ))}
      {rows.length === 0 && <li className="sc-en__empty">되돌릴 말이 없다.</li>}
    </ul>
  )
}

function AWords({ rows }: { rows: EndingData['aWords'] }) {
  return (
    <ul className="sc-en__awords">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="sc-en__awords-to">{r.name}에게</span>
          <p>{r.text}</p>
        </li>
      ))}
    </ul>
  )
}

/** 찢긴 한 장. 타자가 절반 속도고, 끝나면 삼 초 암전이다. */
function TornPage({ torn, onDone }: { torn: EndingData['torn']; onDone: () => void }) {
  const typed = useTypewriter(torn.lines, TYPE_MS_PER_CHAR * TORN_TYPE_FACTOR)
  const [black, setBlack] = useState(false)

  useEffect(() => {
    if (!typed.complete) return
    const t = setTimeout(() => setBlack(true), 1200)
    return () => clearTimeout(t)
  }, [typed.complete])

  useEffect(() => {
    if (!black) return
    const t = setTimeout(onDone, TORN_BLACKOUT_MS)
    return () => clearTimeout(t)
  }, [black, onDone])

  if (black) return <div className="sc-en__blackout" aria-hidden="true" />

  return (
    <div className="sc-en__torn">
      <p className="sc-en__torn-intro">{torn.intro}</p>
      <PaperSheet kind="torn" lines={typed.shown} />
    </div>
  )
}

function CommonEnding({ ending }: { ending: EndingData['commonEnding'] }) {
  return (
    <div className="sc-en__common">
      <div className="sc-en__chalkboard">
        <span className="sc-en__chalk">{ending.chalk}</span>
      </div>
      <h2>{ending.title}</h2>
      <p>{ending.text}</p>
    </div>
  )
}

function MyBoard({ rows, onOpenArchive }: { rows: EndingData['myBoard']; onOpenArchive?: () => void }) {
  const correct = rows.filter((r) => r.correct).length
  return (
    <div className="sc-en__board">
      <span className="sc-en__board-score">
        맞힌 수 {correct} / {rows.length}
      </span>
      <span className="sc-en__board-legend">내 추리 → 실제 · 오른쪽은 처음 맞힌 날</span>
      <ul>
        {rows.map((r) => (
          <li key={r.name} className={r.correct ? 'is-hit' : ''}>
            <span className="sc-en__board-name">{r.name}</span>
            <span className="sc-en__board-guess">{r.guess}</span>
            <span className="sc-en__board-arrow">→</span>
            <span className="sc-en__board-actual">{r.actual}</span>
            <span className="sc-en__board-day">
              {r.firstDay !== null ? `DAY ${r.firstDay}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {onOpenArchive && (
        <button className="sc-en__archive-open" onClick={onOpenArchive}>
          기록 보관소 열기
        </button>
      )}
    </div>
  )
}

// ── 재생기 ──────────────────────────────────────────────────────

export function EndingSequence({ data, onOpenArchive }: EndingProps) {
  const skip = { hadInvisible: data.hadInvisible }
  const [scene, setScene] = useState<SceneId>('closing')
  const list = playedScenes(skip)
  const spec = list.find((s) => s.id === scene)
  const { at, total } = sceneIndex(scene, skip)

  const go = (to: SceneId | null) => {
    if (to) setScene(to)
  }

  return (
    <div className="sc-en">
      <Snow level={data.commonEnding.chalk === '이제 보여?' ? 0 : 3} />

      <header className="sc-en__head">
        <span className="sc-en__step">
          {at} / {total}
        </span>
        <h1>{spec?.title}</h1>
      </header>

      <div className="sc-en__stage">
        {scene === 'closing' && <Closing />}
        {scene === 'teamResult' && <TeamResult rows={data.teamResult} />}
        {scene === 'personal' && <Personal personal={data.personal} />}
        {scene === 'aftermath' && <Aftermath data={data} />}
        {scene === 'mirror' && <Mirror rows={data.mirror} />}
        {scene === 'unheard' && <Unheard rows={data.unheard} />}
        {scene === 'aWords' && <AWords rows={data.aWords} />}
        {scene === 'tornPage' && (
          <TornPage torn={data.torn} onDone={() => go(nextScene('tornPage', skip))} />
        )}
        {scene === 'commonEnding' && <CommonEnding ending={data.commonEnding} />}
        {scene === 'archive' && <MyBoard rows={data.myBoard} onOpenArchive={onOpenArchive} />}
      </div>

      <nav className="sc-en__nav">
        <button onClick={() => go(prevScene(scene, skip))} disabled={!prevScene(scene, skip)}>
          이전
        </button>
        <button
          className="is-next"
          onClick={() => go(nextScene(scene, skip))}
          disabled={!nextScene(scene, skip)}
        >
          다음
        </button>
      </nav>
    </div>
  )
}
