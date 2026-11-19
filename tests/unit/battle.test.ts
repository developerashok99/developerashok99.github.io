import { describe, expect, it } from "vitest";
import { readBattleMsg, score, standings } from "../../src/lib/battle";

describe("quiz battle", () => {
  it("scores right answers with a speed bonus", () => {
    expect(score(false, 20_000)).toBe(0);
    expect(score(true, 20_000)).toBe(1000);
    expect(score(true, 10_000)).toBe(750);
    expect(score(true, 0)).toBe(500);
    expect(score(true, 99_999)).toBe(1000);
  });

  it("ranks by score, keeping join order for ties", () => {
    const p = (id: string, s: number) => ({ id, name: id, score: s });
    expect(standings([p("a", 500), p("b", 900), p("c", 500)]).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("accepts well-formed messages and drops anything else", () => {
    expect(readBattleMsg({ t: "ans", i: 2, k: 1 })).toEqual({ t: "ans", i: 2, k: 1 });
    expect(readBattleMsg({ t: "ans", i: 2, k: 99 })).toBeNull();
    expect(readBattleMsg({ t: "hello", name: "Sita" })).toEqual({ t: "hello", name: "Sita" });
    expect(readBattleMsg({ t: "hello", name: "" })).toBeNull();
    expect(readBattleMsg({ t: "reveal", i: 0, a: 2, players: [{ id: "x", name: "Ravi", score: 750, last: { k: 2, right: true, pts: 750 } }] }))
      .toEqual({ t: "reveal", i: 0, a: 2, players: [{ id: "x", name: "Ravi", score: 750, last: { k: 2, right: true, pts: 750 } }] });
    expect(readBattleMsg({ t: "end", players: [{ id: "x", name: "Ravi", score: -1 }] })).toBeNull();
    expect(readBattleMsg({ t: "q", i: 0, id: "quiz-day01:a", left: 20_000 })).toMatchObject({ t: "q", id: "quiz-day01:a" });
    expect(readBattleMsg("play")).toBeNull();
    expect(readBattleMsg({ t: "hack" })).toBeNull();
  });
});
