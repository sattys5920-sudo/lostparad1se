// 나를 만드는 화면 — 세 크기, 서랍 셋.
//
// 눈으로만 보면 놓치는 것이 둘 있어서 같이 잰다. 하나는 **정하는
// 단추가 화면 안에 있는가** — 밖으로 밀려나면 만들 방법이 없는
// 화면이 된다. 다른 하나는 가로로 구르지 않는가다.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.js'

const OUT = '/tmp/claude-0/shots'
const SIZES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 412, h: 915 },
]
/** 아직 나를 안 만든 계정. 없으면 그 자리에서 가입한다 */
const ID = 'cc-shot'
const PW = 'aaaaaa'

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
    await page.fill('#gt-id', ID)
    await page.fill('#gt-pw', PW)
    await page.click('.sc-gt__submit')
    const came = await page
      .waitForSelector('.sc-cc', { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    if (!came) {
      // 아직 없는 계정이다. 가입해서 들어간다
      await page.click('.sc-gt__link')
      await page.fill('#gt-id', ID)
      await page.fill('#gt-pw', PW)
      await page.click('.sc-gt__submit')
      await page.waitForSelector('.sc-cc', { timeout: 10000 })
    }
    await page.waitForTimeout(700)

    for (const [i, tab] of ['머리', '얼굴', '옷'].entries()) {
      await page.click(`.sc-cc__tabs button:nth-child(${i + 1})`)
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${OUT}/cc-${s.w}-${tab}.png` })
    }

    console.log(
      s.w,
      JSON.stringify(
        await page.evaluate(() => {
          const q = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
          return {
            무대: Math.round(q('.sc-cc__stage').height),
            서랍: Math.round(q('.sc-cc__drawer').height),
            단추밀림: Math.round(q('.sc-cc__foot').bottom - innerHeight),
            가로구름: document.documentElement.scrollWidth - innerWidth,
          }
        }),
      ),
    )
    await page.close()
  }
  await browser.close()
  console.log('찍었다')
}

void main()
