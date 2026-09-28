// 화면이 보낸 문서 아이디를 **그대로 doc() 에 넣지 않는다.**
//
// 빈 문자열 · 숫자 · 객체 · 「a/b」 · 「.」 · 「__x__」 를 doc() 에 넣으면
// Firestore 클라이언트가 던지고, 콜러블은 INTERNAL 로 답한다 — 한국어
// 한 문장 대신 영어 넉 자가 화면에 뜬다. 여기서 먼저 걸러 「그런 …가
// 없다」로 답한다. 없는 문서를 찍은 것과 같은 답이라 밖에서 갈라 볼 수 없다.
import { HttpsError } from 'firebase-functions/v2/https'

/** Firestore 가 받는 문서 아이디 모양. 1500바이트 · 슬래시 없음 · 「.」「..」 아님 · 「__…__」 아님 */
export function isDocId(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 1500) return false
  if (v.includes('/') || v === '.' || v === '..') return false
  if (/^__.*__$/.test(v)) return false
  return true
}

/** 아이디가 아니면 not-found 로 거절한다. `missing` 은 「그런 쪽지가 없다.」처럼 없을 때 하는 말이다. */
export function docId(v: unknown, missing: string): string {
  if (!isDocId(v)) throw new HttpsError('not-found', missing)
  return v
}
