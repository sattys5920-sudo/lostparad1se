// 붐비는 트랜잭션 — 열넷이 한꺼번에 누르면 같은 문서를 두고 다툰다.
//
// 페이즈 행동·방 옮기기·칸 잡기는 pawns 컬렉션을 통째로 읽는 트랜잭션이다.
// 페이즈가 열리는 순간 열넷이 동시에 누르면 Firestore 가 잠금을 두고
// 서로 기다리다 ABORTED(잠금 시간 초과)를 낸다. 기본 다섯 번 재시도로도
// 모자라서 INTERNAL 로 떨어졌다(봇 열넷 배속 240 시험에서 여덟 번).
//
// 여기서는 재시도를 더 주고, 그래도 안 되면 「다시 눌러라」로 돌려준다 —
// INTERNAL 은 화면이 「서버 오류」로 보여 주고 사람은 뭘 해야 할지 모른다.
import { getFirestore, type Transaction } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const db = getFirestore()

/** 잠금 다툼으로 실패했나. grpc 코드 10 = ABORTED */
export function isContention(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown }
  return err?.code === 10 || /ABORTED|lock timeout|contention/i.test(String(err?.message ?? ''))
}

export const CONTENDED_TEXT = '동시에 몰렸다. 잠깐 뒤 다시 눌러라.'

/** db.runTransaction 과 같되, 재시도를 여덟 번까지 하고 다툼은 aborted 로 돌려준다 */
export async function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await db.runTransaction(fn, { maxAttempts: 8 })
  } catch (e) {
    if (e instanceof HttpsError) throw e
    if (isContention(e)) throw new HttpsError('aborted', CONTENDED_TEXT)
    throw e
  }
}
