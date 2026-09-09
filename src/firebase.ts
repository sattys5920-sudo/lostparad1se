import { initializeApp } from 'firebase/app'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === 'true'

const firebaseConfig = useEmulator
  ? { projectId: 'demo-goei' }
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

if (db && useEmulator) {
  connectFirestoreEmulator(db, 'localhost', 8080)
}
