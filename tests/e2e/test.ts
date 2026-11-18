/**
 * The site is members only, so every e2e test starts signed in to a pretend account server (fake-account.ts),
 * never the real Firebase project. Tests about signing in use test.use({ signedIn: false }).
 * `db` is the shared part of that pretend database (who's online, invites); a second browser in the same test
 * joins it with sharedDb(otherContext, db).
 */
import { test as base } from "@playwright/test";
import { newSharedDb, sharedDb, startSignedIn, useFakeAccount, type SharedDb } from "./fake-account";

export * from "@playwright/test";
export const test = base.extend<{ signedIn: boolean; db: SharedDb }>({
  signedIn: [true, { option: true }],
  db: async ({}, use) => use(newSharedDb()),
  context: async ({ context, signedIn, db }, use) => {
    await sharedDb(context, db);
    await useFakeAccount(context);
    if (signedIn) await startSignedIn(context);
    await use(context);
  },
});
