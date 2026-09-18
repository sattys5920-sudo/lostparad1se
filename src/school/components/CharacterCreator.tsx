// 나를 만든다 — 전신 거울 하나와 서랍 셋.
//
// 전에는 「라벨 ‹ 값 ›」 줄이 여덟 개 늘어선 설정 목록이었다. 무엇을
// 고르는지가 **글자로만** 적혀 있어서, 「울프컷 13/30」을 보고 그 머리가
// 어떻게 생겼는지 알려면 화살표를 눌러 보는 수밖에 없었다. 서른 종을
// 다 보려면 서른 번 누른다.
//
// 그래서 **고를 것을 전부 그림으로 깔았다.** 머리 서른 종은 머리통만
// 잘라 격자로 펴 놓고, 머리색 아홉은 진짜 그 색 동그라미로 놓고,
// 표정·교복은 달라지는 부분만 잘라 키운다. 누르기 전에 무엇이 될지
// 보인다.
//
// 색과 글꼴은 게임 화면(조작부)과 같다. 로그인에서 여기로, 여기서
// 판으로 넘어가는 동안 세계가 바뀌면 안 된다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import './CharacterCreator.css'
import {
  DIRS,
  EXPRESSION_NAMES,
  HAIR_BY_ID,
  HAIR_IDS_F,
  HAIR_IDS_M,
  NECKWEAR_NAMES,
  OUTFITS,
  PX,
  WEAR_STYLE_NAMES,
  pixelFrame,
  type Dir,
} from '../char/pixel'
import { HAIR_COLORS, TEAMS } from '../char/palette'
import { BOTTOM_NAMES, randomLook, withStyleSet } from '../char/look'
import type { TeamId } from '../types'
import type { AvatarLook, StyleSet } from '../../../shared/look'

/** 머리 + 상반신 — 명단·대화 아이콘용 */
export const BUST_BOX = { x: 8, y: 6, w: 16, h: 18 }

/*
 * 자르는 칸들. 32×32 몸에서 어디가 무엇인지는 이렇다 —
 * 머리칼 5~19줄, 눈 15~16줄, 입 17줄, 목 20~22줄, 몸통 20~27줄,
 * 다리 27~31줄. 눈대중으로 정하면 **서른 종이 다 똑같이 보인다**
 * (머리 꼭대기가 잘려서 길이와 앞머리가 안 보였다).
 */

/** 머리통. 어깨에 내려앉는 긴 머리까지 들어오게 아래를 넉넉히 둔다. */
const HEAD_BOX = { x: 8, y: 3, w: 16, h: 19 }

/** 눈과 입만. 표정 차이는 여기 여덟 줄에 다 들어 있다. */
const FACE_BOX = { x: 10, y: 11, w: 12, h: 9 }

/**
 * 옷만 보려고 자르는 칸 — 턱 아래부터 신발까지.
 *
 * 옷 차이는 가슴 다섯 줄에 다 들어 있다. 온몸을 작게 보여 주면 그
 * 다섯 줄이 열 몇 픽셀로 줄어서, 무엇이 달라졌는지 볼 수가 없다.
 */
const WEAR_BOX = { x: 8, y: 18, w: 16, h: 14 }

/** 목만. 넥타이와 리본은 두어 줄 차이다. */
const NECK_BOX = { x: 10, y: 19, w: 12, h: 6 }

/** 착용 스타일 셋이 각각 무엇인지. 이름만으로는 무엇이 다른지 모른다. */
const WEAR_STYLE_NOTES = [
  '단추를 끝까지 잠근다',
  '적당히. 대부분 이렇게 입는다',
  '셔츠를 빼입고 넥타이를 풀었다',
]

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

/**
 * 거울에 세울 배율. **짧은 화면에서는 한 칸 줄인다.**
 *
 * 6 배는 192px 이다. 667px 짜리 화면에서 거울이 238px 을 가져가면
 * 서랍에 두 줄 반밖에 안 남는다. 배율은 정수로만 내린다 — 5.5 배로
 * 두면 도트가 뭉갠다.
 */
function useMirrorScale(): number {
  const [small, setSmall] = useState(() => typeof innerHeight === 'number' && innerHeight < 720)
  useEffect(() => {
    const on = () => setSmall(innerHeight < 720)
    addEventListener('resize', on)
    addEventListener('orientationchange', on)
    return () => {
      removeEventListener('resize', on)
      removeEventListener('orientationchange', on)
    }
  }, [])
  return small ? 5 : 6
}

/** 성별. 머리·하의 목록의 기본값을 정할 뿐 몸 픽셀 맵은 남녀가 같다. */
const SET_IDS: StyleSet[] = ['M', 'F']
const SET_NAMES = ['남', '여']

/**
 * 서랍 셋. 한 화면에 여덟 줄을 다 펴 놓는 대신 갈래로 나눈다.
 *
 * 꼭지 그림은 자르는 칸이 작을수록 크게 키운다 — 같은 배로 두면
 * 얼굴 꼭지만 손톱만 해져서 무슨 그림인지 안 보인다.
 */
type Drawer = 'hair' | 'face' | 'wear'
const DRAWERS: { id: Drawer; name: string; crop: Crop; scale: number }[] = [
  { id: 'hair', name: '머리', crop: HEAD_BOX, scale: 2 },
  { id: 'face', name: '얼굴', crop: FACE_BOX, scale: 3 },
  { id: 'wear', name: '옷', crop: WEAR_BOX, scale: 2 },
]

/**
 * 고르는 묶음 하나.
 *
 * 머리처럼 종류가 많은 것은 이름을 칸마다 적지 않는다 — 다섯 칸에
 * 「시스루뱅 단발」이 들어가면 글자가 그림보다 커진다. 대신 **지금
 * 고른 것의 이름을 머리말에 한 번** 적는다.
 */
function Sec({ label, now, children }: { label: string; now: string; children: ReactNode }) {
  return (
    <section className="sc-cc__sec">
      <h3 className="sc-cc__secHead">
        <span>{label}</span>
        <b>{now}</b>
      </h3>
      <div className="sc-cc__grid" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </section>
  )
}

/** 격자 한 칸. 그림이 곧 값이다. */
function Pick({
  on,
  name,
  title,
  onPick,
  children,
}: {
  on: boolean
  name?: string
  title: string
  onPick: () => void
  children?: ReactNode
}) {
  return (
    <button
      className={`sc-cc__pick${on ? ' is-on' : ''}`}
      role="radio"
      aria-checked={on}
      aria-label={title}
      title={title}
      onClick={onPick}
    >
      {children}
      {name && <b>{name}</b>}
    </button>
  )
}

export function CharacterCreator({
  look,
  team,
  onChange,
  name,
  onName,
  error,
  busy,
  onDone,
  doneLabel = '이 아이로 정한다',
  corner,
}: {
  look: AvatarLook
  team: TeamId | null
  onChange: (next: AvatarLook) => void
  /** 이름칸을 같이 둘 때. 안 주면 안 그린다 */
  name?: string
  onName?: (next: string) => void
  error?: string
  busy?: boolean
  onDone?: () => void
  doneLabel?: string
  /** 무대 왼쪽 위에 얹을 것 — 로그아웃 같은 */
  corner?: ReactNode
}) {
  const [dir, setDir] = useState<Dir>('down')
  const [drawer, setDrawer] = useState<Drawer>('hair')
  const mirror = useMirrorScale()

  const turn = (step: number) => {
    const i = DIRS.indexOf(dir)
    setDir(DIRS[(i + step + DIRS.length) % DIRS.length])
  }

  const teamDef = team ? TEAMS.find((t) => t.id === team) : null

  // 고른 성별의 열다섯 종이 앞에 오고 반대쪽 열다섯 종이 뒤에 붙는다.
  // 격자라서 끝까지 굴리면 성별 너머의 머리까지 그대로 이어진다
  const hairIds = look.styleSet === 'M' ? [...HAIR_IDS_M, ...HAIR_IDS_F] : [...HAIR_IDS_F, ...HAIR_IDS_M]
  const hairAt = Math.max(0, hairIds.indexOf(look.hairStyle))

  /** 성별은 목록의 기본값이다 — 바꾸면 머리도 같은 자리의 반대쪽 머리로 옮긴다. */
  const pickSet = (i: number) => onChange(withStyleSet(look, SET_IDS[i]))

  return (
    <div className="sc-cc">
      {/* ── 전신 거울 ───────────────────────────────────────── */}
      <div className="sc-cc__stage">
        {corner && <div className="sc-cc__corner">{corner}</div>}
        <button className="sc-cc__dice" onClick={() => onChange(randomLook(look.styleSet))}>
          아무나
        </button>

        <div className="sc-cc__mirror">
          <button className="sc-cc__turn" aria-label="왼쪽으로 돌리기" onClick={() => turn(-1)}>
            ‹
          </button>
          <WalkPreview look={look} team={team} dir={dir} scale={mirror} />
          <button className="sc-cc__turn" aria-label="오른쪽으로 돌리기" onClick={() => turn(1)}>
            ›
          </button>
        </div>

        <p className="sc-cc__band">
          완장 {teamDef ? teamDef.name : '미정'} — {teamDef ? '배정된 것이라 바꿀 수 없다' : '시작할 때 정해진다'}
        </p>
      </div>

      {/* ── 이름표 ─────────────────────────────────────────── */}
      {onName && (
        <label className="sc-cc__name">
          <span>이 름</span>
          <input
            id="cc-name"
            value={name ?? ''}
            maxLength={12}
            placeholder="1~12자"
            onChange={(e) => onName(e.target.value)}
          />
        </label>
      )}

      {/* ── 서랍 ───────────────────────────────────────────── */}
      <div className="sc-cc__tabs" role="tablist">
        {DRAWERS.map((d) => (
          <button
            key={d.id}
            className={`sc-cc__tab${drawer === d.id ? ' is-on' : ''}`}
            role="tab"
            aria-selected={drawer === d.id}
            onClick={() => setDrawer(d.id)}
          >
            <Sprite look={look} team={team} scale={d.scale} crop={d.crop} />
            <b>{d.name}</b>
          </button>
        ))}
      </div>

      <div className="sc-cc__drawer">
        {drawer === 'hair' && (
          <>
            {/* 여기만 그림이 없다. 몸 픽셀 맵은 남녀가 같아서 두 칸을
                나란히 그려 놓으면 **똑같은 그림 두 개**가 된다 — 고르는
                사람은 뭐가 다른지 찾느라 눈만 버린다. 바뀌는 것은
                아래 목록의 차례다 */}
            <Sec label="성별" now="머리와 하의 차례가 바뀐다">
              {SET_NAMES.map((n, i) => (
                <Pick key={n} on={look.styleSet === SET_IDS[i]} name={n} title={n} onPick={() => pickSet(i)} />
              ))}
            </Sec>

            <Sec label="머리" now={`${HAIR_BY_ID[hairIds[hairAt]].name} ${hairAt + 1}/${hairIds.length}`}>
              {hairIds.map((id) => (
                <Pick
                  key={id}
                  on={id === look.hairStyle}
                  title={HAIR_BY_ID[id].name}
                  onPick={() => onChange({ ...look, hairStyle: id })}
                >
                  <Sprite look={{ ...look, hairStyle: id }} team={team} scale={2} crop={HEAD_BOX} />
                </Pick>
              ))}
            </Sec>

            <Sec label="머리색" now={HAIR_COLORS[look.hairColor].name}>
              {HAIR_COLORS.map((c, i) => (
                <Pick
                  key={c.name}
                  on={i === look.hairColor}
                  title={c.name}
                  onPick={() => onChange({ ...look, hairColor: i })}
                >
                  {/* 색은 머리통을 다시 그리지 않고 그 색 자체를 보인다 —
                      아홉 개를 다 그리면 머리 격자와 구분이 안 간다 */}
                  <span className="sc-cc__chip" style={{ background: c.tone.base, borderColor: c.tone.line }} />
                </Pick>
              ))}
            </Sec>
          </>
        )}

        {drawer === 'face' && (
          <Sec label="표정" now={EXPRESSION_NAMES[look.expression]}>
            {EXPRESSION_NAMES.map((n, i) => (
              <Pick
                key={n}
                on={i === look.expression}
                name={n}
                title={n}
                onPick={() => onChange({ ...look, expression: i })}
              >
                <Sprite look={{ ...look, expression: i }} team={team} scale={3} crop={FACE_BOX} />
              </Pick>
            ))}
          </Sec>
        )}

        {drawer === 'wear' && (
          <>
            <Sec label="복장" now={OUTFITS[look.outfit].note}>
              {OUTFITS.map((o, i) => (
                <Pick
                  key={o.name}
                  on={i === look.outfit}
                  name={o.name}
                  title={o.name}
                  onPick={() => onChange({ ...look, outfit: i })}
                >
                  <Sprite look={{ ...look, outfit: i }} team={team} scale={2} crop={WEAR_BOX} />
                </Pick>
              ))}
            </Sec>

            <Sec label="착용" now={WEAR_STYLE_NOTES[look.wearStyle]}>
              {WEAR_STYLE_NAMES.map((n, i) => (
                <Pick
                  key={n}
                  on={i === look.wearStyle}
                  name={n}
                  title={n}
                  onPick={() => onChange({ ...look, wearStyle: i })}
                >
                  <Sprite look={{ ...look, wearStyle: i }} team={team} scale={2} crop={WEAR_BOX} />
                </Pick>
              ))}
            </Sec>

            <Sec label="하의" now={BOTTOM_NAMES[look.bottom]}>
              {BOTTOM_NAMES.map((n, i) => (
                <Pick
                  key={n}
                  on={i === look.bottom}
                  name={n}
                  title={n}
                  onPick={() => onChange({ ...look, bottom: i })}
                >
                  <Sprite look={{ ...look, bottom: i }} team={team} scale={2} crop={WEAR_BOX} />
                </Pick>
              ))}
            </Sec>

            <Sec label="목" now={NECKWEAR_NAMES[look.neckwear]}>
              {NECKWEAR_NAMES.map((n, i) => (
                <Pick
                  key={n}
                  on={i === look.neckwear}
                  name={n}
                  title={n}
                  onPick={() => onChange({ ...look, neckwear: i })}
                >
                  <Sprite look={{ ...look, neckwear: i }} team={team} scale={3} crop={NECK_BOX} />
                </Pick>
              ))}
            </Sec>
          </>
        )}
      </div>

      {/* ── 정한다 ─────────────────────────────────────────── */}
      {onDone && (
        <div className="sc-cc__foot">
          {error && <p className="sc-cc__error">{error}</p>}
          <button className="sc-cc__done" disabled={busy} onClick={onDone}>
            {doneLabel}
          </button>
        </div>
      )}
    </div>
  )
}
