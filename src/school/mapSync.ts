import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  query,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import { ROOMS } from './map/world'
import { FRAGMENTS } from './data/fragments'
import type {
  MapFragment,
  MapNote,
  PresenceInterval,
  SchoolSessionState,
  SpatialActionKind,
  SpatialEvent,
} from './types'

const SESSION_ID = 'live'

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

function sessionRef() {
  return doc(requireDb(), 'schoolSessions', SESSION_ID)
}
function intervalsCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'intervals')
}
function eventsCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'spatialEvents')
}
function notesCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'notes')
}
/** 살아 있는 좌표. 렌더링에만 쓰고 판정에는 쓰지 않는다. */
function livePosCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'positions')
}

// ── 살아 있는 좌표 ──────────────────────────────────────────────

export interface LivePosition {
  id: string
  x: number
  y: number
  dir: 'up' | 'down' | 'left' | 'right'
  roomId: string
  updatedAtMs: number
}

export const POSITION_STALE_MS = 12_000

const SEND_INTERVAL_MS = 220
let lastSentAt = 0
let pendingPos: LivePosition | null = null
let flushTimer: number | null = null

export function sendPosition(p: LivePosition, force = false): void {
  const now = Date.now()
  if (force || now - lastSentAt >= SEND_INTERVAL_MS) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingPos = null
    lastSentAt = now
    void setDoc(doc(livePosCol(), p.id), p)
    return
  }
  pendingPos = p
  if (flushTimer === null) {
    flushTimer = window.setTimeout(
      () => {
        flushTimer = null
        if (pendingPos) {
          lastSentAt = Date.now()
          void setDoc(doc(livePosCol(), pendingPos.id), pendingPos)
          pendingPos = null
        }
      },
      SEND_INTERVAL_MS - (now - lastSentAt),
    )
  }
}

export function subscribePositions(cb: (list: LivePosition[]) => void): Unsubscribe {
  return onSnapshot(livePosCol(), (snap) => cb(snap.docs.map((d) => d.data() as LivePosition)))
}

export function clearPosition(playerId: string): void {
  void deleteDoc(doc(livePosCol(), playerId)).catch(() => {})
}

// ── 구간 ────────────────────────────────────────────────────────

export function subscribeIntervals(cb: (list: PresenceInterval[]) => void): Unsubscribe {
  return onSnapshot(intervalsCol(), (snap) => cb(snap.docs.map((d) => d.data() as PresenceInterval)))
}

/**
 * 방을 옮길 때만 부른다. 열려 있던 구간을 닫고 새 구간을 연다.
 * 이 두 줄이 함께 있는 시간·혼자 있는 시간·단둘이 있는 시간을 전부 만들어 낸다.
 */
export async function moveRoom(playerId: string, roomId: string, day: number): Promise<string> {
  const open = await getDocs(query(intervalsCol(), where('playerId', '==', playerId), where('leftAtMs', '==', null)))
  const now = Date.now()
  await Promise.all(open.docs.map((d) => updateDoc(d.ref, { leftAtMs: now })))

  const entry: PresenceInterval = {
    id: crypto.randomUUID(),
    playerId,
    roomId,
    day,
    enteredAtMs: now,
    leftAtMs: null,
  }
  await setDoc(doc(intervalsCol(), entry.id), entry)
  return entry.id
}

/** 판을 떠날 때 열린 구간을 닫아 준다. 안 닫으면 영원히 그 방에 있는 것으로 계산된다. */
export async function closeIntervals(playerId: string): Promise<void> {
  const open = await getDocs(query(intervalsCol(), where('playerId', '==', playerId), where('leftAtMs', '==', null)))
  const now = Date.now()
  await Promise.all(open.docs.map((d) => updateDoc(d.ref, { leftAtMs: now })))
}

// ── 사건 ────────────────────────────────────────────────────────

export function subscribeSpatialEvents(cb: (list: SpatialEvent[]) => void): Unsubscribe {
  return onSnapshot(eventsCol(), (snap) => cb(snap.docs.map((d) => d.data() as SpatialEvent)))
}

async function logEvent(
  kind: SpatialActionKind,
  actorId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
  targetId: string | null = null,
): Promise<void> {
  const e: SpatialEvent = {
    id: crypto.randomUUID(),
    kind,
    actorId,
    roomId,
    targetId,
    witnessIds,
    day,
    createdAtMs: Date.now(),
  }
  await setDoc(doc(eventsCol(), e.id), e)
}

// ── 조각 ────────────────────────────────────────────────────────

/** A의 기록 문장 풀에서 한 줄씩 떼어 조각으로 쓴다. */
function fragmentText(day: number, seed: number): string {
  const source = FRAGMENTS[(day - 1 + seed) % FRAGMENTS.length]
  const sentences = source.text.split('. ').filter(Boolean)
  const picked = sentences[seed % sentences.length] ?? source.text
  return picked.endsWith('.') ? picked : `${picked}.`
}

/** 진행자 전용: 하루치 조각을 무작위 구역에 뿌린다. */
export async function spawnFragments(day: number, count = 4): Promise<number> {
  const rooms = ROOMS.filter((r) => r.id !== 'hallway')
  const now = Date.now()
  const fresh: MapFragment[] = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    text: fragmentText(day, i),
    roomId: rooms[Math.floor(Math.random() * rooms.length)].id,
    state: 'onFloor' as const,
    holderId: null,
    day,
    createdAtMs: now + i,
  }))
  await updateDoc(sessionRef(), { mapFragments: arrayUnion(...fresh) })
  return fresh.length
}

async function mutateFragment(
  fragmentId: string,
  change: (f: MapFragment) => MapFragment,
): Promise<MapFragment> {
  let updated!: MapFragment
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(sessionRef())
    const current = snap.data() as Partial<SchoolSessionState>
    const list = current.mapFragments ?? []
    const target = list.find((f) => f.id === fragmentId)
    if (!target) throw new Error('그 조각이 없다.')
    updated = change(target)
    tx.update(sessionRef(), { mapFragments: list.map((f) => (f.id === fragmentId ? updated : f)) })
  })
  return updated
}

export async function pickFragment(
  fragmentId: string,
  playerId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  await mutateFragment(fragmentId, (f) => {
    if (f.state !== 'onFloor') throw new Error('이미 누가 가져갔다.')
    return { ...f, state: 'held', holderId: playerId }
  })
  await logEvent('pickFragment', playerId, roomId, witnessIds, day)
}

export async function dropFragment(
  fragmentId: string,
  playerId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  await mutateFragment(fragmentId, (f) => {
    if (f.holderId !== playerId) throw new Error('내가 쥔 조각이 아니다.')
    return { ...f, state: 'onFloor', holderId: null, roomId }
  })
  await logEvent('dropFragment', playerId, roomId, witnessIds, day)
}

export async function burnFragment(
  fragmentId: string,
  playerId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  await mutateFragment(fragmentId, (f) => {
    if (f.holderId !== playerId) throw new Error('내가 쥔 조각이 아니다.')
    return { ...f, state: 'burned', holderId: null }
  })
  await logEvent('burnFragment', playerId, roomId, witnessIds, day)
}

export async function giveFragment(
  fragmentId: string,
  playerId: string,
  toPlayerId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  await mutateFragment(fragmentId, (f) => {
    if (f.holderId !== playerId) throw new Error('내가 쥔 조각이 아니다.')
    return { ...f, state: 'held', holderId: toPlayerId }
  })
  await logEvent('giveFragment', playerId, roomId, witnessIds, day, toPlayerId)
}

// ── 쪽지 ────────────────────────────────────────────────────────

export function subscribeNotes(cb: (list: MapNote[]) => void): Unsubscribe {
  return onSnapshot(notesCol(), (snap) => cb(snap.docs.map((d) => d.data() as MapNote)))
}

export async function leaveNote(
  authorId: string,
  roomId: string,
  text: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  const note: MapNote = {
    id: crypto.randomUUID(),
    roomId,
    text: text.slice(0, 120),
    authorId,
    witnessIds,
    readerIds: [],
    day,
    createdAtMs: Date.now(),
  }
  await setDoc(doc(notesCol(), note.id), note)
  await logEvent('leaveNote', authorId, roomId, witnessIds, day)
}

export async function readNote(
  noteId: string,
  readerId: string,
  roomId: string,
  witnessIds: string[],
  day: number,
): Promise<void> {
  await updateDoc(doc(notesCol(), noteId), { readerIds: arrayUnion(readerId) })
  await logEvent('readNote', readerId, roomId, witnessIds, day)
}
