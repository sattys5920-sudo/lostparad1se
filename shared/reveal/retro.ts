// 회고. 역할을 내려놓는 자리.
//
// 닷새 동안 서로를 의심하고 지운 경험이 게임 밖 관계에 남지 않도록,
// 역할에서 빠져나와 이야기하는 시간을 둔다. 역할은 연기였다는 걸
// 모두가 확인하는 자리다.
//
// 문구는 데이터로 둔다. 진행하는 사람마다 하고 싶은 말이 다르고,
// 코드를 고치지 않고 바꿀 수 있어야 한다.

/** 「역할 내려놓기」 화면에 뜨는 말. */
export const RETRO_TEXT = {
  /** 화면 가운데 큰 글. */
  headline: '닷새 동안의 역할은 여기까지입니다. 여기부터는 연기가 아닌 우리입니다.',
  /** 버튼. */
  action: '역할 내려놓기',
  /** 내려놓은 뒤. */
  after: '완장을 내려놓았습니다.',
  /** 게시판 안내. */
  boardHint: '역할 밖에서 한 줄씩 남깁니다.',
  /** 아직 안 내려놓은 사람에게. */
  locked: '역할을 내려놓아야 쓸 수 있습니다.',
} as const

// ── 회고 게시판 ─────────────────────────────────────────────────

export interface RetroPost {
  id: string
  /**
   * 익명이면 **없다.** null이 아니라 아예 담기지 않는다.
   *
   * 게시판은 모두가 읽는다. 아이디를 담아 두고 화면에서 이름만 가리면,
   * 문서를 직접 읽는 순간 누가 썼는지 그대로 보인다. 익명을 고른 사람은
   * 서버에도 남기지 않는다 — 그래서 본인조차 자기 글을 표시받지 못한다.
   * 그게 익명이다.
   */
  authorId?: string
  /** 실명이 기본이다. 익명을 고르면 이름 대신 「익명」이 뜬다. */
  anonymous: boolean
  text: string
  atMs: number
}

/** 한 줄이다. 길게 쓰는 자리가 아니다. */
export const RETRO_MAX = 200

export type PostRefusal = 'notRetired' | 'empty' | 'tooLong'

export interface PostInput {
  /** 이 사람이 역할을 내려놓았는가. */
  retired: boolean
  text: string
}

/**
 * 쓸 수 있는가.
 *
 * 역할을 내려놓은 사람만 쓴다. 아직 역할 안에 있는 사람이 회고에 끼면,
 * 그 한 줄이 연기인지 아닌지 읽는 쪽이 알 수 없다.
 */
export function canPost(input: PostInput): { ok: boolean; reason: PostRefusal | null } {
  if (!input.retired) return { ok: false, reason: 'notRetired' }
  const text = input.text.trim()
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > RETRO_MAX) return { ok: false, reason: 'tooLong' }
  return { ok: true, reason: null }
}

export const POST_REFUSAL_MESSAGE: Record<PostRefusal, string> = {
  notRetired: RETRO_TEXT.locked,
  empty: '한 줄을 적어 주세요.',
  tooLong: `${RETRO_MAX}자까지 쓸 수 있습니다.`,
}

/** 화면에 뜨는 이름. 익명이면 이름을 **담지 않는다**. */
export interface PostView {
  id: string
  name: string
  text: string
  atMs: number
  mine: boolean
}

/**
 * 게시판을 보는 사람 몫으로 만든다.
 *
 * 익명 글은 쓴 사람이 저장돼 있지 않으므로 「내 글」도 뜨지 않는다.
 * 본인에게만 표시해 주려면 어딘가에 아이디를 남겨야 하고, 남기는 순간
 * 익명이 아니다.
 */
export function boardFor(
  posts: readonly RetroPost[],
  viewerId: string,
  nameOf: (id: string) => string,
): PostView[] {
  return [...posts]
    .sort((a, b) => a.atMs - b.atMs)
    .map((p) => ({
      id: p.id,
      name: p.anonymous || !p.authorId ? '익명' : nameOf(p.authorId),
      text: p.text,
      atMs: p.atMs,
      mine: p.authorId !== undefined && p.authorId === viewerId,
    }))
}

/** 저장할 모양을 만든다. 익명이면 아이디 칸을 아예 만들지 않는다. */
export function newPost(input: {
  id: string
  authorId: string
  anonymous: boolean
  text: string
  atMs: number
}): RetroPost {
  const base = {
    id: input.id,
    anonymous: input.anonymous,
    text: input.text.trim(),
    atMs: input.atMs,
  }
  return input.anonymous ? base : { ...base, authorId: input.authorId }
}

// ── 운영자가 띄우는 안내 ────────────────────────────────────────

export interface RetroNotice {
  /** 「토요일 저녁 8시」처럼 사람이 읽는 말. */
  when: string
  /** 화상 링크. 비어 있으면 줄을 만들지 않는다. */
  link: string
}

export function hasNotice(n: RetroNotice | null | undefined): boolean {
  return Boolean(n && (n.when.trim() || n.link.trim()))
}
