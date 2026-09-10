import { Fragment, useEffect, useRef } from 'react'
import './AvatarPicker.css'
import { ACTOR_H, ACTOR_W, actorSprite, FACE_NAMES, HAIR_COLORS, HAIR_GROUPS, HAIR_NAMES, TEAM_WEAR } from '../map/avatar'
import { PORTRAIT_SIZE, portraitSprite } from '../map/portrait'
import type { AvatarLook, TeamId } from '../types'

/** 지도 위를 걷는 몸 인형. 팀 옷이 어떻게 나오는지 볼 때만 쓴다. */
function BodySprite({ look, team, scale }: { look: AvatarLook; team: TeamId | null; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(actorSprite(look, team, 'down', 0), 0, 0, canvas.width, canvas.height)
  }, [look, team, scale])
  return (
    <canvas
      ref={ref}
      width={ACTOR_W * scale}
      height={ACTOR_H * scale}
      style={{ width: ACTOR_W * scale, height: ACTOR_H * scale, imageRendering: 'pixelated' }}
    />
  )
}

/**
 * 얼굴 초상화. 지도 인형(12칸 폭)과 달리 32칸 캔버스라 눈 하나 놓을 자리가
 * 넉넉하다 — 머리·표정을 고를 때, 명단에 이름 옆 얼굴을 붙일 때는 이걸 쓴다.
 */
function Portrait({ look, scale }: { look: AvatarLook; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(portraitSprite(look), 0, 0, canvas.width, canvas.height)
  }, [look, scale])
  return (
    <canvas
      ref={ref}
      width={PORTRAIT_SIZE * scale}
      height={PORTRAIT_SIZE * scale}
      style={{ width: PORTRAIT_SIZE * scale, height: PORTRAIT_SIZE * scale, imageRendering: 'pixelated' }}
    />
  )
}

/** 명단·대화처럼 이름 옆에 얼굴만 붙일 때. */
export function AvatarFace({ look, scale = 1.2 }: { look: AvatarLook; scale?: number }) {
  return <Portrait look={look} scale={scale} />
}

export function AvatarPicker({
  look,
  team,
  onChange,
}: {
  look: AvatarLook
  team: TeamId | null
  onChange: (next: AvatarLook) => void
}) {
  return (
    <div className="sc-avatar">
      <div className="sc-avatar__stage">
        <Portrait look={look} scale={3} />
        <div className="sc-avatar__inGame">
          <BodySprite look={look} team={team} scale={3} />
          <span>게임 속 모습</span>
        </div>
        <div className="sc-avatar__caption">
          <span>
            {HAIR_NAMES[look.hair]} · {HAIR_COLORS[look.color ?? 0]}
          </span>
          <span>{FACE_NAMES[look.face]}</span>
          <span className="sc-avatar__wear">{team ? `${team}팀 · ${TEAM_WEAR[team]}` : '옷은 팀이 정해지면 바뀐다'}</span>
        </div>
      </div>

      {HAIR_GROUPS.map((group) => (
        <Fragment key={group.label}>
          <span className="sc-avatar__label">{group.label}</span>
          <div className="sc-avatar__row">
            {HAIR_NAMES.slice(group.from, group.to).map((name, k) => {
              const i = group.from + k
              return (
                <button
                  key={name}
                  className={`sc-avatar__chip ${look.hair === i ? 'is-on' : ''}`}
                  title={name}
                  onClick={() => onChange({ ...look, hair: i })}
                >
                  <Portrait look={{ ...look, hair: i }} scale={1.5} />
                </button>
              )
            })}
          </div>
        </Fragment>
      ))}

      <span className="sc-avatar__label">머리색</span>
      <div className="sc-avatar__row">
        {HAIR_COLORS.map((name, i) => (
          <button
            key={name}
            className={`sc-avatar__chip ${(look.color ?? 0) === i ? 'is-on' : ''}`}
            title={name}
            onClick={() => onChange({ ...look, color: i })}
          >
            <Portrait look={{ ...look, color: i }} scale={1.5} />
          </button>
        ))}
      </div>

      <span className="sc-avatar__label">표정</span>
      <div className="sc-avatar__row">
        {FACE_NAMES.map((name, i) => (
          <button
            key={name}
            className={`sc-avatar__chip ${look.face === i ? 'is-on' : ''}`}
            title={name}
            onClick={() => onChange({ ...look, face: i })}
          >
            <Portrait look={{ ...look, face: i }} scale={1.5} />
          </button>
        ))}
      </div>
    </div>
  )
}
