// 성적통지표 — 감독관이 적은 최종 점수를 모아 한 번에 알린다.
//
// 감독관이 점수를 다 적고 「성적통지표 보내기」를 누르면(게임 문서의
// reportCardAtMs) 열넷의 화면에 동시에 뜬다. 그 전에는 적은 점수가
// 「나」 탭에도 안 보인다 — 한 사람씩 먼저 새면 한 번에 여는 맛이 없다.
//
//   첫 장   내 성적통지표 — 이름 · 분단 · 역할 · 점수 · 석차 · 날마다 미션
//   둘째 장 석차표 — 점수를 적은 사람 전부. 역할은 없다
import type { TeamId } from './v2'

/** 개인 미션 그날 결과. 판정이 없는 날은 null */
export type ReportDay = { day: number; status: 'met' | 'failed' | null }

export interface ReportRow {
  playerId: string
  name: string
  team: TeamId | null
  score: number
  rank: number
}

export interface ReportCard {
  atMs: number
  me: {
    name: string
    team: TeamId | null
    roleName: string
    /** 감독관이 안 적었으면 null */
    score: number | null
    rank: number | null
  }
  days: ReportDay[]
  /** 점수를 적은 사람만, 높은 점수부터 */
  all: ReportRow[]
}

/**
 * 석차. **같은 점수는 같은 석차다** — 나보다 높은 사람 수 + 1.
 * 87 · 87 이면 둘 다 3 등이고 다음은 5 등이다.
 */
export function rankRows<T extends { score: number; name: string }>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
  return sorted.map((r) => ({ ...r, rank: 1 + sorted.filter((x) => x.score > r.score).length }))
}
