import { useEffect, useRef, useState } from 'react'
import './MapScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { isWalkable, MAP_H, MAP_W, propAt, roomAt, ROOMS, SPAWN, TILE, tileAt } from '../map/world'
import { ACTOR_H, ACTOR_W, buildSprites, PAL, type Dir } from '../map/sprites'
import { clearPosition, POSITION_STALE_MS, sendPosition, subscribePositions, type LivePosition } from '../mapSync'
import { SPATIAL_LABEL } from '../types'

const STEP_MS = 160

interface Ghost {
  px: number
  py: number
  targetX: number
  targetY: number
  dir: Dir
  moving: boolean
  phase: number
  updatedAtMs: number
}

export function MapScreen() {
  const {
    viewerId,
    players,
    session,
    myRoomId,
    setMyRoom,
    roomOccupantIds,
    fragmentsHere,
    myFragments,
    notesHere,
    doPickFragment,
    doDropFragment,
    doBurnFragment,
    doGiveFragment,
    doLeaveNote,
    doReadNote,
    spatialEvents,
  } = useSchoolGame()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [giveFor, setGiveFor] = useState<string | null>(null)
  const [error, setError] = useState('')

  // 게임 루프가 매 프레임 읽어야 하는 값들. 리렌더와 무관하게 최신값을 들고 있어야 한다.
  const roomRef = useRef(myRoomId)
  const setRoomRef = useRef(setMyRoom)
  roomRef.current = myRoomId
  setRoomRef.current = setMyRoom

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !viewerId) return
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const sprites = buildSprites()

    const me = {
      px: SPAWN.x * TILE + TILE / 2,
      py: SPAWN.y * TILE + TILE / 2,
      dir: 'down' as Dir,
      moving: false,
      phase: 0,
    }
    let step: { fromX: number; fromY: number; toX: number; toY: number; startedAt: number } | null = null
    const held = new Set<Dir>()
    const ghosts = new Map<string, Ghost>()
    let scale = 3
    let raf = 0
    let alive = true

    function resize() {
      const box = canvas!.parentElement as HTMLElement
      const vw = box.clientWidth
      const vh = box.clientHeight
      scale = Math.max(2, Math.min(3, Math.floor(vw / (18 * TILE))))
      canvas!.width = Math.ceil(vw / scale)
      canvas!.height = Math.ceil(vh / scale)
      canvas!.style.width = `${vw}px`
      canvas!.style.height = `${vh}px`
      ctx.imageSmoothingEnabled = false
    }
    resize()
    window.addEventListener('resize', resize)

    const unsubPositions = subscribePositions((list: LivePosition[]) => {
      for (const p of list) {
        if (p.id === viewerId) continue
        const g = ghosts.get(p.id)
        if (g) {
          g.targetX = p.x
          g.targetY = p.y
          g.dir = p.dir
          g.updatedAtMs = p.updatedAtMs
        } else {
          ghosts.set(p.id, {
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
    })

    function currentRoom(): string {
      return roomAt(Math.floor(me.px / TILE), Math.floor(me.py / TILE))?.id ?? 'hallway'
    }

    function push(force = false) {
      sendPosition(
        { id: viewerId as string, x: me.px, y: me.py, dir: me.dir, roomId: currentRoom(), updatedAtMs: Date.now() },
        force,
      )
    }
    push(true)
    setRoomRef.current(currentRoom())
    const beat = window.setInterval(() => push(true), 4000)

    const KEY: Record<string, Dir> = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    }
    function onDown(e: KeyboardEvent) {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      const d = KEY[e.code]
      if (d) {
        held.add(d)
        e.preventDefault()
      }
    }
    function onUp(e: KeyboardEvent) {
      const d = KEY[e.code]
      if (d) held.delete(d)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    // 화면 D패드
    const pads = Array.from(document.querySelectorAll<HTMLElement>('.sc-map__pad [data-dir]'))
    const padCleanup: (() => void)[] = []
    for (const btn of pads) {
      const d = btn.dataset.dir as Dir
      const press = (e: Event) => {
        e.preventDefault()
        held.add(d)
      }
      const release = () => held.delete(d)
      btn.addEventListener('pointerdown', press)
      btn.addEventListener('pointerup', release)
      btn.addEventListener('pointerleave', release)
      btn.addEventListener('pointercancel', release)
      padCleanup.push(() => {
        btn.removeEventListener('pointerdown', press)
        btn.removeEventListener('pointerup', release)
        btn.removeEventListener('pointerleave', release)
        btn.removeEventListener('pointercancel', release)
      })
    }

    const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

    function loop(now: number) {
      if (!alive) return
      if (!step) {
        const dir = [...held][held.size - 1]
        if (dir) {
          me.dir = dir
          const tx = Math.round((me.px - TILE / 2) / TILE)
          const ty = Math.round((me.py - TILE / 2) / TILE)
          const [dx, dy] = DELTA[dir]
          if (isWalkable(tx + dx, ty + dy)) {
            step = { fromX: tx, fromY: ty, toX: tx + dx, toY: ty + dy, startedAt: now }
            me.moving = true
            push()
          }
        }
      }
      if (step) {
        const t = Math.min(1, (now - step.startedAt) / STEP_MS)
        me.px = (step.fromX + (step.toX - step.fromX) * t) * TILE + TILE / 2
        me.py = (step.fromY + (step.toY - step.fromY) * t) * TILE + TILE / 2
        me.phase += 0.14
        if (t >= 1) {
          step = null
          me.moving = false
          push()
          const room = currentRoom()
          if (room !== roomRef.current) setRoomRef.current(room)
        }
      }

      const cutoff = Date.now() - POSITION_STALE_MS
      for (const [id, g] of ghosts) {
        if (g.updatedAtMs < cutoff) {
          ghosts.delete(id)
          continue
        }
        const dx = g.targetX - g.px
        const dy = g.targetY - g.py
        g.moving = Math.abs(dx) + Math.abs(dy) > 0.6
        g.px += dx * 0.25
        g.py += dy * 0.25
        if (g.moving) g.phase += 0.14
      }

      const camX = Math.round(Math.max(0, Math.min(MAP_W * TILE - canvas!.width, me.px - canvas!.width / 2)))
      const camY = Math.round(Math.max(0, Math.min(MAP_H * TILE - canvas!.height, me.py - canvas!.height / 2)))

      ctx.fillStyle = PAL.ink
      ctx.fillRect(0, 0, canvas!.width, canvas!.height)

      const x0 = Math.max(0, Math.floor(camX / TILE))
      const y0 = Math.max(0, Math.floor(camY / TILE))
      const x1 = Math.min(MAP_W - 1, Math.ceil((camX + canvas!.width) / TILE))
      const y1 = Math.min(MAP_H - 1, Math.ceil((camY + canvas!.height) / TILE))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const kind = tileAt(x, y)
          const img =
            kind === 'wall'
              ? tileAt(x, y - 1) === 'wall'
                ? sprites.tiles.wallBody
                : sprites.tiles.wall
              : kind === 'door'
                ? sprites.tiles.door
                : roomAt(x, y)?.id === 'hallway'
                  ? sprites.tiles.floorHall
                  : sprites.tiles.floorRoom
          ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
          const prop = propAt(x, y)
          if (prop) ctx.drawImage(sprites.props[prop], x * TILE - camX, y * TILE - camY)
        }
      }

      for (const r of ROOMS) {
        if (r.id === 'hallway') continue
        const cx = ((r.x1 + r.x2 + 1) / 2) * TILE - camX
        const cy = (r.y1 + 0.3) * TILE - camY
        ctx.font = '7px "Gothic A1", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = PAL.mid
        ctx.fillText(r.name, Math.round(cx), Math.round(cy))
      }

      // 바닥에 놓인 조각 — 방 한가운데에 종잇조각으로
      for (const f of session.mapFragments) {
        if (f.state !== 'onFloor') continue
        const room = ROOMS.find((r) => r.id === f.roomId)
        if (!room) continue
        const cx = ((room.x1 + room.x2 + 1) / 2) * TILE - camX
        const cy = ((room.y1 + room.y2 + 1) / 2) * TILE - camY
        ctx.fillStyle = PAL.paper
        ctx.fillRect(Math.round(cx - 4), Math.round(cy - 3), 8, 6)
        ctx.fillStyle = PAL.ink
        ctx.fillRect(Math.round(cx - 4), Math.round(cy - 3), 8, 1)
        ctx.fillRect(Math.round(cx - 4), Math.round(cy + 2), 8, 1)
      }

      function label(text: string, cx: number, y: number, inverted: boolean) {
        ctx.font = '7px "Gothic A1", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const w = Math.ceil(ctx.measureText(text).width) + 4
        ctx.fillStyle = inverted ? PAL.ink : PAL.paper
        ctx.fillRect(Math.round(cx - w / 2), Math.round(y), w, 9)
        ctx.fillStyle = inverted ? PAL.paper : PAL.ink
        ctx.fillText(text, Math.round(cx), Math.round(y + 1))
      }

      const cast: { px: number; py: number; dir: Dir; moving: boolean; phase: number; name: string; me: boolean }[] = [
        ...[...ghosts.entries()].map(([id, g]) => ({
          px: g.px, py: g.py, dir: g.dir, moving: g.moving, phase: g.phase,
          name: players[id]?.nickname ?? '???', me: false,
        })),
        { px: me.px, py: me.py, dir: me.dir, moving: me.moving, phase: me.phase, name: '나', me: true },
      ].sort((a, b) => a.py - b.py)

      for (const a of cast) {
        const frame = a.moving ? 1 + (Math.floor(a.phase) % 2) : 0
        const x = Math.round(a.px - camX - ACTOR_W / 2)
        const y = Math.round(a.py - camY - ACTOR_H + 4)
        ctx.drawImage(sprites.shadow, x, y + ACTOR_H - 1)
        ctx.drawImage(sprites.actor[a.dir][frame], x, y)
        label(a.name, a.px - camX, y - 10, a.me)
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(beat)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      for (const fn of padCleanup) fn()
      unsubPositions()
      if (viewerId) clearPosition(viewerId)
    }
    // 캔버스 루프는 한 번만 세운다. 방·조각 같은 변하는 값은 ref와 리렌더로 따라간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId])

  async function run(fn: () => Promise<void>) {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : '할 수 없다.')
    }
  }

  const roomName = ROOMS.find((r) => r.id === myRoomId)?.name ?? '복도'
  const alone = roomOccupantIds.length === 0
  const recent = spatialEvents
    .filter((e) => e.witnessIds.includes(viewerId ?? '') && Date.now() - e.createdAtMs < 60_000)
    .slice(-3)

  return (
    <div className="sc-map">
      <div className="sc-map__stage">
        <canvas ref={canvasRef} />
        <div className="sc-map__top">
          <span className="sc-map__room">{roomName}</span>
          <span className="sc-map__here">
            {alone ? '아무도 없다' : roomOccupantIds.map((id) => players[id]?.nickname ?? '???').join(', ')}
          </span>
        </div>
        {recent.length > 0 && (
          <div className="sc-map__seen">
            {recent.map((e) => (
              <div key={e.id}>
                {players[e.actorId]?.nickname ?? '???'}가 {SPATIAL_LABEL[e.kind]}
              </div>
            ))}
          </div>
        )}
        <div className="sc-map__pad">
          <button className="up" data-dir="up" aria-label="위">▲</button>
          <button className="left" data-dir="left" aria-label="왼쪽">◀</button>
          <button className="right" data-dir="right" aria-label="오른쪽">▶</button>
          <button className="down" data-dir="down" aria-label="아래">▼</button>
        </div>
      </div>

      <div className="sc-map__panel">
        {error && <p className="sc-map__error">{error}</p>}

        <div className="sc-map__witness">
          {alone ? '지금 하는 일은 아무도 모른다.' : `${roomOccupantIds.length}명이 보고 있다.`}
        </div>

        {fragmentsHere.length > 0 && (
          <section>
            <span className="sc-map__label">바닥에 놓인 조각</span>
            {fragmentsHere.map((f) => (
              <button key={f.id} className="sc-map__act" onClick={() => run(() => doPickFragment(f.id))}>
                줍는다
              </button>
            ))}
          </section>
        )}

        {myFragments.length > 0 && (
          <section>
            <span className="sc-map__label">내가 쥔 조각 {myFragments.length}</span>
            {myFragments.map((f) => (
              <div key={f.id} className="sc-map__frag">
                <p className="sc-map__frag-text">{f.text}</p>
                <div className="sc-map__frag-acts">
                  <button onClick={() => run(() => doBurnFragment(f.id))}>태운다</button>
                  <button onClick={() => run(() => doDropFragment(f.id))}>내려놓는다</button>
                  <button disabled={alone} onClick={() => setGiveFor(giveFor === f.id ? null : f.id)}>
                    건넨다
                  </button>
                </div>
                {giveFor === f.id && (
                  <div className="sc-map__give">
                    {roomOccupantIds.map((id) => (
                      <button
                        key={id}
                        onClick={() =>
                          run(async () => {
                            await doGiveFragment(f.id, id)
                            setGiveFor(null)
                          })
                        }
                      >
                        {players[id]?.nickname ?? '???'}에게
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <section>
          <span className="sc-map__label">쪽지 {notesHere.length > 0 ? `· 이 방에 ${notesHere.length}장` : ''}</span>
          {notesHere.map((n) => (
            <div key={n.id} className="sc-map__note">
              {openNote === n.id ? (
                <p className="sc-map__note-text">{n.text}</p>
              ) : (
                <button
                  onClick={() =>
                    run(async () => {
                      setOpenNote(n.id)
                      await doReadNote(n.id)
                    })
                  }
                >
                  읽는다
                </button>
              )}
            </div>
          ))}
          <div className="sc-map__write">
            <input
              value={noteDraft}
              maxLength={120}
              placeholder="쪽지를 남긴다 (익명)"
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <button
              disabled={!noteDraft.trim()}
              onClick={() =>
                run(async () => {
                  await doLeaveNote(noteDraft)
                  setNoteDraft('')
                })
              }
            >
              남긴다
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
