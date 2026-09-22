// 운영자 대시보드 — 판 위의 사람 지도. **읽기 전용.**
//
// 누가 어떤 역할이고 언제 지워졌는지를 운영자가 알고 있어야 한다.
// 알고 있되 **절대 먼저 말하지 않는다.**
//
// 여기에 없는 것이 셋 있다.
//
//   표를 보낸 사람. 운영자에게도 보이지 않는다. 익명은 익명이다.
//   남의 추리 노트. 들여다보는 순간 그 노트는 혼자 생각하는 자리가
//   아니게 된다.
//   미션 진행도. 본인 것은 본인만 본다 — 달성 여부만 여기 온다.
//
// 게임 상태를 바꾸는 기능도 없다. 투명인간 해제 같은 것은 기존 운영자
// 도구로만 한다.
import type { RoleId } from '../missions/roleNames'

export interface DashboardInput {
  /** 실명 · 역할. 운영자만 본다. */
  roster: readonly { playerId: string; name: string; role: RoleId }[]
  /** 그 사람이 투명인간이었던 날. */
  invisibleDaysOf: (playerId: string) => number[]
  /** 주 미션을 달성했는가. 끝나기 전에는 null. */
  mainMetOf: (playerId: string) => boolean | null
  /** 채운 쪽지 미션 수. 끝나기 전에는 null. */
  slipsMetOf: (playerId: string) => number | null
}

export interface DashboardRow {
  playerId: string
  name: string
  role: RoleId
  invisibleDays: number[]
  mainMet: boolean | null
  slipsMet: number | null
}

export function buildRows(input: DashboardInput): DashboardRow[] {
  return input.roster.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    role: p.role,
    invisibleDays: input.invisibleDaysOf(p.playerId),
    mainMet: input.mainMetOf(p.playerId),
    slipsMet: input.slipsMetOf(p.playerId),
  }))
}
