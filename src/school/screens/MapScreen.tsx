import { useEffect, useRef, useState } from 'react'
import './MapScreen.css'
import { useSchoolGame } from '../state/SchoolGameContext'
import { isWalkable, MAP_H, MAP_W, propAt, roomAt, ROOMS, TILE, tileAt } from '../map/world'
import { ACTOR_H, ACTOR_W, buildSprites, PAL, type Dir } from '../map/sprites'
import { clearPosition, POSITION_STALE_MS, sendPosition, subscribePositions, type LivePosition } from '../mapSync'
import { SABOTAGE_LABEL, SPATIAL_LABEL, type BuildingKind, type SabotageEffectKind, type TileId } from '../types'
import { BUILDINGS } from '../data/buildings'
import { teamById, TEAMS } from '../data/teams'
import { tileById } from '../data/tiles'

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

/** 자원 표기는 짧게. 「돈 3 · 영향력 4」 */
function costText(cost: { money: number; influence: number }): string {
  const parts = [`돈 ${cost.money}`]
  if (cost.influence > 0) parts.push(`영향력 ${cost.influence}`)
  return parts.join(' · ')
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
    // 영역
    myTeamId,
    myTeam,
    hereTile,
    hereOwner,
    hereValue,
    rivalTeamsHere,
    canTakeHere,
    hereExpandCost,
    lockedDoors,
    mySpawn,
    actionsLeftToday,
    amBlockedToday,
    doExpand,
    doBuild,
    doUpgrade,
    doProduce,
    doExplore,
    doResearch,
    doSabotage,
  } = useSchoolGame()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [giveFor, setGiveFor] = useState<string | null>(null)
  // 진행자는 몸이 없다(viewerId가 없다). 걸어 다니는 대신 학교를 내려다본다.
  const spectating = !viewerId
  const [camRoom, setCamRoom] = useState<string | null>(null)
  const [openBuild, setOpenBuild] = useState(false)
  const [openSabotage, setOpenSabotage] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 게임 루프가 매 프레임 읽어야 하는 값들. 리렌더와 무관하게 최신값을 들고 있어야 한다.
  const roomRef = useRef(myRoomId)
  const setRoomRef = useRef(setMyRoom)
  const lockedRef = useRef(lockedDoors)
  const tilesRef = useRef(session.territory.tiles)
  const spawnRef = useRef(mySpawn)
  const setCamRoomRef = useRef(setCamRoom)
  roomRef.current = myRoomId
  setRoomRef.current = setMyRoom
  lockedRef.current = lockedDoors
  tilesRef.current = session.territory.tiles
  spawnRef.current = mySpawn
  setCamRoomRef.current = setCamRoom

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const watching = !viewerId
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const sprites = buildSprites()

    // 진행자의 시작점은 학교 한가운데다. 몸이 아니라 카메라라 벽 위에 있어도 된다.
    const start = watching ? { x: MAP_W / 2, y: MAP_H / 2 } : spawnRef.current
    const me = {
      px: start.x * TILE + TILE / 2,
      py: start.y * TILE + TILE / 2,
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

    function currentRoom(): TileId | null {
      return roomAt(Math.floor(me.px / TILE), Math.floor(me.py / TILE))?.id ?? null
    }

    function push(force = false) {
      if (watching) return
      sendPosition(
        {
          id: viewerId as string,
          x: me.px,
          y: me.py,
          dir: me.dir,
          roomId: currentRoom() ?? '',
          updatedAtMs: Date.now(),
        },
        force,
      )
    }
    push(true)
    const first = currentRoom()
    if (first && !watching) setRoomRef.current(first)
    if (watching) setCamRoomRef.current(first ? roomAt(Math.floor(me.px / TILE), Math.floor(me.py / TILE))!.name : null)
    const beat = watching ? 0 : window.setInterval(() => push(true), 4000)

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
          const nx = tx + dx
          const ny = ty + dy
          const passable = watching
            ? nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H
            : isWalkable(nx, ny, lockedRef.current)
          if (passable) {
            step = { fromX: tx, fromY: ty, toX: nx, toY: ny, startedAt: now }
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
          if (watching) {
            setCamRoomRef.current(room ? roomAt(Math.floor(me.px / TILE), Math.floor(me.py / TILE))!.name : null)
          } else if (room && room !== roomRef.current) {
            setRoomRef.current(room)
          }
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
          let img
          if (kind === 'wall') {
            img = tileAt(x, y - 1) === 'wall' ? sprites.tiles.wallBody : sprites.tiles.wall
          } else if (kind === 'door') {
            img = lockedRef.current.has(`${x},${y}`) ? sprites.tiles.doorLocked : sprites.tiles.door
          } else {
            // 발밑 무늬가 곧 소유권이다. 주인 없는 곳은 맨바닥.
            const owner = roomAt(x, y)?.id
            const team = owner ? tilesRef.current[owner]?.ownerTeam : null
            img = team ? sprites.tiles.floorTeam[team] : sprites.tiles.floorRoom
          }
          ctx.drawImage(img, x * TILE - camX, y * TILE - camY)
          const prop = propAt(x, y)
          if (prop) ctx.drawImage(sprites.props[prop], x * TILE - camX, y * TILE - camY)
        }
      }

      for (const r of ROOMS) {
        const rect = r.rects[0]
        const cx = (rect.x + rect.w / 2) * TILE - camX
        const cy = (rect.y + 0.3) * TILE - camY
        if (cx < -60 || cy < -20 || cx > canvas!.width + 60 || cy > canvas!.height + 20) continue
        const team = tilesRef.current[r.id]?.ownerTeam
        ctx.font = '7px "Gothic A1", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = PAL.mid
        ctx.fillText(team ? `${r.name} · ${team}` : r.name, Math.round(cx), Math.round(cy))
      }

      // 바닥에 놓인 조각 — 방 한가운데에 종잇조각으로
      for (const f of session.mapFragments) {
        if (f.state !== 'onFloor') continue
        const room = ROOMS.find((r) => r.id === f.roomId)
        if (!room) continue
        const rect = room.rects[0]
        const cx = (rect.x + rect.w / 2) * TILE - camX
        const cy = (rect.y + rect.h / 2) * TILE - camY
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
        ...(watching
          ? []
          : [{ px: me.px, py: me.py, dir: me.dir, moving: me.moving, phase: me.phase, name: '나', me: true }]),
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
    // 캔버스 루프는 한 번만 세운다. 방·조각·소유권 같은 변하는 값은 ref와 리렌더로 따라간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId])

  async function run(fn: () => Promise<void>, done?: string) {
    setError('')
    setNotice('')
    try {
      await fn()
      if (done) setNotice(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : '할 수 없다.')
    }
  }

  const here = myRoomId ? tileById[myRoomId] : null
  const roomName = spectating ? (camRoom ?? '학교') : (here?.name ?? '문턱')
  const alone = roomOccupantIds.length === 0
  const recent = spatialEvents
    .filter((e) => e.witnessIds.includes(viewerId ?? '') && Date.now() - e.createdAtMs < 60_000)
    .slice(-3)

  const isMine = hereOwner !== null && hereOwner === myTeamId
  const canAct = actionsLeftToday > 0 && !amBlockedToday
  const buildable = hereTile && here && isMine ? here.buildingSlots - hereTile.buildings.length : 0
  const affordable = myTeam
    ? BUILDINGS.filter((b) => b.cost.money <= myTeam.resources.money && b.cost.food <= myTeam.resources.food)
    : []

  return (
    <div className="sc-map">
      <div className="sc-map__stage">
        <canvas ref={canvasRef} />
        <div className="sc-map__top">
          <span className="sc-map__room">{roomName}</span>
          <span className="sc-map__here">
            {spectating
              ? '진행자 · 내려다보는 중'
              : alone
                ? '아무도 없다'
                : roomOccupantIds.map((id) => players[id]?.nickname ?? '???').join(', ')}
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
        {notice && <p className="sc-map__notice">{notice}</p>}

        {spectating ? (
          <div className="sc-map__witness">진행자는 학교를 내려다볼 뿐이다. 방향키로 둘러본다.</div>
        ) : (
          <div className="sc-map__witness">
            {alone ? '지금 하는 일은 아무도 모른다.' : `${roomOccupantIds.length}명이 보고 있다.`}
          </div>
        )}

        {/* ── 이 구역 ── 걷는 자리와 뺏는 자리가 같아서, 여기서 바로 손을 쓴다 */}
        {!spectating && here && (
          <section className="sc-map__zone">
            <span className="sc-map__label">
              이 구역 · {hereOwner ? `${teamById[hereOwner].name} 차지` : '주인 없음'} · 값어치 {hereValue}
            </span>
            {rivalTeamsHere.length > 0 && (
              <p className="sc-map__guard">
                {rivalTeamsHere.map((t) => teamById[t].name).join('·')} 사람이 여기 서 있다. 비켜야 넘어간다.
              </p>
            )}
            {hereTile && hereTile.buildings.length > 0 && (
              <p className="sc-map__built">
                {hereTile.buildings
                  .map((b) => `${BUILDINGS.find((s) => s.kind === b.kind)?.name ?? b.kind}${b.level > 1 ? ' II' : ''}`)
                  .join(' · ')}
              </p>
            )}

            <div className="sc-map__acts">
              {!isMine && !here.homeOf && (
                <button
                  disabled={!canAct || !canTakeHere.ok}
                  title={canTakeHere.ok ? undefined : canTakeHere.reason}
                  onClick={() => run(() => doExpand(myRoomId as TileId), '여기를 차지했다.')}
                >
                  차지한다{hereExpandCost ? ` (${costText(hereExpandCost)})` : ''}
                </button>
              )}
              {isMine && buildable > 0 && (
                <button disabled={!canAct} onClick={() => setOpenBuild((v) => !v)}>
                  짓는다 · 자리 {buildable}
                </button>
              )}
              {isMine && (
                <button disabled={!canAct} onClick={() => run(() => doProduce(), '돈 2 · 식량 2를 거뒀다.')}>
                  거둔다
                </button>
              )}
              {isMine && (
                <button disabled={!canAct} onClick={() => run(() => doResearch(), '카드를 한 장 얻었다.')}>
                  머리를 맞댄다
                </button>
              )}
              {!isMine && (
                <button disabled={!canAct} onClick={() => run(() => doExplore(), '뭔가를 찾아냈다.')}>
                  둘러본다
                </button>
              )}
              {hereOwner && !isMine && (
                <button disabled={!canAct} onClick={() => setOpenSabotage((v) => !v)}>
                  손을 쓴다
                </button>
              )}
            </div>

            {openBuild && (
              <div className="sc-map__menu">
                {affordable.length === 0 && <p className="sc-map__muted">지금 지을 수 있는 게 없다.</p>}
                {affordable.map((b) => (
                  <button
                    key={b.kind}
                    onClick={() =>
                      run(async () => {
                        await doBuild(myRoomId as TileId, b.kind as BuildingKind)
                        setOpenBuild(false)
                      }, `${b.name}을(를) 세웠다.`)
                    }
                  >
                    {b.name} · 돈 {b.cost.money}
                    {b.cost.food > 0 ? ` · 식량 ${b.cost.food}` : ''}
                  </button>
                ))}
                {hereTile?.buildings
                  .filter((b) => b.level < 2)
                  .map((b) => (
                    <button
                      key={`up-${b.kind}`}
                      onClick={() =>
                        run(async () => {
                          await doUpgrade(myRoomId as TileId, b.kind)
                          setOpenBuild(false)
                        }, '한 단계 올렸다.')
                      }
                    >
                      {BUILDINGS.find((s) => s.kind === b.kind)?.name} 올리기
                    </button>
                  ))}
              </div>
            )}

            {openSabotage && hereOwner && (
              <div className="sc-map__menu">
                {(Object.keys(SABOTAGE_LABEL) as SabotageEffectKind[]).map((kind) => (
                  <button
                    key={kind}
                    onClick={() =>
                      run(async () => {
                        await doSabotage(hereOwner, kind)
                        setOpenSabotage(false)
                      }, `${teamById[hereOwner].name}에 손을 썼다.`)
                    }
                  >
                    {SABOTAGE_LABEL[kind]} · 영향력 2
                  </button>
                ))}
              </div>
            )}

            <p className="sc-map__muted">
              {amBlockedToday
                ? '약점을 잡혀 오늘은 움직일 수 없다.'
                : `오늘 남은 행동 ${actionsLeftToday}회 · 우리 팀 ${TEAMS.length > 0 && myTeam ? myTeam.resources.actionPoints : 0}`}
            </p>
          </section>
        )}

        {!spectating && fragmentsHere.length > 0 && (
          <section>
            <span className="sc-map__label">바닥에 놓인 조각</span>
            {fragmentsHere.map((f) => (
              <button key={f.id} className="sc-map__act" onClick={() => run(() => doPickFragment(f.id))}>
                줍는다
              </button>
            ))}
          </section>
        )}

        {!spectating && myFragments.length > 0 && (
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

        {!spectating && (
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
        )}
      </div>
    </div>
  )
}
