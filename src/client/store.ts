/**
 * Everything the site remembers lives in this browser's localStorage. Signing in (src/client/account.ts) copies the
 * progress keys to the account and back, so it follows you between devices.
 * Every read/write is guarded: private browsing or blocked storage just means nothing is remembered.
 */
import type { CardState } from "../lib/srs";
import { SYNC_KEYS } from "../lib/sync";

export const KEYS = {
  completed: "mls.completed", // string[] lesson ids
  bookmarks: "mls.bookmarks", // string[] lesson ids
  started: "mls.started", // string[] lesson ids opened at least once (for "in progress")
  recent: "mls.recent", // RecentItem[] newest first
  audio: "mls.audio", // Record<episodeId, MediaProgress>
  video: "mls.video", // Record<episodeId, MediaProgress>
  reading: "mls.reading", // Record<"<lesson>/<level>", number 0..1>
  player: "mls.player", // { id, rate } the last episode in the audio player
  searches: "mls.searches", // string[] recent search queries, newest first
  srs: "mls.srs", // Record<cardId, CardState> flashcard review schedule (src/lib/srs.ts)
  srsNew: "mls.srsNew", // { day: "YYYY-MM-DD", n } new flashcards started today
  mapSrs: "mls.mapSrs", // Record<term, CardState> concept-map rebuild schedule (src/client/conceptmap.ts), kept apart from flashcards
  quiz: "mls.quiz", // Record<questionId, QuizResult> lesson quiz answers (src/client/quiz.ts)
  flows: "mls.flows", // Record<exerciseId, "right" | "wrong"> Build the flow results (src/client/flows.ts)
  dw: "mls.dw", // Record<exerciseId, DwResult> DataWeave practice results (src/client/dataweave.ts)
  lectures: "mls.lectures", // Record<lessonId, LectureProgress> how far each lecture video has been watched
  interviews: "mls.interviews", // InterviewSession[] mock interviews, newest first (src/client/interview.ts)
  mcqTests: "mls.mcqTests", // McqTestResult[] MCQ tests taken, newest first (src/client/mcq.ts)
  prefs: "mls.prefs", // { theme?, width?, scale?, lessonNav?, videoAutoplay?, lastVideo? }
} as const;

export interface RecentItem {
  id: string;
  view: string;
  href: string;
  title: string;
  at: number;
}
export interface MediaProgress {
  pos: number;
  dur: number;
  at: number;
  done?: boolean;
}

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw) as unknown;
    if (value == null || fallback === null) return (value ?? fallback) as T;
    return typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback) ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: progress simply isn't saved */
  }
  markChanged([key]);
  window.dispatchEvent(new CustomEvent("mls:store", { detail: { key } }));
}

/** signed in on this device (src/client/account.ts): { uid, email, name } */
export const ACCOUNT_KEY = "mls.account";
/** when you signed in on this device (ms): sign-in lasts 30 days (checked before first paint in Base.astro) */
export const AUTH_AT_KEY = "mls.authAt";
export const SIGN_IN_DAYS = 30;
/** when each synced kind of progress last changed on this device (ms), for src/lib/sync.ts */
export const SYNC_AT_KEY = "mls.syncAt";
const SYNCED = new Set<string>(SYNC_KEYS);
/**
 * Notes the time a synced key changed. Only while signed in: progress from before signing in has no time,
 * so the first sync merges it with the account instead of one side replacing the other.
 */
export function markChanged(keys: string[], at = Date.now()) {
  const synced = keys.filter((k) => SYNCED.has(k));
  if (!synced.length) return;
  try {
    if (localStorage.getItem(ACCOUNT_KEY) == null) return;
    const all = JSON.parse(localStorage.getItem(SYNC_AT_KEY) ?? "{}") as Record<string, number>;
    for (const k of synced) all[k] = at;
    localStorage.setItem(SYNC_AT_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

const ids = (key: string) => read<string[]>(key, []).filter((x) => typeof x === "string");

export const isCompleted = (id: string) => ids(KEYS.completed).includes(id);
export const completedIds = () => ids(KEYS.completed);
export function setCompleted(id: string, done: boolean) {
  const list = ids(KEYS.completed).filter((x) => x !== id);
  if (done) list.push(id);
  write(KEYS.completed, list);
}

export const isBookmarked = (id: string) => ids(KEYS.bookmarks).includes(id);
export const bookmarkIds = () => ids(KEYS.bookmarks);
export function setBookmarked(id: string, on: boolean) {
  const list = ids(KEYS.bookmarks).filter((x) => x !== id);
  if (on) list.unshift(id);
  write(KEYS.bookmarks, list);
}

export type LessonStatus = "done" | "started" | "new";

/** Lessons opened at least once. Older data (before this key existed) is derived from recents and reading progress. */
export function startedIds(): string[] {
  const stored = read<string[] | null>(KEYS.started, null);
  if (Array.isArray(stored)) return stored.filter((x) => typeof x === "string");
  const derived = new Set<string>(read<RecentItem[]>(KEYS.recent, []).map((r) => r?.id).filter((x): x is string => typeof x === "string"));
  for (const k of Object.keys(read<Record<string, number>>(KEYS.reading, {}))) derived.add(k.split("/")[0]);
  return [...derived];
}
export function statusOf(id: string, done = new Set(completedIds()), started = new Set(startedIds())): LessonStatus {
  return done.has(id) ? "done" : started.has(id) ? "started" : "new";
}

export const recent = () => read<RecentItem[]>(KEYS.recent, []).filter((r) => r && typeof r.id === "string");
export function recordVisit(item: Omit<RecentItem, "at">) {
  // One entry per lesson: the most recent view of it.
  const list = recent().filter((r) => r.id !== item.id);
  list.unshift({ ...item, at: Date.now() });
  write(KEYS.recent, list.slice(0, 12));
  const started = startedIds();
  if (!started.includes(item.id)) write(KEYS.started, [...started, item.id]);
}

export function mediaProgress(kind: "audio" | "video", id: string): MediaProgress | null {
  const all = read<Record<string, MediaProgress>>(KEYS[kind], {});
  const p = all[id];
  return p && typeof p.pos === "number" ? p : null;
}
export function allMediaProgress(kind: "audio" | "video") {
  return read<Record<string, MediaProgress>>(KEYS[kind], {});
}
export function saveMediaProgress(kind: "audio" | "video", id: string, pos: number, dur: number) {
  const all = read<Record<string, MediaProgress>>(KEYS[kind], {});
  const done = dur > 0 && pos >= dur - 3;
  // Finished episodes restart from 0 next time but stay marked as listened.
  all[id] = { pos: done ? 0 : Math.max(0, Math.floor(pos)), dur: Math.floor(dur) || 0, at: Date.now(), done: done || all[id]?.done };
  write(KEYS[kind], all);
}

export function readingProgress(key: string): number {
  const v = read<Record<string, number>>(KEYS.reading, {})[key];
  return typeof v === "number" ? v : 0;
}
export function saveReadingProgress(key: string, value: number) {
  const all = read<Record<string, number>>(KEYS.reading, {});
  // Keep the furthest point reached.
  if ((all[key] ?? 0) >= value) return;
  all[key] = Math.min(1, Math.round(value * 100) / 100);
  write(KEYS.reading, all);
}

/** Backup file format. Version 1 files ({ app, exportedAt, data }) and bare data objects are still accepted. */
export const BACKUP_VERSION = 2;
const LIST_KEYS = new Set<string>([KEYS.completed, KEYS.bookmarks, KEYS.started, KEYS.recent, KEYS.searches, KEYS.interviews, KEYS.mcqTests]);
/** what each key holds, in words, for the restore summary */
export const KEY_NAMES: Record<string, string> = {
  [KEYS.completed]: "completed lessons", [KEYS.bookmarks]: "bookmarks", [KEYS.started]: "lessons in progress", [KEYS.recent]: "recent activity",
  [KEYS.audio]: "podcast positions", [KEYS.video]: "video positions", [KEYS.reading]: "reading positions", [KEYS.player]: "audio player",
  [KEYS.searches]: "recent searches", [KEYS.srs]: "flashcard schedule", [KEYS.srsNew]: "new flashcards today", [KEYS.mapSrs]: "concept-map review schedule",
  [KEYS.quiz]: "quiz answers and mistakes", [KEYS.flows]: "Build-the-flow results", [KEYS.dw]: "DataWeave results", [KEYS.prefs]: "preferences",
  [KEYS.lectures]: "lecture videos watched", [KEYS.interviews]: "mock interviews", [KEYS.mcqTests]: "MCQ tests",
};

/** Everything this site stores, for backup / restore / reset on the My study page. */
export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.values(KEYS)) {
    const v = read<unknown>(key, null);
    if (v != null) out[key] = v;
  }
  return out;
}
export const backupFile = () => ({ app: "mule-study", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: exportAll() });

export interface BackupCheck {
  /** keys that will be restored, with how many entries each holds */
  entries: { key: string; name: string; size: number }[];
  /** keys in the file this site doesn't know, or whose value has the wrong shape (left alone) */
  skipped: string[];
  exportedAt?: string;
  version: number;
}
/** Validates a parsed backup without changing anything. Throws if it isn't a backup at all. */
export function checkBackup(file: unknown): BackupCheck {
  if (typeof file !== "object" || file === null || Array.isArray(file)) throw new Error("Not a Mule Study backup file");
  const f = file as Record<string, unknown>;
  const wrapped = f.app === "mule-study" && typeof f.data === "object" && f.data !== null;
  const data = (wrapped ? f.data : f) as Record<string, unknown>;
  const version = wrapped ? (typeof f.version === "number" ? f.version : 1) : 1;
  if (version > BACKUP_VERSION) throw new Error("This backup comes from a newer version of the site; update the app first");
  const known = new Set<string>(Object.values(KEYS));
  const entries: BackupCheck["entries"] = [];
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    const shapeOk = LIST_KEYS.has(k) ? Array.isArray(v) : typeof v === "object" && v !== null && !Array.isArray(v);
    if (!known.has(k) || !shapeOk) {
      skipped.push(k);
      continue;
    }
    entries.push({ key: k, name: KEY_NAMES[k] ?? k, size: Array.isArray(v) ? v.length : Object.keys(v as object).length });
  }
  if (!entries.length) throw new Error("The file contains no Mule Study progress");
  return { entries, skipped, exportedAt: wrapped && typeof f.exportedAt === "string" ? f.exportedAt : undefined, version };
}
/** Restores a backup checked by checkBackup: each kind of progress in the file replaces this browser's; kinds not in the file are kept. */
export function importAll(file: unknown): number {
  const check = checkBackup(file);
  const f = file as Record<string, unknown>;
  const data = (f.app === "mule-study" && typeof f.data === "object" && f.data !== null ? f.data : f) as Record<string, unknown>;
  for (const e of check.entries) write(e.key, data[e.key]);
  return check.entries.length;
}
export function clearAll(keepPrefs = true) {
  for (const key of Object.values(KEYS)) {
    if (keepPrefs && key === KEYS.prefs) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  // signed in: the reset reaches the account (and your other devices) too
  markChanged(Object.values(KEYS));
  window.dispatchEvent(new CustomEvent("mls:store", { detail: { key: "*" } }));
}

export interface Prefs {
  theme?: "light" | "dark";
  width?: "normal" | "wide";
  scale?: number;
  lessonNav?: "shown" | "hidden";
  /** Videos tab: play the next video when one ends (default on) */
  videoAutoplay?: boolean;
  /** Videos tab: the last video opened, for "continue watching" */
  lastVideo?: string;
  /** the left menu on wide screens: open (default) or collapsed to icons */
  nav?: "open" | "collapsed";
  /** Videos tab: the playlist beside the player (default shown) */
  videoPlaylist?: "shown" | "hidden";
  /** video players: our simple controls (default) or YouTube's own (the only place to choose 720p / 1080p) */
  playerControls?: "simple" | "youtube";
  /** video players: captions off (default), in the video's language, or auto-translated to English; and the last ones used */
  captions?: "off" | "orig" | "en";
  captionsLast?: "orig" | "en";
  /** Videos tab: which notes level shows under the video */
  videoNotes?: "simple" | "detailed" | "super";
  /** Revision: new flashcards to introduce per day (default 15) */
  newPerDay?: number;
}
/** Recent searches (search page), newest first; a longer query replaces the shorter one it extends. */
export const recentSearches = () => read<string[]>(KEYS.searches, []).filter((x) => typeof x === "string");
export function saveSearch(q: string) {
  const list = recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase() && !q.toLowerCase().startsWith(x.toLowerCase()));
  write(KEYS.searches, [q, ...list].slice(0, 6));
}
export function clearSearches() {
  write(KEYS.searches, []);
}

export const prefs = () => read<Prefs>(KEYS.prefs, {});
export function setPrefs(patch: Partial<Prefs>) {
  write(KEYS.prefs, { ...prefs(), ...patch });
}

export function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ---- DataWeave practice ----
/** a DataWeave exercise's last result in each mode: p = predict the output, w = write the script */
export interface DwResult {
  p?: "right" | "wrong";
  w?: "right" | "wrong";
}
export const dwResults = () => read<Record<string, DwResult>>(KEYS.dw, {});
export function saveDwResult(id: string, mode: "p" | "w", result: "right" | "wrong") {
  const all = dwResults();
  write(KEYS.dw, { ...all, [id]: { ...all[id], [mode]: result } });
}

// ---- lesson quizzes ----
/** a quiz question's history: times right / wrong, and the latest answer */
export interface QuizResult {
  r: number;
  w: number;
  last: "right" | "wrong";
  at: number;
}
export const quizResults = () => read<Record<string, QuizResult>>(KEYS.quiz, {});
export function saveQuizAnswer(id: string, right: boolean) {
  const all = quizResults();
  const prev = all[id] ?? { r: 0, w: 0 };
  write(KEYS.quiz, { ...all, [id]: { r: prev.r + (right ? 1 : 0), w: prev.w + (right ? 0 : 1), last: right ? "right" : "wrong", at: Date.now() } });
}

// ---- Build the flow ----
export const flowResults = () => read<Record<string, "right" | "wrong">>(KEYS.flows, {});
export function saveFlowResult(id: string, result: "right" | "wrong") {
  write(KEYS.flows, { ...flowResults(), [id]: result });
}

// ---- flashcard review schedule ----
export const srsStates = () => read<Record<string, CardState>>(KEYS.srs, {});
export function saveCardState(id: string, state: CardState) {
  write(KEYS.srs, { ...srsStates(), [id]: state });
}
export const mapStates = () => read<Record<string, CardState>>(KEYS.mapSrs, {});
export function saveMapState(id: string, state: CardState) {
  write(KEYS.mapSrs, { ...mapStates(), [id]: state });
}
const today = () => new Date().toLocaleDateString("en-CA");
/** New flashcards started today (resets each day). */
export function newStartedToday(): number {
  const v = read<{ day?: string; n?: number }>(KEYS.srsNew, {});
  return v.day === today() && typeof v.n === "number" ? v.n : 0;
}
export function noteNewStarted() {
  write(KEYS.srsNew, { day: today(), n: newStartedToday() + 1 });
}
export const newPerDay = () => {
  const n = prefs().newPerDay;
  return typeof n === "number" && n >= 0 && n <= 100 ? n : 15;
};

// ---- lecture videos (YouTube) ----
/** how far a lecture has been watched: where you stopped, the furthest point reached, and whether it counts as watched */
export interface LectureProgress {
  pos: number;
  dur: number;
  max: number;
  at: number;
  done?: boolean;
}
/** watching 90% counts as watched (the last minutes are often questions and goodbyes) */
export const WATCHED = 0.9;
export const lectureProgress = () => read<Record<string, LectureProgress>>(KEYS.lectures, {});
/** Saves where you are in a lecture. Returns true the moment it first counts as watched. */
export function saveLectureProgress(id: string, pos: number, dur: number): boolean {
  if (!(dur > 0)) return false;
  const all = lectureProgress();
  const prev = all[id];
  const max = Math.max(prev?.max ?? 0, Math.floor(pos));
  const done = !!prev?.done || max >= dur * WATCHED;
  // near the end: next time it starts from the beginning
  const p = pos >= dur - 20 ? 0 : Math.floor(pos);
  if (prev && prev.pos === p && prev.max === max && prev.done === done) return false;
  all[id] = { pos: p, dur: Math.floor(dur), max, at: Date.now(), done };
  write(KEYS.lectures, all);
  return done && !prev?.done;
}

// ---- mock interviews ----
/** a finished mock interview: when, how long, and how you rated each answer (2 = nailed it, 1 = partly, 0 = missed) */
export interface InterviewSession {
  at: number;
  secs: number;
  topic: string;
  ratings: Record<string, 0 | 1 | 2>;
}
export const interviews = () => read<InterviewSession[]>(KEYS.interviews, []).filter((s) => s && typeof s.at === "number" && s.ratings);
export function saveInterview(s: InterviewSession) {
  write(KEYS.interviews, [s, ...interviews()].slice(0, 60));
}
/** score of a session in percent: nailed = full marks, partly = half */
export const interviewScore = (s: InterviewSession) => {
  const r = Object.values(s.ratings);
  return r.length ? Math.round((r.reduce<number>((a, b) => a + b, 0) / (r.length * 2)) * 100) : 0;
};

// ---- MCQ tests ----
export interface McqTestResult {
  at: number;
  mode: "exam" | "practice";
  topic: string;
  total: number;
  right: number;
  secs: number;
}
export const mcqTests = () => read<McqTestResult[]>(KEYS.mcqTests, []).filter((t) => t && typeof t.at === "number" && typeof t.total === "number");
export function saveMcqTest(t: McqTestResult) {
  write(KEYS.mcqTests, [t, ...mcqTests()].slice(0, 60));
}
