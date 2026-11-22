import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";

/** The test songs come from config/media.json (test: true), so names and lessons are read from there. */
const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
type T = { id: string; title: string; lesson: string; test?: boolean; audioUrl: string };
const testSongs: T[] = media.mulebeats.tracks.filter((t: T) => t.test);
const [one, two, three] = testSongs;
const missing = testSongs.find((t) => t.audioUrl.includes("missing"))!;

const player = (page: Page) => page.getByRole("region", { name: "Audio podcast player" });
const title = (page: Page) => player(page).locator("[data-title]");
const ended = (page: Page) => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => a.dispatchEvent(new Event("ended")));
async function openControls(page: Page) {
  const more = player(page).getByRole("button", { name: "Show all player controls" });
  if (await more.isVisible()) await more.click();
}

test.describe("MuleBeats", () => {
  test("lists each song with its lesson, type, genre and length, and links to the lesson", async ({ page }) => {
    await page.goto("mulebeats/");
    const row = page.locator(`[data-mb-track="${one.id}"]`).first();
    await expect(row).toContainText(one.title);
    await expect(row).toContainText("Lesson summary");
    await expect(row).toContainText("Test tone");
    await expect(row.locator(".mb-track__tags")).toContainText(/\d/);
    await expect(page.locator(`[data-mb-track="${two.id}"]`).first()).toContainText("Concept song");
    expect((await new AxeBuilder({ page }).include("[data-mulebeats]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await row.getByRole("link", { name: /^Day 5/ }).click();
    await expect(page).toHaveURL(/lessons\/day05\/$/);
  });

  test("Play all plays in order; next, previous and the Up next list follow the playlist", async ({ page }) => {
    await page.goto("mulebeats/");
    await page.getByRole("button", { name: "Play all" }).click();
    await expect(title(page)).toHaveText(one.title);
    await expect.poll(() => page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => !a.paused), { timeout: 10_000 }).toBe(true);
    await expect(page.locator("[data-mb-queue-list]")).toContainText(two.title);
    await openControls(page);
    await player(page).getByRole("button", { name: "Next song" }).click();
    await expect(title(page)).toHaveText(two.title);
    await player(page).getByRole("button", { name: "Previous song" }).click();
    await expect(title(page)).toHaveText(one.title);
    // when a song ends, the next one starts
    await ended(page);
    await expect(title(page)).toHaveText(two.title);
    await expect(page.locator(`[data-mb-track="${two.id}"]`).first()).toHaveAttribute("data-current", "true");
    // a song in the Up next list plays when picked
    await page.locator("[data-mb-queue-list]").getByRole("button", { name: three.title }).click();
    await expect(title(page)).toHaveText(three.title);
  });

  test("repeat one replays the song, repeat all wraps around, and shuffle keeps the current song playing", async ({ page }) => {
    await page.goto("mulebeats/");
    await page.locator(`[data-mb-play="${three.id}"]`).first().click();
    await expect(title(page)).toHaveText(three.title);
    await openControls(page);
    const repeat = player(page).locator('[data-act="repeat"]');
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: the playlist");
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: this song");
    await ended(page);
    await expect(title(page)).toHaveText(three.title);
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-label", "Repeat: off");
    // with repeat all, next from the last song goes back to the first
    await repeat.click();
    await page.locator(`[data-mb-play="${missing.id}"]`).first().click();
    await player(page).getByRole("button", { name: "Next song" }).click();
    await expect(title(page)).toHaveText(one.title);
    const shuffle = player(page).locator('[data-act="shuffle"]');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute("aria-pressed", "true");
    await expect(title(page)).toHaveText(one.title);
    await expect(page.locator("[data-mb-queue-about]")).toContainText("shuffled");
    await expect(page.locator("[data-mb-queue-list] li")).toHaveCount(testSongs.length - 1);
  });

  test("a song whose audio can't be loaded says so, in the list and in the player", async ({ page }) => {
    await page.goto("mulebeats/");
    await page.locator(`[data-mb-play="${missing.id}"]`).first().click();
    await expect(player(page).locator("[data-status]")).toContainText("Can't play", { timeout: 15_000 });
    await expect(page.locator(`[data-mb-track="${missing.id}"] [data-mb-error]`).first()).toBeVisible();
  });

  test("playing a podcast afterwards leaves the playlist: no shuffle or repeat, podcast next/previous as before", async ({ page }) => {
    await page.goto("mulebeats/");
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
