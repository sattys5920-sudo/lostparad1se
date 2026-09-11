import { useEffect, useRef, useState } from 'react'
import './CharacterCreator.css'
import {
  DIRS,
  EXPRESSION_NAMES,
  HAIR_NAMES,
  OUTFIT_NAMES,
  PX,
  pixelFrame,
  type Dir,
} from '../char/pixel'
import { HAIR_COLORS, TEAMS } from '../char/palette'
import { BOTTOM_NAMES, randomLook } from '../char/look'
import type { AvatarLook, TeamId } from '../types'

/** 얼굴칸 둘레 — 표정 썸네일은 여기만 잘라 크게 띄운다. 8x4짜리 표정이
 *  머리통 전체에 파묻히면 여섯 개가 다 같아 보인다. */
const FACE_BOX = { x: 9, y: 10, w: 14, h: 10 }
/** 사람이 선 자리만. 빈 여백을 잘라내 작은 칸에서도 옷이 보이게 한다. */
const BODY_BOX = { x: 7, y: 6, w: 18, h: 26 }
/** 머리 + 상반신 — 명단·대화 아이콘용 */
export const BUST_BOX = { x: 8, y: 6, w: 16, h: 18 }

interface Crop {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 도트 스프라이트 한 장. 정수 배율로만 키우고 뭉개지지 않게 한다.
 * crop을 주면 그 부분만 잘라 그린다.
 */
function Sprite({
  look,
  team,
  dir = 'down',
  frame = 0,
  scale,
  crop,
}: {
  look: AvatarLook
  team: TeamId | null
  dir?: Dir
  frame?: number
  scale: number
  crop?: Crop
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = crop ?? { x: 0, y: 0, w: PX, h: PX }
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(
      pixelFrame(look, team, dir, frame),
      box.x, box.y, box.w, box.h,
      0, 0, box.w * scale, box.h * scale,
    )
  }, [look, team, dir, frame, scale, box.x, box.y, box.w, box.h])
  return (
    <canvas
      ref={ref}
      width={box.w * scale}
      height={box.h * scale}
      style={{ width: box.w * scale, height: box.h * scale, imageRendering: 'pixelated' }}
    />
  )
}

/** 명단·대화에서 이름 옆에 붙이는 얼굴. 정면 idle의 머리+상반신을 자른다. */
export function AvatarFace({ look, team = null, scale = 2 }: { look: AvatarLook; team?: TeamId | null; scale?: number }) {
  return <Sprite look={look} team={team} scale={scale} crop={BUST_BOX} />
}

/** 걷는 미리보기. 프레임을 지도와 같은 박자로 넘긴다. */
function WalkPreview({ look, team, dir, scale }: { look: AvatarLook; team: TeamId | null; dir: Dir; scale: number }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    // 지도와 같은 속도 — 걸음 자세가 1초에 3.2번 바뀐다(한 프레임 156ms)
    const t = window.setInterval(() => setFrame((f) => (f + 1) % 4), 156)
    return () => window.clearInterval(t)
  }, [])
  return <Sprite look={look} team={team} dir={dir} frame={frame} scale={scale} />
}

type TabId = 'hair' | 'color' | 'face' | 'outfit'

const TABS: { id: TabId; label: string }[] = [
  { id: 'hair', label: '헤어' },
  { id: 'color', label: '색' },
  { id: 'face', label: '표정' },
  { id: 'outfit', label: '옷' },
]

export function CharacterCreator({
  look,
  team,
  onChange,
  onDone,
  doneLabel = '완성',
}: {
  look: AvatarLook
  team: TeamId | null
  onChange: (next: AvatarLook) => void
  onDone?: () => void
  doneLabel?: string
}) {
  const [tab, setTab] = useState<TabId>('hair')
  const [dir, setDir] = useState<Dir>('down')

  const turn = (step: number) => {
    const i = DIRS.indexOf(dir)
    setDir(DIRS[(i + step + DIRS.length) % DIRS.length])
  }

  const teamDef = team ? TEAMS.find((t) => t.id === team) : null

  const options: { key: string; label: string; patch: Partial<AvatarLook>; on: boolean }[] =
    tab === 'hair'
      ? HAIR_NAMES.map((name, i) => ({ key: name, label: name, patch: { hairStyle: i }, on: look.hairStyle === i }))
      : tab === 'color'
        ? HAIR_COLORS.map((c, i) => ({ key: c.name, label: c.name, patch: { hairColor: i }, on: look.hairColor === i }))
        : tab === 'face'
          ? EXPRESSION_NAMES.map((name, i) => ({ key: name, label: name, patch: { expression: i }, on: look.expression === i }))
          : OUTFIT_NAMES.map((name, i) => ({ key: name, label: name, patch: { outfit: i }, on: look.outfit === i }))

  return (
    <div className="sc-cc">
      <div className="sc-cc__stage">
        <button className="sc-cc__turn" aria-label="왼쪽으로 돌리기" onClick={() => turn(-1)}>
          ‹
        </button>
        <WalkPreview look={look} team={team} dir={dir} scale={6} />
        <button className="sc-cc__turn" aria-label="오른쪽으로 돌리기" onClick={() => turn(1)}>
          ›
        </button>
      </div>

      <div className="sc-cc__band">
        <span className="sc-cc__lock" aria-hidden="true">
          🔒
        </span>
        <span>팀: {teamDef ? teamDef.name : '미정'}</span>
        <span className="sc-cc__bandNote">
          {teamDef ? '완장은 배정된 것이다 — 바꿀 수 없다' : '완장은 고를 수 없다 — 시작할 때 정해진다'}
        </span>
      </div>

      <div className="sc-cc__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`sc-cc__tab ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'outfit' && (
        <div className="sc-cc__toggle">
          {BOTTOM_NAMES.map((name, i) => (
            <button
              key={name}
              className={`sc-cc__toggleBtn ${look.bottom === i ? 'is-on' : ''}`}
              onClick={() => onChange({ ...look, bottom: i })}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="sc-cc__grid">
        {options.map((o) => (
          <button
            key={o.key}
            className={`sc-cc__opt ${o.on ? 'is-on' : ''}`}
            title={o.label}
            onClick={() => onChange({ ...look, ...o.patch })}
          >
            {tab === 'face' ? (
              <Sprite look={{ ...look, ...o.patch }} team={team} scale={4} crop={FACE_BOX} />
            ) : (
              <Sprite look={{ ...look, ...o.patch }} team={team} scale={3} crop={BODY_BOX} />
            )}
            {(tab === 'face' || tab === 'outfit') && <span className="sc-cc__optName">{o.label}</span>}
          </button>
        ))}
      </div>

      <div className="sc-cc__actions">
        <button className="sc-cc__random" onClick={() => onChange(randomLook())}>
          랜덤
        </button>
        {onDone && (
          <button className="sc-cc__done" onClick={onDone}>
            {doneLabel}
          </button>
        )}
      </div>
    </div>
  )
}
