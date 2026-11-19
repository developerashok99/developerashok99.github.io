/**
 * Daily study activity: study points, the daily goal and the streak (pure, unit tested in tests/unit/activity.test.ts).
 *
 * Each device keeps its own counts per day: activity[day][device] = { c, q, r, … }. A device only ever adds to its
 * own counts, so syncing two devices can't lose or double anything: the merge keeps, per day and device, the
 * larger of each count. Points are worked out from the counts, never stored, so the rules can change later.
 */

/** what one device did on one day */
export interface DayCounts {
  /** flashcards reviewed */
  c?: number;
  /** questions answered (lesson quizzes, MCQ tests, today's session, quiz battles) and how many were right */
  q?: number;
  r?: number;
  /** practice exercises done (DataWeave, Build the flow) */
  x?: number;
  /** mock-interview questions answered */
  i?: number;
  /** lessons marked complete */
  l?: number;
  /** seconds of lecture video and podcast audio */
  s?: number;
  /** the daily goal in force that day (so changing your goal doesn't rewrite your past) */
  g?: number;
}
export type Activity = Record<string, Record<string, DayCounts>>;

const FIELDS = ["c", "q", "r", "x", "i", "l", "s"] as const;
type Field = (typeof FIELDS)[number];

export const GOALS = [
  { points: 15, label: "Light", hint: "about 10 minutes" },
  { points: 30, label: "Regular", hint: "about 20 minutes" },
  { points: 50, label: "Serious", hint: "about 35 minutes" },
] as const;
export const DEFAULT_GOAL = 30;
/** how many days of history to keep (enough for a month's calendar and this week's league) */
export const KEEP_DAYS = 70;

/** Points for a day's counts: answering earns a point and a right answer another; listening earns one per 2 minutes. */
export function points(d: DayCounts | undefined): number {
  if (!d) return 0;
  const n = (k: Field) => (typeof d[k] === "number" && d[k]! > 0 ? d[k]! : 0);
  return n("c") + n("q") + n("r") + 2 * n("x") + 2 * n("i") + 5 * n("l") + Math.floor(n("s") / 120);
}

/** "2026-11-19", in local time */
export const dayKey = (t: number | Date = Date.now()) => new Date(t).toLocaleDateString("en-CA");
/** the day before or after a day key */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + by, 12));
}
/** the Monday that starts the week a day is in (weeks run Monday to Sunday) */
export function weekOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return shiftDay(day, -((date.getDay() + 6) % 7));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Adds to this device's counts for a day (returns a new object). */
export function add(all: Activity, day: string, device: string, delta: Partial<Record<Field, number>>, goal?: number): Activity {
  const prev = all[day]?.[device] ?? {};
  const next: DayCounts = { ...prev };
  for (const k of FIELDS) {
    const v = delta[k];
    if (typeof v === "number" && v > 0) next[k] = (prev[k] ?? 0) + v;
  }
  if (goal != null) next.g = goal;
  return { ...all, [day]: { ...all[day], [device]: next } };
}

/** Joins two copies: per day and device, the larger of each count (each device only ever adds to its own). */
export function merge(a: unknown, b: unknown): Activity {
  const out: Activity = {};
  for (const src of [a, b]) {
    if (!isObj(src)) continue;
    for (const [day, devices] of Object.entries(src)) {
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !isObj(devices)) continue;
      for (const [dev, counts] of Object.entries(devices)) {
        if (!isObj(counts)) continue;
        const have: DayCounts = out[day]?.[dev] ?? {};
        const next: DayCounts = { ...have };
        for (const k of [...FIELDS, "g"] as const) {
          const v = counts[k];
          if (typeof v === "number" && Number.isFinite(v) && v >= (have[k] ?? -1)) next[k] = v;
        }
        out[day] = { ...out[day], [dev]: next };
      }
    }
  }
  return out;
}

/** Drops days older than `keep` days before `today`. */
export function prune(all: Activity, today: string, keep = KEEP_DAYS): Activity {
  const oldest = shiftDay(today, -keep);
  return Object.fromEntries(Object.entries(all).filter(([day]) => day >= oldest));
}

/** One day across all devices. */
export function dayTotal(all: Activity, day: string): DayCounts & { points: number } {
  const sum: DayCounts = {};
  let g: number | undefined;
  let p = 0;
  for (const d of Object.values(all[day] ?? {})) {
    for (const k of FIELDS) if (typeof d[k] === "number") sum[k] = (sum[k] ?? 0) + d[k]!;
    if (typeof d.g === "number") g = Math.max(g ?? 0, d.g);
    p += points(d);
  }
  return { ...sum, g, points: p };
}

/** Points earned in the week (Monday to Sunday) that `today` is in. */
export function weekPoints(all: Activity, today: string): number {
  let n = 0;
  for (let d = weekOf(today); d <= today; d = shiftDay(d, 1)) n += dayTotal(all, d).points;
  return n;
}

export type DayState = "met" | "frozen" | "missed" | "partial" | "today" | "none";

export interface Streak {
  /** days in a row the goal was reached (today counts once it is reached) */
  current: number;
  best: number;
  todayPoints: number;
  goal: number;
  todayMet: boolean;
  /** a missed day this week was saved by the week's one freeze */
  freezeUsed: boolean;
  /** the last 7 days, oldest first, for the week strip */
  week: { day: string; state: DayState; points: number }[];
}

/**
 * The streak. A day counts when its points reach that day's goal. One missed day a week (Monday to Sunday) is
 * forgiven: the "freeze" keeps the streak alive but doesn't add to it. Today never breaks the streak; it only
 * adds once its goal is reached.
 */
export function streak(all: Activity, today: string, goal = DEFAULT_GOAL): Streak {
  const goalOf = (day: string) => {
    const t = dayTotal(all, day);
    return t.g ?? goal;
  };
  const met = (day: string) => dayTotal(all, day).points >= (day === today ? goal : goalOf(day));
  const days = Object.keys(all).filter((d) => d <= today).sort();
  const first = days[0];
  const frozenWeeks = new Set<string>();
  const state = new Map<string, DayState>();
  // walk forward from the first recorded day, so freezes are used in time order
  let run = 0;
  let best = 0;
  if (first) {
    for (let d = first; d < today; d = shiftDay(d, 1)) {
      if (met(d)) {
        run++;
        state.set(d, "met");
      } else if (run > 0 && !frozenWeeks.has(weekOf(d))) {
        frozenWeeks.add(weekOf(d));
        state.set(d, "frozen");
      } else {
        run = 0;
        state.set(d, dayTotal(all, d).points > 0 ? "partial" : "missed");
      }
      best = Math.max(best, run);
    }
  }
  const todayPoints = dayTotal(all, today).points;
  const todayMet = todayPoints >= goal;
  if (todayMet) run++;
  best = Math.max(best, run);
  const week: Streak["week"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(today, -i);
    const p = dayTotal(all, d).points;
    week.push({ day: d, points: p, state: d === today ? (todayMet ? "met" : "today") : state.get(d) ?? (p > 0 ? "partial" : "none") });
  }
  return { current: run, best, todayPoints, goal, todayMet, freezeUsed: frozenWeeks.has(weekOf(today)), week };
}
