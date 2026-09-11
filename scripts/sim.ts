// 봇 시뮬레이션을 돌려 표로 찍는다.
//
//   npm run sim          백 판
//   npm run sim -- 20    스무 판
//
// 규칙을 고친 뒤 이걸 돌려서 무엇이 움직였는지 본다. 씨앗이 고정이라
// 같은 코드면 같은 숫자가 나온다 — 달라졌다면 규칙이 달라진 것이다.
import { runGames } from '../shared/sim/game'
import { ROLE_BY_ID } from '../shared/missions/roles'
import { TEAM_IDS } from '../shared/rules/v2'

const games = Number(process.argv[2] ?? 100)
const start = new Date('2026-03-02T08:00:00+09:00').getTime()

const t0 = Date.now()
const r = runGames(games, start)
const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`

console.log(`\n${r.games}판 (${((Date.now() - t0) / 1000).toFixed(1)}초)\n`)

console.log('우승 횟수')
for (const t of TEAM_IDS) console.log(`  ${t}  ${String(r.wins[t]).padStart(3)}`)

console.log('\n팀 점수')
console.log(`  최저 ${r.teamScore.min}  평균 ${r.teamScore.mean.toFixed(1)}  최고 ${r.teamScore.max}`)

console.log('\n개인 점수 분포 (0~9)')
for (const [score, n] of r.personalScore.dist.entries()) {
  if (n === 0 && score > 0) continue
  console.log(`  ${score}점  ${String(n).padStart(4)}  ${'█'.repeat(Math.round((n / (r.games * 14)) * 60))}`)
}
console.log(`  평균 ${r.personalScore.mean.toFixed(2)}`)

console.log('\n역할별 달성률          주 미션  인연')
const ids = Object.keys(r.mainRate).sort((a, b) => r.mainRate[b] - r.mainRate[a])
for (const id of ids) {
  const name = ROLE_BY_ID[id as keyof typeof ROLE_BY_ID].name.padEnd(6, '　')
  console.log(`  ${name}  ${pct(r.mainRate[id])}  ${pct(r.bondRate[id] ?? 0)}`)
}

console.log('\n한 판 평균')
console.log(`  깃발 ${r.perGame.flagsPlanted.toFixed(1)} 꽂아 ${r.perGame.flagsSucceeded.toFixed(1)} 성공`)
console.log(`  표 ${r.perGame.votes.toFixed(1)} · 털어놓기 ${r.perGame.reveals.toFixed(1)} · 건물 ${r.perGame.buildings.toFixed(1)}`)
console.log()
