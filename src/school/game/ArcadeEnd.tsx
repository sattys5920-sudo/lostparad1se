// 오락기 끝 화면 조각. 게임마다 같은 두 단추를 쓴다(큰 글자 BIG 은 arcadeTime).

export function EndRow({ busy, onAgain, onMenu }: { busy?: boolean; onAgain: () => void; onMenu: () => void }) {
  return (
    <div className="sc-ar__row">
      <button disabled={busy} onClick={onMenu}>게임 고르기</button>
      <button className="is-go" disabled={busy} onClick={onAgain}>한 판 더</button>
    </div>
  )
}
