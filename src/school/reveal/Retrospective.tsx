// 역할 내려놓기와 회고.
//
// 기록 보관소를 닫으면 여기로 온다. 버튼을 누르면 내 도트 캐릭터에서
// 완장이 사라지고, 눈이 멈추고, 서리가 걷힌다. 그 뒤로는 눈 그친
// 학교다.
//
// 완장을 지우는 일은 따로 그리지 않는다. pixelFrame에 팀 대신 null을
// 넘기면 완장 칸이 애초에 칠해지지 않는다 — 덧칠해 가리는 게 아니다.
//
// 다만 완장은 3×2, 여섯 칸뿐이다. 그냥 사라지게 두면 눈에 띄지 않는다.
// 그래서 완장 칸만 따로 떼어 두 장을 겹치고, 그 한 장만 흘러내리게 한다.
// 몸은 가만히 있고 완장만 떨어진다.
import { useEffect, useMemo, useState } from 'react'
import './reveal.css'
import { Snow } from './Snow'
import { pixelFrame } from '../char/pixel'
import {
  boardFor,
  canPost,
  hasNotice,
  POST_REFUSAL_MESSAGE,
  RETRO_MAX,
  RETRO_TEXT,
  type RetroNotice,
  type RetroPost,
} from '../../../shared/reveal/retro'
import type { AvatarLook } from '../types'
import type { TeamId } from '../../../shared/rules/v2'

export interface RetroProps {
  viewerId: string
  look: AvatarLook
  team: TeamId
  /** 이미 내려놓았는가. 서버에 남는다 — 다시 들어와도 그대로다. */
  retired: boolean
  posts: readonly RetroPost[]
  nameOf: (id: string) => string
  notice?: RetroNotice | null
  onRetire: () => void
  onPost: (text: string, anonymous: boolean) => void
}

/**
 * 완장 칸만 남긴 그림. 팀이 있는 그림과 없는 그림의 차이가 곧 완장이다.
 * 렌더러를 고치지 않고 완장만 떼어 낼 수 있다.
 */
function bandOnly(look: AvatarLook, team: TeamId): string {
  const on = pixelFrame(look, team, 'down', 0)
  const off = pixelFrame(look, null, 'down', 0)
  const w = on.width
  const h = on.height
  const a = on.getContext('2d')?.getImageData(0, 0, w, h)
  const b = off.getContext('2d')?.getImageData(0, 0, w, h)
  if (!a || !b) return ''

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < a.data.length; i += 4) {
    const same =
      a.data[i] === b.data[i] &&
      a.data[i + 1] === b.data[i + 1] &&
      a.data[i + 2] === b.data[i + 2] &&
      a.data[i + 3] === b.data[i + 3]
    if (same) continue
    img.data[i] = a.data[i]
    img.data[i + 1] = a.data[i + 1]
    img.data[i + 2] = a.data[i + 2]
    img.data[i + 3] = a.data[i + 3]
  }
  ctx.putImageData(img, 0, 0)
  return out.toDataURL()
}

/** 몸은 그대로 있고 완장만 떨어진다. */
function Avatar({ look, team, retired }: { look: AvatarLook; team: TeamId; retired: boolean }) {
  const body = useMemo(() => {
    try {
      return pixelFrame(look, null, 'down', 0).toDataURL()
    } catch {
      return ''
    }
  }, [look])
  const band = useMemo(() => {
    try {
      return bandOnly(look, team)
    } catch {
      return ''
    }
  }, [look, team])

  return (
    <div className={`sc-rt__avatar ${retired ? 'is-retired' : ''}`}>
      {body && <img className="sc-rt__body" src={body} alt="" width={192} height={192} />}
      {band && <img className="sc-rt__band" src={band} alt="" width={192} height={192} />}
    </div>
  )
}

export function Retrospective(props: RetroProps) {
  const [draft, setDraft] = useState('')
  const [anon, setAnon] = useState(false)
  const [error, setError] = useState('')
  const board = useMemo(
    () => boardFor(props.posts, props.viewerId, props.nameOf),
    [props.posts, props.viewerId, props.nameOf],
  )

  // 내려놓으면 그 뒤로는 눈이 오지 않는다
  useEffect(() => {
    document.body.classList.toggle('sc-retired', props.retired)
    return () => document.body.classList.remove('sc-retired')
  }, [props.retired])

  function submit() {
    const out = canPost({ retired: props.retired, text: draft })
    if (!out.ok) {
      setError(POST_REFUSAL_MESSAGE[out.reason as 'empty'])
      return
    }
    setError('')
    props.onPost(draft.trim(), anon)
    setDraft('')
  }

  return (
    <div className={`sc-rt ${props.retired ? 'is-retired' : ''}`}>
      {/* 내려놓으면 눈이 멈춘다 */}
      <Snow level={props.retired ? 0 : 3} />

      {hasNotice(props.notice) && props.notice && (
        <div className="sc-rt__notice">
          <span className="sc-rt__notice-label">회고</span>
          {props.notice.when && <span>{props.notice.when}</span>}
          {props.notice.link && (
            <a href={props.notice.link} target="_blank" rel="noreferrer noopener">
              들어가기
            </a>
          )}
        </div>
      )}

      <section className="sc-rt__stage">
        <Avatar look={props.look} team={props.team} retired={props.retired} />
        <p className="sc-rt__headline">{RETRO_TEXT.headline}</p>
        {props.retired ? (
          <span className="sc-rt__after">{RETRO_TEXT.after}</span>
        ) : (
          <button className="sc-rt__retire" onClick={props.onRetire}>
            {RETRO_TEXT.action}
          </button>
        )}
      </section>

      <section className="sc-rt__board">
        <span className="sc-rt__board-hint">{RETRO_TEXT.boardHint}</span>

        <ul>
          {board.map((p) => (
            <li key={p.id} className={p.mine ? 'is-mine' : ''}>
              <span className="sc-rt__post-name">{p.name}</span>
              <p>{p.text}</p>
            </li>
          ))}
          {board.length === 0 && <li className="sc-rt__empty">아직 아무도 쓰지 않았다.</li>}
        </ul>

        {props.retired ? (
          <div className="sc-rt__compose">
            <textarea
              rows={2}
              maxLength={RETRO_MAX}
              value={draft}
              placeholder="한 줄"
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="sc-rt__compose-row">
              <label className="sc-rt__anon">
                <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
                익명으로
              </label>
              <button onClick={submit} disabled={!draft.trim()}>
                남기기
              </button>
            </div>
            {error && <p className="sc-rt__error">{error}</p>}
          </div>
        ) : (
          <p className="sc-rt__locked">{RETRO_TEXT.locked}</p>
        )}
      </section>
    </div>
  )
}
