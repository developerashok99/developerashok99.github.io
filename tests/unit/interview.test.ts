import { describe, expect, it } from "vitest";
import { lastRatings, pickQuestions, scoreOf, verdict, weight } from "../../src/lib/interview";

const pool = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}` }));
/** a repeatable stand-in for Math.random */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("mock interview", () => {
  it("picks the number asked for, with no repeats", () => {
    const got = pickQuestions(pool, 10, new Map(), true, seeded());
    expect(got).toHaveLength(10);
    expect(new Set(got.map((q) => q.id)).size).toBe(10);
    expect(pickQuestions(pool.slice(0, 3), 10, new Map(), true, seeded())).toHaveLength(3);
  });

  it("with focus on hard questions, missed ones come up far more often than nailed ones", () => {
    const last = new Map([["q0", 0], ["q1", 2]]);
    let missed = 0, nailed = 0;
    const rnd = seeded(7);
    for (let i = 0; i < 400; i++) {
      const ids = pickQuestions(pool, 3, last, true, rnd).map((q) => q.id);
      if (ids.includes("q0")) missed++;
      if (ids.includes("q1")) nailed++;
    }
    expect(missed).toBeGreaterThan(nailed * 3);
    expect(weight(undefined, false)).toBe(1);
  });

  it("remembers the latest rating of each question", () => {
    const last = lastRatings([{ at: 2, ratings: { a: 2 } }, { at: 1, ratings: { a: 0, b: 1 } }]);
    expect(last.get("a")).toBe(2);
    expect(last.get("b")).toBe(1);
  });

  it("scores nailed as full marks and partly as half", () => {
    expect(scoreOf([2, 2, 1, 0])).toEqual({ percent: 63, nailed: 2, partly: 1, missed: 1 });
    expect(scoreOf([]).percent).toBe(0);
    expect(verdict(90)).toMatch(/ready/);
    expect(verdict(10)).toMatch(/Early days/);
  });
});
