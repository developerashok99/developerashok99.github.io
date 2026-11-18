/**
 * The site is members only, so every e2e test starts signed in to a pretend account server (fake-account.ts),
 * never the real Firebase project. Tests about signing in use test.use({ signedIn: false }).
 */
import { test as base } from "@playwright/test";
import { startSignedIn, useFakeAccount } from "./fake-account";

export * from "@playwright/test";
export const test = base.extend<{ signedIn: boolean }>({
  signedIn: [true, { option: true }],
  context: async ({ context, signedIn }, use) => {
    await useFakeAccount(context);
    if (signedIn) await startSignedIn(context);
    await use(context);
  },
});
