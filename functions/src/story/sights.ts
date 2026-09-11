// 그 자리와 A의 시선. **서버 전용.**
//
// 역할마다 「그 자리」가 있다. 내가 A에게 그 일을 했던 곳이다.
// 그 자리에 누적 세 시간 서 있으면 A의 시선이 열린다.
//
// **이 짝을 클라이언트에 보내면 안 된다.** 짝을 알면 누가 어디에 오래
// 서 있는지만 보고 역할을 역산한다 — 창고에 세 시간 서 있는 사람은
// 지킴이 아니면 거짓말쟁이다. 그래서 그 자리는 본인의 역할 카드로만,
// A의 시선은 열린 본인에게만 내려간다.
//
// 출처: otherworld_setting.md 4장.
import type { RoleId } from '../../../shared/missions/roles'
import type { TileId } from '../../../shared/rules/board'

export interface SightRow {
  role: RoleId
  /** 그 자리. */
  tile: TileId
  /** A의 목소리로 적힌 짧은 글. 열리면 깨달음 +1. */
  text: string
}

export const SIGHTS: readonly SightRow[] = [
  {
    role: 'guard',
    tile: 'storage',
    text: '철컥, 소리가 났어. 그게 무슨 소리인지 알았어. 네 발소리가 멀어지는 동안, 계속 두드렸어.',
  },
  {
    role: 'vanguard',
    tile: 'playground',
    text: '끌려가면서 운동장에 첫눈이 쌓이는 걸 봤어. 네가 웃고 있어서, 정말 장난인 줄 알았어. 휴대폰은 돌려받을 줄 알았어.',
  },
  {
    role: 'librarian',
    tile: 'library',
    text: '그 창가 자리, 오후 네 시에 햇빛이 제일 오래 머물러. 거기서만 숨이 쉬어졌어. 겨우 자리 하나였지. 너한테도, 나한테도.',
  },
  {
    role: 'shadow',
    tile: 'scienceRoom',
    text: '봉투에 넣은 건 급식비였어. 빈손으로 간 날, 한 번쯤은 괜찮다고 해 줄 줄 알았어.',
  },
  {
    role: 'buddy',
    tile: 'classroom',
    text: "너는 'ㅇ'을 늘 두 번 돌려 써. 그걸 알아본 순간이 창고보다 추웠어. 네가 다음이 될까 봐 무서웠던 거, 알아. 나였어도 그랬을까.",
  },
  {
    role: 'witness',
    tile: 'hallway',
    text: '복도 끝에 네가 있었어. 한 번만 내 이름을 불러 주면 될 것 같았어. 네가 고개를 돌렸을 때, 나도 소리 지르는 걸 그만뒀어.',
  },
  {
    role: 'liar',
    tile: 'storage',
    text: '문이 닫힐 때 네 웃음소리가 들렸어. 그 웃음이 무서웠던 게 아니야. 네가 정말 아무렇지 않아 보여서, 그게 무서웠어.',
  },
  {
    role: 'accuser',
    tile: 'musicRoom',
    text: '무섭다고 말한 건 네가 처음이었어. 읽음 표시를 보고 안심했어. 네가 오는 줄 알았거든.',
  },
  {
    role: 'notebook',
    tile: 'clubRoom',
    text: '너한테 말할 때만 목소리가 떨리지 않았어. 페이지가 사라진 날, 네가 나를 보다가 눈을 피하는 걸 봤어. 네가 말해 줄 줄 알았어.',
  },
  {
    role: 'letter',
    tile: 'garden',
    text: '편지를 받고 하루 종일 웃었어. 다섯 시가 지나고, 여섯 시가 지나도, 네가 늦는 거라고 생각했어. 끝까지 그렇게 생각했어.',
  },
  {
    role: 'leaver',
    tile: 'studentCouncil',
    text: '혼자서는 그 문을 두드릴 용기가 없었어. 네가 떠나는 게 부러웠어. 원망하지는 않아. 그냥, 같이 가고 싶었어.',
  },
  {
    role: 'mediator',
    tile: 'broadcastRoom',
    text: '싸움이 줄었다고 다들 좋아했지. 조용해진 교실에서 나는 매주 소리 없이 지워졌어. 네 규칙은 공평했어. 그래서 아무도 멈추지 않았어.',
  },
  {
    role: 'transfer',
    tile: 'cafeteria',
    text: '처음 네 얼굴을 봤을 때 숟가락을 떨어뜨렸어. 네가 웃으면서 먼저 말을 퍼뜨렸을 때 알았어. 너도 무서웠구나. 그래도 나는 또 혼자 밥을 먹었어.',
  },
  {
    role: 'bystander',
    tile: 'centralPlaza',
    text: '눈 오는 소리는 원래 안 들린대. 그래서 내 소리도 안 들렸을 거라고 생각하려고 했어. 네 이어폰에서 새어 나오던 노래, 나도 좋아하던 거였어.',
  },
]

export const SIGHT_BY_ROLE: Record<string, SightRow> = Object.fromEntries(
  SIGHTS.map((s) => [s.role, s]),
)

/** 그 역할의 그 자리. 역할 카드에만 적히고, 본인만 본다. */
export function placeOf(role: RoleId): TileId {
  return SIGHT_BY_ROLE[role].tile
}
