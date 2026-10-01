// 문 하나.
//
// **플레이어와 운영자가 같은 주소로 들어온다.** 전에는 운영자가
// admin.html 이라는 딴 페이지였다. 주소를 아는 사람만 찾아가는 문은
// 문이 아니라 뒷길이고, 로그인이라는 같은 일을 두 벌로 짜게 된다.
//
// 갈리는 자리는 여기 한 곳이다 — 증표에 운영자 표시가 있으면 책상,
// 없으면 게임. 표시를 붙이는 것은 서버고, 이 화면은 보기만 한다.
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'

import { auth } from '../firebase'
import { Play } from './game/Play'
import { Admin } from './admin/Admin'

export function Root() {
  const [ready, setReady] = useState(false)
  const [host, setHost] = useState(false)

  useEffect(() => {
    if (!auth) {
      setReady(true)
      return
    }
    return onAuthStateChanged(auth, (u) => {
      if (!u) {
        setHost(false)
        setReady(true)
        return
      }
      void u
        .getIdTokenResult()
        .then((t) => setHost(t.claims.admin === true))
        .catch(() => setHost(false))
        .finally(() => setReady(true))
    })
  }, [])

  if (!ready) return null
  /*
   * 껍데기 클래스가 다르다. sc-pl-root 는 게임 화면의 틀(전체 높이를
   * 쓰고 페이지가 안 구른다)이라, 길게 구르는 운영자 책상에 씌우면
   * 아래가 잘린다.
   */
  return host ? (
    <div className="school-root">
      <Admin />
    </div>
  ) : (
    <div className="school-root sc-pl-root">
      <Play />
    </div>
  )
}
