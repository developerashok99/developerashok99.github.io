import type { BrowserContext, Page } from "@playwright/test";

/**
 * A pretend account server for the e2e tests, so they never touch the real Firebase project.
 * It keeps its "database" in this browser's localStorage under __fake_server; tests read or seed it with serverState().
 * Two accounts exist: ravi@example.com / secret1 and sita@example.com / secret2.
 */
export async function useFakeAccount(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    const USERS: Record<string, { uid: string; pw: string; name: string }> = {
      "ravi@example.com": { uid: "u1", pw: "secret1", name: "Ravi" },
      "sita@example.com": { uid: "u2", pw: "secret2", name: "Sita" },
    };
    type Server = { progress: Record<string, unknown>; profiles: Record<string, unknown>; session: string | null; mcqs?: Record<string, { author: string }> };
    const load = (): Server => JSON.parse(localStorage.getItem("__fake_server") ?? '{"progress":{},"profiles":{},"session":null}') as Server;
    const save = (s: Server) => localStorage.setItem("__fake_server", JSON.stringify(s));
    const userOf = (email: string) => ({ uid: USERS[email].uid, email, name: USERS[email].name });
    const fail = (code: string) => Object.assign(new Error(code), { code });
    (window as unknown as { __mlsAccountBackend: unknown }).__mlsAccountBackend = {
      onUser(cb: (u: unknown) => void) {
        const s = load();
        setTimeout(() => cb(s.session ? userOf(s.session) : null), 50);
      },
      async signIn(email: string, pw: string) {
        const u = USERS[email.trim()];
        if (!u || u.pw !== pw) throw fail("auth/invalid-credential");
        const s = load();
        s.session = email.trim();
        save(s);
        return userOf(email.trim());
      },
      async signOut() {
        const s = load();
        s.session = null;
        save(s);
      },
      async resetPassword() {},
      async changePassword(current: string, next: string) {
        const s = load();
        const u = s.session ? USERS[s.session] : undefined;
        if (!u || u.pw !== current) throw fail("auth/invalid-credential");
        u.pw = next;
      },
      async setName() {},
      async getProgress(uid: string) {
        return load().progress[uid] ?? null;
      },
      async putProgress(uid: string, snap: unknown) {
        const s = load();
        s.progress[uid] = JSON.parse(JSON.stringify(snap));
        save(s);
      },
      async putProfile(uid: string, p: unknown) {
        const s = load();
        s.profiles[uid] = p;
        save(s);
      },
      async listProfiles() {
        return Object.entries(load().profiles).map(([uid, p]) => ({ ...(p as object), uid }));
      },
      async listMcqs() {
        return Object.entries(load().mcqs ?? {}).map(([id, d]) => ({ ...d, id }));
      },
      async saveMcq(id: string | null, d: { author: string }) {
        const s = load();
        s.mcqs ??= {};
        const uid = s.session ? USERS[s.session].uid : "";
        // like the Firestore rules: only your own questions, and the author must be you
        if (d.author !== uid || (id && s.mcqs[id] && s.mcqs[id].author !== uid)) throw fail("permission-denied");
        const key = id ?? `m${Object.keys(s.mcqs).length + 1}`;
        s.mcqs[key] = d;
        save(s);
        return key;
      },
      async deleteMcq(id: string) {
        const s = load();
        const uid = s.session ? USERS[s.session].uid : "";
        if (s.mcqs?.[id]?.author !== uid) throw fail("permission-denied");
        delete s.mcqs[id];
        save(s);
      },
      // the test build is encrypted with this key (package.json build:test, scripts/protect.mjs)
      async getSiteKey() {
        return load().session ? "dGVzdC1zaXRlLWtleS1mb3ItZTJlLXRlc3RzLW9ubHk=" : null;
      },
    };
  });
}

export const serverState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("__fake_server") ?? '{"progress":{},"profiles":{},"session":null}') as {
    progress: Record<string, { data: Record<string, unknown>; at: Record<string, number> }>;
    profiles: Record<string, { name: string; completed: number }>;
    session: string | null;
  });

export const seedServer = (page: Page, state: unknown) => page.evaluate((s) => localStorage.setItem("__fake_server", JSON.stringify(s)), state);

/** Signed in as Ravi from the start (once per test: signing out in a test stays signed out). */
export async function startSignedIn(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    if (localStorage.getItem("__e2e_seeded")) return;
    localStorage.setItem("__e2e_seeded", "1");
    localStorage.setItem("mls.account", JSON.stringify({ uid: "u1", email: "ravi@example.com", name: "Ravi" }));
    localStorage.setItem("mls.authAt", String(Date.now()));
    localStorage.setItem("mls.siteKey", "dGVzdC1zaXRlLWtleS1mb3ItZTJlLXRlc3RzLW9ubHk=");
    localStorage.setItem("__fake_server", JSON.stringify({ progress: {}, profiles: {}, session: "ravi@example.com" }));
  });
}
