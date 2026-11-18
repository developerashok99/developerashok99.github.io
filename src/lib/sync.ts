/**
 * Account sync: pure logic, no Firebase and no DOM (unit tested in tests/unit/sync.test.ts).
 *
 * Each kind of progress (completed lessons, flashcard schedule, …) is one "key". Every device remembers when it last
 * changed each key; the server copy keeps the same. Syncing takes, per key, whichever side changed it last, so
 * un-completing a lesson or removing a bookmark sticks. The one exception is a device that has never synced a key
 * (time 0) while the account already has it: then both are merged, so nobody loses what they did before signing in.
 */

/** the progress that follows you between devices; preferences, recent searches and the audio player stay per device */
export const SYNC_KEYS = [
  "mls.completed", "mls.bookmarks", "mls.started", "mls.recent", "mls.audio", "mls.video", "mls.reading",
  "mls.srs", "mls.srsNew", "mls.mapSrs", "mls.quiz", "mls.flows", "mls.dw", "mls.lectures", "mls.interviews", "mls.mcqTests",
] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

/** one side of a sync: values by key, and when each key last changed (ms) */
export interface Snapshot {
  data: Partial<Record<string, unknown>>;
  at: Partial<Record<string, number>>;
}

export interface SyncResult {
  /** what both sides should hold afterwards */
  merged: Snapshot;
  /** keys whose value on this device must change */
  localChanged: string[];
  /** true when the server copy must be written */
  remoteChanged: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** the time inside an entry, when it has one (recent items, media positions, quiz answers) */
const stamp = (v: unknown): number => (isObj(v) && typeof v.at === "number" ? v.at : isObj(v) && typeof v.due === "number" ? v.due : 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Joins two values of one key: lists are united (recent activity keeps one entry per lesson), records keep the newer entry. */
export function mergeValues(key: string, local: unknown, remote: unknown): unknown {
  if (local == null) return remote;
  if (remote == null) return local;
  if (Array.isArray(local) && Array.isArray(remote)) {
    if (key === "mls.recent") {
      const byId = new Map<string, unknown>();
      for (const item of [...remote, ...local]) {
        const id = isObj(item) && typeof item.id === "string" ? item.id : null;
        if (id && (!byId.has(id) || stamp(item) > stamp(byId.get(id)))) byId.set(id, item);
      }
      return [...byId.values()].sort((a, b) => stamp(b) - stamp(a)).slice(0, 12);
    }
    if (key === "mls.interviews" || key === "mls.mcqTests") {
      // mock interviews from both devices, one per start time, newest first
      const byAt = new Map<number, unknown>();
      for (const item of [...remote, ...local]) if (stamp(item)) byAt.set(stamp(item), item);
      return [...byAt.values()].sort((a, b) => stamp(b) - stamp(a)).slice(0, 60);
    }
    return [...new Set([...remote, ...local].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as unknown);
  }
  if (isObj(local) && isObj(remote)) {
    if (key === "mls.srsNew") return stamp(local) >= stamp(remote) ? local : remote; // { day, n }: not a record of entries
    const out: Record<string, unknown> = { ...remote };
    for (const [k, v] of Object.entries(local)) {
      const r = remote[k];
      if (r === undefined) out[k] = v;
      else if (typeof v === "number" && typeof r === "number") out[k] = Math.max(v, r); // reading position: the furthest point
      else if (isObj(v) && isObj(r)) out[k] = stamp(v) >= stamp(r) ? v : r;
      else out[k] = v;
    }
    return out;
  }
  return local;
}

/** Works out the result of syncing this device with the account. */
export function reconcile(local: Snapshot, remote: Snapshot, keys: readonly string[] = SYNC_KEYS): SyncResult {
  const merged: Snapshot = { data: {}, at: {} };
  const localChanged: string[] = [];
  let remoteChanged = false;
  for (const key of keys) {
    const lv = local.data[key], rv = remote.data[key];
    const lt = local.at[key] ?? 0, rt = remote.at[key] ?? 0;
    let value: unknown, at: number;
    if (rv === undefined && lv === undefined && lt === 0) continue;
    if (lt === 0 && rt > 0 && lv !== undefined) {
      // this device's progress from before signing in: keep both
      value = mergeValues(key, lv, rv);
      at = same(value, rv) ? rt : Date.now();
    } else if (lt >= rt) {
      // missing here but changed here: it was cleared (Reset progress), and that should reach the other devices too
      value = lv === undefined ? (lt > 0 ? null : rv) : lv;
      at = lt;
    } else {
      value = rv === undefined ? lv : rv;
      if (value === null && lv === undefined) value = undefined; // cleared on both sides already
      at = rt;
    }
    if (value === undefined) continue;
    merged.data[key] = value;
    merged.at[key] = at;
    if (!same(value, lv ?? null)) localChanged.push(key);
    if (!same(value, rv) || (remote.at[key] ?? -1) !== at) remoteChanged = true;
  }
  return { merged, localChanged, remoteChanged };
}

/** What friends see about you: counts only, no lesson-by-lesson detail. */
export interface ProfileSummary {
  name: string;
  completed: number;
  bookmarks: number;
  cardsLearned: number;
  quizRight: number;
  /** lecture videos watched to the end (90%), and hours of lectures watched in all */
  lecturesWatched: number;
  hoursWatched: number;
  /** mock interviews done, and the average score of the last five (percent) */
  interviews: number;
  interviewScore: number;
  /** MCQ tests taken, and the best score (percent) */
  mcqTests: number;
  mcqBest: number;
  /** the lesson you looked at last */
  lastTitle: string;
  lastHref: string;
  updated: number;
}

/** Builds the friends-page summary from synced data. A card counts as learned once its interval reaches 21 days (as in My Study). */
export function summarize(name: string, data: Snapshot["data"], now = Date.now()): ProfileSummary {
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]) : []);
  const rec = (k: string) => (isObj(data[k]) ? (data[k] as Record<string, unknown>) : {});
  const recent = list("mls.recent").find(isObj) as Record<string, unknown> | undefined;
  const lectures = Object.values(rec("mls.lectures")).filter(isObj);
  const sessions = list("mls.interviews").filter(isObj);
  const scores = sessions.slice(0, 5).map((s) => {
    const r = Object.values(isObj(s.ratings) ? s.ratings : {}).filter((x): x is number => typeof x === "number");
    return r.length ? (r.reduce((a, b) => a + b, 0) / (r.length * 2)) * 100 : 0;
  });
  return {
    name,
    completed: list("mls.completed").length,
    bookmarks: list("mls.bookmarks").length,
    cardsLearned: Object.values(rec("mls.srs")).filter((c) => isObj(c) && typeof c.ivl === "number" && c.ivl >= 21).length,
    quizRight: Object.values(rec("mls.quiz")).filter((q) => isObj(q) && q.last === "right").length,
    lecturesWatched: lectures.filter((l) => l.done === true).length,
    hoursWatched: Math.round((lectures.reduce((t, l) => t + (typeof l.max === "number" ? l.max : 0), 0) / 3600) * 10) / 10,
    interviews: sessions.length,
    interviewScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    mcqTests: list("mls.mcqTests").length,
    mcqBest: Math.max(0, ...list("mls.mcqTests").filter(isObj).map((t) => (typeof t.right === "number" && typeof t.total === "number" && t.total ? Math.round((t.right / t.total) * 100) : 0))),
    lastTitle: typeof recent?.title === "string" ? recent.title : "",
    lastHref: typeof recent?.href === "string" ? recent.href : "",
    updated: now,
  };
}

/** "ravi.k@gmail.com" → "Ravi K": a friendly default name until you choose one. */
export function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : "Learner";
}

/** Two initials for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Plain-English messages for Firebase sign-in errors. */
export function authMessage(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "That email and password don't match. Check them, or use “Forgot password”.";
    case "auth/too-many-requests":
      return "Too many tries. Wait a few minutes, or reset your password.";
    case "auth/network-request-failed":
      return "No connection. Check the internet and try again.";
    case "auth/user-disabled":
      return "This account has been turned off.";
    case "auth/weak-password":
      return "Use at least 6 characters.";
    case "auth/requires-recent-login":
      return "For safety, sign out and back in, then change the password.";
    case "auth/missing-password":
      return "Type your password.";
    case "auth/configuration-not-found":
    case "auth/operation-not-allowed":
      return "Sign-in isn't switched on yet. The site owner needs to turn on Email/Password sign-in in Firebase.";
    default:
      return "Something went wrong. Try again.";
  }
}
