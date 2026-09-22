// views 투영 — 그 사람이 봐도 되는 만큼만 깎는다.
//
// **이 파일이 누출을 막는 유일한 자리다.**
//
// 규칙(firestore.rules)은 views/{playerId}를 본인에게만 열어 준다.
// 그 안에 무엇이 들어가는지는 규칙이 모른다. 그래서 담는 쪽이 틀리면
// 규칙이 아무리 단단해도 새어 나간다.
//
// 세 가지를 지킨다.
//
//   1. 못 보는 것은 **담지 않는다.** 「못 봄」 표시를 붙여 담지 않는다 —
//      제목 한 줄, 아이디 하나로도 새어 나간다.
//   2. 남의 것은 **애초에 들어오지 않는다.** 열넷 몫을 한 번에 만들되
//      사람마다 따로 판단한다.
//   3. 걷는 말의 **목적지는 어느 view에도 없다.** 본인 팀 것도.
//
// 순수 함수다. Firestore를 모른다 — 그래야 시험할 수 있다.
import { DISGUISE_SHOWN_AS } from './occupy'
import { visiblePawns, visibleTiles, type PawnPosition, type PawnView } from './fog'
import type { CardKind, TeamId, VoteKind } from './v2'
import { TILE_BY_ID, type Cell, type TileId } from './board'
import { SHOP_ITEMS } from './shop'
import { MAKERS, TECH_TILE } from './trap'
import { BOARDS, BOARD_BY_ID, atBoard, atThing, minutesLeft, type ThingIcon } from './errand'
import {
  CROP_BY_ID,
  GARDEN_TILE,
  HARVEST_LIMIT,
  POT_CELLS,
  nameShows,
  stageOf,
  type PotStage,
} from './crop'
import type { Satchel, Satchels } from './items'
import { canSeeMemory } from '../reveal/archive'
import { noticesFor, type Notice } from '../reveal/notice'

// ── 서버가 쥐고 있는 것 ─────────────────────────────────────────

export interface WorldPawn extends PawnPosition {
  /** 정보부장이면 우리 팀 시야가 한 겹 넓어진다. */
  intelOfficer: boolean
  /** 거래를 걸 수 있는 개인 토큰. 투영이 본인 몫에만 싣는다. */
  /** 옮기기로 한 팀. **본인 몫에만 실린다** — 남의 배신은 안 보인다. */
  movingTo?: TeamId | null
  /** 걷는 중이면 도착 시각. 본인 몫에만 실린다. */
  arriveAtMs?: number | null
  /** 무언가 하느라 묶인 시각. 본인 몫에만 실린다. */
  busyUntilMs?: number | null
  /** 무엇을 하느라 묶였는가. 본인 몫에만 실린다. */
  busyKind?: string | null
  /** 전투 자리. 본인 몫에만 실린다 — 남의 전선 계획까지 보일 이유가 없다. */
  postTile?: TileId | null
  /** 가 본 방. 본인 몫에만 실린다. */
  visitedTiles?: readonly TileId[]
}

export interface WorldTile {
  tileId: TileId
  ownerTeam: TeamId | null
  /** 지금 이 방을 잠근 팀. 시각이 지난 자물쇠는 서버가 안 담는다. */
  lockedBy?: TeamId | null
}

export interface WorldRoster {
  playerId: string
  team: TeamId
  roleId: string
  targetId: string | null
}

/**
 * 판 위의 쪽지 하나. **서버만 통째로 본다.**
 *
 * line 은 서버가 이미 이름까지 끼워 넣은 문장이다. 문장 표는
 * functions/src/story/slips.ts 에 있고 번들에 실리지 않는다.
 */
/**
 * 게시판에 붙은 한 장. **받은 사람 목록이 여기 있다.**
 *
 * 이 모양 그대로는 절대 안 내보낸다. 누가 받았는지가 새면 경주가
 * 경주가 아니게 된다 — 남이 벌써 물건을 들었는지 보고 포기할 수 있다.
 */
export interface WorldErrand {
  id: string
  boardId: string
  thing: string
  icon: ThingIcon
  from: TileId
  to: TileId
  coins: number
  limitMin: number
  text: string
  /** 출발 방 어디에 놓였는가. **받은 사람에게만 내려간다.** */
  cell: Cell
  postedMs: number
  takers: Readonly<Record<string, { tookMs: number; carrying: boolean }>>
}

/** 화분 한 자리. **여기까지가 서버의 것이다.** */
export interface WorldPot {
  i: number
  cropId: string | null
  plantedMs: number | null
  growMs: number | null
}

export interface WorldSlip {
  id: string
  subjectId: string
  line: string
  tileId: TileId | null
  heldBy: string | null
  readBy: readonly string[]
  /** 찢겼으면 찢긴 방. 조각은 그 자리에 남는다(테이프로 붙인다). */
  tornAt?: TileId | null
  torn?: boolean
}

/**
 * 바닥의 문제 종이 한 장. **정답은 여기에 없다.**
 *
 * 서버가 은행에서 문제와 보기만 떼어 실어 보낸다. 정답과 해설은 어떤
 * 경로로도 나가지 않고, 채점은 서버가 한다.
 */
export interface WorldQuiz {
  id: string
  tileId: TileId
  /** 바닥 칸. 옛 문서에는 없다 — 그러면 방 어디서나 편다 */
  cell: Cell | null
  kind: 'choice' | 'short'
  /** 펼쳐졌을 때만 찬다. 안 펼친 종이는 null 이다. */
  prompt: string | null
  choices: readonly string[]
  openedBy: string | null
  solvedTeam: TeamId | null
  /** 틀린 사람들. 투영이 내 것만 본다. */
  wrongBy: readonly string[]
}

export interface World {
  nowMs: number
  /**
   * 사람마다의 지갑. **투영이 본인 것만 떼어 보낸다.**
   *
   * 전에는 팀 금고였고 games/{id}/teams/{t} 를 누구나 읽을 수 있어서
   * 남의 돈과 지식이 그대로 보였다. 「저 팀 지식이 4니까 곧 로봇이
   * 나온다」가 추측이 아니라 계산이 되면 숨길 것이 하나도 없다.
   * 개인 것이 된 지금은 더 그렇다 — 같은 팀 것도 안 보낸다.
   */
  vaults?: Readonly<Partial<Record<string, { money: number; knowledge: number }>>>
  /** 사람마다의 주머니. 방해와 위장에 드는 물건이 여기 있다. */
  satchels?: Readonly<Satchels>
  /** 팀마다 하나인 페이즈 토큰 상자. **자기 팀 것만 내려간다.** */
  wallets?: Readonly<Partial<Record<TeamId, number>>>
  /** 끝났으면 A의 기억 열셋이 전원에게 열린다. */
  over: boolean
  /**
   * 오늘 지워진 사람. 없으면 null.
   *
   * 이름은 아침에 모두가 안다. 숨기는 것은 **위치**다. 안개보다
   * 먼저 걸러서, 다른 사람에게는 위치 데이터 자체를 보내지 않는다 —
   * 잠복은 「안 보인다」이고 투명인간은 「없는 사람」이다.
   */
  invisibleId: string | null
  pawns: readonly WorldPawn[]
  /** 판 위의 로봇. 사람처럼 안개를 거친다 — 보이는 방의 것만 내려간다. */
  robots?: readonly { id: string; team: TeamId; tileId: TileId; carriedBy: string | null }[]
  /** 연구실에 놓인 주인 없는 완성품. */
  made?: readonly { id: string; tileId: TileId; byPlayerId: string }[]
  /** 지금 위장하고 있는 사람들. 남에게 보이는 숫자를 서버가 부풀린다. */
  disguised?: readonly string[]
  /** 이번 페이즈에 로봇을 부순 사람. 투영이 내 것만 세어 보낸다. */
  smashedBy?: readonly string[]
  /**
   * 사람마다 오늘 적은 이름. **투영이 본인 것만 떼어 보낸다.**
   *
   * 여기까지는 서버 안이라 전부 들고 있어도 되지만, 밖으로 나가는
   * 것은 자기가 적은 한 줄뿐이다.
   */
  myBallots?: Readonly<Record<string, string>>
  tiles: readonly WorldTile[]
  /** 열넷의 역할. **자기 한 줄만 나간다.** */
  roster: readonly WorldRoster[]
  hands: readonly { id: string; team: TeamId; kind: CardKind; targetTeam?: TeamId }[]
  /** 가짜 깃발. 꽂은 팀만 안다. */
  /** 정보부장이 들여다본 결과. 본 사람만 안다. */
  peeks: readonly { playerId: string; voteKind: VoteKind; voterNickname: string }[]
  /**
   * DAY 3·4의 선택. **본인 것만 나간다.**
   *
   * 「누가 나를 중요한 사람으로 골랐나」가 보이면 그걸 노리고 서로
   * 붙어 다니게 된다. 고르는 일이 마음이 아니라 수가 된다.
   */
  choices: readonly { playerId: string; chosenId: string | null; day4: string | null }[]
  // ── 진상 공개 흐름 ──
  releasedDays: readonly number[]
  progress: readonly { playerId: string; handledDays: readonly number[]; readDays: readonly number[] }[]
  /** 판 위의 쪽지 전부. 투영이 여기서 **거의 다 잘라낸다.** */
  /**
   * 오늘 상점에서 나간 수. **품목 아이디마다 하나씩.**
   *
   * 자판기가 「오늘은 끝」을 그리려면 필요하다. 누가 샀는지는 여기
   * 없다 — 기계가 비었다는 사실만 있다.
   */
  shopSold?: Readonly<Record<string, number>>
  /** 지금 붙어 있는 심부름. **받은 사람 목록째로 들고 온다** — 투영이 본인 것만 뗀다. */
  errands?: readonly WorldErrand[]
  /**
   * 정원의 화분 여덟. **심은 것과 자랄 시간째로 들고 온다** — 투영이
   * 단계만 떼어 보낸다. 무엇을 심었는지는 싹이 나야 나간다.
   */
  pots?: readonly WorldPot[]
  /** 사람마다 딴 작물. */
  crops?: Readonly<Record<string, Readonly<Record<string, number>>>>
  slips?: readonly WorldSlip[]
  quizzes?: readonly WorldQuiz[]
  /** 기술실 제조기에 걸린 건들. 복도의 덫은 세계에도 안 실린다 */
  trapJobs?: readonly { i: number; team: TeamId; byPlayerId: string; count: number; readyAtMs: number }[]
  memories: readonly { tileId: TileId; team: TeamId; atMs: number }[]
  /** 깨달음에 이른 시각. A의 시선이 그때 열린다. */
  awakenedAtMs: Readonly<Record<string, number>>
  notices: readonly Notice[]
}

// ── 내려보내는 것 ───────────────────────────────────────────────

/** 화분 한 자리, 사람에게 보이는 만큼. */
export interface PotView {
  i: number
  cell: Cell
  stage: PotStage
  /** 싹이 나야 이름이 보인다. 흙만 있을 때는 null 이다. */
  name: string | null
  /** 그 작물의 아이디. **이름과 같은 때에만 간다** — 색을 고르는 데 쓴다. */
  cropId: string | null
  /** 딸 수 있는가 — 열매이고 내 손이 덜 찼다. */
  canPick: boolean
}

export interface View {
  updatedAtMs: number
  visiblePawns: PawnView[]
  /**
   * 위 목록의 아이디만 뽑아 둔 것. **Firestore 규칙이 이것을 읽는다.**
   *
   * 규칙은 맵이 든 배열 안을 뒤지지 못한다. live 문서를 열어 줄지
   * 말지를 한 줄로 판단할 수 있게, 같은 계산에서 아이디만 떼어 둔다.
   */
  visibleIds: string[]
  /** 보이는 방에 있는 로봇. 머릿수로만 센다. */
  visibleRobots: { id: string; team: TeamId; tileId: TileId }[]
  /**
   * **내가 선 방에 놓인** 주인 없는 완성품.
   *
   * 안개 너머의 것은 안 보낸다. 방마다 몇 개 놓였는지가 보이면 어느
   * 연구실에서 연구가 돌고 있는지가 학교 반대편에서 읽힌다 — 그것은
   * 걸어가서 봐야 하는 값이다.
   */
  madeHere: { id: string; byPlayerId: string; mine: boolean }[]
  /**
   * 방마다 **내게 보이는** 머릿수. 미니맵이 이 숫자를 그대로 쓴다.
   *
   * 위장이 여기서 산다. 남의 팀 사람이 위장했으면 둘로 세어 보낸다 —
   * 진짜 수를 보내 놓고 화면에서 부풀리면 개발자도구로 다 보인다.
   * 우리 팀 사람은 위장해도 내게는 하나다.
   */
  roomCounts: Record<TileId, number>
  visibleTiles: TileId[]
  hand: { id: string; kind: CardKind; targetTeam?: TeamId }[]
  peeked: { voteKind: VoteKind; voterNickname: string }[]
  /** 내가 고른 것. 남이 무엇을 골랐는지는 없다. */
  myChoice: { chosenId: string | null; day4: string | null } | null
  own: { roleId: string; targetId: string | null } | null
  /**
   * 내 말이 걷는 중이면 도착 시각. 서 있으면 null.
   *
   * **내 것만 넣는다.** 남이 언제 도착하는지까지 알면, 문 앞에서
   * 기다렸다 덮치는 것이 추측이 아니라 계산이 된다. 걷고 있다는
   * 사실은 보이지만(visiblePawns.walking) 몇 분 남았는지는 안 보인다.
   */
  myArriveAtMs: number | null
  /**
   * 무언가 하느라 손이 묶인 시각. 걷는 중이 아닌데도 못 움직인다.
   *
   * 화면이 이것으로 「생산 중 · 7분 남음」을 띄우고 걸음을 잠근다.
   * **판정과는 상관이 없다** — 묶여 있어도 그 자리에 몸이 있어서
   * 머릿수로는 그대로 센다.
   */
  myBusyUntilMs: number | null
  /** 무엇을 하느라 묶였는가. 화면이 그대로 적는다. */
  myBusyKind: string | null
  /** 내 전투 자리. 자유 시간에 여기서 떨어져 있으면 페이즈 때 돌아온다. */
  myPost: TileId | null
  /**
   * 이번 페이즈에 **우리 팀** 상자에 남은 토큰. 넷이 나눠 쓴다.
   *
   * 남의 팀 것은 안 보낸다 — 상대 상자가 보이면 언제 밀고 들어올지가
   * 읽힌다. 그게 이 게임의 절반이다.
   */
  myTeamTokens: number
  /**
   * 거래를 걸 수 있는 내 개인 토큰. **내 것만 간다.**
   *
   * 남이 몇 번 더 걸 수 있는지 보이면 「저 사람은 오늘 끝났다」가
   * 계산이 된다 — 흥정은 그걸 모르는 채로 해야 한다.
   */
  /**
   * 다음 점령전부터 갈 팀. 합의해 둔 것이 없으면 null 이다.
   *
   * **본인만 본다.** 옛 팀에게도 새 팀에게도 알리지 않는다 — 발효된
   * 뒤에 마주쳐서 완장이 바뀐 것을 보고 아는 것이 이 규칙의 전부다.
   */
  myMovingTo: TeamId | null
  /** **우리 팀** 금고. 남의 팀 금고는 어떤 경로로도 안 온다. */
  myVault: { money: number; knowledge: number }
  /** 우리 팀 물건. **우리 팀 것만 간다** — 남이 몇 개 쥐었는지는 안 보낸다. */
  /** **내 주머니.** 팀 것이 아니다 — 산 사람이 가진다. */
  myItems: Satchel
  /**
   * 정원의 화분. **그 방에 서 있을 때만 온다.**
   *
   * 단계와 — 싹이 난 뒤에는 — 이름까지다. 심은 사람도, 언제 열매가
   * 될지도 안 온다: 흙을 보고 기다리는 것이 이 일의 전부다.
   */
  potsHere: PotView[]
  /**
   * 기술실에 서 있을 때만 — 제조기 셋. 남이 맡긴 것은 「돌고 있다」까지다.
   * 몇 개가 나오는지, 언제 되는지는 맡긴 사람만 본다.
   */
  makersHere: {
    i: number
    cell: Cell
    state: 'free' | 'busy' | 'mine'
    readyAtMs: number | null
    count: number
  }[]
  /** 덫에 걸려 있으면 그 칸. 화면이 아바타를 여기에 도로 세운다 */
  mySnaredAt: Cell | null
  /** 딴 작물. 키가 작물 아이디다. */
  myCrops: Readonly<Record<string, number>>
  /**
   * 우리 팀 로봇 수. 한도(ROBOTS_PER_TEAM)를 보여 주려면 안개 밖의
   * 것까지 세어야 한다 — 우리 것이므로 다 알아도 된다. 남의 팀 총수는
   * 안 보낸다.
   */
  myTeamRobots: number
  /** 내가 데리고 다니는 로봇 수. 두고 갈 것을 미리 셈하는 데 쓴다. */
  myCarriedRobots: number
  /**
   * 이번 페이즈에 **내가** 부순 로봇 수. 남이 몇 기를 부쉈는지는 안 온다.
   *
   * 한 사람 한 기라서 화면이 버튼을 미리 잠그려면 이 수가 필요하다.
   */
  mySmashes: number
  /**
   * 오늘 내가 투명인간 투표에서 적은 사람. 아직 안 적었으면 null.
   *
   * **남이 무엇을 적었는지는 어떤 경로로도 안 온다.** 득표수도 안 온다 —
   * 「몇 표였다」가 새면 누가 적었는지를 좁혀 나갈 수 있고, 그러면
   * 이 투표가 무기명이라는 말이 거짓이 된다.
   */
  myBallot: string | null
  /**
   * 보이는 방마다 서 있는 로봇 수. 안 보이는 방은 아예 넣지 않는다.
   *
   * 정원과 별개라 roomCounts 와 따로 간다 — 화면이 「사람 3/6 · 로봇 1/2」
   * 을 그대로 그리고, 옮기기 전에 몇 기를 두고 가는지도 여기서 센다.
   */
  robotCounts: Record<TileId, number>
  /**
   * 내가 가 본 방. **한 번도 안 간 방은 지도에 검게 남는다.**
   *
   * 지금 보이는 방(visibleTiles)과는 다르다. 관측소로 멀리 보는 것과
   * 발을 들여 본 것은 다른 일이라, 지도는 둘을 합쳐서 「아는 방」으로
   * 친다 — 어느 쪽도 아니면 서버가 그 방 숫자를 아예 안 보낸다.
   */
  visitedTiles: TileId[]
  handledDays: number[]
  readDays: number[]
  /**
   * 내가 선 방 바닥에 있는 쪽지. **한 장 있다는 것까지만이다.**
   *
   * 무엇이 적혔는지도, 누구의 비밀인지도 안 온다. 주워서 읽어야 안다.
   */
  slipsHere: { id: string }[]
  /**
   * 내가 선 방에 남은 **찢긴 조각.** 「한 무더기 있다」까지다.
   *
   * 무엇이 적혔던 종이인지도, 누가 찢었는지도 안 온다 — 테이프로
   * 붙여서 읽어야 안다. 바닥의 쪽지와 같은 규칙이다.
   */
  scrapsHere: { id: string }[]
  /**
   * 지금 잠긴 방과 잠근 팀. **보이는 방만 온다.**
   *
   * 안 보이는 방의 자물쇠까지 오면 「저기 누가 있다」가 공짜로 새어
   * 나간다 — 문을 잠근 사람은 그 방에 있었다는 뜻이다.
   */
  lockedTiles: { tileId: TileId; team: TeamId }[]
  /**
   * 오늘 다 나간 품목. 자판기 칸이 어두워진다.
   *
   * **하루 몫이 걸린 물건에만 해당한다.** 수는 안 보낸다 — 몇 개
   * 남았는지는 기계가 알려 줄 일이 아니고, 남았는지 아닌지만 있으면
   * 칸을 그린다.
   */
  soldOutItems: string[]
  /**
   * 게시판마다 몇 장 붙어 있는가. **장수까지만.**
   *
   * 종이가 펄럭이는 것은 복도 저쪽에서도 보인다 — 그게 걸어가 보게
   * 만드는 힘이라 가리지 않는다. 무엇이 적혔는지는 앞에 서야 안다.
   */
  boardCounts: Record<string, number>
  /** 내가 선 게시판에 붙은 것들. 앞에 서야 온다. */
  errandsHere: {
    id: string
    thing: string
    from: TileId
    to: TileId
    coins: number
    text: string
    minutesLeft: number
    /** 내가 이미 받은 것인가. 받은 사람이 몇인지는 안 온다 */
    mine: boolean
  }[]
  /**
   * 내가 받아 둔 심부름. **내 것만.**
   *
   * 누가 같이 받았는지는 안 온다 — 경주하는 중이고, 남이 어디까지
   * 했는지 보이면 그건 경주가 아니라 중계다.
   */
  myErrand: {
    id: string
    thing: string
    icon: ThingIcon
    from: TileId
    to: TileId
    coins: number
    text: string
    minutesLeft: number
    carrying: boolean
    /**
     * 바닥에 놓인 자리. 아직 안 집었고 **그 방에 서 있을 때만** 온다 —
     * 다른 방에서까지 좌표가 오면 지도에 없는 물건이 찍힌다.
     */
    thingAt: Cell | null
    /** 그 물건 옆에 서 있는가. 집을 수 있다는 뜻이다 */
    thingHere: boolean
    /** 여기 놓으면 끝나는가. */
    canDrop: boolean
  } | null
  /** 내가 들고 있는 쪽지. 읽은 것만 문장이 실린다. */
  mySlips: { id: string; read: boolean; line: string | null; subjectId: string | null }[]
  /**
   * 내가 선 방의 문제 종이. **안 펼친 것은 「한 장 있다」까지만이다.**
   *
   * 펼치면 그 방 사람 전원에게 문제와 보기가 간다 — 다른 팀 사람 앞에서
   * 여는 것이 이 물건의 전부라, 여기서 팀을 가르면 규칙이 성립하지 않는다.
   * 정답과 해설은 어느 쪽이든 안 온다.
   */
  quizzesHere: {
    id: string
    kind: 'choice' | 'short'
    cell: Cell | null
    prompt: string | null
    choices: string[]
    opened: boolean
    /** 내가 이미 틀렸는가. 남이 틀렸는지는 안 온다. */
    iFailed: boolean
  }[]
  memories: { tileId: TileId; team: TeamId; atMs: number }[]
  sightAtMs: number | null
  notices: { id: string; text: string; atMs: number }[]
}

/**
 * 방마다 보이는 머릿수. 안 보이는 방은 아예 넣지 않는다.
 *
 * 걷는 사람은 어느 방에도 없다. 위장한 남은 둘로 센다 — 판정이 아니라
 * **보이는 숫자**라서, 여기만 거짓말을 한다.
 */
function countRooms(
  pawns: readonly { playerId: string; team: TeamId; tileId: TileId | null }[],
  robots: readonly { team: TeamId; tileId: TileId }[],
  visible: ReadonlySet<TileId>,
  viewerTeam: TeamId,
  disguised: readonly string[],
): Record<TileId, number> {
  const wearing = new Set(disguised)
  const out: Record<TileId, number> = {}
  for (const p of pawns) {
    if (p.tileId === null || !visible.has(p.tileId)) continue
    const n = p.team !== viewerTeam && wearing.has(p.playerId) ? DISGUISE_SHOWN_AS : 1
    out[p.tileId] = (out[p.tileId] ?? 0) + n
  }
  for (const r of robots) {
    if (!visible.has(r.tileId)) continue
    out[r.tileId] = (out[r.tileId] ?? 0) + 1
  }
  return out
}

/**
 * 한 사람 몫.
 *
 * 명단에 없는 사람(구경꾼)이 물어도 터지지 않는다 — 아무것도 없는
 * view가 나간다. 자리에 없는 사람에게 남의 것을 보여 줄 이유가 없다.
 */
export function projectView(world: World, viewerId: string): View {
  const me = world.roster.find((r) => r.playerId === viewerId) ?? null
  const team = me?.team ?? null

  // 지워진 사람은 **남의 시야 계산에 들어가기 전에** 빠진다
  const seenPawns = world.pawns.filter((p) => p.playerId === viewerId || p.playerId !== world.invisibleId)

  // 팀이 없으면 안개도 없다. 빈 view를 돌려준다
  if (team === null) {
    return {
      updatedAtMs: world.nowMs,
      visiblePawns: [],
      visibleIds: [],
      visibleRobots: [],
      madeHere: [],
      roomCounts: {},
      visibleTiles: [],
      hand: [],
      peeked: [],
      myChoice: null,
      own: null,
      myArriveAtMs: null,
      myBusyUntilMs: null,
      myBusyKind: null,
      myPost: null,
      myTeamTokens: 0,
      myMovingTo: null,
      myVault: { money: 0, knowledge: 0 },
      myItems: {},
      myTeamRobots: 0,
      myCarriedRobots: 0,
      mySmashes: 0,
      myBallot: null,
      robotCounts: {},
      visitedTiles: [],
      handledDays: [],
      readDays: [],
      slipsHere: [],
      scrapsHere: [],
      boardCounts: {},
      errandsHere: [],
      myErrand: null,
      potsHere: [],
      makersHere: [],
      mySnaredAt: null,
      myCrops: {},
      lockedTiles: [],
      soldOutItems: [],
      quizzesHere: [],
      mySlips: [],
      memories: [],
      sightAtMs: null,
      notices: noticesFor(world.notices, viewerId).map((n) => ({ id: n.id, text: n.text, atMs: n.atMs })),
    }
  }

  const ours = seenPawns.filter((p) => p.team === team)
  // 걷는 말은 다음 칸을 기준으로 본다. 목적지가 아니다
  const myPawnTiles = ours
    .map((p) => p.tileId ?? p.toTile)
    .filter((id): id is TileId => id !== null && Boolean(TILE_BY_ID[id]))

  const visible = visibleTiles({
    ownedTiles: world.tiles.filter((t) => t.ownerTeam === team).map((t) => t.tileId),
    myPawnTiles,
    intelOfficer: ours.some((p) => p.intelOfficer),
  })

  // 내가 선 방. 걷는 중이면 어느 방에도 없다 — 바닥의 쪽지도 안 보인다
  const here = seenPawns.find((p) => p.playerId === viewerId)?.tileId ?? null
  /** 내가 멈춰 선 칸. 게시판 앞인지를 이걸로 본다 */
  const myCell = seenPawns.find((p) => p.playerId === viewerId)?.at ?? null


  const seen = visiblePawns({
    viewerId,
    viewerTeam: team,
    pawns: seenPawns,
    visible,
    // 내가 선 칸. **복도에 섰으면 같은 복도 사람이 보인다**
    at: myCell,
    nowMs: world.nowMs,
  })

  return {
    updatedAtMs: world.nowMs,
    /*
     * 안개 밖의 말은 목록에 없다. 목적지는 어느 말에도 붙지 않는다.
     *
     * **든 물건은 붙는다.** 손에 상자를 안고 복도를 지나가면 누구나
     * 본다 — 무엇을 들었는지까지가 보이는 것이고, 무슨 심부름인지는
     * 안 보인다. 보이는 사람에게만 붙으므로 새는 길도 아니다.
     */
    roomCounts: countRooms(seenPawns, world.robots ?? [], visible, team, world.disguised ?? []),

    // 로봇도 안개를 거친다. 보이지 않는 방의 로봇은 아예 안 보낸다
    visibleRobots: (world.robots ?? [])
      .filter((r) => visible.has(r.tileId))
      .map((r) => ({ id: r.id, team: r.team, tileId: r.tileId })),

    // 내가 선 방에 놓인 것만. 걷는 중이면 아무것도 안 온다
    madeHere: (world.made ?? [])
      .filter((m) => here !== null && m.tileId === here)
      .map((m) => ({ id: m.id, byPlayerId: m.byPlayerId, mine: m.byPlayerId === viewerId })),

    visiblePawns: withCarry(seen, world.errands ?? []),
    /**
     * 위 목록에 든 사람의 아이디만. **규칙이 이것을 본다.**
     *
     * 걸음을 실시간으로 주고받는 live 문서를 누가 읽어도 되는지를
     * 이 줄로 가른다 — 「보인다」를 정하는 곳이 하나여야 한다. 안개가
     * 가린 사람의 live 를 읽을 수 있으면, 화면에 안 그려도 개발자도구로
     * 다 보인다.
     *
     * 같은 계산에서 떼어 낸다. 따로 세면 언젠가 어긋난다.
     */
    visibleIds: seen.map((p) => p.playerId),
    visibleTiles: [...visible].sort(),
    // **보이는 방의 자물쇠만.** 안 보이는 방까지 오면 「저기 누가
    // 있었다」가 공짜로 새어 나간다 — 문을 잠근 사람은 그 방에 있었다
    lockedTiles: world.tiles
      .filter((t) => t.lockedBy != null && visible.has(t.tileId))
      .map((t) => ({ tileId: t.tileId, team: t.lockedBy as TeamId })),
    /*
     * ── 심부름 ──────────────────────────────────────────
     *
     * 세 겹으로 나눠 보낸다. 게시판마다 **장수**는 누구에게나,
     * 붙은 **내용**은 그 앞에 선 사람에게, 받아서 **어디까지 했나**는
     * 본인에게만.
     *
     * 남이 무엇을 받았는지는 어느 겹에도 없다. 경주하는 중이고, 남이
     * 벌써 물건을 들었는지 보이면 그건 경주가 아니라 중계다.
     */
    boardCounts: Object.fromEntries(
      BOARDS.map((b) => [b.id, (world.errands ?? []).filter((e) => e.boardId === b.id).length]),
    ),
    errandsHere: (world.errands ?? [])
      .filter((e) => {
        const b = BOARD_BY_ID[e.boardId]
        return b !== undefined && atBoard(myCell, b)
      })
      .map((e) => ({
        id: e.id,
        thing: e.thing,
        from: e.from,
        to: e.to,
        coins: e.coins,
        text: e.text,
        minutesLeft: minutesLeft(e.postedMs, e.limitMin, world.nowMs),
        mine: e.takers[viewerId] !== undefined,
      })),
    myErrand: (() => {
      const e = (world.errands ?? []).find((x) => x.takers[viewerId] !== undefined)
      if (!e) return null
      const took = e.takers[viewerId] as { tookMs: number; carrying: boolean }
      return {
        id: e.id,
        thing: e.thing,
        icon: e.icon,
        from: e.from,
        to: e.to,
        coins: e.coins,
        text: e.text,
        minutesLeft: minutesLeft(e.postedMs, e.limitMin, world.nowMs),
        carrying: took.carrying,
        // **물건은 받은 사람에게만 있다.** 남의 응답에는 이 줄이 없다
        thingAt: !took.carrying && here === e.from ? e.cell : null,
        // 옆에 서야 집는다. 서버도 같은 자로 잰다(errand.ts 의 pickUpThing)
        thingHere: !took.carrying && here === e.from && atThing(myCell, e.cell),
        canDrop: took.carrying && here === e.to,
      }
    })(),
    // 오늘 다 나간 품목. 열넷에게 똑같이 간다 — 기계 앞에 서면 누구나
    // 보이는 것이라 가릴 것이 없다
    soldOutItems: SHOP_ITEMS.filter(
      (i) => i.stockPerDay !== undefined && (world.shopSold?.[i.id] ?? 0) >= i.stockPerDay,
    ).map((i) => i.id),

    // 우리 팀 것
    hand: world.hands
      .filter((c) => c.team === team)
      .map((c) => ({ id: c.id, kind: c.kind, ...(c.targetTeam ? { targetTeam: c.targetTeam } : {}) })),

    // 내 것
    peeked: world.peeks
      .filter((p) => p.playerId === viewerId)
      .map((p) => ({ voteKind: p.voteKind, voterNickname: p.voterNickname })),
    myChoice: (() => {
      const c = world.choices.find((x) => x.playerId === viewerId)
      return c ? { chosenId: c.chosenId, day4: c.day4 } : null
    })(),
    // 역할은 **자기 한 줄뿐이다.** 남의 것은 들어가지 않는다
    own: me ? { roleId: me.roleId, targetId: me.targetId } : null,
    myArriveAtMs: world.pawns.find((p) => p.playerId === viewerId)?.arriveAtMs ?? null,
    myBusyUntilMs: world.pawns.find((p) => p.playerId === viewerId)?.busyUntilMs ?? null,
    myBusyKind: world.pawns.find((p) => p.playerId === viewerId)?.busyKind ?? null,
    myPost: world.pawns.find((p) => p.playerId === viewerId)?.postTile ?? null,
    // **우리 팀 것만이다.** 남의 상자가 보이면 언제 밀고 들어올지가
    // 읽힌다 — 그게 이 게임의 절반이다
    myTeamTokens: world.wallets?.[team] ?? 0,
    myMovingTo: world.pawns.find((p) => p.playerId === viewerId)?.movingTo ?? null,
    // **내 지갑 하나뿐이다.** 같은 팀 것도 안 간다 — 서로 얼마
    // 가졌는지는 말로 알아내야 한다
    myVault: world.vaults?.[viewerId] ?? { money: 0, knowledge: 0 },
    myItems: world.satchels?.[viewerId] ?? {},
    /*
     * 화분. **정원에 서 있을 때만 간다.**
     *
     * 단계는 시간으로만 나온다 — 서버가 심은 시각과 뽑아 둔 시간을
     * 알고 있고, 여기서는 그걸로 단계만 만든다. 자랄 시간도 심은
     * 사람도 안 싣는다.
     */
    makersHere:
      here === TECH_TILE
        ? MAKERS.map((m) => {
            const job = (world.trapJobs ?? []).find((j) => j.i === m.i) ?? null
            const mine = job !== null && job.byPlayerId === viewerId
            return {
              i: m.i,
              cell: m.cell,
              state: job === null ? 'free' : mine ? 'mine' : 'busy',
              readyAtMs: mine ? job.readyAtMs : null,
              count: mine ? job.count : 0,
            }
          })
        : [],
    mySnaredAt: (() => {
      const me = world.pawns.find((p) => p.playerId === viewerId)
      return me && me.busyKind === '덫' && (me.busyUntilMs ?? 0) > world.nowMs ? (me.at ?? null) : null
    })(),
    potsHere:
      here === (GARDEN_TILE as TileId)
        ? (world.pots ?? []).map((pot) => {
            const spec = pot.cropId === null ? null : (CROP_BY_ID[pot.cropId] ?? null)
            const grown = pot.plantedMs === null ? 0 : Math.max(0, world.nowMs - pot.plantedMs)
            const growMs = pot.growMs ?? 0
            const stage: PotStage =
              spec === null || pot.plantedMs === null
                ? 'empty'
                : stageOf(grown, growMs, Math.max(0, grown - growMs), spec.witherHours * 3_600_000)
            const mine = world.crops?.[viewerId] ?? {}
            const held = Object.values(mine).reduce((a, n) => a + n, 0)
            return {
              i: pot.i,
              cell: POT_CELLS[pot.i],
              stage,
              // **흙만 있을 때는 이름이 없다.** 심은 사람에게도 안 간다
              name: spec !== null && nameShows(stage) ? spec.name : null,
              cropId: spec !== null && nameShows(stage) ? spec.id : null,
              canPick: stage === 'fruit' && held < HARVEST_LIMIT,
            }
          })
        : [],
    myCrops: world.crops?.[viewerId] ?? {},
    myTeamRobots: (world.robots ?? []).filter((r) => r.team === team).length,
    myCarriedRobots: (world.robots ?? []).filter((r) => r.carriedBy === viewerId).length,
    mySmashes: (world.smashedBy ?? []).filter((id) => id === viewerId).length,
    myBallot: world.myBallots?.[viewerId] ?? null,
    robotCounts: Object.fromEntries(
      [...visible].map((t) => [t, (world.robots ?? []).filter((r) => r.tileId === t).length]),
    ) as Record<TileId, number>,
    visitedTiles: [...(world.pawns.find((p) => p.playerId === viewerId)?.visitedTiles ?? [])].sort(),

    // 진상 공개 흐름
    handledDays: [...(world.progress.find((p) => p.playerId === viewerId)?.handledDays ?? [])].sort((a, b) => a - b),
    readDays: [...(world.progress.find((p) => p.playerId === viewerId)?.readDays ?? [])].sort((a, b) => a - b),
    // **바닥의 쪽지는 「한 장 있다」까지만.** 무엇이 적혔는지도, 누구의
    // 비밀인지도 안 간다 — 주워서 읽어야 안다
    slipsHere: (world.slips ?? [])
      .filter((s) => here !== null && s.tileId === here)
      .map((s) => ({ id: s.id })),
    // **조각도 「있다」까지만.** 적혔던 말은 붙여서 읽어야 온다
    scrapsHere: (world.slips ?? [])
      .filter((s) => s.torn === true && here !== null && (s.tornAt ?? null) === here)
      .map((s) => ({ id: s.id })),
    // **안 펼친 문제는 「한 장 있다」까지만.** 펼치면 그 방 사람
    // 전원에게 문제와 보기가 간다 — 다른 팀 사람 앞에서 여는 것이
    // 이 물건의 전부라, 여기서 팀을 가르면 규칙이 성립하지 않는다.
    // 정답과 해설은 어느 쪽이든 안 간다
    quizzesHere: (world.quizzes ?? [])
      .filter((q) => here !== null && q.tileId === here && q.solvedTeam === null)
      .map((q) => {
        const opened = q.openedBy !== null
        return {
          id: q.id,
          kind: q.kind,
          cell: q.cell,
          prompt: opened ? q.prompt : null,
          choices: opened ? [...q.choices] : [],
          opened,
          // 남이 틀렸는지는 안 간다. 「저 사람은 이미 틀렸다」를 알면
          // 누가 무엇을 모르는지가 공개 정보가 된다
          iFailed: q.wrongBy.includes(viewerId),
        }
      }),
    // 들고 있는 것. **읽은 것만 문장이 실린다** — 주웠다고 저절로
    // 읽히면 「읽는다」가 아무 일도 아닌 것이 된다
    mySlips: (world.slips ?? [])
      .filter((s) => s.heldBy === viewerId)
      .map((s) => {
        const read = s.readBy.includes(viewerId)
        // **읽어야 문장이 온다.** 안 읽었으면 적힌 것도, 누구의
        // 비밀인지도 안 간다
        return { id: s.id, read, line: read ? s.line : null, subjectId: read ? s.subjectId : null }
      }),
    // 먼저 가져간 팀만. 끝나면 전원
    memories: world.memories.filter((m) => canSeeMemory(m, team, world.over)),
    // A의 시선은 깨달음에 이른 본인에게만
    sightAtMs: world.awakenedAtMs[viewerId] ?? null,
    notices: noticesFor(world.notices, viewerId).map((n) => ({ id: n.id, text: n.text, atMs: n.atMs })),
  }
}

/** 열넷 몫을 한 번에. 사람마다 따로 판단한다. */
/**
 * 보이는 사람에게 **든 물건 이름을 얹는다.**
 *
 * 무엇을 들었는지는 보이고, 무슨 심부름인지는 안 보인다 — 어디서
 * 어디로 가는지도, 보상이 얼마인지도 안 붙는다.
 */
function withCarry(
  pawns: readonly PawnView[],
  errands: readonly WorldErrand[],
): (PawnView & { carrying?: string; carryIcon?: ThingIcon })[] {
  if (errands.length === 0) return [...pawns]
  const hand = new Map<string, { thing: string; icon: ThingIcon }>()
  for (const e of errands) {
    for (const [id, t] of Object.entries(e.takers)) if (t.carrying) hand.set(id, { thing: e.thing, icon: e.icon })
  }
  return pawns.map((p) => {
    const held = hand.get(p.playerId)
    return held ? { ...p, carrying: held.thing, carryIcon: held.icon } : p
  })
}

export function projectAll(world: World): Record<string, View> {
  return Object.fromEntries(world.roster.map((r) => [r.playerId, projectView(world, r.playerId)]))
}
