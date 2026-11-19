/**
 * Today's session (src/pages/today.astro): plans a short mixed session (src/lib/today.ts) from what is due, runs it
 * one step at a time, and saves every answer exactly as the Revision flashcards and lesson quizzes do, so it all
 * counts towards the schedule, Mistakes, mastery and today's study points.
 */
import type { RenderedCard } from "../lib/cardsHtml";
import { buildTest, shuffle, type Mcq } from "../lib/mcq";
import { lessonMastery, weakestLessons, type LessonInfo } from "../lib/mastery";
import { recommend } from "../lib/progress";
import { describeWait, GRADES, queue, schedule, type Grade } from "../lib/srs";
import { minutes, plan, type Step } from "../lib/today";
import { pageSignal } from "./page";
import { fetchSealedJson } from "./seal";
import { completedIds, newPerDay, newStartedToday, noteNewStarted, prefs, quizResults, recent, saveCardState, saveQuizAnswer, setPrefs, srsStates, startedIds, studyStreak } from "./store";

interface IndexItem extends LessonInfo {
  section: string;
  href: string;
  revise: string;
  video: string;
}
interface Topic {
  id: string;
  title: string;
  lessons: string[];
}

const GRADE_LABEL: Record<Grade, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

export function setupToday() {
  const root = document.querySelector<HTMLElement>("[data-today]");
  if (!root) return;
  const signal = pageSignal();
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const json = <T>(sel: string, fallback: T): T => {
    try {
      return JSON.parse(root.querySelector(sel)?.textContent || "") as T;
    } catch {
      return fallback;
    }
  };
  const index = json<IndexItem[]>("[data-study-index]", []);
  const byId = new Map(index.map((l) => [l.id, l]));
  const topics = json<Topic[]>("[data-exam-topics]", []);
  const topic = topics.find((t) => t.id === new URLSearchParams(location.search).get("topic")) ?? null;

  let cards = new Map<string, RenderedCard>();
  let questions = new Map<string, Mcq>();
  let steps: Step[] = [];
  let at = 0;
  let pointsAtStart = 0;
  let right = 0;
  let asked = 0;

  const say = (text: string) => {
    const m = $("[data-today-msg]");
    m.textContent = text;
    m.hidden = !text;
  };

  /** questions to strengthen: the weakest lessons' (or one exam topic's) questions, not-yet-right first */
  function weakQuestions(): string[] {
    const quiz = quizResults();
    const all = [...questions.values()];
    if (topic) {
      const pool = all.filter((q) => topic.lessons.includes(q.lid));
      const wrong = new Set(pool.filter((q) => quiz[q.id]?.last === "wrong").map((q) => q.id));
      return buildTest(pool, 10, wrong).map((q) => q.id);
    }
    const done = new Set(completedIds());
    let lessons = weakestLessons(lessonMastery(index, quiz, srsStates()), done, 3);
    // nothing to go on yet: the lessons you're on
    if (!lessons.length) lessons = [...new Set([...recent().map((r) => r.id), ...startedIds()])].filter((id) => byId.has(id)).slice(0, 2);
    if (!lessons.length && index[0]) lessons = [index[0].id];
    const lanes = lessons.map((lid) => shuffle(all.filter((q) => q.lid === lid && quiz[q.id]?.last !== "right")));
    const out: string[] = [];
    while (lanes.some((l) => l.length)) for (const l of lanes) if (l.length) out.push(l.shift()!.id);
    return out;
  }

  function makePlan(): Step[] {
    if (topic) return weakQuestions().map((id) => ({ kind: "question" as const, id, why: "topic" as const }));
    const q = queue([...cards.keys()], srsStates());
    const mistakes = Object.entries(quizResults())
      .filter(([id, r]) => r.last === "wrong" && questions.has(id))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([id]) => id);
    return plan({ dueCards: q.due, freshCards: q.fresh, newLeft: newPerDay() - newStartedToday(), mistakes, weak: weakQuestions() });
  }

  function renderStart() {
    steps = makePlan();
    const nCards = steps.filter((s) => s.kind === "card").length;
    const nMistakes = steps.filter((s) => s.kind === "question" && s.why === "mistake").length;
    const nWeak = steps.length - nCards - nMistakes;
    if (topic) $("[data-today-title]").textContent = `Practise: ${topic.title}`;
    $("[data-today-summary]").textContent = steps.length
      ? `${steps.length} items · about ${minutes(steps)} minute${minutes(steps) === 1 ? "" : "s"}`
      : topic ? "No questions for this topic yet." : "";
    const parts = $("[data-today-parts]");
    const li = (text: string) => Object.assign(document.createElement("li"), { textContent: text });
    parts.replaceChildren(
      ...(nCards ? [li(`${nCards} flashcard${nCards === 1 ? "" : "s"} due for review`)] : []),
      ...(nMistakes ? [li(`${nMistakes} question${nMistakes === 1 ? "" : "s"} you got wrong before`)] : []),
      ...(nWeak ? [li(topic ? `${nWeak} questions from this topic, ones you haven't got right first` : `${nWeak} question${nWeak === 1 ? "" : "s"} from your weakest lessons`)] : []),
    );
    parts.hidden = !steps.length;
    $("[data-today-go]").hidden = !steps.length;
    $("[data-today-empty]").hidden = steps.length > 0 || !!topic;
    if (!steps.length) {
      const rec = recommend(index, new Set(completedIds()));
      const next = $<HTMLAnchorElement>("[data-today-next]");
      if (rec) {
        const l = index[rec.i];
        next.href = l.video || l.href;
        next.textContent = `Next: ${l.label} ${l.video ? "lecture" : "lesson"}`;
        next.hidden = false;
      }
    }
  }

  function start() {
    if (!steps.length) return;
    at = 0;
    right = 0;
    asked = 0;
    pointsAtStart = studyStreak().todayPoints;
    $("[data-today-start]").hidden = true;
    $("[data-today-done]").hidden = true;
    $("[data-today-run]").hidden = false;
    show();
  }

  function show() {
    const s = steps[at];
    $("[data-today-n]").textContent = `${at + 1} of ${steps.length}`;
    $("[data-today-bar]").style.width = `${(at / steps.length) * 100}%`;
    const box = $("[data-today-step]");
    if (s.kind === "card") showCard(box, s.id, s.fresh);
    else showQuestion(box, s.id, s.why);
    box.focus({ preventScroll: true });
  }

  const kind = (text: string, tone = "") => {
    const k = $("[data-today-kind]");
    k.textContent = text;
    k.className = `pill${tone ? ` pill--${tone}` : ""}`;
  };

  function where(lid: string) {
    const l = byId.get(lid);
    const p = document.createElement("p");
    p.className = "small muted today__where";
    if (l) {
      const a = document.createElement("a");
      a.href = l.revise;
      a.textContent = `${l.label}: ${l.title}`;
      p.append(a);
    }
    return p;
  }

  function showCard(box: HTMLElement, id: string, fresh: boolean) {
    const c = cards.get(id);
    if (!c) return next();
    kind(fresh ? "New flashcard" : "Flashcard", "blue");
    const q = document.createElement("div");
    q.className = "flashcard__q";
    q.innerHTML = c.q;
    const a = document.createElement("div");
    a.className = "flashcard__a";
    a.innerHTML = c.a;
    a.hidden = true;
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "btn btn--primary";
    reveal.textContent = "Show answer";
    const grades = document.createElement("div");
    grades.className = "btn-row today__grades";
    grades.hidden = true;
    const prev = srsStates()[id];
    for (const g of GRADES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn btn--sm${g === "good" ? " btn--primary" : ""}`;
      const next = schedule(prev, g);
      b.innerHTML = `${GRADE_LABEL[g]} <small>${describeWait(next.due - Date.now())}</small>`;
      b.setAttribute("aria-label", `${GRADE_LABEL[g]}: see it again in ${describeWait(next.due - Date.now())}`);
      b.addEventListener("click", () => {
        saveCardState(id, schedule(srsStates()[id], g));
        if (fresh) noteNewStarted();
        nextStep();
      });
      grades.append(b);
    }
    reveal.addEventListener("click", () => {
      a.hidden = false;
      reveal.hidden = true;
      grades.hidden = false;
      (grades.querySelector(".btn--primary") as HTMLElement | null)?.focus();
    });
    const hint = document.createElement("p");
    hint.className = "small muted";
    hint.textContent = "Say the answer to yourself, then check it.";
    box.replaceChildren(where(c.lid), q, hint, reveal, a, grades);
  }

  function showQuestion(box: HTMLElement, id: string, why: string) {
    const q = questions.get(id);
    if (!q) return next();
    kind(why === "mistake" ? "Wrong last time" : why === "topic" ? "Topic practice" : "Strengthen", why === "mistake" ? "amber" : "");
    const legend = document.createElement("p");
    legend.className = "iv-question";
    legend.innerHTML = q.q;
    const opts = document.createElement("div");
    opts.className = "quiz__options";
    opts.setAttribute("role", "group");
    opts.setAttribute("aria-label", "Answers");
    const fb = document.createElement("div");
    fb.className = "quiz__feedback";
    fb.setAttribute("role", "status");
    fb.hidden = true;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--primary";
    go.textContent = at === steps.length - 1 ? "Finish" : "Next";
    go.hidden = true;
    go.addEventListener("click", nextStep);
    const buttons = q.o.map((o, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiz__opt";
      const letter = document.createElement("span");
      letter.className = "quiz__letter";
      letter.textContent = "ABCDEFGH"[k];
      const text = document.createElement("span");
      text.innerHTML = o;
      b.append(letter, text);
      b.addEventListener("click", () => {
        const ok = k === q.a;
        asked++;
        if (ok) right++;
        saveQuizAnswer(id, ok);
        for (const [j, x] of buttons.entries()) {
          x.disabled = true;
          x.dataset.state = j === q.a ? "right" : j === k ? "wrong" : "";
        }
        fb.innerHTML = "";
        const v = document.createElement("p");
        v.textContent = ok ? "✓ Correct." : `✗ Not quite. The answer is ${"ABCDEFGH"[q.a]}.`;
        const e = document.createElement("p");
        e.className = "small muted";
        e.innerHTML = q.e;
        fb.append(v, e);
        fb.hidden = false;
        go.hidden = false;
        go.focus();
      });
      return b;
    });
    opts.append(...buttons);
    const row = document.createElement("div");
    row.className = "btn-row";
    row.append(go);
    box.replaceChildren(where(q.lid), legend, opts, fb, row);
  }

  function next() {
    nextStep();
  }
  function nextStep() {
    at++;
    if (at >= steps.length) return finish();
    show();
  }

  function finish() {
    $("[data-today-run]").hidden = true;
    const st = studyStreak();
    const earned = st.todayPoints - pointsAtStart;
    const parts = [`+${earned} study points.`];
    if (asked) parts.push(`${right} of ${asked} questions right.`);
    parts.push(st.todayMet ? `Today's goal is reached${st.current > 1 ? `: ${st.current}-day streak` : ""}.` : `${st.goal - st.todayPoints} more points reach today's goal.`);
    $("[data-today-result]").textContent = parts.join(" ");
    // what to do next: watch the next lecture
    const rec = recommend(index, new Set(completedIds()));
    const after = $<HTMLAnchorElement>("[data-today-after]");
    if (rec) {
      const l = index[rec.i];
      after.href = l.video || l.href;
      after.textContent = `Next: ${l.label} ${l.video ? "lecture" : "lesson"}`;
      after.hidden = false;
    }
    const more = makePlan();
    $("[data-today-again]").hidden = !more.length;
    // in the app: offer the daily reminder once, at the moment a habit is starting
    $("[data-today-remind]").hidden = !window.mlsReminders || !!prefs().reminder;
    $("[data-today-done]").hidden = false;
    $("[data-today-done]").focus();
  }

  $("[data-today-go]").addEventListener("click", start, { signal });
  $("[data-today-remind] button").addEventListener("click", async () => {
    const box = $("[data-today-remind]");
    if (!(await window.mlsReminders?.enable())) {
      box.lastElementChild!.textContent = "Notifications are off for this app. Allow them in Android Settings, then turn the reminder on in Preferences.";
      return;
    }
    setPrefs({ reminder: true, reminderTime: prefs().reminderTime ?? "19:00" });
    box.replaceChildren("Done. You'll get a reminder at 7 pm on days you haven't reached your goal.");
  }, { signal });
  $("[data-today-stop]").addEventListener("click", () => {
    $("[data-today-run]").hidden = true;
    $("[data-today-start]").hidden = false;
    renderStart();
  }, { signal });
  $("[data-today-again]").addEventListener("click", () => {
    $("[data-today-done]").hidden = true;
    $("[data-today-start]").hidden = false;
    renderStart();
    start();
  }, { signal });

  void Promise.all([fetchSealedJson<RenderedCard[]>(root.dataset.cards!), fetchSealedJson<Mcq[]>(root.dataset.questions!)])
    .then(([c, q]) => {
      cards = new Map(c.map((x) => [x.id, x]));
      questions = new Map(q.map((x) => [x.id, x]));
      if (!signal.aborted) renderStart();
    })
    .catch((e) => {
      console.warn("today's session unavailable", e);
      $("[data-today-summary]").textContent = "";
      say("Couldn't load today's questions. Check the connection and open this page again.");
    });
}
