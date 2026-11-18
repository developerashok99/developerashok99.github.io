import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./test";
import { seedServer, serverState } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;

test.describe("MCQ tests", () => {
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });

  test("an exam: answer, flag, finish, see the mark, topics and review; saved and synced", async ({ page }) => {
    await page.goto("mcq/");
    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Start test" }).click();
    await expect(page.getByText("Question 1 of 10")).toBeVisible();
    await expect(page.locator("[data-mcq-timer]")).toHaveText(/^(19|20):\d\d$/);
    // answer the first 9 with the first option, flag one, leave the last unanswered
    for (let i = 0; i < 9; i++) {
      await page.locator("[data-mcq-options] .quiz__opt").first().click();
      if (i === 2) await page.getByRole("button", { name: "Flag for review" }).click();
      await page.getByRole("button", { name: /^Next/ }).click();
    }
    await expect(page.getByText("Question 10 of 10")).toBeVisible();
    await page.locator(".mcq-map summary").click();
    await expect(page.locator('[data-mcq-map] button[data-state="flagged"]')).toHaveCount(1);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Finish test" }).click();
    const res = page.getByRole("region", { name: "Test result" });
    await expect(res).toBeVisible();
    await expect(res.getByText(/of 10 right \(70% to pass\)/)).toBeVisible();
    await expect(res.locator("[data-mcq-sections] li").first()).toBeVisible();
    // the unanswered one is at least in the review
    await expect(res.getByText("Your answer: none")).toBeVisible();
    await expect(page.locator("[data-mcq-history] tr")).toHaveCount(1);
    await expect.poll(async () => ((await serverState(page)).progress.u1?.data["mls.mcqTests"] as unknown[] | undefined)?.length, { timeout: 15_000 }).toBe(1);
    // answers count like lesson quiz answers (for the Mistakes page)
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mls.quiz") ?? "{}")).length)).toBe(9);
  });

  test("practice mode shows right or wrong straight away", async ({ page }) => {
    await page.goto("mcq/");
    await page.getByRole("button", { name: "Practice" }).click();
    await page.getByRole("button", { name: "Start test" }).click();
    await expect(page.locator("[data-mcq-timer]")).toBeHidden();
    await page.locator("[data-mcq-options] .quiz__opt").first().click();
    await expect(page.locator("[data-mcq-verdict]")).toHaveText(/Correct|Not quite/);
    await expect(page.locator('[data-mcq-options] .quiz__opt[data-state="right"]')).toHaveCount(1);
  });

  test("the question bank: add your own question, see it in a test, edit and delete it; friends' can't be changed", async ({ page }) => {
    await page.goto("mcq/");
    const s = await serverState(page);
    await seedServer(page, { ...s, mcqs: { f1: { q: "Which scope retries a failing operation?", options: ["Until Successful", "Try", "Async"], answer: 0, explain: "", lid: "", author: "u2", authorName: "Sita", created: 1, updated: 1 } } });
    await page.reload();
    const bank = page.getByRole("region", { name: "Question bank" });
    await expect(bank.getByText("Which scope retries a failing operation?")).toBeVisible();
    await expect(bank.getByText("Added by Sita")).toBeVisible();
    await expect(bank.getByRole("button", { name: "Edit" })).toHaveCount(0);

    await bank.getByRole("button", { name: "Add a question" }).click();
    const form = page.getByRole("form", { name: "Add a question" });
    await form.getByLabel("Question").fill("short");
    await form.getByRole("button", { name: "Save question" }).click();
    await expect(form.getByText(/at least 10 characters/)).toBeVisible();
    await form.getByLabel("Question").fill("What does `vars.orderId` hold after a Set Variable?");
    await form.getByLabel("Option A", { exact: true }).fill("The value set");
    await form.getByLabel("Option B", { exact: true }).fill("Nothing");
    await form.getByLabel("Option A is right").check();
    await form.getByRole("button", { name: "Save question" }).click();
    await expect(bank.getByText("Added by you")).toBeVisible();
    await expect(bank.locator("code", { hasText: "vars.orderId" })).toBeVisible();
    expect(Object.values((await serverState(page) as unknown as { mcqs: Record<string, { author: string }> }).mcqs).filter((m) => m.author === "u1")).toHaveLength(1);

    // only friends' questions: both appear in the test
    await page.locator("[data-mcq-topic]").selectOption("friends");
    await page.getByRole("button", { name: "Practice" }).click();
    await page.getByRole("button", { name: "Start test" }).click();
    await expect(page.getByText("Question 1 of 2")).toBeVisible();
    await expect(page.locator("[data-mcq-where]")).toContainText("From");
    await page.reload();

    await bank.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("form", { name: "Edit your question" }).getByLabel("Option B", { exact: true }).fill("Null");
    await page.getByRole("form", { name: "Edit your question" }).getByRole("button", { name: "Save question" }).click();
    await expect(bank.getByText("Null")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await bank.getByRole("button", { name: "Delete" }).click();
    await expect(bank.getByText("Added by you")).toHaveCount(0);
  });

  test("the MCQ page has no accessibility violations, before and during a test", async ({ page }) => {
    await page.goto("mcq/");
    const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await expect(page.locator("[data-mcq-bank-status]")).not.toHaveText("Loading the question bank…");
    expect((await axe()).violations).toEqual([]);
    await page.getByRole("button", { name: "Start test" }).click();
    await page.locator("[data-mcq-options] .quiz__opt").first().click();
    expect((await axe()).violations).toEqual([]);
  });
});
