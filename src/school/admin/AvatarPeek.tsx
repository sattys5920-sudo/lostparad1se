// 운영자가 보는 플레이어 얼굴.
//
// 가입 목록 한 줄에 작은 얼굴을 붙이고, 누르면 네 방향 전신과 무엇을
// 골랐는지를 크게 편다. 그림은 저장하지 않는다 — 계정에 남은 번호로
// 게임과 같은 그리기(pixelFrame)를 다시 돌린다. 그래서 여기 보이는 것이
// 곧 지도에 서는 모습이다.
import { useEffect } from 'react'

import type { AvatarLook } from '../../../shared/look'
import { AvatarFace, Sprite } from '../components/CharacterCreator'
import { HAIR_COLORS } from '../char/palette'
import { EXPRESSION_NAMES, HAIR_BY_ID, NECKWEAR_NAMES, OUTFIT_NAMES, WEAR_STYLE_NAMES, type Dir } from '../char/pixel'
import { BOTTOM_NAMES } from '../char/look'

/** 줄에 붙는 작은 얼굴. 누르면 크게 본다 */
export function FaceChip({ look, label, onOpen }: { look: AvatarLook; label: string; onOpen: () => void }) {
  return (
    <button type="button" className="sc-ad__faceChip" onClick={onOpen} aria-label={`${label} 아바타 크게 보기`}>
      <AvatarFace look={look} scale={1} />
    </button>
  )
}

const DIRS: { dir: Dir; name: string }[] = [
  { dir: 'down', name: '앞' },
  { dir: 'left', name: '왼쪽' },
  { dir: 'right', name: '오른쪽' },
  { dir: 'up', name: '뒤' },
]

/** 크게 보기. 바깥을 누르거나 Esc 로 닫는다 */
export function AvatarPeek({ look, title, onClose }: { look: AvatarLook; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: [string, string][] = [
    ['머리', `${HAIR_BY_ID[look.hairStyle]?.name ?? look.hairStyle} (${look.styleSet === 'M' ? '남자' : '여자'} 목록)`],
    ['머리색', HAIR_COLORS[look.hairColor]?.name ?? String(look.hairColor)],
    ['표정', EXPRESSION_NAMES[look.expression] ?? String(look.expression)],
    ['복장', OUTFIT_NAMES[look.outfit] ?? String(look.outfit)],
    ['착용', WEAR_STYLE_NAMES[look.wearStyle] ?? String(look.wearStyle)],
    ['하의', BOTTOM_NAMES[look.bottom] ?? String(look.bottom)],
    ['목 장식', NECKWEAR_NAMES[look.neckwear] ?? String(look.neckwear)],
  ]
  return (
    <div className="sc-ad__peek" role="dialog" aria-modal="true" aria-label={`${title} 아바타`} onClick={onClose}>
      <div className="sc-ad__peekBox" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="sc-ad__peekDirs">
          {DIRS.map((d) => (
            <figure key={d.dir}>
              <Sprite look={look} team={null} dir={d.dir} scale={3} />
              <figcaption>{d.name}</figcaption>
            </figure>
          ))}
        </div>
        <dl className="sc-ad__peekList">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  )
}
