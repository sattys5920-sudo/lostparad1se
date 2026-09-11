// 운영자 공지.
//
// 전원 또는 한 명에게 게임 안에서 말을 건다. 운영자 수칙이 「진상을
// 설명하지 않는다」이므로, 템플릿도 설명하지 않는 말들이다.
//
// 자유 문구도 쓸 수 있다. 다만 템플릿을 앞에 두는 이유는, 급할 때
// 무슨 말을 해야 할지 이미 정해져 있는 편이 낫기 때문이다.

export interface NoticeTemplate {
  id: string
  label: string
  text: string
}

export const NOTICE_TEMPLATES: readonly NoticeTemplate[] = [
  {
    id: 'readAgain',
    label: '기록을 다시',
    text: '기록을 다시 읽어 보세요.',
  },
  {
    id: 'stopOutside',
    label: '게임 밖 공격',
    text: '게임 밖 공격은 멈춰 주세요.',
  },
  {
    id: 'retro',
    label: '회고 안내',
    text: '종례가 끝나면 회고 시간을 가집니다. 역할을 내려놓고 이야기하는 자리입니다.',
  },
]

export const TEMPLATE_BY_ID: Record<string, NoticeTemplate> = Object.fromEntries(
  NOTICE_TEMPLATES.map((t) => [t.id, t]),
)

export const NOTICE_MAX = 300

export interface Notice {
  id: string
  /** null이면 전원에게. */
  toPlayerId: string | null
  text: string
  atMs: number
}

export type NoticeRefusal = 'empty' | 'tooLong'

export function checkNotice(text: string): { ok: boolean; reason: NoticeRefusal | null } {
  const t = text.trim()
  if (t.length === 0) return { ok: false, reason: 'empty' }
  if (t.length > NOTICE_MAX) return { ok: false, reason: 'tooLong' }
  return { ok: true, reason: null }
}

export const NOTICE_REFUSAL_MESSAGE: Record<NoticeRefusal, string> = {
  empty: '보낼 말을 적어 주세요.',
  tooLong: `${NOTICE_MAX}자까지 보낼 수 있습니다.`,
}

/**
 * 그 사람에게 보일 공지.
 *
 * 한 명에게 보낸 공지는 **그 사람에게만** 간다. 전체 공지와 한 사람
 * 공지가 같은 자리에 쌓이므로, 서버가 사람마다 따로 만들어 내려보낸다.
 */
export function noticesFor(all: readonly Notice[], viewerId: string): Notice[] {
  return all
    .filter((n) => n.toPlayerId === null || n.toPlayerId === viewerId)
    .sort((a, b) => a.atMs - b.atMs)
}
