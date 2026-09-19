// 복합 쿼리마다 색인이 있는가.
//
// **에뮬레이터는 색인 없이도 어떤 쿼리든 돌린다.** 그래서 브라우저
// 검증이 전부 통과하는데도 실제 Firestore 에서는 「같음 + 범위」 쿼리가
// 색인이 없다고 거절됐다 — chatLines 와 radioLines 가 그렇게 영영
// 실패했고, 화면은 그 오류를 삼켜서 로그도 풍선도 그냥 비어 있었다.
// 이 시험은 그 빈틈을 메운다: 서버 코드의 복합 쿼리를 긁어서, 하나하나
// firestore.indexes.json 에 짝이 있는지 본다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'functions', 'src')

interface Index { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }

function indexes(): Index[] {
  return (JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8')) as { indexes: Index[] }).indexes
}

/**
 * 색인이 있어야 하는 쿼리 모양: 한 필드의 같음(==) 과 **다른** 필드의
 * 범위(>,>=,<,<=) 또는 정렬. 같음만 여럿이면 필요 없다 — Firestore 가
 * 단일 색인을 합쳐 쓴다.
 */
function needsIndex(): { file: string; eq: string; range: string }[] {
  const out: { file: string; eq: string; range: string }[] = []
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(SRC, f), 'utf8')
    // 한 쿼리 = .get() 이나 ; 로 끝나는 체인
    for (const chain of src.split(/\.get\(\)|;\n/)) {
      const eqs = [...chain.matchAll(/\.where\('([^']+)',\s*'=='/g)].map((m) => m[1])
      const ranges = [...chain.matchAll(/\.where\('([^']+)',\s*'(?:>|>=|<|<=)'/g)].map((m) => m[1])
      const orders = [...chain.matchAll(/\.orderBy\('([^']+)'/g)].map((m) => m[1])
      for (const eq of eqs) for (const r of [...ranges, ...orders]) if (r !== eq) out.push({ file: f, eq, range: r })
    }
  }
  return out
}

describe('firestore.indexes.json', () => {
  it('firebase.json 이 색인 파일을 가리킨다 — 안 가리키면 배포에 안 실린다', () => {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')) as { firestore: { indexes?: string } }
    expect(fb.firestore.indexes).toBe('firestore.indexes.json')
  })

  it('배포 워크플로가 색인을 올린다 — 파일만 있고 안 올리면 똑같이 죽는다', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-functions.yml'), 'utf8')
    expect(wf).toMatch(/inputs\.what \|\| '[^']*firestore:indexes/)
    expect(wf).toContain("'firestore.indexes.json'")
  })

  it('서버의 「같음 + 범위」 복합 쿼리마다 색인이 있다', () => {
    const need = needsIndex()
    // 이 시험이 아무것도 안 긁으면 그것부터가 틀린 것이다
    expect(need.length).toBeGreaterThanOrEqual(3)
    const have = indexes()
    const missing = need.filter(
      (q) => !have.some((ix) => ix.fields.length === 2 && ix.fields[0].fieldPath === q.eq && ix.fields[1].fieldPath === q.range),
    )
    expect(missing, `색인 없는 쿼리: ${JSON.stringify(missing)}`).toEqual([])
  })

  it('chatLines · radioLines · unheardLines 셋은 반드시 있다', () => {
    const pairs = indexes().map((ix) => ix.fields.map((f) => f.fieldPath).join('+'))
    expect(pairs).toContain('tileId+atMs')
    expect(pairs).toContain('team+atMs')
    expect(pairs).toContain('invisible+atMs')
  })
})
