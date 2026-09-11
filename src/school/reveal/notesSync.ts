// 추리 노트 저장.
//
// 서버 함수를 거치지 않고 Firestore에 바로 쓴다. 판정에 쓰이지 않는
// 개인 메모라 서버가 검사할 것이 없고, 한 글자마다 왕복하면 끄적이는
// 자리가 느려진다. 대신 규칙이 `request.auth.uid == playerId` 하나로
// 본인 말고는 읽지도 쓰지도 못하게 막는다.
//
// 쓰기는 몰아서 보낸다. 타이핑마다 보내면 요금과 지연이 같이 는다.
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../../firebase'
import { emptyNote, type DeductionNote } from '../../../shared/reveal/notes'

/** 마지막 글자를 친 뒤 이만큼 조용하면 보낸다. */
export const SAVE_DEBOUNCE_MS = 800

function requireDb(): Firestore {
  if (!db) throw new Error('firebase가 설정되지 않았다')
  return db
}

const noteRef = (gameId: string, playerId: string) =>
  doc(requireDb(), 'games', gameId, 'notes', playerId)

export async function loadNote(gameId: string, playerId: string): Promise<DeductionNote> {
  const snap = await getDoc(noteRef(gameId, playerId))
  if (!snap.exists()) return emptyNote(playerId)
  const raw = snap.data() as Partial<DeductionNote>
  // 남의 것이 잘못 들어오는 일은 규칙이 막지만, 들어와도 쓰지 않는다
  if (raw.ownerId !== playerId) return emptyNote(playerId)
  return {
    ownerId: playerId,
    entryNotes: raw.entryNotes ?? {},
    board: raw.board ?? [],
    history: raw.history ?? [],
  }
}

export async function saveNote(gameId: string, note: DeductionNote): Promise<void> {
  await setDoc(noteRef(gameId, note.ownerId), note)
}

/**
 * 몰아서 저장하는 작은 도우미. 마지막 값만 보낸다 —
 * 중간 값을 다 보내면 이력이 아니라 타자 기록이 남는다.
 */
export function makeNoteSaver(gameId: string, onError?: (e: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: DeductionNote | null = null

  const flush = async () => {
    const note = pending
    pending = null
    timer = null
    if (!note) return
    try {
      await saveNote(gameId, note)
    } catch (e) {
      onError?.(e)
    }
  }

  return {
    queue(note: DeductionNote) {
      pending = note
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    /** 화면을 떠날 때 남은 것을 보낸다. */
    flush,
  }
}
