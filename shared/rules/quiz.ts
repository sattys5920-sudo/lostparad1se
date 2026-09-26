// 문제 종이 — 운영자가 바닥에 놓는 시험지 한 장.
//
// **운영자가 자리를 짚어 놓는다.** 서버가 페이즈마다 무작위로 뿌리던
// 것을 걷어냈다 — 어디에 무엇을 놓을지가 운영자의 수다.
//
//   운영자가  문제 은행에서 하나 골라 칸을 짚어 놓는다. **복도도 된다**
//   주우면    손패에 들어온다. 문제는 주운 사람만 본다
//   푸는 것도 손패에서 한다. 그 자리에 서 있을 필요가 없다
//   맞히면    맞힌 사람 지갑에 지식 1. 그 종이는 끝이다
//   틀리면    그 사람만 다시 못 푼다
//
// **한 명이 맞히면 그 종이는 끝난다.** 같은 문제를 들고 있던 다른
// 사람은 답을 못 적는다 — 먼저 푸는 손이 가져간다.
//
// 전에는 줍는 것이 아니라 그 자리에서 펴는 물건이었고, 펴면 그 방에
// 선 사람 전원이 같이 봤다. 「다른 팀 앞에서 펴는 위험」이 그 설계의
// 전부였는데, 주워서 혼자 푸는 쪽으로 바꾸면서 그 긴장은 없어지고
// **먼저 줍는 사람이 임자**가 됐다.
//
// **정답은 이 파일에 없다.** 여기 두면 shared 라 번들에 실려서,
// 개발자도구를 열 줄 아는 한 사람이 첫날 아침에 전부 읽는다. 문제와
// 정답은 functions/src 아래 secret 에만 있고, 채점도 서버가 한다.
// 역할의 숨긴 사실과 쪽지 문장으로 이미 두 번 겪은 일이다.

import { canStandAt, type Cell } from './board'
import { isFixture } from './fixtures'

/**
 * 여기에 종이를 놓아도 되는가. **방이든 복도든 선 수 있는 칸이면 된다.**
 *
 * 복도를 허용하려고 주소를 방이 아니라 생짜 칸으로 옮겼다. 전에는
 * 「방 하나와 그 안의 칸」이었는데, 복도는 어느 방에도 안 속해서
 * 그 주소로는 가리킬 수가 없었다(덫이 같은 이유로 칸을 쓴다).
 *
 * 기물 위에는 못 놓는다 — 자판기나 화분에 겹치면 종이가 안 보이고,
 * 탭하면 기물이 먼저 열린다.
 */
export function canDropQuizAt(x: number, y: number): boolean {
  return canStandAt(x, y) && !isFixture(x, y)
}

/** 종이 옆인가. 둘레 한 칸 — 게시판·물건과 같은 자다. */
export const atPaper = (me: Cell | null | undefined, cell: Cell | null | undefined): boolean =>
  me != null && cell != null && Math.abs(me.x - cell.x) <= 1 && Math.abs(me.y - cell.y) <= 1


/*
 * 바닥에 놓이는 장수에는 **한도가 없다.**
 *
 * 전에는 여섯 장까지였다. 서버가 페이즈마다 뿌리던 때는 아무도 안 푸는
 * 종이가 쌓여서 「찾았다」가 아무 뜻도 없어졌기 때문이다. 이제는
 * 운영자가 한 장씩 손으로 놓으므로 쌓일 일이 없고, 한도를 두면
 * 하루에 여러 장 깔아야 하는 운영자가 먼저 막힌다.
 */

/** 맞힌 사람 지갑에 들어가는 지식. */
export const KNOWLEDGE_PER_QUIZ = 1

/** 객관식 보기 수. 지금은 객관식을 안 낸다 — 옛 문서를 읽을 때만 쓴다. */
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

/** 'choice' 는 옛 판의 문서에만 남아 있다. 새로 내는 것은 'short' 뿐이다. */
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
