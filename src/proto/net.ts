import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Dir } from './sprites'

// 본 게임과 완전히 분리된 경로. 프로토타입이 실제 판을 건드릴 일이 없게 한다.
const ROOM_ID = 'live'

export interface Presence {
  id: string
  nickname: string
  x: number
  y: number
  dir: Dir
  roomId: string
  updatedAtMs: number
}

export interface ChatLine {
  id: string
  authorId: string
  nickname: string
  roomId: string
  text: string
  createdAtMs: number
}

/** 이 시간 넘게 소식이 없으면 나간 것으로 본다. Firestore에는 접속 끊김 감지가 없다. */
export const STALE_MS = 12_000

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

function playersCol() {
  return collection(requireDb(), 'protoRoom', ROOM_ID, 'players')
}

function messagesCol() {
  return collection(requireDb(), 'protoRoom', ROOM_ID, 'messages')
}

export function subscribePresence(cb: (list: Presence[]) => void): Unsubscribe {
  return onSnapshot(playersCol(), (snap) => {
    cb(snap.docs.map((d) => d.data() as Presence))
  })
}

export function subscribeChat(cb: (lines: ChatLine[]) => void): Unsubscribe {
  const q = query(messagesCol(), orderBy('createdAtMs', 'desc'), limit(40))
  return onSnapshot(q, (snap) => {
    const lines = snap.docs.map((d) => d.data() as ChatLine)
    lines.reverse()
    cb(lines)
  })
}

/**
 * 좌표 전송. 칸 단위로 걷기 때문에 한 걸음 시작할 때만 보내면 되고,
 * 그마저도 이 간격으로 묶는다. Firestore는 초당 수십 번 쓰라고 만든 물건이 아니다.
 */
const SEND_INTERVAL_MS = 200
let lastSentAt = 0
let pending: Presence | null = null
let flushTimer: number | null = null

function write(p: Presence): void {
  lastSentAt = Date.now()
  void setDoc(doc(playersCol(), p.id), p)
}

export function sendPresence(p: Presence, force = false): void {
  const now = Date.now()
  if (force || now - lastSentAt >= SEND_INTERVAL_MS) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pending = null
    write(p)
    return
  }
  // 아직 이르면 마지막 상태만 들고 있다가 간격이 차면 한 번에 보낸다.
  pending = p
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      if (pending) {
        write(pending)
        pending = null
      }
    }, SEND_INTERVAL_MS - (now - lastSentAt))
  }
}

export function leave(playerId: string): void {
  void deleteDoc(doc(playersCol(), playerId)).catch(() => {})
}

export function sendChat(line: ChatLine): void {
  void setDoc(doc(messagesCol(), line.id), line)
}
