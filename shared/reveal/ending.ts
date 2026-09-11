// 엔딩 열 장면.
//
// 감정이 올라가는 순서다. 개인에서 사건 전체로, 사건에서 우리 자신으로,
// 우리에서 A로, 그리고 A의 처음으로.
//
// 순서는 scenario_reveal.md 5장 표 그대로다. otherworld_setting 8장은
// 거울 규칙을 전말보다 먼저 두지만, 우선순위에 따라 scenario 쪽을 따른다.
//
// 문장은 여기 없다. 장면의 순서와 「언제 건너뛰는가」만 있다.

export type SceneId =
  | 'closing'
  | 'teamResult'
  | 'personal'
  | 'aftermath'
  | 'mirror'
  | 'unheard'
  | 'aWords'
  | 'tornPage'
  | 'commonEnding'
  | 'archive'

export interface SceneSpec {
  id: SceneId
  /** 화면 맨 위에 뜨는 이름. */
  title: string
}

export const SCENES: readonly SceneSpec[] = [
  { id: 'closing', title: '종례' },
  { id: 'teamResult', title: '팀 결과' },
  { id: 'personal', title: '개인 엔딩' },
  { id: 'aftermath', title: '그날의 전말' },
  { id: 'mirror', title: '거울 규칙' },
  { id: 'unheard', title: '들리지 않았던 말' },
  { id: 'aWords', title: 'A가 남긴 말' },
  { id: 'tornPage', title: '찢긴 한 장' },
  { id: 'commonEnding', title: '공동 엔딩' },
  { id: 'archive', title: '기록 보관소' },
]

export const SCENE_IDS: readonly SceneId[] = SCENES.map((s) => s.id)

export interface SkipInput {
  /** 닷새 동안 투명인간이 한 번이라도 있었는가. */
  hadInvisible: boolean
}

/**
 * 이번 판에서 건너뛸 장면.
 *
 * 「들리지 않았던 말」은 투명인간이 지워진 동안 전체 채팅에 쓴 말을
 * 원문으로 되돌려 보여 주는 자리다. 닷새 내내 아무도 지워지지 않았다면
 * 되돌릴 말이 없다 — 빈 화면을 띄우는 대신 넘어간다.
 */
export function skippedScenes(input: SkipInput): SceneId[] {
  return input.hadInvisible ? [] : ['unheard']
}

export function playedScenes(input: SkipInput): SceneSpec[] {
  const skip = new Set(skippedScenes(input))
  return SCENES.filter((s) => !skip.has(s.id))
}

/** 다음 장면. 마지막이면 null. */
export function nextScene(current: SceneId, input: SkipInput): SceneId | null {
  const list = playedScenes(input).map((s) => s.id)
  const at = list.indexOf(current)
  if (at < 0 || at === list.length - 1) return null
  return list[at + 1]
}

export function prevScene(current: SceneId, input: SkipInput): SceneId | null {
  const list = playedScenes(input).map((s) => s.id)
  const at = list.indexOf(current)
  return at > 0 ? list[at - 1] : null
}

/** 몇 번째 장면인가. 진행 표시에 쓴다. */
export function sceneIndex(current: SceneId, input: SkipInput): { at: number; total: number } {
  const list = playedScenes(input).map((s) => s.id)
  return { at: list.indexOf(current) + 1, total: list.length }
}
