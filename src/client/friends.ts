/**
 * Friends online and watch-together invites, using the account's database (src/client/account.ts Backend):
 * - presence: each signed-in device keeps presence/{uid} up to date (page, app or browser, watch-together room)
 * - the menu shows who's online; the Account page's Friends list shows online / last seen and a Join button
 * - on a video or podcast page, "Invite" sends an invite; the friend gets a pop-up (website or app) and joins
 *   the room without anyone sending a link
 * Starts when someone signs in (event mls:signed-in from account.ts) and stops on sign-out.
 */
import { navigate } from "astro:transitions/client";
import { accountBackend, currentUser, type Invite, type Presence } from "./account";
import { currentBattle, ensureBattle } from "./battle";
import { currentRoom, ensureRoom } from "./together";
import { timeAgo } from "./store";

/** seen within this long (and not away) counts as online */
const ONLINE_MS = 150_000;
/** invites older than this aren't shown any more */
const INVITE_MS = 10 * 60_000;

const state = { presence: [] as Presence[], invites: [] as Invite[], running: false };
let stops: (() => void)[] = [];
let lastWrite = 0;
let beat: ReturnType<typeof setInterval> | undefined;

const base = () => document.documentElement.dataset.base ?? "/";
/** the page relative to the site root, the same in the app and on the website */
const here = () => location.pathname.slice(base().length);
const pageTitle = () => document.title.replace(/\s*·\s*Mule Learning Hub$/, "") || "Mule Learning Hub";
const isBattle = (href: string) => href.startsWith("battle/");
/** the room on this page you can invite friends into: the quiz battle on its page, else watch together */
const onBattlePage = () => !!document.querySelector("[data-battle]");
const roomHere = () => (onBattlePage() ? currentBattle()?.code ?? null : currentRoom()?.code ?? null);
const isOnline = (p: Presence) => !p.away && Date.now() - p.at < ONLINE_MS;
const others = () => state.presence.filter((p) => p.uid !== currentUser()?.uid);

function myPresence(away = false): Presence | null {
  const u = currentUser();
  if (!u) return null;
  const r = currentRoom();
  const b = currentBattle();
  return {
    uid: u.uid,
    name: u.name,
    at: Date.now(),
    away,
    device: document.documentElement.dataset.app === "android" ? "app" : "web",
    page: here(),
    pageTitle: pageTitle(),
    room: r ? { code: r.code, href: here(), title: pageTitle(), host: r.role === "host" }
      : b ? { code: b.code, href: "battle/", title: "Quiz battle", host: b.role === "host" } : null,
  };
}

/** Writes this device's presence; `force` skips the "not more than every 10 s" limit. */
async function publish(force = false, away = false) {
  const p = myPresence(away);
  if (!p || (!force && Date.now() - lastWrite < 10_000)) return;
  lastWrite = Date.now();
  try {
    await (await accountBackend()).setPresence(p);
  } catch (e) {
    console.warn("presence not saved", e);
  }
}

async function start() {
  if (state.running || !currentUser()) return;
  state.running = true;
  const api = await accountBackend();
  stops.push(api.watchPresence((all) => {
    state.presence = all;
    renderAll();
  }));
  stops.push(api.watchInvites(currentUser()!.uid, (all) => {
    state.invites = all;
    tidy(all);
    renderInvites();
    renderAll();
  }));
  void publish(true);
  // once a minute while the page is open; when you leave, you show as away straight away
  beat = setInterval(() => document.visibilityState === "visible" && void publish(true), 60_000);
}

function stop() {
  if (!state.running) return;
  void publish(true, true);
  stops.forEach((s) => s());
  stops = [];
  clearInterval(beat);
  state.running = false;
  state.presence = [];
  state.invites = [];
  renderAll();
  renderInvites();
}

/** Deletes your own sent invites older than an hour, so the database doesn't fill up. */
function tidy(all: Invite[]) {
  const me = currentUser()?.uid;
  for (const i of all) {
    if (i.from === me && Date.now() - i.created > 60 * 60_000) void accountBackend().then((api) => api.deleteInvite(i.id)).catch(() => {});
  }
}

// ---- what you see ----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

/** "Online · watching Day 5 together" / "Online · Day 12 notes" / "Last seen 2 h ago" */
function describe(p: Presence): string {
  if (!isOnline(p)) return `Last seen ${timeAgo(p.at)}${p.device === "app" ? " (app)" : ""}`;
  const where = p.room ? (isBattle(p.room.href) ? "in a quiz battle" : `watching ${p.room.title} together`) : p.pageTitle;
  return `Online${p.device === "app" ? " in the app" : ""} · ${where}`;
}

function joinRoom(r: NonNullable<Presence["room"]>) {
  void navigate(`${base()}${r.href}?room=${encodeURIComponent(r.code)}`);
}

function renderAll() {
  renderSidebar();
  renderFriendRows();
  renderInviteList();
}

/** The menu: who's online right now. */
function renderSidebar() {
  for (const box of document.querySelectorAll<HTMLElement>("[data-side-online]")) {
    const online = others().filter(isOnline);
    box.hidden = !online.length;
    const list = box.querySelector("ul")!;
    list.replaceChildren(...online.slice(0, 6).map((p) => {
      const li = el("li");
      const a = el("a");
      a.href = `${base()}account/#ac-friends`;
      a.title = describe(p);
      const dot = el("span", "online-avatar", initials(p.name));
      dot.setAttribute("aria-hidden", "true");
      a.append(dot, el("span", "side-online__name", p.name), el("span", "visually-hidden", `: ${describe(p)}`));
      li.append(a);
      return li;
    }));
    box.querySelector<HTMLElement>("[data-side-online-n]")!.textContent = `${online.length} online`;
  }
}

/** The Account page's Friends list (rendered by account.ts): add online / last seen and Join. */
function renderFriendRows() {
  for (const li of document.querySelectorAll<HTMLElement>(".friend[data-uid]")) {
    const p = state.presence.find((x) => x.uid === li.dataset.uid);
    li.dataset.online = String(!!p && isOnline(p));
    let slot = li.querySelector<HTMLElement>(".friend__presence");
    if (!slot) {
      slot = el("div", "friend__presence");
      li.querySelector(".friend__body")?.append(slot);
    }
    slot.replaceChildren();
    if (!p) continue;
    slot.append(el("span", "small", li.classList.contains("friend--me") ? `You: ${describe(p).replace(/^Online( in the app)? · /, "")}` : describe(p)));
    if (p.room && isOnline(p) && p.uid !== currentUser()?.uid && currentRoom()?.code !== p.room.code && currentBattle()?.code !== p.room.code) {
      const b = el("button", "btn btn--sm btn--primary", "Join");
      b.type = "button";
      b.setAttribute("aria-label", isBattle(p.room.href) ? `Join ${p.name}'s quiz battle` : `Join ${p.name} watching ${p.room.title}`);
      b.addEventListener("click", () => joinRoom(p.room!));
      slot.append(b);
    }
  }
}

/** On a video or podcast page: invite a friend into this room. */
function renderInviteList() {
  const box = document.querySelector<HTMLElement>("[data-together-friends]");
  if (!box) return;
  const list = box.querySelector("ul")!;
  const friends = others().sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || b.at - a.at);
  box.hidden = !friends.length;
  const room = roomHere() ? { code: roomHere()! } : null;
  list.replaceChildren(...friends.map((p) => {
    const li = el("li", "invite-row");
    li.dataset.online = String(isOnline(p));
    const who = el("span", "invite-row__who");
    const dot = el("span", "online-avatar", initials(p.name));
    dot.setAttribute("aria-hidden", "true");
    who.append(dot, el("span", "", p.name), el("small", "muted", isOnline(p) ? (p.room?.code === room?.code ? "in this room" : "online") : `last seen ${timeAgo(p.at)}`));
    const sent = state.invites.find((i) => i.from === currentUser()?.uid && i.to === p.uid && i.code === room?.code && Date.now() - i.created < INVITE_MS);
    const b = el("button", "btn btn--sm", sent ? (sent.status === "accepted" ? "Joining…" : sent.status === "declined" ? "Not now" : "Invited") : "Invite");
    b.type = "button";
    b.disabled = !!sent || p.room?.code === room?.code;
    b.setAttribute("aria-label", onBattlePage() ? `Invite ${p.name} to the quiz battle` : `Invite ${p.name} to watch together`);
    b.addEventListener("click", () => void invite(p, b));
    li.append(who, b);
    return li;
  }));
}

async function invite(p: Presence, btn: HTMLButtonElement) {
  const me = currentUser();
  const code = onBattlePage() ? ensureBattle() : ensureRoom();
  if (!me || !code) return;
  btn.disabled = true;
  btn.textContent = "Inviting…";
  try {
    await (await accountBackend()).sendInvite({
      from: me.uid, fromName: me.name, to: p.uid, toName: p.name, code, href: onBattlePage() ? "battle/" : here(), title: onBattlePage() ? "Quiz battle" : pageTitle(), created: Date.now(), status: "pending",
    });
    btn.textContent = "Invited";
    void publish(true);
  } catch (e) {
    console.warn("invite not sent", e);
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

// ---- invites you receive (pop-up) and answers to yours (a short note) ----

const seen = (kind: string) => {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(`mls.invites.${kind}`) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
};
const remember = (kind: string, id: string) => {
  const s = seen(kind);
  s.add(id);
  try {
    sessionStorage.setItem(`mls.invites.${kind}`, JSON.stringify([...s]));
  } catch {
    /* storage blocked */
  }
};

function note(text: string) {
  const t = document.querySelector<HTMLElement>("[data-toast]");
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(setTimeout(() => (t.hidden = true), 5000));
}

function renderInvites() {
  const me = currentUser()?.uid;
  // answers to invites you sent
  for (const i of state.invites) {
    if (i.from !== me || i.status === "pending" || seen("answered").has(i.id)) continue;
    remember("answered", i.id);
    if (Date.now() - i.created < INVITE_MS) note(i.status === "accepted" ? `${i.toName} is joining you.` : `${i.toName} can't join right now.`);
  }
  // the newest invite for you that's still open
  const box = document.querySelector<HTMLElement>("[data-invite-pop]");
  if (!box) return;
  const open = state.invites
    .filter((i) => i.to === me && i.status === "pending" && Date.now() - i.created < INVITE_MS && !seen("dismissed").has(i.id) && currentRoom()?.code !== i.code && currentBattle()?.code !== i.code)
    .sort((a, b) => b.created - a.created)[0];
  if (!open) {
    box.hidden = true;
    return;
  }
  if (box.dataset.id === open.id && !box.hidden) return;
  box.dataset.id = open.id;
  box.querySelector("[data-invite-text]")!.textContent = isBattle(open.href) ? `${open.fromName} invites you to a quiz battle.` : `${open.fromName} invites you to watch ${open.title} together.`;
  box.setAttribute("aria-label", isBattle(open.href) ? "Invitation to a quiz battle" : "Invitation to watch together");
  box.hidden = false;
  navigator.vibrate?.(150);
}

async function answer(status: "accepted" | "declined") {
  const box = document.querySelector<HTMLElement>("[data-invite-pop]");
  const inv = state.invites.find((i) => i.id === box?.dataset.id);
  if (!box || !inv) return;
  box.hidden = true;
  remember("dismissed", inv.id);
  try {
    await (await accountBackend()).answerInvite(inv.id, status);
  } catch (e) {
    console.warn("answer not saved", e);
  }
  if (status === "accepted") joinRoom({ code: inv.code, href: inv.href, title: inv.title, host: false });
}

/** Once per visit: the pop-up's buttons and the account events. */
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-invite-answer]");
    if (b) void answer(b.dataset.inviteAnswer as "accepted" | "declined");
  });
  document.addEventListener("mls:signed-in", () => void start());
  document.addEventListener("mls:signed-out", stop);
  document.addEventListener("mls:together-room", () => {
    void publish(true);
    renderInviteList();
  });
  document.addEventListener("mls:friends-rendered", renderFriendRows);
  document.addEventListener("visibilitychange", () => {
    if (!state.running) return;
    if (document.visibilityState === "hidden") void publish(true, true);
    else void publish(true);
  });
  window.addEventListener("pagehide", () => state.running && void publish(true, true));
  // "Last seen 2 min ago" and "online" change with time, not only with data
  setInterval(() => state.running && renderAll(), 30_000);
}

/** Every page (after its content opens): redraw, and say which page you're on. */
export function setupFriends() {
  wire();
  if (currentUser()) void start();
  renderAll();
  renderInvites();
  void publish();
}
