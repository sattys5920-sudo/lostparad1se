import type { TeamId } from '../rules/v2'
import { byBundan, teamName } from '../rules/bundan'

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

export const NOTICE_MAX = 300

export interface Notice {
  id: string
  /** null이면 전원에게. */
  toPlayerId: string | null
  text: string
  atMs: number
  /** 운영자의 「1위 발표」. 그 순간 1위였던 팀 — 공동이면 여럿 */
  leader?: TeamId[]
}

/** 화면에 내려보내는 한 줄. 누가 보냈는지(byId)는 안 싣는다 */
export interface NoticeLine {
  id: string
  text: string
  atMs: number
  leader?: TeamId[]
}

export function noticeLine(n: Notice): NoticeLine {
  return { id: n.id, text: n.text, atMs: n.atMs, ...(n.leader && n.leader.length > 0 ? { leader: [...n.leader] } : {}) }
}

/**
 * 1위 발표 문장. 방 수로 센 순위의 1위 — 공동이면 함께 적는다.
 * 방을 가진 팀이 하나도 없으면 null(발표할 것이 없다).
 */
export function leaderText(teams: readonly TeamId[], rooms: number): string | null {
  if (teams.length === 0 || rooms <= 0) return null
  // 1분단부터 적는다 — 안쪽 글자 순(A · B)으로 적으면 「2분단 · 1분단」이 된다
  const names = [...teams].sort(byBundan).map((t) => teamName(t)).join(' · ')
  return teams.length === 1
    ? `지금 1 위는 ${names}입니다. 방 ${rooms} 개.`
    : `지금 공동 1 위는 ${names}입니다. 방 ${rooms} 개씩.`
}

export type NoticeRefusal = 'empty' | 'tooLong'

export function checkNotice(text: string): { ok: boolean; reason: NoticeRefusal | null } {
  const t = text.trim()
  if (t.length === 0) return { ok: false, reason: 'empty' }
  if (t.length > NOTICE_MAX) return { ok: false, reason: 'tooLong' }
  return { ok: true, reason: null }
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
