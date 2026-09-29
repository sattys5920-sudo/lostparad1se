// QA 기록 — 모든 상태 변화를 시각과 함께 한 줄로 본다. **운영자만.**
//
// 판은 이미 여러 곳에 흔적을 남긴다. events(공개 기록) · secret/records
// (다섯 기록) · schedule(달력) · phaseLog(페이즈 결과) · secret/ballotDays
// (투표 결과) · notices(공지) · secret/missionLog · secret/missionDays ·
// secret/notifyLog(알림). 여기서는 그것들을 **한 줄 모양으로 깎아 시각순으로
// 합친다.** 새로 쌓는 것은 아직 어디에도 안 적히던 것만이다(logEvent).
//
// **여기서 나가지 않는 것.** 채팅 문장, 역할(roleId), 미션 판정의 내용,
// 투표에서 누가 누구를 적었는지, 쪽지의 주인·문안, 추리 노트. 운영자
// 화면이라도 QA 로그가 그것을 실어 나르면 로그 한 장이 뒷문이 된다.
//
// 시각은 전부 **게임 시계**다. 알림 기록만 실제 시각으로 적혀 있어서
// 지금 시계로 되짚는다.
import { FieldValue, type Transaction, type WriteBatch } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { TILE_BY_ID, type TileId } from '../../shared/rules/board'
import { dayNumber, gameNow, realTimeOf, type DevClock } from '../../shared/rules/clock'
import type { GameRecord } from '../../shared/rules/records'
import type { EventDoc, GameDoc, NoticeDoc, ScheduleDoc } from '../../shared/model'
import type { BallotDayDoc } from './ballot'
import type { MissionDayDoc, MissionLogDoc } from './missionDays'
import { HOST_UID, requireHost } from './host'
import { gameRef, nowOf } from './index'


/** QA 몫. secret 아래라 참가자는 못 읽는다. */
export const qaDocOf = (gameId: string) => gameRef(gameId).collection('secret').doc('qa')
/** 공개 events 에 못 올릴 상태 변화(이적 · 페이즈 중 행동 · 자리). 운영자 로그만 읽는다. */
export const qaLogOf = (gameId: string) => qaDocOf(gameId).collection('log')

// ── 적기 ────────────────────────────────────────────────────────

interface More {
  day?: number
  tileId?: string | null
  team?: string | null
  targetId?: string | null
}

function rowOf(kind: string, atMs: number, playerId: string | null, detail: Record<string, unknown>, more: More): Record<string, unknown> {
  const row: Record<string, unknown> = { atMs, day: more.day ?? 0, kind, detail }
  if (playerId) row.playerId = playerId
  if (more.tileId) row.tileId = more.tileId
  if (more.team) row.team = more.team
  if (more.targetId) row.targetId = more.targetId
  return row
}

/**
 * 상태 변화 한 줄을 games/{id}/events 에 붙인다.
 *
 * **events 는 참가자가 읽는다**(firestore.rules). 그러니 detail 에 숨길 것을
 * 넣으면 안 된다 — 이적 · 페이즈 중의 행동 · 표의 상대처럼 본인만 알아야
 * 하는 것은 logSecret 으로 간다. 절대 던지지 않는다 — 기록이 실패해서
 * 본 요청이 실패하면 안 된다.
 */
export async function logEvent(
  gameId: string,
  kind: string,
  atMs: number,
  playerId: string | null,
  detail: Record<string, unknown> = {},
  more: More = {},
): Promise<void> {
  try {
    await gameRef(gameId).collection('events').add(rowOf(kind, atMs, playerId, detail, more))
  } catch (e) {
    console.warn('qaLog.logEvent', kind, e)
  }
}

/** 같은 한 줄을 secret/qa/log 에. 운영자 로그(hostEventLog)만 읽는다. */
export async function logSecret(
  gameId: string,
  kind: string,
  atMs: number,
  playerId: string | null,
  detail: Record<string, unknown> = {},
  more: More = {},
): Promise<void> {
  try {
    await qaLogOf(gameId).add(rowOf(kind, atMs, playerId, detail, more))
  } catch (e) {
    console.warn('qaLog.logSecret', kind, e)
  }
}

/**
 * 판에 있어야 할 쪽지 문서 수를 하나 올리거나 내린다(불변식 검사가 본다).
 *
 * 쪽지 문서는 세 곳에서 생기고(배포 · 운영자 메모 · 손글씨) 한 곳에서
 * 지워진다(운영자 회수). 그 넷이 이 한 줄을 부른다. 트랜잭션·배치 안이면
 * 그 안에서 같이 적고, 없으면 바로 적는다.
 */
export function bumpSlips(w: Transaction | WriteBatch | null, gameId: string, delta: number): Promise<void> | void {
  const patch = { expectedSlips: FieldValue.increment(delta) }
  if (w) {
    // 트랜잭션과 배치의 set 은 모양이 같다 — 합집합 타입이 호출을 못 고를 뿐이다
    ;(w as Transaction).set(qaDocOf(gameId), patch, { merge: true })
    return
  }
  return qaDocOf(gameId).set(patch, { merge: true }).then(() => undefined, (e) => console.warn('qaLog.bumpSlips', e))
}

// ── 읽기 ────────────────────────────────────────────────────────

/** 로그 한 줄. 화면에 그대로 간다. */
export interface LogRow {
  /** 어느 문서에서 왔나 — 다시 읽을 때 같은 줄을 두 번 안 넣는 열쇠 */
  id: string
  atMs: number
  day: number
  kind: string
  /** 어느 모음에서 왔나 */
  src: string
  actor?: string
  target?: string
  tileId?: string
  text: string
}

export interface CollectOpts {
  sinceMs?: number
  untilMs?: number
  kinds?: readonly string[]
  limit?: number
}

export interface Collected {
  nowMs: number
  rows: LogRow[]
  /** 시간 창 안의 종류 전부(종류 거르기 전). 화면의 칩이 된다 */
  kinds: string[]
  total: number
  truncated: boolean
}

const roomName = (id: string | null | undefined): string => (id ? (TILE_BY_ID[id as TileId]?.name ?? id) : '')
const short = (s: unknown, n = 80): string => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** 이름 풀이. 운영자 uid 는 「운영자」, 모르는 아이디는 앞 여섯 자만 */
function namer(game: GameDoc): (id: string | null | undefined) => string {
  const by = new Map(game.seats.map((s) => [s.playerId, s.name]))
  return (id) => {
    if (!id) return ''
    if (id === HOST_UID) return '운영자'
    return by.get(id) ?? `${id.slice(0, 6)}…`
  }
}

/** events 한 줄을 우리말로. detail 은 공개 모음의 것이라 숨길 것이 없다 */
function eventText(e: EventDoc & { targetId?: string; byId?: string }, name: (id?: string | null) => string): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const who = name(e.playerId)
  const room = roomName(e.tileId)
  switch (e.kind as string) {
    case 'gameStart': return `판 시작 · ${String(d.seats ?? '')}명`
    case 'dayStart': return `DAY ${e.day} 아침`
    case 'settlement': {
      const ranked = (d.ranked as { team: string; total: number }[] | undefined) ?? []
      const spot = (d.spotlighted as string[] | undefined) ?? []
      const back = (d.comeback as string[] | undefined) ?? []
      return `DAY ${e.day} 정산 · ${ranked.map((r) => `${r.team}${r.total}`).join(' ')}${spot.length ? ` · 주목 ${spot.join('')}` : ''}${back.length ? ` · 만회 ${back.join('')}` : ''}`
    }
    case 'gameEnd': return '판 끝'
    case 'spotlight': return d.lastHours ? '점수판 꺼짐 — 마지막 여섯 시간' : '주목'
    case 'arrive': return `${who} → ${room}${d.done === false ? ' (지나감)' : ''}`
    case 'shopBought': return `${who} 자판기 구매 · ${String(d.item ?? '')} ${String(d.cost ?? '')}코인`
    case 'cropSold': return `${who} 매입구 · ${String(d.crop ?? '')} +${String(d.paid ?? '')}코인`
    case 'tradeAccepted': return `거래 성립 · ${String(d.fromTeam ?? '')}↔${String(e.team ?? '')}`
    case 'vote': return '표 한 장'
    case 'errandDone': return `${who} 심부름 끝 · +${String(d.coins ?? '')}코인 (${room})`
    case 'devClock': return `시계 맞춤 · ${String(d.speed ?? '')}배속`
    case 'invisibleCleared': return `${who} 투명인간 해제 · ${short(d.reason, 60)}`
    // ── qaLog 가 새로 적는 것 ──
    case 'phaseOpen': return `페이즈 ${String(d.no ?? '')} 열림 · DAY ${String(d.day ?? e.day)}${d.returned !== undefined ? ` · 돌아옴 ${String(d.returned)}명` : ''}`
    case 'phaseClose': return `페이즈 ${String(d.no ?? '')} 닫힘 · 점령 ${String(d.captured ?? 0)} · 줄 ${String(d.lines ?? 0)}`
    case 'phaseAct': return `${who} ${String(d.kind ?? '')}${d.targetTile ? ` → ${roomName(String(d.targetTile))}` : ''}`
    case 'roamTo': return `${who} 방 옮김 → ${room}`
    case 'standAt': return `${who} 섬 (${String(d.x ?? '')},${String(d.y ?? '')})${room ? ` ${room}` : ''}`
    case 'dealAsked': return `${who} → ${name(e.targetId)} 거래 청함${room ? ` (${room})` : ''}`
    case 'dealAnswered': return `${who} 거래 ${d.accept ? '받음' : '물림'}`
    case 'dealCancelled': return `${who} 거래 접음`
    case 'dealSettled': return `${who} ↔ ${name(e.targetId)} 거래 성립${room ? ` (${room})` : ''}`
    case 'transferAsked': return `${who} → ${name(e.targetId)} 이적 청함 (${String(d.toTeam ?? '')}팀으로)`
    case 'transferAnswered': return `${who} 이적 ${d.accept ? `수락 · 다음 페이즈부터 ${String(d.team ?? '')}팀` : '거절'}`
    case 'trapCommissioned': return `${who} 덫 맡김 · 제조기 ${Number(d.maker ?? 0) + 1} · ${String(d.count ?? '')}개`
    case 'trapTaken': return `${who} 덫 찾음 · 제조기 ${Number(d.maker ?? 0) + 1} · ${String(d.got ?? '')}개`
    case 'slipScattered': return `운영자 쪽지 뿌림 → ${room}${d.n ? ` · ${String(d.n)}장` : ''}`
    case 'slipPulled': return '운영자 쪽지 회수'
    case 'memoDropped': return `운영자 메모 놓음 → ${room}`
    case 'dayPushed': return `달력 넘김 · DAY ${String(d.day ?? '')} ${String(d.kind ?? '')}`
    case 'ballotCast': return `${who} 투명인간 표 적음`
    case 'ballotOpen': return `DAY ${e.day} 투명인간 투표 열림`
    case 'ballotClose': return `DAY ${e.day} 투명인간 투표 닫힘`
    case 'assigned': return `팀 · 미션 배정 · ${String(d.assigned ?? '')}명`
    case 'reset': return '판 되돌림 → 로비'
    case 'seatJoined': return `${who} 앉음${d.team ? ` · ${String(d.team)}팀` : ''}`
    case 'seatLeft': return `${who} 일어남`
    default: {
      const keys = Object.keys(d)
      return `${who ? `${who} ` : ''}${e.kind}${keys.length ? ` · ${short(JSON.stringify(d), 60)}` : ''}`
    }
  }
}

/** 다섯 기록 한 줄을 우리말로. ownerId(쪽지의 주인)는 싣지 않는다 */
function recordText(r: GameRecord, name: (id?: string | null) => string): string {
  const a = name(r.actorId)
  const b = name(r.otherId)
  const room = roomName(r.tileId)
  const at = room ? ` (${room})` : ''
  switch (r.kind) {
    case 'trade': return `${a} ↔ ${b} 거래${at}`
    case 'slipTake': return `${a} 쪽지 주움${at}`
    case 'slipRead': return `${a} 쪽지 읽음`
    case 'slipGive': return `${a} → ${b} 쪽지 건넴${at}`
    case 'slipTear': return `${a} 쪽지 찢음`
    case 'slipDrop': return `${a} 쪽지 내려놓음${at}`
    case 'researchStart': return `${a} 연구 맡김(만든 로봇 +1)${at}`
    case 'robotBorn': return `${a} 로봇 받음${at}`
    case 'robotSmashed': return `${a} 로봇 부숨${r.otherTeam ? ` · ${r.otherTeam}팀 것` : ''}${at}`
    case 'robotGone': return `로봇 사라짐 · ${r.actorTeam}팀`
    case 'robotOwner': return `로봇 주인 바뀜 · ${b} → ${a}`
    case 'quizTake': return `${a} 문제 종이 주움${at}`
    case 'quizSolved': return `${a} 문제 맞힘${at}`
    case 'quizWrong': return `${a} 문제 틀림${at}`
    case 'vendBuy': return `${a} 자판기 구매 · ${String(r.subjectId ?? '')}`
    case 'vendSell': return `${a} 매입구 · ${String(r.subjectId ?? '')}`
    case 'errandTake': return `${a} 심부름 받음${at}`
    case 'errandDone': return `${a} 심부름 끝${at}`
    case 'errandQuit': return `${a} 심부름 그만둠`
    case 'potHarvest': return `${a} 수확 · ${String(r.subjectId ?? '')}${at}`
    case 'teamMoved': return `${a} 이적 · ${String(r.otherTeam ?? '?')}팀 → ${r.actorTeam}팀`
    case 'arcadeDone': return `${a} 오락기 ${String(r.subjectId ?? '')}${b ? ` vs ${b}` : ''}`
    default: return `${a} ${r.kind}`
  }
}

/** phaseLog 의 줄 하나. 페이즈가 닫힐 때 모두에게 공개되는 것이다 */
function phaseLineText(
  l: { kind: string; playerId?: string; tileId?: string; team?: string; targetPlayer?: string; targetRobot?: string; why?: string },
  name: (id?: string | null) => string,
): string {
  const who = name(l.playerId)
  const room = roomName(l.tileId)
  const bits = [who, l.kind, room, l.team ? `${l.team}팀` : '', l.targetPlayer ? `→ ${name(l.targetPlayer)}` : '', l.targetRobot ? '로봇' : '', l.why ? `(${l.why})` : '']
  return bits.filter(Boolean).join(' ')
}

const SCHEDULE_NAME: Record<string, string> = {
  dayStart: '아침',
  settlement: '정산',
  lastHours: '점수판 끄기',
  gameEnd: '끝',
  tokenGrant: '토큰',
}

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)

/**
 * 모든 모음을 시각순 한 줄 목록으로 합친다. hostEventLog 와 불변식 검사가
 * 같이 쓴다. limit 을 넘으면 **뒤(최근)를 남긴다** — 따라가기는 sinceMs
 * 로 앞을 자르니, 처음 여는 화면에 필요한 것은 최근이다.
 */
export async function collectEvents(gameId: string, opts: CollectOpts = {}): Promise<Collected> {
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const game = snap.data() as GameDoc
  const nowMs = nowOf(game)
  const clock = game.clock as DevClock
  const since = opts.sinceMs ?? 0
  const until = opts.untilMs ?? Number.MAX_SAFE_INTEGER
  const name = namer(game)
  const secret = ref.collection('secret')

  // 큰 모음은 시각으로 자른다. 작은 것(달력 · 투표 결과 · 자정 판정)은 통째로 읽는다
  const sinced = (q: FirebaseFirestore.Query, field = 'atMs', from = since): FirebaseFirestore.Query =>
    from > 0 ? q.where(field, '>=', from) : q
  const [events, records, qa, schedule, phaseLog, ballotDays, ballots, notices, missionLog, missionDays, notifyLog] = await Promise.all([
    sinced(ref.collection('events')).get(),
    sinced(secret.doc('records').collection('items')).get(),
    sinced(qaLogOf(gameId)).get(),
    ref.collection('schedule').get(),
    sinced(ref.collection('phaseLog')).get(),
    secret.doc('ballotDays').collection('items').get(),
    secret.doc('ballots').collection('items').get(),
    sinced(ref.collection('notices')).get(),
    sinced(secret.doc('missionLog').collection('items')).get(),
    secret.doc('missionDays').collection('items').get(),
    // 알림 기록은 실제 시각으로 적혀 있다 — 창의 앞을 실제 시각으로 되짚어 자른다
    sinced(secret.doc('notifyLog').collection('items'), 'atMs', since > 0 ? realTimeOf(since, clock) : 0).get(),
  ])

  const rows: LogRow[] = []
  const push = (row: LogRow) => {
    if (row.atMs >= since && row.atMs <= until) rows.push(row)
  }
  const dayOf = (ms: number) => (game.startedAtMs ? dayNumber(game.startedAtMs, ms) : 0)

  // events + secret/qa/log — 같은 모양이다
  const seenPhaseOpen = new Set<number>()
  const seenPhaseClose = new Set<number>()
  for (const [src, qs] of [['ev', events], ['qa', qa]] as const) {
    for (const d of qs.docs) {
      const e = d.data() as EventDoc & { targetId?: string; byId?: string }
      const det = (e.detail ?? {}) as Record<string, unknown>
      if (e.kind === ('phaseOpen' as string) && typeof det.no === 'number') seenPhaseOpen.add(det.no)
      if (e.kind === ('phaseClose' as string) && typeof det.no === 'number') seenPhaseClose.add(det.no)
      push({
        id: `${src}:${d.id}`,
        atMs: e.atMs,
        day: dayOf(e.atMs),
        kind: e.kind,
        src: src === 'ev' ? 'events' : 'qa',
        ...(e.playerId ? { actor: name(e.playerId) } : e.byId ? { actor: name(e.byId) } : {}),
        ...(e.targetId ? { target: name(e.targetId) } : {}),
        ...(e.tileId ? { tileId: e.tileId } : {}),
        text: eventText(e, name),
      })
    }
  }

  for (const d of records.docs) {
    const r = d.data() as GameRecord
    push({
      id: `rec:${d.id}`,
      atMs: r.atMs,
      day: dayOf(r.atMs),
      kind: r.kind,
      src: 'records',
      actor: name(r.actorId),
      ...(r.otherId ? { target: name(r.otherId) } : {}),
      ...(r.tileId ? { tileId: r.tileId } : {}),
      text: recordText(r, name),
    })
  }

  // 달력 — 운영자가 넘긴 시각. 예정 시각과 다르면 둘 다 적는다. 도착(arrive)은 events 에 이미 있다
  for (const d of schedule.docs) {
    const s = d.data() as ScheduleDoc
    if (s.kind === 'arrive' || s.doneAtMs === null) continue
    const at = s.pushedAtMs ?? s.doneAtMs
    const day = (s.payload?.day as number | undefined) ?? dayOf(at)
    const late = s.pushedAtMs !== undefined && Math.abs(s.pushedAtMs - s.dueAtMs) > 60_000
    push({
      id: `sch:${d.id}`,
      atMs: at,
      day: dayOf(at),
      kind: `push:${s.kind}`,
      src: 'schedule',
      actor: '운영자',
      text: `달력 넘김 · DAY ${day} ${SCHEDULE_NAME[s.kind] ?? s.kind}${late ? ` (예정 ${hhmm(s.dueAtMs)})` : ''}`,
    })
  }

  // 페이즈 결과. phaseOpen/phaseClose 는 events 에 이미 있으면(phase.ts 가 적게 되면) 다시 만들지 않는다
  for (const d of phaseLog.docs) {
    const p = d.data() as { no: number; day: number; atMs: number; lines?: Parameters<typeof phaseLineText>[0][] }
    if (!seenPhaseClose.has(p.no)) {
      push({
        id: `ph:${p.no}`,
        atMs: p.atMs,
        day: p.day,
        kind: 'phaseClose',
        src: 'phaseLog',
        text: `페이즈 ${p.no} 닫힘 · 줄 ${(p.lines ?? []).length}`,
      })
    }
    ;(p.lines ?? []).forEach((l, i) =>
      push({
        id: `ph:${p.no}:${i}`,
        atMs: p.atMs,
        day: p.day,
        kind: `phase:${l.kind}`,
        src: 'phaseLog',
        ...(l.playerId ? { actor: name(l.playerId) } : {}),
        ...(l.targetPlayer ? { target: name(l.targetPlayer) } : {}),
        ...(l.tileId ? { tileId: l.tileId } : {}),
        text: phaseLineText(l, name),
      }),
    )
  }
  const pn = game.phaseNow
  if (pn && !seenPhaseOpen.has(pn.no)) {
    push({
      id: `pn:${pn.no}`,
      atMs: pn.openedAtMs,
      day: pn.day,
      kind: 'phaseOpen',
      src: 'game',
      text: `페이즈 ${pn.no} 열림 · DAY ${pn.day}${pn.endsAtMs ? ` · ${hhmm(pn.endsAtMs)}까지` : ''}`,
    })
  }

  // 투표 결과 — 날 · 결과 · 던진 장수. **누가 누구를 적었는지는 없다**
  const ballotCount = new Map<number, number>()
  for (const d of ballots.docs) {
    const b = d.data() as { day?: number }
    if (typeof b.day === 'number') ballotCount.set(b.day, (ballotCount.get(b.day) ?? 0) + 1)
  }
  for (const d of ballotDays.docs) {
    const b = d.data() as BallotDayDoc
    const REASON: Record<string, string> = { picked: '지워짐', none: '표 없음', tie: '동률', repeat: '이틀 연속 금지' }
    push({
      id: `bd:${d.id}`,
      atMs: b.atMs,
      day: b.day,
      kind: 'ballotResult',
      src: 'ballotDays',
      ...(b.invisibleId ? { target: name(b.invisibleId) } : {}),
      text: `DAY ${b.day} 투명인간 투표 · ${ballotCount.get(b.day) ?? 0}장 · ${b.invisibleId ? `${name(b.invisibleId)} ` : ''}${REASON[b.reason] ?? b.reason}`,
    })
  }

  for (const d of notices.docs) {
    const n = d.data() as NoticeDoc
    push({
      id: `nt:${d.id}`,
      atMs: n.atMs,
      day: dayOf(n.atMs),
      kind: 'notice',
      src: 'notices',
      ...(n.byId ? { actor: name(n.byId) } : {}),
      target: n.toPlayerId ? name(n.toPlayerId) : '전원',
      text: `공지 → ${n.toPlayerId ? name(n.toPlayerId) : '전원'} · ${short(n.text, 60)}`,
    })
  }

  // 미션 — 뒤집었다 · 보냈다 · 자정 판정. **판정 내용은 없다**
  for (const d of missionLog.docs) {
    const m = d.data() as MissionLogDoc
    const who = (m.playerIds ?? []).map((id) => name(id))
    push({
      id: `ml:${d.id}`,
      atMs: m.atMs,
      day: m.day,
      kind: `mission:${m.kind}`,
      src: 'missionLog',
      actor: name(m.byId),
      ...(who.length === 1 ? { target: who[0] } : {}),
      text: m.kind === 'override' ? `DAY ${m.day} 판정 뒤집음 · ${who.join(', ')}` : `DAY ${m.day} 판정 보냄 · ${who.length}명`,
    })
  }
  for (const d of missionDays.docs) {
    const m = d.data() as MissionDayDoc
    push({
      id: `md:${d.id}`,
      atMs: m.asOfMs,
      day: m.day,
      kind: 'missionJudge',
      src: 'missionDays',
      text: `DAY ${m.day} 자정 판정 · ${m.count}명${m.final ? ' · 최종' : ''}`,
    })
  }

  for (const d of notifyLog.docs) {
    const n = d.data() as { type: string; target: string; atMs: number; channel: string; ok: boolean; err?: string; skip?: boolean }
    const at = gameNow(clock, n.atMs)
    push({
      id: `nl:${d.id}`,
      atMs: at,
      day: dayOf(at),
      kind: 'notify',
      src: 'notifyLog',
      target: name(n.target),
      text: `알림 ${n.type} → ${name(n.target)} · ${n.channel === 'push' ? '앱 밖' : '앱 안'} · ${n.skip ? '건너뜀' : n.ok ? '성공' : `실패${n.err ? ` ${short(n.err, 30)}` : ''}`}`,
    })
  }

  rows.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
  const kinds = [...new Set(rows.map((r) => r.kind))].sort()
  const want = opts.kinds
  const picked = want && want.length > 0 ? rows.filter((r) => want.includes(r.kind)) : rows
  const limit = Math.max(1, Math.min(5000, Math.floor(opts.limit ?? 1000)))
  const truncated = picked.length > limit
  return { nowMs, rows: truncated ? picked.slice(picked.length - limit) : picked, kinds, total: picked.length, truncated }
}

/**
 * 지금 이전의 가장 최근 한 줄. 불변식이 어긋났을 때 「그 직전에 무슨 일이 있었나」.
 *
 * **지금보다 뒤의 줄은 안 본다.** 개발용 시계를 건 판에는 로비에서(실제
 * 시각으로) 적힌 줄이 게임 시각보다 한참 뒤에 놓인다 — 그것이 늘 「직전」
 * 으로 잡히면 단서가 못 된다.
 */
export async function lastEvent(gameId: string, nowMs: number): Promise<LogRow | null> {
  // 최근 여섯 시간만 먼저 본다 — 매 페이즈마다 판 전체를 읽지 않게
  const near = await collectEvents(gameId, { sinceMs: nowMs - 6 * 3_600_000, untilMs: nowMs, limit: 1 })
  if (near.rows.length > 0) return near.rows[near.rows.length - 1]
  const all = await collectEvents(gameId, { untilMs: nowMs, limit: 1 })
  return all.rows[all.rows.length - 1] ?? null
}

/**
 * 운영자 — 시각순 로그. sinceMs 를 주면 그 뒤만(따라가기), kinds 를 주면
 * 그 종류만, limit 을 넘으면 최근을 남긴다.
 */
export const hostEventLog = onCall<{ gameId: string; sinceMs?: number; untilMs?: number; kinds?: string[]; limit?: number }>(
  async (req) => {
    requireHost(req.auth)
    const gameId = String(req.data?.gameId ?? '')
    if (!gameId) throw new HttpsError('invalid-argument', '판이 없다.')
    const num = (v: unknown): number | undefined => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : undefined)
    const kinds = Array.isArray(req.data.kinds) ? req.data.kinds.map(String).slice(0, 100) : undefined
    return collectEvents(gameId, { sinceMs: num(req.data.sinceMs), untilMs: num(req.data.untilMs), kinds, limit: num(req.data.limit) })
  },
)
