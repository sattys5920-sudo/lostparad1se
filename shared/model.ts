import type {
  CardKind,
  Resource,
  RoleTitle,
  TeamId,
  VoteKind,
} from './rules/v2'
import type { Cell, TileId } from './rules/board'
import type { AvatarLook } from './look'
import type { Satchel } from './rules/items'
import type { CaptainVote } from './rules/captain'

/** 밀리초 타임스탬프. 게임 속 시각이다(개발용 시계가 걸려 있으면 그 시각). */
export type GameMs = number

// ── 공개: 판 전체 ───────────────────────────────────────────────

export type GamePhase = 'lobby' | 'running' | 'finished'

/**
 * 로비의 자리 하나.
 *
 * 누가 어느 팀인지는 숨길 것이 없다 — 팀은 원래 공개다. 그래서 따로
 * 컬렉션을 두지 않고 판 문서 안에 열네 줄로 둔다. 역할은 여기 없다.
 */
export interface SeatEntry {
  playerId: string
  name: string
  team: TeamId
  /**
   * 그 사람이 만든 캐릭터. **서버가 계정에서 꺼내 적는다** — 화면이
   * 보내 주는 것이 아니다.
   *
   * 이름 옆이 제자리다. 「이 사람이 누구인가」는 이름과 생김새가 한
   * 벌이고, 둘 다 원래 공개다. 안개는 그 사람이 화면에 **나타나는지**를
   * 정하지, 나타난 사람이 어떻게 생겼는지를 감추지 않는다.
   *
   * 앉을 때 한 번 찍는다. 앉은 뒤에 캐릭터를 고쳐도 이 판에서는 그대로다 —
   * 닷새 내내 같은 얼굴이어야 「어제 그 애」가 성립한다.
   *
   * 계정에 캐릭터가 없으면 null 이고, 화면은 예전처럼 팀 색 점을 찍는다.
   */
  look?: AvatarLook | null
}

/**
 * games/{gameId}/live/{playerId}
 *
 * **지금 이 순간 어디서 어디를 보고 있는가.** 화면이 직접 적고,
 * 그 사람이 보이는 사람만 읽는다(규칙이 views 의 visibleIds 로 가른다).
 *
 * 판정은 이것을 절대 쓰지 않는다. 「바로 옆 칸인가」도, 방 머릿수도,
 * 깃발도 전부 pawns 를 본다 — 여기는 화면이 적는 것이라 얼마든지
 * 거짓을 쓸 수 있다. **거짓을 써 봐야 남의 화면에서 헛걸음할 뿐이다.**
 *
 * 걷는 동안에만 적는다. 멈추면 한 번 더 적고 그친다 — Firestore 는
 * 한 문서에 초당 한 번쯤을 셈하고 만든 것이라, 가만히 선 열넷이
 * 계속 두드리면 안 된다.
 */
export interface LiveDoc {
  /** 지금 있는 방. 걷는 중에 방을 건너면 도착할 방이다. */
  tileId: TileId | null
  /** 칸 좌표. **소수다** — 칸과 칸 사이가 걷는 중인 자리다. */
  x: number
  y: number
  /** 보고 선 쪽. */
  dir: 'up' | 'down' | 'left' | 'right'
  /** 걷는 중인가. 멈춘 사람은 다리를 안 움직인다. */
  moving: boolean
  /** 적은 시각. 오래된 것은 안 믿는다 — 창을 닫고 간 사람이 남는다. */
  ms: number
}

/** games/{gameId} */
export interface GameDoc {
  phase: GamePhase
  /** 역할을 나눌 때 쓴 씨앗. 같은 명단·같은 씨앗이면 늘 같은 결과다. */
  seed: string
  /** 로비에 앉은 사람들. 시작하면 더 바뀌지 않는다. */
  seats: SeatEntry[]
  /** 게임이 시작된 게임 속 시각. */
  startedAtMs: GameMs | null
  /** 개발용 시계. anchorRealMs가 0이면 실제 시각 그대로. */
  clock: { anchorRealMs: number; anchorGameMs: number; speed: number }
  /** 따라잡기가 여기까지 처리했다. 이 뒤로 밀린 일을 순서대로 민다. */
  caughtUpToMs: GameMs
  day: number
  /**
   * 지금 페이즈. 열려 있으면 점령전, 닫혀 있으면 자유 시간이다.
   *
   * 위의 phase 는 판의 일생(로비·진행·종료)이라 이름을 따로 쓴다.
   *
   * 관리자가 열고 닫는다. 자유 시간에는 마음껏 돌아다니고, 열리면
   * 다들 직전 페이즈가 끝난 자리로 돌아온다.
   *
   * endsAtMs 를 넘기면 열려 있어도 아무도 못 움직인다. 늦게 닫히는
   * 페이즈에서 토큰이 남은 사람만 유리해지면 안 된다.
   */
  phaseNow?: { no: number; day: number; open: boolean; openedAtMs: GameMs; endsAtMs?: GameMs }
  /**
   * **그날 아침에 찍어 둔 팀 순위.** 하루 동안 움직이지 않는다.
   *
   * 이적이 이 수를 본다. 순위가 페이즈마다 바뀌면, 어제 마주 서서
   * 합의한 이적이 오늘 아침 순위가 뒤집혔다는 이유로 말없이 불발된다 —
   * 협상이 성립하는 시점과 조건이 판정되는 시점이 다른데 그 사이에
   * 조건이 움직이면 협상 자체가 성립하지 않는다. 그래서 하루치를
   * 그날 첫 페이즈가 열릴 때 한 번 찍고, 신청도 발효도 같은 수를 본다.
   */
  dayRanks?: { day: number; rooms: Record<TeamId, number>; rank: Record<TeamId, number> }
  /** 지금까지 끝난 페이즈 수. 하루 10개, 닷새면 쉰 개다. */
  phaseDone?: number
  /** 지난 페이즈에 연구를 건 사람들. 다음 페이즈 끝에 로봇이 된다. */
  pendingResearch?: string[]
  // 위장한 사람과 방해받은 사람은 **여기 없다.** 판 문서는 누구나
  // 읽을 수 있어서 적는 순간 위장이 성립하지 않는다 — secret/phase 에 있다
  /** A의 기록이 열어 준 칸. */
  openedTiles: TileId[]
  /** 기록이 지목해 가치가 오른 칸. */
  boostedTiles: TileId[]
  /** 21:00 정산에서 1위(주목)·꼴찌(만회)로 지정된 팀. 동점이면 여럿. */
  spotlightTeams: TeamId[]
  comebackTeams: TeamId[]
  /** DAY 5 15:00부터 true. 점수판이 가려지고 깃발이 절반이 된다. */
  lastHours: boolean
  /**
   * 오늘 지워진 사람. 없으면 null.
   *
   * 이름은 아침에 모두에게 알려진다 — 숨길 것이 아니라 겪을 것이다.
   * 숨기는 것은 그 사람의 **위치**이고, 그건 views가 한다.
   */
  invisibleId: string | null
  /**
   * 오늘 네 팀의 팀장. 아직 못 정한 팀은 null 이다.
   *
   * **팀 문서가 아니라 판 문서에 둔다.** 팀 문서에는 금고가 들어 있어서
   * 제 팀 것만 읽을 수 있는데, 팀장은 모두가 알아야 하는 값이다 —
   * 투명인간 투표에서 못 적는 사람이라 화면이 미리 알아야 하고,
   * 뽑히면 공지도 나간다.
   */
  captains?: Partial<Record<TeamId, string | null>>
  /** 날마다 누가 지워졌는가. 엔딩이 「한 번이라도 있었는가」를 여기서 본다. */
  invisibleByDay: Record<number, string | null>
  /**
   * 오늘 투명인간이 나온 팀. 그날 토큰을 더 받는다.
   *
   * 투명인간이 누구인지는 어차피 아침에 다 알므로 팀도 공개다 —
   * 숨기는 것은 **위치**지 이름이 아니다.
   */
  invisibleTeam?: TeamId | null
  /**
   * 눈발. **단계와 그쳤는지만** 있다.
   *
   * 「깨달은 사람 여덟」이라고 알려 주면 남은 하나를 찾아 몰아붙이게
   * 된다. 조건 숫자는 공개하지 않는다 — 눈발이 대신 알려 준다.
   */
  snow: { level: number; stopped: boolean }
}

/** games/{gameId}/tiles/{tileId} — 주인은 숨길 것이 없다. */
export interface TileDoc {
  ownerTeam: TeamId | null
  /** 보강 카드로 붙은 임시 방어. 실제 시계 기준. */
  reinforcedBy?: number
  /** 봉쇄 카드. 게임 시계 기준. */
  blockedUntilMs?: GameMs
  /**
   * 자물쇠를 건 팀. 그 팀 말고는 못 들어온다.
   *
   * 언제까지인지는 lockUntilMs 가 따로 든다 — 지난 자물쇠를 지우러
   * 다시 오는 일이 없게, 시각만 보고 살았는지 죽었는지를 판단한다.
   */
  lockedBy?: TeamId | null
  /** 자물쇠가 풀리는 시각. **게임 시계 기준.** */
  lockUntilMs?: GameMs
}

/**
 * games/{gameId}/flags/{tileId} — 깃발은 시끄럽다. 안개와 상관없이 모두 본다.
 *
 * 가짜 깃발도 **진짜와 똑같은 모양으로** 여기 놓인다. 가짜라는 사실은
 * secret에만 있어서, 다른 팀은 네트워크 응답으로도 구분할 수 없다.
 */
/** games/{gameId}/teams/{teamId} — 자원과 순위는 공개다. */
export interface TeamDoc {
  /**
   * **행동 토큰 상자. 팀에 하나뿐이다.**
   *
   * **시간마다 차지 않는다.** 페이즈가 열릴 때 한 번에 들어오고, 그
   * 페이즈 동안 이동·연구·호출·부수기가 쓴다. 전에는 자유 시간에도
   * 시간마다 차는 주머니가 따로 있었는데, 자유 시간에 값을 치르는
   * 일이 없어지면서 아무도 안 쓰는 채로 남아 있었다.
   *
   * 예전에는 사람마다 지갑이 따로였다. 그때는 누가 얼마를 쓰든 남에게
   * 지장이 없어서, 팀이라고 부르면서 실은 넷이 따로 놀았다. 이제 한
   * 주머니를 넷이 나눠 쓴다 — 먼저 쓰는 사람이 임자다.
   */
  phaseTokens?: number
  /**
   * 다음 페이즈에 얹어 줄 보정.
   *
   * 직전 페이즈에 이 팀에서 아무도 움직이지 않았을 때(결석)와 21:00
   * 정산에서 꼴찌였을 때(만회)가 여기로 들어온다. 쓰고 나면 0으로
   * 지운다 — 남겨 두면 매 페이즈 되풀이해서 얹힌다.
   */
  pendingRefund?: number

  researchTier: number
  /** 손패는 장수만 공개한다. 내용은 secret에 있다. */
  handCount: number
  /**
   * 오늘의 팀장. **네 팀이 다 뽑는다.**
   *
   * 아직 못 정했으면 null 이다 — 동점이면 풀릴 때까지 다시 뽑으므로,
   * 하루의 얼마간은 팀장이 없는 채로 흐른다.
   */
  captainId: string | null
  /** 지금 돌고 있는 팀장 투표. 정해지면 지운다. */
  captainVote?: CaptainVote | null
  /** 21:00에 공개된 점수(비밀 목표 제외). 마지막 여섯 시간에는 null. */
  publicScore: number | null
}

/**
 * games/{gameId}/pawns/{playerId} — 말의 위치.
 *
 * 이 모음은 **클라이언트가 직접 읽지 못한다.** 안개 때문이다.
 * 각자에게는 views/{playerId}에 걸러진 사본만 간다.
 */
export interface PawnDoc {
  playerId: string
  team: TeamId
  title: RoleTitle
  /**
   * 전투 자리. 직전 페이즈가 끝난 곳이다.
   *
   * 자유 시간에 아무리 멀리 가도 이 값은 안 움직인다. 페이즈가 열리면
   * 여기로 걸어 돌아오고, 옮기려면 페이즈 안에서 토큰을 써야 한다.
   */
  postTile?: TileId | null
  /** 머릿수가 모자란 팀의 주장. 점령 판정에서 둘로 센다. */
  captain?: boolean
  /**
   * 옮기기로 한 팀. **다음 페이즈가 열릴 때** 발효된다.
   *
   * 자유 시간에 마주 서서 합의해 두는 값이라, 합의한 순간부터 종이
   * 칠 때까지는 아직 옛 팀 사람이다 — 이 사이가 이적의 전부다.
   * 발효되면 지워진다.
   */
  movingTo?: TeamId | null
  /**
   * 이 팀이 된 시각. **무전이 이것을 본다.**
   *
   * 옮겨 온 사람이 새 팀의 하루치 무전을 통째로 읽으면, 배신 한 번에
   * 그 팀이 아침부터 짠 것이 전부 넘어간다. 방에서 하는 말이 「들어온
   * 뒤의 말만」인 것과 같은 규칙을 팀에도 둔다.
   */
  teamSinceMs?: GameMs
  /**
   * 무전을 마지막으로 가져간 시각. **「수신 n」이 이것을 센다.**
   *
   * 지도의 실시간 자리(live)는 걷는 동안에만 적히고 6초면 낡는다 —
   * 방에 가만히 선 팀원이 곧바로 「없는 사람」이 되어서 무전 인원으로는
   * 못 쓴다. 앱을 켜 두고 있으면 탭이 어디에 있든 무전을 계속 가져가므로,
   * 그 일 자체를 맥으로 삼는다. 판정은 한 줄도 이것을 안 본다.
   */
  radioAtMs?: GameMs
  /** 내 주머니. **산 사람이 가진다** — 자판기에 다녀온 그 사람 것이다. */
  items?: Satchel
  /**
   * 내 지갑. 돈과 지식. **팀 금고가 아니다.**
   *
   * 한때 팀마다 하나였다. 그때는 넷이 한 금고를 보고 있어서 「누가
   * 얼마를 썼다」가 곧 팀 회의였는데, 그 회의를 할 자리가 없었다 —
   * 자유 시간에 흩어져 있고 페이즈에는 시간이 없다. 번 사람이 갖고,
   * 남에게 주려면 거래로 건넨다.
   */
  resources?: Record<Resource, number>
  /**
   * 거래를 거는 데 쓰는 **개인 토큰**. 자정에 다시 찬다.
   *
   * 팀 상자와 따로다 — 한 사람이 하루 종일 말을 걸고 다녀도 팀이
   * 페이즈에 쓸 것은 안 준다. 많이 거는 사람은 제 몫을 쓰는 것이다.
   */
  dealTokens?: number
  /**
   * 한 번이라도 발을 들인 방. 사람마다 따로 쌓인다.
   *
   * 지도가 채워지는 것은 개인의 기록이다 — 남이 다녀온 곳은 내
   * 지도에 그려지지 않는다.
   */
  visitedTiles?: TileId[]
  /** 지금 선 칸. 걷는 중이면 null — 걷는 말은 어느 칸 판정에도 세지 않는다. */
  tileId: TileId | null
  /**
   * 방 안 어디에 서 있는가. **거래가 이것을 본다** — 같은 방이 아니라
   * 바로 옆 칸이라야 물건을 주고받는다.
   *
   * 화면이 걸음을 멈출 때마다 적어 보낸다. 서버는 그 칸이 정말 그
   * 사람이 있는 방 안인지만 확인한다 — 방 안 어디라고 우기는 것까지는
   * 막지 않는다. 그래 봐야 **예전 규칙(같은 방이면 된다)** 만큼이다.
   */
  at?: Cell | null
  /** 걷는 중일 때 방금 떠난 칸. 서 있으면 null. */
  fromTile: TileId | null
  /**
   * 걷는 중이라면 **남은** 경로. 앞이 바로 다음 칸이다.
   *
   * 목적지는 경로의 끝이라 이 배열에 들어 있다. 그래서 이 문서는
   * 클라이언트가 읽지 못하고, views에는 다음 한 칸만 복사된다.
   */
  path: TileId[]
  arriveAtMs: GameMs | null
  /** 앱을 닫아도 말은 남는다. 잠든 말도 판정에서 센다. */
  asleep: boolean
  /**
   * 무언가 하고 있어서 손이 묶인 시각. 그때까지 움직이지도 다른 것을
   * 하지도 못한다.
   *
   * **발 묶기(boundUntilMs)와 다르다.** 저쪽은 남이 나에게 건 것이고
   * 이쪽은 내가 고른 일이다 — 화면에 뜨는 말도, 푸는 방법도 다르다.
   * 판정에서는 둘 다 그대로 센다. 그 자리에 몸이 있기 때문이다.
   */
  busyUntilMs?: GameMs
  /** 무엇을 하느라 묶였는가. 화면이 「생산 중」이라 적는 데 쓴다. */
  busyKind?: string
  /** 발 묶기 — 움직이지도 행동하지도 못한다. 판정에서는 센다. */
  boundUntilMs?: GameMs
  /** 잠복 — 누구에게도 보이지 않는다. 판정에서는 센다. */
  hiddenUntilMs?: GameMs
  /** 오늘 쓴 토큰. 08:00에 0으로. */
  tokensUsedToday: number
  /** 오늘 표를 던졌는가. */
  votedToday: boolean
  /** 정보부장이 오늘 보낸 사람을 들여다본 횟수. */
  peeksToday: number
}

// ── 숨김: 서버만 ────────────────────────────────────────────────
// 규칙에서 클라이언트 읽기를 전면 차단한다.

/**
 * games/{gameId}/secret/votes/items/{voteId} — **보낸 사람이 여기 있다.**
 *
 * 이 컬렉션은 어느 화면에도, 운영자 대시보드에도 내려가지 않는다.
 * 정산에서 팀 합계로만 나간다. 네 명짜리 팀의 합계에서 누가 누구에게
 * 줬는지는 되짚을 수 없다.
 */
export interface VoteDoc {
  day: number
  voterId: string
  voterTeam: TeamId
  targetId: string
  targetTeam: TeamId
  kind: VoteKind
  /**
   * 그날 A의 기록이 가리킨 역할을 정확히 짚었는가. **서버만 안다.**
   *
   * 던진 사람에게도 알려 주지 않는다. 알려 주면 표 한 장으로 역할을
   * 하나씩 찍어 볼 수 있다.
   */
  castAtMs: GameMs
  /** 21:00 정산에 반영됐는가. */
  settled: boolean
}

/** games/{gameId}/secret/hands/items/{cardId} — 카드 내용. */
export interface CardDoc {
  team: TeamId
  kind: CardKind
  drawnAtMs: GameMs
  /** 라이벌 카드처럼 대상이 붙는 카드. */
  targetTeam?: TeamId
}

/**
 * games/{gameId}/secret/roster/items/{playerId} — 역할과 인연 대상.
 *
 * 남의 역할은 **어떤 경로로도 내려가지 않는다.** views에는 자기 것
 * 한 줄만 복사되고, 엔딩 전까지 그 한 줄도 본인 것뿐이다.
 */
export interface RosterDoc {
  playerId: string
  team: TeamId
  roleId: string
  /** 인연 대상. 본인에게만 알려 준다. */
  bondId: string
  /** 털어놓았는가. 방식과 시각까지. */
  reveal: { scope: 'class' | 'private'; atMs: GameMs; listenerIds: string[] } | null
}

// ── 각자 몫 ─────────────────────────────────────────────────────

/**
 * games/{gameId}/views/{playerId}
 *
 * 서버가 그 사람이 봐도 되는 만큼만 깎아 둔 것. 안개 밖의 말은 아예
 * 들어 있지 않다 — 지워서 보내는 게 아니라 처음부터 담지 않는다.
 */
export interface PlayerViewDoc {
  updatedAtMs: GameMs
  /** 지금 보이는 다른 말들. 목적지는 여기 없다 — 다음 한 칸까지다. */
  visiblePawns: {
    playerId: string
    team: TeamId
    /** 서 있는 칸. 걷는 중이면 null. */
    tileId: TileId | null
    /** 걷는 중일 때 방금 떠난 칸. */
    fromTile: TileId | null
    /** 걷는 중일 때 바로 다음 칸. */
    toTile: TileId | null
    asleep: boolean
    walking: boolean
    /** 방 안 어디에 서 있는가. 걷는 중이거나 아직 안 적었으면 없다. */
    at?: Cell | null
    /**
     * 손에 든 심부름 물건 이름. 안 들었으면 없다.
     *
     * **무엇을 들었는지까지가 보이는 것이다.** 어디서 어디로 가는지도
     * 보상이 얼마인지도 안 붙는다 — 상자를 안고 지나가는 것을 본
     * 사람이 아는 만큼이다.
     */
    carrying?: string
  }[]
  /**
   * 위 목록의 아이디만. **Firestore 규칙이 이 줄을 읽는다.**
   *
   * live/{누구} 를 열어 줄지 말지가 여기서 갈린다 — 규칙은 맵이 든
   * 배열 속을 뒤지지 못해서 아이디만 따로 둔다. 「보인다」를 정하는
   * 곳은 여전히 하나다(projectView).
   */
  visibleIds?: string[]
  /**
   * 내 말이 걷는 중이면 도착 시각. **내 것만 실린다** — 남이 언제
   * 도착하는지까지 알면 문 앞에서 기다렸다 덮치는 것이 계산이 된다.
   */
  myArriveAtMs: number | null
  /**
   * 무언가 하느라 손이 묶인 시각. 걷는 중이 아닌데도 못 움직인다.
   *
   * 화면이 이것으로 「생산 중 · 7:12」를 띄우고 걸음을 잠근다.
   * **판정과는 상관이 없다** — 묶여 있어도 그 자리에 몸이 있어서
   * 머릿수로는 그대로 센다.
   */
  myBusyUntilMs?: number | null
  /** 무엇을 하느라 묶였는가. 화면이 그대로 적는다. */
  myBusyKind?: string | null
  /** 내 전투 자리. 자유 시간에 여기서 떨어져 있으면 페이즈 때 돌아온다. */
  myPost: TileId | null
  /**
   * **페이즈 토큰 상자에 팀이 남긴 수.** 내 것이 아니라 넷이 나눠 쓴다 —
   * 먼저 쓰는 사람이 임자다. 화면에서 「내 토큰」이라 부르면 안 된다.
   */
  myTeamTokens: number
  /** 내 하루 몫에서 남은 수. */
  /** 거래를 걸 수 있는 내 개인 토큰. 하루치다. */
  /** 다음 점령전부터 갈 팀. 본인만 본다. */
  myMovingTo: TeamId | null
  myDealTokens: number
  /**
   * **우리 팀** 금고. 돈과 지식 둘뿐이고, 남의 팀 것은 오지 않는다.
   *
   * 전에는 games/{id}/teams/{t} 를 누구나 읽을 수 있어서 네 팀 금고가
   * 다 보였다. 받아서 화면에서 가리는 것이 아니라 **보내지 않는다.**
   */
  /**
   * **없을 수 있다.** 서버를 갈아끼우기 전에 쓰인 문서에는 이 칸이
   * 없다 — 화면 배포와 서버 배포 사이에 몇 분이 있고, 그 사이에
   * 들어온 사람은 옛 문서를 본다. 한 번 검은 화면으로 겪었다
   */
  myVault?: { money: number; knowledge: number }
  /** 우리 팀 물건. 남의 팀 것은 안 온다. */
  myItems?: Satchel
  /** 우리 팀 로봇 수. 남의 팀 총수는 안 온다. */
  myTeamRobots?: number
  /** 내가 데리고 다니는 로봇 수. */
  myCarriedRobots?: number
  /** 이번 페이즈에 내가 부순 로봇 수. 남의 것은 안 온다. */
  mySmashes?: number
  /** 오늘 내가 적은 사람. **남이 누구를 적었는지는 안 온다.** */
  myBallot?: string | null
  /** 보이는 방마다 서 있는 로봇 수. 정원과 별개다. */
  robotCounts?: Record<TileId, number>
  /**
   * 내가 선 방 바닥에 있는 쪽지. **한 장 있다는 것까지만이다.**
   *
   * 무엇이 적혔는지도 누구의 비밀인지도 안 온다 — 주워서 읽어야 안다.
   */
  slipsHere: { id: string }[]
  /**
   * 내가 선 방에 남은 **찢긴 조각.** 「한 무더기 있다」까지다.
   *
   * 무엇이 적혔던 종이인지도, 누가 찢었는지도 안 온다 — 테이프로
   * 붙여야 종이가 되고, 읽어야 문장이 온다.
   */
  scrapsHere?: { id: string }[]
  /**
   * 지금 잠긴 방과 잠근 팀. **보이는 방만 온다** — 안 보이는 방의
   * 자물쇠까지 오면 「저기 누가 있었다」가 공짜로 새어 나간다.
   */
  lockedTiles?: { tileId: TileId; team: TeamId }[]
  /**
   * 오늘 다 나간 품목. 자판기 칸이 어두워진다. **수는 안 온다** —
   * 남았는지 아닌지만 있으면 칸을 그린다.
   */
  soldOutItems?: string[]
  /** 게시판마다 붙은 장수. 복도 저쪽에서도 종이가 펄럭이는 것은 보인다. */
  boardCounts?: Record<string, number>
  /** 내가 선 게시판에 붙은 것들. **앞에 서야 온다.** */
  errandsHere?: {
    id: string
    thing: string
    from: TileId
    to: TileId
    coins: number
    text: string
    minutesLeft: number
    mine: boolean
  }[]
  /**
   * 내가 받아 둔 심부름. **내 것만.**
   *
   * 누가 같이 받았는지도, 남이 어디까지 했는지도 안 온다 — 경주하는
   * 중이고, 보이면 그건 경주가 아니라 중계다.
   */
  myErrand?: {
    id: string
    thing: string
    icon: string
    from: TileId
    to: TileId
    coins: number
    text: string
    minutesLeft: number
    carrying: boolean
    thingHere: boolean
    canDrop: boolean
  } | null
  /** 내가 들고 있는 쪽지. **읽은 것만** 문장이 실린다. */
  mySlips: { id: string; read: boolean; line: string | null; subjectId: string | null }[]
  /**
   * 내가 선 방의 문제 종이. 안 펼친 것은 「한 장 있다」까지다.
   * **정답과 해설은 어떤 경로로도 오지 않는다.**
   */
  quizzesHere?: {
    id: string
    kind: 'choice' | 'short'
    prompt: string | null
    choices: string[]
    opened: boolean
    iFailed: boolean
  }[]
  /** 내가 가 본 방. 지도가 채워지는 것은 개인의 기록이다. */
  visitedTiles: TileId[]
  /** 보이는 방에 있는 로봇. 사람처럼 안개를 거친다. */
  visibleRobots: { id: string; team: TeamId; tileId: TileId }[]
  /** 내가 선 방에 놓인 주인 없는 완성품. */
  madeHere: { id: string; byPlayerId: string; mine: boolean }[]
  /** 방마다 내게 보이는 머릿수. 위장이 이미 반영돼 있다. */
  roomCounts: Record<TileId, number>
  /** 안개가 걷힌 칸. 나머지는 어둡게 덮는다. */
  visibleTiles: TileId[]
  /** 우리 팀 손패. 내용까지 보인다. */
  hand: { id: string; kind: CardKind; targetTeam?: TeamId }[]
  /** 우리 팀 비밀 목표. */
  /** 우리가 꽂은 깃발 중 가짜인 것. 우리 팀만 안다. */
  /** 정보부장이 들여다본 결과. */
  peeked: { voteKind: VoteKind; voterNickname: string }[]
  /** 동맹 제안. 관련된 두 팀만. */
  proposals: { id: string; fromTeam: TeamId; toTeam: TeamId; status: string; createdAtMs: GameMs }[]
  /**
   * DAY 3·4에 내가 고른 것. **남이 무엇을 골랐는지는 없다.**
   *
   * 「누가 나를 중요한 사람으로 골랐나」가 보이면 그걸 노리고 서로
   * 붙어 다니게 된다. 고르는 일이 마음이 아니라 수가 된다.
   */
  myChoice: { chosenId: string | null; day4: string | null } | null

  // ── 진상 공개 흐름 ──
  //
  // 보관함은 **보는 사람마다 따로 만든다.** 전체 목록을 두고 「너는 이건
  // 못 봐」 표시를 붙이지 않는다 — 그러면 남의 1:1 고백이 제목만이라도
  // 실려 나간다. 여기에는 애초에 담지 않는다.

  /** 내 역할 한 줄. 남의 것은 없다. */
  own: { roleId: string; bondId: string } | null
  /** 아침 시퀀스를 어디까지 처리했는가. 본 날과 건너뛴 날이 함께 들어간다. */
  handledDays: number[]
  /** 끝까지 본 날. 보관함이 「읽지 않음」을 가리는 데 쓴다. */
  readDays: number[]
  /** 내가 말했거나 내가 들은 고백만. */
  confessions: {
    id: string
    speakerId: string
    scope: 'class' | 'private'
    listenerIds: string[]
    text: string
    atMs: GameMs
  }[]
  /** 우리 팀이 먼저 연 A의 기억. 끝나면 열셋 전부. */
  memories: { tileId: TileId; team: TeamId; atMs: GameMs }[]
  /** A의 시선. 깨달음에 이른 본인에게만. */
  sightAtMs: GameMs | null
  /** 나에게 온 운영자 공지. 전체 공지와 내 것만 섞여 있다. */
  notices: { id: string; text: string; atMs: GameMs }[]
}

// ── 채팅 ────────────────────────────────────────────────────────

/**
 * games/{gameId}/chats/{room}/messages/{id}
 *
 * 손으로 친 말과 게임이 남긴 기록을 한 줄에 섞지 않는다.
 *
 *   say     사람이 친 말. **어떤 판정에도 쓰이지 않는다.**
 *   reveal  털어놓기. 시스템 카드로 뜨고 「공인된 고백」이라 적힌다
 *   alert   우리 칸에 깃발이 꽂혔다 같은 자동 경보
 *
 * "나 털어놓을게"라고 채팅에 쓰는 것과 실제로 털어놓는 것은 완전히
 * 다른 일이다. 게임은 후자만 센다.
 */
export type ChatKind = 'say' | 'reveal' | 'alert'

export interface ChatDoc {
  kind: ChatKind
  atMs: GameMs
  /** say·reveal은 말한 사람. alert는 없다. */
  playerId?: string
  nickname?: string
  team?: TeamId
  /** say의 본문, 또는 털어놓기에 덧붙인 말. */
  text: string
  /** reveal일 때만 — 역할의 숨긴 사실 문장 그대로. */
  secretText?: string
  /** reveal일 때만 — 1:1인가 전체인가. */
  scope?: 'private' | 'class'
}

// ── 기록 ────────────────────────────────────────────────────────

/**
 * games/{gameId}/captures/{id} — 페이즈가 닫힐 때 방 하나의 주인이
 * 정해진 기록.
 *
 * **공개다.** 누가 어디 서 있었는지는 그 자리에 있던 사람이면 다 본
 * 것이고, 주인이 바뀐 것은 지도에 그대로 나온다. 개인 미션의
 * 「방어 참여」·「공격 참여」가 이 기록만 본다.
 */
export interface CaptureDoc {
  tileId: string
  /** 닫힌 뒤의 주인. 아무도 안 섰으면 null. */
  team: TeamId | null
  ownerBefore: TeamId | null
  standing: string[]
  atMs: number
  day: number
  phaseNo: number
}

/**
 * games/{gameId}/events/{eventId} — 추가만 한다.
 *
 * 따라잡기의 근거이자 비밀 목표 판정의 근거다. 칸을 뺏긴 적,
 * 남의 칸 깃발 성공 횟수, 동맹을 먼저 깼는지, 신뢰표를 준 팀,
 * 비밀을 털어놓았는지 — 전부 여기서 센다.
 */
export type EventKind =
  | 'gameStart' | 'dayStart' | 'settlement' | 'gameEnd'
  | 'move' | 'arrive'
  | 'tileCaptured' | 'tileLost'
  | 'research' | 'produce' | 'study' | 'shopBought'
  | 'vote' | 'rumor' | 'reveal' | 'leverageGained' | 'leverageSpent'
  | 'cardDrawn' | 'cardPlayed'
  | 'tradeProposed' | 'tradeAccepted' | 'tradeDeclined'
  | 'goalRevealed' | 'spotlight' | 'comeback'

export interface EventDoc {
  atMs: GameMs
  day: number
  kind: EventKind
  team?: TeamId
  playerId?: string
  tileId?: TileId
  /** 자세한 것은 여기. 판정에 쓰는 값은 반드시 필드로 남긴다. */
  detail?: Record<string, unknown>
}

/**
 * games/{gameId}/schedule/{id} — 예정 이벤트.
 *
 * 상시 켜진 서버를 전제하지 않는다. 요청이 들어오면 밀린 것을 시각
 * 순으로 따라잡는다. 정시 이벤트는 Cloud Scheduler가 있으면 제때
 * 돌고, 없어도 다음 요청에 함께 처리된다.
 */
export type ScheduleKind = 'arrive' | 'dayStart' | 'tokenGrant' | 'settlement' | 'lastHours' | 'gameEnd'

export interface ScheduleDoc {
  dueAtMs: GameMs
  /** 같은 시각이면 이 값이 작은 것부터. */
  ord: number
  kind: ScheduleKind
  payload: Record<string, unknown>
  doneAtMs: GameMs | null
}

/** 같은 시각에 겹치면 이동 도착 → 깃발 판정 → 정시 이벤트 순이다. */
export const SCHEDULE_ORD: Record<ScheduleKind, number> = {
  arrive: 10,
  dayStart: 30,
  tokenGrant: 30,
  settlement: 30,
  lastHours: 30,
  gameEnd: 30,
}

// ── 진상 공개 흐름 ──────────────────────────────────────────────
//
// 이 넷만 규칙이 클라이언트에게 직접 열어 준다. 나머지는 전부 서버를
// 거친다. 여는 이유가 저마다 다르니 하나씩 적어 둔다.

/**
 * games/{gameId}/notes/{playerId} — 추리 노트.
 *
 * **본인만 읽고 본인만 쓴다. 운영자도 못 읽는다.** 판정에 쓰이지 않는
 * 개인 메모라 서버가 검사할 것이 없고, 서버를 거치게 하면 혼자
 * 끄적이는 자리가 느려질 뿐이다. 그래서 유일하게 클라이언트가 직접
 * 쓰는 문서다.
 *
 * 모양은 shared/reveal/notes.ts의 DeductionNote 그대로다.
 */
export interface NoteDoc {
  ownerId: string
  entryNotes: Record<string, string>
  board: { targetId: string; guess: string; note: string; updatedAtMs: number }[]
  history: { targetId: string; from: string; to: string; atMs: number }[]
}

/**
 * games/{gameId}/retired/{playerId} — 역할을 내려놓았다.
 *
 * 자기 것만 만들 수 있고 되돌릴 수 없다. 회고 게시판에 글을 쓰려면
 * 이 문서가 있어야 한다 — 아직 역할 안에 있는 사람이 끼면 그 한 줄이
 * 연기인지 아닌지 읽는 쪽이 알 수 없다.
 */
export interface RetiredDoc {
  playerId: string
  atMs: GameMs
}

/**
 * games/{gameId}/retro/{postId} — 회고 게시판.
 *
 * 익명 글에는 authorId가 **아예 없다.** null도 아니고 빈 문자열도
 * 아니다. 규칙이 그 열쇠가 들어 있으면 거절한다. 담아 두고 화면에서
 * 이름만 가리면 문서를 직접 읽는 순간 누군지 보인다.
 */
export interface RetroDoc {
  authorId?: string
  anonymous: boolean
  text: string
  atMs: GameMs
}

/**
 * games/{gameId}/notices/{noticeId} — 운영자 공지.
 *
 * 전원 공지와 한 사람 공지가 같은 자리에 쌓인다. 사람마다 보일 것이
 * 다르므로 서버가 views에 따로 깎아 넣는다 — 이 컬렉션 자체는
 * 클라이언트가 읽지 않는다.
 */
export interface NoticeDoc {
  /** null이면 전원에게. */
  toPlayerId: string | null
  text: string
  atMs: GameMs
  byId: string
}

// ── 견제·약점처럼 기한이 붙는 것 ────────────────────────────────

/** games/{gameId}/secret/leverage/items/{id} — 누가 누구의 약점을 쥐었는가. */
export interface LeverageDoc {
  holderId: string
  aboutId: string
  gainedAtMs: GameMs
  spentAs: 'bind' | 'extort' | null
}
