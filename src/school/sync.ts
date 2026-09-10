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
  applyRetoldRumor,
  applyVote,
  assignTeams,
  breakAlliance,
  dailyRollover,
  grantLeverage,
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
  releaseFragment,
  respondAlliance,
  respondTrade,
  spendLeverage,
  withdrawTrade,
} from './engine/territory'
import type { Standing } from './engine/territory'
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
  VoteCategory,
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
  mapFragments: [],
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

/**
 * 공개는 거래다. 털어놓은 쪽은 그 자리에서 영향력을 얻지만(취약함이 관계를 만든다),
 * 들은 쪽은 그 사람의 약점을 손에 쥔다. 반 전체에 공개하면 더 크게 얻고, 더 많이 잡힌다.
 */
export async function logReveal(entry: RevealLogEntry, audienceIds: string[]): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const [sessionSnap, actorSnap] = await Promise.all([tx.get(sessionRef()), tx.get(playerRef(entry.actorId))])
    const current: SchoolSessionState = { ...emptySession, ...(sessionSnap.data() as Partial<SchoolSessionState>) }
    const actor = actorSnap.data() as PlayerProfile | undefined

    let territory = current.territory
    // 숨긴 사실을 밝힌 경우에만 약점이 생긴다. 역할이나 직접 쓴 글은 약점이 되지 않는다.
    if (entry.revealKind === 'privateFact') {
      for (const listenerId of audienceIds) {
        territory = grantLeverage(territory, listenerId, entry.actorId, 'reveal', entry.day)
      }
      if (actor?.teamId) {
        const gain = entry.scope === 'class' ? 6 : 3
        territory = {
          ...territory,
          teams: {
            ...territory.teams,
            [actor.teamId]: {
              ...territory.teams[actor.teamId],
              resources: {
                ...territory.teams[actor.teamId].resources,
                influence: territory.teams[actor.teamId].resources.influence + gain,
              },
            },
          },
        }
      }
    }
    tx.update(sessionRef(), { revealLog: arrayUnion(entry), territory })
  })
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

const TEST_NAMES = [
  '지우', '서연', '민준', '하윤', '도윤', '시우', '예린',
  '주원', '다은', '건우', '수아', '지호', '유나',
]

/**
 * QA 전용: 사람이 모자랄 때 명단을 채운다. 실제 사람 수를 세서 목표 인원까지만 채우고,
 * 넣은 참가자에는 isBot 표시를 남겨 나중에 한 번에 뺄 수 있게 한다.
 */
export async function seedTestPlayers(targetCount: number): Promise<number> {
  const snap = await getDocs(playersCol())
  const current = snap.docs.map((d) => d.data() as PlayerProfile).filter((p) => !p.isHost)
  const missing = Math.max(0, targetCount - current.length)
  if (missing === 0) return 0

  const taken = new Set(current.map((p) => p.nickname))
  const available = TEST_NAMES.filter((n) => !taken.has(n))
  const now = Date.now()

  await Promise.all(
    Array.from({ length: missing }, (_, i) => {
      const nickname = available[i] ?? `테스트${i + 1}`
      const profile: PlayerProfile = {
        id: `bot-${now}-${i}`,
        nickname,
        joinedAtMs: now + i,
        roleId: null,
        teamId: null,
        isHost: false,
        isBot: true,
        hiddenGoalResolution: null,
        endingKey: null,
        endingNote: null,
      }
      return setDoc(playerRef(profile.id), profile)
    }),
  )
  return missing
}

/** QA 전용: 테스트로 넣은 참가자만 골라 뺀다. 실제 사람은 건드리지 않는다. */
export async function removeTestPlayers(): Promise<number> {
  const snap = await getDocs(playersCol())
  const bots = snap.docs.filter((d) => (d.data() as PlayerProfile).isBot)
  await Promise.all(bots.map((d) => removeSchoolPlayer(d.id)))
  return bots.length
}

/**
 * QA 전용: 테스트 참가자들이 오늘 몫의 신뢰·호감·의심표를 한 번에 던진다.
 * 영향력이 오직 표로만 들어오는 판이라, 이게 없으면 혼자서는 확장 이후를 시험할 수 없다.
 * 표와 영향력 변동을 한 트랜잭션에 몰아 넣어 둘이 어긋나지 않게 한다.
 */
export async function simulateBotVotes(day: number): Promise<number> {
  const snap = await getDocs(playersCol())
  const everyone = snap.docs
    .map((d) => d.data() as PlayerProfile)
    .filter((p) => !p.isHost && p.teamId !== null)
  const bots = everyone.filter((p) => p.isBot)
  if (bots.length === 0) return 0

  let cast = 0
  await runTransaction(requireDb(), async (tx) => {
    const sessionSnap = await tx.get(sessionRef())
    const current: SchoolSessionState = { ...emptySession, ...(sessionSnap.data() as Partial<SchoolSessionState>) }
    let territory = current.territory
    const votes = [...current.votes]
    cast = 0

    for (const bot of bots) {
      for (const category of ['trust', 'liking', 'suspicion'] as VoteCategory[]) {
        const already = votes.some((v) => v.voterId === bot.id && v.day === day && v.category === category)
        if (already) continue
        // 같은 팀에는 줄 수 없다 — 사람이 지키는 규칙을 봇도 그대로 지킨다.
        const candidates = everyone.filter((p) => p.teamId !== bot.teamId)
        if (candidates.length === 0) continue
        const target = candidates[Math.floor(Math.random() * candidates.length)]
        const entry: VoteEntry = {
          id: crypto.randomUUID(),
          day,
          category,
          voterId: bot.id,
          targetId: target.id,
          createdAtMs: Date.now(),
        }
        territory = applyVote(territory, entry, bot.teamId as TeamId, target.teamId as TeamId, target.roleId)
        votes.push(entry)
        cast += 1
      }
    }
    tx.update(sessionRef(), { votes, territory })
  })
  return cast
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
  // 「지정된 한 사람」이 필요한 미션(피해야 할 상대, 몰래 만나야 할 상대)의 대상을 함께 뽑는다.
  // 자기 자신은 뽑히지 않게만 하고, 나머지는 무작위로 준다.
  const targetAssignment: Record<string, string> = {}
  for (const playerId of playerIds) {
    const others = playerIds.filter((id) => id !== playerId)
    targetAssignment[playerId] = others[Math.floor(Math.random() * others.length)]
  }
  await runTransaction(requireDb(), async (tx) => {
    for (const playerId of playerIds) {
      tx.update(playerRef(playerId), {
        roleId: roleAssignment[playerId],
        teamId: teamAssignment[playerId],
        assignedTargetId: targetAssignment[playerId],
      })
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
 * 그 날의 건물 생산·행동력 재충전·만료된 견제와 족쇄 정리(dailyRollover)를 함께 처리한다.
 */
export async function advanceSchoolDay(nextDay: number, eventCard: string | null): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(sessionRef())
    const current: SchoolSessionState = { ...emptySession, ...(snap.data() as Partial<SchoolSessionState>) }
    const territory = current.phase === 'day' ? dailyRollover(current.territory, current.day) : current.territory
    tx.update(sessionRef(), {
      day: nextDay,
      activeEventCard: eventCard,
      phase: 'day' satisfies GamePhase,
      territory,
    })
  })
}

/** 진행자 전용: 그날의 A의 기록을 반 전체에 연다. 구역이 열리고, 지목된 구역의 가치가 오른다. */
export async function releaseSchoolFragment(day: number): Promise<void> {
  await runTerritoryAction((t) => releaseFragment(t, day))
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

/**
 * 소문은 옮겨질 때 값이 생긴다. 처음 꺼낸 사람은 그냥 말한 것이지만,
 * 두 번째 사람부터는 그 사람 팀의 영향력을 실제로 깎는다.
 */
export async function addSchoolRumor(rumor: RumorEntry): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const sessionSnap = await tx.get(sessionRef())
    const current: SchoolSessionState = { ...emptySession, ...(sessionSnap.data() as Partial<SchoolSessionState>) }

    let territory = current.territory
    if (rumor.parentRumorId !== null && rumor.aboutId) {
      const aboutSnap = await tx.get(playerRef(rumor.aboutId))
      const about = aboutSnap.data() as PlayerProfile | undefined
      if (about?.teamId) territory = applyRetoldRumor(territory, about.teamId)
    }
    tx.update(sessionRef(), { rumors: arrayUnion(rumor), territory })
  })
}

/**
 * 표를 던지면 그 자리에서 영향력이 움직인다. 표 기록과 영향력 변동은 반드시
 * 같은 트랜잭션 안에서 처리해야 둘이 어긋나지 않는다.
 */
export async function castSchoolVote(entry: VoteEntry): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const [sessionSnap, voterSnap, targetSnap] = await Promise.all([
      tx.get(sessionRef()),
      tx.get(playerRef(entry.voterId)),
      tx.get(playerRef(entry.targetId)),
    ])
    const current: SchoolSessionState = { ...emptySession, ...(sessionSnap.data() as Partial<SchoolSessionState>) }
    const voter = voterSnap.data() as PlayerProfile | undefined
    const target = targetSnap.data() as PlayerProfile | undefined
    if (!voter?.teamId || !target?.teamId) throw new Error('아직 팀이 정해지지 않았다.')
    if (voter.teamId === target.teamId) throw new Error('같은 팀에는 표를 줄 수 없다.')
    const already = current.votes.some(
      (v) => v.voterId === entry.voterId && v.day === entry.day && v.category === entry.category,
    )
    if (already) throw new Error('오늘 그 표는 이미 썼다.')

    const territory = applyVote(current.territory, entry, voter.teamId, target.teamId, target.roleId)
    tx.update(sessionRef(), { votes: arrayUnion(entry), territory })
  })
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

export async function territoryExpand(
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performExpand(t, day, team, playerId, tileId, standing))
}

export async function territoryBuild(
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performBuild(t, day, team, playerId, tileId, kind, standing))
}

export async function territoryUpgrade(
  day: number,
  team: TeamId,
  playerId: string,
  tileId: TileId,
  kind: BuildingKind,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performUpgrade(t, day, team, playerId, tileId, kind, standing))
}

export async function territoryResearch(
  day: number,
  team: TeamId,
  playerId: string,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performResearch(t, day, team, playerId, standing))
}

export async function territoryExplore(
  day: number,
  team: TeamId,
  playerId: string,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performExplore(t, day, team, playerId, standing))
}

export async function territoryProduce(
  day: number,
  team: TeamId,
  playerId: string,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performProduce(t, day, team, playerId, standing))
}

export async function territorySabotage(
  day: number,
  team: TeamId,
  playerId: string,
  targetTeam: TeamId,
  kind: SabotageEffectKind,
  standing: Standing,
): Promise<void> {
  await runTerritoryAction((t) => performSabotage(t, day, team, playerId, targetTeam, kind, standing))
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

/** 쥐고 있던 약점을 쓴다. 상대가 어느 팀인지 알아야 해서 플레이어 문서를 함께 읽는다. */
export async function territorySpendLeverage(
  day: number,
  holderId: string,
  holderTeam: TeamId,
  leverageId: string,
  aboutId: string,
  mode: 'block' | 'extort',
): Promise<void> {
  await runTransaction(requireDb(), async (tx) => {
    const [sessionSnap, aboutSnap] = await Promise.all([tx.get(sessionRef()), tx.get(playerRef(aboutId))])
    const current: SchoolSessionState = { ...emptySession, ...(sessionSnap.data() as Partial<SchoolSessionState>) }
    const about = aboutSnap.data() as PlayerProfile | undefined
    if (!about?.teamId) throw new Error('상대가 아직 팀에 없다.')
    const territory = spendLeverage(current.territory, day, leverageId, holderId, mode, holderTeam, about.teamId)
    tx.update(sessionRef(), { territory })
  })
}

/** 진행자 전용: 다음 회차를 위해 세션·참가자·대화방을 모두 지운다. */
export async function resetSchoolSession(): Promise<void> {
  const [players, threads] = await Promise.all([getDocs(playersCol()), getDocs(dmCol())])
  await Promise.all([...players.docs, ...threads.docs].map((d) => deleteDoc(d.ref)))
  await setDoc(sessionRef(), { ...emptySession, createdAtMs: Date.now() })
}
