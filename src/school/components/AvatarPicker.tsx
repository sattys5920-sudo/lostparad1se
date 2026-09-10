import { useEffect, useRef } from 'react'
import './AvatarPicker.css'
import { ACTOR_H, ACTOR_W, actorSprite, FACE_NAMES, HAIR_NAMES, TEAM_WEAR } from '../map/avatar'
import type { AvatarLook, TeamId } from '../types'

/** 도트를 그대로 확대해 보여준다. 흐려지면 표정이 뭉개진다. */
function Sprite({ look, team, scale }: { look: AvatarLook; team: TeamId | null; scale: number }) {
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

/** 명단·대화처럼 이름 옆에 얼굴만 붙일 때. */
export function AvatarFace({ look, team, scale = 2 }: { look: AvatarLook; team: TeamId | null; scale?: number }) {
  return <Sprite look={look} team={team} scale={scale} />
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
        <Sprite look={look} team={team} scale={6} />
        <div className="sc-avatar__caption">
          <span>{HAIR_NAMES[look.hair]}</span>
          <span>{FACE_NAMES[look.face]}</span>
          <span className="sc-avatar__wear">{team ? `${team}팀 · ${TEAM_WEAR[team]}` : '옷은 팀이 정해지면 바뀐다'}</span>
        </div>
      </div>

      <span className="sc-avatar__label">머리</span>
      <div className="sc-avatar__row">
        {HAIR_NAMES.map((name, i) => (
          <button
            key={name}
            className={`sc-avatar__chip ${look.hair === i ? 'is-on' : ''}`}
            title={name}
            onClick={() => onChange({ ...look, hair: i })}
          >
            <Sprite look={{ hair: i, face: 0 }} team={team} scale={3} />
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
            <Sprite look={{ hair: look.hair, face: i }} team={team} scale={3} />
          </button>
        ))}
      </div>
    </div>
  )
}
