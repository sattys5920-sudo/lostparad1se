// 시험에서 사람들을 한자리에 모은다.
//
// 표도 교역도 털어놓기도 **그 자리에서 만나야** 한다(설계 원칙 4).
// 그래서 시험도 걸어서 모여야 한다 — 말 문서를 손으로 옮겨 두면
// 정작 그 규칙이 지켜지는지는 아무것도 확인하지 못한다.
//
// 걷는 데는 칸당 15분이 든다. 다 같이 출발시켜 놓고 시계를 한 번
// 크게 돌린 뒤 따라잡기를 부른다.

export interface Walker {
  token: string
}

export type Call = (name: string, tk: string, data: unknown) => Promise<Record<string, unknown>>

/**
 * 모두를 한 칸으로 걸어 보낸다.
 *
 * @param afterMs 다 걷고 난 뒤의 게임 시각. 여기까지 시계를 돌린다.
 */
export async function meetAt(
  must: Call,
  gameId: string,
  tileId: string,
  walkers: readonly Walker[],
  setClock: (ms: number) => Promise<unknown>,
  afterMs: number,
): Promise<void> {
  for (const w of walkers) {
    // 이미 그 칸에 서 있으면 서버가 거절한다. 그건 그대로 둔다
    await must('moveTo', w.token, { gameId, tileId }).catch(() => undefined)
  }
  await setClock(afterMs)
  await must('tick', walkers[0].token, { gameId })
}
