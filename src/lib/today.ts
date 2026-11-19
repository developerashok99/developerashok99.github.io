/**
 * Today's session (pure, unit tested in tests/unit/today.test.ts): one short, mixed study session built from
 * what is due for you, so you don't have to decide what to study.
 *
 * - flashcards due for review (most overdue first), plus a few new ones if today's allowance has room
 * - questions you got wrong before (oldest mistakes first)
 * - questions from your weakest lessons, or lessons you've completed but never been tested on
 * The kinds are interleaved: mixing topics helps you remember better than doing one kind at a time.
 */

export type Step = { kind: "card"; id: string; fresh: boolean } | { kind: "question"; id: string; why: "mistake" | "weak" | "topic" };

export interface PlanInput {
  dueCards: string[];
  freshCards: string[];
  /** how many new cards may still start today */
  newLeft: number;
  /** quiz question ids last answered wrong, oldest first */
  mistakes: string[];
  /** quiz question ids from the lessons to strengthen, in the order to ask them */
  weak: string[];
}

export const LIMITS = { due: 10, fresh: 3, mistakes: 5, weak: 5 };

/** Interleaves lists: one from each in turn, so no kind comes in a long block. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const lanes = lists.map((l) => [...l]);
  while (lanes.some((l) => l.length)) for (const l of lanes) if (l.length) out.push(l.shift()!);
  return out;
}

export function plan(input: PlanInput, limits = LIMITS): Step[] {
  const cards: Step[] = [
    ...input.dueCards.slice(0, limits.due).map((id) => ({ kind: "card" as const, id, fresh: false })),
    ...input.freshCards.slice(0, Math.min(limits.fresh, Math.max(0, input.newLeft))).map((id) => ({ kind: "card" as const, id, fresh: true })),
  ];
  const mistakes: Step[] = input.mistakes.slice(0, limits.mistakes).map((id) => ({ kind: "question" as const, id, why: "mistake" as const }));
  const taken = new Set(input.mistakes.slice(0, limits.mistakes));
  const weak: Step[] = input.weak.filter((id) => !taken.has(id)).slice(0, limits.weak).map((id) => ({ kind: "question" as const, id, why: "weak" as const }));
  return interleave([cards, mistakes, weak]);
}

/** About how long a session takes: a card ~30 s, a question ~45 s. */
export function minutes(steps: Step[]): number {
  const secs = steps.reduce((t, s) => t + (s.kind === "card" ? 30 : 45), 0);
  return Math.max(1, Math.round(secs / 60));
}
