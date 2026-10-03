// 쪽지 — 학교 여기저기에 떨어져 있는 종이 한 장.
//
// 누군가의 비밀이 적혀 있다. 주운 사람은 읽을 수 있고, 읽고 나면 셋 중
// 하나를 한다 — **찢어 없애거나, 아무 방에나 두고 가거나, 사람에게
// 건네거나.** 비밀의 주인에게 건네면서 값을 부를 수도 있다. 그때는
// 교역에 실어 보낸다(deal.ts) — 쪽지도 주고받는 물건이다.
//
// 「추리 노트」(reveal/notes.ts)와는 다른 것이다. 그쪽은 내가 혼자 적는
// 메모고, 이쪽은 판 위에 굴러다니는 물건이다.
//
// **쪽지는 70장, 문안이 정해져 있다**(functions/src/story/slipNotes.ts ·
// docs/notes_56_linked.md). 역할마다 다섯 장이다 — 두 장씩 짝인 넉 장과 미션 한 장. 운영자가
// 배포 탭에서 방을 골라 뿌린다(functions/src/notes.ts).
//
//   누구의 것   그 역할을 받은 사람. 쪽지 미션 「나에 대한 쪽지」가 이걸로 갈린다
//   무엇을      문안 원문. 이름형은 {이름}을 읽는 순간 서버가 실제 이름으로 바꾼다
//   어디에      방 하나. 그 방의 빈 칸에 놓이고 바닥에 종이가 그려진다
//
// **문장은 번들에 없다.** 원문 틀과 역할은 서버 안에만 있고, 읽은 사람
// 몫에만 이름이 끼워진 문장이 간다.

import { josa, type Pair } from '../text'

/**
 * 한 사람 앞으로 놓을 수 있는 쪽지 수. 열넷이면 일흔 장이다.
 *
 * 찢기거나 주워 간 것도 센다 — 판에 나간 수다. 운영자가 거둔 것만
 * 빠진다(거두면 문서가 지워진다).
 */
export const SLIPS_PER_PERSON = 5

/** 쪽지 한 장에 적을 수 있는 길이. 주워서 읽는 것이라 말보다 길다. */
export const SLIP_TEXT_MAX = 300

/** 문장 안에서 쪽지 주인의 이름으로 바뀌는 자리. */
export const SLIP_SUBJECT_MARK = '{이름}'

/**
 * 이름 뒤에 붙여 쓰는 조사. 「{이름}은/는」처럼 적으면 이름 끝을 보고
 * 하나를 고른다 — 운영자가 누구 앞으로 쓸지에 따라 「봇4은」이 되는
 * 일이 없다. 순서를 거꾸로 적어도 알아듣는다.
 */
const PARTICLES: Readonly<Record<string, Pair>> = {
  '을/를': '을/를',
  '를/을': '을/를',
  '이/가': '이/가',
  '가/이': '이/가',
  '은/는': '은/는',
  '는/은': '은/는',
  '와/과': '와/과',
  '과/와': '와/과',
}
/**
 * 문안에 **조사를 한 글자로 붙여 쓴 것.** 쪽지 56장(notes_56_linked.md)은
 * 「{이름}은」「{이름}이」「{이름}이다」처럼 받침 있는 쪽으로 적혀 있다.
 * 문안은 원문 그대로 두고, 끼워 넣을 때 이름 끝을 보고 맞는 쪽을 고른다.
 *
 * 길이가 긴 것부터 본다 — 「이었다」가 「이」보다 먼저다.
 */
const PLAIN: readonly (readonly [string, (name: string) => string])[] = [
  ['이었다', (n) => (josa(n, '이/가') === '이' ? '이었다' : '였다')],
  ['이다', (n) => josa(n, '이다/다')],
  ['은', (n) => josa(n, '은/는')],
  ['는', (n) => josa(n, '은/는')],
  ['이', (n) => josa(n, '이/가')],
  ['가', (n) => josa(n, '이/가')],
  ['을', (n) => josa(n, '을/를')],
  ['를', (n) => josa(n, '을/를')],
  ['과', (n) => josa(n, '와/과')],
  ['와', (n) => josa(n, '와/과')],
]

const MARK_RE = new RegExp(
  `${SLIP_SUBJECT_MARK.replace(/[{}]/g, (c) => `\\${c}`)}(${[...Object.keys(PARTICLES), ...PLAIN.map(([k]) => k)].join('|')})?`,
  'g',
)

/**
 * 이름을 끼워 넣은 한 줄. **서버가 부른다.**
 *
 * 이름을 못 찾으면 「누군가」로 둔다 — 자리를 비운 사람의 쪽지가
 * 화면에서 {이름} 그대로 보이면 안 된다.
 */
export function fillSubject(raw: string, subjectName: string | null): string {
  const name = subjectName ?? '누군가'
  return raw.replace(MARK_RE, (_m, p: string | undefined) => {
    if (!p) return name
    if (p in PARTICLES) return name + josa(name, PARTICLES[p])
    const plain = PLAIN.find(([k]) => k === p)
    return name + (plain ? plain[1](name) : p)
  })
}

/** 아직 안 쓴 자리인가. 화면이 이것으로 「준비 중」을 가른다. */
export const isBlank = (line: string): boolean => line.trim() === '[작성 예정]'
