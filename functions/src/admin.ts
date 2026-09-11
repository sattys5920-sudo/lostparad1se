// 운영자 전용 엔드포인트.
//
// 확인은 **전부 서버에서** 한다. 클라이언트가 「나 운영자야」라고 말하는
// 것을 믿지 않는다. 화면 쪽 비밀번호 검사도 쓰지 않는다.
//
// 여기 있는 것은 읽기뿐이다. 게임 상태를 바꾸는 기능은 넣지 않았다 —
// 투명인간 해제 같은 것은 기존 운영자 도구로만 한다.
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { CLUE_MAP, EXPOSURE_LABEL, HOST_RULES, LINKS } from './story/clues'
import { auditLines } from './story/audit'
import { SOURCE_LABEL, TIME_LABEL, placesIn } from './story/timeline'
import { checkNotice, NOTICE_TEMPLATES } from '../../shared/reveal/notice'

const db = getFirestore()

/** 커스텀 클레임으로만 통과한다. 토큰에 admin이 없으면 여기서 끝난다. */
function requireHost(auth: CallableRequest['auth']): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  if (auth.token?.admin !== true) {
    throw new HttpsError('permission-denied', '운영자만 볼 수 있다.')
  }
  return auth.uid
}

/**
 * 추리 지도.
 *
 * 표를 **보낸 사람은 담지 않는다.** 운영자에게도 보이지 않는다.
 * 추리 노트도 담지 않는다 — notes/{playerId}는 규칙이 본인 말고
 * 아무에게도 열어 주지 않고, 여기서 우회하지도 않는다.
 */
export const hostDashboard = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const gameId = req.data.gameId

  const snap = await db.doc(`games/${gameId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')

  return {
    rules: HOST_RULES,
    clues: CLUE_MAP.map((c) => ({
      role: c.role,
      inRecord: c.inRecord,
      byOthers: c.byOthers,
      exposure: c.exposure,
      exposureLabel: EXPOSURE_LABEL[c.exposure],
      note: c.note ?? null,
    })),
    links: LINKS.map((l) => ({
      id: l.id,
      left: l.left.label,
      right: l.right.label,
      conclusion: l.conclusion,
    })),
  }
})

/** 텍스트 검수. A에 관한 문장을 사건 시간순으로. */
export const hostTextAudit = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const lines = auditLines()
  return {
    timeLabels: TIME_LABEL,
    sourceLabels: SOURCE_LABEL,
    lines: lines.map((l) => ({
      source: l.source,
      where: l.where,
      text: l.text,
      tag: l.tag,
      places: placesIn(l.text),
    })),
    untaggedCount: lines.filter((l) => l.tag === null).length,
  }
})

/** 공지를 보낸다. 전원이면 toPlayerId를 비워 둔다. */
export const hostNotice = onCall<{ gameId: string; text: string; toPlayerId?: string | null }>(
  async (req) => {
    const uid = requireHost(req.auth)
    const check = checkNotice(req.data.text)
    if (!check.ok) throw new HttpsError('invalid-argument', '보낼 말을 확인해라.')

    const notice = {
      toPlayerId: req.data.toPlayerId ?? null,
      text: req.data.text.trim(),
      atMs: Date.now(),
      byId: uid,
    }
    const ref = await db.collection(`games/${req.data.gameId}/notices`).add(notice)
    return { id: ref.id, ...notice }
  },
)

/** 템플릿은 숨길 것이 없다. 화면이 목록을 그리는 데 쓴다. */
export const noticeTemplates = onCall(async (req) => {
  requireHost(req.auth)
  return { templates: NOTICE_TEMPLATES }
})
