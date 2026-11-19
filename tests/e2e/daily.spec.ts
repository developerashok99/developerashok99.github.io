import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "./test";
import { sharedDb, startSignedIn, useFakeAccount, type SharedDb } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};
/** study activity where each of the given days (0 = today, -1 = yesterday…) earned `points` on one device */
const activity = (days: number[], points: number) => Object.fromEntries(days.map((d) => [day(d), { other: { q: points, g: 30 } }]));
const seed = (page: Page, data: Record<string, unknown>) =>
  page.addInitScript((d) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, JSON.stringify(v));
  }, data);

/** answers whatever the session shows until it's over: cards "Good", questions the first option */
async function playSession(page: Page) {
  const run = page.locator("[data-today-run]");
  for (let i = 0; i < 40 && (await run.isVisible()); i++) {
    const reveal = run.getByRole("button", { name: "Show answer" });
    if (await reveal.isVisible()) {
      await reveal.click();
      await run.getByRole("button", { name: /^Good/ }).click();
      continue;
    }
    await run.locator(".quiz__opt").first().click();
    await run.getByRole("button", { name: /^(Next|Finish)$/ }).click();
  }
}

test.describe("daily goal, today's session and mastery", () => {
  test("a first session mixes new flashcards and questions, earns points and fills today's goal ring", async ({ page }) => {
    await page.goto("today/");
    const start = page.getByRole("button", { name: "Start session" });
    await expect(page.locator("[data-today-summary]")).toContainText(/\d+ items · about \d+ minutes?/);
    await expect(page.locator("[data-today-parts]")).toContainText("questions from your weakest lessons");
    await start.click();
    await expect(page.locator("[data-today-kind]")).toBeVisible();
    await playSession(page);
    const done = page.getByRole("region", { name: "Session complete" });
    await expect(done).toBeVisible();
    await expect(done).toContainText(/\+\d+ study points\./);
    const points = Number(await page.locator("[data-goal-points]").textContent());
    expect(points).toBeGreaterThan(5);
    // saved like Revision and lesson quizzes: flashcard schedule, quiz answers and today's activity
    const saved = await page.evaluate(() => ({
      srs: Object.keys(JSON.parse(localStorage.getItem("mls.srs") || "{}")).length,
      quiz: Object.keys(JSON.parse(localStorage.getItem("mls.quiz") || "{}")).length,
      act: localStorage.getItem("mls.activity"),
    }));
    expect(saved.srs).toBe(3);
    expect(saved.quiz).toBe(5);
    expect(saved.act).toContain(new Date().toLocaleDateString("en-CA"));
  });

  test("Home shows the streak, the last 7 days, and readiness; one missed day a week is forgiven", async ({ page }) => {
    await seed(page, { "mls.activity": activity([-4, -3, -1], 40) });
    await page.goto("");
    const card = page.getByRole("region", { name: "Daily goal and streak" });
    await expect(card.locator("[data-goal-streak]")).toHaveText("3");
    await expect(card.locator('[data-goal-week] li[data-state="frozen"]')).toHaveCount(1);
    await expect(card.locator('[data-goal-week] li[data-state="today"]')).toHaveCount(1);
    await expect(card).toContainText("30 more points today keeps your 3-day streak going.");
    await expect(page.getByRole("link", { name: /Exam readiness: 0%/ })).toBeVisible();
    await card.getByRole("link", { name: "Start today's session" }).click();
    await expect(page).toHaveURL(/today\/$/);
  });

  test("reaching the goal says so; the daily goal can be changed in Preferences", async ({ page }) => {
    await seed(page, { "mls.activity": { [day(0)]: { other: { q: 10 } } } });
    await page.goto("preferences/");
    await page.getByRole("button", { name: /^Light · 15/ }).click();
    await expect(page.getByRole("button", { name: /^Light · 15/ })).toHaveAttribute("aria-pressed", "true");
    await page.goto("today/");
    await expect(page.locator("[data-goal-target]")).toHaveText("15");
    await page.getByRole("button", { name: "Start session" }).click();
    await playSession(page);
    await expect(page.locator("[data-toast]")).toContainText("Daily goal reached");
    await expect(page.locator('[data-goal-card]')).toHaveAttribute("data-met", "true");
  });

  test("Mastery: topics weakest first, a lesson map, and practising one exam topic", async ({ page }) => {
    // four right answers in Day 15 (error handling)
    const quiz = Object.fromEntries(["a", "b", "c", "d"].map((x) => [`quiz-day15:${x}`, { r: 1, w: 0, last: "right", at: Date.now() }]));
    await seed(page, { "mls.quiz": quiz });
    await page.goto("mastery/");
    await expect(page.locator("[data-rd-label]")).toHaveText("Just started");
    const errors = page.locator(".topic-row", { hasText: "Handling errors" });
    await expect(errors).toContainText("1 of 2 lessons tested");
    await expect(errors.locator(".topic-row__pct")).not.toHaveText("0%");
    // tested topics sort after untested ones (weakest first)
    await expect(page.locator(".topic-row").last()).toContainText("Handling errors");
    await expect(page.getByRole("link", { name: /^Day 15, .*% mastered$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Day 16, .*not tested yet$/ })).toBeVisible();
    await errors.getByRole("link", { name: "Practise Handling errors" }).click();
    await expect(page).toHaveURL(/today\/\?topic=errors$/);
    await expect(page.locator("[data-today-title]")).toHaveText("Practise: Handling errors");
    await expect(page.locator("[data-today-summary]")).toContainText("10 items");
    await page.getByRole("button", { name: "Start session" }).click();
    await expect(page.locator(".today__where a")).toContainText(/Day 1[56]/);
  });

  test("the mock-exam link opens a 60-question timed exam", async ({ page }) => {
    await page.goto("mastery/");
    await page.getByRole("link", { name: /Full mock exam/ }).click();
    await expect(page.locator('[data-mcq-count="60"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-mcq-mode="exam"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("the weekly league ranks you by this week's points, with your streak", async ({ page }) => {
    await seed(page, { "mls.activity": activity([-1, 0], 35) });
    await page.goto("account/");
    const league = page.getByRole("region", { name: "This week's league" });
    await expect(league).toBeVisible();
    await expect(league.locator(".league__row--me")).toContainText("Ravi (you)");
    await expect(league.locator(".league__row--me")).toContainText(/🔥 2-day streak/);
  });
});

/** Sita in a browser of her own, sharing the pretend database (presence and invites) with Ravi's. */
async function sita(browser: Browser, db: SharedDb, page: Page) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  await sharedDb(ctx, db);
  await useFakeAccount(ctx);
  await startSignedIn(ctx, "sita");
  const p = await ctx.newPage();
  await local(p);
  return p;
}
const local = (page: Page) => page.addInitScript(() => ((window as unknown as { __mlsTogetherTransport: string }).__mlsTogetherTransport = "local"));

test.describe("quiz battle", () => {
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });
  test.describe.configure({ timeout: 120_000 });

  test("inviting a friend to a battle gives them a pop-up that opens the battle", async ({ page, browser, db }) => {
    const s = await sita(browser, db, page);
    await s.goto("");
    await local(page);
    await page.goto("battle/");
    await page.getByRole("button", { name: "Create battle" }).click();
    await expect(page.locator("[data-battle-status]")).toContainText("Battle ready");
    await page.getByRole("button", { name: "Invite Sita to the quiz battle" }).click();
    const pop = s.getByRole("region", { name: "Invitation to a quiz battle" });
    await expect(pop).toContainText("Ravi invites you to a quiz battle.");
    await pop.getByRole("button", { name: "Join" }).click();
    // (the test connection can't reach between two browsers, so the game itself is played in two tabs below)
    await expect(s).toHaveURL(new RegExp(`battle/\\?room=${await page.evaluate(() => new URL((document.querySelector("[data-battle-link]") as HTMLInputElement).value).searchParams.get("room"))}$`));
    await expect(page.locator("[data-toast]")).toHaveText("Sita is joining you.");
    await s.context().close();
  });

  test("two players answer the same questions live; fast right answers score more; the host can play again", async ({ page, context }) => {
    await local(page);
    await page.goto("battle/");
    await page.getByRole("button", { name: "5", exact: true }).click();
    await page.getByRole("button", { name: "Create battle" }).click();
    await expect(page.locator("[data-battle-status]")).toContainText("Battle ready");
    const link = await page.locator("[data-battle-link]").inputValue();
    const friend = await context.newPage();
    await local(friend);
    await friend.goto(link.replace(/^.*?battle\//, "battle/"));
    await expect(friend.locator("[data-battle-status]")).toContainText("Waiting for the host to start.");
    await expect(page.locator("[data-battle-players] li")).toHaveCount(2);
    expect((await new AxeBuilder({ page }).include("[data-battle]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: /Start the battle \(2 players\)/ }).click();
    for (let i = 1; i <= 5; i++) {
      await expect(page.locator("[data-battle-n]")).toHaveText(`Question ${i} of 5`);
      await expect(friend.locator("[data-battle-n]")).toHaveText(`Question ${i} of 5`);
      await page.locator("[data-battle-options] .quiz__opt").first().click();
      await expect(page.locator("[data-battle-feedback]")).toContainText("Waiting for 1 more");
      await friend.locator("[data-battle-options] .quiz__opt").nth(1).click();
      // both answered: the answer and the scores show at once, on both screens
      await expect(page.locator("[data-battle-board] li")).toHaveCount(2);
      await expect(friend.locator("[data-battle-board] li")).toHaveCount(2);
      await expect(friend.locator('[data-battle-options] .quiz__opt[data-state="right"]')).toHaveCount(1);
    }
    await expect(page.locator("[data-battle-end]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-battle-winner]")).toHaveText(/won|wins|Results/);
    await expect(friend.locator("[data-battle-final] li")).toHaveCount(2);
    // the answers count as quiz answers (Mistakes, mastery, study points)
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mls.quiz") || "{}")).length)).toBe(5);
    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.locator("[data-battle-lobby]")).toBeVisible();
    await expect(friend.locator("[data-battle-lobby]")).toBeVisible();
    await page.locator("[data-battle-lobby]").getByRole("button", { name: "Leave" }).click();
    await expect(friend.locator("[data-battle-ended]")).toHaveText("The host ended the battle.");
  });
});
