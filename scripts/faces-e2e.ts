// 명단의 얼굴을 **진짜 서버로** 확인한다.
//
// 「왜 아직도 다른 사람들이 점으로 떠?」의 정체. 화면은 명단(seats)의
// look 이 비어 있으면 점을 찍는다. 그 look 은 자리에 앉는 순간 계정에서
// 한 번 찍히는데, **얼굴을 만들기 전에 앉은 사람**은 영영 비어 있었다.
// 되돌리기가 자리를 그대로 들고 오니 다음 판까지 따라왔다.
//
//   npx -y -p firebase-tools firebase emulators:start \
//     --only firestore,functions,auth --project demo-goei
//   npx vite-node scripts/faces-e2e.ts
import { createHash } from 'node:crypto'
import { randomLook } from '../src/school/char/look'
import { STARTING_TEAM_SIZES, type TeamId } from '../shared/rules/v2'
import { TOTAL_SEATS } from '../shared/rules/lobby'

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

const GAME = `face${Date.now()}`
const PW = 'facepass1'
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
/** 그 계정으로 로그인한 증표. 화면이 쓰는 문과 같다. */
async function asPlayer(id: string): Promise<string> {
  const custom = String((await call('logInAccount', null, { id, password: PW })).token ?? '')
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}
/** 명단의 얼굴. 화면이 점을 찍을지 사람을 그릴지 가르는 값 그대로다. */
async function faces(): Promise<{ name: string; has: boolean }[]> {
  const r = await fetch(`${FS}/games/${GAME}`, { headers: ADMIN })
  const j = (await r.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } } }
  }
  return (j.fields?.seats?.arrayValue?.values ?? []).map((v) => {
    const f = v.mapValue?.fields ?? {}
    const look = f.look as { mapValue?: unknown; nullValue?: unknown } | undefined
    return {
      name: (f.name as { stringValue?: string })?.stringValue ?? '',
      has: look !== undefined && look.mapValue !== undefined,
    }
  })
}

async function main(): Promise<void> {
  console.log(`판 ${GAME}`)
  const he = `h-${GAME}@x.test`
  await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: he, password: 'password', returnSecureToken: true }),
  })
  const look = await fetch(`${AUTH}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ email: [he] }),
  })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }),
  })
  const tok = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: he, password: 'password', returnSecureToken: true }),
  })
  const host = ((await tok.json()) as { idToken: string }).idToken

  await call('createGame', host, { gameId: GAME, seed: 'face' })

  const want: TeamId[] = []
  for (const t of ['A', 'B', 'C', 'D'] as TeamId[]) {
    for (let i = 0; i < STARTING_TEAM_SIZES[t]; i++) want.push(t)
  }

  console.log('\n── 얼굴을 안 만든 채 앉는다 ──')
  // 가입만 하고 캐릭터를 안 만든 사람. 실제로 이 순서로 앉는 사람이 있다
  const ids: string[] = []
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const id = `face${i}${GAME.slice(-5)}`
    ids.push(id)
    await call('signUpAccount', null, { id, password: PW, nickname: `사람${i}` })
    const tk = await asPlayer(id)
    await call('joinGame', tk, { gameId: GAME, name: `사람${i}`, team: want[i] })
  }
  const before = await faces()
  check(before.length === TOTAL_SEATS, '열넷이 앉았다', `${before.length}자리`)
  check(before.every((f) => !f.has), '아무도 얼굴이 없다 — 화면에서는 전부 점이다', `${before.filter((f) => f.has).length}명만 있다`)

  console.log('\n── 앉고 나서 얼굴을 만든다 ──')
  for (const id of ids) {
    const tk = await asPlayer(id)
    await call('saveCharacter', tk, { nickname: id.slice(0, 8), avatar: randomLook(Math.random() < 0.5 ? 'F' : 'M') })
  }
  const stale = await faces()
  check(stale.every((f) => !f.has), '명단은 그대로 비어 있다 — 앉을 때 찍은 값이라 안 따라온다')

  console.log('\n── 얼굴 다시 읽기 ──')
  const denied = await call('refreshFaces', await asPlayer(ids[0]), { gameId: GAME }).then(
    () => '',
    (e: Error) => e.message,
  )
  check(denied.includes('운영자만'), '운영자가 아니면 거절한다', denied)

  const out = await call('refreshFaces', host, { gameId: GAME })
  check(out.faces === TOTAL_SEATS, '열넷의 얼굴을 읽었다', `${out.faces}명`)
  const after = await faces()
  check(after.every((f) => f.has), '명단에 얼굴이 다 찼다 — 이제 사람으로 그려진다')

  console.log('\n── 시작할 때도 저절로 읽는다 ──')
  // 다시 비워 놓고, 「닷새 시작」만 눌러도 채워지는지 본다
  const GAME2 = `${GAME}b`
  await call('createGame', host, { gameId: GAME2, seed: 'face2' })
  for (let i = 0; i < TOTAL_SEATS; i++) {
    const tk = await asPlayer(ids[i])
    await call('joinGame', tk, { gameId: GAME2, name: `사람${i}`, team: want[i] })
  }
  // 팀과 개인 미션은 배정에서 한꺼번에 정해진다. 시작은 그걸 읽을 뿐이다
  await call('assignAll', host, { gameId: GAME2 })
  await call('startGame', host, { gameId: GAME2 })
  const r2 = await fetch(`${FS}/games/${GAME2}`, { headers: ADMIN })
  const j2 = (await r2.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } } }
  }
  const got = (j2.fields?.seats?.arrayValue?.values ?? []).filter(
    (v) => (v.mapValue?.fields?.look as { mapValue?: unknown } | undefined)?.mapValue !== undefined,
  ).length
  check(got === TOTAL_SEATS, '시작하면서 열넷의 얼굴이 다 들어갔다', `${got}명`)

  console.log('\n── 되돌려도 얼굴이 남는다 ──')
  await call('resetGame', host, { gameId: GAME2 })
  const r3 = await fetch(`${FS}/games/${GAME2}`, { headers: ADMIN })
  const j3 = (await r3.json()) as {
    fields?: { seats?: { arrayValue?: { values?: { mapValue?: { fields?: Record<string, unknown> } }[] } } }
  }
  const kept = (j3.fields?.seats?.arrayValue?.values ?? []).filter(
    (v) => (v.mapValue?.fields?.look as { mapValue?: unknown } | undefined)?.mapValue !== undefined,
  ).length
  check(kept === TOTAL_SEATS, '되돌린 로비에도 얼굴이 그대로다', `${kept}명`)

  console.log(failures === 0 ? '\n전부 통과.' : `\n${failures}개 실패.`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
