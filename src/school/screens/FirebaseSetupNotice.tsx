import './FirebaseSetupNotice.css'

export function FirebaseSetupNotice() {
  return (
    <div className="sc-fb-notice">
      <span className="sc-fb-notice__eyebrow">설정 필요</span>
      <h1>Firebase가 연결되지 않았다</h1>
      <p>
        .env 파일에 VITE_FIREBASE_* 값을 채우거나, VITE_FIREBASE_EMULATOR=true로 로컬 에뮬레이터를 켠 뒤 다시
        불러온다.
      </p>
    </div>
  )
}
