// 순위 — 운영자만. 심부름 많이 한 · 많이 걸은 · 문제 많이 푼 · 쪽지 많이 발견한
// 사람을 5 등까지. 셈은 shared/rules/ranks.
//
//   심부름   기록의 errandDone
//   문제     기록의 quizSolved — 한 장은 먼저 맞힌 한 사람 것이다
//   쪽지     운영자가 뿌린 56장 가운데, 한 장마다 **처음 주운 사람**(이력의 「발견」)
//   걸음     멈춘 자리(qa 로그의 standAt)를 가장 짧은 길로 이은 칸 수 — 추정
//
// **참가자 쪽 어떤 응답에도 안 실린다.** 수만 싣고 쪽지 주인은 안 싣는다.
import { onCall } from "firebase-functions/v2/https";

import {
  RANK_LIMIT,
  topRanks,
  walkDistance,
  walkedCells,
} from "../../shared/rules/ranks";
import type { GameRecord } from "../../shared/rules/records";
import type { GameDoc } from "../../shared/model";
import type { SlipDoc } from "./slips";
import { qaLogOf } from "./qaLog";
import { gameRef } from "./index";
import { requireHost } from "./host";

const bump = (m: Map<string, number>, id: string | undefined, by = 1) => {
  if (id) m.set(id, (m.get(id) ?? 0) + by);
};

export const hostRanks = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth);
  const { gameId } = req.data;
  const ref = gameRef(gameId);
  const records = ref.collection("secret").doc("records").collection("items");
  const [gameSnap, done, solved, takes, slips, stops] = await Promise.all([
    ref.get(),
    records.where("kind", "==", "errandDone").get(),
    records.where("kind", "==", "quizSolved").get(),
    records.where("kind", "==", "slipTake").get(),
    ref.collection("secret").doc("slips").collection("items").get(),
    qaLogOf(gameId)
      .where("kind", "==", "standAt")
      .select("playerId", "atMs", "detail")
      .get(),
  ]);
  const game = gameSnap.data() as GameDoc | undefined;
  const names = new Map((game?.seats ?? []).map((s) => [s.playerId, s.name]));
  const nameOf = (id: string) => names.get(id) ?? null;

  const errands = new Map<string, number>();
  for (const d of done.docs) bump(errands, (d.data() as GameRecord).actorId);

  // 같은 종이를 두 번 맞힐 일은 없지만, 기록이 겹쳐도 한 장으로 센다
  const quizzes = new Map<string, number>();
  const seenQuiz = new Set<string>();
  for (const d of solved.docs) {
    const r = d.data() as GameRecord;
    const key = r.subjectId ?? d.id;
    if (seenQuiz.has(key)) continue;
    seenQuiz.add(key);
    bump(quizzes, r.actorId);
  }

  const noteIds = new Set(
    slips.docs.filter((d) => (d.data() as SlipDoc).noteId).map((d) => d.id),
  );
  const firstTake = new Map<string, GameRecord>();
  for (const d of takes.docs) {
    const r = d.data() as GameRecord;
    if (!r.subjectId || !noteIds.has(r.subjectId)) continue;
    const was = firstTake.get(r.subjectId);
    if (!was || r.atMs < was.atMs) firstTake.set(r.subjectId, r);
  }
  const notes = new Map<string, number>();
  for (const r of firstTake.values()) bump(notes, r.actorId);

  const byPlayer = new Map<string, { atMs: number; x: number; y: number }[]>();
  for (const d of stops.docs) {
    const r = d.data() as {
      playerId?: string;
      atMs?: number;
      detail?: { x?: number; y?: number };
    };
    const x = r.detail?.x;
    const y = r.detail?.y;
    if (!r.playerId || typeof x !== "number" || typeof y !== "number") continue;
    const list = byPlayer.get(r.playerId) ?? [];
    list.push({ atMs: r.atMs ?? 0, x, y });
    byPlayer.set(r.playerId, list);
  }
  const dist = walkDistance();
  const steps = new Map<string, number>();
  for (const [id, list] of byPlayer) {
    if (!names.has(id)) continue;
    list.sort((a, b) => a.atMs - b.atMs);
    steps.set(id, walkedCells(list, dist));
  }

  return {
    limit: RANK_LIMIT,
    errands: topRanks(errands, nameOf),
    steps: topRanks(steps, nameOf),
    quizzes: topRanks(quizzes, nameOf),
    notes: topRanks(notes, nameOf),
  };
});
