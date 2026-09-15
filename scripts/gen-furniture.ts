// 가구 자리를 한 번 굴려서 src/school/map/furniture.ts 에 굳힌다.
//
//   npx vite-node scripts/gen-furniture.ts
//
// **평소에는 돌리지 않는다.** 돌리면 학교 안 가구가 전부 자리를
// 옮긴다. 방을 새로 만들거나 소품 목록을 고쳤을 때만 돌리고, 나온
// 파일을 그대로 커밋한다.
import { writeFileSync } from 'node:fs'
import { propTiles, WALL_PROPS, type PropKind } from '../src/school/map/props'
import { signTiles } from '../src/school/map/signs'
import { centerOf, DOORS, inDoorLane, ROOMS, roomById, STAIRS } from '../src/school/map/world'
import type { TileId } from '../src/school/types'

/**
 * 방마다 놓을 것. **큰 방일수록 많이 놓는다.**
 *
 * 한동안 어느 방이나 여섯이었다. 그랬더니 옥상(40×12)과 경비실(18×9)
 * 이 텅 비어 보였다 — 같은 여섯이라도 예순네 칸에 놓인 여섯과 사백
 * 여든 칸에 놓인 여섯은 다르다. 열여섯 칸에 하나꼴로 잡고, 여섯에서
 * 열 사이로 자른다. 목록은 그보다 길어도 되고, 앞에서부터 쓴다.
 */
const PLAN: Partial<Record<TileId, PropKind[]>> = {
  artRoom: ['bust', 'paintCan', 'brushJar', 'artFrame', 'ragPile', 'easel', 'table', 'shelf'],
  scienceRoom: ['skeleton', 'beakers', 'microscope', 'burner', 'periodic', 'specimen'],
  musicRoom: ['piano', 'musicStand', 'guitar', 'scoreStack', 'metronome', 'composerFrame', 'seats'],
  library: ['shelf', 'bookStack', 'readingStand', 'cardBox', 'returnBin', 'ladder', 'shelf', 'table'],
  baseD: ['screenWall', 'projector', 'speaker', 'filmReel', 'seats', 'tapeBox', 'seats'],
  clubRoom: ['sofa', 'corkBoard', 'cupStack', 'guitarCase', 'radio', 'crates'],
  newBuilding: ['mirrorWall', 'balletBar', 'matRoll', 'towelBasket', 'slippers', 'plant', 'matRoll'],
  broadcastRoom: ['micStand', 'mixer', 'headphones', 'onAir', 'cameraTripod', 'console'],
  studentCouncil: ['suggestBox', 'whiteBoard', 'fileStack', 'trophyShelf', 'councilTable', 'locker'],
  centralPlaza: ['blackboard', 'deskRow', 'deskRow', 'podium', 'cleanLocker', 'timetable', 'desk', 'desk'],
  rooftop: ['acUnit', 'waterTank', 'fenceRail', 'laundry', 'vent', 'crates', 'bench', 'vent', 'box', 'box'],
  baseA: ['teacherDesk', 'meetingTable', 'cabinet', 'rollShelf', 'coffeePot', 'deskPhone', 'wallClock', 'fileStack'],
  cafeteria: ['canteen', 'foodCart', 'table', 'trayStack', 'waterCooler', 'wasteBin', 'menuBoard', 'trayStack'],
  annex: ['sickBed', 'curtain', 'medCabinet', 'scale', 'anatomyChart', 'bench'],
  classroom: ['displayRack', 'counter', 'ledger', 'hangRail', 'lostShoe', 'table'],
  hallway: ['cooktop', 'sink', 'potShelf', 'sewingMachine', 'apronHook', 'cuttingBoard'],
  gym: ['hoop', 'matPile', 'ballBasket', 'bleachers', 'wallBar', 'vault'],
  auditorium: ['stage', 'lightRig', 'lectern', 'banner', 'seatRow', 'statue'],
  playground: ['goalPost', 'pullUpBar', 'sandpit', 'platform', 'tireSteps', 'bench'],
  labRoom: ['workbench', 'labBench', 'paperStack', 'oldUniform', 'shears', 'threadSpool', 'halfDoll', 'crates'],
  garden: ['flowerBed', 'wateringCan', 'toolRack', 'sapling', 'stoneBench', 'tree'],
  baseB: ['sinkRow', 'stallDoor', 'mirrorSmall', 'mopBucket', 'paperRoll', 'box'],
  baseC: ['viseBench', 'toolBoard', 'labBench', 'lumberPile', 'drillPress', 'sawdustBin', 'crates', 'toolRack'],
  oldBuilding: ['monitorStack', 'cabinet', 'table', 'keyRack', 'ledger', 'flashlight', 'umbrellaStand', 'bench', 'crates', 'plant'],
  // 창고는 문을 닫은 채 비워 둔다
  storage: [],
}

const SEED = 20260315

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Placed { kind: PropKind; x: number; y: number }

/** 한 칸당 소품 하나. 열여섯 칸에 하나꼴이고, 여섯에서 열 사이다. */
const howMany = (w: number, h: number): number =>
  Math.min(10, Math.max(6, Math.round((w * h) / 16)))

const out: Record<string, { props: Placed[]; sign: { x: number; y: number } }> = {}
const notes: string[] = []

for (const room of ROOMS) {
  const r = roomById[room.id].rects[0]
  const want = room.id === 'storage' ? 0 : howMany(r.w, r.h)
  const list = (PLAN[room.id] ?? []).slice(0, want)
  if (list.length < want) {
    throw new Error(`${room.name} 은 ${want}개가 필요한데 목록에 ${list.length}개뿐이다`)
  }

  /** 아무것도 못 놓는 칸. 문 앞 길, 계단, 한가운데와 그 사방. */
  const keepClear = new Set<string>()
  for (let ly = 0; ly < r.h; ly++) {
    for (let lx = 0; lx < r.w; lx++) {
      if (inDoorLane(r.x + lx, r.y + ly)) keepClear.add(`${lx},${ly}`)
    }
  }
  const c = centerOf(room.id)
  for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    keepClear.add(`${c.x - r.x + dx},${c.y - r.y + dy}`)
  }
  for (const s of STAIRS) {
    for (const [sx, sy] of [[s.x, s.y], [s.toX, s.toY]]) {
      const lx = sx - r.x
      const ly = sy - r.y
      if (lx >= 0 && ly >= 0 && lx < r.w && ly < r.h) {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) keepClear.add(`${lx + ox},${ly + oy}`)
      }
    }
  }

  // ── 팻말 자리. 소품보다 먼저 잡는다 — 문 옆이라는 자리가 정해져 있다
  const mine = DOORS.filter((d) => d.a === room.id)
  const main = mine.find((d) => d.horizontal) ?? mine[0] ?? null
  const signW = signTiles(room.name)
  const rowOf = (): number => {
    if (!main) return 0
    if (main.horizontal) return main.y < r.y ? 0 : r.h - 1
    return 0
  }
  const fits = (lx: number, ly: number, w: number): boolean => {
    if (lx < 0 || ly < 0 || ly >= r.h || lx + w > r.w) return false
    for (let i = 0; i < w; i++) if (keepClear.has(`${lx + i},${ly}`)) return false
    return true
  }
  let sign: { x: number; y: number } | null = null
  const wantRow = rowOf()
  const near = main ? main.x - r.x : 2
  const tries: [number, number][] = []
  for (const row of [wantRow, 0, r.h - 1]) {
    tries.push([near + 2, row], [near - 1 - signW, row])
    for (let lx = 0; lx + signW <= r.w; lx++) tries.push([lx, row])
  }
  for (const [lx, ly] of tries) {
    if (fits(lx, ly, signW)) { sign = { x: lx, y: ly }; break }
  }
  if (!sign) throw new Error(`${room.name} 에 팻말 놓을 자리가 없다`)
  /** 실제로 길을 막는 칸. keepClear 와 다르다 — 문 앞 길은 비워 두되 막히지는 않는다. */
  const signCells: string[] = []
  for (let i = 0; i < signW; i++) {
    keepClear.add(`${sign.x + i},${sign.y}`)
    signCells.push(`${sign.x + i},${sign.y}`)
  }

  // ── 소품. 자리가 겹치거나 방이 두 동강 나면 다시 굴린다
  const reach = (blocked: Set<string>): boolean => {
    const startCells: string[] = []
    for (const d of mine) {
      const lx = Math.min(Math.max(d.x - r.x, 0), r.w - 1)
      const ly = Math.min(Math.max(d.y - r.y, 0), r.h - 1)
      startCells.push(`${lx},${ly}`)
    }
    for (const s of STAIRS) {
      const lx = s.x - r.x
      const ly = s.y - r.y
      if (lx >= 0 && ly >= 0 && lx < r.w && ly < r.h) startCells.push(`${lx},${ly}`)
    }
    if (startCells.length === 0) startCells.push(`${c.x - r.x},${c.y - r.y}`)
    const seen = new Set<string>()
    const q = startCells.filter((k) => !blocked.has(k))
    q.forEach((k) => seen.add(k))
    while (q.length > 0) {
      const [lx, ly] = (q.pop() as string).split(',').map(Number)
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = lx + dx
        const ny = ly + dy
        const k = `${nx},${ny}`
        if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue
        if (blocked.has(k) || seen.has(k)) continue
        seen.add(k)
        q.push(k)
      }
    }
    for (let ly = 0; ly < r.h; ly++) {
      for (let lx = 0; lx < r.w; lx++) {
        if (!blocked.has(`${lx},${ly}`) && !seen.has(`${lx},${ly}`)) return false
      }
    }
    return true
  }

  let placed: Placed[] | null = null
  for (let attempt = 0; attempt < 400 && !placed; attempt++) {
    const rand = rng(SEED + attempt * 7919 + room.id.length * 131 + [...room.id].reduce((n, ch) => n + ch.charCodeAt(0), 0))
    const taken = new Set(keepClear)
    const blocked = new Set(signCells)
    const got: Placed[] = []
    let failed = false
    for (const kind of list) {
      const size = propTiles(kind)
      const onWall = WALL_PROPS.has(kind)
      const spots: [number, number][] = []
      const yFrom = onWall ? 0 : 1
      const yTo = onWall ? 0 : r.h - size.h
      for (let ly = yFrom; ly <= yTo; ly++) {
        for (let lx = 0; lx + size.w <= r.w; lx++) {
          let ok = true
          for (let oy = 0; oy < size.h && ok; oy++) {
            for (let ox = 0; ox < size.w && ok; ox++) if (taken.has(`${lx + ox},${ly + oy}`)) ok = false
          }
          if (ok) spots.push([lx, ly])
        }
      }
      if (spots.length === 0) { failed = true; break }
      const [lx, ly] = spots[Math.floor(rand() * spots.length)]
      for (let oy = 0; oy < size.h; oy++) {
        for (let ox = 0; ox < size.w; ox++) {
          taken.add(`${lx + ox},${ly + oy}`)
          blocked.add(`${lx + ox},${ly + oy}`)
        }
      }
      got.push({ kind, x: lx, y: ly })
    }
    if (!failed && reach(blocked)) placed = got
  }
  if (!placed) throw new Error(`${room.name} 에 소품을 다 놓지 못했다`)
  notes.push(`${room.name.padEnd(8)} ${String(placed.length).padStart(2)}개  팻말 ${sign.x},${sign.y} (${signW}칸)`)
  out[room.id] = { props: placed, sign }
}

const body = ROOMS.map((room) => {
  const f = out[room.id]
  const items = f.props.map((p) => `      { kind: '${p.kind}', x: ${p.x}, y: ${p.y} },`).join('\n')
  return `  // ${room.name}\n  ${room.id}: {\n    props: [\n${items || '      // 비워 둔다'}\n    ],\n    sign: { x: ${f.sign.x}, y: ${f.sign.y} },\n  },`
}).join('\n')

const header = `// 가구가 놓인 자리. **한 번 굴려서 굳힌 값이다.**
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
`

writeFileSync('src/school/map/furniture.ts', header + body + '\n}\n')
console.log(notes.join('\n'))
console.log('src/school/map/furniture.ts 새로 씀')
