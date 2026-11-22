import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMediaUrl, parseMedia } from "../../src/lib/config";
import { afterEnd, parseBeats, planStyle, publish, shuffled, stepIndex } from "../../src/lib/mulebeats";

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

  it("a mistake in the manifest stops the build, like any media.json mistake", () => {
    expect(() => parseMedia({ podcasts: [], mulebeats: { tracks: [song({ lesson: "nope" })] } }, known)).toThrow(/lesson "nope" does not exist/);
  });

  it("the real config/media.json manifest is valid, covers Days 5–20, and publishes nothing that isn't approved", () => {
    const ROOT = path.resolve(__dirname, "../..");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".notes/manifest.json"), "utf8")) as { sessions: Record<string, unknown> };
    const media = JSON.parse(fs.readFileSync(path.join(ROOT, "config/media.json"), "utf8"));
    const problems: string[] = [];
    const r = parseBeats(media.mulebeats, Object.keys(manifest.sessions), problems, { checkUrl: checkMediaUrl });
    expect(problems).toEqual([]);
    const lessons = new Set(r.all.tracks.filter((t) => !t.test).map((t) => t.lesson));
    expect([...lessons].sort()).toEqual(["day05", "day06", "day07", "day08", "day09", "day10", "day11", "day12", "day13", "day14", "day15", "day16", "day17", "day18", "day19", "day20"]);
    for (const id of lessons) expect(r.all.tracks.some((t) => t.lesson === id && t.type === "summary")).toBe(true);
    for (const t of r.published.tracks) expect(t.status === "approved" && !!t.audioUrl && !!t.duration && !t.test).toBe(true);
  });
});

describe("choosing a style from what the song teaches", () => {
  it("lists get a chant, steps a story, comparisons two voices, deep ideas a calmer pace; denser songs run longer", () => {
    expect(planStyle("concept", "recall-list", 1).genre).toMatch(/chant/);
    expect(planStyle("summary", "process", 2).genre).toMatch(/hip-hop/);
    expect(planStyle("concept", "contrast", 2).genre).toMatch(/call-and-response/i);
    expect(planStyle("summary", "concept", 3).genre).toBe("Lo-fi hip-hop");
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
