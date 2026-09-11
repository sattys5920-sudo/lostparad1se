// 진상 공개 흐름의 서버 쪽.
//
// 아침 시퀀스 진행 · 체류 기록 · 깨달음 · 눈발.
//
// A의 기록 본문은 여기 없다 — fragments.ts가 공개 시각을 지켜 따로
// 내려보낸다. 이 파일은 「어디까지 봤는가」와 「얼마나 서 있었는가」만
// 다룬다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

import { TOTAL_DAYS } from '../../shared/rules/v2'
import { releasedDays } from '../../shared/reveal/release'
import { awakeningOf, type InvisibleSpan } from '../../shared/missions/awakening'
import { snowView } from '../../shared/rules/snow'
import type { Interval } from '../../shared/rules/presence'
import type { TileId } from '../../shared/rules/board'
import type { GameDoc, RosterDoc } from '../../shared/model'
import { placeOf } from './story/sights'
import { refreshViews, type ProgressDoc } from './views'
import { freshNow } from './turn'
import { gameRef, nowOf, requireUid } from './index'

const db = getFirestore()

const secret = (gameId: string, name: string) =>
  gameRef(gameId).collection('secret').doc(name).collection('items')

// ── 아침 시퀀스 진행 ────────────────────────────────────────────

/**
 * 어디까지 봤는지 적는다.
 *
 * handled에는 **끝까지 본 날과 건너뛴 날이 함께** 들어간다. 둘을 따로
 * 들고 있다가 본 날만 저장하면 건너뛴 아침이 다음 날 또 뜬다.
 * read는 보관함이 「읽지 않음」을 가리는 데만 쓴다.
 */
export const markMorning = onCall<{ gameId: string; read?: number[]; skipped?: number[] }>(
  async (req) => {
    const uid = requireUid(req.auth)
    const { gameId } = req.data
    const { game, nowMs } = await freshNow(gameId)

    const open = releasedDays(game.startedAtMs ?? null, nowMs)
    const clean = (days: unknown): number[] =>
      [...new Set((Array.isArray(days) ? days : []).map(Number))]
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= TOTAL_DAYS)
        // 아직 안 열린 날을 봤다고 할 수는 없다
        .filter((d) => open.includes(d))

    const read = clean(req.data.read)
    const skipped = clean(req.data.skipped)
    const ref = secret(gameId, 'progress').doc(uid)
    const before = (await ref.get()).data() as ProgressDoc | undefined

    const next: ProgressDoc = {
      playerId: uid,
      // 본 날 + 건너뛴 날. 다음 재생을 정하는 목록이다
      handledDays: [...new Set([...(before?.handledDays ?? []), ...read, ...skipped])].sort((a, b) => a - b),
      readDays: [...new Set([...(before?.readDays ?? []), ...read])].sort((a, b) => a - b),
    }
    await ref.set(next)
    await refreshViews(gameId)
    return next
  },
)

// ── 체류 기록 ───────────────────────────────────────────────────

/**
 * 어디에 얼마나 서 있었는가. **서버만 읽는다.**
 *
 * 위치 이력은 안개보다 더 센 정보다 — 닷새치를 보면 누가 어디를 맴돌았는지
 * 다 보인다. secret 밑에 두고 어디로도 내보내지 않는다.
 */
export async function closeInterval(gameId: string, playerId: string, atMs: number): Promise<void> {
  const open = await secret(gameId, 'intervals')
    .where('playerId', '==', playerId)
    .where('endMs', '==', null)
    .get()
  const batch = db.batch()
  for (const d of open.docs) batch.update(d.ref, { endMs: atMs })
  await batch.commit()
}

export async function openInterval(
  gameId: string,
  playerId: string,
  tileId: TileId | null,
  atMs: number,
  state: Interval['state'] = 'standing',
): Promise<void> {
  await closeInterval(gameId, playerId, atMs)
  await secret(gameId, 'intervals').add({ playerId, tileId, startMs: atMs, endMs: null, state })
}

// ── 깨달음과 눈발 ───────────────────────────────────────────────

/**
 * 그 자리에 세 시간 서면 A의 시선이 열린다.
 *
 * **역할과 그 자리의 짝은 서버 전용 데이터에만 있다.** 그 짝을 알면
 * 누가 어디에 오래 서 있는지만 보고 역할을 역산할 수 있다 — 창고에
 * 세 시간 서 있는 사람은 지킴이 아니면 거짓말쟁이다.
 */
export async function refreshAwakening(gameId: string): Promise<{ awakened: number; revealed: number }> {
  const snap = await gameRef(gameId).get()
  const game = snap.data() as GameDoc
  const nowMs = nowOf(game)
  const from = game.startedAtMs ?? nowMs

  const [rosterSnap, ivSnap, awakenedSnap] = await Promise.all([
    secret(gameId, 'roster').get(),
    secret(gameId, 'intervals').get(),
    secret(gameId, 'awakened').get(),
  ])
  const intervals = ivSnap.docs.map((d) => d.data() as Interval)
  const already = new Set(awakenedSnap.docs.map((d) => d.id))

  // 투명인간이었던 구간은 체류가 두 배로 쌓인다. 지워져 본 사람이
  // 가장 빨리 이해한다
  const spans: InvisibleSpan[] = []
  for (const [day, playerId] of Object.entries(game.invisibleByDay)) {
    if (!playerId) continue
    const d = Number(day)
    spans.push({
      playerId,
      startMs: from + (d - 1) * 86_400_000,
      endMs: from + d * 86_400_000,
    })
  }

  const batch = db.batch()
  let awakened = 0
  let revealed = 0
  for (const doc of rosterSnap.docs) {
    const row = doc.data() as RosterDoc
    if (row.reveal) revealed += 1
    const place = placeOf(row.roleId as Parameters<typeof placeOf>[0])
    if (!place) continue
    const out = awakeningOf(intervals, row.playerId, place as TileId, spans, from, nowMs)
    if (!out.open) continue
    awakened += 1
    if (!already.has(row.playerId)) {
      batch.set(secret(gameId, 'awakened').doc(row.playerId), { atMs: nowMs })
    }
  }

  const progress = { awakened, revealed }
  batch.update(gameRef(gameId), { snow: snowView(progress) })
  await batch.commit()
  return progress
}

/** 화면이 눈발을 물어본다. 사람 수는 내려가지 않는다 — 단계뿐이다. */
export const snowNow = onCall<{ gameId: string }>(async (req) => {
  requireUid(req.auth)
  const { gameId } = req.data
  const snap = await gameRef(gameId).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const progress = await refreshAwakening(gameId)
  await refreshViews(gameId)
  // 「여덟 명」이라고 알려 주면 남은 하나를 찾아 몰아붙이게 된다
  return snowView(progress)
})
