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
  try {
    const fn = httpsCallable(functions, name)
    return (await fn(data)).data as T
  } catch (e) {
    const err = e as { message?: string; details?: unknown }
    throw new Error(err.message ?? '서버와 이야기하지 못했다.')
  }
}
