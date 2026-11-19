/**
 * Topic mastery and exam readiness (pure, unit tested in tests/unit/mastery.test.ts).
 *
 * A lesson's mastery comes only from what you have shown you know: its quiz questions you last answered right,
 * and how firmly its flashcards are learned (a card's interval in days, up to 21, as in My Study). Reading or
 * watching a lesson shows you've been through it, not that you know it, so it doesn't count here.
 *
 * Readiness for the MuleSoft Certified Developer (Level 1) exam is the average mastery of its topic areas;
 * a topic you haven't been tested on counts as 0, so the number only goes up by practising.
 */

export interface LessonInfo {
  id: string;
  label: string;
  title: string;
  /** how many quiz questions and flashcards the lesson has */
  questions: number;
  cards: number;
}

export interface QuizState {
  last: "right" | "wrong";
}
export interface CardLike {
  ivl: number;
}

export interface LessonMastery {
  id: string;
  /** 0–100, or null when nothing has been tried yet */
  score: number | null;
  /** questions and cards tried, out of how many there are */
  tried: number;
  total: number;
}

/** card strength: a card counts fully once its interval reaches 21 days */
const LEARNED_DAYS = 21;

/** Mastery of each lesson from quiz answers (ids "quiz-<lesson>:…") and flashcards (ids "<lesson>:…"). */
export function lessonMastery(lessons: LessonInfo[], quiz: Record<string, QuizState>, cards: Record<string, CardLike>): Map<string, LessonMastery> {
  const right = new Map<string, number>();
  const answered = new Map<string, number>();
  for (const [id, r] of Object.entries(quiz)) {
    const lid = /^quiz-([^:]+):/.exec(id)?.[1];
    if (!lid || !r) continue;
    answered.set(lid, (answered.get(lid) ?? 0) + 1);
    if (r.last === "right") right.set(lid, (right.get(lid) ?? 0) + 1);
  }
  const strength = new Map<string, number>();
  const reviewed = new Map<string, number>();
  for (const [id, c] of Object.entries(cards)) {
    const lid = id.split(":")[0];
    if (!lid || !c || typeof c.ivl !== "number") continue;
    reviewed.set(lid, (reviewed.get(lid) ?? 0) + 1);
    strength.set(lid, (strength.get(lid) ?? 0) + Math.min(c.ivl, LEARNED_DAYS) / LEARNED_DAYS);
  }
  const out = new Map<string, LessonMastery>();
  for (const l of lessons) {
    const total = l.questions + l.cards;
    const tried = Math.min(answered.get(l.id) ?? 0, l.questions) + Math.min(reviewed.get(l.id) ?? 0, l.cards);
    const got = Math.min(right.get(l.id) ?? 0, l.questions) + Math.min(strength.get(l.id) ?? 0, l.cards);
    out.set(l.id, { id: l.id, score: tried && total ? Math.round((got / total) * 100) : null, tried, total });
  }
  return out;
}

/** The MuleSoft Certified Developer – Level 1 (Mule 4) exam's topic areas, and the lessons that teach each. */
export const EXAM_TOPICS: { id: string; title: string; lessons: string[] }[] = [
  { id: "networks", title: "Application networks and API-led connectivity", lessons: ["day01", "day02", "day03", "day04", "day21", "interview-part3"] },
  { id: "design", title: "Designing APIs with RAML", lessons: ["day22", "day23", "day24", "day25", "day26", "interview-part2"] },
  { id: "events", title: "Accessing and modifying Mule events", lessons: ["day07", "day10", "day12", "day28", "day30"] },
  { id: "structure", title: "Structuring Mule applications", lessons: ["day08", "day09", "day14", "day27"] },
  { id: "consume", title: "Consuming web services (HTTP, REST, SOAP)", lessons: ["day06", "day11", "day13", "day41"] },
  { id: "routing", title: "Routing events and scopes", lessons: ["day42", "day43", "day48"] },
  { id: "errors", title: "Handling errors", lessons: ["day15", "day16"] },
  { id: "dataweave", title: "Transforming data with DataWeave", lessons: ["day29", "day44", "day45"] },
  { id: "connectors", title: "Using connectors", lessons: ["day05", "day46", "day47", "day51", "day54", "day57"] },
  { id: "records", title: "Processing records (For Each, batch, Object Store)", lessons: ["day49", "day50", "day52", "day53"] },
  { id: "testing", title: "Testing and troubleshooting (MUnit, logging)", lessons: ["day39", "day40", "day58"] },
  { id: "deploy", title: "Deploying and managing APIs (CloudHub, API Manager, policies)", lessons: ["day17", "day18", "day19", "day20", "day31", "day32", "day33", "day34", "day35", "day36", "day37", "day38", "day55"] },
];

export interface TopicMastery {
  id: string;
  title: string;
  /** 0–100; untried lessons count as 0 */
  score: number;
  /** lessons in the topic that have been tried at all */
  tried: number;
  lessons: string[];
}

export function topicMastery(mastery: Map<string, LessonMastery>, topics = EXAM_TOPICS): TopicMastery[] {
  return topics.map((t) => {
    const ls = t.lessons.filter((id) => mastery.has(id));
    const scores = ls.map((id) => mastery.get(id)!.score ?? 0);
    return {
      id: t.id,
      title: t.title,
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      tried: ls.filter((id) => mastery.get(id)!.score != null).length,
      lessons: ls,
    };
  });
}

export interface Readiness {
  percent: number;
  label: string;
  advice: string;
}

/** Overall exam readiness: the average of the topic areas, in plain words. */
export function readiness(topics: TopicMastery[]): Readiness {
  const percent = topics.length ? Math.round(topics.reduce((a, t) => a + t.score, 0) / topics.length) : 0;
  const weakest = [...topics].sort((a, b) => a.score - b.score)[0];
  const focus = weakest ? ` Focus next on “${weakest.title}”.` : "";
  if (percent >= 85) return { percent, label: "Ready", advice: "You're consistently right across the exam topics. Take full mock exams to stay sharp." };
  if (percent >= 70) return { percent, label: "Nearly ready", advice: `Most topics are solid.${focus}` };
  if (percent >= 40) return { percent, label: "Getting there", advice: `Keep doing daily sessions and quizzes.${focus}` };
  return { percent, label: "Just started", advice: `Answer quizzes and review flashcards: each one moves this number.${focus}` };
}

/** Lessons to practise: tried and weakest first, then lessons you've completed but never tested. */
export function weakestLessons(mastery: Map<string, LessonMastery>, completed: Set<string>, n = 3): string[] {
  const all = [...mastery.values()];
  const tried = all.filter((m) => m.score != null && m.score < 80).sort((a, b) => a.score! - b.score!);
  const untested = all.filter((m) => m.score == null && completed.has(m.id));
  return [...tried, ...untested].slice(0, n).map((m) => m.id);
}
