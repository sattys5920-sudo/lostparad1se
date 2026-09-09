import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import { roleById } from './data/roles'
import { assignRoles } from './engine/setup'
import type {
  ActionLogEntry,
  ChatMessage,
  DmThread,
  GamePhase,
  PlayerProfile,
  RevealLogEntry,
  RumorEntry,
  SchoolSessionState,
} from './types'

const SESSION_ID = 'live'

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

function sessionRef() {
  return doc(requireDb(), 'schoolSessions', SESSION_ID)
}

function playersCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'players')
}

function playerRef(playerId: string) {
  return doc(playersCol(), playerId)
}

function dmCol() {
  return collection(requireDb(), 'schoolSessions', SESSION_ID, 'dmThreads')
}

/** 두 사람의 대화방 id. 누가 먼저 말을 걸었든 같은 방이 되도록 정렬해서 잇는다. */
export function threadKeyFor(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`
}

const emptySession: SchoolSessionState = {
  phase: 'lobby',
  day: 1,
  rolesAssigned: false,
  groupChat: [],
  actionLog: [],
  rumors: [],
  revealLog: [],
  activeEventCard: null,
  createdAtMs: Date.now(),
}

export async function ensureSchoolSessionInitialized(): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(sessionRef())
    if (snap.exists()) return
    tx.set(sessionRef(), emptySession)
  })
}

export function subscribeSchoolSession(cb: (state: SchoolSessionState) => void): Unsubscribe {
  return onSnapshot(sessionRef(), (snap) => {
    if (!snap.exists()) {
      cb(emptySession)
      return
    }
    // 이전 회차에 만들어진 문서에는 나중에 추가한 필드가 없을 수 있어 기본값 위에 얹는다.
    cb({ ...emptySession, ...(snap.data() as Partial<SchoolSessionState>) })
  })
}

/** 내가 참여한 1:1 대화방만 구독한다. 남의 방은 애초에 내려오지 않는다. */
export function subscribeMyDmThreads(viewerId: string, cb: (threads: Record<string, DmThread>) => void): Unsubscribe {
  const q = query(dmCol(), where('participants', 'array-contains', viewerId))
  return onSnapshot(q, (snap) => {
    const threads: Record<string, DmThread> = {}
    snap.forEach((d) => {
      threads[d.id] = d.data() as DmThread
    })
    cb(threads)
  })
}

export async function sendDirectMessage(a: string, b: string, message: ChatMessage): Promise<void> {
  const key = threadKeyFor(a, b)
  await setDoc(
    doc(dmCol(), key),
    {
      key,
      participants: [a, b],
      messages: arrayUnion(message),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
}

export async function logReveal(entry: RevealLogEntry): Promise<void> {
  await updateDoc(sessionRef(), { revealLog: arrayUnion(entry) })
}

export function subscribeSchoolPlayers(cb: (players: Record<string, PlayerProfile>) => void): Unsubscribe {
  return onSnapshot(playersCol(), (snap) => {
    const players: Record<string, PlayerProfile> = {}
    snap.forEach((d) => {
      players[d.id] = d.data() as PlayerProfile
    })
    cb(players)
  })
}

export async function joinSchoolSession(playerId: string, nickname: string, isHost: boolean): Promise<void> {
  const profile: PlayerProfile = {
    id: playerId,
    nickname,
    joinedAtMs: Date.now(),
    roleId: null,
    isHost,
    missionChecks: [],
    hiddenGoalResolution: null,
    endingKey: null,
    endingNote: null,
  }
  await setDoc(playerRef(playerId), profile, { merge: true })
}

/** 진행자 전용: 중복 입장이나 유령 참가자를 명단에서 뺀다. 그 사람이 낀 대화방도 같이 지운다. */
export async function removeSchoolPlayer(playerId: string): Promise<void> {
  const threads = await getDocs(query(dmCol(), where('participants', 'array-contains', playerId)))
  await Promise.all([deleteDoc(playerRef(playerId)), ...threads.docs.map((d) => deleteDoc(d.ref))])
}

/** 진행자 전용: 지금 모인 인원으로 역할을 자동 배정하고 역할 공개 단계로 넘긴다. */
export async function assignRolesAndReveal(playerIds: string[]): Promise<void> {
  const assignment = assignRoles(playerIds)
  await runTransaction(requireDb(), async (tx) => {
    for (const playerId of playerIds) {
      const roleId = assignment[playerId]
      const checklistLength = roleById[roleId].mission.checklist.length
      tx.update(playerRef(playerId), {
        roleId,
        missionChecks: new Array(checklistLength).fill(false),
      })
    }
    tx.update(sessionRef(), { rolesAssigned: true, phase: 'roleReveal' satisfies GamePhase })
  })
}

export async function setSchoolPhase(phase: GamePhase): Promise<void> {
  await updateDoc(sessionRef(), { phase })
}

export async function advanceSchoolDay(nextDay: number, eventCard: string | null): Promise<void> {
  await updateDoc(sessionRef(), { day: nextDay, activeEventCard: eventCard, phase: 'day' satisfies GamePhase })
}

export async function setActiveEventCard(eventCard: string | null): Promise<void> {
  await updateDoc(sessionRef(), { activeEventCard: eventCard })
}

export async function postGroupChatMessage(message: ChatMessage): Promise<void> {
  await updateDoc(sessionRef(), { groupChat: arrayUnion(message) })
}

export async function logSchoolAction(entry: ActionLogEntry): Promise<void> {
  await updateDoc(sessionRef(), { actionLog: arrayUnion(entry) })
}

export async function addSchoolRumor(rumor: RumorEntry): Promise<void> {
  await updateDoc(sessionRef(), { rumors: arrayUnion(rumor) })
}

export async function setMissionChecks(playerId: string, missionChecks: boolean[]): Promise<void> {
  await updateDoc(playerRef(playerId), { missionChecks })
}

export async function setHiddenGoalResolution(playerId: string, text: string): Promise<void> {
  await updateDoc(playerRef(playerId), { hiddenGoalResolution: text })
}

export async function setPlayerEnding(playerId: string, endingKey: string, endingNote: string | null): Promise<void> {
  await updateDoc(playerRef(playerId), { endingKey, endingNote })
}

/** 진행자 전용: 다음 회차를 위해 세션·참가자·대화방을 모두 지운다. */
export async function resetSchoolSession(): Promise<void> {
  const [players, threads] = await Promise.all([getDocs(playersCol()), getDocs(dmCol())])
  await Promise.all([...players.docs, ...threads.docs].map((d) => deleteDoc(d.ref)))
  await setDoc(sessionRef(), { ...emptySession, createdAtMs: Date.now() })
}
