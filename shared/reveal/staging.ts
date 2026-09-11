// 연출 수치.
//
// 타자 속도와 장면 길이를 한곳에 모은다. 돌려 보면서 조정할 값들이라
// 화면 코드 안에 흩어 두면 다시 못 찾는다.
//
// 모든 값은 **실제 밀리초**다. 게임 시계와는 무관하다 — 연출은 게임 속
// 시간이 아니라 사람이 읽는 속도로 흐른다. 반대로 「언제 재생하는가」는
// 전부 게임 시계를 거친다(clock.ts).

/** 한 글자를 찍는 데 걸리는 시간. */
export const TYPE_MS_PER_CHAR = 45
/** 찢긴 한 장은 절반 속도로 찍는다. 마지막 글이니까. */
export const TORN_TYPE_FACTOR = 2
/** 줄과 줄 사이 쉼. */
export const TYPE_LINE_GAP_MS = 400
/** 탭하면 남은 글자가 한 번에 찍힌다. 그 뒤 다음 탭까지의 최소 간격. */
export const TAP_GUARD_MS = 200

/** 검은 화면의 날짜 카드가 머무는 시간. */
export const DATE_CARD_MS = 2200
/** 「오늘 일어나는 일」 카드. */
export const TODAY_CARD_MS = 3200
/** 미니맵으로 돌아와 지목 칸을 강조하는 시간. */
export const SPOT_HIGHLIGHT_MS = 3000
/** 찢긴 한 장이 끝나고 공동 엔딩 칠판까지의 암전. */
export const TORN_BLACKOUT_MS = 3000
/** 엔딩에서 전말 한 줄과 다음 줄 사이. 도트 캐릭터가 하나씩 선다. */
export const AFTERMATH_LINE_MS = 1800
/** 장면과 장면 사이 넘어가는 시간. */
export const SCENE_FADE_MS = 600

/** 카메라가 종이 위쪽으로 올라가는 시간(DAY 5 맨 위). */
export const PAPER_PAN_MS = 1400

/** 눈 파티클의 단계별 초당 입자 수. 0단계는 그친 것이다. */
export const SNOW_PARTICLES: readonly number[] = [0, 8, 18, 32, 50, 72]

/** 움직임을 줄여 달라고 한 사람에게는 타자와 카메라를 건너뛴다. */
export const REDUCED_MOTION_TYPE_MS = 0

/**
 * 종이 위 본문의 줄 높이(CSS px)와 확대 배율.
 *
 * 이 둘이 괘선 간격을 정한다. 줄 높이와 괘선이 어긋나면 글씨가 줄 위에
 * 떠 있거나 파고들어서, 줄 노트로 보이지 않고 그냥 배경 무늬가 된다.
 * 그래서 한곳에서만 정하고 캔버스와 CSS가 같이 읽는다.
 */
export const PAPER_SCALE = 2
export const PAPER_LINE_H = 20
/** 확대 전 괘선 간격. 줄 높이를 배율로 나눈 값이다. */
export const PAPER_RULE_STEP = PAPER_LINE_H / PAPER_SCALE
