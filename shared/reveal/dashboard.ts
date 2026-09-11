// 운영자 대시보드 — 추리 지도. **읽기 전용.**
//
// 날카로운 플레이어가 닷새 안에 도달할 수 있는 결론의 한계를 운영자가
// 알고 있어야 한다. 알고 있되 **절대 먼저 말하지 않는다.**
//
// 여기에 없는 것이 둘 있다.
//
//   표를 보낸 사람. 운영자에게도 보이지 않는다. 익명은 익명이다.
//   남의 추리 노트. 들여다보는 순간 그 노트는 혼자 생각하는 자리가
//   아니게 된다.
//
// 게임 상태를 바꾸는 기능도 없다. 투명인간 해제 같은 것은 기존 운영자
// 도구로만 한다.
import type { RoleId } from '../missions/roleNames'
import type { RevealScope } from '../rules/v2'

/** 역할이 엔딩 전에 드러날 수 있는가. 값은 서버 전용 데이터에 있다. */
export type Exposure = 'byDeduction' | 'possible' | 'onlyByOwnReveal'

export interface RevealRecord {
  role: RoleId
  scope: RevealScope
  atMs: number
  /** 그 자리에서 들은 사람 수. 누구인지는 담지 않는다. */
  listeners: number
}

export interface DashboardInput {
  /** 실명 · 역할. 운영자만 본다. */
  roster: readonly { playerId: string; name: string; role: RoleId }[]
  /** 역할별 가리켜진 날. 없으면 null. */
  hintDayOf: (role: RoleId) => number | null
  /** 역할 공개 가능성. */
  exposureOf: (role: RoleId) => Exposure
  reveals: readonly RevealRecord[]
  /** 사람마다 닷새 동안 받은 적중 의심 횟수. */
  exactHitsOn: (playerId: string) => number
  /** 그 사람이 투명인간이었던 날. */
  invisibleDaysOf: (playerId: string) => number[]
  /** 깨달음에 이르렀는가. */
  awakenedOf: (playerId: string) => boolean
}

export interface DashboardRow {
  playerId: string
  name: string
  role: RoleId
  /** A의 기록이 가리킨 날. 없으면 null. */
  hintDay: number | null
  /** 털어놓았는가. 안 했으면 null. */
  reveal: { scope: RevealScope; atMs: number; listeners: number } | null
  /** 적중 의심을 받은 횟수. */
  exactHits: number
  invisibleDays: number[]
  awakened: boolean
  exposure: Exposure
}

export function buildRows(input: DashboardInput): DashboardRow[] {
  return input.roster.map((p) => {
    // 여러 번 털어놓았으면 가장 이른 것을 적는다 — 언제 처음 입을 열었는지가
    // 운영자가 알고 싶은 것이다
    const mine = input.reveals
      .filter((r) => r.role === p.role)
      .sort((a, b) => a.atMs - b.atMs)
    return {
      playerId: p.playerId,
      name: p.name,
      role: p.role,
      hintDay: input.hintDayOf(p.role),
      reveal: mine[0] ? { scope: mine[0].scope, atMs: mine[0].atMs, listeners: mine[0].listeners } : null,
      exactHits: input.exactHitsOn(p.playerId),
      invisibleDays: input.invisibleDaysOf(p.playerId),
      awakened: input.awakenedOf(p.playerId),
      exposure: input.exposureOf(p.role),
    }
  })
}

// ── 연결 단서 ───────────────────────────────────────────────────

/** 단서 한 조각이 열렸는지 보는 데 필요한 것. */
export interface OpenState {
  /** 공개된 A의 기록 날짜. */
  releasedDays: readonly number[]
  /** 털어놓기가 일어난 역할과 방식. */
  reveals: readonly { role: RoleId; scope: RevealScope }[]
}

export type LinkPiece =
  | { kind: 'fragment'; day: number; label: string }
  | { kind: 'reveal'; role: RoleId; scope: 'class' | 'any'; label: string }

export interface LinkSpec {
  id: string
  left: LinkPiece
  right: LinkPiece
  conclusion: string
}

export function pieceOpen(piece: LinkPiece, state: OpenState): boolean {
  if (piece.kind === 'fragment') return state.releasedDays.includes(piece.day)
  return state.reveals.some(
    (r) => r.role === piece.role && (piece.scope === 'any' || r.scope === piece.scope),
  )
}

export interface LinkStatus {
  id: string
  leftLabel: string
  rightLabel: string
  leftOpen: boolean
  rightOpen: boolean
  /** 두 조각이 모두 열렸는가. */
  connectable: boolean
  conclusion: string
}

/**
 * 연결 단서 넷의 상태.
 *
 * 두 조각이 **모두** 열렸을 때만 「연결 가능」이다. 한쪽만 열린 것은
 * 아직 아무도 이을 수 없다는 뜻이고, 운영자는 그걸 보고 기다린다.
 */
export function linkStatus(links: readonly LinkSpec[], state: OpenState): LinkStatus[] {
  return links.map((l) => {
    const leftOpen = pieceOpen(l.left, state)
    const rightOpen = pieceOpen(l.right, state)
    return {
      id: l.id,
      leftLabel: l.left.label,
      rightLabel: l.right.label,
      leftOpen,
      rightOpen,
      connectable: leftOpen && rightOpen,
      conclusion: l.conclusion,
    }
  })
}

// ── 의심표 집계 ─────────────────────────────────────────────────

export interface SuspicionRow {
  playerId: string
  name: string
  /** 닷새 동안 받은 의심표 수. */
  received: number
}

/**
 * 사람별 **합계만**. 날짜별로도, 보낸 사람별로도 쪼개지 않는다.
 *
 * 날짜별로 쪼개면 「그날 누가 누구를 찍었나」가 투명인간 발표와 맞물려
 * 역산된다. 보낸 사람은 애초에 이 함수에 들어오지 않는다.
 */
export function suspicionTotals(
  roster: readonly { playerId: string; name: string }[],
  receivedOf: (playerId: string) => number,
): SuspicionRow[] {
  return roster
    .map((p) => ({ playerId: p.playerId, name: p.name, received: receivedOf(p.playerId) }))
    .sort((a, b) => b.received - a.received || a.name.localeCompare(b.name))
}
