// 번들 누출 검사.
//
// 서버 전용 문장이 빌드 결과물에 섞이지 않았는지 본다. 섞였다면
// 개발자도구를 열 줄 아는 한 사람이 닷새치 진상을 첫날 아침에 읽는다.
// 그 판은 되돌릴 수 없으므로, 이 검사는 배포 전에 반드시 돈다.
//
// 방법은 단순하다. functions/src/story/** 에 적힌 문자열 상수를 전부
// 뽑아, dist/ 의 모든 파일에서 찾는다. 하나라도 걸리면 실패다.
//
//   npm run check:bundle
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STORY = join(ROOT, 'functions/src/story')
const DIST = join(ROOT, 'dist')

/** 너무 짧은 문장은 우연히 맞을 수 있다. 이보다 짧으면 지문으로 안 쓴다. */
const MIN_LEN = 12

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
    if (text.length >= MIN_LEN) out.push(text)
  }
  return out
}

function main(): void {
  let storyFiles: string[]
  try {
    storyFiles = walk(STORY).filter((f) => f.endsWith('.ts'))
  } catch {
    console.error(`서버 전용 폴더가 없다: ${STORY}`)
    process.exit(1)
  }

  const secrets = new Map<string, string>()
  for (const file of storyFiles) {
    for (const text of stringsIn(readFileSync(file, 'utf8'))) {
      // 주석과 코드가 아니라 데이터만 보고 싶지만, 넓게 잡아도 손해는 없다.
      // 번들에 들어가면 안 되는 건 마찬가지다.
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
