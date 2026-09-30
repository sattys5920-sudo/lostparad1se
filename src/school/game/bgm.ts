// 배경음악 — 날마다 한 곡.
//
//   DAY 1  그라나도 에스파다
//   DAY 2  Says
//   DAY 3  Tango
//   DAY 4  Minority
//
// 감독관이 틀고 끈다(game.bgm). 각자 「나」 탭에서 끌 수 있고, 끈 것은
// 이 기기에 적는다. **감독관이 다시 틀면 끈 사람도 켜진다** — 끈 시각이
// 감독관이 튼 시각보다 앞이면 켜진 것으로 본다.
//
// 휴대폰은 한 번 누르기 전에는 소리를 못 낸다. 막히면 첫 터치를 기다렸다
// 다시 튼다.
import { useEffect, useSyncExternalStore } from 'react'

export const BGM_TRACKS: Readonly<Record<number, { src: string; name: string }>> = {
  1: { src: '/bgm/day1.mp3', name: '그라나도 에스파다' },
  2: { src: '/bgm/day2.mp3', name: 'Says' },
  3: { src: '/bgm/day3.mp3', name: 'Tango' },
  4: { src: '/bgm/day4.mp3', name: 'Minority' },
}

/**
 * 지금 틀 곡의 날. 시작 전 로비는 DAY 1 곡, 끝난 뒤(엔딩)는 DAY 4 곡을
 * 이어서 튼다. 판이 도는 동안은 그날 곡이다
 */
export function bgmDay(phase: string | undefined, day: number): number {
  if (phase === 'lobby') return 1
  if (phase === 'finished') return 4
  return Math.min(4, Math.max(1, day))
}

const VOLUME = 0.45
const KEY = 'sc.bgm.mutedAt'

interface State {
  gameId: string | null
  day: number
  hostOn: boolean
  hostAt: number
  mutedAt: number
}

let state: State = { gameId: null, day: 0, hostOn: false, hostAt: 0, mutedAt: 0 }
const subs = new Set<() => void>()
let audio: HTMLAudioElement | null = null
let waiting = false

function readMuted(gameId: string): number {
  try {
    return Number(localStorage.getItem(`${KEY}:${gameId}`)) || 0
  } catch {
    return 0
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next }
  apply()
  for (const f of subs) f()
}

const muted = () => state.mutedAt > state.hostAt

function apply() {
  const track = BGM_TRACKS[state.day]
  const want = state.hostOn && !muted() && track !== undefined
  if (!want) {
    audio?.pause()
    return
  }
  if (!audio) {
    audio = new Audio()
    audio.loop = true
    audio.volume = VOLUME
    audio.preload = 'auto'
  }
  if (!audio.src.endsWith(track.src)) audio.src = track.src
  void audio.play().catch(() => waitForTouch())
}

/** 막혔다 — 첫 터치에서 다시 튼다 */
function waitForTouch() {
  if (waiting) return
  waiting = true
  const go = () => {
    waiting = false
    window.removeEventListener('pointerdown', go)
    window.removeEventListener('keydown', go)
    apply()
  }
  window.addEventListener('pointerdown', go, { once: true })
  window.addEventListener('keydown', go, { once: true })
}

/** 판이 있는 동안 부른다(로비 · 진행 · 엔딩). 판 · 날 · 감독관 스위치를 음악에 알린다 */
export function useBgm(gameId: string, day: number, bgm: { on: boolean; atMs: number } | undefined, running: boolean) {
  const hostOn = running && (bgm?.on ?? true)
  const hostAt = bgm?.atMs ?? 0
  useEffect(() => {
    set({ gameId, day, hostOn, hostAt, mutedAt: state.gameId === gameId ? state.mutedAt : readMuted(gameId) })
  }, [gameId, day, hostOn, hostAt])
  // 화면을 떠나면 끈다
  useEffect(() => () => set({ hostOn: false }), [])
}

/** 「나」 탭 스위치 */
export function useBgmToggle(): { available: boolean; on: boolean; track: string | null; toggle: () => void } {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
  const track = BGM_TRACKS[s.day]?.name ?? null
  return {
    available: s.hostOn && track !== null,
    on: s.hostOn && s.mutedAt <= s.hostAt,
    track,
    toggle: () => {
      const nowOn = state.mutedAt <= state.hostAt
      const mutedAt = nowOn ? Date.now() : 0
      try {
        if (state.gameId) localStorage.setItem(`${KEY}:${state.gameId}`, String(mutedAt))
      } catch {
        // 못 적으면 이 창에서만 꺼진다
      }
      set({ mutedAt })
    },
  }
}
