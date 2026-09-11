import './IntroScreen.css'

/** 표지에서 고르는 문. 「들어가기」 한 단계를 거치지 않고 바로 갈린다. */
export type EntryDoor = 'signup' | 'login'

export function IntroScreen({ onEnter }: { onEnter: (door: EntryDoor) => void }) {
  return (
    <div className="sc-intro">
      <div className="sc-intro__body">
        <span className="sc-intro__eyebrow">DAY 0</span>
        <h1 className="sc-intro__title">
          A가 사라진 뒤,
          <br />
          학교는 그대로 있다.
        </h1>
        <p className="sc-intro__desc">
          같은 반이었던 사람들이 남았다. 각자 다른 이유로 A를 기억하거나, 기억하지 못한다. 오늘부터 닷새,
          우리는 서로에게 어떤 사람이 될 것인가.
        </p>
      </div>
      <div className="sc-intro__doors">
        <button className="sc-intro__enter" onClick={() => onEnter('signup')}>
          가입
        </button>
        <button className="sc-intro__enter sc-intro__enter--ghost" onClick={() => onEnter('login')}>
          로그인
        </button>
      </div>
    </div>
  )
}
