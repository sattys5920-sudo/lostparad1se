// 가구가 놓인 자리. **한 번 굴려서 굳힌 값이다.**
//
// scripts/gen-furniture.ts 가 만든다. 판마다 가구가 옮겨 다니면
// 「아까 그 방」을 알아볼 수가 없어서, 무작위는 한 번만 돌리고
// 나온 좌표를 여기에 적어 둔다. 손으로 고쳐도 되지만, 고치면
// world.ts 가 켜질 때 문 앞을 막지 않았는지 다시 따져 본다.
//
// 좌표는 **방 안에서 센 칸수**다(왼쪽 위가 0,0). 판 전체 좌표로
// 적으면 층 간격 같은 것을 손댈 때 전부 어긋난다.
import type { PropKind } from './props'
import type { TileId } from '../types'

export interface PlacedProp {
  readonly kind: PropKind
  readonly x: number
  readonly y: number
}

export interface PlacedSign {
  readonly x: number
  readonly y: number
}

export interface RoomFurniture {
  readonly props: readonly PlacedProp[]
  /** 팻말 왼쪽 끝. 판 너비는 방 이름에서 나온다(signs.ts). */
  readonly sign: PlacedSign
}

export const FURNITURE: Readonly<Record<TileId, RoomFurniture>> = {
  // 창고
  storage: {
    props: [
      // 비워 둔다
    ],
    sign: { x: 7, y: 8 },
  },
  // 기술실
  baseC: {
    props: [
      { kind: 'viseBench', x: 9, y: 1 },
      { kind: 'toolBoard', x: 11, y: 0 },
      { kind: 'drillPress', x: 0, y: 8 },
      { kind: 'lumberPile', x: 1, y: 4 },
      { kind: 'sawdustBin', x: 4, y: 9 },
      { kind: 'labBench', x: 7, y: 9 },
    ],
    sign: { x: 8, y: 9 },
  },
  // 경비실
  oldBuilding: {
    props: [
      { kind: 'keyRack', x: 3, y: 0 },
      { kind: 'monitorStack', x: 11, y: 7 },
      { kind: 'ledger', x: 0, y: 6 },
      { kind: 'flashlight', x: 12, y: 3 },
      { kind: 'umbrellaStand', x: 12, y: 7 },
      { kind: 'plant', x: 7, y: 6 },
    ],
    sign: { x: 10, y: 0 },
  },
  // 교무실
  baseA: {
    props: [
      { kind: 'teacherDesk', x: 7, y: 3 },
      { kind: 'rollShelf', x: 10, y: 9 },
      { kind: 'coffeePot', x: 11, y: 9 },
      { kind: 'deskPhone', x: 9, y: 3 },
      { kind: 'wallClock', x: 4, y: 0 },
      { kind: 'meetingTable', x: 0, y: 2 },
    ],
    sign: { x: 7, y: 9 },
  },
  // 급식실
  cafeteria: {
    props: [
      { kind: 'trayStack', x: 8, y: 8 },
      { kind: 'foodCart', x: 8, y: 7 },
      { kind: 'waterCooler', x: 2, y: 3 },
      { kind: 'wasteBin', x: 0, y: 3 },
      { kind: 'menuBoard', x: 8, y: 0 },
      { kind: 'canteen', x: 2, y: 2 },
    ],
    sign: { x: 6, y: 11 },
  },
  // 양호실
  annex: {
    props: [
      { kind: 'sickBed', x: 0, y: 4 },
      { kind: 'curtain', x: 5, y: 0 },
      { kind: 'medCabinet', x: 7, y: 6 },
      { kind: 'scale', x: 0, y: 6 },
      { kind: 'anatomyChart', x: 4, y: 0 },
      { kind: 'bench', x: 7, y: 4 },
    ],
    sign: { x: 5, y: 7 },
  },
  // 상점
  classroom: {
    props: [
      { kind: 'displayRack', x: 7, y: 7 },
      { kind: 'counter', x: 6, y: 2 },
      { kind: 'ledger', x: 1, y: 4 },
      { kind: 'hangRail', x: 3, y: 0 },
      { kind: 'lostShoe', x: 2, y: 1 },
      { kind: 'table', x: 7, y: 8 },
    ],
    sign: { x: 6, y: 10 },
  },
  // 가사실
  hallway: {
    props: [
      { kind: 'cooktop', x: 9, y: 6 },
      { kind: 'sink', x: 8, y: 5 },
      { kind: 'potShelf', x: 5, y: 0 },
      { kind: 'sewingMachine', x: 0, y: 6 },
      { kind: 'apronHook', x: 2, y: 0 },
      { kind: 'cuttingBoard', x: 7, y: 1 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 체육관
  gym: {
    props: [
      { kind: 'hoop', x: 0, y: 0 },
      { kind: 'matPile', x: 1, y: 3 },
      { kind: 'ballBasket', x: 1, y: 7 },
      { kind: 'bleachers', x: 0, y: 5 },
      { kind: 'wallBar', x: 2, y: 0 },
      { kind: 'vault', x: 2, y: 7 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 강당
  auditorium: {
    props: [
      { kind: 'stage', x: 7, y: 9 },
      { kind: 'lightRig', x: 2, y: 0 },
      { kind: 'lectern', x: 2, y: 7 },
      { kind: 'banner', x: 0, y: 0 },
      { kind: 'seatRow', x: 0, y: 9 },
      { kind: 'statue', x: 2, y: 2 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 운동장
  playground: {
    props: [
      { kind: 'goalPost', x: 2, y: 9 },
      { kind: 'pullUpBar', x: 6, y: 2 },
      { kind: 'sandpit', x: 0, y: 3 },
      { kind: 'platform', x: 7, y: 3 },
      { kind: 'tireSteps', x: 1, y: 2 },
      { kind: 'bench', x: 6, y: 9 },
    ],
    sign: { x: 5, y: 0 },
  },
  // 연구실
  labRoom: {
    props: [
      { kind: 'workbench', x: 10, y: 7 },
      { kind: 'paperStack', x: 0, y: 3 },
      { kind: 'oldUniform', x: 8, y: 9 },
      { kind: 'shears', x: 0, y: 9 },
      { kind: 'threadSpool', x: 2, y: 6 },
      { kind: 'halfDoll', x: 9, y: 6 },
    ],
    sign: { x: 5, y: 0 },
  },
  // 정원
  garden: {
    props: [
      { kind: 'flowerBed', x: 5, y: 7 },
      { kind: 'wateringCan', x: 7, y: 4 },
      { kind: 'toolRack', x: 5, y: 0 },
      { kind: 'sapling', x: 2, y: 3 },
      { kind: 'stoneBench', x: 6, y: 5 },
      { kind: 'tree', x: 6, y: 6 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 화장실
  baseB: {
    props: [
      { kind: 'sinkRow', x: 0, y: 8 },
      { kind: 'stallDoor', x: 0, y: 0 },
      { kind: 'mirrorSmall', x: 4, y: 0 },
      { kind: 'mopBucket', x: 8, y: 4 },
      { kind: 'paperRoll', x: 8, y: 7 },
      { kind: 'box', x: 9, y: 8 },
    ],
    sign: { x: 7, y: 0 },
  },
  // 2-3 교실
  centralPlaza: {
    props: [
      { kind: 'blackboard', x: 12, y: 0 },
      { kind: 'podium', x: 14, y: 3 },
      { kind: 'timetable', x: 9, y: 0 },
      { kind: 'cleanLocker', x: 5, y: 2 },
      { kind: 'deskRow', x: 3, y: 2 },
      { kind: 'desk', x: 15, y: 5 },
    ],
    sign: { x: 9, y: 7 },
  },
  // 과학실
  scienceRoom: {
    props: [
      { kind: 'skeleton', x: 6, y: 2 },
      { kind: 'beakers', x: 5, y: 6 },
      { kind: 'microscope', x: 1, y: 4 },
      { kind: 'burner', x: 9, y: 6 },
      { kind: 'periodic', x: 5, y: 0 },
      { kind: 'specimen', x: 7, y: 5 },
    ],
    sign: { x: 6, y: 6 },
  },
  // 음악실
  musicRoom: {
    props: [
      { kind: 'musicStand', x: 11, y: 2 },
      { kind: 'guitar', x: 11, y: 5 },
      { kind: 'scoreStack', x: 2, y: 5 },
      { kind: 'metronome', x: 6, y: 2 },
      { kind: 'composerFrame', x: 3, y: 0 },
      { kind: 'piano', x: 12, y: 2 },
    ],
    sign: { x: 8, y: 7 },
  },
  // 미술실
  artRoom: {
    props: [
      { kind: 'bust', x: 10, y: 6 },
      { kind: 'paintCan', x: 8, y: 5 },
      { kind: 'brushJar', x: 9, y: 7 },
      { kind: 'artFrame', x: 0, y: 0 },
      { kind: 'ragPile', x: 0, y: 4 },
      { kind: 'easel', x: 9, y: 2 },
    ],
    sign: { x: 7, y: 0 },
  },
  // 도서관
  library: {
    props: [
      { kind: 'bookStack', x: 2, y: 4 },
      { kind: 'readingStand', x: 8, y: 3 },
      { kind: 'cardBox', x: 7, y: 5 },
      { kind: 'returnBin', x: 1, y: 10 },
      { kind: 'ladder', x: 10, y: 5 },
      { kind: 'shelf', x: 3, y: 7 },
    ],
    sign: { x: 7, y: 0 },
  },
  // 시청각실
  baseD: {
    props: [
      { kind: 'projector', x: 9, y: 2 },
      { kind: 'screenWall', x: 0, y: 0 },
      { kind: 'speaker', x: 8, y: 2 },
      { kind: 'filmReel', x: 3, y: 10 },
      { kind: 'seats', x: 7, y: 7 },
      { kind: 'tapeBox', x: 2, y: 9 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 무용실
  newBuilding: {
    props: [
      { kind: 'mirrorWall', x: 0, y: 0 },
      { kind: 'balletBar', x: 10, y: 0 },
      { kind: 'matRoll', x: 3, y: 7 },
      { kind: 'towelBasket', x: 3, y: 1 },
      { kind: 'slippers', x: 5, y: 7 },
      { kind: 'plant', x: 6, y: 7 },
    ],
    sign: { x: 7, y: 0 },
  },
  // 방송실
  broadcastRoom: {
    props: [
      { kind: 'micStand', x: 4, y: 7 },
      { kind: 'mixer', x: 7, y: 3 },
      { kind: 'headphones', x: 0, y: 6 },
      { kind: 'onAir', x: 10, y: 0 },
      { kind: 'cameraTripod', x: 9, y: 7 },
      { kind: 'console', x: 3, y: 3 },
    ],
    sign: { x: 7, y: 0 },
  },
  // 학생회실
  studentCouncil: {
    props: [
      { kind: 'suggestBox', x: 1, y: 5 },
      { kind: 'whiteBoard', x: 2, y: 0 },
      { kind: 'fileStack', x: 2, y: 8 },
      { kind: 'trophyShelf', x: 1, y: 0 },
      { kind: 'councilTable', x: 7, y: 2 },
      { kind: 'locker', x: 0, y: 8 },
    ],
    sign: { x: 6, y: 0 },
  },
  // 동아리실
  clubRoom: {
    props: [
      { kind: 'sofa', x: 6, y: 6 },
      { kind: 'corkBoard', x: 5, y: 0 },
      { kind: 'cupStack', x: 6, y: 2 },
      { kind: 'guitarCase', x: 2, y: 3 },
      { kind: 'radio', x: 1, y: 3 },
      { kind: 'crates', x: 2, y: 7 },
    ],
    sign: { x: 0, y: 0 },
  },
  // 옥상
  rooftop: {
    props: [
      { kind: 'vent', x: 9, y: 5 },
      { kind: 'acUnit', x: 4, y: 2 },
      { kind: 'waterTank', x: 31, y: 7 },
      { kind: 'fenceRail', x: 21, y: 0 },
      { kind: 'laundry', x: 25, y: 8 },
      { kind: 'box', x: 1, y: 3 },
    ],
    sign: { x: 4, y: 0 },
  },
}
