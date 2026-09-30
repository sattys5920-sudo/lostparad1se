// 새 화면이 나왔는가.
//
// **폰은 옛 화면을 오래 쥔다.** 배포하고 나서도 켜 둔 창, 홈 화면에 올려
// 둔 앱, 캐시가 한 시간 쥐고 있던 첫 장이 옛 코드를 계속 돌렸다 — 고쳤다는
// 것이 운영자 화면에 안 떴다. 그래서 떠 있는 화면이 가끔 version.json 을
// 물어보고, 자기 이름표와 다르면 맨 위에 띠를 띄운다.
//
// **저절로 새로 고치지 않는다.** 걷는 중이거나 글을 쓰는 중일 수 있다 —
// 누르는 것은 사람이다.
import { useEffect, useState } from 'react'

const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
/** 이만큼마다 한 번. 화면으로 돌아올 때도 한 번 묻는다 */
const EVERY_MS = 60_000

export function NewVersion() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    // 개발 서버·시험에는 version.json 이 없다
    if (BUILD === 'dev' || BUILD === 'test' || import.meta.env.DEV) return
    let alive = true
    const ask = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const { id } = (await r.json()) as { id?: string }
        if (alive && id && id !== BUILD) setStale(true)
      } catch {
        // 못 물어도 그만이다. 다음에 또 묻는다
      }
    }
    void ask()
    const t = setInterval(() => void ask(), EVERY_MS)
    const onShow = () => {
      if (document.visibilityState === 'visible') void ask()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])

  if (!stale) return null
  return (
    <button type="button" className="sc-newver" onClick={() => location.reload()}>
      새 화면이 나왔다 · 눌러서 새로 고침
    </button>
  )
}
