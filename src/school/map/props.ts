// 소품 목록. **그림은 propArt.ts 에만 있고, 여기서는 이름과 성질만 정한다.**
//
// 크기는 그림에서 저절로 나온다 — 32 글자짜리 줄은 두 칸짜리 소품이다.
// 손으로 적은 크기표를 따로 두면 그림을 고칠 때마다 어긋나므로 두지 않는다.
import * as ART from './propArt'

/**
 * 소품 하나하나. 키가 곧 이름이고, 이 목록에 없는 이름은 쓸 수 없다.
 *
 * 스물넷 방이 저마다 다른 것을 놓는다 — 이름표를 가려도 어느 실인지
 * 알아야 한다. 창고만 비운다.
 */
export const PROP_ART = {
  // 미술실
  bust: ART.BUST,
  paintCan: ART.PAINT_CAN,
  brushJar: ART.BRUSH_JAR,
  artFrame: ART.ART_FRAME,
  ragPile: ART.RAG_PILE,
  // 과학실
  skeleton: ART.SKELETON,
  beakers: ART.BEAKERS,
  microscope: ART.MICROSCOPE,
  burner: ART.BURNER,
  periodic: ART.PERIODIC,
  specimen: ART.SPECIMEN,
  // 음악실
  musicStand: ART.MUSIC_STAND,
  guitar: ART.GUITAR,
  scoreStack: ART.SCORE_STACK,
  metronome: ART.METRONOME,
  composerFrame: ART.COMPOSER_FRAME,
  // 도서관
  bookStack: ART.BOOK_STACK,
  readingStand: ART.READING_STAND,
  cardBox: ART.CARD_BOX,
  returnBin: ART.RETURN_BIN,
  ladder: ART.LADDER,
  // 시청각실
  projector: ART.PROJECTOR,
  screenWall: ART.SCREEN_WALL,
  speaker: ART.SPEAKER,
  filmReel: ART.FILM_REEL,
  cableCoil: ART.CABLE_COIL,
  tapeBox: ART.TAPE_BOX,
  // 동아리실
  sofa: ART.SOFA,
  corkBoard: ART.CORK_BOARD,
  cupStack: ART.CUP_STACK,
  guitarCase: ART.GUITAR_CASE,
  radio: ART.RADIO,
  crates: ART.CRATES,
  // 무용실
  mirrorWall: ART.MIRROR_WALL,
  balletBar: ART.BALLET_BAR,
  matRoll: ART.MAT_ROLL,
  towelBasket: ART.TOWEL_BASKET,
  slippers: ART.SLIPPERS,
  // 방송실
  micStand: ART.MIC_STAND,
  mixer: ART.MIXER,
  headphones: ART.HEADPHONES,
  onAir: ART.ON_AIR,
  cameraTripod: ART.CAMERA_TRIPOD,
  // 학생회실
  suggestBox: ART.SUGGEST_BOX,
  whiteBoard: ART.WHITE_BOARD,
  fileStack: ART.FILE_STACK,
  trophyShelf: ART.TROPHY_SHELF,
  councilTable: ART.COUNCIL_TABLE,
  // 2-3 교실
  blackboard: ART.BLACKBOARD,
  podium: ART.PODIUM,
  timetable: ART.TIMETABLE,
  cleanLocker: ART.CLEAN_LOCKER,
  deskRow: ART.DESK_ROW,
  // 옥상
  vent: ART.VENT,
  acUnit: ART.AC_UNIT,
  waterTank: ART.WATER_TANK,
  fenceRail: ART.FENCE_RAIL,
  laundry: ART.LAUNDRY,
  // 교무실
  teacherDesk: ART.TEACHER_DESK,
  rollShelf: ART.ROLL_SHELF,
  coffeePot: ART.COFFEE_POT,
  deskPhone: ART.DESK_PHONE,
  wallClock: ART.WALL_CLOCK,
  // 급식실
  trayStack: ART.TRAY_STACK,
  foodCart: ART.FOOD_CART,
  waterCooler: ART.WATER_COOLER,
  wasteBin: ART.WASTE_BIN,
  menuBoard: ART.MENU_BOARD,
  // 양호실
  sickBed: ART.SICK_BED,
  curtain: ART.CURTAIN,
  medCabinet: ART.MED_CABINET,
  scale: ART.SCALE,
  anatomyChart: ART.ANATOMY_CHART,
  // 상점
  displayRack: ART.DISPLAY_RACK,
  counter: ART.COUNTER,
  ledger: ART.LEDGER,
  hangRail: ART.HANG_RAIL,
  lostShoe: ART.LOST_SHOE,
  // 가사실
  cooktop: ART.COOKTOP,
  sink: ART.SINK,
  potShelf: ART.POT_SHELF,
  sewingMachine: ART.SEWING_MACHINE,
  apronHook: ART.APRON_HOOK,
  cuttingBoard: ART.CUTTING_BOARD,
  // 체육관
  hoop: ART.HOOP,
  matPile: ART.MAT_PILE,
  ballBasket: ART.BALL_BASKET,
  bleachers: ART.BLEACHERS,
  wallBar: ART.WALL_BAR,
  // 강당
  stage: ART.STAGE,
  lightRig: ART.LIGHT_RIG,
  lectern: ART.LECTERN,
  banner: ART.BANNER,
  seatRow: ART.SEAT_ROW,
  // 운동장
  goalPost: ART.GOAL_POST,
  pullUpBar: ART.PULL_UP_BAR,
  sandpit: ART.SANDPIT,
  platform: ART.PLATFORM,
  tireSteps: ART.TIRE_STEPS,
  // 연구실
  workbench: ART.WORKBENCH,
  paperStack: ART.PAPER_STACK,
  oldUniform: ART.OLD_UNIFORM,
  shears: ART.SHEARS,
  threadSpool: ART.THREAD_SPOOL,
  halfDoll: ART.HALF_DOLL,
  // 정원
  flowerBed: ART.FLOWER_BED,
  wateringCan: ART.WATERING_CAN,
  toolRack: ART.TOOL_RACK,
  sapling: ART.SAPLING,
  stoneBench: ART.STONE_BENCH,
  // 화장실
  sinkRow: ART.SINK_ROW,
  stallDoor: ART.STALL_DOOR,
  mirrorSmall: ART.MIRROR_SMALL,
  mopBucket: ART.MOP_BUCKET,
  paperRoll: ART.PAPER_ROLL,
  // 기술실
  viseBench: ART.VISE_BENCH,
  toolBoard: ART.TOOL_BOARD,
  drillPress: ART.DRILL_PRESS,
  lumberPile: ART.LUMBER_PILE,
  sawdustBin: ART.SAWDUST_BIN,
  // 경비실
  keyRack: ART.KEY_RACK,
  monitorStack: ART.MONITOR_STACK,
  flashlight: ART.FLASHLIGHT,
  umbrellaStand: ART.UMBRELLA_STAND,
  // 예전부터 있던 것 — 아직 어울리는 방이 있다
  desk: ART.DESK,
  shelf: ART.SHELF,
  table: ART.TABLE,
  plant: ART.PLANT,
  box: ART.BOX,
  locker: ART.LOCKER,
  labBench: ART.LAB_BENCH,
  easel: ART.EASEL,
  piano: ART.PIANO,
  vault: ART.VAULT,
  canteen: ART.CANTEEN,
  cabinet: ART.CABINET,
  seats: ART.SEATS,
  console: ART.CONSOLE,
  meetingTable: ART.MEETING_TABLE,
  statue: ART.STATUE,
  bench: ART.BENCH,
  tree: ART.TREE,
  // 복도 — 게시판. **붙은 것이 있으면 다른 그림을 쓴다**
  noticeBoard: ART.NOTICE_BOARD,
  noticeBoardFull: ART.NOTICE_BOARD_FULL,
  // 복도 — 자판기. 층마다 한 대다(shop.ts 의 VENDINGS)
  vending: ART.VENDING,
  trapMaker: ART.TRAP_MAKER,
  labMachine: ART.LAB_MACHINE,
} as const

export type PropKind = keyof typeof PROP_ART

export const PROP_KINDS = Object.keys(PROP_ART) as PropKind[]

/** 한 칸은 16×16 이다. */
export const TILE_PX = 16

/** 그 소품이 몇 칸을 차지하는가. 그림 크기에서 바로 나온다. */
export function propTiles(kind: PropKind): { w: number; h: number } {
  const rows = PROP_ART[kind] as readonly string[]
  return { w: rows[0].length / TILE_PX, h: rows.length / TILE_PX }
}

/**
 * 벽에 붙는 것. **방 안쪽 맨 윗줄에만 놓는다** — 바로 위가 벽이라
 * 액자도 칠판도 거울도 벽에 걸린 것으로 보인다. 아랫줄에 놓으면
 * 허공에 뜬다.
 */
export const WALL_PROPS: ReadonlySet<PropKind> = new Set<PropKind>([
  'artFrame', 'periodic', 'composerFrame', 'screenWall', 'corkBoard',
  'mirrorWall', 'balletBar', 'onAir', 'whiteBoard', 'trophyShelf',
  'blackboard', 'timetable', 'wallClock', 'menuBoard', 'curtain',
  'anatomyChart', 'hangRail', 'potShelf', 'apronHook', 'hoop', 'wallBar',
  'lightRig', 'banner', 'toolRack', 'stallDoor', 'mirrorSmall',
  'toolBoard', 'keyRack', 'fenceRail',
])

for (const k of PROP_KINDS) {
  const { w, h } = propTiles(k)
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`${k} 그림이 16의 배수가 아니다: ${w * TILE_PX}×${h * TILE_PX}`)
  }
}
