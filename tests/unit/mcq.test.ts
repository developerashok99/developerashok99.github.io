import { describe, expect, it } from "vitest";
import { buildTest, checkDraft, mark, textToHtml, type Mcq } from "../../src/lib/mcq";

const seeded = (seed = 3) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const q = (id: string, lid: string, a = 0, d = "Foundations"): Mcq => ({ id, q: id, o: ["x", "y"], a, e: "", lid, l: lid, s: "s", d, href: "" });
// lesson A has 30 questions, B and C have 2 each
const pool = [...Array.from({ length: 30 }, (_, i) => q(`a${i}`, "A")), q("b0", "B"), q("b1", "B"), q("c0", "C"), q("c1", "C")];

describe("MCQ tests", () => {
  it("builds a test of the right size with no repeats, spread across lessons", () => {
    const t = buildTest(pool, 6, new Set(), seeded());
    expect(t).toHaveLength(6);
    expect(new Set(t.map((x) => x.id)).size).toBe(6);
    // round-robin: B and C both appear even though A has most questions
    expect(t.some((x) => x.lid === "B")).toBe(true);
    expect(t.some((x) => x.lid === "C")).toBe(true);
    expect(buildTest(pool.slice(0, 3), 10, new Set(), seeded())).toHaveLength(3);
  });

  it("brings back questions you got wrong, up to a third of the test", () => {
    const wrong = new Set(["a1", "a2", "a3", "a4", "a5"]);
    const t = buildTest(pool, 9, wrong, seeded(5));
    expect(t.filter((x) => wrong.has(x.id)).length).toBeGreaterThanOrEqual(3);
  });

  it("marks a test, unanswered as wrong, weakest section first, 70% to pass", () => {
    const qs = [q("1", "A", 0, "Core"), q("2", "A", 1, "Core"), q("3", "B", 0, "DataWeave"), q("4", "B", 0, "DataWeave")];
    const m = mark(qs, { "1": 0, "2": 1, "3": 1 });
    expect(m).toMatchObject({ right: 2, total: 4, percent: 50, passed: false });
    expect(m.sections[0]).toMatchObject({ title: "DataWeave", right: 0, total: 2 });
    expect(mark(qs, { "1": 0, "2": 1, "3": 0 }).passed).toBe(true);
  });

  it("checks a friend's question in plain words", () => {
    const ok = { q: "What does the Choice router do?", options: ["Routes by condition", "Sends to all routes", "", ""], answer: 0, explain: "", lid: "" };
    expect(checkDraft(ok)).toBe("");
    expect(checkDraft({ ...ok, q: "short" })).toMatch(/at least 10/);
    expect(checkDraft({ ...ok, options: ["only one", "", "", ""] })).toMatch(/two options/);
    expect(checkDraft({ ...ok, options: ["a", "", "c", ""] })).toMatch(/without gaps/);
    expect(checkDraft({ ...ok, options: ["Same", "same", "", ""] })).toMatch(/same/);
    expect(checkDraft({ ...ok, answer: 3 })).toMatch(/Choose which/);
  });

  it("shows friends' text safely, with code marks", () => {
    expect(textToHtml('<b>x</b> uses `vars.id` & "y"')).toBe("&lt;b&gt;x&lt;/b&gt; uses <code>vars.id</code> &amp; &quot;y&quot;");
  });
});
