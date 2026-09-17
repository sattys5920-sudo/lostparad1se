// 가입 데이터 정리를 **진짜 서버로** 확인한다.
//
// 운영자가 목록을 펴고 고른 것을 지운다. 여기서 보는 것:
// 운영자가 아니면 막히는가, 비밀번호에 관한 것이 섞여 나오지 않는가,
// 지우면 로그인까지 막히는가, 판의 명단은 그대로인가, 같은 아이디로
// 다시 가입하면 같은 uid 로 돌아오는가.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/signup-e2e.ts
import { createHash } from 'node:crypto'

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const TAG = String(Date.now()).slice(-6)
const PW = 'signuppass1'
const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function asPlayer(id: string, password = PW): Promise<string> {
  const custom = String((await call('logInAccount', null, { id, password })).token ?? '')
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
async function exists(path: string): Promise<boolean> {
  return (await fetch(`${FS}/${path}`, { headers: ADMIN })).ok
}

interface Row { id: string; nickname: string; face: boolean; playing: boolean }

async function main(): Promise<void> {
  // 운영자 계정 — 사람이 쓰는 문으로 만들고 표시만 붙인다
  const bossId = `boss${TAG}`
  await call('signUpAccount', null, { id: bossId, password: PW })
  // **한 번 들어와야 Auth 에 사람이 생긴다.** 증표를 만드는 것만으로는
  // 사용자 기록이 없어서, 운영자 표시를 붙일 자리가 없다
  await asPlayer(bossId)
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uidOf(bossId), customAttributes: JSON.stringify({ admin: true }) }),
  })
  const host = await asPlayer(bossId)

  const a = `alpha${TAG}`
  const b = `beta${TAG}`
  await call('signUpAccount', null, { id: a, password: PW })
  await call('signUpAccount', null, { id: b, password: PW })
  const plain = await asPlayer(a)

  console.log('\n── 운영자만 본다 ──')
  const noList = await call('hostAccounts', plain, {}).then(() => '', (e: Error) => e.message)
  check(noList.includes('운영자만'), '가입자가 목록을 못 편다', noList)
  const noKill = await call('hostDeleteAccounts', plain, { ids: [b] }).then(() => '', (e: Error) => e.message)
  check(noKill.includes('운영자만'), '가입자가 남을 못 지운다', noKill)
  check(await exists(`schoolSessions/live/accounts/${b}`), '거절당한 계정은 그대로 있다')

  console.log('\n── 목록 ──')
  const rows = ((await call('hostAccounts', host, {})).rows ?? []) as Row[]
  const mine = rows.find((r) => r.id === a)
  check(mine !== undefined, '방금 가입한 것이 목록에 있다')
  // **비밀번호에 관한 것이 한 글자도 섞이면 안 된다**
  const leaked = JSON.stringify(rows).match(/salt|hash|password/i)
  check(leaked === null, '소금·해시가 안 딸려 나온다', leaked ? String(leaked[0]) : '')
  check(mine?.face === false, '얼굴을 안 만든 것이 보인다')

  console.log('\n── 내 것은 못 지운다 ──')
  const self = await call('hostDeleteAccounts', host, { ids: [bossId] })
  check((self.gone as string[]).length === 0, '운영자가 제 계정을 못 지운다')
  check(((self.kept as { id: string; why: string }[])[0] ?? {}).why === '내 계정이다', '까닭을 말해 준다')

  console.log('\n── 지운다 ──')
  const out = await call('hostDeleteAccounts', host, { ids: [b, `없는${TAG}`] })
  check((out.gone as string[]).includes(b), `${b} 를 지웠다`)
  check((out.kept as { id: string }[]).length === 1, '없는 아이디는 못 지웠다고 말한다')
  check(!(await exists(`schoolSessions/live/accounts/${b}`)), '계정 문서가 없다')
  check(!(await exists(`schoolSessions/live/accounts/${b}/auth/secret`)), '비밀번호 문서도 같이 없앴다')

  const back = await call('logInAccount', null, { id: b, password: PW }).then(() => '', (e: Error) => e.message)
  check(back.length > 0, '지운 계정으로는 못 들어온다', back)

  const seatsOf = async (gameId: string): Promise<number> => {
    const g = await fetch(`${FS}/games/${gameId}`, { headers: ADMIN })
    return (
      ((await g.json()) as {
        fields?: { seats?: { arrayValue?: { values?: unknown[] } } }
      }).fields?.seats?.arrayValue?.values ?? []
    ).length
  }

  console.log('\n── 시작한 판의 명단은 안 건드린다 ──')
  const GAME = `sg${TAG}`
  await call('createGame', host, { gameId: GAME, seed: 'sg' })
  const c = `gamma${TAG}`
  await call('signUpAccount', null, { id: c, password: PW })
  await call('joinGame', await asPlayer(c), { gameId: GAME, name: '감마', team: 'A' })
  // 시작한 판으로 만든다 — 자리를 빼면 말도 점수도 주인을 잃는다
  await fetch(`${FS}/games/${GAME}?updateMask.fieldPaths=phase`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ fields: { phase: { stringValue: 'running' } } }),
  })
  await call('hostDeleteAccounts', host, { ids: [c] })
  check((await seatsOf(GAME)) === 1, '시작한 판의 자리는 그대로 남는다', `${await seatsOf(GAME)}자리`)

  /**
   * **여기가 「자리가 없다」의 정체다.**
   *
   * 로비에 앉은 사람의 계정을 지우면, 그 사람은 안 돌아오는데 자리는
   * 차 있다. 열넷이 그렇게 되면 새로 가입한 사람은 앉을 데가 없다 —
   * 실제로 그렇게 막혔다.
   */
  console.log('\n── 시작 안 한 판의 자리는 비운다 ──')
  const LOB = `lb${TAG}`
  await call('createGame', host, { gameId: LOB, seed: 'lb' })
  const d1 = `del1${TAG}`
  const d2 = `del2${TAG}`
  const keep = `keep${TAG}`
  for (const id of [d1, d2, keep]) await call('signUpAccount', null, { id, password: PW })
  await call('joinGame', await asPlayer(d1), { gameId: LOB, name: '델타', team: 'A' })
  await call('joinGame', await asPlayer(d2), { gameId: LOB, name: '엡실론', team: 'A' })
  await call('joinGame', await asPlayer(keep), { gameId: LOB, name: '남는이', team: 'A' })
  check((await seatsOf(LOB)) === 3, '셋이 앉았다')

  const wiped = await call('hostDeleteAccounts', host, { ids: [d1, d2] })
  check((wiped.freed as string[]).length === 2, '지우면서 두 자리를 같이 비웠다', String((wiped.freed as string[]).length))
  check((await seatsOf(LOB)) === 1, '남은 사람 자리만 남는다', `${await seatsOf(LOB)}자리`)

  // 자리가 비었으니 새 사람이 앉는다 — 이것이 고치려던 것이다
  const fresh = `new${TAG}`
  await call('signUpAccount', null, { id: fresh, password: PW })
  const sat = await call('joinGame', await asPlayer(fresh), { gameId: LOB, name: '새사람', team: 'A' })
  check(sat.seated === 2, '새로 가입한 사람이 앉는다', `${sat.seated}명`)

  console.log('\n── 이미 막힌 판은 단추로 푼다 ──')
  const JAM = `jm${TAG}`
  await call('createGame', host, { gameId: JAM, seed: 'jm' })
  const g1 = `ghost${TAG}`
  await call('signUpAccount', null, { id: g1, password: PW })
  await call('joinGame', await asPlayer(g1), { gameId: JAM, name: '유령', team: 'B' })
  // 자리만 남기고 계정을 조용히 없앤다(옛 판이 이 꼴이었다)
  await fetch(`${FS}/schoolSessions/live/accounts/${g1}`, { method: 'DELETE', headers: ADMIN })
  check((await seatsOf(JAM)) === 1, '주인 없는 자리가 남아 있다')
  const swept = await call('sweepSeats', host, { gameId: JAM })
  check((swept.freed as string[]).length === 1, '단추 한 번에 비운다', (swept.freed as string[]).join(','))
  check((await seatsOf(JAM)) === 0, '자리가 비었다')

  const noRun = await call('sweepSeats', host, { gameId: GAME }).then(() => '', (e: Error) => e.message)
  check(noRun.includes('이미 시작한 판'), '시작한 판에서는 못 한다', noRun)

  console.log('\n── 같은 아이디로 다시 가입하면 ──')
  const again = await call('signUpAccount', null, { id: c, password: 'brandnew1' })
  check(again.uid === uidOf(c), '같은 uid 로 돌아온다 — 앉아 있던 자리로 간다', String(again.uid))

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
