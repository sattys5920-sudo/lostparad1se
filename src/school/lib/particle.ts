/**
 * 닉네임은 참가자가 직접 입력하는 값이라 받침이 있을지 없을지 알 수 없다.
 * 조사를 고정해 두면 "나비이 공개했다"처럼 어색해지므로 마지막 글자를 보고 고른다.
 */
function hasFinalConsonant(word: string): boolean {
  const last = word.trim().at(-1)
  if (!last) return false
  const code = last.charCodeAt(0)
  // 한글 음절(가~힣)이 아니면 받침 여부를 알 수 없다 — 있는 쪽으로 둔다.
  if (code < 0xac00 || code > 0xd7a3) return true
  return (code - 0xac00) % 28 !== 0
}

type ParticlePair = ['이', '가'] | ['을', '를'] | ['은', '는'] | ['과', '와']

const PAIRS: Record<'subject' | 'object' | 'topic' | 'with', ParticlePair> = {
  subject: ['이', '가'],
  object: ['을', '를'],
  topic: ['은', '는'],
  with: ['과', '와'],
}

export function withParticle(word: string, kind: keyof typeof PAIRS): string {
  const [withFinal, withoutFinal] = PAIRS[kind]
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`
}
