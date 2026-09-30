// views를 다시 만들어 쓴다.
//
// 무엇을 담을지는 shared/rules/views.ts가 정한다. 여기서는 세상을
// 긁어모아 넘기고 결과를 받아 적을 뿐이다. 판단을 여기서 하면 시험할
// 수 없는 자리에 누출 방지 규칙이 놓인다.
//
// 상태가 바뀐 뒤에는 언제나 이걸 부른다. 안 부르면 화면이 어제 것을
// 본다 — 틀린 안개는 새는 안개다.
import { getFirestore } from 'firebase-admin/firestore'

import { projectAll, type World, type WorldPawn } from '../../shared/rules/views'
import type { TileId } from '../../shared/rules/board'
import type { FlagMap } from '../../shared/rules/flag'
import type { TeamId } from '../../shared/rules/v2'
import type {
  GameDoc,
  NoticeDoc,
  PawnDoc,
  RosterDoc,
  TeamDoc,
  TileDoc,
} from '../../shared/model'
import { releasedDays } from '../../shared/reveal/release'
import { purseOf } from '../../shared/rules/resources'
import { fillSubject } from '../../shared/reveal/slips'
import type { SlipDoc } from './slips'
import { dropCellsIn } from '../../shared/rules/quiz'
import { SLIP_NOTE_BY_ID } from './story/slipNotes'
import { canonRoleId } from '../../shared/missions/roleNames'
import type { QuizDoc, QuizPaperDoc } from './quiz'
import { errandWorld } from './errand'
import { gardenWorld } from './garden'
import { trapWorld } from './trap'
import { gameRef, nowOf } from './index'

const db = getFirestore()

/** 아침 시퀀스를 어디까지 봤는가. secret에 둔다 — 남이 알 일이 아니다. */
export interface ProgressDoc {
  playerId: string
  handledDays: number[]
  readDays: number[]
}

/** 먼저 가져간 팀만 아는 A의 기억. */
export interface MemoryDoc {
  tileId: TileId
  team: 'A' | 'B' | 'C' | 'D'
  atMs: number
}

const sub = (gameId: string, name: string) => gameRef(gameId).collection(name)
const secret = (gameId: string, name: string) =>
  gameRef(gameId).collection('secret').doc(name).collection('items')

/** Firestore에서 세상을 긁어모은다. */
export async function loadWorld(gameId: string, game: GameDoc): Promise<World> {
  const nowMs = nowOf(game)
  const [hiddenPhase, pawns, teams, tiles, robots, made, roster, peeks, choices, progress, memories, slips, ballots, quizBank, quizFloor, shopStock, errands, garden, awakened, notices, traps, flagDoc, endingSeen] =
    await Promise.all([
      gameRef(gameId).collection('secret').doc('phase').get(),
      sub(gameId, 'pawns').get(),
      sub(gameId, 'teams').get(),
      sub(gameId, 'tiles').get(),
      sub(gameId, 'robots').get(),
      sub(gameId, 'made').get(),
      secret(gameId, 'roster').get(),
      secret(gameId, 'peeks').get(),
      secret(gameId, 'choices').get(),
      secret(gameId, 'progress').get(),
      secret(gameId, 'memories').get(),
      secret(gameId, 'slips').get(),
      gameRef(gameId).collection('secret').doc('ballots').collection('items').get(),
      gameRef(gameId).collection('secret').doc('quiz').collection('bank').get(),
      gameRef(gameId).collection('secret').doc('quiz').collection('floor').get(),
      gameRef(gameId).collection('secret').doc('shopStock').collection('items').get(),
      errandWorld(gameId),
      gardenWorld(gameId),
      secret(gameId, 'awakened').get(),
      sub(gameId, 'notices').get(),
      trapWorld(gameId),
      gameRef(gameId).collection('secret').doc('flags').get(),
      secret(gameId, 'endingSeen').get(),
    ])

  const rosterRows = roster.docs.map((d) => d.data() as RosterDoc)

  const worldPawns: WorldPawn[] = pawns.docs.map((d) => {
    const p = d.data() as PawnDoc
    return {
      playerId: p.playerId,
      team: p.team,
      tileId: p.tileId,
      // 걷는 중이면 경로의 **앞 한 칸만** 담는다. 경로의 끝이 목적지라
      // 통째로 넘기면 안개가 있으나 마나다
      fromTile: p.tileId === null ? p.fromTile : null,
      toTile: p.tileId === null ? (p.path[0] ?? null) : null,
      asleep: p.asleep,
      // 방 안 어디에 서 있는가. 거래가 이것을 본다
      at: p.at ?? null,
      hiddenUntilMs: p.hiddenUntilMs ?? null,
      // 투영이 본인 몫에만 싣는다. 여기서는 그냥 들고만 간다
      arriveAtMs: p.arriveAtMs ?? null,
      busyUntilMs: p.busyUntilMs ?? null,
      busyKind: p.busyKind ?? null,
      postTile: p.postTile ?? null,
      visitedTiles: p.visitedTiles ?? [],
    }
  })

  return {
    nowMs,
    over: game.phase === 'finished',
    // 게시판에 붙은 것. **받은 사람 목록째로 들고 온다** — 투영이
    // 본인 것만 뗀다. 남이 무엇을 받았는지는 어느 몫에도 안 실린다
    errands: errands.posted.map((e) => ({
      id: e.id,
      boardId: e.boardId,
      thing: e.thing,
      icon: e.icon,
      from: e.from,
      to: e.to,
      coins: e.coins,
      limitMin: e.limitMin,
      text: e.text,
      cell: e.cell,
      postedMs: e.postedMs,
      takers: e.takers ?? {},
    })),
    // 팀 금고. **팀마다 하나다** — 투영이 우리 팀 것만 떼어 보낸다
    vaults: Object.fromEntries(teams.docs.map((d) => [d.id, purseOf(d.data() as TeamDoc)])),
    // 돈은 사람 것이다. 통째로 들고 가고 투영이 내 것만 떼어 보낸다
    moneyOf: Object.fromEntries(pawns.docs.map((d) => [d.id, Math.max(0, Number((d.data() as { money?: number }).money ?? 0))])),
    // 주머니도 통째로 들고 간다. **사람마다 하나다** — 투영이 내
    // 것만 떼어 보낸다
    satchels: Object.fromEntries(
      pawns.docs.map((d) => [d.id, (d.data() as { items?: Record<string, number> }).items ?? {}]),
    ),
    // 화분 여덟. **심은 것과 뽑아 둔 시간째로** 들고 가고, 투영이
    // 단계만 떼어 보낸다 — 무엇을 심었는지는 싹이 나야 나간다
    // 제조기 셋. 누가 맡겼는지째로 들고 가고, 투영이 「내 것 / 남의 것 /
    // 빈 것」으로 줄인다. 복도에 놓인 덫은 여기 없다
    trapJobs: traps.jobs.map((j) => ({ i: j.i, team: j.team, byPlayerId: j.byPlayerId, count: j.count, readyAtMs: j.readyAtMs, phaseNo: j.phaseNo })),
    openPhaseNo: game.phaseNow?.open ? game.phaseNow.no : null,
    pots: garden.pots.map((p) => ({
      i: p.i,
      cropId: p.cropId,
      plantedMs: p.plantedMs,
      growMs: p.growMs,
    })),
    crops: Object.fromEntries(
      pawns.docs.map((d) => [d.id, (d.data() as { crops?: Record<string, number> }).crops ?? {}]),
    ),
    // 페이즈 토큰 상자도 마찬가지다. 남의 상자는 투영에서 걸러진다
    wallets: Object.fromEntries(
      teams.docs.map((d) => [d.id, (d.data() as { phaseTokens?: number }).phaseTokens ?? 0]),
    ),
    // 자유 시간 상자. 팀에 남은 수와 사람마다 오늘 쓴 수가 같이 있다
    invisibleId: game.invisibleId ?? null,
    pawns: worldPawns,
    // 방마다 꽂힌 깃발. **secret 에서 여기까지만 온다** — 투영이
    // 보이는 방의 것만 떼어 보낸다
    flags: ((flagDoc.data() as { tiles?: FlagMap } | undefined)?.tiles ?? {}),
    // 깃발 상자. 토큰 상자처럼 투영이 자기 팀 것만 보낸다
    flagBoxes: Object.fromEntries(
      teams.docs.map((d) => {
        const t = d.data() as { flags?: number; boughtFlags?: number }
        return [d.id, (t.flags ?? 0) + (t.boughtFlags ?? 0)]
      }),
    ),
    smashedBy: ((hiddenPhase.data() as { smashedBy?: string[] } | undefined)?.smashedBy ?? []),
    // 연구 기계에 걸린 연구. 기계 번호가 없는 옛 줄은 안 싣는다
    labJobs: (((hiddenPhase.data() as { pendingResearch?: { machine?: number; playerId: string; doneAtMs?: number }[] } | undefined)?.pendingResearch ?? [])
      .filter((r) => typeof r.machine === 'number' && typeof r.doneAtMs === 'number')
      .map((r) => ({ machine: r.machine as number, byPlayerId: r.playerId, doneAtMs: r.doneAtMs as number }))),
    flagPullHits:
      (flagDoc.data() as { pulls?: Record<TileId, Partial<Record<TeamId, readonly string[]>>> } | undefined)
        ?.pulls ?? {},
    // 오늘 적은 표. **투영이 본인 것만 떼어 보낸다** — 여기까지는
    // 서버 안이라 전부 들고 있어도 된다
    myBallots: Object.fromEntries(
      ballots.docs
        .map((d) => d.data() as { day: number; voterId: string; targetId: string })
        .filter((b) => b.day === (game.phaseNow?.day ?? game.day))
        .map((b) => [b.voterId, b.targetId]),
    ),
    // 엔딩 송출을 사람마다 언제 봤나. **투영이 본인 것만 떼어 보낸다**
    endingSeen: Object.fromEntries(
      endingSeen.docs.map((d) => [d.id, (d.data() as { seenAtMs: number }).seenAtMs]),
    ),
    robots: robots.docs.map((d) => {
      const r = d.data() as { team: WorldPawn['team']; tileId: TileId; carriedBy: string | null; placedBy?: string | null }
      return { id: d.id, team: r.team, tileId: r.tileId, carriedBy: r.carriedBy ?? null, placedBy: r.placedBy ?? null }
    }),
    made: made.docs.map((d) => {
      const m = d.data() as { tileId: TileId; byPlayerId: string; phaseNo?: number; machine?: number }
      return { id: d.id, tileId: m.tileId, byPlayerId: m.byPlayerId, phaseNo: m.phaseNo, machine: m.machine }
    }),
    // 오늘 나간 수. **날짜가 지난 줄은 안 센다** — 어제 다 나간 것이
    // 오늘도 비어 보이면 기계가 영영 안 찬다
    shopSold: Object.fromEntries(
      shopStock.docs
        .map((d) => d.data() as { day?: number; itemId?: string; n?: number })
        .filter((r) => r.day === game.day && typeof r.itemId === 'string')
        .map((r) => [r.itemId as string, r.n ?? 0]),
    ),
    tiles: tiles.docs.map((d) => {
      const t = d.data() as TileDoc
      // **지난 자물쇠는 없는 것이다.** 문서에는 남아 있어도 시각이
      // 지났으면 안 담는다 — 지우러 다시 오는 일을 만들지 않는다
      const locked = t.lockedBy && (t.lockUntilMs ?? 0) > nowMs ? t.lockedBy : null
      return { tileId: d.id as TileId, ownerTeam: t.ownerTeam, lockedBy: locked }
    }),
    roster: rosterRows.map((r) => ({ playerId: r.playerId, team: r.team, roleId: canonRoleId(r.roleId) ?? r.roleId, targetId: r.targetId ?? null })),
    peeks: peeks.docs.map((d) => d.data() as { playerId: string; voteKind: 'trust' | 'liking'; voterNickname: string }),
    choices: choices.docs.map((d) => {
      const c = d.data() as { chosenId: string | null; day4: string | null }
      return { playerId: d.id, chosenId: c.chosenId ?? null, day4: c.day4 ?? null }
    }),
    releasedDays: releasedDays(game.startedAtMs ?? null, nowMs),
    progress: progress.docs.map((d) => {
      const p = d.data() as ProgressDoc
      return { playerId: p.playerId ?? d.id, handledDays: p.handledDays ?? [], readDays: p.readDays ?? [] }
    }),
    // 쪽지는 서버가 이름까지 끼워 넣어 들고 온다. 문장은 운영자가 놓을
    // 때 적은 것이다 — secret 에서 여기까지만 오고, 투영이 읽은 사람
    // 몫에만 싣는다
    slips: slips.docs.map((d) => {
      const s2 = d.data() as SlipDoc
      const who = game.seats.find((x) => x.playerId === s2.subjectId)?.name ?? null
      return {
        id: d.id,
        subjectId: s2.subjectId,
        // 주인이 없는 종이(메모·빈 종이)는 이름 자리를 「누군가」로 둔다
        // 56장은 번호로 문안을 찾는다. 문안 틀은 여기서 끝난다 — 이름이
        // 끼워진 문장만 투영으로 가고, 그것도 읽은 사람 몫에만 실린다
        line: s2.noteId ? fillSubject(SLIP_NOTE_BY_ID[s2.noteId]?.text ?? '', who) : s2.text ? fillSubject(s2.text, who) : '',
        tileId: s2.tileId ?? null,
        // 칸에 놓인 것. 주우면 비워진다. 칸 없이 방 바닥에만 놓였던 옛 종이는
        // 그 방 안 한 칸에 그린다(legacyCell) — 줍기는 그 방에 서 있으면 된다
        ...(typeof s2.x === 'number' && typeof s2.y === 'number'
          ? { x: s2.x, y: s2.y }
          : legacyCell(d.id, s2)),
        memo: !s2.noteId,
        heldBy: s2.heldBy ?? null,
        readBy: s2.readBy ?? [],
        // 찢긴 조각. 붙일 수 있는 사람이 그 방에 와야 다시 종이가 된다
        torn: s2.tornBy != null,
        tornAt: s2.tornAt ?? null,
      }
    }),
    // 문제 종이. **정답과 해설은 아예 안 싣는다.**
    //
    // 문제와 보기는 싣는다 — 펼친 종이는 그 방 사람 전원에게 가야 해서
    // 투영이 쥐고 있어야 한다. 그러나 정답과 해설은 투영조차 볼 일이
    // 없으므로 여기서 끊는다. 안 실으면 실수로도 못 샌다
    quizzes: quizFloor.docs.map((d) => {
      const paper = d.data() as QuizPaperDoc
      const quiz = quizBank.docs.find((b) => b.id === paper.quizId)?.data() as QuizDoc | undefined
      return {
        id: d.id,
        x: paper.x,
        y: paper.y,
        kind: quiz?.kind ?? 'short',
        prompt: quiz?.prompt ?? null,
        choices: quiz?.choices ?? [],
        heldBy: paper.heldBy ?? null,
        openedBy: paper.openedBy ?? [],
        solvedTeam: (paper.solvedTeam ?? null) as 'A' | 'B' | 'C' | 'D' | null,
        wrongBy: paper.wrongBy ?? [],
      }
    }),
    memories: memories.docs.map((d) => d.data() as MemoryDoc),
    awakenedAtMs: Object.fromEntries(awakened.docs.map((d) => [d.id, (d.data() as { atMs: number }).atMs])),
    notices: notices.docs.map((d) => {
      const n = d.data() as NoticeDoc
      return { id: d.id, toPlayerId: n.toPlayerId, text: n.text, atMs: n.atMs }
    }),
  }
}

/**
 * 열넷 몫을 한 번에 다시 쓴다.
 *
 * 사람마다 따로 계산하지만 쓰기는 한 묶음이다 — 절반만 새 것이면
 * 같은 순간을 두 사람이 다르게 본다.
 */
export async function refreshViews(gameId: string): Promise<number> {
  const snap = await gameRef(gameId).get()
  if (!snap.exists) return 0
  const game = snap.data() as GameDoc
  if (game.phase === 'lobby') return 0

  const world = await loadWorld(gameId, game)
  const views = projectAll(world)

  const batch = db.batch()
  for (const [playerId, view] of Object.entries(views)) {
    batch.set(gameRef(gameId).collection('views').doc(playerId), view)
  }
  await batch.commit()
  return Object.keys(views).length
}

/**
 * **칸 없이 방 바닥에만 놓였던 옛 종이의 자리.**
 *
 * 전에는 운영자 메모와 빈 종이가 방에만 놓이고 칸이 없었다 — 맵에 안
 * 그려지고, 가진 것 목록의 「바닥에 몇 장」으로만 주웠다. 그 목록을
 * 없앴으니 옛 종이도 맵에 보여야 주울 수 있다. 문서를 고쳐 쓰지 않고
 * 아이디로 그 방의 한 칸을 정해 그린다 — 늘 같은 칸이다. 줍는 쪽(takeSlip)은
 * 칸 없는 종이를 「그 방에 서 있으면」으로 받으므로 그대로 주워진다.
 */
function legacyCell(id: string, s: SlipDoc): { x: number | null; y: number | null } {
  // 찢긴 조각은 찢긴 방(tornAt), 바닥의 종이는 놓인 방(tileId)
  const room = s.heldBy ? null : s.tornBy ? (s.tornAt ?? null) : (s.tileId ?? null)
  if (!room) return { x: null, y: null }
  const cells = dropCellsIn(room)
  if (cells.length === 0) return { x: null, y: null }
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const c = cells[h % cells.length]
  return { x: c.x, y: c.y }
}
