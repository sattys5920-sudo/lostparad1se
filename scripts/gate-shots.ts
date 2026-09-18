// 구겨진 투표용지 로그인 화면 — 세 크기 × 다섯 상태.
//
// 「글자가 종이 밖으로 나가지 않는가」, 「접힌 면을 밟지 않는가」는
// 눈으로만 볼 일이 아니라서 상자 좌표로 같이 잰다.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.js'

const OUT = '/tmp/claude-0/shots'
const SIZES = [
  { w: 375, h: 667, name: '375' },
  { w: 390, h: 844, name: '390' },
  { w: 412, h: 915, name: '412' },
]
/** 모서리 구김이 차지한 자리. 글자가 여기 들어가면 안 된다 */
const CORNER = 56

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  for (const s of SIZES) {
    const page = await browser.newPage({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    await page.goto('http://127.0.0.1:8899/lostparad1se/', { waitUntil: 'networkidle' })
    await page.waitForSelector('.sc-gt__paper')
    await page.waitForTimeout(800)

    await page.screenshot({ path: `${OUT}/gate-${s.name}-idle.png` })

    // 글자가 종이 안에, 그리고 구김 밖에 있는가
    const box = await page.evaluate((corner) => {
      const paper = document.querySelector('.sc-gt__paper')!.getBoundingClientRect()
      const bad: string[] = []
      for (const el of document.querySelectorAll('.sc-gt__in *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const tag = `${el.className || el.tagName}`
        if (r.left < paper.left || r.right > paper.right || r.top < paper.top || r.bottom > paper.bottom)
          bad.push(`${tag}: 종이 밖`)
        const inCorner =
          (r.top < paper.top + corner || r.bottom > paper.bottom - corner) &&
          (r.left < paper.left + corner || r.right > paper.right - corner)
        if (inCorner) bad.push(`${tag}: 구김 위`)
      }
      return { paper: { w: Math.round(paper.width), h: Math.round(paper.height) }, bad }
    }, CORNER)
    console.log(s.name, JSON.stringify(box))

    // 입력 중 — 키보드가 올라온 셈 치고 화면을 깎는다
    await page.click('#gt-id')
    await page.fill('#gt-id', '수아')
    await page.fill('#gt-pw', '0000')
    await page.click('#gt-pw')
    await page.setViewportSize({ width: s.w, height: Math.round(s.h * 0.55) })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/gate-${s.name}-typing.png` })
    await page.setViewportSize({ width: s.w, height: s.h })
    await page.waitForTimeout(200)

    // 틀렸을 때
    await page.click('.sc-gt__submit')
    await page.waitForSelector('.sc-gt__error', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/gate-${s.name}-bad.png` })

    // 가입
    await page.click('.sc-gt__link')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/gate-${s.name}-up.png` })
    await page.click('.sc-gt__link')

    // 관리자 — 제목 다섯 번
    for (let i = 0; i < 5; i++) await page.click('.sc-gt__title')
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/gate-${s.name}-host.png` })
    await page.close()
  }
  await browser.close()
  console.log('찍었다')
}

void main()
