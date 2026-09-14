// 다섯 기록을 쌓는 자리.
//
// 판정에 쓰이는 일이 일어날 때마다 여기로 한 줄이 들어온다. **누구에게도
// 통째로 안 내려간다** — 이 줄들을 다 보면 남이 무엇을 하려는지 역산할
// 수 있다. 각자에게는 자기 진행도만 간다.
//
// 위치와 동석은 여기 안 쌓는다. 그건 체류 구간(secret/intervals)에 이미
// 있고, 겹친 시간은 계산으로 나온다 — 같은 사실을 두 군데 적으면
// 반드시 어긋난다.
import { getFirestore } from 'firebase-admin/firestore'

import type { GameRecord, RecordKind } from '../../shared/rules/records'
import type { Stay } from '../../shared/rules/records'
import type { TeamId } from '../../shared/rules/v2'
import type { TileId } from '../../shared/rules/board'
import { gameRef } from './index'

const db = getFirestore()

const recordsOf = (gameId: string) => gameRef(gameId).collection('secret').doc('records').collection('items')

/** 체류 구간. reveal.ts 가 쓰던 것과 같은 문서다. */
interface IntervalDoc {
  playerId: string
  tileId: TileId | null
  startMs: number
  endMs: number | null
}

/**
 * 한 줄 적는다.
 *
 * 빈 칸은 아예 안 쓴다 — Firestore 는 undefined 를 싫어하고, 없는 값을
 * null 로 채워 두면 나중에 「없음」과 「안 적음」이 구별되지 않는다.
 */
export async function note(
  gameId: string,
  kind: RecordKind,
  atMs: number,
  actor: { id: string; team: TeamId },
  extra: {
    otherId?: string
    otherTeam?: TeamId
    tileId?: TileId | null
    subjectId?: string
    ownerId?: string
  } = {},
): Promise<void> {
  const row: Record<string, unknown> = { kind, atMs, actorId: actor.id, actorTeam: actor.team }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) row[k] = v
  await recordsOf(gameId).add(row)
}

/** 여러 줄을 한꺼번에. 거래처럼 한 번에 두 가지가 움직일 때. */
export async function noteAll(
  gameId: string,
  rows: readonly GameRecord[],
): Promise<void> {
  if (rows.length === 0) return
  const batch = db.batch()
  for (const r of rows) {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== null) clean[k] = v
    batch.set(recordsOf(gameId).doc(), clean)
  }
  await batch.commit()
}

/** 쌓인 기록 전부. **판정할 때 서버가만 읽는다.** */
export async function allRecords(gameId: string): Promise<GameRecord[]> {
  const snap = await recordsOf(gameId).get()
  return snap.docs.map((d) => d.data() as GameRecord).sort((a, b) => a.atMs - b.atMs)
}

/** 체류 구간 전부. 위치와 동석이 여기서 나온다. */
export async function allStays(gameId: string): Promise<Stay[]> {
  const snap = await gameRef(gameId).collection('secret').doc('intervals').collection('items').get()
  return snap.docs.map((d) => {
    const iv = d.data() as IntervalDoc
    return {
      playerId: iv.playerId,
      tileId: iv.tileId ?? null,
      startMs: iv.startMs,
      endMs: iv.endMs ?? null,
    }
  })
}
