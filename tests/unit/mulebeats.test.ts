import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMediaUrl, parseMedia } from "../../src/lib/config";
import { afterEnd, courseOrder, dayOf, parseBeats, planStyle, publish, shuffled, songLabel, stepIndex } from "../../src/lib/mulebeats";

const known = ["day05", "day06", "day07"];
const song = (over: Record<string, unknown> = {}) => ({
  id: "beat-a", title: "Song A", lesson: "day05", type: "summary", objective: "process", complexity: 2,
  concepts: ["one"], status: "approved", audioUrl: "https://example.com/a.mp3", duration: "2:30", ...over,
});
const parse = (raw: unknown, showTest = false) => {
  const problems: string[] = [];
  const r = parseBeats(raw, known, problems, { showTest, checkUrl: checkMediaUrl });
  return { ...r, problems };
};

describe("MuleBeats manifest", () => {
  it("accepts a valid song and playlist", () => {
    const r = parse({ tracks: [song()], playlists: [{ id: "p", title: "P", tracks: ["beat-a"] }] });
    expect(r.problems).toEqual([]);
    expect(r.published.tracks[0]).toMatchObject({ id: "beat-a", lesson: "day05", duration: 150, genre: "Storytelling hip-hop" });
    expect(r.published.playlists).toEqual([{ id: "p", title: "P", description: "", tracks: ["beat-a"] }]);
  });

  it("rejects duplicate ids, missing lessons, bad durations and missing audio", () => {
    const r = parse({ tracks: [song(), song(), song({ id: "beat-b", lesson: "day99" }), song({ id: "beat-c", duration: "forever" }), song({ id: "beat-d", duration: "11:00" }), song({ id: "beat-e", audioUrl: "" }), song({ id: "beat-f", duration: "" })] });
    const all = r.problems.join("\n");
    expect(all).toMatch(/beat-a\)\.id is used twice/);
    expect(all).toMatch(/beat-b\)\.lesson "day99" does not exist/);
    expect(all).toMatch(/beat-c\)\.duration "forever"/);
    expect(all).toMatch(/beat-d\)\.duration "11:00"/);
    expect(all).toMatch(/beat-e\): an approved song needs its audioUrl/);
    expect(all).toMatch(/beat-f\): an approved song needs its real duration/);
  });

  it("rejects bad audio locations, bad fields, and playlists naming songs that don't exist", () => {
    const r = parse({
      tracks: [song({ audioUrl: "javascript:alert(1)" }), song({ id: "Bad Id", type: "remix", objective: "vibes", complexity: 7, status: "live" })],
      playlists: [{ id: "p", title: "P", tracks: ["beat-a", "beat-ghost"] }, { id: "p", title: "" }],
    });
    const all = r.problems.join("\n");
    expect(all).toMatch(/audioUrl must be an http\(s\) URL or a site-relative path/);
    expect(all).toMatch(/id must be lowercase/);
    expect(all).toMatch(/type must be one of/);
    expect(all).toMatch(/objective must be one of/);
    expect(all).toMatch(/complexity must be 1, 2 or 3/);
    expect(all).toMatch(/status must be one of/);
    expect(all).toMatch(/track "beat-ghost" does not exist/);
    expect(all).toMatch(/playlists\[1\] \(p\)\.id is used twice/);
    expect(all).toMatch(/playlists\[1\] \(p\)\.title is required/);
  });

  it("publishes only approved songs with audio; planned ones and empty playlists stay out; test songs only in test builds", () => {
    const raw = {
      tracks: [song(), song({ id: "beat-planned", status: "planned", audioUrl: "", duration: "" }), song({ id: "beat-test", test: true })],
      playlists: [{ id: "mix", title: "Mix", tracks: ["beat-planned", "beat-a", "beat-test"] }, { id: "later", title: "Later", tracks: ["beat-planned"] }],
    };
    const live = parse(raw);
    expect(live.problems).toEqual([]);
    expect(live.all.tracks).toHaveLength(3);
    expect(live.published.tracks.map((t) => t.id)).toEqual(["beat-a"]);
    expect(live.published.playlists).toEqual([{ id: "mix", title: "Mix", description: "", tracks: ["beat-a"] }]);
    expect(parse(raw, true).published.tracks.map((t) => t.id)).toEqual(["beat-a", "beat-test"]);
    expect(publish({ tracks: [], playlists: [] }, true)).toEqual({ tracks: [], playlists: [] });
    expect(parse(undefined).published).toEqual({ tracks: [], playlists: [] });
  });

  it("keeps a song's lyric video link and rejects a bad one", () => {
    expect(parse({ tracks: [song({ videoUrl: "https://example.com/a.mp4" })] }).published.tracks[0].videoUrl).toBe("https://example.com/a.mp4");
    expect(parse({ tracks: [song()] }).published.tracks[0].videoUrl).toBeNull();
    expect(parse({ tracks: [song({ videoUrl: "javascript:alert(1)" })] }).problems.join()).toMatch(/videoUrl must be an http\(s\) URL/);
  });

  it("a mistake in the manifest stops the build, like any media.json mistake", () => {
    expect(() => parseMedia({ podcasts: [], mulebeats: { tracks: [song({ lesson: "nope" })] } }, known)).toThrow(/lesson "nope" does not exist/);
  });

  it("the real config/media.json manifest is valid, covers every lesson, and publishes nothing that isn't approved", () => {
    const ROOT = path.resolve(__dirname, "../..");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".notes/manifest.json"), "utf8")) as { sessions: Record<string, unknown> };
    const media = JSON.parse(fs.readFileSync(path.join(ROOT, "config/media.json"), "utf8"));
    const problems: string[] = [];
    const r = parseBeats(media.mulebeats, Object.keys(manifest.sessions), problems, { checkUrl: checkMediaUrl });
    expect(problems).toEqual([]);
    const lessons = new Set(r.all.tracks.filter((t) => !t.test).map((t) => t.lesson));
    // every lesson of the course has at least a summary song planned
    expect([...lessons].sort()).toEqual(Object.keys(manifest.sessions).sort());
    for (const id of lessons) expect(r.all.tracks.some((t) => t.lesson === id && t.type === "summary")).toBe(true);
    for (const t of r.published.tracks) expect(t.status === "approved" && !!t.audioUrl && !!t.duration && !t.test).toBe(true);
  });
});

describe("song names: the day first, then the title", () => {
  it("names a song by its lesson's day: Day 5 · Song A", () => {
    expect(dayOf("day05")).toBe(5);
    expect(dayOf("day19")).toBe(19);
    expect(dayOf("interview-part1")).toBeNull();
    expect(songLabel("Our Own Server", "day19")).toBe("Day 19 · Our Own Server");
    expect(songLabel("Interview songs", "interview-part1")).toBe("Interview songs");
    const r = parse({ tracks: [song()] });
    expect(r.published.tracks[0]).toMatchObject({ day: 5, label: "Day 5 · Song A" });
  });

  it("puts songs in course order by day, keeping the manifest order within a day", () => {
    const r = parse({ tracks: [song({ id: "late", lesson: "day07" }), song({ id: "a1" }), song({ id: "a2" }), song({ id: "mid", lesson: "day06" })] });
    expect(courseOrder(r.published.tracks).map((t) => t.id)).toEqual(["a1", "a2", "mid", "late"]);
  });

  it("every published song in the real manifest has an English title (shown in the app and on the lock screen)", () => {
    const media = JSON.parse(fs.readFileSync(path.join(__dirname, "../../config/media.json"), "utf8"));
    const telugu = /[\u0C00-\u0C7F]/;
    const published = media.mulebeats.tracks.filter((t: { status: string; test?: boolean }) => t.status === "approved" && !t.test);
    expect(published.length).toBeGreaterThan(0);
    for (const t of published) expect(t.title, t.id).not.toMatch(telugu);
  });
});

describe("songs in Telugu", () => {
  it("a Telugu version takes the original's lesson, type and concepts, gets a Telugu style and a default title", () => {
    const r = parse({ tracks: [song(), { id: "beat-a-te", versionOf: "beat-a", language: "te", status: "planned" }] });
    expect(r.problems).toEqual([]);
    const te = r.all.tracks.find((t) => t.id === "beat-a-te")!;
    expect(te).toMatchObject({ lesson: "day05", type: "summary", concepts: ["one"], language: "te", versionOf: "beat-a", title: "Song A (Telugu)", genre: "Telugu hip-hop" });
    expect(r.all.tracks[0].language).toBe("en");
  });

  it("rejects versions of songs that don't exist, versions of versions, same-language versions and unknown languages", () => {
    const r = parse({ tracks: [
      song(),
      { id: "beat-x", versionOf: "beat-ghost", language: "te" },
      { id: "beat-a-te", versionOf: "beat-a", language: "te" },
      { id: "beat-a-te2", versionOf: "beat-a-te", language: "en" },
      { id: "beat-a-en", versionOf: "beat-a", language: "en" },
      song({ id: "beat-y", language: "fr" }),
    ] });
    const all = r.problems.join("\n");
    expect(all).toMatch(/beat-x\)\.versionOf "beat-ghost" does not exist/);
    expect(all).toMatch(/beat-a-te2\)\.versionOf "beat-a-te" is itself a version/);
    expect(all).toMatch(/beat-a-en\): a version must be in a different language/);
    expect(all).toMatch(/beat-y\)\.language must be one of en, te/);
  });

  it("every English song in the real manifest has a Telugu version", () => {
    const ROOT = path.resolve(__dirname, "../..");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".notes/manifest.json"), "utf8")) as { sessions: Record<string, unknown> };
    const media = JSON.parse(fs.readFileSync(path.join(ROOT, "config/media.json"), "utf8"));
    const problems: string[] = [];
    const { all } = parseBeats(media.mulebeats, Object.keys(manifest.sessions), problems, { checkUrl: checkMediaUrl });
    expect(problems).toEqual([]);
    const english = all.tracks.filter((t) => !t.test && t.language === "en");
    const telugu = new Set(all.tracks.filter((t) => t.language === "te").map((t) => t.versionOf));
    expect(english.length).toBeGreaterThan(0);
    for (const t of english) expect(telugu.has(t.id)).toBe(true);
  });
});

describe("choosing a style from what the song teaches", () => {
  it("lists get a chant, steps a story, comparisons two voices, deep ideas a calmer pace; denser songs run longer", () => {
    expect(planStyle("concept", "recall-list", 1).genre).toMatch(/chant/);
    expect(planStyle("summary", "process", 2).genre).toMatch(/hip-hop/);
    expect(planStyle("concept", "contrast", 2).genre).toMatch(/call-and-response/i);
    expect(planStyle("summary", "concept", 3).genre).toBe("Lo-fi hip-hop");
    expect(planStyle("concept", "recall-list", 1, "te").genre).toMatch(/Telugu folk-pop/);
    expect(planStyle("concept", "contrast", 1, "te").targetSecs).toBe(planStyle("concept", "contrast", 1).targetSecs);
    expect(planStyle("summary", "process", 1).targetSecs).toBeLessThan(planStyle("summary", "process", 3).targetSecs);
    expect(planStyle("concept", "process", 3).targetSecs).toBeLessThan(planStyle("summary", "process", 1).targetSecs);
  });
});

describe("the play queue", () => {
  it("moves next and previous, stopping at the ends unless repeating the playlist", () => {
    expect(stepIndex(0, 3, 1, "off")).toBe(1);
    expect(stepIndex(2, 3, 1, "off")).toBeNull();
    expect(stepIndex(2, 3, 1, "all")).toBe(0);
    expect(stepIndex(0, 3, -1, "all")).toBe(2);
    expect(stepIndex(0, 3, -1, "off")).toBeNull();
    expect(stepIndex(0, 0, 1, "all")).toBeNull();
  });

  it("after a song ends: the same again (repeat one), the next, or the end", () => {
    expect(afterEnd(1, 3, "one")).toBe(1);
    expect(afterEnd(1, 3, "off")).toBe(2);
    expect(afterEnd(2, 3, "off")).toBeNull();
    expect(afterEnd(2, 3, "all")).toBe(0);
  });

  it("shuffling keeps the playing song first and every song exactly once", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = ["a", "b", "c", "d", "e"];
    const s = shuffled(ids, "c", random);
    expect(s[0]).toBe("c");
    expect([...s].sort()).toEqual(ids);
    expect(shuffled(ids, null, random).sort()).toEqual(ids);
  });
});
