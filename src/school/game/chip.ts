// 오락기 소리 — 음원 파일 없이 네모파로 굽는 칩튠.
//
// **소리는 손끝에서만 켜진다.** 휴대폰 브라우저는 사람이 누르기 전의
// 소리를 막는다. 그래서 게임을 고르는 단추, 부름을 받는 단추, 시작
// 단추에서 unlockChip 을 부른다 — 판이 열린 뒤에 켜려 하면 늦다.
//
// 소리가 안 나도 게임은 된다. 판정은 화면의 시계로 하고, 소리는 그
// 시계를 따라 미리 걸어 둔다.

let ctx: AudioContext | null = null

/** 소리판. 없는 브라우저면 null — 그래도 게임은 굴러간다. */
export function chip(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ctx = Ctor ? new Ctor() : null
  } catch {
    ctx = null
  }
  return ctx
}

/** 누른 손끝에서 부른다. 잠든 소리판을 깨운다. */
export function unlockChip(): void {
  const a = chip()
  if (a && a.state !== 'running') void a.resume().catch(() => undefined)
}

/** 음 하나. when 은 소리판 시계(초)다. */
export function tone(a: AudioContext, when: number, freq: number, dur: number, vol = 0.06, type: OscillatorType = 'square'): void {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, when)
  g.gain.setValueAtTime(vol, when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  o.connect(g).connect(a.destination)
  o.start(when)
  o.stop(when + dur + 0.02)
}

/** 북. 높은 데서 뚝 떨어지는 사인파 */
export function kick(a: AudioContext, when: number, vol = 0.22): void {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, when)
  o.frequency.exponentialRampToValueAtTime(45, when + 0.12)
  g.gain.setValueAtTime(vol, when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14)
  o.connect(g).connect(a.destination)
  o.start(when)
  o.stop(when + 0.16)
}

/** 찰박. 짧은 잡음 */
export function hat(a: AudioContext, when: number, vol = 0.035): void {
  const len = Math.floor(a.sampleRate * 0.03)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const s = a.createBufferSource()
  const g = a.createGain()
  s.buffer = buf
  g.gain.setValueAtTime(vol, when)
  s.connect(g).connect(a.destination)
  s.start(when)
}

/** 짝. 잡음에 짧은 몸통 소리를 얹는다 */
export function snare(a: AudioContext, when: number, vol = 0.12): void {
  hat(a, when, vol)
  tone(a, when, 190, 0.09, vol * 0.6, 'triangle')
}

/**
 * 패드 넷의 소리 — 쿵(큰북) · 짝(작은북) · 칙(찰박) · 딱(나무 소리).
 * 리듬 쌓기의 패드와 순서가 같다(rules/arcadeBeat 의 PAD_NAME).
 */
export function pad(a: AudioContext, which: number, when: number): void {
  if (which === 0) kick(a, when, 0.3)
  else if (which === 1) snare(a, when)
  else if (which === 2) hat(a, when, 0.07)
  else tone(a, when, 1200, 0.05, 0.08, 'square')
}

/** 셈 소리. 마디 첫 박은 높게 */
export function click(a: AudioContext, when: number, strong: boolean): void {
  tone(a, when, strong ? 1760 : 1320, 0.03, 0.035, 'square')
}
