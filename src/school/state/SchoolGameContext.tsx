import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { roleById } from '../data/roles'
import { actionByKind } from '../data/actions'
import { computeRelationshipMatrix, type RelationshipMatrix } from '../engine/relationships'
import { createOriginRumor, retellRumor } from '../engine/rumors'
import { revealText } from '../engine/reveals'
import { evaluateMission, type MissionItemProgress } from '../engine/missionProgress'
import {
  actionsUsedToday,
  hasPlayerActedToday,
  initialTerritoryState,
  MAX_ACTIONS_PER_PLAYER,
} from '../engine/territory'
import { scorePlayer } from '../engine/playerScore'
import { fragmentByDay } from '../data/fragments'
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
  releaseSchoolFragment,
  removeTestPlayers,
  seedTestPlayers,
  simulateBotVotes,
  subscribeSchoolPlayers,
  subscribeSchoolSession,
  territoryBreakAlliance,
  territoryBuild,
  territoryExpand,
  territoryExplore,
  territoryPlayCard,
  territoryProduce,
  territoryProposeAlliance,
  territoryProposeTrade,
  territoryRespondAlliance,
  territoryRespondTrade,
  territoryResearch,
  territorySabotage,
  territorySpendLeverage,
  territoryUpgrade,
  territoryWithdrawTrade,
} from '../sync'
import type {
  ActionKind,
  BuildingKind,
  ChatMessage,
  DmThread,
  EndingKey,
  FragmentSpec,
  LeverageToken,
  PlayerProfile,
  PlayerScoreBreakdown,
  ResourceBundle,
  RevealKind,
  RoleSpec,
  RumorEntry,
  SabotageEffectKind,
  SchoolSessionState,
  TeamId,
  TeamState,
  TileId,
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
  territory: initialTerritoryState(),
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
  /** QA 전용: 사람이 모자랄 때 명단을 목표 인원까지 채운다. 넣은 수를 돌려준다. */
  hostSeedTestPlayers: (targetCount: number) => Promise<number>
  /** QA 전용: 테스트로 넣은 참가자만 뺀다. 뺀 수를 돌려준다. */
  hostRemoveTestPlayers: () => Promise<number>
  /** QA 전용: 테스트 참가자들이 오늘 몫의 표를 던진다. 던진 표 수를 돌려준다. */
  hostSimulateBotVotes: () => Promise<number>
  /** 테스트로 채워 넣은 참가자 수. */
  botCount: number
  myTeamId: TeamId | null
  myTeam: TeamState | null
  teammateIds: string[]
  /** 오늘 내가 쓸 수 있는 영역 행동을 다 썼는지. */
  hasActedToday: boolean
  /** 오늘 남은 내 영역 행동 횟수. */
  actionsLeftToday: number
  /** 약점을 잡혀 오늘 아무것도 못 하는 상태인지. */
  amBlockedToday: boolean
  /** 오늘 열린 A의 기록. 진행자가 아직 열지 않았으면 null. */
  todaysFragment: FragmentSpec | null
  /** 지금까지 열린 A의 기록 전부. */
  releasedFragments: FragmentSpec[]
  hostReleaseFragment: (day: number) => Promise<void>
  /** 내가 쥐고 있는, 아직 쓰지 않은 약점들. */
  myLeverage: LeverageToken[]
  spendLeverageOn: (leverageId: string, aboutId: string, mode: 'block' | 'extort') => Promise<void>
  /** 내 개인 점수. 팀 승패와 별개로 남는다. */
  myScore: PlayerScoreBreakdown | null
  doExpand: (tileId: TileId) => Promise<void>
  doBuild: (tileId: TileId, kind: BuildingKind) => Promise<void>
  doUpgrade: (tileId: TileId, kind: BuildingKind) => Promise<void>
  doResearch: () => Promise<void>
  doExplore: () => Promise<void>
  doProduce: () => Promise<void>
  doSabotage: (targetTeam: TeamId, kind: SabotageEffectKind) => Promise<void>
  doPlayCard: (cardId: string, targetTeam: TeamId | null) => Promise<void>
  doProposeTrade: (
    toTeam: TeamId,
    offer: Partial<ResourceBundle>,
    request: Partial<ResourceBundle>,
    message: string | null,
  ) => Promise<void>
  doRespondTrade: (proposalId: string, accept: boolean) => Promise<void>
  doWithdrawTrade: (proposalId: string) => Promise<void>
  doProposeAlliance: (teamB: TeamId) => Promise<void>
  doRespondAlliance: (allianceId: string, accept: boolean) => Promise<void>
  doBreakAlliance: (allianceId: string) => Promise<void>
  sendGroupChat: (text: string) => Promise<void>
  dmThreads: Record<string, DmThread>
  dmWith: (otherId: string) => ChatMessage[]
  sendDm: (targetId: string, text: string) => Promise<void>
  revealToPerson: (targetId: string, kind: RevealKind, custom: string) => Promise<void>
  revealToClass: (kind: RevealKind, custom: string) => Promise<void>
  performAction: (kind: ActionKind, targetId: string | null, text: string | null) => Promise<void>
  spreadRumor: (
    targetId: string,
    text: string,
    parentRumorId: string | null,
    aboutId?: string | null,
  ) => Promise<void>
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
      territory: session.territory,
    })
  }, [
    viewerId,
    myRole,
    session.actionLog,
    session.revealLog,
    session.rumors,
    session.votes,
    session.territory,
    dmThreads,
  ])

  const myVotesToday = useMemo<Record<VoteCategory, string | null>>(() => {
    const findTarget = (category: VoteCategory) =>
      session.votes.find((v) => v.voterId === viewerId && v.day === session.day && v.category === category)
        ?.targetId ?? null
    return { trust: findTarget('trust'), liking: findTarget('liking'), suspicion: findTarget('suspicion') }
  }, [session.votes, session.day, viewerId])

  const botCount = useMemo(() => Object.values(players).filter((p) => p.isBot).length, [players])

  const myTeamId = myPlayer?.teamId ?? null
  const myTeam = myTeamId ? session.territory.teams[myTeamId] : null
  const teammateIds = useMemo(
    () => Object.values(players).filter((p) => p.teamId && p.teamId === myTeamId).map((p) => p.id),
    [players, myTeamId],
  )
  const actionsLeftToday = viewerId
    ? Math.max(0, MAX_ACTIONS_PER_PLAYER - actionsUsedToday(session.territory, session.day, viewerId))
    : 0
  const hasActedToday = Boolean(viewerId) && hasPlayerActedToday(session.territory, session.day, viewerId as string)
  const amBlockedToday = Boolean(viewerId) && session.territory.blockedPlayerIds.includes(viewerId as string)

  /** 오늘 열린 A의 기록. 아직 진행자가 열지 않았으면 null. */
  const todaysFragment = useMemo(
    () => (session.territory.releasedFragments.includes(session.day) ? (fragmentByDay[session.day] ?? null) : null),
    [session.territory.releasedFragments, session.day],
  )
  const releasedFragments = useMemo(
    () =>
      [...session.territory.releasedFragments]
        .sort((a, b) => a - b)
        .map((d) => fragmentByDay[d])
        .filter((f): f is FragmentSpec => Boolean(f)),
    [session.territory.releasedFragments],
  )

  /** 내가 쥐고 있는, 아직 쓰지 않은 약점들. */
  const myLeverage = useMemo(
    () => session.territory.leverage.filter((l) => l.holderId === viewerId && l.spentAs === null),
    [session.territory.leverage, viewerId],
  )

  const myScore = useMemo<PlayerScoreBreakdown | null>(
    () => (viewerId ? scorePlayer(viewerId, myMissionProgress, session.votes, session.territory) : null),
    [viewerId, myMissionProgress, session.votes, session.territory],
  )

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

  async function hostReleaseFragment(day: number) {
    await releaseSchoolFragment(day)
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

  async function hostSeedTestPlayers(targetCount: number) {
    return seedTestPlayers(targetCount)
  }

  async function hostRemoveTestPlayers() {
    return removeTestPlayers()
  }

  async function hostSimulateBotVotes() {
    return simulateBotVotes(session.day)
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
    // 들은 사람만 내 약점을 쥔다.
    await logReveal(
      {
        id: crypto.randomUUID(),
        actorId: viewerId,
        revealKind: kind,
        scope: 'person',
        targetId,
        day: session.day,
        createdAtMs: Date.now(),
      },
      [targetId],
    )
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
    // 반 전체에 털어놓으면 영향력을 크게 얻지만, 모두가 내 약점을 쥐게 된다.
    await logReveal(
      {
        id: crypto.randomUUID(),
        actorId: viewerId,
        revealKind: kind,
        scope: 'class',
        targetId: null,
        day: session.day,
        createdAtMs: Date.now(),
      },
      otherPlayerIds.filter((id) => !players[id]?.isHost),
    )
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

  /**
   * targetId는 이 이야기를 들려주는 상대, aboutId는 이야기의 대상이다.
   * 옮겨진 소문은 대상이 속한 팀의 영향력을 실제로 깎는다.
   */
  async function spreadRumor(
    targetId: string,
    text: string,
    parentRumorId: string | null,
    aboutId: string | null = null,
  ) {
    if (!viewerId) return
    const parent = parentRumorId ? session.rumors.find((r) => r.id === parentRumorId) : null
    const rumor: RumorEntry = parent ? retellRumor(parent, text, viewerId) : createOriginRumor(text, viewerId, aboutId)
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

  async function spendLeverageOn(leverageId: string, aboutId: string, mode: 'block' | 'extort') {
    if (!viewerId || !myTeamId) throw new Error('팀에 배정되지 않았다.')
    await territorySpendLeverage(session.day, viewerId, myTeamId, leverageId, aboutId, mode)
  }

  async function submitHiddenGoalResolution(text: string) {
    if (!viewerId) return
    await setHiddenGoalResolutionSync(viewerId, text)
  }

  async function chooseEnding(key: EndingKey, note: string | null) {
    if (!viewerId) return
    await setPlayerEnding(viewerId, key, note)
  }

  function requireTeamContext(): { day: number; team: TeamId; playerId: string } {
    if (!viewerId || !myTeamId) throw new Error('팀에 배정되지 않았다.')
    return { day: session.day, team: myTeamId, playerId: viewerId }
  }

  async function doExpand(tileId: TileId) {
    const { day, team, playerId } = requireTeamContext()
    await territoryExpand(day, team, playerId, tileId)
  }

  async function doBuild(tileId: TileId, kind: BuildingKind) {
    const { day, team, playerId } = requireTeamContext()
    await territoryBuild(day, team, playerId, tileId, kind)
  }

  async function doUpgrade(tileId: TileId, kind: BuildingKind) {
    const { day, team, playerId } = requireTeamContext()
    await territoryUpgrade(day, team, playerId, tileId, kind)
  }

  async function doResearch() {
    const { day, team, playerId } = requireTeamContext()
    await territoryResearch(day, team, playerId)
  }

  async function doExplore() {
    const { day, team, playerId } = requireTeamContext()
    await territoryExplore(day, team, playerId)
  }

  async function doProduce() {
    const { day, team, playerId } = requireTeamContext()
    await territoryProduce(day, team, playerId)
  }

  async function doSabotage(targetTeam: TeamId, kind: SabotageEffectKind) {
    const { day, team, playerId } = requireTeamContext()
    await territorySabotage(day, team, playerId, targetTeam, kind)
  }

  async function doPlayCard(cardId: string, targetTeam: TeamId | null) {
    const { day, team, playerId } = requireTeamContext()
    await territoryPlayCard(day, team, playerId, cardId, targetTeam)
  }

  async function doProposeTrade(
    toTeam: TeamId,
    offer: Partial<ResourceBundle>,
    request: Partial<ResourceBundle>,
    message: string | null,
  ) {
    const { day, team } = requireTeamContext()
    await territoryProposeTrade(day, team, toTeam, offer, request, message)
  }

  async function doRespondTrade(proposalId: string, accept: boolean) {
    await territoryRespondTrade(proposalId, accept)
  }

  async function doWithdrawTrade(proposalId: string) {
    await territoryWithdrawTrade(proposalId)
  }

  async function doProposeAlliance(teamB: TeamId) {
    const { day, team } = requireTeamContext()
    await territoryProposeAlliance(day, team, teamB)
  }

  async function doRespondAlliance(allianceId: string, accept: boolean) {
    await territoryRespondAlliance(allianceId, accept)
  }

  async function doBreakAlliance(allianceId: string) {
    await territoryBreakAlliance(allianceId)
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
    hostSeedTestPlayers,
    hostRemoveTestPlayers,
    hostSimulateBotVotes,
    botCount,
    myTeamId,
    myTeam,
    teammateIds,
    hasActedToday,
    actionsLeftToday,
    amBlockedToday,
    todaysFragment,
    releasedFragments,
    hostReleaseFragment,
    myLeverage,
    spendLeverageOn,
    myScore,
    doExpand,
    doBuild,
    doUpgrade,
    doResearch,
    doExplore,
    doProduce,
    doSabotage,
    doPlayCard,
    doProposeTrade,
    doRespondTrade,
    doWithdrawTrade,
    doProposeAlliance,
    doRespondAlliance,
    doBreakAlliance,
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
