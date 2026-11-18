import { expect, test, type Page } from "./test";
import AxeBuilder from "@axe-core/playwright";
import { seedServer, serverState } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

/** Signs in on the sign-in page (where every page sends you while signed out) and waits to be let in. */
async function signIn(page: Page, email = "ravi@example.com", password = "secret1") {
  if (!/\/account\//.test(page.url())) await page.goto("account/");
  const form = page.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
}
const letIn = (page: Page) => expect(page).not.toHaveURL(/\/account\//);

test.describe("members only: signing in", () => {
  test.use({ signedIn: false });
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });

  test("without signing in, any page sends you to sign in, then on to the page you wanted", async ({ page }) => {
    await page.goto("videos/day02/");
    await expect(page).toHaveURL(/account\/\?next=/);
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    // the sign-in screen stands alone: no menus into the site
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".bottom-nav")).toBeHidden();
    await signIn(page);
    await expect(page).toHaveURL(/videos\/day02\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a wrong password says so in plain words", async ({ page }) => {
    await signIn(page, "ravi@example.com", "nope");
    await expect(page.getByText("That email and password don't match")).toBeVisible();
    await expect(page).toHaveURL(/account\//);
  });

  test("after 30 days you have to sign in again", async ({ page }) => {
    await page.goto("account/");
    await signIn(page);
    await letIn(page);
    await page.evaluate(() => localStorage.setItem("mls.authAt", String(Date.now() - 31 * 864e5)));
    await page.goto("courses/");
    await expect(page).toHaveURL(/account\/\?next=.*expired=1/);
    await expect(page.getByText("You were signed in for 30 days")).toBeVisible();
    await signIn(page);
    await expect(page).toHaveURL(/courses\/$/);
  });

  test("signing in joins what you did before with the account, and shows your friends", async ({ page }) => {
    await page.goto("account/");
    await page.evaluate(() => localStorage.setItem("mls.completed", JSON.stringify(["day01"])));
    await seedServer(page, {
      progress: { u1: { data: { "mls.completed": ["day03"] }, at: { "mls.completed": 1000 } } },
      profiles: { u2: { name: "Sita", completed: 7, bookmarks: 0, cardsLearned: 12, quizRight: 3, lastTitle: "Day 7", lastHref: "/mule-learning-web/lessons/day07/", updated: Date.now() } },
      session: null,
    });
    await signIn(page);
    await letIn(page);
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("mls.completed") ?? "[]") as string[]);
    expect(local.sort()).toEqual(["day01", "day03"]);
    const server = await serverState(page);
    expect((server.progress.u1.data["mls.completed"] as string[]).sort()).toEqual(["day01", "day03"]);
    expect(server.profiles.u1).toMatchObject({ name: "Ravi", completed: 2 });
    await page.goto("account/");
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    await expect(page.getByText(/Signed in on this device until/)).toBeVisible();
    const friends = page.getByRole("region", { name: "Friends" });
    await expect(friends.getByText("Ravi (you)")).toBeVisible();
    await expect(friends.getByText("Sita")).toBeVisible();
    await expect(friends.getByText(/7 of \d+ lessons/)).toBeVisible();
    await expect(friends.getByRole("link", { name: "Day 7" })).toHaveAttribute("href", /lessons\/day07\/$/);
  });

  test("the sign-in page has no accessibility violations", async ({ page }) => {
    await page.goto("account/");
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
  });
});

test.describe("account and sync, signed in", () => {
  test.beforeEach(({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
  });

  test("a change reaches the account, including un-completing a lesson", async ({ page }) => {
    await page.goto("videos/day02/");
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect.poll(async () => (await serverState(page)).progress.u1?.data["mls.completed"], { timeout: 15_000 }).toEqual(["day02"]);
    await page.getByRole("button", { name: /Completed|Mark complete/ }).click();
    await expect.poll(async () => (await serverState(page)).progress.u1?.data["mls.completed"], { timeout: 15_000 }).toEqual([]);
  });

  test("progress made on another device comes down when you open the site", async ({ page }) => {
    await page.goto("account/");
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    const s = await serverState(page);
    s.progress.u1 ??= { data: {}, at: {} }; // nothing synced yet: a new account has no progress saved
    s.progress.u1.data["mls.bookmarks"] = ["day09"];
    s.progress.u1.at["mls.bookmarks"] = Date.now() + 60_000;
    await seedServer(page, s);
    await page.goto("my-study/");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("mls.bookmarks"))).toBe('["day09"]');
  });

  test("the menu shows who is signed in, and signing out locks the site again", async ({ page }) => {
    await page.goto("");
    if (width(page) > 800) await expect(page.locator(".side-profile")).toContainText("Ravi");
    await page.goto("account/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mls.account"))).toBeNull();
    await page.goto("lessons/");
    await expect(page).toHaveURL(/account\/\?next=/);
  });

  test("the account page has no accessibility violations", async ({ page }) => {
    await page.goto("account/");
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    expect((await axe(page)).violations).toEqual([]);
  });
});
