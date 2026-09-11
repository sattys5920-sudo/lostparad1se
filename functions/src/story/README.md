# 서버 전용 이야기 데이터

이 폴더의 문장은 **절대 클라이언트 번들에 들어가면 안 된다.**

- `src/` 에서 이 폴더를 import 하지 않는다. `scripts/check-bundle.ts` 가 CI에서 막는다.
- 화면에는 서버가 공개 시각을 확인한 뒤 Firestore 문서로 내려보낸 것만 보인다.
- 공개 시각 전에는 어떤 API로도 내려가지 않는다. 날짜를 건너뛴 요청도 서버가 막는다.

문장은 기준 문서에서 한 글자도 바꾸지 않고 옮긴다. 우선순위는
`scenario_reveal.md` > `otherworld_setting.md` > `personal_missions_v3.md` > `team_rules_v2.md`.
