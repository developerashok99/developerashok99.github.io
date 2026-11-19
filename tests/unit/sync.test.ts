import { describe, expect, it } from "vitest";
import { authMessage, initials, mergeValues, nameFromEmail, reconcile, summarize } from "../../src/lib/sync";

const K = ["mls.completed", "mls.bookmarks", "mls.recent", "mls.reading", "mls.srs", "mls.quiz"];

describe("reconcile", () => {
  it("first sign-in with an empty account uploads this device's progress", () => {
    const r = reconcile({ data: { "mls.completed": ["day01"] }, at: {} }, { data: {}, at: {} }, K);
    expect(r.merged.data["mls.completed"]).toEqual(["day01"]);
    expect(r.remoteChanged).toBe(true);
    expect(r.localChanged).toEqual([]);
  });

  it("first sign-in on a second device joins both devices' progress instead of replacing it", () => {
    const r = reconcile(
      { data: { "mls.completed": ["day02"], "mls.reading": { "day01/simple": 0.9 } }, at: {} },
      { data: { "mls.completed": ["day01"], "mls.reading": { "day01/simple": 0.4, "day03/simple": 1 } }, at: { "mls.completed": 100, "mls.reading": 100 } },
      K,
    );
    expect(r.merged.data["mls.completed"]).toEqual(["day01", "day02"]);
    expect(r.merged.data["mls.reading"]).toEqual({ "day01/simple": 0.9, "day03/simple": 1 });
    expect(r.localChanged).toEqual(["mls.completed", "mls.reading"]);
    expect(r.remoteChanged).toBe(true);
  });

  it("after that, the newer change wins, so un-completing a lesson sticks", () => {
    const r = reconcile(
      { data: { "mls.completed": ["day01"] }, at: { "mls.completed": 500 } },
      { data: { "mls.completed": ["day01", "day02"] }, at: { "mls.completed": 200 } },
      K,
    );
    expect(r.merged.data["mls.completed"]).toEqual(["day01"]);
    expect(r.remoteChanged).toBe(true);
    expect(r.localChanged).toEqual([]);
  });

  it("a newer change on another device comes down to this one", () => {
    const r = reconcile(
      { data: { "mls.bookmarks": ["day01"] }, at: { "mls.bookmarks": 100 } },
      { data: { "mls.bookmarks": ["day05", "day01"] }, at: { "mls.bookmarks": 300 } },
      K,
    );
    expect(r.merged.data["mls.bookmarks"]).toEqual(["day05", "day01"]);
    expect(r.localChanged).toEqual(["mls.bookmarks"]);
    expect(r.remoteChanged).toBe(false);
  });

  it("nothing to do when both sides match", () => {
    const side = { data: { "mls.completed": ["day01"] }, at: { "mls.completed": 100 } };
    const r = reconcile(side, structuredClone(side), K);
    expect(r.localChanged).toEqual([]);
    expect(r.remoteChanged).toBe(false);
  });

  it("Reset progress on one device clears it on the account too", () => {
    const r = reconcile({ data: {}, at: { "mls.completed": 900 } }, { data: { "mls.completed": ["day01"] }, at: { "mls.completed": 100 } }, K);
    expect(r.merged.data["mls.completed"]).toBeNull();
    expect(r.remoteChanged).toBe(true);
  });

  it("and the other device then clears it as well", () => {
    const r = reconcile({ data: { "mls.completed": ["day01"] }, at: { "mls.completed": 100 } }, { data: { "mls.completed": null }, at: { "mls.completed": 900 } }, K);
    expect(r.merged.data["mls.completed"]).toBeNull();
    expect(r.localChanged).toEqual(["mls.completed"]);
  });
});

describe("mergeValues", () => {
  it("recent activity keeps one entry per lesson, newest first", () => {
    const out = mergeValues(
      "mls.recent",
      [{ id: "a", at: 5 }, { id: "b", at: 1 }],
      [{ id: "a", at: 2 }, { id: "c", at: 3 }],
    ) as { id: string; at: number }[];
    expect(out.map((x) => `${x.id}${x.at}`)).toEqual(["a5", "c3", "b1"]);
  });

  it("flashcards and quiz answers keep the newer entry", () => {
    expect(mergeValues("mls.quiz", { q1: { at: 9, last: "right" } }, { q1: { at: 3, last: "wrong" }, q2: { at: 1, last: "right" } }))
      .toEqual({ q1: { at: 9, last: "right" }, q2: { at: 1, last: "right" } });
    expect(mergeValues("mls.srs", { c: { due: 10, ivl: 3 } }, { c: { due: 50, ivl: 21 } })).toEqual({ c: { due: 50, ivl: 21 } });
  });
});

describe("profile summary and names", () => {
  it("counts lessons, learned cards and right answers", () => {
    const s = summarize("Ravi", {
      "mls.completed": ["day01", "day02"],
      "mls.srs": { a: { ivl: 30 }, b: { ivl: 2 } },
      "mls.quiz": { q1: { last: "right" }, q2: { last: "wrong" } },
      "mls.recent": [{ id: "day02", title: "Day 2", href: "/lessons/day02/", at: 1 }],
    }, 42);
    expect(s).toMatchObject({ name: "Ravi", completed: 2, cardsLearned: 1, quizRight: 1, lastTitle: "Day 2", lastHref: "/lessons/day02/", updated: 42 });
  });

  it("makes a friendly name and initials", () => {
    expect(nameFromEmail("ravi.kumar99@gmail.com")).toBe("Ravi Kumar");
    expect(nameFromEmail("123@x.com")).toBe("Learner");
    expect(initials("Ravi Kumar")).toBe("RK");
    expect(initials("ashok")).toBe("A");
  });

  it("explains sign-in errors in plain words", () => {
    expect(authMessage("auth/invalid-credential")).toMatch(/don't match/);
    expect(authMessage("auth/network-request-failed")).toMatch(/connection/);
    expect(authMessage("something-else")).toMatch(/Try again/);
    expect(authMessage("auth/configuration-not-found")).toMatch(/isn't switched on yet/);
  });
});

describe("study activity sync", () => {
  it("joins both devices' activity instead of the newer one replacing the other", () => {
    const local = { data: { "mls.activity": { "2026-11-19": { phone: { c: 4 } } } }, at: { "mls.activity": 200 } };
    const remote = { data: { "mls.activity": { "2026-11-19": { laptop: { q: 3 } } } }, at: { "mls.activity": 100 } };
    const r = reconcile(local, remote, ["mls.activity"]);
    expect(r.merged.data["mls.activity"]).toEqual({ "2026-11-19": { phone: { c: 4 }, laptop: { q: 3 } } });
    expect(r.localChanged).toEqual(["mls.activity"]);
    expect(r.remoteChanged).toBe(true);
    // the other device, syncing later, ends up with the same
    const r2 = reconcile({ data: { "mls.activity": { "2026-11-19": { laptop: { q: 5 } } } }, at: { "mls.activity": 150 } }, r.merged, ["mls.activity"]);
    expect(r2.merged.data["mls.activity"]).toEqual({ "2026-11-19": { phone: { c: 4 }, laptop: { q: 5 } } });
  });

  it("puts the streak and this week's points in the friends summary", () => {
    const now = new Date(2026, 10, 19, 12).getTime();
    const s = summarize("Ravi", { "mls.activity": { "2026-11-18": { a: { q: 30, g: 30 } }, "2026-11-19": { a: { q: 31 } } } }, now);
    expect(s).toMatchObject({ streak: 2, weekPoints: 61, week: "2026-11-16", todayPoints: 31 });
  });
});
