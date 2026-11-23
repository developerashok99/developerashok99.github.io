import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "./test";
import { seedServer, serverState, sharedDb, startSignedIn, useFakeAccount, type SharedDb } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;
const local = (page: Page) => page.addInitScript(() => ((window as unknown as { __mlsTogetherTransport: string }).__mlsTogetherTransport = "local"));

/** Sita, signed in in a browser of her own, sharing the pretend database with Ravi's. */
async function sita(browser: Browser, db: SharedDb, page: Page) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  await sharedDb(ctx, db);
  await useFakeAccount(ctx);
  await startSignedIn(ctx, "sita");
  const p = await ctx.newPage();
  await local(p);
  return p;
}
const SITA_PROFILE = { name: "Sita", completed: 3, bookmarks: 0, cardsLearned: 0, quizRight: 0, lastTitle: "", lastHref: "", updated: Date.now() };

test.describe("friends online and invites", () => {
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });

  test("you see who's online and what they're watching, and can join their room without a link", async ({ page, browser, db }) => {
    const s = await sita(browser, db, page);
    await s.goto("videos/day02/");
    await s.getByRole("button", { name: "Watch together" }).click();
    await expect(s.getByRole("region", { name: "Watch together" })).toBeVisible();

    await local(page);
    await page.goto("account/");
    await seedServer(page, { ...(await serverState(page)), profiles: { u2: SITA_PROFILE } });
    await page.reload();
    if (width(page) > 800) {
      await expect(page.locator("[data-side-online]")).toContainText("1 online");
      await expect(page.locator("[data-side-online]")).toContainText("Sita");
    }
    const row = page.locator('.friend[data-uid="u2"]');
    await expect(row).toHaveAttribute("data-online", "true");
    await expect(row).toContainText(/Online · watching .* together/);
    await row.getByRole("button", { name: /Join Sita/ }).click();
    await expect(page).toHaveURL(/videos\/day02\/\?room=/);
    await s.context().close();
  });

  test("invite a friend: they get a pop-up, join with one tap, and you're told they're coming", async ({ page, browser, db }) => {
    const s = await sita(browser, db, page);
    await s.goto("");
    await local(page);
    await page.goto("videos/day03/");
    await page.getByRole("button", { name: "Watch together" }).click();
    const panel = page.getByRole("region", { name: "Watch together" });
    await panel.getByRole("button", { name: "Invite Sita to watch together" }).click();
    await expect(panel.getByRole("button", { name: "Invite Sita to watch together" })).toHaveText("Invited");

    const pop = s.getByRole("region", { name: "Invitation to watch together" });
    await expect(pop).toContainText("Ravi invites you to watch");
    // the pop-up fades in; check its colours once it's fully shown (mid-fade, every colour looks paler)
    await pop.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    expect((await new AxeBuilder({ page: s }).include("[data-invite-pop]").analyze()).violations).toEqual([]);
    await pop.getByRole("button", { name: "Join" }).click();
    await expect(s).toHaveURL(/videos\/day03\/\?room=/);
    await expect(pop).toBeHidden();
    await expect(page.locator("[data-toast]")).toHaveText("Sita is joining you.");
    await s.context().close();
  });

  test("“Not now” closes the pop-up and tells the inviter", async ({ page, browser, db }) => {
    const s = await sita(browser, db, page);
    await s.goto("courses/");
    await local(page);
    await page.goto("podcasts/day01/");
    await page.getByRole("button", { name: "Watch together" }).click();
    await page.getByRole("button", { name: "Invite Sita to watch together" }).click();
    const pop = s.getByRole("region", { name: "Invitation to watch together" });
    await pop.getByRole("button", { name: "Not now" }).click();
    await expect(pop).toBeHidden();
    await expect(s).toHaveURL(/courses\/$/);
    await expect(page.locator("[data-toast]")).toHaveText("Sita can't join right now.");
    await s.context().close();
  });
});
