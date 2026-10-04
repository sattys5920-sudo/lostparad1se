// 감독관 — 기념사진 캡처 화면. 2-3 교실만 화면 가득 크게 그린다.
//
// 플레이 화면과 같은 그림이다(현수막 · 잔치 장식 · 오투모 · 고른 자세). 단추나
// 머리 판이 없어서 화면을 그대로 캡처하면 사진이 된다. 닫기 단추는 2 초 뒤
// 사라지고, 화면을 누르면 다시 나온다.
//
// 자리는 감독관 지도와 같은 값(hostLiveMap)을 5 초마다 다시 읽는다.
import { useEffect, useRef, useState } from 'react'

import type { GameDoc } from '../../../shared/model'
import { PHOTO_ROBOT, PHOTO_ROBOT_NAME, PHOTO_ROOM, photoSpots } from '../../../shared/rules/photo'
import type { AvatarLook } from '../../../shared/look'
import { seatName } from '../../../shared/rules/lobby'
import { SMALL_FOOT, photoFrameSmall, pixelFrameSmall } from '../char/pixel'
import { normalizeLook } from '../char/look'
import { TEAM_COLOR } from '../game/MapPlan'
import type { GameActions } from '../game/useGame'
import { bakeBanner, bakeParty, drawOtumo } from '../map/party'
import { buildSprites, type SpriteSet } from '../map/sprites'
import { TILE, doorIsHorizontal, roomById, tileAt } from '../map/world'
import type { TeamId, TileId } from '../types'

interface Person {
  playerId: string
  name: string
  team: TeamId | null
  look: AvatarLook | null
  at: { x: number; y: number } | null
}

let SPRITES: SpriteSet | null = null
const sprites = (): SpriteSet => (SPRITES ??= buildSprites())
const REFRESH_MS = 5000

export function PhotoShot({ game, act, onClose }: { game: GameDoc; act: GameActions; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [chrome, setChrome] = useState(true)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const gameRef = useRef(game)
  gameRef.current = game
  const peopleRef = useRef(people)
  peopleRef.current = people

  // 자리 · 생김새 — 감독관 지도와 같은 값
  useEffect(() => {
    let alive = true
    const load = () =>
      act
        .hostLiveMap()
        .then((r) => {
          if (alive) setPeople(((r as { people?: Person[] }).people ?? []) as Person[])
        })
        .catch(() => {})
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [act])

  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // 닫기 단추는 2 초 뒤 숨는다 — 캡처에 안 찍히게
  useEffect(() => {
    if (!chrome) return
    const t = setTimeout(() => setChrome(false), 2000)
    return () => clearTimeout(t)
  }, [chrome])

  const room = roomById[PHOTO_ROOM as TileId].rects[0]
  // 그리는 범위 — 방 둘레 벽 한 칸, 위로는 현수막이 걸린 벽 한 줄 더
  const gx0 = room.x - 1
  const gy0 = room.y - 2
  const gw = room.w + 2
  const gh = room.h + 3
  const artW = gw * TILE
  const artH = gh * TILE
  const dpr = window.devicePixelRatio || 1
  // 화소 하나가 기기 화소 몇 개인가 — 정수로 맞춰 픽셀이 안 뭉갠다
  const S = Math.max(1, Math.floor(Math.min(size.w / artW, size.h / artH) * dpr))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = artW * S
    canvas.height = artH * S
    canvas.style.width = `${(artW * S) / dpr}px`
    canvas.style.height = `${(artH * S) / dpr}px`
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    let raf = 0
    const ox = gx0 * TILE
    const oy = gy0 * TILE
    const font = (px: number, bold = false) => `${bold ? '700 ' : ''}${px}px Galmuri11, 'Apple SD Gothic Neo', sans-serif`

    const draw = (now: number) => {
      const g = gameRef.current
      const sp = sprites()
      ctx.setTransform(S, 0, 0, S, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#1b1d26'
      ctx.fillRect(0, 0, artW, artH)
      // 바닥 · 벽 · 문
      for (let y = gy0; y < gy0 + gh; y++) {
        for (let x = gx0; x < gx0 + gw; x++) {
          const kind = tileAt(x, y)
          const dx = x * TILE - ox
          const dy = y * TILE - oy
          if (kind === 'wall') ctx.drawImage(tileAt(x, y - 1) === 'wall' ? sp.tiles.wallBody : sp.tiles.wall, dx, dy)
          else if (kind === 'door') ctx.drawImage(doorIsHorizontal(x, y) ? sp.tiles.doorH : sp.tiles.doorV, dx, dy)
          else ctx.drawImage(kind === 'hall' ? sp.tiles.floorHall : sp.tiles.floorRoom, dx, dy)
        }
      }
      // 잔치 바닥과 현수막 천
      ctx.drawImage(bakeParty(room), (room.x - 1) * TILE - ox, (room.y - 1) * TILE - oy)
      const cells = room.w - 2
      const bx = (room.x + 1) * TILE - ox
      const by = (room.y - 1) * TILE - oy - 4
      ctx.drawImage(bakeBanner(cells), bx, by)

      // 사람 — 아래 선 사람이 앞으로. 오투모도 줄에 낀다
      const poses = g.photo?.poses ?? {}
      const here = peopleRef.current
        .filter((p) => p.at && p.at.x >= gx0 && p.at.x < gx0 + gw && p.at.y >= gy0 && p.at.y < gy0 + gh)
        .sort((a, b) => (a.at as { y: number }).y - (b.at as { y: number }).y)
      const stood = new Set(here.map((p) => `${(p.at as { x: number }).x},${(p.at as { y: number }).y}`))
      // 아직 아무도 안 선 이름 자리 — 바닥 테이프
      const spotOf = photoSpots(g.seats)
      const empty: { x: number; y: number; name: string }[] = []
      g.seats.forEach((sx, i) => {
        const c = spotOf.get(sx.playerId)
        if (c && !stood.has(`${c.x},${c.y}`)) empty.push({ ...c, name: seatName(sx, i) })
      })
      ctx.fillStyle = 'rgba(80, 90, 120, 0.55)'
      for (const c of empty) {
        const x0 = c.x * TILE - ox
        const y0 = c.y * TILE - oy
        ctx.fillRect(x0 + 2, y0 + 2, TILE - 4, 1)
        ctx.fillRect(x0 + 2, y0 + TILE - 3, TILE - 4, 1)
        ctx.fillRect(x0 + 2, y0 + 2, 1, TILE - 4)
        ctx.fillRect(x0 + TILE - 3, y0 + 2, 1, TILE - 4)
      }
      const bot = { x: PHOTO_ROBOT.x * TILE + TILE / 2 - ox, y: PHOTO_ROBOT.y * TILE + TILE / 2 - oy }
      let botDrawn = false
      for (const p of here) {
        const at = p.at as { x: number; y: number }
        const cx = at.x * TILE + TILE / 2 - ox
        const cy = at.y * TILE + TILE / 2 - oy
        if (!botDrawn && cy > bot.y) {
          drawOtumo(ctx, bot.x, bot.y, now)
          botDrawn = true
        }
        if (!p.look) continue
        const look = normalizeLook(p.look)
        const pose = poses[p.playerId]
        const img = pose && pose !== 'stand' ? photoFrameSmall(look, p.team, pose) : pixelFrameSmall(look, p.team, 'down', 0)
        ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height + SMALL_FOOT))
      }
      if (!botDrawn) drawOtumo(ctx, bot.x, bot.y, now)

      // 글자는 기기 화소로 — 픽셀 그림처럼 키우면 뭉갠다
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const unit = Math.max(11, Math.floor((9 * S) / 11) * 11)
      ctx.font = font(unit, true)
      ctx.lineWidth = Math.max(2, Math.round(S / 2))
      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle = '#e0457b'
      const tx = (bx + (cells * TILE) / 2) * S
      const ty = (by + 3 + 8) * S
      ctx.strokeText(g.photo?.banner ?? '', tx, ty)
      ctx.fillText(g.photo?.banner ?? '', tx, ty)

      const tagPx = Math.max(10, Math.round(S * 3.2))
      ctx.font = font(tagPx)
      const tag = (text: string, cx: number, top: number, color: string, dot: string | null) => {
        const w = ctx.measureText(text).width + tagPx * (dot ? 1.4 : 0.8)
        const h = tagPx * 1.35
        ctx.fillStyle = 'rgba(17, 18, 26, 0.55)'
        ctx.fillRect(Math.round(cx - w / 2), Math.round(top), Math.round(w), Math.round(h))
        if (dot) {
          ctx.fillStyle = dot
          const d = Math.max(3, Math.round(tagPx * 0.3))
          ctx.fillRect(Math.round(cx - w / 2 + tagPx * 0.35), Math.round(top + h / 2 - d / 2), d, d)
        }
        ctx.fillStyle = color
        ctx.fillText(text, cx + (dot ? tagPx * 0.3 : 0), top + h / 2)
      }
      const foot = (TILE * 6) / 32 + 2
      for (const p of here) {
        const at = p.at as { x: number; y: number }
        tag(p.name, (at.x * TILE + TILE / 2 - ox) * S, (at.y * TILE + TILE / 2 + foot - oy) * S, '#f4f5fa', p.team ? TEAM_COLOR[p.team] : null)
      }
      tag(PHOTO_ROBOT_NAME, bot.x * S, (bot.y + foot) * S, '#ffb3c8', null)
      ctx.textBaseline = 'middle'
      for (const c of empty) {
        ctx.fillStyle = '#3b4258'
        ctx.fillText(c.name, (c.x * TILE + TILE / 2 - ox) * S, (c.y * TILE + TILE / 2 - oy) * S)
      }
      raf = requestAnimationFrame(draw)
    }
    // 글꼴이 오기 전에 그리면 첫 장이 다른 글꼴이다
    void document.fonts?.load?.(font(11)).finally(() => {
      raf = requestAnimationFrame(draw)
    })
    return () => cancelAnimationFrame(raf)
  }, [S, artW, artH, dpr, gx0, gy0, gw, gh, room])

  return (
    <div className="sc-ps" onClick={() => setChrome(true)}>
      <canvas ref={canvasRef} className="sc-ps__canvas" />
      <button
        className={`sc-ps__close${chrome ? '' : ' is-hidden'}`}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        닫기
      </button>
    </div>
  )
}
