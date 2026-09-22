// 무전의 규칙.
//
// 주파수와 시스템 줄과 시각 표기. **화면과 서버가 같은 것을 본다** —
// 시스템 줄 문장을 서버가 짜서 그대로 내려보내기 때문이다. 문장을
// 화면에서 조립하면 같은 사건이 사람마다 다른 말로 뜬다.
//
// 대화는 어떤 판정에도 쓰지 않는다. 시스템 줄도 마찬가지다 —
// 이미 그 팀이 아는 것을 한 줄로 적어 주는 것뿐이고, 여기 없는 것을
// 알려 주지 않는다.
import { josa } from '../text'
import type { TeamId } from './v2'

/**
 * 팀마다 주파수가 다르다.
 *
 * 숫자에 판정이 걸려 있지 않다 — 「우리 줄」이 눈에 익으라고 붙인
 * 이름표다. 남의 주파수로 맞춰 들을 수는 없다. 거르는 일은 서버가
 * 하고, 화면에는 애초에 우리 것만 온다.
 */
export const TEAM_FREQ: Record<TeamId, string> = {
  A: '87.5',
  B: '89.1',
  C: '91.7',
  D: '93.2',
}

/**
 * 「수신 n」이 세는 것.
 *
 * **켜 둔 사람을 센다.** 지도의 실시간 자리(live)는 걷는 동안에만
 * 적히고 6초면 낡아서, 방에 가만히 선 팀원이 곧바로 「없는 사람」이
 * 된다 — 무전 인원으로는 못 쓴다. 대신 무전을 가져가는 일 자체를
 * 맥으로 센다. 앱을 켜 두고 있으면 탭이 어디에 있든 계속 가져간다.
 *
 * 너무 자주 적지 않는다. 가져가는 간격(2.5초)마다 쓰면 열넷이 초당
 * 대여섯 번 쓴다 — 절반쯤 낡았을 때만 다시 적는다.
 */
export const RADIO_BEAT_MS = 10_000
/** 이보다 오래 조용하면 껐다고 본다. 맥 두 번을 놓칠 여유다. */
export const RADIO_STALE_MS = 25_000

/** 입력 칸 아래 한 줄. 무전이 무엇인지 여기 다 적는다. */
export const RADIO_NOTE =
  '같은 팀끼리만 닿는다. 학교 어디에 있든 닿고, 걷는 중에도 닿는다. 점수에는 들어가지 않는다.'

// ── 시각 ────────────────────────────────────────────────────────

const two = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, '0')

/**
 * 한 줄 앞에 찍는 시각.
 *
 * **페이즈 중에는 그 교시가 열린 뒤로 얼마나 지났는가**(00:12)다.
 * 「몇 시」보다 「몇 분 남았나」가 중요한 시간이라, 벽시계를 적어
 * 두면 매번 빼서 계산해야 한다. 자유 시간에는 반대로 그냥 시계다.
 *
 * openedAtMs 가 null 이면 자유 시간이다.
 */
export function stampOf(atMs: number, openedAtMs: number | null, secondsIntoDay: number): string {
  if (openedAtMs === null) {
    const s = Math.max(0, Math.floor(secondsIntoDay))
    return `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}`
  }
  const sec = Math.max(0, Math.floor((atMs - openedAtMs) / 1000))
  // 한 교시가 두 시간을 넘을 일은 없지만, 넘어도 칸이 안 밀려야 한다
  return `${two(Math.min(99, Math.floor(sec / 60)))}:${two(sec % 60)}`
}

// ── 파형 ────────────────────────────────────────────────────────

/** 막대 수. 홀수로 두면 가운데가 생겨서 계기판처럼 보인다 */
export const WAVE_BARS = 13
/** 막대 한 칸의 최대 높이(px). 정수 배로만 움직인다 */
export const WAVE_MAX = 16
/**
 * 접속 인원별 진폭. **아무도 없으면 가라앉는다.**
 *
 * 0명은 1이다 — 0으로 두면 막대가 사라져서 「고장 났다」로 보인다.
 * 한 줄로 남아 있어야 「켜져 있는데 조용하다」가 된다.
 */
export const WAVE_AMP: readonly number[] = [1, 5, 8, 11, 14]

/**
 * i번째 막대의 지금 높이. **정수만 돌려준다.**
 *
 * frame 은 초당 여덟 번쯤 오른다. 매 프레임 부드럽게 잇지 않는 것이
 * 일부러다 — 도트 화면에서 0.4px 씩 움직이면 막대 끝이 흐려진다.
 */
export function waveAt(i: number, frame: number, connected: number, spiking: boolean): number {
  const amp = spiking ? WAVE_MAX : (WAVE_AMP[Math.min(connected, WAVE_AMP.length - 1)] ?? 1)
  if (amp <= 1) return 1
  const phase = frame * 0.6 + i * 0.9
  // 두 겹을 겹쳐서 옆칸과 닮았지만 똑같지는 않게 한다
  const wob = (Math.sin(phase) + Math.sin(phase * 1.7 + i)) / 2
  return Math.max(1, Math.min(WAVE_MAX, Math.round(1 + ((wob + 1) / 2) * (amp - 1))))
}

// ── 시스템 줄 ───────────────────────────────────────────────────

/**
 * 팀 대화 사이에 끼는 알림.
 *
 * **이미 그 팀이 아는 것만 적는다.** 무전만 봐도 팀 상황이 따라와야
 * 하지만, 여기가 새로운 정보가 새는 구멍이 되면 안 된다 — 방이
 * 넘어간 것도 팀원이 지워진 것도 그 팀은 원래 본다.
 */
export const sys = {
  phaseOpen: (no: number): string => `${no}교시가 열렸다.`,
  phaseClose: (no: number): string => `${no}교시가 닫혔다.`,
  roomTaken: (room: string): string => `${room}${josa(room, '을/를')} 차지했다.`,
  roomLost: (room: string, to: TeamId | null): string =>
    to === null
      ? `${room}${josa(room, '을/를')} 놓쳤다.`
      : `${room}${josa(room, '을/를')} ${to}팀에게 빼앗겼다.`,
  captain: (team: TeamId, name: string) => `${team}팀 팀장은 ${name}${josa(name, '이/가')} 됐다.`,
  invisible: (name: string): string => `${name}${josa(name, '은/는')} 오늘 보이지 않는다.`,
  movedOut: (name: string, to: TeamId): string => `${name}${josa(name, '이/가')} ${to}팀으로 갔다.`,
  movedIn: (name: string): string => `${name}${josa(name, '이/가')} 우리 팀으로 왔다.`,
} as const
