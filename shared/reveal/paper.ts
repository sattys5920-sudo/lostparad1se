// 종이 종류.
//
// A의 기록은 일기장 몇 장과, 그날 밤 휴대폰도 없이 창고 안에서 적은
// 메모로 남았다. 그리고 도서부가 찢어 숨긴 한 장이 있다.
//
// 여기에는 종류와 스프라이트 이름만 있다. 문장은 서버 전용이다.
export type PaperKind = 'diary' | 'note' | 'torn'

export interface PaperSpec {
  kind: PaperKind
  /** 도트 스프라이트 이름. 기존 그림체와 겨울 팔레트를 따른다. */
  sprite: string
  /** 화면 낭독기에 읽히는 말. 그림을 못 보는 사람에게도 종류는 전해져야 한다. */
  label: string
}

export const PAPERS: Record<PaperKind, PaperSpec> = {
  diary: { kind: 'diary', sprite: 'paper-diary', label: '일기장 한 장' },
  note: { kind: 'note', sprite: 'paper-note', label: '구겨진 메모지' },
  torn: { kind: 'torn', sprite: 'paper-torn', label: '한쪽이 찢긴 페이지' },
}

export const PAPER_KINDS: readonly PaperKind[] = ['diary', 'note', 'torn']
