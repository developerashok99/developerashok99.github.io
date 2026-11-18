import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedServer, serverState, useFakeAccount } from "./fake-account";

const width = (page: Page) => page.viewportSize()?.width ?? 0;

async function signIn(page: Page, email = "ravi@example.com", password = "secret1") {
  await page.goto("account/");
  const form = page.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
}

test.describe("account and sync", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(width(page) !== 390 && width(page) !== 1440, "one phone and one desktop size");
    await useFakeAccount(page);
  });

  test("a wrong password says so in plain words", async ({ page }) => {
    await signIn(page, "ravi@example.com", "nope");
    await expect(page.getByText("That email and password don't match")).toBeVisible();
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
  });

  test("signing in keeps what you did before, sends it to the account, and shows your friends", async ({ page }) => {
    await page.goto("");
    await page.evaluate(() => localStorage.setItem("mls.completed", JSON.stringify(["day01"])));
    await seedServer(page, {
      progress: { u1: { data: { "mls.completed": ["day03"] }, at: { "mls.completed": 1000 } } },
      profiles: { u2: { name: "Sita", completed: 7, bookmarks: 0, cardsLearned: 12, quizRight: 3, lastTitle: "Day 7", lastHref: "/mule-learning-web/lessons/day07/", updated: Date.now() } },
      session: null,
    });
    await signIn(page);
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    // both devices' lessons are kept
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("mls.completed") ?? "[]") as string[]);
    expect(local.sort()).toEqual(["day01", "day03"]);
    const server = await serverState(page);
    expect((server.progress.u1.data["mls.completed"] as string[]).sort()).toEqual(["day01", "day03"]);
    expect(server.profiles.u1).toMatchObject({ name: "Ravi", completed: 2 });
    const friends = page.getByRole("region", { name: "Friends" });
    await expect(friends.getByText("Ravi (you)")).toBeVisible();
    await expect(friends.getByText("Sita")).toBeVisible();
    await expect(friends.getByText(/7 of \d+ lessons/)).toBeVisible();
    await expect(friends.getByRole("link", { name: "Day 7" })).toHaveAttribute("href", /lessons\/day07\/$/);
  });

  test("a change after signing in reaches the account, including un-completing a lesson", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    await page.goto("videos/day02/");
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect.poll(async () => (await serverState(page)).progress.u1?.data["mls.completed"], { timeout: 15_000 }).toEqual(["day02"]);
    await page.getByRole("button", { name: /Completed|Mark complete/ }).click();
    await expect.poll(async () => (await serverState(page)).progress.u1?.data["mls.completed"], { timeout: 15_000 }).toEqual([]);
  });

  test("progress made on another device comes down when you open the site", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    // another device bookmarks a lesson later
    const s = await serverState(page);
    s.progress.u1 ??= { data: {}, at: {} }; // nothing synced yet: a new account has no progress saved
    s.progress.u1.data["mls.bookmarks"] = ["day09"];
    s.progress.u1.at["mls.bookmarks"] = Date.now() + 60_000;
    await seedServer(page, s);
    await page.goto("my-study/");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("mls.bookmarks"))).toBe('["day09"]');
  });

  test("the menu shows who is signed in, and signing out brings back the form", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    if (width(page) > 800) await expect(page.locator(".side-profile")).toContainText("Ravi");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    if (width(page) > 800) await expect(page.locator(".side-profile")).toContainText("Sign in to sync");
    expect(await page.evaluate(() => localStorage.getItem("mls.account"))).toBeNull();
  });

  test("the account page has no accessibility violations, signed out or in", async ({ page }) => {
    await page.goto("account/");
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await signIn(page);
    await expect(page.locator("[data-account-in] [data-account-sync]")).toHaveText(/Synced/);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  });
});
