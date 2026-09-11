// 누출 확인. 화면이 아니라 **규칙과 서버**가 막는지 본다.
//
// 화면에서 안 그리는 것은 막은 게 아니다. 다른 계정으로 문서를 직접
// 읽어 보고, 날짜를 건너뛴 요청을 직접 넣어 본다.
//
// Firestore 에뮬레이터가 8080에 떠 있어야 한다:
//   npx -y -p firebase-tools firebase emulators:start --only firestore --project demo-goei
//
// 실행: npx vite-node scripts/leak-check.ts
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { canRelease, releasedDays } from '../shared/reveal/release'
import { TOTAL_DAYS } from '../shared/rules/v2'
import { buildArchive, canSeeConfession, type ConfessionSource } from '../shared/reveal/archive'
import { suspicionTotals, buildRows } from '../shared/reveal/dashboard'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function expectDenied(label: string, p: Promise<unknown>): Promise<void> {
  try {
    await assertFails(p)
    check(true, label)
  } catch {
    check(false, label, '통과해 버렸다')
  }
}

async function expectAllowed(label: string, p: Promise<unknown>): Promise<void> {
  try {
    await assertSucceeds(p)
    check(true, label)
  } catch (e) {
    check(false, label, String(e).slice(0, 80))
  }
}

const GAME = 'g1'
const ME = 'p1'
const OTHER = 'p2'
const HOST = 'host1'

async function rulesChecks(env: RulesTestEnvironment): Promise<void> {
  const me = env.authenticatedContext(ME).firestore()
  const other = env.authenticatedContext(OTHER).firestore()
  // 운영자 클레임을 단 계정. 규칙에 운영자 예외가 없다는 걸 보이려고 만든다
  const host = env.authenticatedContext(HOST, { admin: true }).firestore()
  const anon = env.unauthenticatedContext().firestore()

  const notePath = `games/${GAME}/notes/${ME}`

  console.log('\n── 추리 노트 · 인물 보드 ──')
  await expectAllowed('본인은 자기 노트를 쓴다', setDoc(doc(me, notePath), { guesses: { p3: 'guard' } }))
  await expectAllowed('본인은 자기 노트를 읽는다', getDoc(doc(me, notePath)))
  await expectDenied('남의 노트는 못 읽는다', getDoc(doc(other, notePath)))
  await expectDenied('남의 노트는 못 쓴다', setDoc(doc(other, notePath), { guesses: {} }))
  await expectDenied('**운영자도** 남의 노트를 못 읽는다', getDoc(doc(host, notePath)))
  await expectDenied('운영자도 남의 노트를 못 쓴다', setDoc(doc(host, notePath), { guesses: {} }))
  await expectDenied('로그인 안 한 쪽은 아예 못 읽는다', getDoc(doc(anon, notePath)))

  console.log('\n── 1:1 고백 · 그 사람 몫 ──')
  // views/{playerId}에 그 사람이 들은 고백이 담긴다
  const viewPath = `games/${GAME}/views/${ME}`
  await expectAllowed('본인은 자기 몫을 읽는다', getDoc(doc(me, viewPath)))
  await expectDenied('남의 몫은 못 읽는다', getDoc(doc(other, viewPath)))
  await expectDenied('운영자도 남의 몫을 못 읽는다', getDoc(doc(host, viewPath)))
  await expectDenied('본인도 자기 몫을 못 고친다', setDoc(doc(me, viewPath), { x: 1 }))

  console.log('\n── 서버 전용 ──')
  const secretPath = `games/${GAME}/secret/votes`
  await expectDenied('표를 보낸 사람은 아무도 못 읽는다', getDoc(doc(me, secretPath)))
  await expectDenied('운영자도 못 읽는다', getDoc(doc(host, secretPath)))
  await expectDenied('말의 위치는 통째로 막혀 있다', getDoc(doc(me, `games/${GAME}/pawns/${OTHER}`)))
  await expectDenied('예정된 일도 막혀 있다', getDoc(doc(me, `games/${GAME}/schedule/s1`)))
}

function releaseChecks(): void {
  console.log('\n── 공개 시각 전 기록 요청 ──')
  const start = Date.UTC(2026, 2, 1, 23, 0, 0) // DAY 1 08:00 KST
  const HOUR = 3_600_000
  const dayAt = (d: number, h: number) => start + (d - 1) * 24 * HOUR + (h - 8) * HOUR

  // 날짜를 건너뛴 요청
  for (let today = 1; today <= TOTAL_DAYS; today++) {
    const nowMs = dayAt(today, 12)
    for (let want = today + 1; want <= TOTAL_DAYS; want++) {
      const r = canRelease(want, start, nowMs)
      check(!r.ok && r.reason === 'notYet', `DAY ${today}에 DAY ${want} 요청은 「아직」`, r.reason ?? 'ok')
    }
  }
  // 없는 날은 다른 말로 거절한다 — 닷새가 몇 날인지 떠보지 못하게
  for (const bad of [0, -1, 6, 99, 1.5, NaN]) {
    const r = canRelease(bad, start, dayAt(5, 12))
    check(!r.ok && r.reason === 'noSuchDay', `없는 날 ${bad} 요청은 「그런 날 없다」`, r.reason ?? 'ok')
  }
  // 시작 전
  check(canRelease(1, start, start - 1).reason === 'notYet', '시작 1ms 전에는 첫 조각도 안 열린다')
  check(canRelease(1, null, dayAt(3, 12)).reason === 'notStarted', '시작하지 않은 판은 「아직 시작 안 됨」')
  // 08:00 경계
  check(canRelease(2, start, dayAt(2, 8)).ok, 'DAY 2 08:00 정각에 열린다')
  check(!canRelease(2, start, dayAt(2, 8) - 1).ok, 'DAY 2 07:59:59.999에는 안 열린다')
  // 소등 중에도 어제 것은 열려 있다
  check(canRelease(3, start, dayAt(3, 25)).ok, '소등 중(25시)에도 그날 조각은 그대로 열려 있다')
  check(releasedDays(start, dayAt(3, 12)).join(',') === '1,2,3', 'DAY 3에 열린 것은 셋뿐')
}

function archiveChecks(): void {
  console.log('\n── 남의 1:1 고백은 목록에도 없다 ──')
  const c: ConfessionSource = {
    id: 'c1',
    speakerId: 'p3',
    scope: 'private',
    listenerIds: ['p4'],
    text: '숨긴 사실 원문',
    atMs: 1,
  }
  check(canSeeConfession(c, 'p3'), '말한 사람은 본다')
  check(canSeeConfession(c, 'p4'), '들은 사람은 본다')
  check(!canSeeConfession(c, 'p1'), '나머지는 못 본다')

  const built = buildArchive({
    viewerId: 'p1',
    viewerTeam: 'A',
    records: [],
    confessions: [c],
    memories: [{ tileId: 'library', team: 'B', atMs: 2 }],
    sights: [{ ownerId: 'p3', atMs: 3 }],
    tileName: (id) => id,
    nameOf: (id) => id,
  })
  check(built.length === 0, '못 보는 것은 제목조차 남지 않는다', `${built.length}줄`)
  const json = JSON.stringify(built)
  check(!json.includes('p3'), '남의 이름도 안 새어 나간다')
  check(!json.includes('숨긴 사실 원문'), '본문은 근처에도 안 온다')
}

function dashboardChecks(): void {
  console.log('\n── 운영자 대시보드 ──')

  // 표는 보낸 사람까지 다 들고 있다. 대시보드로 나갈 때 무엇이 남는지 본다
  const votes = [
    { voterId: 'p2', targetId: 'p1', day: 2 },
    { voterId: 'p3', targetId: 'p1', day: 3 },
    { voterId: 'p1', targetId: 'p2', day: 3 },
  ]
  const roster = [
    { playerId: 'p1', name: '하나' },
    { playerId: 'p2', name: '두리' },
    { playerId: 'p3', name: '세찌' },
  ]
  const totals = suspicionTotals(roster, (id) => votes.filter((v) => v.targetId === id).length)
  const json = JSON.stringify(totals)
  check(!json.includes('voter'), '합계에 「보낸 사람」 칸이 없다', json)
  check(!json.includes('day'), '날짜별로도 안 쪼갠다 — 투명인간 발표와 맞물려 역산된다')
  check(totals[0].playerId === 'p1' && totals[0].received === 2, '남는 건 받은 수뿐')

  const rows = buildRows({
    roster: [{ playerId: 'p1', name: '하나', role: 'guard' }],
    hintDayOf: () => 2,
    exposureOf: () => 'onlyByOwnReveal',
    reveals: [],
    exactHitsOn: () => 1,
    invisibleDaysOf: () => [],
    awakenedOf: () => false,
  })
  const rowJson = JSON.stringify(rows)
  check(!rowJson.includes('note'), '대시보드 행에 추리 노트가 없다')
  check(!rowJson.includes('voter'), '대시보드 행에 보낸 사람이 없다')
  check(!rowJson.includes('secret'), '대시보드 행에 숨긴 사실 본문이 없다')

  // 서버 코드가 노트를 아예 읽지 않는지 눈으로 말고 파일로 확인한다
  const admin = readFileSync(new URL('../functions/src/admin.ts', import.meta.url), 'utf8')
  const code = admin.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  check(!/notes/.test(code), 'hostDashboard가 notes 컬렉션을 건드리지 않는다')
  check(!/voterId/.test(code), 'hostDashboard가 voterId를 읽지 않는다')
  check(!/implicated/.test(code), '가리켜진 역할 목록도 안 내려보낸다')
}

async function main(): Promise<void> {
  releaseChecks()
  archiveChecks()
  dashboardChecks()

  const env = await initializeTestEnvironment({
    projectId: 'demo-goei',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  try {
    await rulesChecks(env)
  } finally {
    await env.cleanup()
  }

  console.log(failures === 0 ? '\n누출 없음.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
