// 역할 열넷 검사 — **빌드 때 돈다**(npm run build · check:roles · check:doc).
//
// 기준은 docs/roles_full.md, 정본은 데이터 파일(shared/missions/roleData.ts).
//
//   오류(빌드를 막는다)
//     - 문장이 문서와 한 글자라도 다르다: 이름 · 한 줄 소개 · 상황 문단 · 미션 요약 ·
//       미션 한 줄 · 세는 것 · 단서 · 쪽지 · 쪽지 미션 · 마지막 선택
//     - 공개 시점이 문서와 다르다 · 조건 줄 수가 다르다 · ★ · 갈래가 다르다
//     - 화면용 이름(roleNames.ts)이 데이터와 다르다
//   알림(빌드는 안 막는다)
//     - 기준 수치가 문서와 다르다 — 수치는 데이터 파일만 고쳐도 되게 했다
import { checkRoles } from './lib/checkRoles'
import { ROLE_DATA } from '../shared/missions/roleData'

const { errors, notices } = checkRoles()
for (const n of notices) console.log(`  · 수치가 문서와 다르다(데이터 파일 값을 쓴다) — ${n}`)
if (errors.length > 0) {
  for (const e of errors) console.log(`  ✗ ${e}`)
  console.log(`\n역할 검사 ${errors.length}건 실패.`)
  process.exit(1)
}
console.log(`역할 ${ROLE_DATA.length}개 — 문장이 docs/roles_full.md 와 한 글자도 같다.`)
