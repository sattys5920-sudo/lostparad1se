// 쌓인 기록을 읽는 손. **e2e 스크립트만 쓴다.**
//
// 사람도 화면도 이 컬렉션을 못 읽는다(firestore.rules 가 막는다). 시험은
// 운영자 열쇠로 직접 들여다본다 — 「일이 일어나면 한 줄이 쌓인다」를
// 확인할 방법이 이것뿐이다.
//
// 기록이 안 쌓이면 미션은 영영 안 채워지는데, 그 사실은 닷새가 끝나야
// 드러난다. 그래서 흐름마다 그 자리에서 한 줄을 확인한다.
import type { GameRecord, RecordKind } from '../../shared/rules/records'

const PROJECT = 'demo-goei'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

/** Firestore 의 값 포장을 벗긴다. */
function plain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if ('stringValue' in o) return o.stringValue
  if ('integerValue' in o) return Number(o.integerValue)
  if ('doubleValue' in o) return o.doubleValue
  if ('booleanValue' in o) return o.booleanValue
  if ('nullValue' in o) return null
  if ('arrayValue' in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(plain)
  if ('mapValue' in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> }).fields ?? {}
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]))
  }
  if ('fields' in o) {
    return Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).map(([k, x]) => [k, plain(x)]))
  }
  return o
}

/** 그 판에 쌓인 기록 전부. 시각순이다. */
export async function records(gameId: string): Promise<GameRecord[]> {
  const r = await fetch(`${FS}/games/${gameId}/secret/records/items?pageSize=300`, { headers: ADMIN })
  if (!r.ok) return []
  const j = (await r.json()) as { documents?: unknown[] }
  return ((j.documents ?? []).map(plain) as GameRecord[]).sort((a, b) => a.atMs - b.atMs)
}

/** 그 종류만. 사람까지 좁히려면 who 를 준다. */
export const of = (rows: readonly GameRecord[], kind: RecordKind, who?: string): GameRecord[] =>
  rows.filter((r) => r.kind === kind && (who === undefined || r.actorId === who))
