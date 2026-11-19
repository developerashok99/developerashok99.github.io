/** The Mastery page (src/pages/mastery.astro): readiness, exam topics weakest first, and a map of every lesson. */
import { lessonMastery, readiness, topicMastery, type LessonInfo } from "../lib/mastery";
import { pageSignal } from "./page";
import { quizResults, srsStates } from "./store";

interface IndexItem extends LessonInfo {
  revise: string;
}

/** colour band of a score: none, under 40, 40–69, 70–84, 85+ */
export const band = (score: number | null) => (score == null ? "none" : score < 40 ? "0" : score < 70 ? "1" : score < 85 ? "2" : "3");

export function setupMastery() {
  const root = document.querySelector<HTMLElement>("[data-mastery]");
  if (!root) return;
  const json = <T>(sel: string, fallback: T): T => {
    try {
      return JSON.parse(root.querySelector(sel)?.textContent || "") as T;
    } catch {
      return fallback;
    }
  };
  const index = json<IndexItem[]>("[data-study-index]", []);
  const byId = new Map(index.map((l) => [l.id, l]));
  const sections = json<{ title: string; lessons: string[] }[]>("[data-sections]", []);
  const today = root.dataset.todayHref!;
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;

  const render = () => {
    const m = lessonMastery(index, quizResults(), srsStates());
    const topics = topicMastery(m);
    const r = readiness(topics);
    $("[data-rd-pct]").textContent = `${r.percent}%`;
    $("[data-rd-fill]").setAttribute("stroke-dasharray", `${r.percent} 100`);
    $("[data-rd-ring]").setAttribute("aria-label", `Exam readiness ${r.percent}%`);
    $("[data-rd-label]").textContent = r.label;
    $("[data-rd-advice]").textContent = r.advice;
    const sorted = [...topics].sort((a, b) => a.score - b.score);
    root.querySelector<HTMLAnchorElement>("[data-rd-weakest]")!.href = `${today}?topic=${sorted[0]?.id ?? ""}`;

    $("[data-topics]").replaceChildren(...sorted.map((t) => {
      const li = document.createElement("li");
      li.className = "topic-row";
      li.dataset.band = band(t.tried ? t.score : null);
      const head = document.createElement("div");
      head.className = "topic-row__head";
      const name = document.createElement("b");
      name.textContent = t.title;
      const pct = document.createElement("span");
      pct.className = "topic-row__pct";
      pct.textContent = `${t.score}%`;
      head.append(name, pct);
      const bar = document.createElement("div");
      bar.className = "progress progress--thin";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${t.title}: mastery`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(t.score));
      const fill = document.createElement("span");
      fill.style.width = `${t.score}%`;
      bar.append(fill);
      const foot = document.createElement("div");
      foot.className = "topic-row__foot";
      const info = document.createElement("span");
      info.className = "small muted";
      info.textContent = `${t.tried} of ${t.lessons.length} lessons tested · ${t.lessons.map((id) => byId.get(id)?.label ?? id).join(", ")}`;
      const go = document.createElement("a");
      go.className = "btn btn--sm";
      go.href = `${today}?topic=${t.id}`;
      go.textContent = "Practise";
      go.setAttribute("aria-label", `Practise ${t.title}`);
      foot.append(info, go);
      li.append(head, bar, foot);
      return li;
    }));

    $("[data-lesson-map]").replaceChildren(...sections.map((s) => {
      const box = document.createElement("section");
      box.className = "lesson-map__section";
      const h = document.createElement("h3");
      h.textContent = s.title;
      const grid = document.createElement("ul");
      grid.className = "lesson-map__grid";
      grid.append(...s.lessons.filter((id) => byId.has(id)).map((id) => {
        const l = byId.get(id)!;
        const x = m.get(id)!;
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = l.revise;
        a.dataset.band = band(x.score);
        // "Day 15" → "15", "Interview Part 2" → "IP2": the square only fits a few characters
        a.textContent = l.label.replace(/^Day\s+/, "").replace(/^Interview Part\s*/i, "IP");
        a.title = `${l.label}: ${l.title}`;
        a.setAttribute("aria-label", `${l.label}, ${l.title}: ${x.score == null ? "not tested yet" : `${x.score}% mastered`}`);
        li.append(a);
        return li;
      }));
      box.append(h, grid);
      return box;
    }));
  };
  render();
  window.addEventListener("mls:store", render, { signal: pageSignal() });
}
