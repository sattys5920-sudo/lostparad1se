// 아주 짧은 소리 셋.
//
// 음원 파일을 싣지 않는다. 거래창에서 쓰는 것은 「올렸다 · 성립 · 취소」
// 세 가지뿐이고, 파일 하나가 도트 그림 전부보다 무겁다. 사각파 한 번씩
// 직접 만든다 — 8비트 화면에 맞는 소리이기도 하다.
//
// **소리는 손끝이 닿은 뒤에만 난다.** 브라우저가 그 전에는 소리 장치를
// 열어 주지 않는다. 못 열면 그냥 조용히 넘어간다 — 소리 때문에 화면이
// 멈추는 일은 없어야 한다.

let ctx: AudioContext | null = null

function open(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/** 사각파 한 음. hz 는 높이, ms 는 길이. */
function blip(hz: number, ms: number, atMs = 0, gain = 0.06): void {
  const c = open()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime + atMs / 1000
  const osc = c.createOscillator()
  const vol = c.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(hz, t)
  vol.gain.setValueAtTime(gain, t)
  // 뚝 끊으면 「딱」 하는 잡음이 난다. 끝을 아주 짧게 재운다
  vol.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  osc.connect(vol).connect(c.destination)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.01)
}

export const SFX = {
  /** 탁자에 하나 올렸다. */
  put: () => blip(720, 50),
  /** 준비를 눌렀다. */
  ready: () => blip(880, 60),
  /** 세는 소리. 한 번에 하나씩. */
  tick: () => blip(520, 40, 0, 0.04),
  /** 성립했다. 짧게 두 음. */
  done: () => {
    blip(660, 70)
    blip(990, 110, 80)
  },
  /** 사라졌다. 내려가는 두 음. */
  gone: () => {
    blip(440, 70)
    blip(300, 110, 70)
  },
}
