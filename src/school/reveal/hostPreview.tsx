// 운영자 도구 검수용. 문장과 이름은 전부 가짜다.
// 진짜 검수 목록은 서버가 auditLines()로 만들어 내려보낸다.
//
// **여기에 진짜 문장을 한 줄도 옮겨 적지 마라.** 이 파일은 번들에
// 실린다. 한 번 옮겼다가 번들 누출 검사에 여섯 줄이 걸렸다.
import { createRoot } from 'react-dom/client'
import { HostTools, type AuditRow } from './HostTools'
import type { DashboardRow, LinkStatus, SuspicionRow } from '../../../shared/reveal/dashboard'
import type { RoleId } from '../../../shared/missions/roleNames'

const NAMES = ['한겨울', '서리', '눈보라', '고드름', '진눈깨비', '싸락']
const ROLES: RoleId[] = ['librarian', 'guard', 'accuser', 'liar', 'witness', 'mediator']

const rows: DashboardRow[] = NAMES.map((name, i) => ({
  playerId: `p${i}`,
  name,
  role: ROLES[i],
  hintDay: [1, null, 3, 4, 2, null][i],
  reveal: i % 3 === 0 ? { scope: i === 0 ? 'class' : 'private', atMs: Date.UTC(2026, 2, 4, 5, 30), listeners: i === 0 ? 13 : 1 } : null,
  exactHits: [0, 2, 1, 0, 3, 0][i],
  invisibleDays: i === 4 ? [3] : [],
  awakened: i % 2 === 1,
  exposure: (['byDeduction', 'onlyByOwnReveal', 'possible', 'possible', 'possible', 'onlyByOwnReveal'] as const)[i],
}))

const links: LinkStatus[] = [
  { id: 'a', leftLabel: '왼쪽 조각 하나', rightLabel: 'DAY 5 기록', leftOpen: true, rightOpen: true, connectable: true, conclusion: '이어지면 나오는 결론 자리.' },
  { id: 'b', leftLabel: '왼쪽 조각 둘', rightLabel: 'DAY 4 기록', leftOpen: false, rightOpen: true, connectable: false, conclusion: '아직 못 잇는 결론 자리.' },
  { id: 'c', leftLabel: 'DAY 4 조각', rightLabel: 'DAY 5 조각', leftOpen: true, rightOpen: true, connectable: true, conclusion: '이어지면 나오는 결론 자리.' },
  { id: 'd', leftLabel: '왼쪽 조각 넷', rightLabel: 'DAY 2 조각', leftOpen: false, rightOpen: true, connectable: false, conclusion: '아직 못 잇는 결론 자리.' },
]

const suspicion: SuspicionRow[] = NAMES.map((name, i) => ({
  playerId: `p${i}`,
  name,
  received: [5, 3, 3, 1, 0, 0][i],
}))

const audit: AuditRow[] = [
  { source: 'secret', where: '검수용', text: '태그가 없는 문장은 맨 위에 경고로 뜬다.', tag: null, places: [] },
  { source: 'opening', where: '오프닝', text: '시간 무관 문장 자리입니다.', tag: 'anytime', places: [] },
  { source: 'fragment', where: 'DAY 1', text: '학기 중 문장 자리. 도서관 창가 자리 이야기입니다.', tag: 'term', places: ['도서관'] },
  { source: 'secret', where: '편지', text: '16:50 문장 자리. 창고 앞에서 기다리겠다고 적었습니다.', tag: 't1650', places: ['창고'] },
  { source: 'secret', where: '고발자', text: '17:10 문장 자리. 단톡방에 올렸습니다.', tag: 't1710', places: ['단톡방'] },
]

const TIME_LABELS: Record<string, string> = {
  term: '학기 중', t1650: '16:50', t1700: '17:00', t1710: '17:10', t1730: '17:30',
  t1800: '18:00', t1900: '19:00', t2100: '21:00', nextDay: '다음 날', anytime: '시간 무관',
}
const SOURCE_LABELS: Record<string, string> = {
  opening: '오프닝', fragment: 'A의 기록', secret: '숨긴 사실', memory: 'A의 기억',
  sight: 'A의 시선', aftermath: '그날의 전말', torn: '찢긴 한 장', commonEnding: '공동 엔딩',
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <HostTools
      rules={[
        '운영자 수칙 첫 줄 자리. 진짜 문장은 서버가 내려보낸다.',
        '운영자 수칙 둘째 줄 자리.',
        '운영자 수칙 셋째 줄 자리.',
      ]}
      rows={rows}
      links={links}
      suspicion={suspicion}
      audit={audit}
      timeLabels={TIME_LABELS}
      sourceLabels={SOURCE_LABELS}
      players={NAMES.map((name, i) => ({ id: `p${i}`, name }))}
      onNotice={(t, to) => console.log('notice', to, t)}
    />,
  )
}
