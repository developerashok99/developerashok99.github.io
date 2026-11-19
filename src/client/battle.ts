/**
 * Quiz battle (src/pages/battle.astro). The host's browser runs the game: it picks the questions, sends each one
 * with the time left, collects answers, scores them (src/lib/battle.ts) and sends the scores. The others only
 * answer and show what the host sends. Everyone's own answers are saved like quiz answers, so a battle counts
 * towards Mistakes, mastery and study points.
 *
 * The game lives in this module, so it survives moving between pages; it ends when the host leaves.
 */
import { readBattleMsg, score, SECS, standings, type BattleMsg, type Player } from "../lib/battle";
import { buildTest, type Mcq } from "../lib/mcq";
import { WEBSITE } from "../lib/routes";
import { parseRoom, roomCode } from "../lib/together";
import { currentUser } from "./account";
import { base, pageSignal } from "./page";
import { makeTransport, type Link, type Problem, type Transport } from "./rooms";
import { fetchSealedJson } from "./seal";
import { saveQuizAnswer } from "./store";

type Phase = "lobby" | "question" | "reveal" | "end";
interface Game {
  code: string;
  role: "host" | "guest";
  transport: Transport;
  /** host: each friend's connection and player id; guest: the one connection to the host */
  links: Map<Link, string>;
  me: string;
  players: Player[];
  topic: string;
  n: number;
  connected: boolean;
  phase: Phase;
  ids: string[];
  i: number;
  qid: string;
  deadline: number;
  /** host: this question's answers by player, with the time left when each arrived */
  answers: Map<string, { k: number; left: number }>;
  mine: number | null;
  a: number | null;
  status: string;
  timers: number[];
}
let game: Game | null = null;
let ended = "";
const tried = new Set<string>();
let questions: Map<string, Mcq> | null = null;
let loading: Promise<Map<string, Mcq>> | null = null;

const PROBLEMS: Record<Problem, string> = {
  taken: "That battle code is already in use. Try again.",
  "not-found": "This battle has ended, or the link is wrong. Ask your friend to invite you again.",
  network: "Couldn't reach the connection service. Check your internet connection and try again.",
  failed: "Couldn't connect to your friend. Some mobile-data and office networks block direct connections: try both on Wi-Fi.",
};

const myName = () => currentUser()?.name ?? "Friend";
const root = () => document.querySelector<HTMLElement>("[data-battle]");
const topics = (): { id: string; title: string; lessons: string[] }[] => {
  try {
    return JSON.parse(root()?.querySelector("[data-exam-topics]")?.textContent || "[]");
  } catch {
    return [];
  }
};
const topicTitle = (id: string) => topics().find((t) => t.id === id)?.title ?? "Whole course";

function loadQuestions(): Promise<Map<string, Mcq>> {
  const src = root()?.dataset.questions;
  if (questions) return Promise.resolve(questions);
  if (!src) return Promise.reject(new Error("no questions"));
  loading ??= fetchSealedJson<Mcq[]>(src).then((list) => (questions = new Map(list.map((q) => [q.id, q])))).finally(() => (loading = null));
  return loading;
}

/** For friends.ts: the battle you're in (shown to friends, who can join it). */
export function currentBattle(): { code: string; role: "host" | "guest"; connected: boolean } | null {
  return game ? { code: game.code, role: game.role, connected: game.connected } : null;
}
/** For friends.ts "Invite": the battle's code, once one has been created. */
export function ensureBattle(): string | null {
  return game?.code ?? null;
}

function changed() {
  document.dispatchEvent(new CustomEvent("mls:together-room"));
  render();
}

function send(l: Link, m: BattleMsg) {
  l.send(m);
}
function broadcast(m: BattleMsg) {
  game?.links.forEach((_, l) => send(l, m));
}
function lobbyFor(id: string): BattleMsg {
  return { t: "lobby", players: game!.players, topic: game!.topic, n: game!.n, you: id };
}
function sendLobby() {
  game?.links.forEach((id, l) => send(l, lobbyFor(id)));
}

function open(role: "host" | "guest", code: string, topic = "", n = 10, attempt = 0) {
  const transport = makeTransport("quiz");
  ended = "";
  const me = role === "host" ? "host" : "";
  game = { code, role, transport, links: new Map(), me, players: role === "host" ? [{ id: me, name: myName(), score: 0 }] : [], topic, n,
    connected: false, phase: "lobby", ids: [], i: 0, qid: "", deadline: 0, answers: new Map(), mine: null, a: null,
    status: role === "host" ? "Starting the battle…" : "Connecting to your friend…", timers: [] };
  const g = game;
  void loadQuestions().catch(() => {});
  const handlers = {
    ready: () => {
      if (game !== g || role !== "host") return;
      g.connected = true;
      g.status = "Battle ready. Invite friends, then start.";
      changed();
    },
    link: (l: Link) => {
      if (game !== g) return;
      g.links.set(l, "");
      l.onmsg = (d) => onMessage(l, d);
      l.onclose = () => {
        if (game !== g) return;
        const id = g.links.get(l);
        g.links.delete(l);
        if (g.role === "guest") return end("The host ended the battle.");
        g.players = g.players.filter((p) => p.id !== id);
        g.answers.delete(id ?? "");
        g.status = "A friend left the battle.";
        sendLobby();
        if (g.phase === "question" && g.answers.size >= g.players.length) reveal();
        changed();
      };
      if (g.role === "guest") {
        g.connected = true;
        g.status = "Connected. Waiting for the host to start.";
        send(l, { t: "hello", name: myName() });
        changed();
      }
    },
    problem: (p: Problem) => {
      if (game !== g) return;
      if (p === "taken" && role === "host" && attempt < 3) {
        g.transport.destroy();
        game = null;
        return open("host", roomCode(), topic, n, attempt + 1);
      }
      if (g.links.size) {
        g.status = p === "network" ? "The connection service dropped out. You're still connected; new friends can join once it's back." : PROBLEMS[p];
        return changed();
      }
      end(PROBLEMS[p]);
    },
  };
  if (role === "host") transport.host(code, handlers);
  else transport.join(code, handlers);
  // the clock on screen
  g.timers.push(window.setInterval(() => game === g && g.phase === "question" && renderClock(), 200));
  changed();
}

function end(message: string) {
  if (!game) return;
  game.timers.forEach((t) => clearInterval(t));
  game.timers.forEach((t) => clearTimeout(t));
  game.transport.destroy();
  game = null;
  ended = message;
  if (parseRoom(location.search) && root()) history.replaceState(history.state, "", location.pathname + location.hash);
  changed();
}

function leave() {
  if (!game) return;
  broadcast({ t: "bye" });
  const host = game.role === "host";
  setTimeout(() => end(host ? "You ended the battle." : "You left the battle."), 100);
}

// ---- the host runs the game ----

async function startGame() {
  const g = game;
  if (!g || g.role !== "host") return;
  let all: Map<string, Mcq>;
  try {
    all = await loadQuestions();
  } catch {
    g.status = "Couldn't load the questions. Check the connection and try again.";
    return changed();
  }
  const lessons = topics().find((t) => t.id === g.topic)?.lessons;
  const pool = [...all.values()].filter((q) => !lessons || lessons.includes(q.lid));
  g.ids = buildTest(pool, g.n, new Set()).map((q) => q.id);
  g.n = g.ids.length;
  for (const p of g.players) {
    p.score = 0;
    p.last = null;
  }
  ask(0);
}

function ask(i: number) {
  const g = game!;
  g.phase = "question";
  g.i = i;
  g.qid = g.ids[i];
  g.deadline = Date.now() + SECS * 1000;
  g.answers.clear();
  g.mine = null;
  g.a = null;
  broadcast({ t: "q", i, id: g.qid, left: SECS * 1000 });
  g.timers.push(window.setTimeout(() => game === g && g.phase === "question" && g.i === i && reveal(), SECS * 1000 + 300));
  changed();
}

function hostAnswer(player: string, i: number, k: number) {
  const g = game!;
  if (g.phase !== "question" || g.i !== i || g.answers.has(player) || !g.players.some((p) => p.id === player)) return;
  g.answers.set(player, { k, left: Math.max(0, g.deadline - Date.now()) });
  if (g.answers.size >= g.players.length) reveal();
  else render();
}

function reveal() {
  const g = game!;
  const q = questions?.get(g.qid);
  if (!q || g.phase !== "question") return;
  g.phase = "reveal";
  g.a = q.a;
  for (const p of g.players) {
    const ans = g.answers.get(p.id);
    const right = !!ans && ans.k === q.a;
    const pts = ans ? score(right, ans.left) : 0;
    p.score += pts;
    p.last = { k: ans?.k ?? -1, right, pts };
  }
  broadcast({ t: "reveal", i: g.i, a: q.a, players: g.players });
  saveMine();
  const i = g.i;
  g.timers.push(window.setTimeout(() => {
    if (game !== g || g.phase !== "reveal" || g.i !== i) return;
    if (i + 1 < g.ids.length) ask(i + 1);
    else {
      g.phase = "end";
      broadcast({ t: "end", players: g.players });
      changed();
    }
  }, 4500));
  changed();
}

/** your own answer counts like a quiz answer (Mistakes, mastery, study points) */
function saveMine() {
  const g = game!;
  if (g.mine != null && g.a != null && g.qid) saveQuizAnswer(g.qid, g.mine === g.a);
}

function again() {
  const g = game;
  if (!g || g.role !== "host") return;
  g.phase = "lobby";
  for (const p of g.players) {
    p.score = 0;
    p.last = null;
  }
  g.status = "New battle. Start when everyone's ready.";
  sendLobby();
  changed();
}

function onMessage(from: Link, raw: unknown) {
  const g = game;
  const m = readBattleMsg(raw);
  if (!g || !m) return;
  if (m.t === "bye") {
    from.close();
    return from.onclose?.();
  }
  if (g.role === "host") {
    if (m.t === "hello") {
      if (g.links.get(from)) return;
      const id = Math.random().toString(36).slice(2, 10);
      g.links.set(from, id);
      g.players.push({ id, name: m.name, score: 0 });
      g.status = `${m.name} joined.`;
      sendLobby();
      // joined mid-game: catch up at the next question
      changed();
    } else if (m.t === "ans") hostAnswer(g.links.get(from) ?? "", m.i, m.k);
    return;
  }
  // guest: show what the host sends
  if (m.t === "lobby") {
    g.players = m.players;
    g.topic = m.topic;
    g.n = m.n;
    if (m.you) g.me = m.you;
    if (g.phase === "end" || g.phase === "lobby") {
      g.phase = "lobby";
      g.status = "Waiting for the host to start.";
    }
  } else if (m.t === "q") {
    g.phase = "question";
    g.i = m.i;
    g.qid = m.id;
    g.deadline = Date.now() + m.left;
    g.mine = null;
    g.a = null;
    void loadQuestions().then(() => game === g && render());
  } else if (m.t === "reveal") {
    if (m.i !== g.i) return;
    g.phase = "reveal";
    g.a = m.a;
    g.players = m.players;
    saveMine();
  } else if (m.t === "end") {
    g.phase = "end";
    g.players = m.players;
  }
  changed();
}

function answer(k: number) {
  const g = game;
  if (!g || g.phase !== "question" || g.mine != null || Date.now() > g.deadline) return;
  g.mine = k;
  if (g.role === "host") hostAnswer(g.me, g.i, k);
  else g.links.forEach((_, l) => send(l, { t: "ans", i: g.i, k }));
  render();
}

// ---- what you see ----

function siteRoot(): string {
  return document.documentElement.dataset.app === "android" ? WEBSITE : `${location.origin}${base()}`;
}

function board(list: HTMLElement, players: Player[], showLast: boolean) {
  list.replaceChildren(...standings(players).map((p, i) => {
    const li = document.createElement("li");
    li.className = `battle__row${p.id === game?.me ? " battle__row--me" : ""}`;
    const rank = document.createElement("span");
    rank.className = "league__rank";
    rank.textContent = String(i + 1);
    const name = document.createElement("b");
    name.textContent = p.id === game?.me ? `${p.name} (you)` : p.name;
    const sc = document.createElement("span");
    sc.className = "battle__score";
    sc.textContent = `${p.score}`;
    li.append(rank, name);
    if (showLast && p.last) {
      const d = document.createElement("small");
      d.className = p.last.right ? "battle__gain" : "muted";
      d.textContent = p.last.k < 0 ? "no answer" : p.last.right ? `+${p.last.pts}` : "wrong";
      li.append(d);
    }
    li.append(sc);
    return li;
  }));
}

function renderClock() {
  const r = root();
  if (!r || !game) return;
  const left = Math.max(0, game.deadline - Date.now());
  const t = r.querySelector<HTMLElement>("[data-battle-timer]")!;
  t.textContent = `${Math.ceil(left / 1000)} s`;
  t.dataset.state = left <= 5000 ? "low" : "";
  r.querySelector<HTMLElement>("[data-battle-clock]")!.style.width = `${(left / (SECS * 1000)) * 100}%`;
  if (!left && game.mine == null) r.querySelectorAll<HTMLButtonElement>("[data-battle-options] button").forEach((b) => (b.disabled = true));
}

let shownQ = "";
function render() {
  const r = root();
  if (!r) return;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => r.querySelector<T>(sel)!;
  const g = game;
  $("[data-battle-setup]").hidden = !!g;
  $("[data-battle-lobby]").hidden = !g || g.phase !== "lobby";
  $("[data-battle-play]").hidden = !g || (g.phase !== "question" && g.phase !== "reveal");
  $("[data-battle-end]").hidden = !g || g.phase !== "end";
  if (!g) {
    shownQ = "";
    const msg = r.querySelector<HTMLElement>("[data-battle-ended]");
    if (msg) msg.remove();
    if (ended) {
      const p = document.createElement("p");
      p.className = "notice small";
      p.dataset.battleEnded = "";
      p.setAttribute("role", "status");
      p.textContent = ended;
      $("[data-battle-setup]").prepend(p);
    }
    return;
  }
  if (g.phase === "lobby") {
    $("[data-battle-lobby-title]").textContent = g.role === "host" ? "Your battle" : "Joined the battle";
    $("[data-battle-status]").textContent = g.status;
    $("[data-battle-about]").textContent = `${topicTitle(g.topic)} · ${g.n} questions · ${SECS} seconds each`;
    const pl = $("[data-battle-players]");
    pl.replaceChildren(...g.players.map((p) => {
      const li = document.createElement("li");
      li.textContent = p.id === g.me ? `${p.name} (you)` : p.name;
      if (p.id === "host") li.append(Object.assign(document.createElement("small"), { className: "muted", textContent: " host" }));
      return li;
    }));
    $("[data-battle-share]").hidden = g.role !== "host" || !g.connected;
    $<HTMLInputElement>("[data-battle-link]").value = `${siteRoot()}battle/?room=${g.code}`;
    const start = $<HTMLButtonElement>("[data-battle-start]");
    start.hidden = g.role !== "host";
    start.disabled = !g.connected;
    start.lastChild!.textContent = g.players.length > 1 ? ` Start the battle (${g.players.length} players)` : " Start on your own";
    // the friends list only makes sense while you can invite
    $("[data-together-friends]").style.display = g.role === "host" && g.connected ? "" : "none";
  }
  if (g.phase === "question" || g.phase === "reveal") {
    const q = questions?.get(g.qid);
    $("[data-battle-n]").textContent = `Question ${g.i + 1} of ${g.n || g.ids.length}`;
    if (shownQ !== `${g.i}:${g.qid}`) {
      shownQ = `${g.i}:${g.qid}`;
      $("[data-battle-q]").innerHTML = q ? q.q : "Loading the question…";
      $("[data-battle-options]").replaceChildren(...(q?.o ?? []).map((o, k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "quiz__opt";
        b.dataset.k = String(k);
        const letter = document.createElement("span");
        letter.className = "quiz__letter";
        letter.textContent = "ABCDEFGH"[k];
        const text = document.createElement("span");
        text.innerHTML = o;
        b.append(letter, text);
        b.addEventListener("click", () => answer(k));
        return b;
      }));
      if (!q) shownQ = "";
      else $("[data-battle-q]").focus({ preventScroll: true });
    }
    for (const b of r.querySelectorAll<HTMLButtonElement>("[data-battle-options] button")) {
      const k = Number(b.dataset.k);
      b.disabled = g.mine != null || g.phase === "reveal";
      b.setAttribute("aria-pressed", String(g.mine === k));
      b.dataset.state = g.phase === "reveal" ? (k === g.a ? "right" : k === g.mine ? "wrong" : "") : g.mine === k ? "chosen" : "";
    }
    const fb = $("[data-battle-feedback]");
    const waiting = g.role === "host" ? g.players.length - g.answers.size : 0;
    fb.hidden = g.mine == null && g.phase === "question";
    if (g.phase === "reveal") {
      const me = g.players.find((p) => p.id === g.me);
      fb.textContent = g.mine == null ? `Time's up. The answer is ${"ABCDEFGH"[g.a ?? 0]}.` : g.mine === g.a ? `✓ Correct. +${me?.last?.pts ?? 0} points.` : `✗ Not quite. The answer is ${"ABCDEFGH"[g.a ?? 0]}.`;
    } else if (g.mine != null) fb.textContent = waiting > 0 ? `Answer locked in. Waiting for ${waiting} more…` : "Answer locked in. Waiting for the others…";
    const bd = $("[data-battle-board]");
    bd.hidden = g.phase !== "reveal";
    if (g.phase === "reveal") board(bd, g.players, true);
    renderClock();
    if (g.phase === "reveal") $<HTMLElement>("[data-battle-timer]").textContent = "";
  }
  if (g.phase === "end") {
    const top = standings(g.players)[0];
    $("[data-battle-winner]").textContent = !top ? "Results" : top.id === g.me ? "You won!" : `${top.name} wins!`;
    board($("[data-battle-final]"), g.players, false);
    $("[data-battle-again]").hidden = g.role !== "host";
  }
}

export function setupBattle() {
  const r = root();
  if (!r) return;
  const signal = pageSignal();
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => r.querySelector<T>(sel)!;
  let n = 10;
  for (const b of r.querySelectorAll<HTMLButtonElement>("[data-battle-count]")) {
    b.addEventListener("click", () => {
      r.querySelectorAll("[data-battle-count]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      n = Number(b.dataset.battleCount);
    }, { signal });
  }
  $("[data-battle-create]").addEventListener("click", () => {
    if (!game) open("host", roomCode(), $<HTMLSelectElement>("[data-battle-topic]").value, n);
  }, { signal });
  $("[data-battle-start]").addEventListener("click", () => void startGame(), { signal });
  $("[data-battle-leave]").addEventListener("click", leave, { signal });
  $("[data-battle-done]").addEventListener("click", leave, { signal });
  $("[data-battle-again]").addEventListener("click", again, { signal });
  $("[data-battle-copy]").addEventListener("click", async () => {
    const input = $<HTMLInputElement>("[data-battle-link]");
    try {
      await navigator.clipboard.writeText(input.value);
      $("[data-battle-copy] [data-text]").textContent = "Copied";
    } catch {
      input.select();
    }
  }, { signal });
  // number keys answer, as on the MCQ page
  document.addEventListener("keydown", (e) => {
    if (!game || game.phase !== "question" || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = "1234".indexOf(e.key);
    if (k >= 0 && (questions?.get(game.qid)?.o.length ?? 0) > k) answer(k);
  }, { signal });
  // opened from an invite or a link: join
  const code = parseRoom(location.search);
  if (code && !game && !tried.has(code)) {
    tried.add(code);
    open("guest", code);
  }
  shownQ = "";
  render();
}
