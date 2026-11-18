/**
 * Members only: every page needs a sign-in from the last 30 days (the check before first paint is in Base.astro).
 * Signing in keeps progress in sync between devices and shows friends' progress (src/pages/account.astro).
 * Firebase is only downloaded on the sign-in page and once someone is signed in.
 * The sync rules (who wins when both sides changed) are in src/lib/sync.ts.
 */
import { SYNC_KEYS, authMessage, initials, reconcile, summarize, type ProfileSummary, type Snapshot } from "../lib/sync";
import { ACCOUNT_KEY, AUTH_AT_KEY, SIGN_IN_DAYS, SYNC_AT_KEY, timeAgo } from "./store";
import { pageSignal } from "./page";
import { SITE_KEY } from "./seal";

export interface AccountUser {
  uid: string;
  email: string;
  name: string;
}
/** what the account needs from a server; Firebase in the real site, an in-memory fake in the e2e tests */
export interface Backend {
  onUser(cb: (u: AccountUser | null) => void): void;
  signIn(email: string, password: string): Promise<AccountUser>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  setName(name: string): Promise<void>;
  getProgress(uid: string): Promise<Snapshot | null>;
  putProgress(uid: string, snap: Snapshot): Promise<void>;
  putProfile(uid: string, p: ProfileSummary): Promise<void>;
  listProfiles(): Promise<(ProfileSummary & { uid: string })[]>;
  /** the key that opens the site's encrypted content (Firestore config/site; members only) */
  getSiteKey(): Promise<string | null>;
  /** the shared question bank (Firestore mcqs): everyone reads, you change only your own */
  listMcqs(): Promise<(McqDoc & { id: string })[]>;
  saveMcq(id: string | null, d: McqDoc): Promise<string>;
  deleteMcq(id: string): Promise<void>;
  /** who's online (Firestore presence): your own record, and live updates of everyone's */
  setPresence(p: Presence): Promise<void>;
  watchPresence(cb: (all: Presence[]) => void): () => void;
  /** watch-together invites (Firestore invites): send, see yours (sent and received) live, answer */
  sendInvite(i: Omit<Invite, "id">): Promise<string>;
  watchInvites(uid: string, cb: (all: Invite[]) => void): () => void;
  answerInvite(id: string, status: "accepted" | "declined"): Promise<void>;
  deleteInvite(id: string): Promise<void>;
}
/** a signed-in person's latest sign of life (src/client/friends.ts) */
export interface Presence {
  uid: string;
  name: string;
  /** last seen (ms); "online" means within the last two and a half minutes and not away */
  at: number;
  /** the tab or app was put in the background */
  away: boolean;
  device: "app" | "web";
  /** the page they're on, relative to the site root (works for both the app and the website), and its title */
  page: string;
  pageTitle: string;
  /** their watch-together room, if they're in one */
  room: { code: string; href: string; title: string; host: boolean } | null;
}
/** an invitation to watch together, without sending a link */
export interface Invite {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** the room, and the page it's on (relative to the site root) */
  code: string;
  href: string;
  title: string;
  created: number;
  status: "pending" | "accepted" | "declined";
}
/** a question in the shared bank */
export interface McqDoc {
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /** the lesson it belongs to, or "" */
  lid: string;
  author: string;
  authorName: string;
  created: number;
  updated: number;
}
declare global {
  interface Window {
    /** e2e tests put a fake server here (tests/e2e/fake-account.ts) */
    __mlsAccountBackend?: Backend;
  }
}

type SyncState = "off" | "syncing" | "synced" | "offline" | "error";
const state = { user: null as AccountUser | null, sync: "off" as SyncState, lastSync: 0, ready: false };
let backendP: Promise<Backend> | null = null;

function backend(): Promise<Backend> {
  backendP ??= window.__mlsAccountBackend
    ? Promise.resolve(window.__mlsAccountBackend)
    : import("./firebase").then((m) => m.firebaseBackend);
  return backendP;
}

/** the signed-in person remembered on this device, so the menu shows it straight away (before Firebase loads) */
function savedUser(): AccountUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as AccountUser | null;
    return v && typeof v.uid === "string" ? v : null;
  } catch {
    return null;
  }
}
function saveUser(u: AccountUser | null) {
  // friends.ts starts (or stops) showing you online and listening for invites
  queueMicrotask(() => document.dispatchEvent(new CustomEvent(u ? "mls:signed-in" : "mls:signed-out")));
  try {
    if (u) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(u));
    else {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(AUTH_AT_KEY);
      // the next sign-in on this device merges with the account again instead of replacing it
      localStorage.removeItem(SYNC_AT_KEY);
      localStorage.removeItem(SITE_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

const DAY = 864e5;
const authAt = () => Number(localStorage.getItem(AUTH_AT_KEY) || 0);
/** signed in on this device within the last 30 days */
export function signedIn(): boolean {
  try {
    return !!savedUser() && Date.now() - authAt() < SIGN_IN_DAYS * DAY;
  } catch {
    return false;
  }
}
const base = () => document.documentElement.dataset.base ?? "/";
const onLoginPage = () => document.documentElement.hasAttribute("data-login-page");
/** Back to the sign-in page, remembering where you were. */
function toLogin(why?: "expired") {
  const root = document.documentElement;
  root.dataset.locked = "";
  if (onLoginPage()) return render();
  const here = location.pathname + location.search + location.hash;
  location.replace(`${base()}account/?next=${encodeURIComponent(here)}${why ? `&${why}=1` : ""}`);
}
/** Where to go after signing in: the page you asked for (only pages of this site), or Home. */
function nextPage(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  return next.startsWith(base()) && !next.startsWith("//") && !next.startsWith(`${base()}account/`) ? next : base();
}

function localSnapshot(): Snapshot {
  const snap: Snapshot = { data: {}, at: {} };
  try {
    const at = JSON.parse(localStorage.getItem(SYNC_AT_KEY) ?? "{}") as Record<string, number>;
    for (const key of SYNC_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        try {
          const v = JSON.parse(raw) as unknown;
          if (v != null) snap.data[key] = v;
        } catch {
          /* a damaged value doesn't sync */
        }
      }
      if (typeof at[key] === "number") snap.at[key] = at[key];
    }
  } catch {
    /* storage unavailable */
  }
  return snap;
}

/** Puts the account's values into this browser without counting them as new changes here. */
function applyLocal(snap: Snapshot, keys: string[]) {
  try {
    const at = JSON.parse(localStorage.getItem(SYNC_AT_KEY) ?? "{}") as Record<string, number>;
    for (const key of keys) {
      const v = snap.data[key];
      if (v == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(v));
    }
    for (const [k, t] of Object.entries(snap.at)) if (typeof t === "number") at[k] = t;
    localStorage.setItem(SYNC_AT_KEY, JSON.stringify(at));
  } catch {
    /* storage unavailable */
  }
  if (keys.length) window.dispatchEvent(new CustomEvent("mls:store", { detail: { key: "*", sync: true } }));
}

let running: Promise<void> | null = null;
let again = false;
/** Syncs this device with the account: pulls what changed elsewhere, pushes what changed here. */
export function syncNow(): Promise<void> {
  if (!state.user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const user = state.user!;
    setSync("syncing");
    try {
      const api = await backend();
      const remote = (await api.getProgress(user.uid)) ?? { data: {}, at: {} };
      const result = reconcile(localSnapshot(), remote);
      applyLocal(result.merged, result.localChanged);
      if (result.remoteChanged) await api.putProgress(user.uid, result.merged);
      await api.putProfile(user.uid, summarize(user.name, result.merged.data));
      state.lastSync = Date.now();
      setSync("synced");
    } catch (e) {
      console.warn("sync failed", e);
      setSync(navigator.onLine === false || String((e as { code?: string })?.code ?? "").includes("unavailable") ? "offline" : "error");
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
/** changes are sent a few seconds after the last one, so a burst of flashcard answers is one write */
function schedulePush(delay = 4000) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), delay);
}

function setSync(s: SyncState) {
  state.sync = s;
  render();
}

function statusText(): string {
  switch (state.sync) {
    case "syncing": return "Syncing…";
    case "synced": return `Synced ${timeAgo(state.lastSync)}`;
    case "offline": return "Offline: will sync when you're back online";
    case "error": return "Couldn't sync. Try “Sync now”.";
    default: return state.user ? "Signed in" : "Progress saved in this browser";
  }
}

/** The menu's profile corner and the Account page reflect the current state. */
function render() {
  const u = state.user;
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-name]")) el.textContent = u ? u.name : "My learning space";
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-status]")) el.textContent = u ? statusText() : "Sign in to sync your progress";
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-avatar]")) el.textContent = u ? initials(u.name) : "ML";
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-sync]")) {
    el.textContent = statusText();
    el.dataset.state = state.sync;
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-email]")) el.textContent = u?.email ?? "";
  for (const el of document.querySelectorAll<HTMLElement>("[data-account-until]")) {
    const until = authAt() + SIGN_IN_DAYS * DAY;
    el.textContent = u && authAt() ? `Signed in on this device until ${new Date(until).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : "";
  }
  const page = document.querySelector<HTMLElement>("[data-account-page]");
  if (page) {
    page.querySelector<HTMLElement>("[data-account-loading]")!.hidden = state.ready || !!u;
    page.querySelector<HTMLElement>("[data-account-out]")!.hidden = !state.ready || !!u;
    page.querySelector<HTMLElement>("[data-account-in]")!.hidden = !u;
  }
}

/** Starts the account once per visit (not per page): only touches Firebase if someone signed in on this device. */
let started = false;
export function startAccount() {
  if (started) return;
  started = true;
  state.user = savedUser();
  if (state.user && !signedIn()) {
    // 30 days are up: sign out here too, so the next sign-in asks for the password
    state.user = null;
    saveUser(null);
    void backend().then((api) => api.signOut()).catch(() => {});
  }
  if (state.user) connect();
  else state.ready = true;
  window.addEventListener("mls:store", (e) => {
    if (state.user && !(e as CustomEvent<{ sync?: boolean }>).detail?.sync) schedulePush();
  });
  document.addEventListener("visibilitychange", () => {
    if (!state.user) return;
    if (document.visibilityState === "hidden") {
      // leaving the app or tab: send what's pending now
      if (pushTimer) {
        clearTimeout(pushTimer);
        void syncNow();
      }
    } else if (Date.now() - state.lastSync > 60_000) void syncNow();
  });
  window.addEventListener("online", () => state.user && void syncNow());
}

let connected = false;
function connect() {
  if (connected) return;
  connected = true;
  void backend().then((api) => api.onUser((u) => {
    state.ready = true;
    if (!u) {
      // signed out elsewhere, or the session expired
      if (state.user) {
        state.user = null;
        saveUser(null);
        setSync("off");
        toLogin();
      }
      render();
      return;
    }
    const name = state.user?.uid === u.uid ? state.user.name : u.name;
    state.user = { ...u, name };
    saveUser(state.user);
    if (!hasSiteKey()) void loadSiteKey();
    void syncNow();
  })).catch((e) => {
    console.warn("account unavailable", e);
    state.ready = true;
    setSync("offline");
  });
}

const PERCENT = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

async function renderFriends(box: HTMLElement) {
  if (!state.user) return;
  const total = Number(box.dataset.total) || 0;
  const root = base();
  try {
    const api = await backend();
    const list = (await api.listProfiles()).sort((a, b) => b.completed - a.completed || b.cardsLearned - a.cardsLearned);
    box.replaceChildren(...list.map((p) => {
      const li = document.createElement("li");
      li.className = "friend" + (p.uid === state.user?.uid ? " friend--me" : "");
      li.dataset.uid = p.uid;
      const pct = PERCENT(p.completed, total);
      const avatar = document.createElement("span");
      avatar.className = "friend__avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = initials(p.name);
      const body = document.createElement("div");
      body.className = "friend__body";
      const head = document.createElement("p");
      head.className = "friend__head";
      const name = document.createElement("b");
      name.textContent = p.uid === state.user?.uid ? `${p.name} (you)` : p.name;
      const seen = document.createElement("span");
      seen.className = "small muted";
      seen.textContent = p.updated ? `active ${timeAgo(p.updated)}` : "";
      head.append(name, seen);
      const bar = document.createElement("div");
      bar.className = "progress";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${p.name}: lessons completed`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(total));
      bar.setAttribute("aria-valuenow", String(p.completed));
      const fill = document.createElement("span");
      fill.style.width = `${pct}%`;
      bar.append(fill);
      const stats = document.createElement("p");
      stats.className = "friend__stats small";
      const parts = [`${p.completed} of ${total} lessons (${pct}%)`];
      if (p.lecturesWatched || p.hoursWatched) parts.push(`${p.lecturesWatched ?? 0} lectures watched (${p.hoursWatched ?? 0} h)`);
      parts.push(`${p.cardsLearned} cards learned`, `${p.quizRight} quiz answers right`);
      if (p.interviews) parts.push(`${p.interviews} mock interview${p.interviews === 1 ? "" : "s"}, recent average ${p.interviewScore}%`);
      if (p.mcqTests) parts.push(`${p.mcqTests} MCQ test${p.mcqTests === 1 ? "" : "s"}, best ${p.mcqBest}%`);
      stats.textContent = parts.join(" · ");
      body.append(head, bar, stats);
      if (p.lastTitle) {
        const last = document.createElement("p");
        last.className = "friend__last small muted";
        last.append("Last opened: ");
        if (p.lastHref.startsWith("/")) {
          // the website lives under /mule-learning-web/, the app at /: link to the same page in whichever this is
          const a = document.createElement("a");
          a.href = root + p.lastHref.replace(/^\/(mule-learning-web\/)?/, "");
          a.textContent = p.lastTitle;
          last.append(a);
        } else last.append(p.lastTitle);
        body.append(last);
      }
      li.append(avatar, body);
      return li;
    }));
    if (!list.length) box.innerHTML = `<li class="empty">Nobody has synced yet.</li>`;
    document.dispatchEvent(new CustomEvent("mls:friends-rendered"));
  } catch (e) {
    console.warn("friends unavailable", e);
    box.innerHTML = `<li class="empty">Couldn't load your friends' progress. Check the connection and open this page again.</li>`;
  }
}

function busy(btn: HTMLButtonElement | null, on: boolean) {
  if (!btn) return;
  btn.disabled = on;
  btn.setAttribute("aria-busy", String(on));
}
function say(el: HTMLElement | null, text: string, kind: "ok" | "error" = "ok") {
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}
const errCode = (e: unknown) => String((e as { code?: string })?.code ?? "");

/** The Account page: sign in, sync status, name and password, friends. */
function setupAccountPage() {
  const page = document.querySelector<HTMLElement>("[data-account-page]");
  if (!page) return;
  const signal = pageSignal();
  connect(); // the sign-in form needs Firebase even when nobody is signed in yet
  const form = page.querySelector<HTMLFormElement>("[data-account-signin]")!;
  const msg = page.querySelector<HTMLElement>("[data-account-msg]");
  const friends = page.querySelector<HTMLElement>("[data-friends]");
  if (new URLSearchParams(location.search).has("expired") && !state.user) say(msg, "You were signed in for 30 days, so please sign in again.");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const btn = form.querySelector<HTMLButtonElement>("[type=submit]");
    busy(btn, true);
    say(msg, "");
    try {
      const api = await backend();
      const u = await api.signIn(email, password);
      state.user = u;
      saveUser(u);
      localStorage.setItem(AUTH_AT_KEY, String(Date.now()));
      form.reset();
      say(msg, "Signed in. Loading your progress…");
      // bring the account's progress down before showing any page, so it opens up to date
      const key = await loadSiteKey();
      if (!key) {
        say(msg, "Signed in, but the site's content key isn't set up in Firebase yet. Ask whoever runs this site.", "error");
        return;
      }
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
      if (document.documentElement.hasAttribute("data-locked")) {
        location.replace(nextPage());
        return;
      }
      render();
      if (friends) void renderFriends(friends);
    } catch (err) {
      say(msg, authMessage(errCode(err)), "error");
    } finally {
      busy(btn, false);
    }
  }, { signal });

  page.querySelector("[data-account-forgot]")?.addEventListener("click", async () => {
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email) {
      say(msg, "Type your email above first, then press “Forgot password” again.", "error");
      (form.elements.namedItem("email") as HTMLInputElement).focus();
      return;
    }
    try {
      await (await backend()).resetPassword(email);
      say(msg, `If ${email} has an account, a reset link is on its way. Check the spam folder too.`);
    } catch (err) {
      say(msg, authMessage(errCode(err)), "error");
    }
  }, { signal });

  page.querySelector("[data-account-sync-now]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    busy(btn, true);
    await syncNow();
    busy(btn, false);
    if (friends) void renderFriends(friends);
  }, { signal });

  page.querySelector("[data-account-signout]")?.addEventListener("click", async () => {
    await syncNow(); // don't leave the last changes behind
    try {
      await (await backend()).signOut();
    } catch {
      /* signed out locally anyway */
    }
    state.user = null;
    saveUser(null);
    setSync("off");
    if (friends) friends.replaceChildren();
    toLogin();
  }, { signal });

  const nameForm = page.querySelector<HTMLFormElement>("[data-account-name-form]");
  const nameMsg = page.querySelector<HTMLElement>("[data-account-name-msg]");
  nameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = nameForm.elements.namedItem("name") as HTMLInputElement;
    const name = input.value.trim().slice(0, 40);
    if (!name || !state.user) return;
    try {
      await (await backend()).setName(name);
      state.user = { ...state.user, name };
      saveUser(state.user);
      render();
      await syncNow();
      say(nameMsg, "Name saved.");
      if (friends) void renderFriends(friends);
    } catch (err) {
      say(nameMsg, authMessage(errCode(err)), "error");
    }
  }, { signal });

  const pwForm = page.querySelector<HTMLFormElement>("[data-account-password]");
  const pwMsg = page.querySelector<HTMLElement>("[data-account-password-msg]");
  pwForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = (pwForm.elements.namedItem("current") as HTMLInputElement).value;
    const next = (pwForm.elements.namedItem("next") as HTMLInputElement).value;
    if (next.length < 6) return say(pwMsg, authMessage("auth/weak-password"), "error");
    const btn = pwForm.querySelector<HTMLButtonElement>("[type=submit]");
    busy(btn, true);
    try {
      await (await backend()).changePassword(current, next);
      pwForm.reset();
      say(pwMsg, "Password changed.");
    } catch (err) {
      say(pwMsg, authMessage(errCode(err)), "error");
    } finally {
      busy(btn, false);
    }
  }, { signal });

  // fill in the name box and the friends list once we know who is signed in
  const fill = () => {
    if (!state.user) return;
    const input = nameForm?.elements.namedItem("name") as HTMLInputElement | null;
    if (input && !input.value) input.value = state.user.name;
    if (friends && !friends.childElementCount) void renderFriends(friends);
  };
  fill();
  const timer = setInterval(() => {
    render(); // keeps "Synced 2 min ago" current
    fill();
  }, 2000);
  signal.addEventListener("abort", () => clearInterval(timer));
}

/** Called on every page (astro:page-load). */
export function setupAccount(): boolean {
  startAccount();
  // client-side navigation skips the check in Base.astro, so check again on every page
  if (!signedIn() && !onLoginPage()) {
    toLogin(savedUser() ? "expired" : undefined);
    return false;
  }
  render();
  setupAccountPage();
  return true;
}

// ---- the site key ----
const hasSiteKey = () => {
  try {
    return !!localStorage.getItem(SITE_KEY);
  } catch {
    return false;
  }
};
/** Gets the content key from the account and keeps it on this device (until sign-out or the 30 days are up). */
async function loadSiteKey(): Promise<string | null> {
  try {
    const key = await (await backend()).getSiteKey();
    if (key) localStorage.setItem(SITE_KEY, key.trim());
    return key;
  } catch (e) {
    console.warn("site key unavailable", e);
    return null;
  }
}
// a page didn't open: maybe the key changed. Fetch it again once, and reload if it did.
let retried = false;
document.addEventListener("mls:unseal-failed", () => {
  if (retried || !state.user) return;
  retried = true;
  const before = localStorage.getItem(SITE_KEY);
  void loadSiteKey().then((k) => k && k.trim() !== before && location.reload());
});

/** The signed-in person, for features that write to the shared database (the question bank). */
export const currentUser = (): AccountUser | null => state.user;
/** The account server, for features that use the shared database. */
export const accountBackend = (): Promise<Backend> => backend();
