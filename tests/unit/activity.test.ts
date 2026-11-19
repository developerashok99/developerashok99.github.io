import { describe, expect, it } from "vitest";
import { add, dayTotal, merge, points, prune, shiftDay, streak, weekOf, weekPoints, type Activity } from "../../src/lib/activity";

/** a day where one device earned `p` points (as answered questions), with goal g */
const day = (p: number, g = 10) => ({ dev: { q: p, g } });

describe("points", () => {
  it("counts answers, right answers, practice, lessons and listening time", () => {
    expect(points({ c: 3, q: 4, r: 2, x: 1, i: 2, l: 1, s: 600 })).toBe(3 + 4 + 2 + 2 + 4 + 5 + 5);
    expect(points(undefined)).toBe(0);
    expect(points({ q: -5 })).toBe(0);
  });
});

describe("days and weeks", () => {
  it("shifts days across month ends and finds the Monday of the week", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekOf("2026-11-19")).toBe("2026-11-16"); // a Thursday
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    expect(weekOf("2026-11-22")).toBe("2026-11-16"); // Sunday ends the week
  });
});

describe("add and merge", () => {
  it("adds to one device's counts without touching another's", () => {
    let a: Activity = {};
    a = add(a, "2026-11-19", "phone", { c: 2 });
    a = add(a, "2026-11-19", "phone", { c: 1, q: 1 }, 30);
    a = add(a, "2026-11-19", "laptop", { q: 3 });
    expect(a["2026-11-19"]).toEqual({ phone: { c: 3, q: 1, g: 30 }, laptop: { q: 3 } });
    expect(dayTotal(a, "2026-11-19").points).toBe(7);
  });

  it("merging two devices' copies never loses or doubles points", () => {
    const phone: Activity = { "2026-11-19": { phone: { c: 5 }, laptop: { q: 2 } } };
    const server: Activity = { "2026-11-19": { laptop: { q: 4 } }, "2026-11-18": { laptop: { c: 1 } } };
    const m = merge(phone, server);
    expect(m).toEqual({ "2026-11-19": { phone: { c: 5 }, laptop: { q: 4 } }, "2026-11-18": { laptop: { c: 1 } } });
    expect(merge(m, phone)).toEqual(m);
    expect(merge(m, server)).toEqual(m);
  });

  it("ignores damaged data", () => {
    expect(merge({ "not a day": { a: { c: 1 } }, "2026-11-19": { a: "x", b: { c: "1", q: 2 } } }, 7)).toEqual({ "2026-11-19": { b: { q: 2 } } });
  });

  it("keeps only the recent days", () => {
    expect(Object.keys(prune({ "2026-01-01": day(1), "2026-11-18": day(1) }, "2026-11-19", 70))).toEqual(["2026-11-18"]);
  });
});

describe("streak", () => {
  const T = "2026-11-19"; // Thursday
  it("counts days in a row that reached the goal; today adds once reached", () => {
    const a: Activity = { "2026-11-16": day(12), "2026-11-17": day(10), "2026-11-18": day(15), [T]: day(3) };
    const s = streak(a, T, 10);
    expect(s.current).toBe(3);
    expect(s.todayMet).toBe(false);
    expect(s.week.at(-1)).toMatchObject({ day: T, state: "today", points: 3 });
    expect(streak({ ...a, [T]: day(10) }, T, 10).current).toBe(4);
  });

  it("forgives one missed day a week, but not two", () => {
    const one: Activity = { "2026-11-16": day(10), "2026-11-18": day(10) };
    const s = streak(one, T, 10);
    expect(s.current).toBe(2);
    expect(s.freezeUsed).toBe(true);
    expect(s.week.find((d) => d.day === "2026-11-17")?.state).toBe("frozen");
    const two: Activity = { "2026-11-16": day(10), "2026-11-19": day(0) };
    expect(streak({ ...two, "2026-11-15": day(10) }, T, 10).current).toBe(0);
  });

  it("judges each past day by the goal in force that day", () => {
    const a: Activity = { "2026-11-17": day(15, 15), "2026-11-18": day(15, 15) };
    expect(streak(a, T, 50).current).toBe(2);
  });

  it("remembers the best streak and adds up this week's points", () => {
    const a: Activity = { "2026-11-10": day(10), "2026-11-11": day(10), "2026-11-12": day(10), "2026-11-17": day(10), [T]: day(4) };
    const s = streak(a, T, 10);
    expect(s.best).toBe(3);
    expect(weekPoints(a, T)).toBe(14);
  });
});
