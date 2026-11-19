import { describe, expect, it } from "vitest";
import { parseTime, plan } from "../../src/lib/reminder";

const st = (o: Partial<{ todayMet: boolean; current: number; todayPoints: number; goal: number }> = {}) => ({ todayMet: false, current: 0, todayPoints: 0, goal: 30, ...o });

describe("daily reminder", () => {
  it("reads the time, falling back to 19:00", () => {
    expect(parseTime("07:30")).toEqual([7, 30]);
    expect(parseTime("25:00")).toEqual([19, 0]);
    expect(parseTime(undefined)).toEqual([19, 0]);
  });

  it("reminds today with the points still needed, then on the next days", () => {
    const r = plan(new Date(2026, 10, 19, 9, 0), "19:00", st({ current: 4, todayPoints: 12 }));
    expect(r).toHaveLength(4);
    expect(r[0].at).toEqual(new Date(2026, 10, 19, 19, 0));
    expect(r[0].title).toBe("Keep your 4-day streak 🔥");
    expect(r[0].body).toContain("18 study points");
    expect(r[1].at).toEqual(new Date(2026, 10, 20, 19, 0));
    expect(new Set(r.map((x) => x.id)).size).toBe(4);
  });

  it("skips today once the goal is reached or the time has passed", () => {
    expect(plan(new Date(2026, 10, 19, 9, 0), "19:00", st({ todayMet: true }))[0].at).toEqual(new Date(2026, 10, 20, 19, 0));
    expect(plan(new Date(2026, 10, 19, 20, 0), "19:00", st())[0].at).toEqual(new Date(2026, 10, 20, 19, 0));
  });
});
