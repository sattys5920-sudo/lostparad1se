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
import { assignRoles } from './engine/setup'
import {
  assignTeams,
  breakAlliance,
  dailyRollover,
  initialTerritoryState,
  performBuild,
  performExpand,
  performExplore,
  performProduce,
  performResearch,
  performSabotage,
  performUpgrade,
  playCard,
  proposeAlliance,
  proposeTrade,
  respondAlliance,
  respondTrade,
  withdrawTrade,
} from './engine/territory'
import type {
  ActionLogEntry,
  BuildingKind,
  ChatMessage,
  DmThread,
  GamePhase,
  PlayerProfile,
  ResourceBundle,
  RevealLogEntry,
  RumorEntry,
  SabotageEffectKind,
  SchoolSessionState,
  TeamId,
  TerritoryState,
  TileId,
  VoteEntry,
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
  votes: [],
  activeEventCard: null,
  territory: initialTerritoryState(),
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
    teamId: null,
    isHost,
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

/** 진행자 전용: 지금 모인 인원으로 역할과 팀을 자동 배정하고 역할 공개 단계로 넘긴다. */
export async function assignRolesAndReveal(playerIds: string[]): Promise<void> {
  const roleAssignment = assignRoles(playerIds)
  const teamAssignment = assignTeams(playerIds)
  await runTransaction(requireDb(), async (tx) => {
    for (const playerId of playerIds) {
      tx.update(playerRef(playerId), { roleId: roleAssignment[playerId], teamId: teamAssignment[playerId] })
    }
    tx.update(sessionRef(), {
      rolesAssigned: true,
      phase: 'roleReveal' satisfies GamePhase,
      territory: initialTerritoryState(),
    })
  })
}

export async function setSchoolPhase(phase: GamePhase): Promise<void> {
  await updateDoc(sessionRef(), { phase })
}

/**
 * 다음 날로 넘어간다. 이미 진행 중이던 날(phase가 'day')에서 넘어가는 것이라면
 * 그 날의 건물 생산·행동력 재충전·만료된 견제 효과 정리(dailyRollover)를 함께 처리한다.
 * teamMemberCounts는 팀별 행동력을 팀원 수만큼 재충전하기 위해 필요하다(클라이언트가 이미 들고 있는 값).
 */
export async function advanceSchoolDay(
  nextDay: number,
  eventCard: string | null,
  teamMemberCounts: Record<TeamId, number>,
): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(sessionRef())
    const current: SchoolSessionState = { ...emptySession, ...(snap.data() as Partial<SchoolSessionState>) }
    const territory =
      current.phase === 'day' ? dailyRollover(current.territory, current.day, teamMemberCounts) : current.territory
    tx.update(sessionRef(), {
      day: nextDay,
      activeEventCard: eventCard,
      phase: 'day' satisfies GamePhase,
      territory,
    })
  })
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

export async function castSchoolVote(entry: VoteEntry): Promise<void> {
  await updateDoc(sessionRef(), { votes: arrayUnion(entry) })
}

export async function setHiddenGoalResolution(playerId: string, text: string): Promise<void> {
  await updateDoc(playerRef(playerId), { hiddenGoalResolution: text })
}

export async function setPlayerEnding(playerId: string, endingKey: string, endingNote: string | null): Promise<void> {
  await updateDoc(playerRef(playerId), { endingKey, endingNote })
}

async function runTerritoryAction(mutate: (territory: TerritoryState) => TerritoryState): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(sessionRef())
    const current: SchoolSessionState = { ...emptySession, ...(snap.data() as Partial<SchoolSessionState>) }
    const territory = mutate(current.territory)
    tx.update(sessionRef(), { territory })
  })
}

export async function territoryExpand(day: number, team: TeamId, playerId: string, tileId: TileId): Promise<void> {
  await runTerritoryAction((t) => performExpand(t, day, team, playerId, tileId))
}

export async function territoryBuild(
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
): Promise<void> {
  await runTerritoryAction((t) => performBuild(t, day, team, playerId, tileId, kind))
}

export async function territoryUpgrade(
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
): Promise<void> {
  await runTerritoryAction((t) => performUpgrade(t, day, team, playerId, tileId, kind))
}

export async function territoryResearch(day: number, team: TeamId, playerId: string): Promise<void> {
  await runTerritoryAction((t) => performResearch(t, day, team, playerId))
}

export async function territoryExplore(day: number, team: TeamId, playerId: string): Promise<void> {
  await runTerritoryAction((t) => performExplore(t, day, team, playerId))
}

export async function territoryProduce(day: number, team: TeamId, playerId: string): Promise<void> {
  await runTerritoryAction((t) => performProduce(t, day, team, playerId))
}

export async function territorySabotage(
  day: number,
  team: TeamId,
  playerId: string,
  targetTeam: TeamId,
  kind: SabotageEffectKind,
): Promise<void> {
  await runTerritoryAction((t) => performSabotage(t, day, team, playerId, targetTeam, kind))
}

export async function territoryPlayCard(
  day: number,
  team: TeamId,
  playerId: string,
  cardId: string,
  targetTeam: TeamId | null,
): Promise<void> {
  await runTerritoryAction((t) => playCard(t, day, team, playerId, cardId, targetTeam))
}

export async function territoryProposeTrade(
  day: number,
  fromTeam: TeamId,
  toTeam: TeamId,
  offer: Partial<ResourceBundle>,
  request: Partial<ResourceBundle>,
  message: string | null,
): Promise<void> {
  await runTerritoryAction((t) => proposeTrade(t, day, fromTeam, toTeam, offer, request, message))
}

export async function territoryRespondTrade(proposalId: string, accept: boolean): Promise<void> {
  await runTerritoryAction((t) => respondTrade(t, proposalId, accept))
}

export async function territoryWithdrawTrade(proposalId: string): Promise<void> {
  await runTerritoryAction((t) => withdrawTrade(t, proposalId))
}

export async function territoryProposeAlliance(day: number, teamA: TeamId, teamB: TeamId): Promise<void> {
  await runTerritoryAction((t) => proposeAlliance(t, day, teamA, teamB))
}

export async function territoryRespondAlliance(allianceId: string, accept: boolean): Promise<void> {
  await runTerritoryAction((t) => respondAlliance(t, allianceId, accept))
}

export async function territoryBreakAlliance(allianceId: string): Promise<void> {
  await runTerritoryAction((t) => breakAlliance(t, allianceId))
}

/** 진행자 전용: 다음 회차를 위해 세션·참가자·대화방을 모두 지운다. */
export async function resetSchoolSession(): Promise<void> {
  const [players, threads] = await Promise.all([getDocs(playersCol()), getDocs(dmCol())])
  await Promise.all([...players.docs, ...threads.docs].map((d) => deleteDoc(d.ref)))
  await setDoc(sessionRef(), { ...emptySession, createdAtMs: Date.now() })
}
