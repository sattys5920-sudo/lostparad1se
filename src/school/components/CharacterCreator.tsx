import { useEffect, useRef, useState } from 'react'
import './CharacterCreator.css'
import {
  DIRS,
  EXPRESSION_NAMES,
  HAIR_BY_ID,
  HAIR_IDS_F,
  HAIR_IDS_M,
  NECKWEAR_NAMES,
  OUTFIT_NAMES,
  PX,
  WEAR_STYLE_NAMES,
  pixelFrame,
  type Dir,
} from '../char/pixel'
import { HAIR_COLORS, TEAMS } from '../char/palette'
import { BOTTOM_NAMES, randomLook, withStyleSet } from '../char/look'
import type { AvatarLook, StyleSet, TeamId } from '../types'

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

/** 성별. 머리·하의 목록의 기본값을 정할 뿐 몸 픽셀 맵은 남녀가 같다. */
const SET_IDS: StyleSet[] = ['M', 'F']
const SET_NAMES = ['남', '여']
const COLOR_NAMES = HAIR_COLORS.map((c) => c.name)

/**
 * 고르는 줄 하나 — 왼쪽 화살표, 지금 고른 것의 이름, 오른쪽 화살표.
 *
 * 격자에 썸네일을 깔면 서른 종을 한 화면에 욱여넣느라 칸이 작아지고,
 * 탭을 달면 무엇을 고르는 중인지 늘 한 겹 가려진다. 줄마다 화살표만
 * 두면 위에 있는 미리보기가 곧 결과다.
 */
function Row({
  label,
  names,
  value,
  onPick,
}: {
  label: string
  names: readonly string[]
  value: number
  onPick: (i: number) => void
}) {
  const step = (d: number) => onPick(((value + d) % names.length + names.length) % names.length)
  return (
    <div className="sc-cc__row">
      <span className="sc-cc__rowLabel">{label}</span>
      <button className="sc-cc__arrow" aria-label={`${label} 이전`} onClick={() => step(-1)}>
        ‹
      </button>
      <span className="sc-cc__rowValue">{names[value]}</span>
      <button className="sc-cc__arrow" aria-label={`${label} 다음`} onClick={() => step(1)}>
        ›
      </button>
      <span className="sc-cc__rowCount">
        {value + 1}/{names.length}
      </span>
    </div>
  )
}

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
  const [dir, setDir] = useState<Dir>('down')

  const turn = (step: number) => {
    const i = DIRS.indexOf(dir)
    setDir(DIRS[(i + step + DIRS.length) % DIRS.length])
  }

  const teamDef = team ? TEAMS.find((t) => t.id === team) : null

  // 고른 성별의 열다섯 종이 앞에 오고 반대쪽 열다섯 종이 뒤에 붙는다.
  // 화살표로 끝까지 밀면 성별 너머의 머리까지 그대로 이어지므로 따로
  // 「전체 보기」를 둘 필요가 없다.
  const hairIds = look.styleSet === 'M' ? [...HAIR_IDS_M, ...HAIR_IDS_F] : [...HAIR_IDS_F, ...HAIR_IDS_M]
  const hairNames = hairIds.map((id) => HAIR_BY_ID[id].name)
  const hairAt = Math.max(0, hairIds.indexOf(look.hairStyle))

  /** 성별은 목록의 기본값이다 — 바꾸면 머리도 같은 자리의 반대쪽 머리로 옮긴다. */
  const pickSet = (i: number) => onChange(withStyleSet(look, SET_IDS[i]))

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

      <div className="sc-cc__rows">
        <Row label="성별" names={SET_NAMES} value={SET_IDS.indexOf(look.styleSet)} onPick={pickSet} />
        <Row
          label="머리"
          names={hairNames}
          value={hairAt}
          onPick={(i) => onChange({ ...look, hairStyle: hairIds[i] })}
        />
        <Row
          label="머리색"
          names={COLOR_NAMES}
          value={look.hairColor}
          onPick={(i) => onChange({ ...look, hairColor: i })}
        />
        <Row
          label="표정"
          names={EXPRESSION_NAMES}
          value={look.expression}
          onPick={(i) => onChange({ ...look, expression: i })}
        />
        <Row label="복장" names={OUTFIT_NAMES} value={look.outfit} onPick={(i) => onChange({ ...look, outfit: i })} />
        <Row
          label="착용"
          names={WEAR_STYLE_NAMES}
          value={look.wearStyle}
          onPick={(i) => onChange({ ...look, wearStyle: i })}
        />
        <Row label="하의" names={BOTTOM_NAMES} value={look.bottom} onPick={(i) => onChange({ ...look, bottom: i })} />
        <Row
          label="목"
          names={NECKWEAR_NAMES}
          value={look.neckwear}
          onPick={(i) => onChange({ ...look, neckwear: i })}
        />
      </div>

      <div className="sc-cc__actions">
        <button className="sc-cc__random" onClick={() => onChange(randomLook(look.styleSet))}>
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
