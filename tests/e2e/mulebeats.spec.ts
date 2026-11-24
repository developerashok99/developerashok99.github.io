import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";

/** The test songs come from config/media.json (test: true), so names and lessons are read from there. */
const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
type T = { id: string; title: string; lesson: string; test?: boolean; audioUrl: string; language?: string; versionOf?: string };
const testSongs: T[] = media.mulebeats.tracks.filter((t: T) => t.test);
const english = testSongs.filter((t) => (t.language ?? "en") === "en");
const telugu = testSongs.filter((t) => t.language === "te");
const [one, two, three] = english;
/** how a song is named in the player and the video dialog: "Day 5 · Test song one" */
const label = (t: T) => `Day ${Number(t.lesson.replace("day", ""))} · ${t.title}`;
/** order tests use the English songs only */
const onlyEnglish = (page: Page) => page.getByRole("group", { name: "Song language" }).getByRole("button", { name: "English" }).click();
const missing = testSongs.find((t) => t.audioUrl.includes("missing"))!;

/** real songs come first now; the browser tests use the test playlist */
async function openTestPlaylist(page: Page) {
  await page.goto("mulebeats/");
  await page.locator('[data-mb-pick="test-playlist"]').click();
}
const player = (page: Page) => page.getByRole("region", { name: "Audio podcast player" });
/** the test playlist's list (a song also appears in "All songs", which comes first on the page) */
const tp = (page: Page) => page.locator('[data-mb-playlist="test-playlist"]');
const title = (page: Page) => player(page).locator("[data-title]");
const ended = (page: Page) => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => a.dispatchEvent(new Event("ended")));
async function openControls(page: Page) {
  const more = player(page).getByRole("button", { name: "Show all player controls" });
  if (await more.isVisible()) await more.click();
}

test.describe("MuleBeats", () => {
  test("lists each song with its lesson, type, genre and length, and links to the lesson", async ({ page }) => {
    await openTestPlaylist(page);
    const row = tp(page).locator(`[data-mb-track="${one.id}"]`);
    await expect(row).toContainText(one.title);
    await expect(row).toContainText("Lesson summary");
    await expect(row).toContainText("Test tone");
    await expect(row.locator(".mb-track__tags")).toContainText(/\d/);
    await expect(tp(page).locator(`[data-mb-track="${two.id}"]`)).toContainText("Concept song");
    expect((await new AxeBuilder({ page }).include("[data-mulebeats]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await row.getByRole("link", { name: /^Day 5/ }).click();
    await expect(page).toHaveURL(/lessons\/day05\/$/);
  });

  test("Play all plays in order; next, previous and the Up next list follow the playlist", async ({ page }) => {
    await openTestPlaylist(page);
    await onlyEnglish(page);
    await page.getByRole("button", { name: "Play all" }).click();
    await expect(title(page)).toHaveText(label(one));
    await expect.poll(() => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => !a.paused), { timeout: 10_000 }).toBe(true);
    await expect(page.locator("[data-mb-queue-list]")).toContainText(label(two));
    await openControls(page);
    await player(page).getByRole("button", { name: "Next song" }).click();
    await expect(title(page)).toHaveText(label(two));
    await player(page).getByRole("button", { name: "Previous song" }).click();
    await expect(title(page)).toHaveText(label(one));
    // when a song ends, the next one starts
    await ended(page);
    await expect(title(page)).toHaveText(label(two));
    await expect(tp(page).locator(`[data-mb-track="${two.id}"]`)).toHaveAttribute("data-current", "true");
    // a song in the Up next list (folded under its heading) plays when picked
    await page.locator("[data-mb-now] summary").click();
    await page.locator("[data-mb-queue-list]").getByRole("button", { name: label(three) }).click();
    await expect(title(page)).toHaveText(label(three));
  });

  test("repeat one replays the song, repeat all wraps around, and shuffle keeps the current song playing", async ({ page }) => {
    await openTestPlaylist(page);
    await onlyEnglish(page);
    await tp(page).locator(`[data-mb-play="${three.id}"]`).click();
    await expect(title(page)).toHaveText(label(three));
    await openControls(page);
    const repeat = player(page).locator('[data-act="repeat"]');
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: the playlist");
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: this song");
    await ended(page);
    await expect(title(page)).toHaveText(label(three));
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: off");
    // with repeat all, next from the last song goes back to the first
    await repeat.click();
    await tp(page).locator(`[data-mb-play="${missing.id}"]`).click();
    await player(page).getByRole("button", { name: "Next song" }).click();
    await expect(title(page)).toHaveText(label(one));
    const shuffle = player(page).locator('[data-act="shuffle"]');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute("aria-pressed", "true");
    await expect(title(page)).toHaveText(label(one));
    await expect(page.locator("[data-mb-queue-about]")).toContainText("shuffled");
    await expect(page.locator("[data-mb-queue-list] li")).toHaveCount(english.length - 1);
  });

  test("the language switch shows English or Telugu songs, plays only those, and is remembered", async ({ page }) => {
    await openTestPlaylist(page);
    const lang = page.getByRole("group", { name: "Song language" });
    await lang.getByRole("button", { name: "Telugu" }).click();
    await expect(lang.getByRole("button", { name: "Telugu" })).toHaveAttribute("aria-pressed", "true");
    const visible = page.locator('[data-mb-playlist="test-playlist"] [data-mb-track]:visible');
    await expect(visible).toHaveCount(telugu.length);
    await expect(visible.first()).toContainText("Telugu");
    await expect(visible.first()).toContainText("Lesson summary");
    await page.getByRole("button", { name: "Play all" }).click();
    await expect(title(page)).toContainText(telugu[0].title);
    await expect(page.locator("[data-mb-queue]")).toBeVisible();
    await expect(page.locator("[data-mb-queue-list] li")).toHaveText(["Nothing after this song."]);
    await page.reload();
    await page.locator('[data-mb-pick="test-playlist"]').click();
    await expect(page.getByRole("group", { name: "Song language" }).getByRole("button", { name: "Telugu" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("group", { name: "Song language" }).getByRole("button", { name: "All" }).click();
    await expect(page.locator('[data-mb-playlist="test-playlist"] [data-mb-track]:visible')).toHaveCount(testSongs.length);
  });

  test("a song's lyric video opens in a player and pauses the audio player", async ({ page }) => {
    await openTestPlaylist(page);
    await page.getByRole("button", { name: "Play all" }).click();
    await expect.poll(() => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => !a.paused), { timeout: 10_000 }).toBe(true);
    const row = page.locator('[data-mb-playlist="test-playlist"]').locator(`[data-mb-track="${one.id}"]`);
    await row.getByRole("button", { name: "Watch video" }).click();
    const dialog = page.getByRole("dialog", { name: label(one) });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("video")).toHaveAttribute("src", /fixture-video\.mp4$/);
    expect(await page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    expect((await new AxeBuilder({ page }).include("[data-mb-video-dialog]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: "Close the video" }).click();
    await expect(dialog).toBeHidden();
    // songs without a video have no button
    await expect(page.locator('[data-mb-playlist="test-playlist"]').locator(`[data-mb-track="${three.id}"]`).getByRole("button", { name: "Watch video" })).toHaveCount(0);
  });

  test("songs are named by day: a Day badge in the list, Day N · title in the player; All songs comes first", async ({ page }) => {
    await page.goto("mulebeats/");
    await expect(page.locator("[data-mb-pick]").first()).toContainText("All songs");
    await expect(page.locator("[data-mb-pick]").first()).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-mb-pick="test-playlist"]').click();
    const row = page.locator('[data-mb-playlist="test-playlist"]').locator(`[data-mb-track="${one.id}"]`);
    await expect(row.locator(".mb-day")).toHaveText("Day 5");
    await row.getByRole("button", { name: `Play ${label(one)}` }).click();
    await expect(title(page)).toHaveText(label(one));
    // the slim phone player keeps Next song one tap away for a playlist
    await expect(player(page).getByRole("button", { name: "Next song" })).toBeVisible();
  });

  test("Now playing shows the song with previous, play / pause and next, and opens its video", async ({ page }) => {
    await openTestPlaylist(page);
    await onlyEnglish(page);
    const now = page.getByRole("region", { name: /Now playing/ });
    await expect(now).toBeHidden();
    await page.getByRole("button", { name: "Play all" }).click();
    await expect(now).toBeVisible();
    await expect(now.locator("[data-mb-now-title]")).toHaveText(label(one));
    await expect(now.getByRole("button", { name: "Previous song" })).toBeDisabled();
    await now.getByRole("button", { name: "Next song" }).click();
    await expect(now.locator("[data-mb-now-title]")).toHaveText(label(two));
    await expect(title(page)).toHaveText(label(two));
    await now.getByRole("button", { name: "Previous song" }).click();
    await expect(now.locator("[data-mb-now-title]")).toHaveText(label(one));
    await expect.poll(() => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => !a.paused), { timeout: 10_000 }).toBe(true);
    await now.getByRole("button", { name: "Pause" }).click();
    expect(await page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    await expect(now.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await now.getByRole("button", { name: "Shuffle: off" }).click();
    await expect(now.getByRole("button", { name: "Shuffle: on" })).toHaveAttribute("aria-pressed", "true");
    await now.getByRole("button", { name: "Watch video" }).click();
    await expect(page.getByRole("dialog", { name: label(one) })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("[data-mulebeats]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });

  test("the video player steps to the next and previous video, and plays the next one when a video ends", async ({ page }) => {
    await openTestPlaylist(page);
    await onlyEnglish(page);
    await page.locator('[data-mb-playlist="test-playlist"]').locator(`[data-mb-track="${one.id}"]`).getByRole("button", { name: "Watch video" }).click();
    const dialog = page.locator("[data-mb-video-dialog]");
    await expect(dialog.locator("[data-mb-video-title]")).toHaveText(label(one));
    await expect(dialog.getByRole("button", { name: "Previous video" })).toBeDisabled();
    await expect(dialog.locator("[data-mb-video-upnext]")).toHaveText(`Up next: ${label(two)}`);
    await dialog.getByRole("button", { name: "Next video" }).click();
    await expect(dialog.locator("[data-mb-video-title]")).toHaveText(label(two));
    await expect(dialog.getByRole("button", { name: "Next video" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Previous video" }).click();
    await expect(dialog.locator("[data-mb-video-title]")).toHaveText(label(one));
    // watching straight through
    await dialog.locator("video").evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event("ended")));
    await expect(dialog.locator("[data-mb-video-title]")).toHaveText(label(two));
  });

  test("a song whose audio can't be loaded says so, in the list and in the player", async ({ page }) => {
    await openTestPlaylist(page);
    await tp(page).locator(`[data-mb-play="${missing.id}"]`).click();
    await expect(player(page).locator("[data-status]")).toContainText("Can't play", { timeout: 15_000 });
    await expect(tp(page).locator(`[data-mb-track="${missing.id}"] [data-mb-error]`)).toBeVisible();
  });

  test("playing a podcast afterwards leaves the playlist: no shuffle or repeat, podcast next/previous as before", async ({ page }) => {
    await openTestPlaylist(page);
    await page.getByRole("button", { name: "Play all" }).click();
    await expect(player(page).locator('[data-act="shuffle"]')).toBeAttached();
    await page.goto("podcasts/test-fixture/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).first().click();
    await expect(title(page)).toHaveText("Player test (fixture media)");
    await expect(player(page).locator('[data-act="shuffle"]')).toBeHidden();
    await expect(player(page).locator('[data-act="next"]')).toHaveAttribute("aria-label", "Next episode");
  });

  test("with no approved songs the page says they're on the way (production build only)", async ({ page }) => {
    test.skip(testSongs.length > 0 && process.env.MULEBEATS_EMPTY !== "1", "the test build includes test songs; run with MULEBEATS_EMPTY=1 against a production build");
    await page.goto("mulebeats/");
    await expect(page.getByRole("heading", { name: "No songs yet" })).toBeVisible();
  });
});
