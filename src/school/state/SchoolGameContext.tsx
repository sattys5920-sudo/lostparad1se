import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { roleById } from '../data/roles'
import { actionByKind } from '../data/actions'
import { computeRelationshipMatrix, type RelationshipMatrix } from '../engine/relationships'
import { createOriginRumor, retellRumor } from '../engine/rumors'
import { revealText } from '../engine/reveals'
import { evaluateMission, type MissionItemProgress } from '../engine/missionProgress'
import {
  addSchoolRumor,
  advanceSchoolDay,
  assignRolesAndReveal,
  castSchoolVote,
  ensureSchoolSessionInitialized,
  joinSchoolSession,
  logReveal,
  logSchoolAction,
  postGroupChatMessage,
  removeSchoolPlayer,
  sendDirectMessage,
  subscribeMyDmThreads,
  threadKeyFor,
  resetSchoolSession,
  setActiveEventCard,
  setHiddenGoalResolution as setHiddenGoalResolutionSync,
  setPlayerEnding,
  setSchoolPhase,
  subscribeSchoolPlayers,
  subscribeSchoolSession,
} from '../sync'
import type {
  ActionKind,
  ChatMessage,
  DmThread,
  EndingKey,
  PlayerProfile,
  RevealKind,
  RoleSpec,
  RumorEntry,
  SchoolSessionState,
  VoteCategory,
} from '../types'

const HOST_CODE = '821113'
const LS = {
  playerId: 'school_playerId',
  nickname: 'school_nickname',
  isHost: 'school_isHost',
  roleAcked: 'school_roleAcked',
}

const EMPTY_SESSION: SchoolSessionState = {
  phase: 'lobby',
  day: 1,
  rolesAssigned: false,
  groupChat: [],
  actionLog: [],
  rumors: [],
  revealLog: [],
  votes: [],
  activeEventCard: null,
  createdAtMs: Date.now(),
}

interface SchoolGameValue {
  ready: boolean
  viewerId: string | null
  nickname: string
  isHost: boolean
  session: SchoolSessionState
  players: Record<string, PlayerProfile>
  myPlayer: PlayerProfile | null
  myRole: RoleSpec | null
  relationshipMatrix: RelationshipMatrix
  otherPlayerIds: string[]
  /** 지금 내 역할을 이미 확인했는지 — 재배정(리셋 후 재시작) 시 새 역할을 다시 보여주기 위해 역할 id 자체로 비교한다. */
  roleAcked: boolean
  acknowledgeRole: () => void
  joinAsPlayer: (nickname: string) => Promise<void>
  loginAsHost: (code: string) => void
  logout: () => void
  hostAssignRoles: () => Promise<void>
  hostRemovePlayer: (playerId: string) => Promise<void>
  hostAdvanceDay: (nextDay: number, eventCard: string | null) => Promise<void>
  hostSetEventCard: (eventCard: string | null) => Promise<void>
  hostEndGame: () => Promise<void>
  hostResetSession: () => Promise<void>
  sendGroupChat: (text: string) => Promise<void>
  dmThreads: Record<string, DmThread>
  dmWith: (otherId: string) => ChatMessage[]
  sendDm: (targetId: string, text: string) => Promise<void>
  revealToPerson: (targetId: string, kind: RevealKind, custom: string) => Promise<void>
  revealToClass: (kind: RevealKind, custom: string) => Promise<void>
  performAction: (kind: ActionKind, targetId: string | null, text: string | null) => Promise<void>
  spreadRumor: (targetId: string, text: string, parentRumorId: string | null) => Promise<void>
  myMissionProgress: MissionItemProgress[]
  /** 오늘 신뢰/호감 투표를 이미 누구에게 줬는지. 아직이면 null. */
  myVotesToday: Record<VoteCategory, string | null>
  castVote: (targetId: string, category: VoteCategory) => Promise<void>
  submitHiddenGoalResolution: (text: string) => Promise<void>
  chooseEnding: (key: EndingKey, note: string | null) => Promise<void>
}

const SchoolGameContext = createContext<SchoolGameValue | null>(null)

export function useSchoolGame(): SchoolGameValue {
  const ctx = useContext(SchoolGameContext)
  if (!ctx) throw new Error('useSchoolGame은 SchoolGameProvider 안에서만 쓸 수 있다')
  return ctx
}

export function SchoolGameProvider({ children }: { children: ReactNode }) {
  const [viewerId, setViewerId] = useState<string | null>(() => localStorage.getItem(LS.playerId))
  const [nickname, setNickname] = useState(() => localStorage.getItem(LS.nickname) ?? '')
  const [isHost, setIsHost] = useState(() => localStorage.getItem(LS.isHost) === 'true')
  const [ackedRoleId, setAckedRoleId] = useState(() => localStorage.getItem(LS.roleAcked) ?? '')
  const [session, setSession] = useState<SchoolSessionState>(EMPTY_SESSION)
  const [players, setPlayers] = useState<Record<string, PlayerProfile>>({})
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [playersLoaded, setPlayersLoaded] = useState(false)
  const [dmThreads, setDmThreads] = useState<Record<string, DmThread>>({})

  useEffect(() => {
    ensureSchoolSessionInitialized().catch(() => {})
    const unsubSession = subscribeSchoolSession((s) => {
      setSession(s)
      setSessionLoaded(true)
    })
    const unsubPlayers = subscribeSchoolPlayers((p) => {
      setPlayers(p)
      setPlayersLoaded(true)
    })
    return () => {
      unsubSession()
      unsubPlayers()
    }
  }, [])

  useEffect(() => {
    if (!viewerId) {
      setDmThreads({})
      return
    }
    return subscribeMyDmThreads(viewerId, setDmThreads)
  }, [viewerId])

  const myPlayer = viewerId ? (players[viewerId] ?? null) : null
  const myRole = myPlayer?.roleId ? roleById[myPlayer.roleId] : null
  const roleAcked = Boolean(myPlayer?.roleId) && ackedRoleId === myPlayer?.roleId
  const otherPlayerIds = useMemo(
    () => Object.keys(players).filter((id) => id !== viewerId),
    [players, viewerId],
  )
  const relationshipMatrix = useMemo(() => computeRelationshipMatrix(session.actionLog), [session.actionLog])

  const myMissionProgress = useMemo<MissionItemProgress[]>(() => {
    if (!viewerId || !myRole) return []
    return evaluateMission(myRole, {
      viewerId,
      actionLog: session.actionLog,
      revealLog: session.revealLog,
      rumors: session.rumors,
      votes: session.votes,
      dmPartnerCount: Object.keys(dmThreads).length,
    })
  }, [viewerId, myRole, session.actionLog, session.revealLog, session.rumors, session.votes, dmThreads])

  const myVotesToday = useMemo<Record<VoteCategory, string | null>>(() => {
    const findTarget = (category: VoteCategory) =>
      session.votes.find((v) => v.voterId === viewerId && v.day === session.day && v.category === category)
        ?.targetId ?? null
    return { trust: findTarget('trust'), liking: findTarget('liking') }
  }, [session.votes, session.day, viewerId])

  async function joinAsPlayer(nick: string) {
    const trimmed = nick.trim()
    if (!trimmed) throw new Error('닉네임을 입력해라.')
    const id = viewerId ?? crypto.randomUUID()
    await joinSchoolSession(id, trimmed, false)
    localStorage.setItem(LS.playerId, id)
    localStorage.setItem(LS.nickname, trimmed)
    localStorage.setItem(LS.isHost, 'false')
    setViewerId(id)
    setNickname(trimmed)
    setIsHost(false)
  }

  function loginAsHost(code: string) {
    if (code.trim() !== HOST_CODE) throw new Error('진행자 코드가 올바르지 않다.')
    localStorage.setItem(LS.isHost, 'true')
    localStorage.setItem(LS.nickname, '진행자')
    setIsHost(true)
    setNickname('진행자')
  }

  function logout() {
    localStorage.removeItem(LS.playerId)
    localStorage.removeItem(LS.nickname)
    localStorage.removeItem(LS.isHost)
    localStorage.removeItem(LS.roleAcked)
    setViewerId(null)
    setNickname('')
    setIsHost(false)
    setAckedRoleId('')
  }

  function acknowledgeRole() {
    if (!myPlayer?.roleId) return
    localStorage.setItem(LS.roleAcked, myPlayer.roleId)
    setAckedRoleId(myPlayer.roleId)
  }

  async function hostAssignRoles() {
    const ids = Object.values(players)
      .filter((p) => !p.isHost)
      .map((p) => p.id)
    await assignRolesAndReveal(ids)
  }

  async function hostRemovePlayer(playerId: string) {
    await removeSchoolPlayer(playerId)
  }

  async function hostAdvanceDay(nextDay: number, eventCard: string | null) {
    await advanceSchoolDay(nextDay, eventCard)
  }

  async function hostSetEventCard(eventCard: string | null) {
    await setActiveEventCard(eventCard)
  }

  async function hostEndGame() {
    await setSchoolPhase('ended')
  }

  async function hostResetSession() {
    await resetSchoolSession()
  }

  async function sendGroupChat(text: string) {
    if (!viewerId || !text.trim()) return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      authorId: viewerId,
      text: text.trim(),
      day: session.day,
      createdAtMs: Date.now(),
    }
    await postGroupChatMessage(message)
  }

  function dmWith(otherId: string): ChatMessage[] {
    if (!viewerId) return []
    const thread = dmThreads[threadKeyFor(viewerId, otherId)]
    if (!thread) return []
    return [...thread.messages].sort((a, b) => a.createdAtMs - b.createdAtMs)
  }

  async function sendDm(targetId: string, text: string) {
    if (!viewerId || !text.trim()) return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      authorId: viewerId,
      text: text.trim(),
      day: session.day,
      createdAtMs: Date.now(),
      kind: 'text',
    }
    await sendDirectMessage(viewerId, targetId, message)
  }

  async function revealToPerson(targetId: string, kind: RevealKind, custom: string) {
    if (!viewerId || !myRole) return
    const text = revealText(kind, myRole, custom)
    if (!text) return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      authorId: viewerId,
      text,
      day: session.day,
      createdAtMs: Date.now(),
      kind: 'reveal',
      revealKind: kind,
    }
    await sendDirectMessage(viewerId, targetId, message)
    await logReveal({
      id: crypto.randomUUID(),
      actorId: viewerId,
      revealKind: kind,
      scope: 'person',
      targetId,
      day: session.day,
      createdAtMs: Date.now(),
    })
  }

  async function revealToClass(kind: RevealKind, custom: string) {
    if (!viewerId || !myRole) return
    const text = revealText(kind, myRole, custom)
    if (!text) return
    await postGroupChatMessage({
      id: crypto.randomUUID(),
      authorId: viewerId,
      text,
      day: session.day,
      createdAtMs: Date.now(),
      kind: 'reveal',
      revealKind: kind,
    })
    await logReveal({
      id: crypto.randomUUID(),
      actorId: viewerId,
      revealKind: kind,
      scope: 'class',
      targetId: null,
      day: session.day,
      createdAtMs: Date.now(),
    })
  }

  async function performAction(kind: ActionKind, targetId: string | null, text: string | null) {
    if (!viewerId) return
    const spec = actionByKind[kind]
    await logSchoolAction({
      id: crypto.randomUUID(),
      day: session.day,
      kind,
      actorId: viewerId,
      targetId,
      text,
      visibility: spec.visibility,
      createdAtMs: Date.now(),
    })
    if (spec.visibility === 'public' && text) {
      await sendGroupChat(text)
    }
  }

  async function spreadRumor(targetId: string, text: string, parentRumorId: string | null) {
    if (!viewerId) return
    const parent = parentRumorId ? session.rumors.find((r) => r.id === parentRumorId) : null
    const rumor: RumorEntry = parent ? retellRumor(parent, text, viewerId) : createOriginRumor(text, viewerId)
    await addSchoolRumor(rumor)
    await performAction('spreadRumor', targetId, text)
  }

  async function castVote(targetId: string, category: VoteCategory) {
    if (!viewerId || viewerId === targetId) return
    if (myVotesToday[category] !== null) return
    await castSchoolVote({
      id: crypto.randomUUID(),
      day: session.day,
      category,
      voterId: viewerId,
      targetId,
      createdAtMs: Date.now(),
    })
  }

  async function submitHiddenGoalResolution(text: string) {
    if (!viewerId) return
    await setHiddenGoalResolutionSync(viewerId, text)
  }

  async function chooseEnding(key: EndingKey, note: string | null) {
    if (!viewerId) return
    await setPlayerEnding(viewerId, key, note)
  }

  const value: SchoolGameValue = {
    ready: sessionLoaded && playersLoaded,
    viewerId,
    nickname,
    isHost,
    session,
    players,
    myPlayer,
    myRole,
    relationshipMatrix,
    otherPlayerIds,
    roleAcked,
    acknowledgeRole,
    joinAsPlayer,
    loginAsHost,
    logout,
    hostAssignRoles,
    hostRemovePlayer,
    hostAdvanceDay,
    hostSetEventCard,
    hostEndGame,
    hostResetSession,
    sendGroupChat,
    dmThreads,
    dmWith,
    sendDm,
    revealToPerson,
    revealToClass,
    performAction,
    spreadRumor,
    myMissionProgress,
    myVotesToday,
    castVote,
    submitHiddenGoalResolution,
    chooseEnding,
  }

  return <SchoolGameContext.Provider value={value}>{children}</SchoolGameContext.Provider>
}
