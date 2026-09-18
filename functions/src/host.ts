// 누가 운영자인가 — 한 군데서 본다.
//
// 이 검사가 **일곱 군데에 따로 적혀 있었다.** 로비·책상·자리·계정·
// 문제·페이즈·시계가 각각 제 것을 들고 있었고, 그래서 검사를 조금
// 조이려면 일곱 군데를 다 찾아 고쳐야 했다. 하나라도 놓치면 그 한 곳이
// 그대로 뒷문이다.
//
// 조여야 할 이유가 실제로 생겼다. 옛 문지기는 **로그인한 계정 uid 에**
// 운영자 표시를 박았다(claimHost). 지금 운영자는 계정이 아니라 고정된
// uid 하나지만, 그 시절에 코드를 맞힌 계정에는 표시가 남아 있었고,
// 로그인할 때마다 증표에 따라붙었다.
//
// 지금은 표시만 본다. 붙이는 곳이 문지기 하나뿐이고 거기서는 HOST_UID
// 에만 붙이므로, 표시가 참이면 uid 는 host 다. **uid 까지 보게 하려면
// 아래 한 줄이면 된다** — 다만 켜는 순간 에뮬레이터용 스크립트
// 마흔넷이 전부 막힌다. 그것들은 아무 uid 에 표시만 박아서 들어온다.
import { HttpsError } from 'firebase-functions/v2/https'

/** 운영자의 uid. **계정이 아니다** — 가입도 아바타도 없다. */
export const HOST_UID = 'host'

/**
 * 운영자가 아니면 여기서 멈춘다. 맞으면 그 uid 를 돌려준다.
 *
 * 더 조이려면 `&& auth.uid === HOST_UID` 를 붙인다.
 */
export function requireHost(auth: { uid?: string; token?: Record<string, unknown> } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요하다.')
  if (auth.token?.admin !== true) {
    throw new HttpsError('permission-denied', '운영자만 할 수 있다.')
  }
  return auth.uid
}
