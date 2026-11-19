/**
 * The app's daily study reminder (pure, unit tested in tests/unit/reminder.test.ts): when the next ones fire and
 * what they say. The app (src/client/native.ts) schedules a few days ahead, so reminders still come on days the
 * app isn't opened, and re-plans them whenever you study.
 */

export const DEFAULT_TIME = "19:00";
/** how many days ahead are scheduled */
export const DAYS_AHEAD = 4;

/** "19:00" → [19, 0]; anything malformed falls back to the default time */
export function parseTime(t: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  const h = m ? Number(m[1]) : NaN, min = m ? Number(m[2]) : NaN;
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? [h, min] : [19, 0];
}

export interface Reminder {
  id: number;
  at: Date;
  title: string;
  body: string;
}

/**
 * The reminders to schedule from `now`: today's (unless its time has passed or today's goal is already reached)
 * and the following days'. Today's names the points still needed; later ones can't know, so they speak generally.
 */
export function plan(now: Date, time: string | undefined, s: { todayMet: boolean; current: number; todayPoints: number; goal: number }): Reminder[] {
  const [h, m] = parseTime(time);
  const out: Reminder[] = [];
  for (let d = 0; d <= DAYS_AHEAD; d++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m, 0, 0);
    if (at <= now) continue;
    if (d === 0) {
      if (s.todayMet) continue;
      const left = s.goal - s.todayPoints;
      out.push({ id: 100 + d, at, title: s.current > 0 ? `Keep your ${s.current}-day streak 🔥` : "Time for today's session", body: `${left} study points to today's goal. A 10-minute session gets you there.` });
    } else {
      out.push({ id: 100 + d, at, title: "Time for today's session", body: s.current > 0 ? `Your streak is waiting 🔥 Ten minutes of flashcards and questions keeps it going.` : "Ten minutes of MuleSoft: flashcards and questions picked for you." });
    }
    if (out.length >= DAYS_AHEAD) break;
  }
  return out;
}
