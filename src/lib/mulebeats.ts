/**
 * MuleBeats: a curated library of study songs (pure logic, unit tested in tests/unit/mulebeats.test.ts).
 *
 * Songs are made by hand outside the site, reviewed, and only then marked "approved" with their audio file and
 * real length. The manifest lives in config/media.json under "mulebeats" next to the podcasts. Planned and
 * in-review songs stay in the manifest as a to-do list but never reach the published site.
 *
 * Each song's genre and length are chosen from what it has to teach (planStyle): a list to memorise suits a
 * catchy chant, a sequence of steps suits a storytelling rap, a comparison suits a call-and-response, and one
 * deep idea suits something slower. Harder material gets more time.
 */
import { parseDuration } from "./duration";

export type TrackType = "summary" | "concept";
export type Objective = "recall-list" | "process" | "contrast" | "concept";
export type TrackStatus = "planned" | "review" | "approved";
/** the language a song is sung in: English, or Telugu (the language the lectures are taught in) */
export type Language = "en" | "te";
export const LANGUAGES: Language[] = ["en", "te"];
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", te: "Telugu" };

export interface Track {
  id: string;
  title: string;
  /** the course day the song's lesson belongs to (lesson "day19" is day 19), or null for other lessons */
  day: number | null;
  /** how the song is shown everywhere (page, player, lock screen, video): "Day 19 · Our Own Server" */
  label: string;
  lesson: string;
  type: TrackType;
  objective: Objective;
  /** 1 (simple) to 3 (dense) */
  complexity: 1 | 2 | 3;
  /** what the song must teach: the facts to get across, in order */
  concepts: string[];
  genre: string;
  /** real length in seconds (approved songs); planned songs have a target length instead */
  duration: number | null;
  targetSecs: number;
  audioUrl: string | null;
  /** the lyric video (the song with animated lyrics and pictures), when there is one */
  videoUrl: string | null;
  status: TrackStatus;
  language: Language;
  /** for a song in another language: the original it's a version of (same lesson and concepts) */
  versionOf: string | null;
  test: boolean;
}
export interface Playlist {
  id: string;
  title: string;
  description: string;
  tracks: string[];
}
export interface Beats {
  tracks: Track[];
  playlists: Playlist[];
}

const TYPES: TrackType[] = ["summary", "concept"];
const OBJECTIVES: Objective[] = ["recall-list", "process", "contrast", "concept"];
const STATUSES: TrackStatus[] = ["planned", "review", "approved"];
const ID = /^[a-z0-9][a-z0-9-]*$/;
/** longer than this is not a study song */
const MAX_SECS = 10 * 60;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Genre and length to aim for, from what the song teaches and how dense it is. */
export function planStyle(type: TrackType, objective: Objective, complexity: 1 | 2 | 3, language: Language = "en"): { genre: string; bpm: string; targetSecs: number; why: string } {
  // Telugu songs use styles familiar to Telugu listeners, chosen by the same rule
  const telugu = {
    "recall-list": { genre: "Telugu folk-pop with a chant chorus", bpm: "110–125", why: "a janapadam-style chant makes a list stick" },
    process: { genre: "Telugu hip-hop", bpm: "88–100", why: "verses walk through the steps in order" },
    contrast: { genre: "Telugu duet, call-and-response", bpm: "100–115", why: "two singers trade lines, one for each side" },
    concept: { genre: complexity === 3 ? "Telugu lo-fi melody" : "Telugu acoustic melody", bpm: complexity === 3 ? "70–85" : "85–100", why: "a calmer melody leaves room to take in one deep idea" },
  };
  const english = {
    "recall-list": { genre: "Upbeat pop with a chant chorus", bpm: "110–125", why: "a repeated chant makes a list stick" },
    process: { genre: "Storytelling hip-hop", bpm: "88–100", why: "verses walk through the steps in order" },
    contrast: { genre: "Call-and-response pop rock", bpm: "100–115", why: "two voices trade lines, one for each side" },
    concept: { genre: complexity === 3 ? "Lo-fi hip-hop" : "Acoustic folk", bpm: complexity === 3 ? "70–85" : "85–100", why: "a calmer pace leaves room to take in one deep idea" },
  };
  const style = (language === "te" ? telugu : english)[objective];
  // summaries cover the whole lesson; concept songs one idea. Denser material gets more time.
  const targetSecs = type === "summary" ? Math.min(210, 120 + 30 * complexity) : Math.min(150, 60 + 25 * complexity);
  return { ...style, targetSecs };
}

/**
 * Reads and checks the "mulebeats" section of media.json. Problems are added to `problems` (the build then stops,
 * as for any other media.json mistake). Returns every track (for tooling and tests) and the published set.
 */
export function parseBeats(
  raw: unknown,
  known: string[],
  problems: string[],
  opts: { showTest?: boolean; checkUrl?: (url: string) => string | null } = {},
): { all: Beats; published: Beats } {
  const empty = { all: { tracks: [], playlists: [] }, published: { tracks: [], playlists: [] } };
  if (raw == null) return empty;
  if (!isObj(raw)) {
    problems.push("media.json mulebeats: expected { \"tracks\": [...], \"playlists\": [...] }");
    return empty;
  }
  const tracks: Track[] = [];
  const ids = new Set<string>();
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  const rawById = new Map<string, Record<string, unknown>>();
  for (const t of rawTracks) if (isObj(t) && str(t.id) && !rawById.has(str(t.id))) rawById.set(str(t.id), t);
  rawTracks.forEach((entry: unknown, i: number) => {
    const where = `media.json mulebeats.tracks[${i}]`;
    if (!isObj(entry)) return problems.push(`${where}: must be an object`);
    const id = str(entry.id);
    const at = `${where} (${id || "no id"})`;
    // a version in another language takes the original's lesson, type and concepts unless it sets its own
    const versionOf = str(entry.versionOf);
    const source = versionOf ? rawById.get(versionOf) : undefined;
    if (versionOf && !source) problems.push(`${at}.versionOf "${versionOf}" does not exist`);
    if (source && str(source.versionOf)) problems.push(`${at}.versionOf "${versionOf}" is itself a version; point to the original`);
    const inherited = source ? { lesson: source.lesson, type: source.type, objective: source.objective, complexity: source.complexity, concepts: source.concepts } : {};
    const t: Record<string, unknown> = { ...inherited, ...entry };
    const language = (str(t.language) || "en") as Language;
    if (!LANGUAGES.includes(language)) problems.push(`${at}.language must be one of ${LANGUAGES.join(", ")}`);
    if (source && (str(source.language) || "en") === language) problems.push(`${at}: a version must be in a different language from its original`);
    if (!str(t.title) && source) t.title = `${str(source.title)} (${LANGUAGE_NAMES[language] ?? language})`;
    if (!ID.test(id)) problems.push(`${at}.id must be lowercase letters, digits and dashes`);
    if (ids.has(id)) problems.push(`${at}.id is used twice`);
    ids.add(id);
    if (!str(t.title)) problems.push(`${at}.title is required`);
    const lesson = str(t.lesson);
    if (!known.includes(lesson)) problems.push(`${at}.lesson "${lesson}" does not exist in the synced notes`);
    const type = str(t.type) as TrackType;
    if (!TYPES.includes(type)) problems.push(`${at}.type must be one of ${TYPES.join(", ")}`);
    const objective = str(t.objective) as Objective;
    if (!OBJECTIVES.includes(objective)) problems.push(`${at}.objective must be one of ${OBJECTIVES.join(", ")}`);
    const complexity = t.complexity === 1 || t.complexity === 2 || t.complexity === 3 ? t.complexity : null;
    if (!complexity) problems.push(`${at}.complexity must be 1, 2 or 3`);
    const status = (str(t.status) || "planned") as TrackStatus;
    if (!STATUSES.includes(status)) problems.push(`${at}.status must be one of ${STATUSES.join(", ")}`);
    const rawDuration = str(t.duration);
    const duration = rawDuration ? parseDuration(rawDuration) : null;
    if (rawDuration && (duration == null || duration <= 0 || duration > MAX_SECS)) problems.push(`${at}.duration "${rawDuration}" must look like 2:45 and be under 10 minutes`);
    const audioUrl = str(t.audioUrl);
    const urlProblem = audioUrl ? opts.checkUrl?.(audioUrl) : null;
    if (urlProblem) problems.push(`${at}.audioUrl ${urlProblem}`);
    const videoUrl = str(t.videoUrl);
    const videoProblem = videoUrl ? opts.checkUrl?.(videoUrl) : null;
    if (videoProblem) problems.push(`${at}.videoUrl ${videoProblem}`);
    if (status === "approved" && !audioUrl) problems.push(`${at}: an approved song needs its audioUrl`);
    if (status === "approved" && !rawDuration) problems.push(`${at}: an approved song needs its real duration`);
    const concepts = Array.isArray(t.concepts) ? t.concepts.map(str).filter(Boolean) : [];
    const plan = planStyle(type, objective, complexity ?? 2, LANGUAGES.includes(language) ? language : "en");
    tracks.push({
      id, title: str(t.title), day: dayOf(lesson), label: songLabel(str(t.title), lesson), lesson, type, objective, complexity: complexity ?? 2, concepts,
      genre: str(t.genre) || plan.genre, duration: duration ?? null, targetSecs: plan.targetSecs,
      audioUrl: audioUrl || null, videoUrl: videoUrl || null, status, language: LANGUAGES.includes(language) ? language : "en", versionOf: versionOf || null, test: t.test === true,
    });
  });
  const playlists: Playlist[] = [];
  const pids = new Set<string>();
  (Array.isArray(raw.playlists) ? raw.playlists : []).forEach((p: unknown, i: number) => {
    const where = `media.json mulebeats.playlists[${i}]`;
    if (!isObj(p)) return problems.push(`${where}: must be an object`);
    const id = str(p.id);
    const at = `${where} (${id || "no id"})`;
    if (!ID.test(id)) problems.push(`${at}.id must be lowercase letters, digits and dashes`);
    if (pids.has(id)) problems.push(`${at}.id is used twice`);
    pids.add(id);
    if (!str(p.title)) problems.push(`${at}.title is required`);
    const refs = Array.isArray(p.tracks) ? p.tracks.map(str) : [];
    for (const r of refs) if (!ids.has(r)) problems.push(`${at}: track "${r}" does not exist`);
    playlists.push({ id, title: str(p.title), description: str(p.description), tracks: refs.filter((r) => ids.has(r)) });
  });
  return { all: { tracks, playlists }, published: publish({ tracks, playlists }, opts.showTest === true) };
}

/**
 * What the site shows: approved songs with audio (plus the test songs in test builds), and playlists cut down to
 * those songs; a playlist with nothing left is left out.
 */
export function publish(b: Beats, showTest: boolean): Beats {
  const tracks = b.tracks.filter((t) => t.status === "approved" && t.audioUrl && t.duration && (showTest || !t.test));
  const ok = new Set(tracks.map((t) => t.id));
  const playlists = b.playlists.map((p) => ({ ...p, tracks: p.tracks.filter((id) => ok.has(id)) })).filter((p) => p.tracks.length > 0);
  return { tracks, playlists };
}

/** The course day of a lesson id ("day07" is 7); null for lessons that aren't a numbered day. */
export function dayOf(lesson: string): number | null {
  const m = /^day(\d+)$/.exec(lesson);
  return m ? Number(m[1]) : null;
}
/** "Day 19 · Our Own Server": the day first, so songs read in course order wherever they appear. */
export function songLabel(title: string, lesson: string): string {
  const d = dayOf(lesson);
  return d == null ? title : `Day ${d} · ${title}`;
}
/** Songs in course order (by day, keeping manifest order within a day), for the "All songs" playlist. */
export function courseOrder(tracks: Track[]): Track[] {
  return tracks.map((t, i) => ({ t, i })).sort((a, b) => (a.t.day ?? 999) - (b.t.day ?? 999) || a.i - b.i).map((x) => x.t);
}

// ---- the play queue (used by the shared audio player, src/client/player.ts) ----

export type Repeat = "off" | "all" | "one";
export const REPEATS: Repeat[] = ["off", "all", "one"];

/** Where to go from position `i` in a queue of `n` (dir +1 = next, -1 = previous); null at either end without repeat. */
export function stepIndex(i: number, n: number, dir: 1 | -1, repeat: Repeat): number | null {
  if (n <= 0) return null;
  const j = i + dir;
  if (j >= 0 && j < n) return j;
  return repeat === "all" ? (j + n) % n : null;
}

/** What plays when a song ends: the same one again (repeat one), the next, or nothing at the end. */
export function afterEnd(i: number, n: number, repeat: Repeat): number | null {
  if (repeat === "one") return i;
  return stepIndex(i, n, 1, repeat);
}

/** Shuffled order with the song that's playing kept first, so turning shuffle on doesn't interrupt it. */
export function shuffled(ids: string[], current: string | null, random = Math.random): string[] {
  const rest = ids.filter((id) => id !== current);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return current && ids.includes(current) ? [current, ...rest] : rest;
}
