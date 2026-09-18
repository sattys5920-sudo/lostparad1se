// 계정에 눌어붙은 운영자 표시가 정말 떨어지는가.
//
// 옛 문지기(claimHost)는 **로그인한 계정 uid 에** 운영자 표시를 박았다.
// 지금은 운영자가 계정이 아니라 고정된 uid 하나지만, 그 시절에 코드를
// 맞힌 계정에는 표시가 남아 있다 — 로그인할 때마다 증표에 따라붙어서
// 운영자 책상이 열리고 서버의 requireHost 도 통과한다.
//
// 그 상황을 그대로 만들어 놓고, 고친 뒤에 어떻게 되는지 잰다.
//
//   npx vite-node scripts/admin-leak.ts
import { createHash } from 'node:crypto'

import pw from '/opt/node22/lib/node_modules/playwright/index.js'

const { chromium } = pw as typeof import('playwright')

const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899/lostparad1se'
const MY_PW = 'leak-test-pass1'

const uidOf = (id: string) => `acct_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`

async function call(name: string, tk: string | null, data: unknown): Promise<{ ok: boolean; body: unknown }> {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = (await r.json()) as { result?: unknown; error?: { message: string } }
  if (j.error) return { ok: false, body: j.error.message }
  return { ok: true, body: j.result }
}

async function must(name: string, tk: string | null, data: unknown): Promise<Record<string, unknown>> {
  const out = await call(name, tk, data)
  if (!out.ok) throw new Error(`${name}: ${String(out.body)}`)
  return (out.body ?? {}) as Record<string, unknown>
}

/** 사용자 기록에 붙어 있는 표시. 옛 문지기가 박아 두던 자리다. */
async function claimsOf(uid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${AUTH}/projects/${PROJECT}/accounts:lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: [uid] }),
  })
  const { users } = (await r.json()) as { users?: { customAttributes?: string }[] }
  const raw = users?.[0]?.customAttributes
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

/** 옛 문지기가 하던 짓을 그대로 한다. */
async function stampAdmin(uid: string): Promise<void> {
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ admin: true }) }),
  })
}

/** 증표 안에 무엇이 적혀 왔는가. 서명은 안 본다 — 에뮬레이터다. */
function inToken(idToken: string): Record<string, unknown> {
  const body = idToken.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as Record<string, unknown>
}

async function signIn(custom: string): Promise<string> {
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return ((await r.json()) as { idToken: string }).idToken
}

async function main() {
  const me = `leak${String(Date.now()).slice(-6)}`
  const uid = uidOf(me)

  // 계정 하나를 만든다. **가입만으로는 사용자 기록이 안 생긴다** —
  // 증표를 한 번 써야 만들어진다. 기록이 없으면 표시를 박을 데도 없어서,
  // 그냥 박으면 아무 일도 안 일어나고 시험이 통과한 척한다
  const made = await must('signUpAccount', null, { id: me, password: MY_PW })
  await signIn(String(made.token ?? ''))
  // 여기서부터가 옛 문지기가 하던 짓이다
  await stampAdmin(uid)
  const before = await claimsOf(uid)
  if (before.admin !== true) throw new Error('표시가 안 박혔다. 이 시험은 아무것도 재지 못한다')

  // 그 계정으로 로그인한다
  const reply = await must('logInAccount', null, { id: me, password: MY_PW })
  const idToken = await signIn(String(reply.token ?? ''))
  const after = await claimsOf(uid)
  const tok = inToken(idToken)

  // 운영자만 되는 일을 해 본다
  const tried = await call('hostAccounts', idToken, {})

  // 화면은 어디로 가는가
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle' })
  await page.fill('#gt-id', me)
  await page.fill('#gt-pw', MY_PW)
  await page.click('.sc-gt__submit')
  await page.waitForTimeout(3000)
  const where = await page.evaluate(`(() => {
    if (document.querySelector('.sc-ad')) return '운영자 책상'
    if (document.querySelector('.sc-gt')) return '문 앞'
    if (document.querySelector('.sc-pl-root')) return '게임'
    return '모름'
  })()`)
  await page.screenshot({ path: '/tmp/claude-0/shots/leak-1-로그인뒤.png' })
  await browser.close()

  console.log(
    JSON.stringify(
      {
        박기전: before,
        로그인뒤사용자기록: after,
        증표에admin: tok.admin ?? null,
        증표에accountId: tok.accountId ?? null,
        '운영자일하기(hostAccounts)': tried.ok ? '통과했다' : `막혔다 — ${String(tried.body)}`,
        화면: where,
      },
      null,
      1,
    ),
  )
}

void main()
