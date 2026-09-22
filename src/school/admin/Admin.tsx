// 관리자 화면.
//
// **판을 움직이는 단추는 전부 여기 있다.** 전에는 플레이어 화면
// 「더보기」 시트 안에 운영자만 보이게 섞여 있었다. 그러면 두 가지가
// 나쁘다 — 운영자가 게임을 하면서 판을 조작하게 되고, 무엇이 운영자
// 권한인지 코드에서도 한눈에 안 보인다.
//
// **화면이 막는 것은 하나도 없다.** 여기 있는 모든 단추는 서버가
// 운영자 표시를 다시 확인한다. 이 페이지는 주소만 알면 누구나 열 수
// 있고, 열어도 아무것도 안 된다.
//
// **세 탭이다 — 진행 · 놓기 · 관리.** 아홉 카드를 한 줄로 늘어놓았을
// 때는 페이즈 하나 닫으려고 열 줄짜리 심부름 목록을 지나쳐야 했다.
// 운영자가 하는 일은 자주 하는 순으로 셋이다: 판을 돌리는 것(페이즈·
// 달력), 판 위에 무엇을 놓는 것(심부름·화분·종이), 가끔 손보는 것
// (시작·QA·문제 은행·가입). 그 셋이 탭이다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { deleteAccounts, listAccounts, logOut, type AccountSummary } from '../accounts'
import { gameActions, useGame } from '../game/useGame'
import { QuizHost } from '../game/Quiz'
import { DropHost } from './Drop'
import { ErrandDesk } from './Errands'
import { GardenDesk } from './Garden'
import { useGameNow } from '../game/Shell'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
import { ALL_KEY, ENDING_MAX } from '../../../shared/reveal/ending'
import './admin.css'

const GAME_ID = new URLSearchParams(location.search).get('game') ?? 'live'

/** 서울 시각으로 읽는다. 판이 보는 시계와 같은 시계다. */
const clockText = (ms: number) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ms)

/**
 * 운영자 책상.
 *
 * **문은 여기에 없다.** 들어오는 자리는 로그인 화면 하나고, 거기서
 * 코드를 맞힌 사람만 이 화면을 받는다(Root 가 가른다). 전에는 이
 * 파일이 제 문을 따로 들고 있었다.
 *
 * **화면이 막는 것은 하나도 없다.** 여기 있는 모든 단추는 서버가
 * 운영자 표시를 다시 확인한다.
 */
export function Admin() {
  return <Desk />
}

/** 달력 한 칸의 이름. 운영자가 무엇을 누르는지 알아야 한다. */
const CALENDAR: Record<string, string> = {
  dayStart: '다음 날 아침',
  settlement: '21시 정산',
  lastHours: '점수판 끄기 (마지막 여섯 시간)',
  gameEnd: '닷새 끝 · 엔딩',
}

type Tab = 'go' | 'put' | 'manage'

/** 판의 상태를 우리말로. 알약에 running 이 그대로 찍히고 있었다 */
const PHASE_NAME: Record<string, string> = {
  lobby: '로비',
  running: '진행 중',
  finished: '끝났다',
}

/** 남은 시간. 한 시간 안쪽이라 분:초면 된다 */
const leftText = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Desk() {
  const state = useGame(GAME_ID)
  const act = useMemo(() => gameActions(GAME_ID), [])
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [qaPw, setQaPw] = useState('')
  const [tab, setTab] = useState<Tab>('go')
  /** 다음에 넘길 달력 한 칸. 서버가 알려 준다 — 화면이 세지 않는다 */
  const [nextUp, setNextUp] = useState<{ kind: string; day: number } | null>(null)
  const nowMs = useGameNow(state.game?.clock)
  /** 페이즈 남은 시간을 세는 초침 */
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      const out = await fn()
      const n = (out as { added?: number; seated?: number } | undefined) ?? {}
      setSaid(
        n.added !== undefined ? `${label} 했다. ${n.added}칸.`
        : n.seated !== undefined ? `${label} 했다. ${n.seated}명.`
        : `${label} 했다.`,
      )
    } catch (e) {
      setSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * QA 판 한 번에 차리기.
   *
   * 판 만들기 · 열넷 채우기 · 닷새 시작을 따로 누르게 두면, 중간에
   * 한 단계를 빠뜨린 채 「왜 시작이 안 되냐」로 끝난다. 실제로 그랬다.
   * **순서가 정해져 있는 일은 순서째로 한 단추에 둔다.**
   *
   * 이미 있는 판은 건드리지 않는다 — 돌고 있는 판을 덮어쓰는 단추를
   * 관리자 화면에 두면 언젠가 잘못 눌린다.
   */
  async function setUpQa(): Promise<void> {
    setBusy(true)
    try {
      if (!state.game) {
        await act.createGame()
        setSaid('판을 만들었다. 자리를 채우는 중…')
      } else if (state.game.phase !== 'lobby') {
        setSaid('이미 돌고 있는 판이다. 덮어쓰지 않는다.')
        return
      }
      const seeded = (await act.seedPlayers(qaPw, 0)) as { seated?: number }
      setSaid(`${seeded.seated ?? 0}명이 앉았다. 시작하는 중…`)
      await act.startGame()
      // 비밀번호를 여기 한 번 더 적는다. 다른 기기에 쳐 넣어야 하는 값이다
      setSaid(`차렸다. qa01 … qa14 · 비밀번호 ${qaPw}`)
    } catch (e) {
      setSaid((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const game = state.game
  const seats = game?.seats ?? []
  const running = game !== null && game !== undefined && game.phase !== 'lobby'
  /*
   * 배정했는가. **자리의 팀으로 본다** — 역할이 적힌 곳(secret/roster)은
   * 운영자도 못 읽는다. 팀과 역할은 한 트랜잭션에서 같이 정해지므로,
   * 팀이 차 있으면 역할도 나뉜 것이다
   */
  const assigned = seats.length === TOTAL_SEATS && seats.every((s) => s.team !== null)

  /**
   * 다음에 넘길 것을 미리 묻는다.
   *
   * **누르기 전에 알아야 누를 수 있다.** 「다음으로」만 있고 그것이
   * 무엇인지 안 보이면, 엔딩을 넘기려던 손이 정산을 넘긴다.
   */
  const phaseName = game?.phase ?? ''
  const dayNow = game?.day ?? 0
  useEffect(() => {
    if (phaseName !== 'running') {
      setNextUp(null)
      return
    }
    let alive = true
    void act
      .peekDay()
      .then((r) => {
        if (alive) setNextUp((r as { next?: { kind: string; day: number } | null }).next ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [act, phaseName, dayNow, said])

  // 판이 돌기 전에는 진행·놓기 탭에 할 것이 없다. 관리로 보낸다
  useEffect(() => {
    if (!running) setTab('manage')
  }, [running])

  const phaseNo = game?.phaseNow?.no ?? 0
  const phaseOpen = game?.phaseNow?.open === true
  const phaseEndsAtMs = game?.phaseNow?.endsAtMs ?? null
  const phaseLeft =
    phaseOpen && phaseEndsAtMs !== null ? (tick >= phaseEndsAtMs ? '시간 끝' : `${leftText(phaseEndsAtMs - tick)} 남음`) : null

  return (
    <div className="sc-ad">
      {/* ── 머리줄. 구르는 동안에도 붙어 있다 ── */}
      <div className="sc-ad__bar">
        <header className="sc-ad__top">
          <h1>관리자</h1>
          <span className="sc-ad__game">{GAME_ID}</span>
          {/* 게임 시계다. 개발용 배속을 걸어 두면 실제 시각과 다르다 */}
          {game && <span className="sc-ad__clock">{clockText(nowMs)}</span>}
          {/* 나가면 로그인 화면으로 돌아간다. 운영자는 계정이 없으므로
              증표를 버리는 것이 곧 나가는 것이다 */}
          <button className="sc-ad__out" onClick={() => void logOut()}>
            나가기
          </button>
        </header>

        {/*
          지금 상태 한 줄. **탭을 옮겨도 이건 보인다** — 페이즈가
          열려 있는지, 며칠째인지는 어느 탭에서든 알아야 한다.
        */}
        {game && (
          <div className="sc-ad__pills">
            <span className={`sc-ad__pill${running ? ' is-live' : ''}`}>{PHASE_NAME[game.phase] ?? game.phase}</span>
            {running && <span className="sc-ad__pill">DAY {game.day}</span>}
            {running && (
              <span className={`sc-ad__pill${phaseOpen ? ' is-on' : ''}`}>
                {phaseOpen ? `페이즈 ${phaseNo} 열림${phaseLeft ? ` · ${phaseLeft}` : ''}` : `페이즈 ${phaseNo} 닫힘`}
              </span>
            )}
            <span className="sc-ad__pill">
              {seats.length}/{TOTAL_SEATS}명
            </span>
          </div>
        )}

        {running && (
          <nav className="sc-ad__tabs" aria-label="운영자 탭">
            {(
              [
                ['go', '진행'],
                ['put', '놓기'],
                ['manage', '관리'],
              ] as const
            ).map(([id, name]) => (
              <button key={id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
                {name}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="sc-ad__body">
        {state.loading ?
          <p className="sc-ad__hint">불러오는 중</p>
        : !game ?
          /* ── 아직 판이 없다 ── */
          <section className="sc-ad__sec">
            <h2>판</h2>
            <p className="sc-ad__hint">아직 판이 없다.</p>
            <button className="is-primary" disabled={busy} onClick={() => void run('판 만들기', () => act.createGame())}>
              판 만들기
            </button>
            <QaSetUp busy={busy} qaPw={qaPw} setQaPw={setQaPw} onGo={setUpQa} />
          </section>
        : !running ?
          /* ── 로비. 배정하고 시작한다 ── */
          <>
            <section className="sc-ad__sec">
              <h2>배정</h2>
              {/*
                팀과 개인 미션을 한꺼번에 나눈다. **한 번뿐이다** —
                누르는 순간 각자 학생증에 제 역할이 뜬다. 다시 나누려면
                판을 초기화해야 한다
              */}
              <p className="sc-ad__hint">
                {assigned ?
                  '나눴다. 각자 학생증에 제 팀과 미션이 떴다.'
                : seats.length < TOTAL_SEATS ?
                  `열넷이 다 앉아야 나눈다. 지금 ${seats.length}명.`
                : '누르면 팀과 개인 미션이 한꺼번에 정해진다. 되돌리려면 판을 초기화해야 한다.'}
              </p>
              <button
                className="is-primary"
                disabled={busy || assigned || seats.length < TOTAL_SEATS}
                onClick={() =>
                  void run('배정', async () => {
                    const r = (await act.assignAll()) as { assigned?: number; teams?: Record<string, number> }
                    const by = Object.entries(r.teams ?? {})
                      .map(([t, n]) => `${t} ${n}`)
                      .join(' · ')
                    setSaid(`${r.assigned ?? 0}명에게 나눴다. ${by}`)
                  })
                }
              >
                팀 · 개인 미션 배정
              </button>
            </section>
            <section className="sc-ad__sec">
              <h2>시작</h2>
              {!assigned && <p className="sc-ad__hint">배정을 먼저 해야 시작한다.</p>}
              <button
                className="is-primary"
                disabled={busy || !assigned}
                onClick={() => void run('시작', () => act.startGame())}
              >
                닷새 시작
              </button>
              <QaSetUp busy={busy} qaPw={qaPw} setQaPw={setQaPw} onGo={setUpQa} />
              <button disabled={busy || qaPw.length < 8} onClick={() => void run('채우기', () => act.seedPlayers(qaPw, 0))}>
                QA 열넷 채우기 (자리만)
              </button>
            </section>
            <section className="sc-ad__sec">
              <h2>자리</h2>
              <button
                disabled={busy}
                onClick={() =>
                  void run('자리 비우기', async () => {
                    const r = (await act.sweepSeats()) as { freed?: string[]; left?: number; need?: number }
                    const n = r.freed?.length ?? 0
                    setSaid(
                      n === 0 ?
                        `주인 없는 자리는 없다. ${r.left ?? 0} / ${r.need ?? 0} 앉아 있다.`
                      : `${n}자리를 비웠다(${(r.freed ?? []).join(', ')}). 이제 ${r.left ?? 0} / ${r.need ?? 0} 이다.`,
                    )
                    return {}
                  })
                }
              >
                주인 없는 자리 비우기
              </button>
            </section>
            <section className="sc-ad__sec">
              <h2>가입</h2>
              <Signups onSaid={setSaid} />
            </section>
          </>
        : tab === 'go' ?
          /* ── 진행. 판을 돌리는 두 손잡이 ── */
          <>
            <section className="sc-ad__sec">
              <h2>페이즈 {phaseNo}</h2>
              {phaseOpen ?
                <button className="is-primary" disabled={busy} onClick={() => void run('닫기', () => act.closePhase())}>
                  닫고 처리
                  <span>{phaseLeft ?? '진행 중'}</span>
                </button>
              : <button className="is-primary" disabled={busy} onClick={() => void run('열기', () => act.openPhase())}>
                  페이즈 열기
                  <span>한 시간</span>
                </button>
              }
            </section>

            <section className="sc-ad__sec">
              <h2>달력</h2>
              {/*
                **시계가 판을 끝내지 않는다.** 세워 두고 며칠 지나면
                아무도 안 들어온 사이에 닷새가 지나가 버려서, 다음에
                들어온 사람은 엔딩만 봤다. 날이 바뀌는 것도 정산도
                끝나는 것도 여기서 민다.
              */}
              <button
                disabled={busy || nextUp === null}
                onClick={() =>
                  void run(nextUp ? (CALENDAR[nextUp.kind] ?? '넘기기') : '넘기기', async () => {
                    const r = (await act.pushDay()) as { next?: { kind: string; day: number } | null }
                    setNextUp(r.next ?? null)
                    return r
                  })
                }
              >
                {nextUp ? `다음 — DAY ${nextUp.day} · ${CALENDAR[nextUp.kind] ?? nextUp.kind}` : '더 넘길 것이 없다'}
              </button>
            </section>

            <section className="sc-ad__sec">
              <h2>시계</h2>
              <button disabled={busy} onClick={() => void run('따라잡기', () => act.tick())}>
                따라잡기
              </button>
            </section>
          </>
        : tab === 'put' ?
          /* ── 놓기. 판 위에 무엇을 둔다 ── */
          <>
            <section className="sc-ad__sec">
              <h2>심부름</h2>
              <ErrandDesk act={act} onSaid={setSaid} />
            </section>
            <section className="sc-ad__sec">
              <h2>화분</h2>
              <GardenDesk act={act} onSaid={setSaid} />
            </section>
            <section className="sc-ad__sec">
              <h2>떨어뜨리기</h2>
              <DropHost act={act} onSaid={setSaid} />
            </section>
          </>
        : /* ── 관리. 가끔 손보는 것 ── */
          <>
            <section className="sc-ad__sec">
              <h2>판</h2>
              {/*
                **얼굴이 비어 있으면 그 사람은 점으로 뜬다.** 명단의
                얼굴은 자리에 앉는 순간 한 번 찍힌다. 얼굴을 만들기
                전에 앉았으면 비어 있는 채로 남는다 — 판을 되돌리지
                않고 여기서 고친다.
              */}
              <div className="sc-ad__row">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run('얼굴 다시 읽기', async () => {
                      const r = (await act.refreshFaces()) as { seats?: number; faces?: number }
                      setSaid(`${r.seats ?? 0}자리 중 ${r.faces ?? 0}명의 얼굴을 읽었다.`)
                      return {}
                    })
                  }
                >
                  얼굴 다시 읽기
                </button>
              </div>
              <ResetGame busy={busy} act={act} onSaid={setSaid} />
            </section>
            <section className="sc-ad__sec">
              <h2>엔딩</h2>
              <EndingDesk act={act} seats={seats} onSaid={setSaid} />
            </section>
            <section className="sc-ad__sec">
              <h2>문제 은행</h2>
              <QuizHost act={act} onSaid={setSaid} />
            </section>
            <section className="sc-ad__sec">
              <h2>가입</h2>
              <Signups onSaid={setSaid} />
            </section>
          </>
        }
      </div>

      {said && (
        <p className="sc-ad__said" onClick={() => setSaid('')}>
          {said}
        </p>
      )}
    </div>
  )
}

/**
 * 가입 데이터.
 *
 * **판과 따로다.** 계정을 지워도 명단은 안 건드린다 — 이름·팀·얼굴은
 * 판이 제 안에 베껴 들고 있어서 지난 판의 기록은 그대로 남는다.
 * 지워지는 것은 그 아이디로 다시 들어오는 길뿐이다.
 *
 * 아이디를 해시해 uid 를 만들므로, **같은 아이디로 다시 가입하면 같은
 * uid** 다. 잘못 지웠으면 그 아이디로 다시 가입하면 앉아 있던 자리로
 * 돌아간다 — 비밀번호만 새로 정한 것이 된다.
 */
function Signups({ onSaid }: { onSaid: (t: string) => void }) {
  const [rows, setRows] = useState<AccountSummary[] | null>(null)
  /** 지금 들어와 있는 운영자. 제 계정은 못 지운다 — 미리 잠근다 */
  const [me, setMe] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    void listAccounts()
      .then((r) => {
        setRows(r.rows)
        setMe(r.me)
        setPicked(new Set())
      })
      .catch((e) => onSaid((e as Error).message))
      .finally(() => setBusy(false))
  }, [onSaid])
  useEffect(load, [load])

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
    setAsked(false)
  }

  if (rows === null) return <p className="sc-ad__hint">불러오는 중</p>

  const chosen = [...picked]
  const risky = rows.filter((r) => picked.has(r.id) && r.playing).length

  return (
    <>
      <p className="sc-ad__hint">{rows.length}명이 가입했다.</p>
      <ul className="sc-ad__accounts">
        {rows.map((r) => (
          <li key={r.id}>
            <label>
              {/* 제 계정은 못 고른다. 골라 봐야 서버가 거절한다 */}
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                disabled={r.id === me}
                onChange={() => toggle(r.id)}
              />
              <b>{r.id}</b>
              <span>{r.nickname || '이름 없음'}</span>
            </label>
            {r.id === me && <em className="sc-ad__tagMe">나</em>}
            {/* 얼굴을 안 만든 사람은 지도에 점으로 뜬다. 여기서 보인다 */}
            {!r.face && <em className="sc-ad__tagDot">얼굴 없음</em>}
            {r.playing && <em className="sc-ad__tagPlay">판에 있음</em>}
          </li>
        ))}
      </ul>

      {!asked ? (
        <button
          className="sc-ad__danger"
          disabled={busy || chosen.length === 0}
          onClick={() => setAsked(true)}
        >
          고른 {chosen.length}개 지우기
        </button>
      ) : (
        <div className="sc-ad__ask">
          <p>
            {chosen.join(', ')} — {chosen.length}개를 지운다. 되돌릴 수 없다.
            {risky > 0 && ` 이 중 ${risky}명은 지금 판에 앉아 있다 — 그 사람은 다시 못 들어온다.`}
          </p>
          <div className="sc-ad__askRow">
            <button onClick={() => setAsked(false)}>그만두기</button>
            <button
              className="sc-ad__danger"
              disabled={busy}
              onClick={() => {
                setAsked(false)
                setBusy(true)
                void deleteAccounts(chosen)
                  .then((r) => {
                    const no = (r.kept ?? []).map((k) => `${k.id}(${k.why})`).join(', ')
                    const free = (r.freed ?? []).length
                    onSaid(
                      `${(r.gone ?? []).length}개를 지웠다.` +
                        (free > 0 ? ` 시작 안 한 판의 ${free}자리를 같이 비웠다.` : '') +
                        (no ? ` 못 지운 것 — ${no}` : ''),
                    )
                    load()
                  })
                  .catch((e) => onSaid((e as Error).message))
                  .finally(() => setBusy(false))
              }}
            >
              지운다
            </button>
          </div>
        </div>
      )}
      <button disabled={busy} onClick={load}>
        다시 불러오기
      </button>
    </>
  )
}

/**
 * 판을 첫날로 되돌린다.
 *
 * **한 번에 지우지 않는다.** 닷새치 기록이 통째로 날아가는 일이라,
 * 잘못 눌러서 되는 일이 아니다 — 한 번 누르면 묻고, 거기서 다시
 * 눌러야 지운다. 되돌린 뒤에는 로비다. 「닷새 시작」을 눌러야 돈다.
 *
 * 앉은 자리는 남는다. 같은 사람들이 같은 이름으로 다시 앉는 일에는
 * 아무 뜻이 없다.
 */
function ResetGame({
  busy,
  act,
  onSaid,
}: {
  busy: boolean
  act: ReturnType<typeof gameActions>
  onSaid: (t: string) => void
}) {
  const [asked, setAsked] = useState(false)
  if (!asked) {
    return (
      <button className="sc-ad__danger" disabled={busy} onClick={() => setAsked(true)}>
        판을 첫날로 되돌리기
      </button>
    )
  }
  return (
    <div className="sc-ad__ask">
      <p>닷새치 기록이 다 지워진다. 앉은 자리만 남는다.</p>
      <div className="sc-ad__askRow">
        <button onClick={() => setAsked(false)}>그만두기</button>
        <button
          className="sc-ad__danger"
          disabled={busy}
          onClick={() => {
            setAsked(false)
            void act
              .resetGame()
              .then((r) => {
                const n = (r as { seats?: number }).seats ?? 0
                onSaid(`되돌렸다. ${n}명이 그대로 앉아 있다.`)
              })
              .catch((e) => onSaid((e as Error).message))
          }}
        >
          지우고 되돌린다
        </button>
      </div>
    </div>
  )
}

/**
 * QA 비밀번호 한 칸과 한 번에 차리는 단추.
 *
 * 비밀번호를 여기서 정하게 둔다 — 뻔한 값을 박아 두면 qa01 이 그대로
 * 뒷문이 된다. **자리는 열넷을 다 채운다.** 운영자는 관리자 화면에
 * 있지 판 안에 있지 않아서, 한 자리를 비워 두면 시작을 못 한다.
 */
/**
 * 열넷을 채워 놓는 비밀번호는 **부르는 쪽이 정한다.**
 *
 * 뻔한 값을 박아 두면 qa01 이 그대로 뒷문이 된다. 그렇다고 운영자가
 * 매번 지어내게 두면, 결국 늘 쓰던 것을 쓴다 — 그것도 뒷문이다.
 * 여기서 만들어 주고 **눈에 보이게 둔다**. 친구 폰에 qa02 로 들어가
 * 볼 때 그대로 읽어서 치면 된다.
 */
function madePassword(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
  const n = new Uint32Array(12)
  crypto.getRandomValues(n)
  return [...n].map((x) => abc[x % abc.length]).join('')
}

function QaSetUp({
  busy,
  qaPw,
  setQaPw,
  onGo,
}: {
  busy: boolean
  qaPw: string
  setQaPw: (v: string) => void
  onGo: () => Promise<void>
}) {
  // 빈 칸으로 두면 무엇을 적어야 하는지부터 막힌다. 하나 만들어 둔다
  useEffect(() => {
    if (qaPw.length === 0) setQaPw(madePassword())
  }, [qaPw, setQaPw])

  return (
    <>
      <p className="sc-ad__hint">
        {/*
          **열넷이 안 차면 시작할 수가 없다.** 역할과 인연 고리가 열넷을
          전제로 짜여 있어서, 둘이서는 판이 서지 않는다. 그래서 둘이
          확인하고 싶을 때는 나머지를 QA 로 채워 넣는다 — 앉은 사람은
          그대로 두고 빈 자리만 메운다. 채팅도 거래도 그때부터 된다.
        */}
        빈 자리만 QA 로 채운다.
      </p>
      {/* 비밀번호를 가리지 않는다 — 읽어서 다른 기기에 쳐야 하는 값이다 */}
      <input
        type="text"
        placeholder="QA 비밀번호 (8자 이상)"
        value={qaPw}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => setQaPw(e.target.value)}
      />
      <button className="is-lead" disabled={busy || qaPw.length < 8} onClick={() => void onGo()}>
        빈 자리를 QA로 채우고 시작
        <span>qa01 … qa14</span>
      </button>
    </>
  )
}

/**
 * 엔딩 책상.
 *
 * **열 장면을 없앤 자리다.** 전에는 전말·거울 규칙·A가 남긴 말·찢긴
 * 한 장·공동 엔딩을 화면이 차례로 틀어 줬다. 무엇을 깨달을지를 화면이
 * 정해 주는 대신, 닷새를 지켜본 사람이 여기서 한 편씩 적는다.
 *
 * **저장은 사람 단위다.** 「모두에게」를 고르면 열넷 화면 맨 위에 같이
 * 붙고, 이름을 고르면 그 사람 화면에만 그 아래로 붙는다. 남의 몫은
 * 서버가 문서 두 개만 읽어서 보내므로 어떤 경로로도 안 섞인다.
 *
 * 글은 닷새가 끝나야 나간다. 그 전에 적어 둬도 화면에는 안 뜬다.
 */
function EndingDesk({
  act,
  seats,
  onSaid,
}: {
  act: ReturnType<typeof gameActions>
  seats: { playerId: string; name: string; team: string | null }[]
  onSaid: (t: string) => void
}) {
  const [rows, setRows] = useState<Record<string, string>>({})
  const [who, setWho] = useState(ALL_KEY)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = (await act.hostEndings()) as { rows?: { to: string; text: string }[] }
    setRows(Object.fromEntries((r.rows ?? []).map((x) => [x.to, x.text])))
  }, [act])
  useEffect(() => {
    void load()
  }, [load])

  /** 고른 사람이 바뀌면 적어 둔 것을 꺼내 온다 */
  useEffect(() => {
    setText(rows[who] ?? '')
  }, [who, rows])

  const nameOf = (id: string) => (id === ALL_KEY ? '모두에게' : (seats.find((s) => s.playerId === id)?.name ?? id))
  const written = Object.entries(rows).filter(([, t]) => t.trim() !== '')

  async function save() {
    setBusy(true)
    try {
      await act.hostSetEnding(who, text)
      await load()
      onSaid(text.trim() === '' ? `${nameOf(who)} 몫을 지웠다.` : `${nameOf(who)} 몫을 저장했다.`)
    } catch (e) {
      onSaid(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sc-ad__end">
      <div className="sc-ad__row">
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="받는 사람">
          <option value={ALL_KEY}>모두에게{rows[ALL_KEY] ? ' ✓' : ''}</option>
          {seats.map((s) => (
            <option key={s.playerId} value={s.playerId}>
              {s.team} · {s.name}
              {rows[s.playerId] ? ' ✓' : ''}
            </option>
          ))}
        </select>
        <span className="sc-ad__pill">
          {written.length}/{seats.length + 1}
        </span>
      </div>
      <textarea
        className="sc-ad__endbox"
        value={text}
        maxLength={ENDING_MAX}
        rows={8}
        onChange={(e) => setText(e.target.value)}
        aria-label={`${nameOf(who)} 엔딩`}
      />
      <div className="sc-ad__row">
        <button className="is-primary" disabled={busy} onClick={() => void save()}>
          저장
        </button>
        <span className="sc-ad__pill">
          {text.length}/{ENDING_MAX}
        </span>
      </div>
      {written.length > 0 && (
        <ul className="sc-ad__endlist">
          {written.map(([to, t]) => (
            <li key={to}>
              <button className={to === who ? 'is-on' : ''} onClick={() => setWho(to)}>
                {nameOf(to)}
              </button>
              <span>{t.slice(0, 40)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
