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

/**
 * 손끝이 아직 화면에 안 닿았으면 아무 소리도 내지 않는다.
 *
 * 브라우저 정책 때문만이 아니다. 들어오자마자 소리가 나면 조용히
 * 보려던 사람이 놀란다. 한 번 닿은 뒤부터 열린다.
 */
let armed = false

/** 화면 어디든 처음 닿았을 때 한 번 부른다. */
export function armSfx(): void {
  armed = true
}

// ── 소리 끄기 ───────────────────────────────────────────────────
// 기기에만 남는다(진동 · 연출 줄이기와 같다). 끄면 **어떤 소리도 안 난다**
// — 프롤로그의 눈 소리도, 분필 소리도, 거래창의 삑 소리도.

const SOUND_OFF_KEY = 'sc-sound-off'

export function soundIsOn(): boolean {
  try {
    return localStorage.getItem(SOUND_OFF_KEY) !== '1'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_OFF_KEY, on ? '0' : '1')
  } catch {
    // 비공개 창. 이번 화면에서만 따른다
  }
  if (!on) stopSnowAmbient()
}

/** 지금 소리를 내도 되는가 — 손끝이 닿았고, 끄지 않았다 */
const mayPlay = (): boolean => armed && soundIsOn()

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
  if (!mayPlay()) return
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

/**
 * 잡음 한 줌. 종이 스치는 소리는 음이 아니라 잡음이다.
 *
 * 사각파로는 「삑」밖에 안 난다. 짧은 백색잡음을 만들어 좁은 대역만
 * 남기면 종이 소리에 가까워진다 — 버퍼는 한 번 만들어 다시 쓴다.
 */
let noiseBuf: AudioBuffer | null = null

function rustle(ms: number, hz: number, gain = 0.05, atMs = 0): void {
  if (!mayPlay()) return
  const c = open()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.4), c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1
  }
  const t = c.currentTime + atMs / 1000
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(hz, t)
  band.Q.setValueAtTime(1.2, t)
  const vol = c.createGain()
  vol.gain.setValueAtTime(0.0001, t)
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012)
  vol.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  src.connect(band).connect(vol).connect(c.destination)
  src.start(t)
  src.stop(t + ms / 1000 + 0.01)
}

/** 손끝이 닿았는가. 엔딩 송출 오버레이가 소리를 낼지 미리 묻는 데 쓴다. */
export function isArmed(): boolean {
  return armed
}

let ambientSrc: AudioBufferSourceNode | null = null
let ambientGain: GainNode | null = null
let ambientBuf: AudioBuffer | null = null

/**
 * 눈 앰비언트 — 낮은 바람 소리를 계속 튼다.
 *
 * **armSfx() 전에는 안 난다.** 오버레이가 뜨는 순간 이미 한 번이라도
 * 손댄 적이 있으면 그대로 틀고, 없으면 음소거 해제 단추가 대신
 * 뜬다(FinalNoteOverlay.tsx) — 눌러야 이 함수가 불린다.
 */
export function startSnowAmbient(): void {
  if (!mayPlay() || ambientSrc) return
  const c = open()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  if (!ambientBuf) {
    const len = Math.floor(c.sampleRate * 4)
    ambientBuf = c.createBuffer(1, len, c.sampleRate)
    const d = ambientBuf.getChannelData(0)
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = ambientBuf
  src.loop = true
  const band = c.createBiquadFilter()
  band.type = 'lowpass'
  band.frequency.setValueAtTime(900, c.currentTime)
  const vol = c.createGain()
  vol.gain.setValueAtTime(0.0001, c.currentTime)
  // 확 켜지지 않는다. 1.2초를 들여 낮게 올라온다
  vol.gain.exponentialRampToValueAtTime(0.025, c.currentTime + 1.2)
  src.connect(band).connect(vol).connect(c.destination)
  src.start()
  ambientSrc = src
  ambientGain = vol
}

/** 눈 앰비언트를 끈다. 뚝 끊지 않고 반 박자 사그라든다. */
export function stopSnowAmbient(): void {
  if (!ambientSrc || !ambientGain) return
  const src = ambientSrc
  const vol = ambientGain
  ambientSrc = null
  ambientGain = null
  const c = ctx
  if (!c) return
  const t = c.currentTime
  vol.gain.cancelScheduledValues(t)
  vol.gain.setValueAtTime(vol.gain.value, t)
  vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  setTimeout(() => {
    try {
      src.stop()
    } catch {
      // 이미 멎었으면 그냥 둔다
    }
  }, 600)
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
  /** 종이가 한 번 접힌다. */
  fold: () => rustle(150, 2600, 0.05),
  /** 접힌 종이가 투입구로 떨어져 바닥에 닿는다. */
  drop: () => {
    rustle(90, 1400, 0.04)
    blip(150, 90, 40, 0.07)
  },
  /** 분필이 칠판을 한 번 긁는다. 아주 작게 — 한 글자에 한 번 */
  chalk: () => rustle(45, 3800 + Math.random() * 900, 0.012),
  /** 사라졌다. 내려가는 두 음. */
  gone: () => {
    blip(440, 70)
    blip(300, 110, 70)
  },
}
