// Firebase 붙이기.
//
// 셋을 쓴다. Firestore(읽기) · Auth(누구인지) · Functions(판정).
//
// 쓰기는 거의 다 Functions를 거친다. 규칙이 게임 문서를 클라이언트
// 쓰기로부터 통째로 막아 두었기 때문이다 — 추리 노트 하나만 예외다.
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'

const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === 'true'

const firebaseConfig = useEmulator
  ? { projectId: 'demo-goei', apiKey: 'fake-key', authDomain: 'demo-goei.firebaseapp.com' }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }

export const firebaseConfigured = useEmulator || Boolean(firebaseConfig.projectId)

const app = firebaseConfigured ? initializeApp(firebaseConfig) : null

export const db = app ? getFirestore(app) : null
export const auth = app ? getAuth(app) : null

/** 서울에 둔 함수들. 지역이 다르면 못 찾는다. */
const functions = app ? getFunctions(app, 'asia-northeast3') : null

if (useEmulator && app) {
  connectFirestoreEmulator(db!, '127.0.0.1', 8080)
  connectAuthEmulator(auth!, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFunctionsEmulator(functions!, '127.0.0.1', 5001)
}

/**
 * 서버 함수 하나를 부른다.
 *
 * 거절은 서버가 정한 말 그대로 올라온다. 화면이 따로 문구를 지어내지
 * 않는다 — 서버와 화면이 다른 말을 하면 사람이 엉뚱한 것을 고치려 든다.
 */
export async function callServer<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!functions) throw new Error('서버에 연결되어 있지 않다.')
  /*
   * **끊긴 동안에는 아예 안 보낸다.** 보내 두면 요청이 어딘가에 쌓였다가
   * 이어지는 순간 한꺼번에 나간다 — 끊긴 줄 모르고 여러 번 누른 것이
   * 전부 일어난다. 눌렀다는 것만 알리고 그 자리에서 끝낸다.
   */
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('연결을 기다리는 중이다.')
  }
  try {
    const fn = httpsCallable(functions, name)
    return (await fn(data)).data as T
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: unknown }
    // 망이 끊겨서 실패한 것. 「internal」 같은 말 대신 무엇을 하면 되는지 말한다
    if (err.code === 'functions/unavailable' || err.code === 'functions/deadline-exceeded' || (err.code === 'functions/internal' && err.message === 'internal')) {
      throw new Error('연결이 끊겼다. 잠시 뒤 다시 해 주세요.')
    }
    throw new Error(err.message ?? '서버와 이야기하지 못했다.')
  }
}
