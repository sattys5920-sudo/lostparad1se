import { describe, expect, it } from "vitest";

import { DOOR_CELLS } from "./blocked";
import { STAIRWELLS, floorOfCell, isHallCell } from "./board";
import { topRanks, walkDistance, walkable, walkedCells } from "./ranks";

describe("topRanks", () => {
  const names: Record<string, string> = {
    a: "가",
    b: "나",
    c: "다",
    d: "라",
    e: "마",
    f: "바",
    g: "사",
  };
  const nameOf = (id: string) => names[id] ?? null;

  it("많은 순으로 5 등까지, 같은 수는 같은 등수", () => {
    const out = topRanks(
      new Map([
        ["a", 9],
        ["b", 7],
        ["c", 7],
        ["d", 5],
        ["e", 3],
        ["f", 3],
        ["g", 1],
      ]),
      nameOf,
    );
    expect(out.map((r) => [r.name, r.score, r.rank])).toEqual([
      ["가", 9, 1],
      ["나", 7, 2],
      ["다", 7, 2],
      ["라", 5, 4],
      ["마", 3, 5],
      ["바", 3, 5],
    ]);
  });

  it("0 번과 명단에 없는 사람은 빠진다", () => {
    const out = topRanks(
      new Map([
        ["a", 0],
        ["zz", 4],
        ["b", 1],
      ]),
      nameOf,
    );
    expect(out).toEqual([{ name: "나", score: 1, rank: 1 }]);
  });
});

describe("걸음 수", () => {
  it("문은 지나갈 수 있다", () => {
    for (const d of DOOR_CELLS) expect(walkable(d.x, d.y)).toBe(true);
  });

  it("같은 자리면 0, 이어 걸으면 더한다", () => {
    const dist = walkDistance();
    const a = { x: 14, y: 24 };
    expect(dist(a, a)).toBe(0);
    const b = { x: 14, y: 26 };
    expect(dist(a, b)).toBe(2);
    expect(walkedCells([a, b, a], dist)).toBe(4);
  });

  it("방에서 복도로는 문을 거쳐 간다 — 가로세로 거리보다 짧을 수 없다", () => {
    const dist = walkDistance();
    const inside = { x: 12, y: 22 };
    const hall = { x: 18, y: 30 };
    expect(isHallCell(hall.x, hall.y)).toBe(true);
    expect(dist(inside, hall)).toBeGreaterThanOrEqual(6 + 8);
  });

  it("층을 바꾸면 계단통까지 걸은 만큼 센다", () => {
    const dist = walkDistance();
    const s1 = STAIRWELLS[0];
    const s2 = STAIRWELLS.find(
      (s) => s.floor !== s1.floor,
    ) as (typeof STAIRWELLS)[number];
    const a = { x: s1.plan.x, y: s1.plan.y };
    const b = { x: s2.plan.x, y: s2.plan.y };
    expect(floorOfCell(a.x, a.y)).not.toBe(floorOfCell(b.x, b.y));
    expect(dist(a, b)).toBe(0);
  });
});
