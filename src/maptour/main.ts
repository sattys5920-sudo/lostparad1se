// 학교 전체를 한 도트 그대로 한 장에 그린다. **검수용 화면이다.**
//
// 게임 화면은 카메라가 사람을 따라다녀서, 방 하나를 통째로 찍으려면
// 카메라가 어디에 있는지를 되짚어야 한다. 그게 어긋나면 엉뚱한 데가
// 잘린다. 여기서는 카메라가 없다 — 판 좌표가 곧 그림 좌표라 방 네모를
// 그대로 오려 내면 된다.
//
// 소품과 팻말을 손보고 나서 스물다섯 방을 훑어볼 때 쓴다.
import {
  MAP_H, MAP_W, TILE, doorIsHorizontal, drawPiece, floorOf, markAt,
  propAt, roomAt, signAt, stairHere, tileAt,
} from '../school/map/world'
import { buildSprites } from '../school/map/sprites'
import { loadSignFont, signSheet } from '../school/map/signs'

const c = document.getElementById('c') as HTMLCanvasElement
c.width = MAP_W * TILE
c.height = MAP_H * TILE
const ctx = c.getContext('2d') as CanvasRenderingContext2D
ctx.imageSmoothingEnabled = false
const sprites = buildSprites()

await loadSignFont()
const plates = signSheet()

const FLOOR_IMG = {
  room: sprites.tiles.floorRoom,
  hall: sprites.tiles.floorHall,
  outdoor: sprites.tiles.floorOutdoor,
  wood: sprites.tiles.floorWood,
}

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const kind = tileAt(x, y)
    const room = roomAt(x, y)
    let img = sprites.tiles.wall
    if (kind === 'hall') img = sprites.tiles.floorHall
    else if (kind === 'door') img = doorIsHorizontal(x, y) ? sprites.tiles.doorH : sprites.tiles.doorV
    else if (kind === 'floor') img = FLOOR_IMG[room ? floorOf(room.id) : 'room']
    ctx.drawImage(img, x * TILE, y * TILE)
    const step = stairHere(x, y)
    if (step) ctx.drawImage(step.up ? sprites.tiles.stairUp : sprites.tiles.stairDown, x * TILE, y * TILE)
    const mark = markAt(x, y)
    if (mark) ctx.drawImage(sprites.marks[mark], x * TILE, y * TILE)
    const prop = propAt(x, y)
    if (prop) drawPiece(ctx, sprites.props[prop.kind], prop.ox, prop.oy, x * TILE, y * TILE)
    const sign = signAt(x, y)
    if (sign) drawPiece(ctx, plates[sign.id], sign.ox, 0, x * TILE, y * TILE)
  }
}
;(window as unknown as { __ready: boolean }).__ready = true
