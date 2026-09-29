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
import { VOTE_LABEL } from '../../../shared/rules/v2'
import { STATUS_LABEL } from '../../../shared/missions/roleNames'
import { NOT_DEALT } from '../../../shared/missions/paper'
import { Bag } from './UseItem'
import { Snow } from '../reveal/Snow'
import { PaperSheet } from './Paper'
import { Sheet, Sure } from './Sheet'
import { Dots } from './Shell'
import { TEAM_COLOR } from './MapPlan'
import { pixelFrame } from '../char/pixel'
import { uiIcon } from './uiArt'
import type { MyPaper, MissionShown } from './useMyPaper'
import type { GameActions } from './useGame'
import type { AvatarLook } from '../../../shared/look'
import type { InboxDoc, MissionMail } from '../../../shared/missions/mail'
import type { NotifyLink } from '../../../shared/notify/notifyData'
import { NotifyPanel } from './notify/NotifyPanel'
import { MissionPopup, finalMail, receivedMails, resultWord, sentText } from './MissionPopup'
import { BoardPopup, boardsOf } from './MissionBoard'
import type { MissionBoard } from '../../../shared/missions/mail'
import type { PlayerViewDoc, SeatEntry } from '../../../shared/model'
import type { TeamId } from '../types'
import { buzz } from './Controls'

export interface MeProps {
  me: SeatEntry
  day: number
  look: AvatarLook | null
  view: PlayerViewDoc | null
  /** 서버가 깎아 보낸 내 몫. 아직 안 왔으면 null. */
  paper: MyPaper | null
  /** 못 받아왔으면 그 이유. 조용히 비어 있는 것이 제일 나쁘다. */
  paperErr: string | null
  /** 못 받아왔을 때 다시 해 보기. */
  paperRetry?: () => void
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
  /** 지난 페이즈 기록. 링크를 누르면 시트가 올라온다. */
  log: ReactNode
  onSignOut: () => void
  /** 우편함 — 운영자가 보낸 내 판정. 지난 판정이 여기서 나온다 */
  inbox?: InboxDoc | null
  /** 모두에게 알린 결과(판 문서) · 이름을 찾을 자리 */
  boards?: Record<string, MissionBoard>
  /** 알림 보관함에서 한 줄을 누르면 그 화면으로 */
  onGo?: (link: NotifyLink) => void
}

/** 진행도 막대 칸 수. 도트 막대는 칸이 적어야 한 칸이 읽힌다. */
const BAR_CELLS = 8

export function Me(props: MeProps) {
  const { me, view, paper, act, onSaid } = props
  const [haveOpen, setHaveOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  /** 지난 판정에서 다시 펴 본 날. 「봤다」는 안 건드린다 */
  const [busy, setBusy] = useState(false)

  const items = view?.myItems ?? {}
  const itemCount = Object.values(items).reduce<number>((a, b) => a + (b ?? 0), 0)
  const slipCount = view?.mySlips?.length ?? 0
  /** 아직 배정 전인가. 고장이 아니라 기다리는 중이다 */
  const undealt = !paper && props.paperErr === NOT_DEALT

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      buzz('ok')
      onSaid(`${label} 했다.`)
    } catch (e) {
      buzz('no')
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
          open={flipped}
          onFold={() => setFlipped((v) => !v)}
        />

        {/* ── ② 가진 것 ────────────────────────────────── */}
        {/*
          펼침 표시(▼)는 제목 줄 오른쪽 끝에 둔다. 칸 줄 안에 두면 그것이
          여섯째 칸이 되어 다섯 칸이 폭을 똑같이 못 나눈다
        */}
        <Card
          title="가 진 것"
          aside={
            <button
              type="button"
              className="sc-mi__caret is-inline"
              aria-label={haveOpen ? '접기' : '펼치기'}
              onClick={() => setHaveOpen((v) => !v)}
            >
              {haveOpen ? '▲' : '▼'}
            </button>
          }
        >
          <button
            type="button"
            className={'sc-mi__have' + (haveOpen ? ' is-open' : '')}
            aria-expanded={haveOpen}
            onClick={() => setHaveOpen((v) => !v)}
          >
            <Chip icon="token" n={view?.myTeamTokens ?? null} label="토큰" />
            {/* 돈은 내 것, 지식은 팀 것이다 */}
            <Chip icon="money" n={view?.myMoney ?? null} label="돈" />
            <Chip icon="knowledge" n={view?.teamVault?.knowledge ?? null} label="지식" />
            <Chip icon="hand" n={itemCount} label="아이템" />
            <Chip icon="slip" n={slipCount} label="쪽지" />
            <Chip icon="mate" n={view?.myCarriedRobots ?? null} label="로봇" />
          </button>

          {haveOpen && (
            <div className="sc-mi__open">
              <h4>아이템</h4>
              <Bag items={items} view={view} act={act} onSaid={onSaid} />
              <h4>쪽지</h4>
              {slipCount === 0 && (view?.scrapsHere?.length ?? 0) === 0 ? (
                <p className="sc-mi__none">아직 쪽지가 없다. 바닥을 살펴보세요.</p>
              ) : (
                props.slips
              )}
            </div>
          )}
        </Card>

        {/* ── ③ 주 미션 ─────────────────────────────────── */}
        <Card title="미 션" state={paper?.counting ? STATUS_LABEL[paper.main.status] : null}>
          {/* 배정 전은 고장이 아니다 — 「못 받아왔다」도 다시 시도도 안 붙인다 */}
          {undealt && <p className="sc-mi__none">아직 배정되지 않았다</p>}
          {!paper &&
            !undealt &&
            (props.paperErr ? (
              <p className="sc-mi__none">
                못 받아왔다 — {props.paperErr}{' '}
                {props.paperRetry && (
                  <button type="button" className="sc-mi__retry" onClick={props.paperRetry}>
                    다시 시도
                  </button>
                )}
              </p>
            ) : (
              <Dots />
            ))}
          {paper && (
            <>
              <p className="sc-mi__mission">{paper.main.text}</p>
              {!paper.counting && <p className="sc-mi__fine">판이 열리면 센다.</p>}
            </>
          )}
        </Card>

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

        {/* ── 지난 판정 ────────────────────────────────── */}
        {/*
          운영자가 보낸 날마다 한 줄. 누르면 그날 종이가 다시 뜬다.
          마지막 날 판정이 오면 나흘을 한 표로 편다
        */}
        <PastVerdicts inbox={props.inbox} boards={props.boards} seats={props.seats} meId={me.playerId} />

        {/* ── ④ 받은 표 ────────────────────────────────── */}
        {/*
          **빈 줄을 안 둔다.** 전에는 학생증이 오기 전에도 설명 줄 자리가
          비어 있었고, 0 표일 때는 큰 「0」 하나만 덩그러니 섰다
        */}
        <Card title="받 은 표">
          {!paper ? (
            undealt ? <p className="sc-mi__none">아직 배정되지 않았다</p> : <Dots />
          ) : (
            <>
              {paper.votesReceived.trust === 0 && paper.votesReceived.liking === 0 ? (
                <p className="sc-mi__none">아직 없다</p>
              ) : (
                <p className="sc-mi__votes sc-mi__votes--split">
                  <span>
                    <b>{paper.votesReceived.trust}</b>
                    {VOTE_LABEL.trust}
                  </span>
                  <span>
                    <b>{paper.votesReceived.liking}</b>
                    {VOTE_LABEL.liking}
                  </span>
                </p>
              )}
              <p className="sc-mi__fine">
                {paper.votesThroughDay < 1
                  ? '첫날이다. 오늘 받은 표는 내일 더해진다.'
                  : paper.votesThroughDay < props.day
                    ? `DAY ${paper.votesThroughDay}까지 셌다. 오늘 것은 내일 더해진다.`
                    : '끝났다. 다 셌다.'}
              </p>
            </>
          )}
        </Card>

        {/* ── 알림 — 설정과 받은 알림 ──────────────────── */}
        <NotifyPanel act={act} inbox={props.inbox ?? null} onGo={(l) => props.onGo?.(l)} />

        {/* ── ⑥ 지난 페이즈 기록 ───────────────────────── */}
        <p className="sc-mi__link">
          <button type="button" onClick={() => setLogOpen(true)}>기록 보기</button>
        </p>

        {/* ── ⑦ 맨 아래 ────────────────────────────────── */}
        <p className="sc-mi__foot">
          <span>들어와 있는 계정 · {me.name}</span>
          {/* **눈에 띄면 안 되는 단추다.** 전에는 화면 한가운데 큰
              네모였다 — 실수로 눌리면 판이 도는 중에 판을 잃는다 */}
          <Sure type="button" className="sc-mi__out" warn="이 폰에서 나간다." onGo={() => props.onSignOut()}>
            나가기
          </Sure>
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
 * 학생증 한 장. **앞뒤가 있다.**
 *
 * 앞면은 사진 · 이름 · 반 · 역할 · 소개 한 줄. 누르면 뒤집혀서
 * 「그해 겨울, 나는」과 미션 한 줄, 조건마다 어디까지 왔는지가 나온다.
 * **기본은 앞면이다** — 남에게 화면을 보여 줄 일이 생기는 게임이라,
 * 뒷면을 펴 두면 그게 사고가 된다.
 *
 * 뒤집기는 3D 가 아니라 **도트식 장면 바꾸기**다. 한 면만 세우고,
 * 바뀔 때 가로로 세 걸음 펴진다. 두 면을 겹쳐 세우면 카드 키가 긴 쪽
 * (뒷면)에 맞춰져 앞면 아래가 텅 빈다.
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
  /** 뒷면이 보이는가. */
  open: boolean
  /** 뒤집는다. */
  onFold: () => void
}) {
  /* 정면 한 칸. pixelFrame 은 32×32 를 돌려주고, 화면에서 4배로
     늘린다 — 정수 배가 아니면 도트가 뭉갠다 */
  const face = useMemo(
    () => (look ? pixelFrame(look, team, 'down', 0).toDataURL() : null),
    [look, team],
  )
  const undealt = !paper && err === NOT_DEALT
  const waiting = undealt ? '아직 배정되지 않았다' : err ? `못 받아왔다 — ${err}` : null
  return (
    <Card title="학 생 증" className={'sc-mi__idcard' + (invisible ? ' is-gone' : '')}>
      {/*
        면을 누르면 뒤집힌다(손가락). 키보드와 읽어 주는 기계는 아래
        단추로 뒤집는다 — 면 전체를 단추로 만들면 뒷면 문단이 통째로
        단추 이름이 된다
      */}
      <div
        key={open ? 'back' : 'front'}
        className={'sc-mi__face2 ' + (open ? 'is-back' : 'is-front')}
        onClick={onFold}
      >
        {!open ? (
          <>
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
                <span className="sc-mi__role">
                  {paper ? paper.roleName : undealt ? <span className="sc-mi__cls">배정 전</span> : <Dots />}
                </span>
                {invisible && <span className="sc-mi__gone">오늘은 보이지 않는다</span>}
              </div>
              {/* 완장. 이름을 읽기 전에 몇 팀인지가 먼저 보인다 */}
              <span className="sc-mi__band" style={{ background: TEAM_COLOR[team] }} aria-hidden />
            </div>
            {/* 소개 한 줄. 문서 원문 그대로 */}
            {(paper || waiting) && <p className="sc-mi__intro">{paper ? paper.flavor : waiting}</p>}
          </>
        ) : (
          <div className="sc-mi__back">
            <h4 className="sc-mi__winter">그해 겨울, 나는</h4>
            {!paper ? (
              waiting ? <p className="sc-mi__none">{waiting}</p> : <Dots />
            ) : (
              <>
                {paper.situation.map((para, i) => (
                  <p key={i} className="sc-mi__para">
                    {para}
                  </p>
                ))}
                <p className="sc-mi__line">{paper.line}</p>
                {/* 짝사랑만. **이름뿐이다** — 어디 있는지 · 어느 팀인지는 안 온다 */}
                {paper.targetName && (
                  <p className="sc-mi__target">
                    <span>그 사람</span>
                    <b>{paper.targetName}</b>
                  </p>
                )}
                {!paper.counting && <p className="sc-mi__fine">판이 열리면 센다.</p>}
              </>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className={'sc-mi__fold' + (open ? ' is-open' : '')}
        aria-pressed={open}
        onClick={onFold}
      >
        {open ? '앞면으로' : '뒤집어 보기'}
        <i aria-hidden>{open ? '◀' : '▶'}</i>
      </button>
    </Card>
  )
}

/**
 * 나흘 표. **마지막 날 판정이 온 뒤에만** 편다.
 *
 * 줄은 날, 칸은 그날 결과. 마지막 선택은 마지막 날에만 정해져서 그 줄에만
 * 적는다. 안 온 날은 「—」 — 운영자가 그날을 안 보냈을 수도 있다.
 */
/**
 * 지난 판정 — 운영자가 보낸 날마다 한 줄. 누르면 그날 종이가 다시 뜬다
 * (「봤다」는 안 건드린다). 마지막 날 판정이 오면 나흘을 한 표로 편다.
 *
 * 「나」 탭과 엔딩 화면의 「판정」 탭이 같이 쓴다 — 마지막 날 판정은
 * 판이 끝난 뒤에 오고, 그때는 「나」 탭이 없다.
 */
export function PastVerdicts({
  inbox,
  boards,
  seats = [],
  meId = '',
}: {
  inbox: InboxDoc | null | undefined
  boards?: Record<string, MissionBoard>
  seats?: readonly SeatEntry[]
  meId?: string
}) {
  const [replay, setReplay] = useState<number | null>(null)
  const [replayBoard, setReplayBoard] = useState<number | null>(null)
  const shared = boardsOf(boards)
  const boardShown = replayBoard === null ? null : (shared.find((b) => b.day === replayBoard) ?? null)
  const mails = receivedMails(inbox)
  const lastMail = finalMail(inbox)
  const replayMail = replay === null ? null : (mails.find((m) => m.day === replay) ?? null)
  return (
    <>
      <Card title="지 난 판 정">
        {mails.length === 0 ? (
          <p className="sc-mi__none">아직 받은 판정이 없다.</p>
        ) : (
          <ul className="sc-mi__past">
            {mails.map((m) => (
              <li key={m.day}>
                <button type="button" onClick={() => setReplay(m.day)}>
                  <b>DAY {m.day}</b>
                  <span className={`sc-mi__word is-${m.status}`}>{resultWord(m.status)}</span>
                  <i>{sentText(m.sentAtMs)}</i>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lastMail && <DaysTable mails={mails} last={lastMail.day} />}
      </Card>
      {/* 모두에게 알린 결과. 운영자가 공개한 날만 줄이 선다 */}
      {shared.length > 0 && (
        <Card title="모 두 의 결 과">
          <ul className="sc-mi__past">
            {shared.map((b) => (
              <li key={b.day}>
                <button type="button" onClick={() => setReplayBoard(b.day)}>
                  <b>DAY {b.day}</b>
                  <span className="sc-mi__word">
                    {b.rows.filter((r) => r.met).length}/{b.rows.length} 성공
                  </span>
                  <i>{sentText(b.atMs)}</i>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {replayMail && <MissionPopup key={`again-${replayMail.day}`} mail={replayMail} onClose={() => setReplay(null)} />}
      {boardShown && (
        <BoardPopup key={`board-${boardShown.day}`} board={boardShown} seats={seats} meId={meId} onClose={() => setReplayBoard(null)} />
      )}
    </>
  )
}

function DaysTable({ mails, last }: { mails: readonly MissionMail[]; last: number }) {
  const days = Array.from({ length: Math.max(last, 1) }, (_, i) => i + 1)
  return (
    <table className="sc-mi__days">
      <caption>나흘</caption>
      <thead>
        <tr>
          <th scope="col">날</th>
          <th scope="col">결과</th>
          <th scope="col">마지막 선택</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => {
          const m = mails.find((x) => x.day === d)
          return (
            <tr key={d}>
              <th scope="row">DAY {d}</th>
              <td className={m ? `is-${m.status}` : ''}>{m ? resultWord(m.status) : '—'}</td>
              <td className={m?.final ? `is-${m.choice}` : ''}>{m?.final ? STATUS_LABEL[m.choice] : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
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
  aside,
  className = '',
  children,
}: {
  title: string
  /** 오른쪽 위에 작게. 미션 카드만 쓴다. */
  state?: string | null
  /** 제목 줄 오른쪽 끝. 가진 것의 펼침 표시가 여기 선다. */
  aside?: ReactNode
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
          {aside}
        </header>
        {children}
      </div>
      {/* 서류철의 클립 하나. 종이가 겹쳐 꽂혀 있다는 표시다 */}
      <span className="sc-mi__clip" aria-hidden />
    </section>
  )
}

/**
 * 가진 것 한 칸. 아이콘 16 → 숫자 → 이름, 세로로 선다.
 *
 * **높이를 못 박지 않는다.** 전에는 숫자(22px)를 18px 줄에 넣어서
 * 글자가 위아래 칸을 밟았다 — 아이콘 밑에 짓눌린 「0」이 그것이다.
 */
function Chip({ icon, n, label }: { icon: string; n: number | null; label: string }) {
  return (
    <span className="sc-mi__chip">
      <img src={uiIcon(icon)} alt="" width={16} height={16} />
      <b>{n ?? '—'}</b>
      <i>{label}</i>
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
