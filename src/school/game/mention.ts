// 무전 태그 — 「@이름」. 순수 함수만. 시험은 mention.test.ts.
//
// 서버는 이름이 글에 들어 있으면 그 사람에게 알린다(functions/src/radio.ts).
// 여기서는 치는 중에 이름을 골라 끼워 주기만 한다.

/** 치는 줄 끝의 「@…」. 없으면 null */
export function mentionQuery(draft: string): string | null {
  const m = /(?:^|\s)@(\S*)$/.exec(draft)
  return m ? m[1] : null
}

/** 고를 수 있는 이름 — 나를 빼고, 친 앞글자로 거른다 */
export function mentionPicks(names: readonly string[], query: string, me: string): string[] {
  return names.filter((n) => n.length > 0 && n !== me && n.startsWith(query)).slice(0, 8)
}

/** 끝의 「@…」를 「@이름 」으로 바꾼다 */
export function insertMention(draft: string, name: string): string {
  return draft.replace(/@(\S*)$/, `@${name} `)
}
