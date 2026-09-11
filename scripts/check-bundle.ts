// 번들 누출 검사.
//
// 서버 전용 문장이 빌드 결과물에 섞이지 않았는지 본다. 섞였다면
// 개발자도구를 열 줄 아는 한 사람이 닷새치 진상을 첫날 아침에 읽는다.
// 그 판은 되돌릴 수 없으므로, 이 검사는 배포 전에 반드시 돈다.
//
// 방법은 단순하다. functions/src/story/** 에 적힌 한글 문장을 전부 뽑아,
// dist/ 의 모든 파일에서 찾는다. 하나라도 걸리면 실패다.
//
// 한계 하나는 적어 둔다. 문장 **전체**가 있어야 잡는다. 앞부분만 베껴
// 넣으면 지나간다. 실제로 걱정하는 일은 story 모듈을 import 해서 통째로
// 실려 나가는 것이고, 그때는 문장이 온전히 들어 있다.
//
//   npm run check:bundle
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STORY = join(ROOT, 'functions/src/story')
const DIST = join(ROOT, 'dist')

/** 너무 짧은 문장은 우연히 맞을 수 있다. 이보다 짧으면 지문으로 안 쓴다. */
const MIN_LEN = 12

/**
 * 한글이 든 것만 지문으로 삼는다.
 *
 * 처음에는 문자열을 전부 훑었는데, 'studentCouncil'이나 'centralPlaza'
 * 같은 칸 이름이 걸렸다. 그건 판 위의 공개된 이름이라 번들에 있는 게
 * 맞다. 숨겨야 하는 것은 A가 쓴 **문장**이고, 그건 전부 한글이다.
 */
const HANGUL = /[가-힣]/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** 소스에서 따옴표 안 문자열을 전부 뽑는다. */
function stringsIn(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/'([^'\\\n]{12,})'|"([^"\\\n]{12,})"/g)) {
    const text = m[1] ?? m[2]
    if (text.length >= MIN_LEN && HANGUL.test(text)) out.push(text)
  }
  return out
}

function main(): void {
  let storyFiles: string[]
  try {
    // 시험 파일은 배포되지 않는다. 단언문에 적힌 말까지 지문으로 삼으면
    // 공개된 칸 이름이 줄줄이 걸린다
    storyFiles = walk(STORY).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  } catch {
    console.error(`서버 전용 폴더가 없다: ${STORY}`)
    process.exit(1)
  }

  // 화면 코드에 같은 말이 있으면 빼는 방식은 쓰지 않는다. 그러면 문장을
  // src/ 에 복사해 넣는 순간 스스로 흰 목록에 오른다 — 정확히 막아야 할
  // 일이 검사를 통과하게 된다. 한글 지문만으로 충분하다.
  const secrets = new Map<string, string>()
  for (const file of storyFiles) {
    for (const text of stringsIn(readFileSync(file, 'utf8'))) {
      secrets.set(text, relative(ROOT, file))
    }
  }

  let distFiles: string[]
  try {
    distFiles = walk(DIST)
  } catch {
    console.error('dist/ 가 없다. 먼저 빌드해라.')
    process.exit(1)
  }

  const found: { text: string; from: string; inFile: string }[] = []
  for (const file of distFiles) {
    let body: string
    try {
      body = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const [text, from] of secrets) {
      if (body.includes(text)) found.push({ text, from, inFile: relative(ROOT, file) })
    }
  }

  console.log(`서버 전용 문장 ${secrets.size}개 · 번들 파일 ${distFiles.length}개를 훑었다.`)

  if (found.length > 0) {
    console.error('\n번들에 서버 전용 문장이 섞여 있다:\n')
    for (const f of found) {
      console.error(`  ${f.inFile}`)
      console.error(`    ← ${f.from}`)
      console.error(`    "${f.text.slice(0, 40)}${f.text.length > 40 ? '…' : ''}"`)
    }
    console.error('\nsrc/ 에서 functions/src/story 를 import 하지 않았는지 확인해라.')
    process.exit(1)
  }

  console.log('새어 나간 문장 없음.')
}

main()
