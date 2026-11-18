import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";
import { useFakeYouTube, yt } from "./fake-yt";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
/** Lesson ids that have a lecture video, in course order (media.json keeps course order). */
const ids = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .filter(([, l]) => l.youtube?.trim())
  .map(([id]) => id);

test.describe("videos tab", () => {
  test("lists every video from Day 1, with the current one at the top", async ({ page }) => {
    await page.goto("videos/");
    await expect(page.getByRole("navigation", { name: "All course videos" }).getByRole("link")).toHaveCount(ids.length);
    await expect(page.locator(".video-list a").first()).toContainText("Day 1");
    await expect(page.locator('.video-list a[aria-current="page"]')).toContainText("Day 1");
    await expect(page.getByRole("button", { name: /Play video: Day 1/ })).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]', { hasText: "Previous" })).toBeVisible();
  });

  test("next and previous move through the videos and start playing", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.locator('a[data-video-go="next"]').click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[5]}/$`));
    await expect(page.locator(".video-frame iframe")).toHaveCount(1);
    await page.locator('a[data-video-go="prev"]').click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(page.locator('.video-list a[aria-current="page"]')).toHaveAttribute("href", new RegExp(`videos/${ids[4]}/$`));
  });

  test("the last video has no next", async ({ page }) => {
    await page.goto(`videos/${ids.at(-1)}/`);
    await expect(page.locator('a[data-video-go="next"]')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]', { hasText: "Next" })).toBeVisible();
  });

  test("the playlist can be filtered and shows completed lessons", async ({ page }) => {
    await page.goto(`videos/${ids[0]}/`);
    const list = page.getByRole("navigation", { name: "All course videos" });
    await list.getByLabel("Filter videos").fill("Day 12");
    await expect(list.locator("li:visible")).toHaveCount(1);
    await list.getByLabel("Filter videos").fill("zzzz-no-such-video");
    await expect(list.getByText("No videos match.")).toBeVisible();
    // completing a lesson marks it in the playlist
    await page.goto(`lessons/${ids[1]}/`);
    await page.locator("[data-toggle-done]").click();
    await page.goto(`videos/${ids[0]}/`);
    await expect(page.locator(`.video-list li[data-lesson-done="${ids[1]}"]`)).toHaveAttribute("data-status", "done");
  });

  test("study actions on the video page match the lesson", async ({ page }) => {
    await page.goto(`videos/${ids[2]}/`);
    await page.getByRole("button", { name: "Mark complete" }).click();
    await page.getByRole("button", { name: "Bookmark" }).click();
    await expect(page.locator("[data-video-done]")).toHaveAttribute("aria-pressed", "true");
    await page.goto(`lessons/${ids[2]}/`);
    await expect(page.locator("[data-toggle-done]")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-toggle-bookmark]")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: /Watch in the video player/ }).click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[2]}/$`));
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto(`videos/${ids[1]}/`);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("lecture progress", () => {
  test("you resume where you stopped, watching 90% marks the lesson complete, and the playlist shows it", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) !== 1440 && (page.viewportSize()?.width ?? 0) !== 390, "one phone and one desktop size");
    await useFakeYouTube(page);
    const id = ids[2];
    await page.goto(`videos/${id}/`);
    await page.locator("button[data-yt]").click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await yt(page).seek(1000);
    await yt(page).run("pauseVideo");
    await expect.poll(() => page.evaluate((v) => JSON.parse(localStorage.getItem("mls.lectures") ?? "{}")[v]?.pos, id)).toBe(1000);
    await page.reload();
    await expect(page.locator("button[data-yt] small")).toHaveText("Resume at 16:40 · 20% watched");
    await page.locator("button[data-yt]").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeYt?: { vars?: { start?: number } } }).__fakeYt?.vars?.start)).toBe(1000);
    // jump near the end: 92% counts as watched, and the lesson is marked complete
    await expect.poll(() => yt(page).state()).toBe(1);
    await yt(page).seek(4600);
    await yt(page).run("pauseVideo");
    await expect(page.getByRole("button", { name: "Completed" })).toBeVisible();
    await expect(page.locator(`.video-list a[href$="/videos/${id}/"] .video-list__watched`)).toHaveAttribute("data-done", "true");
    await page.reload();
    await expect(page.locator("button[data-yt] small")).toHaveText("Watched ✓ · click to watch again");
  });
});
