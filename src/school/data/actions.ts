import type { ActionKind, ActionSpec } from '../types'

export const ACTIONS: ActionSpec[] = [
  {
    kind: 'talk',
    label: '대화하기',
    description: '누군가에게 다가가 말을 건다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'visit',
    label: '찾아가기',
    description: '먼저 누군가를 찾아간다.',
    needsTarget: true,
    needsText: false,
    visibility: 'private',
  },
  {
    kind: 'groupPost',
    label: '단체 채팅방에 글 쓰기',
    description: '반 전체가 보는 곳에 글을 남긴다.',
    needsTarget: false,
    needsText: true,
    visibility: 'public',
  },
  {
    kind: 'dm',
    label: '개인 메시지 보내기',
    description: '한 사람에게만 조용히 메시지를 보낸다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'grantFavor',
    label: '부탁 들어주기',
    description: '누군가의 부탁을 들어준다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'rejectFavor',
    label: '부탁 거절하기',
    description: '누군가의 부탁을 거절한다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'spreadRumor',
    label: '소문 퍼뜨리기',
    description: '들은 이야기를 다른 사람에게 옮긴다. 옮기는 과정에서 내용이 달라질 수 있다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'checkRumor',
    label: '소문 확인하기',
    description: '떠도는 이야기가 사실인지 누군가에게 캐묻는다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'lie',
    label: '거짓말하기',
    description: '사실이 아닌 말을 한다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'tellTruth',
    label: '진실 말하기',
    description: '숨겨왔던 사실을 있는 그대로 말한다.',
    needsTarget: true,
    needsText: true,
    visibility: 'private',
  },
  {
    kind: 'beAlone',
    label: '혼자 있기',
    description: '아무도 만나지 않고 오늘을 보낸다.',
    needsTarget: false,
    needsText: false,
    visibility: 'none',
  },
  {
    kind: 'spendTime',
    label: '시간을 보내기',
    description: '한 사람과 오늘 하루의 대부분을 함께 보낸다.',
    needsTarget: true,
    needsText: false,
    visibility: 'private',
  },
  {
    kind: 'publicSupport',
    label: '공개적으로 지지하기',
    description: '모두가 보는 앞에서 누군가의 편을 든다.',
    needsTarget: true,
    needsText: true,
    visibility: 'public',
  },
  {
    kind: 'ignore',
    label: '무시하기',
    description: '누군가를 알면서도 못 본 척한다.',
    needsTarget: true,
    needsText: false,
    visibility: 'private',
  },
]

export const actionByKind: Record<ActionKind, ActionSpec> = Object.fromEntries(
  ACTIONS.map((a) => [a.kind, a]),
) as Record<ActionKind, ActionSpec>

/** 하루에 선택할 수 있는 행동 수. 구조적 기본값 — 실제 플레이 템포에 맞춰 조정 가능. */
export const DAY_ACTION_SLOTS = 3
