// 「나」 탭 — 학생증 한 장과 생활기록부.
//
// 전에는 흰 바탕에 회색 카드가 늘어서 있었다. 맵도 조작부도 탭바도
// 남색인데 여기만 다른 앱처럼 보였고, 자원 표·사람 카드 열셋·문제
// 종이·단추가 **전부 같은 굵기의 테**에 같은 둥근 모서리로 서 있어서
// 무엇이 중요한지가 없었다.
//
// 이제 투표용지·로그인과 같은 종이를 쓴다. 어두운 눈 바탕 위에
// 서류철처럼 종이 카드를 얹고, 카드마다 왼쪽 위에 클립 하나를 문다.
//
// **남에 대한 것은 여기 없다.** 같은 방 사람 목록은 수첩 탭으로 갔다 —
// 평소에 열셋을 늘어놓으면 그게 화면의 절반을 먹는다.
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { DAY4_CHOICES, DAY4_CHOICE_DAY } from '../../../shared/rules/choices'
import { STATUS_LABEL, type MissionStatus } from '../../../shared/missions/roleNames'
import { Bag } from './UseItem'
import { Snow } from '../reveal/Snow'
import { PaperSheet } from './Paper'
import { Sheet } from './Sheet'
import { TEAM_COLOR } from './MapPlan'
import { pixelFrame } from '../char/pixel'
import { uiIcon } from './uiArt'
import type { MyPaper, MissionShown } from './useMyPaper'
import type { GameActions } from './useGame'
import type { AvatarLook } from '../../../shared/look'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import type { TeamId } from '../types'

export interface MeProps {
  me: SeatEntry
  day: number
  look: AvatarLook | null
  view: PlayerViewDoc | null
  /** 서버가 깎아 보낸 내 몫. 아직 안 왔으면 null. */
  paper: MyPaper | null
  /** 못 받아왔으면 그 이유. 조용히 비어 있는 것이 제일 나쁘다. */
  paperErr: string | null
  /** 오늘 지워진 사람이 나인가. */
  invisible: boolean
  /** 오늘 지워진 사람 이름. 내가 아니면 알려 준다. */
  invisibleName: string | null
  /** 지금 같은 자리에 선 사람들. 1:1은 이들에게만 할 수 있다. */
  hereIds: readonly string[]
  hereName: string | null
  seats: readonly SeatEntry[]
  /** 눈발 세기. 배경에 같은 눈이 내린다. */
  snowLevel: number
  /** 문제 종이. 내 방 바닥의 일이라 여기 얹는다. */
  /** 쪽지. 「가진 것」을 펼치면 나온다. */
  slips: ReactNode
  act: GameActions
  onSaid: (text: string) => void
  ask: (text: string) => Promise<boolean>
  /** 지난 페이즈 기록. 링크를 누르면 시트가 올라온다. */
  log: ReactNode
  onSignOut: () => void
}

/** 진행도 막대 칸 수. 도트 막대는 칸이 적어야 한 칸이 읽힌다. */
const BAR_CELLS = 8

export function Me(props: MeProps) {
  const { me, view, paper, act, onSaid } = props
  const [haveOpen, setHaveOpen] = useState(false)
  const [secretOpen, setSecretOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const items = view?.myItems ?? {}
  const itemCount = Object.values(items).reduce<number>((a, b) => a + (b ?? 0), 0)
  const slipCount = view?.mySlips?.length ?? 0
  const floorSlips = view?.slipsHere?.length ?? 0

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onSaid(`${label} 했다.`)
    } catch (e) {
      onSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-mi-root">
      {/*
        배경 눈. 아침 화면·로그인과 같은 눈이다.
        **구르는 상자 밖에 둔다** — 안에 두면 캔버스가 스크롤을 따라
        같이 올라가서, 조금만 내려도 눈이 화면 위로 사라진다.
      */}
      <Snow level={props.snowLevel} />

      <div className="sc-mi__scroll">
      <div className="sc-mi__stack">
        {/* ── ① 학생증 ─────────────────────────────────── */}
        <IdCard
          name={me.name}
          team={me.team as TeamId}
          look={props.look}
          paper={paper}
          err={props.paperErr}
          invisible={props.invisible}
          open={secretOpen}
          onFold={() => setSecretOpen((v) => !v)}
        />

        {/* ── ② 가진 것 ────────────────────────────────── */}
        <Card title="가 진 것">
          <button
            type="button"
            className={'sc-mi__have' + (haveOpen ? ' is-open' : '')}
            aria-expanded={haveOpen}
            onClick={() => setHaveOpen((v) => !v)}
          >
            <Chip icon="token" n={view?.myTeamTokens ?? null} label="토큰" />
            <Chip icon="knowledge" n={view?.myVault?.knowledge ?? null} label="지식" />
            <Chip icon="hand" n={itemCount} label="아이템" />
            <Chip icon="slip" n={slipCount} label="쪽지" />
            <Chip icon="mate" n={view?.myCarriedRobots ?? null} label="짝" />
            <i className="sc-mi__caret" aria-hidden>{haveOpen ? '▲' : '▼'}</i>
          </button>

          {haveOpen && (
            <div className="sc-mi__open">
              <h4>아이템</h4>
              <Bag items={items} view={view} act={act} onSaid={onSaid} ask={props.ask} />
              <h4>쪽지</h4>
              {slipCount === 0 && floorSlips === 0 ? (
                <p className="sc-mi__none">들고 있는 쪽지가 없다.</p>
              ) : (
                props.slips
              )}
            </div>
          )}
        </Card>

        {/* ── ③ 주 미션 ─────────────────────────────────── */}
        <Card title="미 션" state={paper?.counting ? STATUS_LABEL[paper.main.status] : null}>
          {!paper && <p className="sc-mi__none">{props.paperErr ?? '불러오는 중…'}</p>}
          {paper && (
            <>
              <p className="sc-mi__mission">{paper.main.text}</p>
              {paper.counting ? (
                <Clauses m={paper.main} />
              ) : (
                <p className="sc-mi__fine">닷새가 열리면 센다.</p>
              )}
            </>
          )}
        </Card>

        {/*
          쪽지 미션. **서버가 셋을 늘 보낸다** — 한 장도 안 주웠어도
          0/1 로 뜬다. 주운 뒤에 생기는 것이 아니라, 쪽지를 만지는
          동안 따라붙는 조건 셋이다(roles.ts 의 SLIP_MISSIONS).

          카드에는 상태 한 마디를 안 단다 — 셋이 따로 도는 것이라
          하나로 묶으면 어느 것이 달성인지가 사라진다. 줄마다 붙인다
        */}
        {paper && paper.slips.length > 0 && (
          <Card title="쪽 지">
            <ul className="sc-mi__slips">
              {paper.slips.map((s) => (
                <li key={s.id}>
                  <p className="sc-mi__mission is-small">{s.text}</p>
                  <Gauge shown={s.shown} have={s.have} bar={s.bar} status={s.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* 마지막 선택. **그날에만 카드가 생긴다** */}
        {props.day === DAY4_CHOICE_DAY && (
          <Card title="마 지 막 선 택" state={paper ? STATUS_LABEL[paper.choice] : null}>
            {!view?.myChoice?.day4 && <p className="sc-mi__none">아직 고르지 않았다.</p>}
            <ul className="sc-mi__pick">
              {DAY4_CHOICES.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={view?.myChoice?.day4 === c.id ? 'is-on' : ''}
                    disabled={busy}
                    onClick={() => void run(c.label, () => act.chooseDay4(c.id))}
                  >
                    <b>{c.label}</b>
                    <span>{c.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ── ④ 받은 표 ────────────────────────────────── */}
        <Card title="받 은 표">
          <p className="sc-mi__votes">
            <b>{paper ? paper.votesReceived : '—'}</b>
          </p>
          <p className="sc-mi__fine">
            {!paper
              ? ''
              : paper.votesThroughDay < 1
                ? '첫날이다. 오늘 받은 표는 내일 더해진다.'
                : paper.votesThroughDay < props.day
                  ? `DAY ${paper.votesThroughDay}까지 셌다. 오늘 것은 내일 더해진다.`
                  : '끝났다. 다 셌다.'}
          </p>
        </Card>

        {/* ── ⑥ 지난 페이즈 기록 ───────────────────────── */}
        <p className="sc-mi__link">
          <button type="button" onClick={() => setLogOpen(true)}>기록 보기</button>
        </p>

        {/* ── ⑦ 맨 아래 ────────────────────────────────── */}
        <p className="sc-mi__foot">
          <span>들어와 있는 계정 · {me.name}</span>
          {/* **눈에 띄면 안 되는 단추다.** 전에는 화면 한가운데 큰
              네모였다 — 실수로 눌리면 판이 도는 중에 판을 잃는다 */}
          <button
            type="button"
            className="sc-mi__out"
            onClick={() => {
              void props.ask('나간다.').then((ok) => {
                if (ok) props.onSignOut()
              })
            }}
          >
            나가기
          </button>
        </p>

        {props.invisibleName && !props.invisible && (
          <p className="sc-mi__fine sc-mi__note">오늘의 투명인간 · {props.invisibleName}</p>
        )}
      </div>
      </div>

      {/* ── 시트들 ────────────────────────────────────── */}
      {logOpen && (
        <Sheet title="지난 페이즈" onClose={() => setLogOpen(false)}>
          {props.log}
        </Sheet>
      )}
    </div>
  )
}

/**
 * 학생증 한 장.
 *
 * **두 군데가 같은 것을 쓴다** — 열넷이 차서 배정이 끝나면 화면
 * 가운데로 이 카드가 넘어오고(Dealt.tsx), 그 뒤로는 「나」 탭 맨 위에
 * 같은 카드가 있다. 두 벌로 만들면 한쪽만 고쳐지는 날이 온다.
 */
export function IdCard({
  name,
  team,
  look,
  paper,
  err,
  invisible = false,
  open,
  onFold,
}: {
  name: string
  team: TeamId
  look: AvatarLook | null
  paper: MyPaper | null
  err: string | null
  /** 오늘 지워진 사람인가. 카드째 흐려진다. */
  invisible?: boolean
  /** 숨긴 사실이 펴져 있는가. */
  open: boolean
  onFold: () => void
}) {
  /* 정면 한 칸. pixelFrame 은 32×32 를 돌려주고, 화면에서 4배로
     늘린다 — 정수 배가 아니면 도트가 뭉갠다 */
  const face = useMemo(
    () => (look ? pixelFrame(look, team, 'down', 0).toDataURL() : null),
    [look, team],
  )
  return (
    <Card title="학 생 증" className={invisible ? 'is-gone' : ''}>
      <div className="sc-mi__id">
        <span
          className="sc-mi__face"
          aria-hidden
          style={face ? { backgroundImage: `url(${face})` } : undefined}
        />
        <div className="sc-mi__who">
          <b>{name}</b>
          <span className="sc-mi__cls">2학년 3반 · {team}팀</span>
          {/* 역할 이름만. 갈래(팀의 길·사람의 길·밖의 길)는 안 적는다 —
              이름이 이미 그보다 많은 것을 말하고, 갈래까지 붙으면
              남에게 화면을 한 번 보여 줄 때 넷 중 하나로 좁혀진다 */}
          <span className="sc-mi__role">{paper ? paper.roleName : '…'}</span>
          {invisible && <span className="sc-mi__gone">오늘은 보이지 않는다</span>}
        </div>
        {/* 완장. 이름을 읽기 전에 몇 팀인지가 먼저 보인다 */}
        <span className="sc-mi__band" style={{ background: TEAM_COLOR[team] }} aria-hidden />
      </div>

      {/* 역할 한 줄. **기본은 접힘** — 남에게 화면을 보여 줄 일이
          생기는 게임이라, 펴 두면 그게 사고가 된다.
          짝사랑만 딸린 한 줄(footnote)이 더 붙는다 — 이름뿐이고
          그 사람이 어디 있는지는 안 온다 */}
      <button
        type="button"
        className={'sc-mi__fold' + (open ? ' is-open' : '')}
        aria-expanded={open}
        onClick={onFold}
      >
        내 역할
        <i aria-hidden>{open ? '▲' : '▼'}</i>
      </button>
      {open && (
        <p className="sc-mi__secret">
          {paper ? paper.flavor : err ? `못 받아왔다 — ${err}` : '…'}
          {paper?.footnote && <em className="sc-mi__foot">{paper.footnote}</em>}
        </p>
      )}
    </Card>
  )
}

/**
 * 종이 카드 한 장.
 *
 * 아홉 조각 종이(Paper.tsx)를 그대로 쓴다 — 로그인 화면과 투표용지가
 * 쓰는 그 종이다. 두 군데에 같은 조각을 따로 붙여 두면 한쪽 구김만
 * 고쳐지는 날이 온다.
 */
export function Card({
  title,
  state,
  className = '',
  children,
}: {
  title: string
  /** 오른쪽 위에 작게. 미션 카드만 쓴다. */
  state?: string | null
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <section className={`sc-mi__card ${className}`} ref={ref}>
      <PaperSheet cls="sc-mi" />
      <div className="sc-mi__in">
        <header className="sc-mi__head">
          <h3>{title}</h3>
          {state && <span className="sc-mi__state">{state}</span>}
        </header>
        {children}
      </div>
      {/* 서류철의 클립 하나. 종이가 겹쳐 꽂혀 있다는 표시다 */}
      <span className="sc-mi__clip" aria-hidden />
    </section>
  )
}

function Chip({ icon, n, label }: { icon: string; n: number | null; label: string }) {
  return (
    <span className="sc-mi__chip">
      <img src={uiIcon(icon)} alt="" width={16} height={16} />
      <b>{n ?? '—'}</b>
      <i>{label}</i>
    </span>
  )
}

/**
 * 조항 줄들.
 *
 * **숫자가 안 온 조항은 막대도 안 그린다.** 서버가 빼고 만들어 보내서
 * (discloseFor) 여기에는 애초에 값이 없다 — 받아 놓고 가리는 것이
 * 아니다. 그런 줄에는 「끝날 때 판정」 같은 말만 붙는다.
 */
function Clauses({ m }: { m: MissionShown }) {
  return (
    <ul className="sc-mi__clauses">
      {m.clauses.map((c, i) => (
        <li key={`${i}-${c.text}`}>
          <p>{c.text}</p>
          <Gauge shown={c.shown} have={c.have} bar={c.bar} status={c.status} unit={c.unit} />
        </li>
      ))}
    </ul>
  )
}

/**
 * 진행도 한 칸. 조항에도 쪽지 미션에도 같은 것이 붙는다.
 *
 * **have 가 null 이면 숫자가 아예 안 온 것이다.** 가려 둔 게 아니라
 * 서버가 담지 않았다(discloseFor). 그때는 상태 한 마디만 적는다 —
 * 「끝날 때 판정」이라고 쓰면 가린 것이 아니라 아직 셀 때가 아니라는
 * 뜻이 된다.
 */
function Gauge({
  shown,
  have,
  bar,
  status,
  unit = 'count',
}: {
  shown: boolean
  have: number | null
  bar: number
  status: MissionStatus
  unit?: 'count' | 'minutes' | 'flag'
}) {
  if (!shown || have === null) {
    return <span className="sc-mi__later">{STATUS_LABEL[status]}</span>
  }
  if (unit === 'flag') {
    const met = status === 'met'
    return <span className={'sc-mi__flag' + (met ? ' is-met' : '')}>{met ? '했다' : '아직'}</span>
  }
  return (
    <span className="sc-mi__bar">
      <i aria-hidden>
        {Array.from({ length: BAR_CELLS }, (_, k) => (
          <em key={k} className={k < cells(have, bar) ? 'is-on' : ''} />
        ))}
      </i>
      <b>
        {have}/{bar}
        {unit === 'minutes' && '분'}
      </b>
    </span>
  )
}

/** 여덟 칸 중 몇 칸을 채우나. 하나라도 셌으면 한 칸은 켠다 */
export function cells(have: number, bar: number): number {
  if (bar <= 0) return have > 0 ? BAR_CELLS : 0
  const share = Math.min(1, have / bar)
  if (share <= 0) return 0
  return Math.max(1, Math.round(share * BAR_CELLS))
}

/** 카드 오른쪽 위에 적을 한 마디. */
export function stateOf(m: MissionShown): string {
  return STATUS_LABEL[m.status]
}
