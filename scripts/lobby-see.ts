// 시작 전 2-3 교실 — 들어온 사람끼리 서로 보이는가.
//
// 둘을 각자 폰으로 들여보내고, 서로의 화면에 상대가 그려지는지 찍는다.
// live 문서가 적혔는지도 같이 본다.
import pw from '/opt/node22/lib/node_modules/playwright/index.js'

const { chromium } = pw as typeof import('playwright')
const PROJECT = 'demo-goei'
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-northeast3`
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner' }
const SITE = 'http://127.0.0.1:8899'
const OUT = '/tmp/claude-0/repro'
const QA_PW = 'seed-password-1'

async function must(name: string, tk: string | null, data: unknown) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ data }) })
  const j = (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (j.error) throw new Error(`${name}: ${j.error.message}`)
  return j.result ?? {}
}
async function hostToken(tag: string): Promise<string> {
  const email = `see-${tag}@x.test`
  const body = JSON.stringify({ email, password: 'password', returnSecureToken: true })
  await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const look = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ email: [email] }) })
  const { users } = (await look.json()) as { users: { localId: string }[] }
  await fetch(`${AUTH}/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify({ localId: users[0].localId, customAttributes: JSON.stringify({ admin: true }) }) })
  const inn = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  return ((await inn.json()) as { idToken: string }).idToken
}

async function main() {
  const game = `ls${Date.now()}`
  const host = await hostToken(game)
  await must('createGame', host, { gameId: game, seed: 'ls' })
  await must('seedPlayers', host, { gameId: game, password: QA_PW, leaveSeats: 0 })
  console.log(`판 ${game} — 시작 안 함`)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const pages = []
  for (const id of ['qa01', 'qa02', 'qa03', 'qa04', 'qa05', 'qa06']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    const errs: string[] = []
    page.on('console', (m) => { if (/permission|denied|insufficient/i.test(m.text())) errs.push(m.text().slice(0, 160)) })
    await page.goto(`${SITE}/?game=${game}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#gt-id', { timeout: 15000 })
    await page.fill('#gt-id', id)
    await page.fill('#gt-pw', QA_PW)
    await page.click('.sc-gt__submit')
    for (let i = 0; i < 30; i++) {
      if (await page.locator('.sc-pl__before').count()) break
      await page.locator('.sc-dl__go').click({ timeout: 500 }).catch(() => undefined)
      await page.waitForTimeout(300)
    }
    pages.push({ id, page, errs })
  }
  await pages[0].page.waitForTimeout(9000)
  const live = (await fetch(`${FS}/games/${game}/live`, { headers: ADMIN }).then((r) => r.json())) as { documents?: { name: string; fields: Record<string, { integerValue?: string; doubleValue?: number; stringValue?: string }> }[] }
  console.log(`live 문서 ${live.documents?.length ?? 0}개`)
  for (const d of live.documents ?? []) console.log(`  ${d.name.split('/').pop()} x=${d.fields.x?.integerValue ?? d.fields.x?.doubleValue} y=${d.fields.y?.integerValue ?? d.fields.y?.doubleValue} tile=${d.fields.tileId?.stringValue}`)
  for (const p of pages) {
    await p.page.screenshot({ path: `${OUT}/${p.id}.png` })
    console.log(`${p.id} 권한 오류: ${JSON.stringify(p.errs.slice(0, 3))}`)
  }
  await browser.close()
}
void main().catch((e) => { console.error(e); process.exit(1) })
