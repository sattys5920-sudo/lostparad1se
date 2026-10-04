// 순위 — 운영자 화면 「이력」 탭 맨 위. 심부름 · 걸음 · 문제 · 쪽지 발견을
// 5 등까지. 같은 수면 같은 등수다. **서버가 센다**(hostRanks).
import { useCallback, useEffect, useState } from "react";

import type { RankRow } from "../../../shared/rules/ranks";
import type { GameActions } from "../game/useGame";

interface Ranks {
  errands: RankRow[];
  steps: RankRow[];
  quizzes: RankRow[];
  notes: RankRow[];
}

const BOARDS: {
  key: keyof Ranks;
  title: string;
  unit: string;
  note?: string;
}[] = [
  { key: "errands", title: "심부름 많이 한", unit: "번" },
  {
    key: "steps",
    title: "많이 걸은",
    unit: "걸음",
    note: "멈춘 자리를 가장 짧은 길로 이은 추정치",
  },
  { key: "quizzes", title: "문제 많이 푼", unit: "개" },
  {
    key: "notes",
    title: "쪽지 많이 발견한",
    unit: "장",
    note: "한 장마다 처음 주운 사람",
  },
];

export function RankDesk({
  act,
  onSaid,
}: {
  act: GameActions;
  onSaid: (t: string) => void;
}) {
  const [ranks, setRanks] = useState<Ranks | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setRanks((await act.hostRanks()) as Ranks);
    } catch (e) {
      onSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [act, onSaid]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="sc-rk">
        {BOARDS.map((b) => {
          const rows = ranks?.[b.key] ?? [];
          return (
            <div key={b.key} className="sc-rk__board">
              <h3>{b.title} 순위</h3>
              {b.note && <p className="sc-rk__note">{b.note}</p>}
              {!ranks ? (
                <p className="sc-ad__hint">세는 중…</p>
              ) : rows.length === 0 ? (
                <p className="sc-ad__hint">아직 없다.</p>
              ) : (
                <ol className="sc-rk__list">
                  {rows.map((r) => (
                    <li key={r.name}>
                      <span className="sc-rk__rank">{r.rank} 등</span>
                      <span className="sc-rk__who">{r.name}</span>
                      <span className="sc-rk__n">
                        {r.score.toLocaleString("ko-KR")} {b.unit}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <button disabled={busy} onClick={() => void load()}>
        {busy ? "세는 중…" : "다시 세기"}
      </button>
    </>
  );
}
