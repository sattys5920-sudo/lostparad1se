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
 * 무엇을 하다 실패했는지. 오류 원문 대신 「○○에 실패했다.」로만 알린다.
 * 없는 이름은 「요청」이다.
 */
const CALL_LABEL: Record<string, string> = {
  answerDeal: '거래 응답',
  answerQuiz: '답 내기',
  answerTransfer: '건네기 응답',
  askDeal: '거래 신청',
  askTransfer: '건네기',
  buyShopItem: '사기',
  cancelDeal: '거래 취소',
  castBallot: '투표',
  castVote: '표 주기',
  chatLines: '말 불러오기',
  commissionTrap: '맡기기',
  dropSlip: '쪽지 놓기',
  dropThing: '내려놓기',
  giveUpErrand: '심부름 포기',
  harvestPot: '수확',
  hostEnter: '로그인',
  hostEndPractice: 'DAY 1 시작',
  hostFinalScores: '최종 점수 불러오기',
  hostSetFinalScore: '최종 점수 저장',
  joinGame: '참가',
  logInAccount: '로그인',
  myAnswers: '답안지 불러오기',
  myPaper: '불러오기',
  notifyConfig: '알림 설정 불러오기',
  phaseAct: '행동',
  pickUpThing: '줍기',
  pushSubscribe: '알림 설정',
  pushUnsubscribe: '알림 설정',
  radio: '무전 보내기',
  radioLines: '무전 불러오기',
  readSlip: '쪽지 읽기',
  readSlipHere: '쪽지 읽기',
  readyDeal: '거래 준비',
  releasedFragments: '기록 불러오기',
  renameMe: '이름 바꾸기',
  roamTo: '이동',
  saveCharacter: '저장',
  say: '말하기',
  sellCrop: '팔기',
  setNotifySettings: '알림 설정',
  settleDeal: '거래',
  signUpAccount: '가입',
  stakeDeal: '거래에 올리기',
  standAt: '이동',
  submitAnswers: '답안지 내기',
  takeErrand: '심부름 받기',
  takeMade: '로봇 가져가기',
  takeQuiz: '문제 집기',
  takeSlip: '쪽지 챙기기',
  takeTrap: '덫 찾기',
  tearSlipHere: '쪽지 찢기',
  useItem: '물건 쓰기',
}

/** 「○○에 실패했다.」 — 원문은 콘솔에만 남긴다 */
export class CallFailed extends Error {
  constructor(name: string) {
    super(`${CALL_LABEL[name] ?? (name.startsWith('arcade') ? '오락기' : '요청')}에 실패했다.`)
  }
}

/**
 * 서버가 **일부러** 거절하며 하는 말. 게임 안의 말이라 그대로 보인다
 * (「돈이 모자란다」 같은 것). 그 밖의 오류는 원문을 안 보인다.
 */
const REFUSAL_CODES = new Set([
  'functions/invalid-argument',
  'functions/failed-precondition',
  'functions/permission-denied',
  'functions/not-found',
  'functions/already-exists',
  'functions/out-of-range',
  'functions/unauthenticated',
  'functions/resource-exhausted',
  'functions/aborted',
])
const HANGUL = /[가-힣]/

/**
 * 서버 함수 하나를 부른다.
 *
 * 서버가 일부러 거절한 말은 그대로 올라온다. 망·서버 고장 같은 오류는
 * 「○○에 실패했다.」 한 줄이다.
 */
export async function callServer<T = unknown>(name: string, data: unknown = {}): Promise<T> {
  if (!functions) throw new CallFailed(name)
  /*
   * **끊긴 동안에는 아예 안 보낸다.** 보내 두면 요청이 어딘가에 쌓였다가
   * 이어지는 순간 한꺼번에 나간다 — 끊긴 줄 모르고 여러 번 누른 것이
   * 전부 일어난다. 그 자리에서 끝낸다.
   */
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new CallFailed(name)
  }
  try {
    const fn = httpsCallable(functions, name)
    return (await fn(data)).data as T
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code && REFUSAL_CODES.has(err.code) && err.message && HANGUL.test(err.message)) {
      throw new Error(err.message)
    }
    console.error(name, e)
    throw new CallFailed(name)
  }
}
