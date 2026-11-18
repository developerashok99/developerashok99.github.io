/**
 * MCQ tests (pure, unit tested in tests/unit/mcq.test.ts): building a test, marking it, and checking a question
 * a friend adds to the shared question bank.
 */

/** a question as the test runs it: course questions come from mcq.json, friends' from the database */
export interface Mcq {
  id: string;
  /** question, options and explanation as HTML (friends' questions are escaped plain text) */
  q: string;
  o: string[];
  a: number;
  e: string;
  /** lesson id and label, section id and title (friends' questions may have none) */
  lid: string;
  l: string;
  s: string;
  d: string;
  href: string;
  /** who added it, for friends' questions */
  by?: string;
}

/** MuleSoft's developer exam passes at 70% */
export const PASS = 70;
/** exam mode: 2 minutes a question, as in the real exam (60 questions, 120 minutes) */
export const SECS_PER_QUESTION = 120;

/** Shuffles a copy (Fisher–Yates); `random` is injectable for repeatable tests. */
export function shuffle<T>(list: T[], random = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Picks n questions. Ones you got wrong last time come first (up to a third of the test), the rest at random;
 * with `spread`, the test draws evenly from every lesson in the pool instead of whichever lessons have most questions.
 */
export function buildTest(pool: Mcq[], n: number, wrongBefore: Set<string>, random = Math.random): Mcq[] {
  const wrong = shuffle(pool.filter((q) => wrongBefore.has(q.id)), random).slice(0, Math.floor(n / 3));
  const picked = new Set(wrong.map((q) => q.id));
  // round-robin over lessons, so a 20-question test covers 20 lessons rather than 3 big ones
  const byLesson = new Map<string, Mcq[]>();
  for (const q of shuffle(pool, random)) {
    if (picked.has(q.id)) continue;
    const k = q.lid || "friends";
    byLesson.set(k, [...(byLesson.get(k) ?? []), q]);
  }
  const lanes = shuffle([...byLesson.values()], random);
  const rest: Mcq[] = [];
  while (wrong.length + rest.length < n && lanes.some((l) => l.length)) {
    for (const lane of lanes) {
      const q = lane.shift();
      if (q) rest.push(q);
      if (wrong.length + rest.length >= n) break;
    }
  }
  return shuffle([...wrong, ...rest], random);
}

export interface Marked {
  right: number;
  total: number;
  percent: number;
  passed: boolean;
  /** per section: right / total, weakest first */
  sections: { title: string; right: number; total: number; percent: number }[];
}

/** Marks a test: unanswered questions count as wrong. */
export function mark(questions: Mcq[], answers: Record<string, number>): Marked {
  const by = new Map<string, { right: number; total: number }>();
  let right = 0;
  for (const q of questions) {
    const ok = answers[q.id] === q.a;
    if (ok) right++;
    const t = q.d || "Friends' questions";
    const s = by.get(t) ?? { right: 0, total: 0 };
    s.total++;
    if (ok) s.right++;
    by.set(t, s);
  }
  const percent = questions.length ? Math.round((right / questions.length) * 100) : 0;
  const sections = [...by.entries()].map(([title, s]) => ({ title, ...s, percent: Math.round((s.right / s.total) * 100) })).sort((a, b) => a.percent - b.percent);
  return { right, total: questions.length, percent, passed: percent >= PASS, sections };
}

/** what a friend types into "Add a question" */
export interface McqDraft {
  q: string;
  options: string[];
  answer: number;
  explain: string;
  lid: string;
}

/** Checks a draft; returns the problem in plain words, or "" when it's fine. */
export function checkDraft(d: McqDraft): string {
  const opts = d.options.map((o) => o.trim());
  if (d.q.trim().length < 10) return "Write the question (at least 10 characters).";
  if (d.q.length > 1000) return "The question is too long (1000 characters at most).";
  if (opts.filter(Boolean).length < 2) return "Give at least two options.";
  if (opts.some((o, i) => !o && opts.slice(i + 1).some(Boolean))) return "Fill the options in order, without gaps.";
  if (opts.some((o) => o.length > 300)) return "Keep each option under 300 characters.";
  if (new Set(opts.filter(Boolean).map((o) => o.toLowerCase())).size !== opts.filter(Boolean).length) return "Two options are the same.";
  if (!(d.answer >= 0) || !opts[d.answer]) return "Choose which option is right.";
  if (d.explain.length > 1500) return "The explanation is too long (1500 characters at most).";
  return "";
}

/** Plain text from a friend → safe HTML: escaped, with `code` marks shown as code. */
export function textToHtml(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
}
