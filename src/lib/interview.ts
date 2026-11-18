/**
 * Mock interview: which questions to ask (pure, unit tested in tests/unit/interview.test.ts).
 * With "focus on hard questions", questions you missed or only partly knew last time come up more often,
 * and ones you nailed come up less; questions you've never been asked sit in between.
 */

/** your last rating of each question across past interviews: 0 missed, 1 partly, 2 nailed */
export function lastRatings(sessions: { at: number; ratings: Record<string, number> }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of [...sessions].sort((a, b) => a.at - b.at)) for (const [id, r] of Object.entries(s.ratings)) out.set(id, r);
  return out;
}

export function weight(last: number | undefined, focusHard: boolean): number {
  if (!focusHard) return 1;
  if (last === undefined) return 2;
  return last === 0 ? 4 : last === 1 ? 3 : 0.5;
}

/** Picks n different questions, weighted as above. `random` is injectable so tests are repeatable. */
export function pickQuestions<T extends { id: string }>(pool: T[], n: number, last: Map<string, number>, focusHard: boolean, random = Math.random): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length) {
    const weights = left.map((c) => weight(last.get(c.id), focusHard));
    let x = random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < left.length - 1 && x >= weights[i]) x -= weights[i++];
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/** "3 of 5 nailed, 1 partly, 1 missed" plus a percent: nailed = full marks, partly = half. */
export function scoreOf(ratings: number[]): { percent: number; nailed: number; partly: number; missed: number } {
  const nailed = ratings.filter((r) => r === 2).length;
  const partly = ratings.filter((r) => r === 1).length;
  const missed = ratings.filter((r) => r === 0).length;
  return { percent: ratings.length ? Math.round(((nailed * 2 + partly) / (ratings.length * 2)) * 100) : 0, nailed, partly, missed };
}

/** A short verdict for the summary. */
export function verdict(percent: number): string {
  if (percent >= 85) return "Interview ready on these topics. Try a harder mix or a longer interview.";
  if (percent >= 65) return "Good. Go over the partly-known answers once more, then try again.";
  if (percent >= 40) return "Getting there. Revise the missed questions in the lesson self-tests, then retry them.";
  return "Early days. Read the lessons' Simple notes, then come back to these questions.";
}
