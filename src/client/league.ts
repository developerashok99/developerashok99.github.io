/**
 * The weekly league: friends ranked by study points this week (Monday to Sunday), with their streaks.
 * Each person's numbers come from their profile (written when they sync); your own row uses this device's
 * numbers so it is never behind. Shown on the Account page ([data-league]) and as one line on Home ([data-league-line]).
 */
import { dayKey, weekOf, weekPoints } from "../lib/activity";
import { initials } from "../lib/sync";
import { accountBackend, currentUser } from "./account";
import { pageSignal } from "./page";
import { activity, studyStreak } from "./store";

interface Row {
  uid: string;
  name: string;
  week: number;
  streak: number;
  today: number;
  me: boolean;
}

async function rows(): Promise<Row[]> {
  const me = currentUser();
  if (!me) return [];
  const thisWeek = weekOf(dayKey());
  const list = await (await accountBackend()).listProfiles();
  const out = list.map((p) => {
    const current = p.week === thisWeek;
    return { uid: p.uid, name: p.name, week: current ? p.weekPoints ?? 0 : 0, streak: p.streak ?? 0, today: current ? p.todayPoints ?? 0 : 0, me: p.uid === me.uid };
  });
  // your own numbers from this device, which may be ahead of your last sync
  const st = studyStreak();
  const mine = { uid: me.uid, name: me.name, week: weekPoints(activity(), dayKey()), streak: st.current, today: st.todayPoints, me: true };
  const i = out.findIndex((r) => r.me);
  if (i >= 0) out[i] = { ...mine, week: Math.max(mine.week, out[i].week) };
  else out.push(mine);
  return out.sort((a, b) => b.week - a.week || b.streak - a.streak || a.name.localeCompare(b.name));
}

function renderTable(box: HTMLElement, list: Row[]) {
  const ol = box.querySelector("ol")!;
  ol.replaceChildren(...list.map((r, i) => {
    const li = document.createElement("li");
    li.className = `league__row${r.me ? " league__row--me" : ""}`;
    const rank = document.createElement("span");
    rank.className = "league__rank";
    rank.textContent = String(i + 1);
    const av = document.createElement("span");
    av.className = "friend__avatar";
    av.setAttribute("aria-hidden", "true");
    av.textContent = initials(r.name);
    const who = document.createElement("span");
    who.className = "league__who";
    const name = document.createElement("b");
    name.textContent = r.me ? `${r.name} (you)` : r.name;
    const sub = document.createElement("small");
    sub.className = "muted";
    sub.textContent = `${r.streak ? `🔥 ${r.streak}-day streak` : "No streak yet"} · ${r.today} today`;
    who.append(name, sub);
    const pts = document.createElement("span");
    pts.className = "league__pts";
    pts.innerHTML = `<b></b> <small>pts</small>`;
    pts.querySelector("b")!.textContent = String(r.week);
    li.append(rank, av, who, pts);
    return li;
  }));
}

function line(list: Row[]): string {
  const i = list.findIndex((r) => r.me);
  if (i < 0 || list.length < 2) return "";
  const me = list[i];
  if (i === 0) {
    const gap = me.week - list[1].week;
    return gap > 0 ? `You lead this week's league by ${gap} points.` : `You're level with ${list[1].name} at the top of this week's league.`;
  }
  const ahead = list[i - 1];
  return `#${i + 1} of ${list.length} this week · ${ahead.week - me.week + 1} points to pass ${ahead.name}.`;
}

export function setupLeague() {
  const boxes = document.querySelectorAll<HTMLElement>("[data-league], [data-league-line]");
  if (!boxes.length) return;
  const signal = pageSignal();
  let busy = false;
  const render = async () => {
    if (busy || !currentUser()) return;
    busy = true;
    try {
      const list = await rows();
      if (signal.aborted) return;
      for (const b of document.querySelectorAll<HTMLElement>("[data-league]")) {
        renderTable(b, list);
        b.hidden = false;
      }
      for (const b of document.querySelectorAll<HTMLElement>("[data-league-line]")) {
        const text = line(list);
        b.textContent = text;
        b.hidden = !text;
      }
    } catch (e) {
      console.warn("league unavailable", e);
    } finally {
      busy = false;
    }
  };
  void render();
  document.addEventListener("mls:signed-in", () => void render(), { signal });
  // your own points change as you study
  let t: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("mls:activity", () => {
    clearTimeout(t);
    t = setTimeout(() => void render(), 1500);
  }, { signal });
}
