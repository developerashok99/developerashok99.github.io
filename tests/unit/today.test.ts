import { describe, expect, it } from "vitest";
import { interleave, minutes, plan } from "../../src/lib/today";

describe("today's session", () => {
  it("mixes due cards, a few new cards, old mistakes and weak-lesson questions", () => {
    const steps = plan({ dueCards: ["c1", "c2"], freshCards: ["n1", "n2", "n3", "n4"], newLeft: 2, mistakes: ["m1"], weak: ["m1", "w1", "w2"] });
    expect(steps.map((s) => s.id)).toEqual(["c1", "m1", "w1", "c2", "w2", "n1", "n2"]);
    expect(steps.filter((s) => s.kind === "card" && s.fresh).length).toBe(2);
    expect(steps.find((s) => s.id === "m1")).toEqual({ kind: "question", id: "m1", why: "mistake" });
  });

  it("respects the limits and today's new-card allowance", () => {
    const many = (p: string) => Array.from({ length: 30 }, (_, i) => `${p}${i}`);
    const steps = plan({ dueCards: many("d"), freshCards: many("f"), newLeft: 0, mistakes: many("m"), weak: many("w") });
    expect(steps.filter((s) => s.kind === "card").length).toBe(10);
    expect(steps.filter((s) => s.kind === "question").length).toBe(10);
    expect(minutes(steps)).toBe(13);
    expect(plan({ dueCards: [], freshCards: [], newLeft: 5, mistakes: [], weak: [] })).toEqual([]);
  });

  it("interleaves lists of different lengths", () => {
    expect(interleave([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });
});
