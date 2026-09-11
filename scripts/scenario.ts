// 테스트 게임 한 판. 개발용 시계로 DAY 1 08:00 → DAY 5 21:00.
//
// 봇 열넷이 닷새를 산다. 사람이 손으로 확인하기 어려운 것 다섯 가지를
// 여기서 기계가 확인한다.
//
//   1. 매일 아침 시퀀스가 그날 조각으로 열리는가
//   2. 이틀 건너뛰고 들어온 계정이 빠진 날을 날짜순으로 이어 보는가
//   3. 1:1 고백이 들은 사람 보관함에만 담기는가
//   4. 도서부가 털어놓았는지에 따라 찢긴 한 장 소개가 갈리는가
//   5. 투명인간이 한 번도 없던 판에서 6번 장면을 건너뛰는가
//
// 시각 계산은 전부 gameNow()를 거친다. 여기서 Date.now()를 직접 쓰면
// 배속이 걸린 시계와 어긋나므로, 실제 시각은 anchor 하나뿐이다.
//
// 서버 전용 문장을 읽지만 이 파일은 번들에 실리지 않는다(scripts/).
import { gameNow, dayNumber, type DevClock } from '../shared/rules/clock'
import { DAY_START_HOUR, TOTAL_DAYS, type TeamId } from '../shared/rules/v2'
import { releasedDays } from '../shared/reveal/release'
import {
  advance,
  done,
  handledDays,
  pendingDays,
  readDays,
  skipDay,
  startMorning,
  type DayScript,
  type MorningState,
} from '../shared/reveal/morning'
import { buildArchive, itemsOf, type ConfessionSource } from '../shared/reveal/archive'
import { playedScenes, skippedScenes } from '../shared/reveal/ending'
import { dateCardLine, todayItems } from '../shared/reveal/days'
import { TILE_BY_ID, type TileId } from '../shared/rules/board'
import { ROLE_IDS, ROLE_NAMES, type RoleId } from '../shared/missions/roleNames'
import { FRAGMENTS } from '../functions/src/story/fragments'
import { tornIntro } from '../functions/src/story/torn'

// ── 시계 ────────────────────────────────────────────────────────

/** 판이 시작한 실제 시각. 배속의 기준점이다. */
const ANCHOR_REAL = Date.UTC(2026, 2, 2, 0, 0, 0)

/** DAY 1 08:00 한국 시간. 서울은 UTC+9라 08:00 KST = 전날 23:00 UTC. */
const DAY1_0800 = Date.UTC(2026, 2, 1, 23, 0, 0)

const SPEED = 120
const clock: DevClock = { anchorRealMs: ANCHOR_REAL, anchorGameMs: DAY1_0800, speed: SPEED }

/** 게임 속 시각 하나를 정해 그 순간의 실제 시각을 돌려준다. */
function realAt(gameMs: number): number {
  return ANCHOR_REAL + (gameMs - DAY1_0800) / SPEED
}

const HOUR = 3_600_000
/** DAY n의 h시. 소등이 없는 계산이라 그냥 24시간 간격이다. */
function at(day: number, hour: number): number {
  return DAY1_0800 + (day - 1) * 24 * HOUR + (hour - DAY_START_HOUR) * HOUR
}

/** 그 순간의 게임 시각. 반드시 이 함수를 거친다. */
function now(gameMs: number): number {
  return gameNow(clock, realAt(gameMs))
}

// ── 봇 열넷 ─────────────────────────────────────────────────────

interface Bot {
  id: string
  name: string
  role: RoleId
  team: TeamId
  /** 아침에 안 들어오는 날. */
  absentDays: number[]
  /** 건너뛰기를 누르는 날. */
  skipDays: number[]
  /** 끝까지 본 날. 보관함이 「읽지 않음」을 가리는 데 쓴다. */
  seen: number[]
  skipped: number[]
  /** 본 날 + 건너뛴 날. 다음 재생을 정하는 목록이다. */
  handled: number[]
}

const TEAMS: TeamId[] = ['A', 'B', 'C', 'D']

function makeBots(): Bot[] {
  return ROLE_IDS.map((role, i) => ({
    id: `b${String(i + 1).padStart(2, '0')}`,
    name: `봇${i + 1}`,
    role,
    team: TEAMS[i % 4],
    absentDays: [],
    skipDays: [],
    seen: [],
    skipped: [],
    handled: [],
  }))
}

const byRole = (bots: Bot[], role: RoleId): Bot => bots.find((b) => b.role === role)!

// ── 그날 재생에 필요한 모양 ─────────────────────────────────────

/** 본문은 빼고 장수와 「맨 위」 유무만. 서버가 이만큼만 내려보낸다. */
const SCRIPTS: Record<number, DayScript> = Object.fromEntries(
  FRAGMENTS.map((f) => [f.day, { day: f.day, papers: f.papers.map((p) => ({ hasTop: !!p.topLines })) }]),
)

/** 아침 시퀀스를 끝까지 본다. 탭 횟수를 센다. */
function watchMorning(state: MorningState, skipThese: readonly number[]): { state: MorningState; taps: number } {
  let s = state
  let taps = 0
  let guard = 0
  while (!done(s) && guard++ < 200) {
    const day = s.queue[0]
    if (skipThese.includes(day)) {
      s = skipDay(s)
      continue
    }
    s = advance(s, SCRIPTS[day] ?? null)
    taps += 1
  }
  return { state: s, taps }
}

// ── 확인 ────────────────────────────────────────────────────────

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const tileName = (id: TileId) => TILE_BY_ID[id]?.name ?? id

// ── 한 판 ───────────────────────────────────────────────────────

interface RunOptions {
  label: string
  /** 매일 저녁 투명인간을 뽑는가. */
  withInvisible: boolean
  /** 도서부가 기록 한 장을 털어놓는가. */
  librarianReveals: boolean
}

function run(opts: RunOptions): void {
  console.log(`\n── ${opts.label} ──`)
  const bots = makeBots()

  // 7번은 DAY 2·3에 안 들어온다. 9번은 DAY 3에 건너뛰기를 누른다
  const away = bots[6]
  away.absentDays = [2, 3]
  const skipper = bots[8]
  skipper.skipDays = [3]

  const librarian = byRole(bots, 'librarian')
  const accuser = byRole(bots, 'accuser')
  const confessions: ConfessionSource[] = []
  const invisibleByDay: Record<number, string | null> = {}

  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const morning = now(at(day, DAY_START_HOUR))
    check(
      dayNumber(DAY1_0800, morning) === day,
      `DAY ${day} 08:00 게임 시계가 ${day}일차`,
      `= ${dayNumber(DAY1_0800, morning)}`,
    )

    const released = releasedDays(DAY1_0800, morning)
    check(
      released.length === day && released[released.length - 1] === day,
      `DAY ${day} 열린 조각 ${day}장`,
      `[${released.join(',')}]`,
    )

    // 날짜를 건너뛴 요청은 막힌다
    if (day < TOTAL_DAYS) {
      check(!releasedDays(DAY1_0800, morning).includes(day + 1), `DAY ${day}에 DAY ${day + 1} 잠김`)
      check(!releasedDays(DAY1_0800, morning).includes(TOTAL_DAYS), `DAY ${day}에 DAY ${TOTAL_DAYS} 잠김`)
    }

    for (const bot of bots) {
      if (bot.absentDays.includes(day)) continue
      const pending = pendingDays(released, bot.handled)
      if (pending.length === 0) continue

      // 돌아온 계정은 빠진 날을 날짜순으로 이어 본다
      if (bot === away && day === 4) {
        check(
          pending.join(',') === '2,3,4',
          '이틀 건너뛰고 들어온 계정이 2·3·4를 이어서 본다',
          `[${pending.join(',')}]`,
        )
      }

      const before = [...pending]
      const { state } = watchMorning(startMorning(pending), bot.skipDays)
      // 다음 재생을 정하는 건 handled — 건너뛴 날도 여기 들어간다
      bot.handled = [...bot.handled, ...handledDays(before, state)]
      bot.seen = [...bot.seen, ...readDays(before, state)]
      bot.skipped = [...bot.skipped, ...state.skipped]
    }

    // 저녁 21:00 — 투명인간을 뽑는다
    const evening = now(at(day, 21))
    check(dayNumber(DAY1_0800, evening) === day, `DAY ${day} 21:00도 같은 날`)
    invisibleByDay[day] = opts.withInvisible && day >= 2 ? bots[(day * 3) % 14].name : null

    // DAY 3 저녁에 도서부가 1:1로 털어놓는다. 들은 사람은 둘
    if (day === 3 && opts.librarianReveals) {
      confessions.push({
        id: 'c1',
        speakerId: librarian.id,
        scope: 'private',
        listenerIds: [bots[4].id, bots[5].id],
        text: '(숨긴 사실 원문)',
        atMs: now(at(3, 20)),
      })
    }
    // DAY 4에 고발자가 전체에 털어놓는다
    if (day === 4) {
      confessions.push({
        id: 'c2',
        speakerId: accuser.id,
        scope: 'class',
        listenerIds: bots.filter((b) => b.id !== accuser.id).map((b) => b.id),
        text: '(숨긴 사실 원문)',
        atMs: now(at(4, 19)),
      })
    }
  }

  // ── 아침 시퀀스가 제대로 돌았는가 ─────────────────────────────
  const normal = bots[0]
  check(normal.seen.sort((a, b) => a - b).join(',') === '1,2,3,4,5', '매일 들어온 계정은 닷새를 다 봤다')
  check(away.seen.sort((a, b) => a - b).join(',') === '1,2,3,4,5', '돌아온 계정도 결국 닷새를 다 봤다')
  check(
    skipper.skipped.join(',') === '3' && !skipper.seen.includes(3),
    '건너뛴 날은 「봤다」에 들어가지 않는다',
    `건너뜀=[${skipper.skipped.join(',')}]`,
  )
  check(
    !pendingDays(releasedDays(DAY1_0800, now(at(5, 21))), skipper.handled).includes(3),
    '건너뛴 날을 다음 접속 때 다시 들이밀지 않는다',
  )

  // 탭 횟수: DAY 2는 종이 두 장, DAY 5는 맨 위 한 번 더
  const taps = (day: number) => watchMorning(startMorning([day]), []).taps
  check(taps(1) === 4, 'DAY 1은 탭 네 번', `${taps(1)}`)
  check(taps(2) === 5, 'DAY 2는 종이 두 장이라 탭 다섯 번', `${taps(2)}`)
  check(taps(5) === 5, 'DAY 5는 맨 위가 있어 탭 다섯 번', `${taps(5)}`)

  // ── 1:1 고백이 들은 사람에게만 ────────────────────────────────
  const archiveOf = (bot: Bot) =>
    buildArchive({
      viewerId: bot.id,
      viewerTeam: bot.team,
      records: releasedDays(DAY1_0800, now(at(5, 21))).map((d) => ({ day: d, atMs: now(at(d, 8)) })),
      unreadDays: bot.skipped,
      confessions,
      memories: [],
      sights: [{ ownerId: bot.id, atMs: now(at(5, 20)) }],
      over: false,
      tileName,
      nameOf: (id) => bots.find((b) => b.id === id)?.name ?? id,
    })

  if (opts.librarianReveals) {
    const heard = [librarian, bots[4], bots[5]]
    const notHeard = bots.filter((b) => !heard.includes(b))
    const has = (bot: Bot) => itemsOf(archiveOf(bot), 'confession').some((i) => i.id === 'confession:c1')
    check(heard.every(has), '1:1 고백은 말한 사람과 들은 둘의 보관함에 있다')
    check(!notHeard.some(has), '1:1 고백은 나머지 열하나의 보관함에 없다', `샌 계정 ${notHeard.filter(has).length}개`)
    check(
      itemsOf(archiveOf(notHeard[0]), 'confession').length === 1,
      '못 들은 사람에게는 전체 고백 한 줄만 남는다',
    )
  }
  check(
    bots.every((b) => itemsOf(archiveOf(b), 'confession').some((i) => i.id === 'confession:c2')),
    '전체 고백은 열넷 모두의 보관함에 있다',
  )
  check(
    archiveOf(bots[1]).filter((i) => i.title === 'A의 시선').length === 1,
    'A의 시선은 본인 것 한 줄뿐이다',
  )
  check(
    itemsOf(archiveOf(skipper), 'record').filter((i) => i.unread).length === 1,
    '건너뛴 날이 보관함에 「읽지 않음」으로 남는다',
  )

  // ── 찢긴 한 장 분기 ───────────────────────────────────────────
  const intro = tornIntro(opts.librarianReveals)
  check(
    opts.librarianReveals ? intro.includes('내놓은') : intro.includes('사물함'),
    `찢긴 한 장 소개가 도서부 ${opts.librarianReveals ? '고백' : '침묵'} 쪽으로 갈렸다`,
    intro,
  )

  // ── 엔딩 장면 수 ──────────────────────────────────────────────
  const hadInvisible = Object.values(invisibleByDay).some((v) => v !== null)
  check(hadInvisible === opts.withInvisible, `투명인간 ${opts.withInvisible ? '있던' : '없던'} 판`)
  const scenes = playedScenes({ hadInvisible })
  const skippedIds = skippedScenes({ hadInvisible })
  if (opts.withInvisible) {
    check(scenes.length === 10 && skippedIds.length === 0, '투명인간이 있었으면 열 장면 전부')
  } else {
    check(
      scenes.length === 9 && skippedIds.join(',') === 'unheard',
      '투명인간이 없었으면 6번 「들리지 않았던 말」을 건너뛴다',
      `${scenes.length}장면`,
    )
    check(!scenes.map((s) => s.id).includes('unheard'), '건너뛴 장면이 목록에 없다')
  }

  // ── 아침 카드가 그날 것을 말하는가 ────────────────────────────
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const items = todayItems({ day, invisibleName: invisibleByDay[day] })
    const line = dateCardLine(day)
    check(line.startsWith(`DAY ${day} · `) && line.length > 8, `DAY ${day} 날짜 카드`, line)
    check(
      !items.some((i) => i.text.includes('창고')),
      `DAY ${day} 「오늘 일어나는 일」에 다섯 시의 창고가 없다`,
    )
    if (invisibleByDay[day]) {
      check(
        items.some((i) => i.kind === 'invisible' && i.text.includes(invisibleByDay[day]!)),
        `DAY ${day} 투명인간 이름이 아침에 뜬다`,
      )
    }
  }
}

// ── 주행 ────────────────────────────────────────────────────────

console.log('테스트 게임 · 개발용 시계 배속 ×' + SPEED)
console.log(`DAY 1 ${DAY_START_HOUR}:00 → DAY ${TOTAL_DAYS} 21:00`)
console.log(`봇 ${ROLE_IDS.length}명 · ${ROLE_IDS.map((r) => ROLE_NAMES[r]).join(' ')}`)

run({ label: '판 1 · 투명인간 있음 · 도서부 털어놓음', withInvisible: true, librarianReveals: true })
run({ label: '판 2 · 투명인간 없음 · 도서부 침묵', withInvisible: false, librarianReveals: false })

console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
process.exit(failures === 0 ? 0 : 1)
