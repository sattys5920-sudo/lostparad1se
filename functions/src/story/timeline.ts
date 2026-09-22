// 텍스트 검수용 시간 태그. **서버 전용 · 운영자만.**
//
// A에 관한 문장을 전부 사건 시간순으로 늘어놓고 모순을 찾는 자리다.
// 문장을 고치는 곳이 아니라, 어긋난 곳을 **보는** 곳이다.
//
// 태그가 없는 문장은 목록 맨 위에 경고로 뜬다. 새 문장을 넣고 태그를
// 잊으면 바로 눈에 띈다.
import type { RoleId } from '../../../shared/missions/roleNames'

/** 사건의 시간축. scenario_reveal 2장의 뼈대 그대로다. */
export type TimeTag =
  | 'term'
  | 't1650'
  | 't1700'
  | 't1710'
  | 't1730'
  | 't1800'
  | 't1900'
  | 't2100'
  | 'nextDay'
  | 'anytime'

export const TIME_ORDER: readonly TimeTag[] = [
  'term',
  't1650',
  't1700',
  't1710',
  't1730',
  't1800',
  't1900',
  't2100',
  'nextDay',
  'anytime',
]

export const TIME_LABEL: Record<TimeTag, string> = {
  term: '학기 중',
  t1650: '16:50',
  t1700: '17:00',
  t1710: '17:10',
  t1730: '17:30',
  t1800: '18:00',
  t1900: '19:00',
  t2100: '21:00',
  nextDay: '다음 날',
  anytime: '시간 무관',
}

/** 문장에서 강조할 장소. 같은 장소가 다른 시각에 나오면 눈에 띈다. */
export const PLACES: readonly string[] = [
  '창고',
  '음악실',
  '복도',
  '도서관',
  '과학실',
  '교실',
  '운동장',
  '강당',
  '방송실',
  '학생회실',
  '동아리실',
  '급식실',
  '체육관',
  '중앙광장',
  '정원',
  '옥상',
  '구관',
  '별관',
  '신관',
  '본관',
  '단톡방',
  // 방 이름을 갈면서 생긴 새 이름들. 옛 이름도 위에 그대로 둔다 —
  // 이야기 문장은 예전 이름으로 쓰여 있고 한 글자도 안 고쳤다
  '2-3 교실',
  '교무실',
  '화장실',
  '기술실',
  '시청각실',
  '가사실',
  '상점',
  '경비실',
  '무용실',
  '양호실',
]

// ── 태그 매핑 ───────────────────────────────────────────────────
//
// 문장 자체는 각자의 파일에 있고, 여기서는 **어느 문장이 언제인지만**
// 정한다. 문장을 고쳐도 이 표는 그대로 쓸 수 있다.

/** 역할의 숨긴 사실이 가리키는 때. */
export const SECRET_TIME: Record<RoleId, TimeTag> = {
  mediator: 'term',
  transfer: 'term',
  librarian: 'term',
  notebook: 'term',
  shadow: 'term',
  leaver: 'term',
  buddy: 'term',
  letter: 't1650',
  accuser: 't1710',
  vanguard: 't1730',
  witness: 't1730',
  liar: 't1800',
  guard: 't1900',
  bystander: 't2100',
}

/** A의 시선이 가리키는 때. 대체로 숨긴 사실과 같은 순간이다. */
export const SIGHT_TIME: Record<RoleId, TimeTag> = {
  ...SECRET_TIME,
  // 지킴이의 시선은 자물쇠 소리를 들은 그 순간이다
  guard: 't1900',
  // 도서부의 시선은 창가 자리 이야기라 학기 중이다
  librarian: 'term',
}

/** A의 기록 다섯 장이 적힌 때. */
export const FRAGMENT_TIME: Record<number, TimeTag> = {
  1: 'term',
  2: 't1730',
  3: 't1710',
  4: 't1800',
  5: 't1900',
}

/** A의 기억 열세 장면은 전부 학기 중이다. 그날 저녁 일이 아니다. */
export const MEMORY_TIME: TimeTag = 'term'

/** 오프닝은 게임 속 시간이라 사건 시간축 밖이다. */
export const OPENING_TIME: TimeTag = 'anytime'

// ── 검수 항목 ───────────────────────────────────────────────────

// 엔딩 열 장면을 없애면서 전말 · 찢긴 한 장 · 공동 엔딩이 빠졌다
export type AuditSource = 'opening' | 'fragment' | 'secret' | 'memory' | 'sight'

export const SOURCE_LABEL: Record<AuditSource, string> = {
  opening: '오프닝',
  fragment: 'A의 기록',
  secret: '숨긴 사실',
  memory: 'A의 기억',
  sight: 'A의 시선',
}

export interface AuditLine {
  source: AuditSource
  /** 「DAY 3」이나 「지킴이」처럼 어디서 온 줄인지. */
  where: string
  text: string
  /** 태그가 없으면 null. 맨 위에 경고로 뜬다. */
  tag: TimeTag | null
}

/** 시간순으로 정렬한다. 태그 없는 줄이 맨 위다. */
export function sortForAudit(lines: readonly AuditLine[]): AuditLine[] {
  const at = (t: TimeTag | null) => (t === null ? -1 : TIME_ORDER.indexOf(t))
  return [...lines].sort(
    (a, b) => at(a.tag) - at(b.tag) || a.source.localeCompare(b.source) || a.where.localeCompare(b.where),
  )
}

/** 태그가 없는 줄. 새 문장을 넣고 태그를 잊으면 여기 걸린다. */
export function untagged(lines: readonly AuditLine[]): AuditLine[] {
  return lines.filter((l) => l.tag === null)
}

/** 문장 안의 장소를 찾는다. 화면이 이 자리를 강조한다. */
export function placesIn(text: string): string[] {
  return PLACES.filter((p) => text.includes(p))
}
