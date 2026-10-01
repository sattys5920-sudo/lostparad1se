// 알림 — 종류 · 문구 · 기본값 · 조용한 시간. **숫자와 문구는 전부 여기.**
//
// 서버(functions/src/notify.ts)가 보낼지 말지를 다 정하고, 화면은 이 파일로
// 설정 칸과 배너를 그린다. **알림에는 내용이 없다.** 태그는 누가 무슨 말을
// 했는지 안 싣고, 공지는 「새 공지」뿐이고, 페이즈 종료는 결과를 안 싣는다 —
// 잠긴 화면에 뜨는 글은 옆 사람도 본다.

export type NotifyType = 'tag' | 'phaseStart' | 'phaseEnd' | 'made' | 'notice'

/** 끄기 · 앱 안에서만 · 앱 밖에서도(웹 푸시) */
export type NotifyMode = 'off' | 'app' | 'push'

export const NOTIFY_TYPES: readonly NotifyType[] = ['tag', 'phaseStart', 'phaseEnd', 'made', 'notice']

export const NOTIFY_LABEL: Record<NotifyType, string> = {
  tag: '태그',
  phaseStart: '페이즈 시작',
  phaseEnd: '페이즈 종료',
  made: '제작 완료',
  notice: '공지',
}

/**
 * 처음에는 **받기(앱 안)** 로 모두 같다. 앱 밖(휴대폰 알림)은 「앱 밖에서도
 * 받기」를 눌러 이 기기에서 권한을 받은 뒤에야 켠다 — 권한도 없는데 앱 밖으로
 * 고른 것처럼 보이면 안 된다
 */
export const NOTIFY_DEFAULT: Record<NotifyType, NotifyMode> = {
  tag: 'app',
  phaseStart: 'app',
  phaseEnd: 'app',
  made: 'app',
  notice: 'app',
}

/** 알림 한 줄 — 배너와 잠긴 화면에 뜨는 글 */
export const NOTIFY_TEXT: Record<NotifyType, string> = {
  tag: '무전에서 누가 나를 불렀다',
  phaseStart: '페이즈가 시작됐다',
  phaseEnd: '페이즈가 끝났다',
  made: '맡긴 것이 다 됐다',
  notice: '새 공지',
}

/** 누르면 갈 곳 — 탭 이름 */
export type NotifyLink = 'map' | 'me' | 'radio' | 'vote' | 'memo'
export const NOTIFY_LINK: Record<NotifyType, NotifyLink> = {
  tag: 'radio',
  phaseStart: 'map',
  phaseEnd: 'map',
  made: 'map',
  notice: 'map',
}

/** 잠긴 화면 알림 제목 */
export const PUSH_TITLE = '투명인간'

/** 조용한 시간(서울) — 이 사이에는 앱 밖으로 안 보낸다. 제작 완료는 끝나는 시각에 모아 보낸다 */
export const QUIET_FROM_HOUR = 0
export const QUIET_TO_HOUR = 8

/** 한 사람에게 1분에 이보다 많이 오면 한 줄로 묶는다 */
export const BURST_PER_MINUTE = 5
export const burstText = (n: number): string => `알림 ${n} 건`

/** 모아 보낸 제작 완료 */
export const madeBatchText = (n: number): string => (n > 1 ? `맡긴 것 ${n} 건이 다 됐다` : NOTIFY_TEXT.made)

/** 「나」 탭 보관함에 남기는 수 */
export const ARCHIVE_MAX = 20

/** 배너 — 떠 있는 시간 · 한 번에 쌓이는 수 */
export const BANNER_MS = 3000
export const BANNER_MAX = 2

/** 권한을 거절당했을 때 */
export const DENIED_TEXT = '브라우저가 알림을 막았다. 앱 안에서만 알린다. 브라우저 설정에서 이 사이트의 알림을 허용하면 다시 고를 수 있다.'
/** 아이폰에서 홈 화면에 안 넣었을 때 */
export const IOS_GUIDE = '아이폰은 홈 화면에 추가한 앱에서만 앱 밖 알림을 받는다. 사파리 아래 공유 단추 → 「홈 화면에 추가」 → 추가한 아이콘으로 다시 연다.'

export interface NotifySettings {
  /** 전체 스위치. 끄면 아무것도 안 온다 */
  on: boolean
  modes: Record<NotifyType, NotifyMode>
}

export const DEFAULT_SETTINGS: NotifySettings = { on: true, modes: { ...NOTIFY_DEFAULT } }

/** 보관함 한 줄 */
export interface NoteItem {
  id: string
  type: NotifyType
  text: string
  link: NotifyLink
  atMs: number
  /** 묶였으면 몇 건인가 */
  count?: number
}

/** 저장된 설정을 읽는다 — 빈 칸 · 모르는 값은 기본값 */
export function settingsOf(raw: unknown): NotifySettings {
  const r = (raw ?? {}) as { on?: unknown; modes?: Record<string, unknown> }
  const modes = { ...NOTIFY_DEFAULT }
  for (const t of NOTIFY_TYPES) {
    const m = r.modes?.[t]
    if (m === 'off' || m === 'app' || m === 'push') modes[t] = m
  }
  return { on: r.on !== false, modes }
}

/** 서울 시각으로 조용한 시간인가 */
export function isQuiet(ms: number): boolean {
  const h = Math.floor((((ms + 9 * 3_600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000)
  return h >= QUIET_FROM_HOUR && h < QUIET_TO_HOUR
}

/** 조용한 시간이 끝나는 시각(서울 08:00). 조용한 시간이 아니면 그 시각 그대로 */
export function quietEndsAt(ms: number): number {
  if (!isQuiet(ms)) return ms
  const day = Math.floor((ms + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000
  return day + QUIET_TO_HOUR * 3_600_000
}
