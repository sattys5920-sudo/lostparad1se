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
import { useCallback, useEffect, useMemo, useState } from 'react'

import { deleteAccounts, listAccounts, logOut, type AccountSummary } from '../accounts'
import { gameActions, useGame } from '../game/useGame'
import { PhaseHost } from '../game/Phase'
import { QuizHost } from '../game/Quiz'
import { DropHost } from './Drop'
import { ErrandDesk } from './Errands'
import { GardenDesk } from './Garden'
import { useGameNow } from '../game/Shell'
import { TOTAL_SEATS } from '../../../shared/rules/lobby'
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

function Desk() {
  const state = useGame(GAME_ID)
  const act = useMemo(() => gameActions(GAME_ID), [])
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [qaPw, setQaPw] = useState('')
  /** 다음에 넘길 달력 한 칸. 서버가 알려 준다 — 화면이 세지 않는다 */
  const [nextUp, setNextUp] = useState<{ kind: string; day: number } | null>(null)
  const nowMs = useGameNow(state.game?.clock)

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
  const phaseNo = game?.phaseNow?.no ?? 0
  const phaseOpen = game?.phaseNow?.open === true
  const phaseEndsAtMs = game?.phaseNow?.endsAtMs ?? null

  return (
    <div className="sc-ad">
      <header className="sc-ad__top">
        <h1>관리자</h1>
        <span className="sc-ad__game">{GAME_ID}</span>
        {/* 나가면 로그인 화면으로 돌아간다. 운영자는 계정이 없으므로
            증표를 버리는 것이 곧 나가는 것이다 */}
        <button className="sc-ad__out" onClick={() => void logOut()}>
          나가기
        </button>
      </header>

      <section className="sc-ad__card">
        <h2>판</h2>
        {state.loading ? (
          <p className="sc-ad__hint">불러오는 중</p>
        ) : !game ? (
          <>
            <p className="sc-ad__hint">아직 판이 없다.</p>
            <button disabled={busy} onClick={() => void run('판 만들기', () => act.createGame())}>
              판 만들기
            </button>
            <QaSetUp busy={busy} qaPw={qaPw} setQaPw={setQaPw} onGo={setUpQa} />
          </>
        ) : (
          <>
            <dl className="sc-ad__facts">
              <div><dt>상태</dt><dd>{game.phase}</dd></div>
              <div><dt>사람</dt><dd>{seats.length} / {TOTAL_SEATS}</dd></div>
              {/* 게임 시계다. 개발용 배속을 걸어 두면 실제 시각과 다르다 */}
              <div><dt>지금</dt><dd>{clockText(nowMs)}</dd></div>
            </dl>
            {game.phase === 'lobby' && (
              <>
                <button disabled={busy} onClick={() => void run('시작', () => act.startGame())}>
                  닷새 시작
                </button>
                {/*
                  QA용. 비밀번호를 여기서 정하게 둔다 — 뻔한 값을 박아
                  두면 qa01 이 그대로 뒷문이 된다.
                  **자리를 다 채운다.** 운영자는 관리자 화면에 있지
                  판 안에 있지 않아서, 한 자리를 비워 두면 열넷이
                  안 차 시작을 못 한다
                */}
                <QaSetUp busy={busy} qaPw={qaPw} setQaPw={setQaPw} onGo={setUpQa} />
                <button
                  disabled={busy || qaPw.length < 8}
                  onClick={() => void run('채우기', () => act.seedPlayers(qaPw, 0))}
                >
                  QA 열넷 채우기 (자리만)
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => void run('따라잡기', () => act.tick())}>
              따라잡기
            </button>
            {/*
              **얼굴이 비어 있으면 그 사람은 점으로 뜬다.**
              명단의 얼굴은 자리에 앉는 순간 한 번 찍힌다. 얼굴을
              만들기 전에 앉았거나, 얼굴이 명단에 적히기 전의 옛 자리면
              비어 있는 채로 남는다 — 판을 되돌리지 않고 여기서 고친다.
            */}
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
            {/*
              **계정을 지우면 자리가 남는다.**
              지운 사람은 안 돌아오는데 자리는 차 있어서, 새로 가입한
              사람이 「자리가 없다」를 듣는다. 지울 때 저절로 비우지만,
              이미 그렇게 막힌 판은 여기서 푼다.
            */}
            {game.phase === 'lobby' && (
              <button
                disabled={busy}
                onClick={() =>
                  void run('자리 비우기', async () => {
                    const r = (await act.sweepSeats()) as { freed?: string[]; left?: number; need?: number }
                    const n = r.freed?.length ?? 0
                    setSaid(
                      n === 0
                        ? `주인 없는 자리는 없다. ${r.left ?? 0} / ${r.need ?? 0} 앉아 있다.`
                        : `${n}자리를 비웠다(${(r.freed ?? []).join(', ')}). 이제 ${r.left ?? 0} / ${r.need ?? 0} 이다.`,
                    )
                    return {}
                  })
                }
              >
                주인 없는 자리 비우기
              </button>
            )}
            {game.phase !== 'lobby' && <ResetGame busy={busy} act={act} onSaid={setSaid} />}
          </>
        )}
      </section>

      {game && game.phase !== 'lobby' && (
        <>
          <section className="sc-ad__card">
            <h2>달력</h2>
            {/*
              **시계가 판을 끝내지 않는다.**
              세워 두고 며칠 지나면 아무도 안 들어온 사이에 닷새가
              지나가 버려서, 다음에 들어온 사람은 엔딩만 봤다. 날이
              바뀌는 것도 정산도 끝나는 것도 이제 여기서 민다.
            */}
            <p className="sc-ad__hint">
              날은 저절로 바뀌지 않는다. 한 번 누르면 한 칸이다.
            </p>
            <dl className="sc-ad__facts">
              <div>
                <dt>지금</dt>
                <dd>DAY {game.day}</dd>
              </div>
              <div>
                <dt>다음</dt>
                <dd>{nextUp ? `DAY ${nextUp.day} · ${CALENDAR[nextUp.kind] ?? nextUp.kind}` : '더 넘길 것이 없다'}</dd>
              </div>
            </dl>
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
              다음으로 넘기기
            </button>
          </section>

          <section className="sc-ad__card">
            <h2>페이즈</h2>
            <p className="sc-ad__hint">
              페이즈는 저절로 열리지 않는다. 여는 것도 닫는 것도 여기서 한다.
            </p>
            <PhaseHost open={phaseOpen} no={phaseNo} endsAtMs={phaseEndsAtMs} act={act} onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>방</h2>
            {/* 시험용. 본래는 A의 기록이 날마다 두 칸씩 연다 */}
            <button disabled={busy} onClick={() => void run('방 다 열기', () => act.openAllTiles())}>
              핵심 방 다 열기
            </button>
          </section>

          <section className="sc-ad__card">
            <h2>가입</h2>
            <Signups onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>떨어뜨리기</h2>
            <p className="sc-ad__hint">
              페이즈가 닫힐 때 서버가 알아서 뿌리는 것과 별개다. 지금 이 방 바닥에
              한 장 놓는다.
            </p>
            <DropHost act={act} onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>심부름</h2>
            <p className="sc-ad__hint">
              <b>자동 배치는 없다.</b> 판에 붙는 심부름이 전부 이 칸을 거친다 — 안 붙이면
              게시판이 종일 비어 있다.
            </p>
            <ErrandDesk act={act} onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>화분</h2>
            <p className="sc-ad__hint">
              <b>저절로 자라는 화분은 없다.</b> 정원의 여덟 자리가 전부 이 칸을 거친다 — 안 심으면
              종일 빈 화분이다. 딴 것은 심은 사람이 아니라 <b>먼저 온 사람</b>이 가진다.
            </p>
            <GardenDesk act={act} onSaid={setSaid} />
          </section>

          <section className="sc-ad__card">
            <h2>문제</h2>
            <QuizHost act={act} onSaid={setSaid} />
          </section>
        </>
      )}

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
      <p className="sc-ad__hint">
        {rows.length}명이 가입했다. 지워도 판의 명단은 그대로다 — 같은 아이디로 다시 가입하면 자리로 돌아온다.
      </p>
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
                onSaid(`되돌렸다. ${n}명이 그대로 앉아 있다 — 「닷새 시작」을 누르면 DAY 1 부터다.`)
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
        지금 앉은 사람은 그대로 두고 빈 자리만 QA 로 채운다. 둘이서 확인할 때 쓴다.
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
        <span>qa01 … qa14 · 역할 나누고 · 닷새 시작까지</span>
      </button>
    </>
  )
}
