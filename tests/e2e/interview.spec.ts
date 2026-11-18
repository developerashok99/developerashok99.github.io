import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./test";
import { serverState } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;

test.describe("mock interview", () => {
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });

  test("a five-question interview: answer, reveal, rate, see the score, and it's saved and synced", async ({ page }) => {
    await page.goto("interview/");
    await page.getByRole("button", { name: "5", exact: true }).click();
    await page.getByRole("button", { name: "No limit" }).click();
    await page.getByRole("button", { name: "Start interview" }).click();
    const live = page.getByRole("region", { name: /Question 1 of 5/ });
    await expect(live).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await expect(page.getByText(`Question ${i + 1} of 5`)).toBeVisible();
      await page.getByRole("button", { name: /show the model answer/ }).click();
      await expect(page.getByRole("heading", { name: /Model answer/ })).toBeVisible();
      // nailed, nailed, partly, missed, nailed
      await page.getByRole("button", { name: ["Nailed it", "Nailed it", "Partly", "Missed it", "Nailed it"][i] }).click();
    }
    const summary = page.getByRole("region", { name: "Interview finished" });
    await expect(summary.getByText("70%")).toBeVisible();
    await expect(summary.getByText(/3 nailed, 1 partly, 1 missed/)).toBeVisible();
    await expect(summary.locator("li")).toHaveCount(5);
    await expect(summary.getByRole("button", { name: "Practise the ones I missed" })).toBeVisible();
    // saved here, listed in the history, and synced to the account
    await expect(page.locator("[data-iv-history] tr")).toHaveCount(1);
    await expect(page.locator("[data-iv-history] tr td").nth(3)).toHaveText("70%");
    await expect.poll(async () => ((await serverState(page)).progress.u1?.data["mls.interviews"] as unknown[] | undefined)?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await serverState(page)).profiles.u1 as unknown, { timeout: 15_000 }).toMatchObject({ interviews: 1, interviewScore: 70 });
    // the missed question is due now in the flashcards
    const due = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mls.srs") ?? "{}") as Record<string, { due: number }>).filter((c) => c.due <= Date.now() + 11 * 60_000).length);
    expect(due).toBe(1);
    // retry just the missed one
    await summary.getByRole("button", { name: "Practise the ones I missed" }).click();
    await expect(page.getByText("Question 1 of 1")).toBeVisible();
  });

  test("ending early keeps the questions you answered", async ({ page }) => {
    await page.goto("interview/");
    await page.getByRole("button", { name: "Start interview" }).click();
    await expect(page.locator("[data-iv-timer]")).toHaveText(/^[12]:\d\d$/);
    await page.getByRole("button", { name: /show the model answer/ }).click();
    await page.getByRole("button", { name: "Nailed it" }).click();
    await page.getByRole("button", { name: "End interview" }).click();
    await expect(page.getByRole("region", { name: "Interview finished" }).getByText("100%")).toBeVisible();
  });

  test("the interview page has no accessibility violations, before and during an interview", async ({ page }) => {
    await page.goto("interview/");
    const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect((await axe()).violations).toEqual([]);
    await page.getByRole("button", { name: "Start interview" }).click();
    await page.getByRole("button", { name: /show the model answer/ }).click();
    expect((await axe()).violations).toEqual([]);
  });
});
