// 눈.
//
// 눈발의 세기는 공동 목표가 얼마나 찼는지를 알려 준다. 숫자는 내려오지
// 않고 단계(0~5)만 온다 — 「여덟 명」이라고 알려 주면 남은 하나를 찾아
// 몰아붙이게 된다.
//
// 0단계는 그친 것이다. 그때는 아무것도 그리지 않는다.
import { useEffect, useRef } from 'react'
import { SNOW_PARTICLES } from '../../../shared/reveal/staging'

interface Flake {
  x: number
  y: number
  vy: number
  drift: number
  size: number
}

/** 눈을 끄고 켠 것. 끄면 루프 자체를 안 돌린다 — 저사양 기기에서. */
const SNOW_OFF_KEY = 'sc.snow.off'
export const snowIsOff = (): boolean => {
  try {
    return localStorage.getItem(SNOW_OFF_KEY) === '1'
  } catch {
    return false
  }
}
export const setSnowOff = (off: boolean): void => {
  try {
    localStorage.setItem(SNOW_OFF_KEY, off ? '1' : '0')
  } catch {
    // 시크릿 모드에서는 저장이 막힌다. 그때는 그냥 켜진 채로 둔다
  }
}

export function Snow({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const at = Math.max(0, Math.min(SNOW_PARTICLES.length - 1, Math.round(level)))
    // 껐으면 한 톨도 안 그리고 루프도 안 돈다. 「보이지 않게」가
    // 아니라 「돌지 않게」여야 배터리가 산다
    const count = snowIsOff() ? 0 : (SNOW_PARTICLES[at] ?? 0)

    let w = (canvas.width = canvas.offsetWidth)
    let h = (canvas.height = canvas.offsetHeight)
    if (count === 0) {
      ctx.clearRect(0, 0, w, h)
      return
    }

    const flakes: Flake[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 12 + Math.random() * 24,
      drift: (Math.random() - 0.5) * 10,
      size: Math.random() < 0.75 ? 1 : 2,
    }))

    const onResize = () => {
      w = canvas.width = canvas.offsetWidth
      h = canvas.height = canvas.offsetHeight
    }
    addEventListener('resize', onResize)

    let raf = 0
    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#e6e8ee'
      for (const f of flakes) {
        if (!reduced) {
          f.y += f.vy * dt
          f.x += f.drift * dt
          if (f.y > h) {
            f.y = -2
            f.x = Math.random() * w
          }
          if (f.x < -2) f.x = w
          if (f.x > w + 2) f.x = -2
        }
        ctx.globalAlpha = f.size === 1 ? 0.5 : 0.8
        ctx.fillRect(Math.round(f.x), Math.round(f.y), f.size, f.size)
      }
      ctx.globalAlpha = 1
      // 움직임을 줄여 달라고 했으면 한 번만 그리고 멈춘다
      if (!reduced) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    /**
     * 화면이 안 보이면 멈춘다. **배터리 때문이다.**
     *
     * 브라우저가 알아서 멈춰 주는 경우도 있지만 안 멈추는 기기가 있고,
     * 그런 기기가 대개 배터리가 약한 기기다.
     */
    const onVisible = () => {
      cancelAnimationFrame(raf)
      if (document.visibilityState === 'visible') {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
      removeEventListener('resize', onResize)
    }
  }, [level])

  return <canvas ref={ref} className="sc-rv__snow" aria-hidden="true" />
}
