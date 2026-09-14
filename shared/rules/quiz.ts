// 문제 종이 — 바닥에 떨어진 시험지 한 장.
//
// 쪽지(reveal/slips.ts)와 같은 방식으로 떨어지지만 다루는 법이 반대다.
// 쪽지는 주워서 **혼자** 읽고 감추는 것이고, 문제는 그 자리에서 펴서
// **같이** 보는 것이다. 들고 갈 수도 건넬 수도 없다.
//
//   서 있으면   「문제가 한 장 있다」까지만 보인다
//   열면        그 방에 선 사람 **전원**에게 문제와 보기가 보인다
//   맞히면      그 팀 금고에 지식 1. 종이는 사라진다
//   틀리면      그 사람만 다시 못 푼다. 같은 팀 다른 사람은 풀 수 있다
//
// 다른 팀 사람 앞에서 여는 것이 이 물건의 전부다. 열지 않으면 아무도
// 못 풀고, 열면 상대도 같이 본다 — 먼저 푸는 쪽이 가져간다.
//
// **정답은 이 파일에 없다.** 여기 두면 shared 라 번들에 실려서,
// 개발자도구를 열 줄 아는 한 사람이 첫날 아침에 전부 읽는다. 문제와
// 정답은 functions/src 아래 secret 에만 있고, 채점도 서버가 한다.
// 역할의 숨긴 사실과 쪽지 문장으로 이미 두 번 겪은 일이다.

/** 한 페이즈가 닫힐 때 새로 떨어지는 문제 종이 수. */
export const QUIZ_PER_PHASE = 2

/**
 * 바닥에 동시에 놓일 수 있는 문제 종이의 한도.
 *
 * 아무도 안 푸는 종이가 쌓이면 어느 방에나 문제가 있게 되고, 「찾았다」가
 * 아무 뜻도 없어진다. 한도에 닿으면 더 안 뿌린다.
 */
export const QUIZ_ON_FLOOR_MAX = 6

/** 맞힌 팀 금고에 들어가는 지식. */
export const KNOWLEDGE_PER_QUIZ = 1

/** 객관식 보기 수. */
export const QUIZ_CHOICES = 4

/**
 * 판을 시작하기 전에 등록돼 있어야 할 문제 수.
 *
 * 닷새 · 쉰 페이즈에 두 장씩이면 백 장이 필요하지만, 바닥 한도와
 * 안 풀리고 사라지는 몫을 감안하면 예순이 실질적인 바닥이다. 모자라도
 * 판은 돌아간다 — 도중에 문제가 떨어지지 않을 뿐이라, 막지 않고
 * 운영자 화면에 경고만 띄운다.
 */
export const QUIZ_MIN_BANK = 60

export type QuizKind = 'choice' | 'short'

/**
 * 단답형 채점을 위해 다듬은 글자열.
 *
 *   앞뒤 공백을 떼고, 가운데 연속된 공백은 하나로
 *   영문 대소문자를 무시하고
 *   한글 자모를 합쳐 놓는다(NFC)
 *
 * 마지막 것이 없으면 「사과」를 자모로 친 답과 완성형으로 친 답이
 * 서로 다른 글자열이 된다 — 눈으로는 똑같아 보이는데 틀렸다고 나온다.
 * 모바일 자판에 따라 실제로 갈린다.
 */
export function normalizeAnswer(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 맞혔는가. **서버에서만 부른다.**
 *
 * 정답을 여러 개 등록할 수 있다 — 동의어와 표기 차이를 운영자가 미리
 * 적어 두는 편이, 채점 규칙을 똑똑하게 만드는 것보다 정확하다.
 */
export function isCorrect(given: string, answers: readonly string[]): boolean {
  const mine = normalizeAnswer(given)
  if (mine === '') return false
  return answers.some((a) => normalizeAnswer(a) === mine)
}

/** 등록된 문제가 권장치에 닿았는가. 운영자 화면이 이걸로 경고를 낸다. */
export const bankIsThin = (count: number): boolean => count < QUIZ_MIN_BANK
