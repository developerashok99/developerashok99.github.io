/**
 * The daily goal card (src/components/GoalCard.astro) and the "goal reached" message.
 * Everything comes from the activity counts in src/client/store.ts.
 */
import { pageSignal } from "./page";
import { studyStreak } from "./store";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATE_WORDS: Record<string, string> = { met: "goal reached", frozen: "missed, saved by the weekly freeze", missed: "no study", partial: "some study", today: "today, in progress", none: "no study" };

function render() {
  const s = studyStreak();
  for (const card of document.querySelectorAll<HTMLElement>("[data-goal-card]")) {
    const $ = (sel: string) => card.querySelector<HTMLElement>(sel);
    const pct = Math.min(100, Math.round((s.todayPoints / s.goal) * 100));
    $("[data-goal-points]")!.textContent = String(s.todayPoints);
    $("[data-goal-target]")!.textContent = String(s.goal);
    $("[data-goal-fill]")!.setAttribute("stroke-dasharray", `${pct} 100`);
    $("[data-goal-ring]")!.setAttribute("aria-label", `${s.todayPoints} of ${s.goal} study points today${s.todayMet ? ": goal reached" : ""}`);
    card.dataset.met = String(s.todayMet);
    $("[data-goal-streak]")!.textContent = String(s.current);
    const left = s.goal - s.todayPoints;
    $("[data-goal-msg]")!.textContent = s.todayMet
      ? `Today's goal reached. ${s.best > s.current ? `Best streak: ${s.best} days.` : s.current > 1 ? "That's your best streak yet." : "Come back tomorrow to start a streak."}`
      : s.current > 0
        ? `${left} more point${left === 1 ? "" : "s"} today keeps your ${s.current}-day streak going.${s.freezeUsed ? " This week's freeze is used." : ""}`
        : `${left} point${left === 1 ? "" : "s"} to reach today's goal and start a streak.`;
    const week = $("[data-goal-week]")!;
    week.replaceChildren(...s.week.map((d) => {
      const li = document.createElement("li");
      li.dataset.state = d.state;
      const [y, m, dd] = d.day.split("-").map(Number);
      const name = DAY_NAMES[new Date(y, m - 1, dd, 12).getDay()];
      li.textContent = name[0];
      li.title = `${name}: ${d.points} points, ${STATE_WORDS[d.state]}`;
      const sr = document.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = `, ${d.points} points, ${STATE_WORDS[d.state]}`;
      li.append(sr);
      return li;
    }));
  }
}

let wired = false;
export function setupGoal() {
  if (!wired) {
    wired = true;
    // the moment today's goal is reached, wherever you are
    window.addEventListener("mls:activity", (e) => {
      const d = (e as CustomEvent<{ goalReached: boolean; streak: number }>).detail;
      if (!d.goalReached) return;
      const t = document.querySelector<HTMLElement>("[data-toast]");
      if (!t) return;
      t.textContent = d.streak > 1 ? `Daily goal reached. ${d.streak}-day streak!` : "Daily goal reached. Well done!";
      t.hidden = false;
      clearTimeout(Number(t.dataset.timer));
      t.dataset.timer = String(setTimeout(() => (t.hidden = true), 5000));
    });
  }
  if (!document.querySelector("[data-goal-card]")) return;
  render();
  const signal = pageSignal();
  window.addEventListener("mls:activity", render, { signal });
  // a sync brings in what you did on your other devices
  window.addEventListener("mls:store", (e) => {
    const k = (e as CustomEvent<{ key: string }>).detail.key;
    if (k === "mls.activity" || k === "*") render();
  }, { signal });
}

