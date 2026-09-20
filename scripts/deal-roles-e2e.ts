// 배정 — 열넷이 차면 나뉘고, 팀은 모두가 알고, 역할은 나만 안다.
//
// 이 대본이 붙드는 것은 넷이다.
//   1. 열셋까지는 아무것도 안 나뉜다
//   2. 열넷째가 앉는 순간 열넷 몫이 나뉜다
//   3. 한 자리가 비면 통째로 지워진다(남은 열셋의 배정도 못 믿는다)
//   4. **팀은 전체 공개, 역할·숨긴 사실·개인 미션은 개인 공개**
//
//   npx vite-node scripts/deal-e2e.ts
import { createHash } from 'node:crypto'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const PW = 'deal-pass-1'

let bad = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  return j.error ? { ok: false as const, err: j.error.message } : { ok: true as const, result: j.result ?? {} }
}
async function must(name: string, tk: string | null, data: unknown) {
  const r = await call(name, tk, data)
  if (!r.ok) throw new Error(`${name}: ${r.err}`)
  return r.result
}

async function hostToken(tag: string): Promise<string> {
  const email = `host-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [email] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return ((await inn.json()) as { idToken: string }).idToken
}

const tokenFor = (host: string) => async (id: string): Promise<string> => {
  const custom = String((await must('logInAccount', host, { id, password: PW })).token ?? '')
  const swap = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await swap.json()) as { idToken: string }).idToken
}

/** 나눠 둔 역할이 몇 줄인가. **운영자 열쇠로만 센다** — 규칙은 아무도 못 읽게 막는다 */
async function rosterSize(game: string): Promise<number> {
  const r = await fetch(`${FS}/games/${game}/secret/roster/items`, { headers: ADMIN })
  if (!r.ok) return -1
  const j = (await r.json()) as { documents?: unknown[] }
  return (j.documents ?? []).length
}

async function main() {
  const game = `dl${Date.now()}`
  const host = await hostToken(game)
  const tok = tokenFor(host)
  await must('createGame', host, { gameId: game, seed: 'dl' })

  const ids: string[] = []
  for (let i = 0; i < 14; i += 1) {
    const id = `dl${String(Date.now()).slice(-6)}n${i}`
    await must('signUpAccount', host, { id, password: PW })
    ids.push(id)
  }
  const toks = new Map<string, string>()
  for (const id of ids) toks.set(id, await tok(id))

  console.log('\n── 열셋까지 ──')
  for (let i = 0; i < 13; i += 1) {
    await must('joinGame', toks.get(ids[i]) as string, { gameId: game, name: `아이${i}` })
  }
  check((await rosterSize(game)) === 0, '열셋이 앉아 있는 동안에는 아무것도 안 나뉜다')
  const early = await call('myPaper', toks.get(ids[0]) as string, { gameId: game })
  // **왜 거절했는지까지 본다.** 「아직 안 시작했다」로 막히면 배정이
  // 안 된 것을 확인한 게 아니라 다른 문에 걸린 것이다
  check(
    !early.ok && (early.err ?? '').includes('이 판에 없는 사람이다'),
    '배정 전에는 학생증도 없다 — 나눠 둔 것이 없어서다',
    early.ok ? '내려와 버렸다' : (early.err ?? ''),
  )

  console.log('\n── 열넷째 ──')
  const last = await must('joinGame', toks.get(ids[13]) as string, { gameId: game, name: '열넷째' })
  check(last.dealt === true, '열넷째가 앉는 순간 나뉘었다고 알려 준다')
  check((await rosterSize(game)) === 14, '역할 열넷이 적혔다')

  console.log('\n── 팀은 전체 공개 ──')
  // 판 문서는 로그인한 누구나 읽는다. 내 토큰으로 남의 팀까지 읽힌다
  const asPlayer = { Authorization: `Bearer ${toks.get(ids[0]) as string}` }
  const gameDoc = await fetch(`${FS}/games/${game}`, { headers: asPlayer })
  check(gameDoc.ok, '보통 사람도 판 문서를 읽는다', String(gameDoc.status))
  const seats = ((await gameDoc.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } }[] } } }
  }).fields?.seats?.arrayValue?.values ?? []
  const teams = seats.map((v) => v.mapValue?.fields?.team?.stringValue)
  check(seats.length === 14 && teams.every((t) => typeof t === 'string'), '열넷의 팀이 거기 다 적혀 있다', teams.join(''))

  console.log('\n── 역할은 개인 공개 ──')
  const mineUid = uidOf(ids[0])
  const otherUid = uidOf(ids[1])
  // 남의 역할 문서를 내 토큰으로 직접 열어 본다
  const peekOther = await fetch(`${FS}/games/${game}/secret/roster/items/${otherUid}`, { headers: asPlayer })
  check(peekOther.status === 403, '남의 역할 문서는 규칙이 막는다', String(peekOther.status))
  // **제 것도 못 읽는다.** secret 아래는 통째로 닫혀 있고 myPaper 만 꺼내 준다
  const peekMine = await fetch(`${FS}/games/${game}/secret/roster/items/${mineUid}`, { headers: asPlayer })
  check(peekMine.status === 403, '제 역할 문서조차 직접은 못 읽는다', String(peekMine.status))

  const paper = (await must('myPaper', toks.get(ids[0]) as string, { gameId: game })) as {
    roleName?: string
    secret?: string
    main?: { text?: string }
    counting?: boolean
    pathLabel?: string
  }
  // 갈래는 화면이 안 적으므로 서버도 안 보낸다. 안 쓰는 값이 응답에
  // 남아 있으면 언젠가 누가 그걸 다시 그린다
  check(paper.pathLabel === undefined, '갈래(팀의 길…)는 아예 안 내려온다', String(paper.pathLabel))
  check(typeof paper.roleName === 'string' && paper.roleName.length > 0, 'myPaper 는 내 역할 이름을 준다', paper.roleName ?? '')
  check(typeof paper.secret === 'string' && paper.secret.length > 8, '내 숨긴 사실도 온다')
  check((paper.main?.text ?? '').length > 8, '내 개인 미션 문장도 온다')
  check(paper.counting === false, '로비에서는 진행도를 안 센다 — 셀 것이 아직 없다')

  // 남의 학생증을 달라고 해도 줄 창구가 없다. myPaper 는 부른 사람 것만 본다
  const asOther = (await must('myPaper', toks.get(ids[1]) as string, { gameId: game })) as { roleName?: string }
  check(
    typeof asOther.roleName === 'string',
    '남은 남의 것만 받는다 — 같은 창구로 서로 다른 답이 온다',
    `${paper.roleName} / ${asOther.roleName}`,
  )

  console.log('\n── 한 자리가 비면 ──')
  await must('leaveGame', toks.get(ids[13]) as string, { gameId: game })
  check((await rosterSize(game)) === 0, '나눠 둔 역할이 통째로 지워진다')
  const gone = await call('myPaper', toks.get(ids[0]) as string, { gameId: game })
  check(
    !gone.ok && (gone.err ?? '').includes('이 판에 없는 사람이다'),
    '남아 있는 사람의 학생증도 같이 사라진다',
    gone.ok ? '아직 내려온다' : (gone.err ?? ''),
  )

  console.log('\n── 다시 차면 ──')
  await must('joinGame', toks.get(ids[13]) as string, { gameId: game, name: '열넷째' })
  check((await rosterSize(game)) === 14, '열넷이 되면 다시 나뉜다')
  const again = (await must('myPaper', toks.get(ids[0]) as string, { gameId: game })) as { roleName?: string }
  check(
    again.roleName === paper.roleName,
    '같은 명단·같은 씨앗이면 같은 역할이다',
    `${paper.roleName} → ${again.roleName}`,
  )

  console.log(bad === 0 ? '\n다 맞았다.' : `\n어긋난 것 ${bad}개.`)
  if (bad > 0) process.exitCode = 1
}

void main()
