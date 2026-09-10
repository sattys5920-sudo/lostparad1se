import { Fragment } from 'react'
import './AvatarPicker.css'
import { TEAM_WEAR } from '../map/avatar'
import {
  charDataUri,
  FACE_NAMES,
  HAIR_NAMES,
  UNIFORM_NAMES,
  type CharView,
} from '../char/svg'
import { HAIR_COLORS } from '../char/palette'
import type { AvatarLook, TeamId } from '../types'

/** 아바타 그림 한 장. SVG라 아무리 키워도 뭉개지지 않는다. */
function Avatar({
  look,
  team,
  height,
  view = 'full',
}: {
  look: AvatarLook
  team: TeamId | null
  height: number
  view?: CharView
}) {
  const ratio = view === 'full' ? 64 / 96 : 1
  return (
    <img
      src={charDataUri({ ...look, color: look.color ?? 0, uniform: look.uniform ?? 0 }, team, view)}
      width={Math.round(height * ratio)}
      height={height}
      alt=""
      draggable={false}
    />
  )
}

/** 명단·대화처럼 이름 옆에 얼굴만 붙일 때. */
export function AvatarFace({ look, size = 30 }: { look: AvatarLook; size?: number }) {
  return <Avatar look={look} team={null} height={size} view="face" />
}

interface RowSpec {
  label: string
  names: string[]
  value: number
  /** 칸마다 어떤 부분만 바꿔 보여줄지 */
  patch: (i: number) => Partial<AvatarLook>
  /** 머리·머리색·표정은 얼굴만 보면 되고, 교복은 전신을 봐야 한다. */
  view: CharView
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
  const color = look.color ?? 0
  const uniform = look.uniform ?? 0

  const rows: RowSpec[] = [
    { label: '머리 모양', names: HAIR_NAMES, value: look.hair, patch: (i) => ({ hair: i }), view: 'face' },
    {
      label: '머리색',
      names: HAIR_COLORS.map((c) => c.name),
      value: color,
      patch: (i) => ({ color: i }),
      view: 'face',
    },
    { label: '표정', names: FACE_NAMES, value: look.face, patch: (i) => ({ face: i }), view: 'face' },
    {
      label: '교복',
      names: UNIFORM_NAMES,
      value: uniform,
      patch: (i) => ({ uniform: i }),
      view: 'full',
    },
  ]

  return (
    <div className="sc-avatar">
      <div className="sc-avatar__stage">
        <Avatar look={look} team={team} height={132} />
        <div className="sc-avatar__caption">
          <span>
            {HAIR_NAMES[look.hair % HAIR_NAMES.length]} · {HAIR_COLORS[color % HAIR_COLORS.length].name}
          </span>
          <span>{FACE_NAMES[look.face % FACE_NAMES.length]}</span>
          <span>{UNIFORM_NAMES[uniform % UNIFORM_NAMES.length]}</span>
          <span className="sc-avatar__wear">
            {team ? `${team}팀 — 왼팔 완장으로 표시된다` : '팀이 정해지면 왼팔에 완장이 붙는다'}
          </span>
        </div>
      </div>

      {rows.map((row) => (
        <Fragment key={row.label}>
          <span className="sc-avatar__label">{row.label}</span>
          <div className="sc-avatar__row">
            {row.names.map((name, i) => (
              <button
                key={name}
                className={`sc-avatar__chip ${row.value === i ? 'is-on' : ''}`}
                title={name}
                onClick={() => onChange({ ...look, ...row.patch(i) })}
              >
                <Avatar
                  look={{ ...look, color, uniform, ...row.patch(i) }}
                  team={team}
                  height={row.view === 'full' ? 52 : 34}
                  view={row.view}
                />
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

export { TEAM_WEAR }
