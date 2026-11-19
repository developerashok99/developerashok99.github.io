import { describe, expect, it } from "vitest";
import { EXAM_TOPICS, lessonMastery, readiness, topicMastery, weakestLessons } from "../../src/lib/mastery";

const lessons = [
  { id: "day15", label: "Day 15", title: "Errors", questions: 4, cards: 2 },
  { id: "day16", label: "Day 16", title: "Errors 2", questions: 4, cards: 0 },
  { id: "day44", label: "Day 44", title: "DW", questions: 2, cards: 2 },
];

describe("lesson mastery", () => {
  it("comes from right answers and firmly learned cards, out of everything the lesson has", () => {
    const m = lessonMastery(
      lessons,
      { "quiz-day15:a": { last: "right" }, "quiz-day15:b": { last: "wrong" }, "quiz-day16:a": { last: "right" } },
      { "day15:x": { ivl: 21 }, "day15:y": { ivl: 7 } },
    );
    // day15: 1 right + (1 + 1/3) card strength, out of 6
    expect(m.get("day15")).toEqual({ id: "day15", score: Math.round(((1 + 1 + 1 / 3) / 6) * 100), tried: 4, total: 6 });
    expect(m.get("day16")?.score).toBe(25);
    expect(m.get("day44")).toEqual({ id: "day44", score: null, tried: 0, total: 4 });
  });
});

describe("topics and readiness", () => {
  it("averages each exam topic's lessons, counting untried ones as 0", () => {
    const m = lessonMastery(lessons, { "quiz-day15:a": { last: "right" }, "quiz-day15:b": { last: "right" }, "quiz-day15:c": { last: "right" }, "quiz-day15:d": { last: "right" } }, { "day15:x": { ivl: 30 }, "day15:y": { ivl: 30 } });
    const errors = topicMastery(m).find((t) => t.id === "errors")!;
    expect(errors).toMatchObject({ score: 50, tried: 1, lessons: ["day15", "day16"] });
    const r = readiness(topicMastery(m));
    expect(r.label).toBe("Just started");
    expect(r.advice).toContain("Focus next on");
  });

  it("every exam topic has lessons and no lesson is in two topics", () => {
    const all = EXAM_TOPICS.flatMap((t) => t.lessons);
    expect(new Set(all).size).toBe(all.length);
    for (const t of EXAM_TOPICS) expect(t.lessons.length).toBeGreaterThan(0);
    expect(readiness(EXAM_TOPICS.map((t) => ({ id: t.id, title: t.title, score: 90, tried: 1, lessons: [] }))).label).toBe("Ready");
  });

  it("suggests the weakest tried lessons, then completed lessons never tested", () => {
    const m = lessonMastery(lessons, { "quiz-day16:a": { last: "wrong" }, "quiz-day15:a": { last: "right" } }, {});
    expect(weakestLessons(m, new Set(["day44"]))).toEqual(["day16", "day15", "day44"]);
  });
});
