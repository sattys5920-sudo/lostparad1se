import './proto.css'
import { firebaseConfigured } from '../firebase'
import { floorOf, isWalkable, MAP_H, MAP_W, markAt, propAt, roomAt, ROOMS, SPAWN, TILE, tileAt } from '../school/map/world'
import { buildSprites, PAL, type Dir } from '../school/map/sprites'
import { ACTOR_H, ACTOR_W, actorSprite, defaultLook } from '../school/map/avatar'
import { leave, sendChat, sendPresence, STALE_MS, subscribeChat, subscribePresence, type ChatLine, type Presence } from './net'

const STEP_MS = 160
const BUBBLE_MS = 5000

interface Actor {
  id: string
  nickname: string
  /** 논리 좌표(픽셀). 칸 중심 기준. */
  px: number
  py: number
  dir: Dir
  moving: boolean
  /** 걸음 애니메이션 위상. */
  phase: number
  bubble?: { text: string; until: number }
}

// ── 신원 ────────────────────────────────────────────────────────
const LS = { id: 'proto_id', nick: 'proto_nick' }
let myId = localStorage.getItem(LS.id) ?? ''
if (!myId) {
  myId = crypto.randomUUID()
  localStorage.setItem(LS.id, myId)
}
let myNick = localStorage.getItem(LS.nick) ?? ''

// ── 상태 ────────────────────────────────────────────────────────
const me: Actor = {
  id: myId,
  nickname: myNick,
  px: SPAWN.x * TILE + TILE / 2,
  py: SPAWN.y * TILE + TILE / 2,
  dir: 'down',
  moving: false,
  phase: 0,
}
let step: { fromX: number; fromY: number; toX: number; toY: number; startedAt: number } | null = null
const others = new Map<string, Actor & { targetX: number; targetY: number; updatedAtMs: number }>()
let chatLines: ChatLine[] = []
const held = new Set<Dir>()
let scale = 3

const sprites = buildSprites()
const canvas = document.getElementById('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
const roomLabel = document.getElementById('room') as HTMLElement
const hereList = document.getElementById('here') as HTMLElement
const logEl = document.getElementById('log') as HTMLElement
const chatInput = document.getElementById('chat') as HTMLInputElement

function myRoomId(): string {
  const tx = Math.floor(me.px / TILE)
  const ty = Math.floor(me.py / TILE)
  return roomAt(tx, ty)?.id ?? 'hallway'
}

// ── 입장 ────────────────────────────────────────────────────────
function startGame(nick: string) {
  myNick = nick
  me.nickname = nick
  localStorage.setItem(LS.nick, nick)
  ;(document.getElementById('gate') as HTMLElement).hidden = true
  ;(document.getElementById('hud') as HTMLElement).hidden = false

  if (firebaseConfigured) {
    subscribePresence(onPresence)
    subscribeChat((lines) => {
      // 새로 들어온 말은 말풍선으로도 띄운다.
      const known = new Set(chatLines.map((l) => l.id))
      for (const line of lines) {
        if (known.has(line.id)) continue
        if (Date.now() - line.createdAtMs > BUBBLE_MS) continue
        const who = line.authorId === myId ? me : others.get(line.authorId)
        if (who) who.bubble = { text: line.text, until: Date.now() + BUBBLE_MS }
      }
      chatLines = lines
      renderLog()
    })
    pushPresence(true)
    setInterval(() => pushPresence(true), 4000) // 살아 있다는 신호
    window.addEventListener('beforeunload', () => leave(myId))
  }
  requestAnimationFrame(loop)
}

function pushPresence(force = false) {
  if (!firebaseConfigured) return
  sendPresence(
    {
      id: myId,
      nickname: me.nickname,
      x: me.px,
      y: me.py,
      dir: me.dir,
      roomId: myRoomId(),
      updatedAtMs: Date.now(),
    },
    force,
  )
}

function onPresence(list: Presence[]) {
  const seen = new Set<string>()
  for (const p of list) {
    if (p.id === myId) continue
    seen.add(p.id)
    const existing = others.get(p.id)
    if (existing) {
      existing.targetX = p.x
      existing.targetY = p.y
      existing.dir = p.dir
      existing.nickname = p.nickname
      existing.updatedAtMs = p.updatedAtMs
    } else {
      others.set(p.id, {
        id: p.id,
        nickname: p.nickname,
        px: p.x,
        py: p.y,
        targetX: p.x,
        targetY: p.y,
        dir: p.dir,
        moving: false,
        phase: 0,
        updatedAtMs: p.updatedAtMs,
      })
    }
  }
  for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id)
}

// ── 입력 ────────────────────────────────────────────────────────
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
}

window.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput) return
  const dir = KEY_DIR[e.code]
  if (dir) {
    held.add(dir)
    e.preventDefault()
  }
  if (e.code === 'Enter') chatInput.focus()
})
window.addEventListener('keyup', (e) => {
  const dir = KEY_DIR[e.code]
  if (dir) held.delete(dir)
})

for (const btn of document.querySelectorAll<HTMLElement>('[data-dir]')) {
  const dir = btn.dataset.dir as Dir
  const press = (e: Event) => {
    e.preventDefault()
    held.add(dir)
  }
  const release = () => held.delete(dir)
  btn.addEventListener('pointerdown', press)
  btn.addEventListener('pointerup', release)
  btn.addEventListener('pointerleave', release)
  btn.addEventListener('pointercancel', release)
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  const text = chatInput.value.trim()
  chatInput.value = ''
  if (!text) {
    chatInput.blur()
    return
  }
  const line: ChatLine = {
    id: crypto.randomUUID(),
    authorId: myId,
    nickname: me.nickname,
    roomId: myRoomId(),
    text: text.slice(0, 80),
    createdAtMs: Date.now(),
  }
  me.bubble = { text: line.text, until: Date.now() + BUBBLE_MS }
  if (firebaseConfigured) sendChat(line)
  else {
    chatLines = [...chatLines, line].slice(-40)
    renderLog()
  }
})

// ── 이동 ────────────────────────────────────────────────────────
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

function tryStep(now: number) {
  if (step) return
  const dir = [...held][held.size - 1]
  if (!dir) return
  me.dir = dir
  const tx = Math.round((me.px - TILE / 2) / TILE)
  const ty = Math.round((me.py - TILE / 2) / TILE)
  const [dx, dy] = DELTA[dir]
  const nx = tx + dx
  const ny = ty + dy
  if (!isWalkable(nx, ny)) return
  step = { fromX: tx, fromY: ty, toX: nx, toY: ny, startedAt: now }
  me.moving = true
  pushPresence()
}

function advance(now: number) {
  if (!step) return
  const t = Math.min(1, (now - step.startedAt) / STEP_MS)
  const ease = t
  me.px = (step.fromX + (step.toX - step.fromX) * ease) * TILE + TILE / 2
  me.py = (step.fromY + (step.toY - step.fromY) * ease) * TILE + TILE / 2
  me.phase += 0.14
  if (t >= 1) {
    step = null
    me.moving = false
    pushPresence()
  }
}

// ── 그리기 ──────────────────────────────────────────────────────
function resize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 한 화면에 20칸쯤 들어오게. 더 당기면 답답하고, 더 밀면 캐릭터가 안 보인다.
  scale = Math.max(2, Math.min(3, Math.floor(vw / (20 * TILE))))
  canvas.width = Math.ceil(vw / scale)
  canvas.height = Math.ceil(vh / scale)
  canvas.style.width = `${vw}px`
  canvas.style.height = `${vh}px`
  ctx.imageSmoothingEnabled = false
}
window.addEventListener('resize', resize)

/** 그 실이 어떤 곳인지는 바닥이 말한다. 정원은 흙, 체육관은 마루, 복도는 통로. */
function floorTile(x: number, y: number) {
  const room = roomAt(x, y)?.id
  switch (room ? floorOf(room) : 'room') {
    case 'hall':
      return sprites.tiles.floorHall
    case 'outdoor':
      return sprites.tiles.floorOutdoor
    case 'wood':
      return sprites.tiles.floorWood
    default:
      return sprites.tiles.floorRoom
  }
}

function drawLabel(text: string, cx: number, y: number, inverted: boolean) {
  ctx.font = '7px "Gothic A1", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const w = Math.ceil(ctx.measureText(text).width) + 4
  ctx.fillStyle = inverted ? PAL.ink : PAL.paper
  ctx.fillRect(Math.round(cx - w / 2), Math.round(y), w, 9)
  ctx.fillStyle = inverted ? PAL.paper : PAL.ink
  ctx.fillText(text, Math.round(cx), Math.round(y + 1))
}

function drawActor(a: Actor, camX: number, camY: number, isMe: boolean) {
  const frame = a.moving ? 1 + (Math.floor(a.phase) % 2) : 0
  // 프로토타입에는 팀이 없다. 아바타는 id에서 뽑아 서로 달라 보이게만 한다.
  const img = actorSprite(defaultLook(a.id), null, a.dir, frame)
  const x = Math.round(a.px - camX - ACTOR_W / 2)
  const y = Math.round(a.py - camY - ACTOR_H + 4)
  ctx.drawImage(sprites.shadow, x + 1, y + ACTOR_H - 1)
  ctx.drawImage(img, x, y)
  drawLabel(a.nickname, a.px - camX, y - 10, isMe)
  if (a.bubble && a.bubble.until > Date.now()) {
    drawLabel(a.bubble.text, a.px - camX, y - 21, false)
  }
}

function loop(now: number) {
  tryStep(now)
  advance(now)

  // 남들은 받은 좌표로 부드럽게 끌어당긴다. 네트워크 지연을 눈에 덜 띄게.
  const cutoff = Date.now() - STALE_MS
  for (const [id, o] of others) {
    if (o.updatedAtMs < cutoff) {
      others.delete(id)
      continue
    }
    const dx = o.targetX - o.px
    const dy = o.targetY - o.py
    o.moving = Math.abs(dx) + Math.abs(dy) > 0.6
    o.px += dx * 0.25
    o.py += dy * 0.25
    if (o.moving) o.phase += 0.14
  }

  const camX = Math.round(Math.max(0, Math.min(MAP_W * TILE - canvas.width, me.px - canvas.width / 2)))
  const camY = Math.round(Math.max(0, Math.min(MAP_H * TILE - canvas.height, me.py - canvas.height / 2)))

  ctx.fillStyle = PAL.ink
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const x0 = Math.max(0, Math.floor(camX / TILE))
  const y0 = Math.max(0, Math.floor(camY / TILE))
  const x1 = Math.min(MAP_W - 1, Math.ceil((camX + canvas.width) / TILE))
  const y1 = Math.min(MAP_H - 1, Math.ceil((camY + canvas.height) / TILE))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const kind = tileAt(x, y)
      const img =
        kind === 'wall'
          ? // 위로 벽이 이어지면 갓 없는 몸통을 써서 한 덩어리로 보이게 한다
            tileAt(x, y - 1) === 'wall'
            ? sprites.tiles.wallBody
            : sprites.tiles.wall
          : kind === 'door'
            ? sprites.tiles.door
            : floorTile(x, y)
      ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
      const mark = markAt(x, y)
      if (mark) ctx.drawImage(sprites.marks[mark], x * TILE - camX, y * TILE - camY)
      const prop = propAt(x, y)
      if (prop) ctx.drawImage(sprites.props[prop], x * TILE - camX, y * TILE - camY)
    }
  }

  // 방 이름을 바닥에 눕혀 둔다
  for (const r of ROOMS) {
    const rect = r.rects[0]
    const cx = (rect.x + rect.w / 2) * TILE - camX
    const cy = (rect.y + 0.4) * TILE - camY
    if (cx < -60 || cx > canvas.width + 60) continue
    ctx.font = '7px "Gothic A1", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = PAL.mid
    ctx.fillText(r.name, Math.round(cx), Math.round(cy))
  }

  const cast = [...others.values(), me].sort((a, b) => a.py - b.py)
  for (const a of cast) drawActor(a, camX, camY, a.id === myId)

  renderHud()
  requestAnimationFrame(loop)
}

// ── HUD ─────────────────────────────────────────────────────────
let lastHud = ''
function renderHud() {
  const rid = myRoomId()
  const here = [...others.values()].filter((o) => {
    const tx = Math.floor(o.px / TILE)
    const ty = Math.floor(o.py / TILE)
    return (roomAt(tx, ty)?.id ?? 'hallway') === rid
  })
  const name = ROOMS.find((r) => r.id === rid)?.name ?? '복도'
  const key = `${name}|${here.map((h) => h.nickname).join(',')}`
  if (key === lastHud) return
  lastHud = key
  roomLabel.textContent = name
  hereList.textContent = here.length === 0 ? '이 방에 혼자 있다' : `함께 있는 사람 · ${here.map((h) => h.nickname).join(', ')}`
  renderLog()
}

/** 지난 판에 남은 말이 방에 계속 떠 있으면 헷갈린다. 최근 것만 보여준다. */
const CHAT_TTL_MS = 5 * 60_000

function renderLog() {
  const rid = myRoomId()
  const fresh = Date.now() - CHAT_TTL_MS
  const mine = chatLines.filter((l) => l.roomId === rid && l.createdAtMs > fresh).slice(-6)
  logEl.innerHTML = ''
  for (const l of mine) {
    const div = document.createElement('div')
    div.className = 'log__line'
    div.textContent = `${l.nickname}: ${l.text}`
    logEl.appendChild(div)
  }
}

// ── 시작 ────────────────────────────────────────────────────────
const nickInput = document.getElementById('nick') as HTMLInputElement
const enterBtn = document.getElementById('enter') as HTMLButtonElement
nickInput.value = myNick
enterBtn.addEventListener('click', () => {
  const v = nickInput.value.trim()
  if (v) startGame(v)
})
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enterBtn.click()
})
if (!firebaseConfigured) {
  ;(document.getElementById('offline') as HTMLElement).hidden = false
}
resize()
