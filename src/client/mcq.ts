/**
 * MCQ tests (src/pages/mcq.astro): builds a test from the course questions (mcq.json) and the shared bank
 * (database), runs it in exam or practice mode, marks it, and keeps the history (synced). Course answers are also
 * saved like lesson quiz answers, so wrong ones show on the Mistakes page and come back in later tests.
 * The question bank: list, filter, add, edit and delete your own.
 */
import { PASS, SECS_PER_QUESTION, buildTest, checkDraft, mark, textToHtml, type Mcq } from "../lib/mcq";
import { accountBackend, currentUser, type McqDoc } from "./account";
import { pageSignal } from "./page";
import { fetchSealedJson } from "./seal";
import { completedIds, mcqTests, quizResults, saveMcqTest, saveQuizAnswer, timeAgo } from "./store";
import { clock } from "./videos";

let courseP: Promise<Mcq[]> | null = null;
const loadCourse = (src: string) => (courseP ??= fetchSealedJson<Mcq[]>(src).catch((e) => {
  courseP = null;
  throw e;
}));

type BankItem = McqDoc & { id: string };
/** a friend's question as the test runs it */
function fromBank(d: BankItem, lessonLabel: (id: string) => string): Mcq {
  return {
    id: `bank-${d.id}`,
    q: textToHtml(d.q),
    o: d.options.map(textToHtml),
    a: d.answer,
    e: d.explain ? textToHtml(d.explain) : "",
    lid: d.lid,
    l: d.lid ? lessonLabel(d.lid) : "",
    s: "",
    d: "",
    href: "",
    by: d.authorName,
  };
}

export function setupMcq() {
  const found = document.querySelector<HTMLElement>("[data-mcq]");
  if (!found) return;
  const root: HTMLElement = found;
  const signal = pageSignal();
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const setup = $("[data-mcq-setup]"), run = $("[data-mcq-run]"), result = $("[data-mcq-result]");
  const msg = $("[data-mcq-msg]");
  const say = (el: HTMLElement, text: string, kind: "ok" | "error" = "error") => {
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = !text;
  };
  // lesson labels from the form's lesson list (no extra data needed)
  const labels = new Map([...root.querySelectorAll<HTMLOptionElement>("select[name=lid] option")].map((o) => [o.value, o.textContent?.split(" · ")[0] ?? ""]));
  const lessonLabel = (id: string) => labels.get(id) ?? id;

  // ---- choices ----
  let count = 20;
  let mode: "exam" | "practice" = "exam";
  const choose = (attr: string, set: (v: string) => void) => {
    for (const b of root.querySelectorAll<HTMLButtonElement>(`[${attr}]`)) {
      b.addEventListener("click", () => {
        for (const o of root.querySelectorAll(`[${attr}]`)) o.setAttribute("aria-pressed", String(o === b));
        set(b.getAttribute(attr)!);
      }, { signal });
    }
  };
  choose("data-mcq-count", (v) => (count = Number(v)));
  choose("data-mcq-mode", (v) => {
    mode = v as typeof mode;
    $("[data-mcq-mode-help]").textContent = mode === "exam"
      ? "Exam: 2 minutes a question, answers shown when you finish."
      : "Practice: no clock, and the answer is shown after each question.";
  });
  void loadCourse(root.dataset.src!).catch(() => {});

  // ---- the shared bank ----
  let bank: BankItem[] = [];
  let bankLoaded = false;
  async function loadBank() {
    const status = $("[data-mcq-bank-status]");
    try {
      bank = (await (await accountBackend()).listMcqs()).sort((a, b) => b.created - a.created);
      bankLoaded = true;
      status.textContent = bank.length ? "" : "No questions yet. Add the first one!";
      $("[data-mcq-friends-n]").textContent = `(${bank.length})`;
    } catch (e) {
      console.warn("question bank unavailable", e);
      status.textContent = "Couldn't load the question bank. Check the connection and open this page again.";
    }
    renderBank();
  }

  function renderBank() {
    const me = currentUser()?.uid;
    const f = $<HTMLInputElement>("[data-mcq-bank-filter]").value.trim().toLowerCase();
    const mine = $<HTMLInputElement>("[data-mcq-mine]").checked;
    const shown = bank.filter((d) => (!mine || d.author === me) && (!f || `${d.q} ${d.options.join(" ")} ${d.authorName}`.toLowerCase().includes(f)));
    $("[data-mcq-bank-list]").replaceChildren(...shown.map((d) => {
      const li = document.createElement("li");
      li.className = "card mcq-bank__item";
      const q = document.createElement("p");
      q.className = "mcq-bank__q";
      q.innerHTML = textToHtml(d.q);
      const opts = document.createElement("ol");
      opts.className = "mcq-bank__opts";
      d.options.forEach((o, i) => {
        const oi = document.createElement("li");
        oi.innerHTML = textToHtml(o);
        if (i === d.answer) {
          oi.dataset.right = "true";
          oi.append(" ✓");
        }
        opts.append(oi);
      });
      const meta = document.createElement("p");
      meta.className = "small muted";
      meta.textContent = `Added by ${d.author === me ? "you" : d.authorName} · ${timeAgo(d.updated || d.created)}${d.lid ? ` · ${lessonLabel(d.lid)}` : ""}`;
      li.append(q, opts, meta);
      if (d.author === me) {
        const row = document.createElement("div");
        row.className = "btn-row";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn btn--sm";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => openForm(d));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn--sm btn--ghost";
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
          if (!confirm("Delete this question for everyone?")) return;
          try {
            await (await accountBackend()).deleteMcq(d.id);
            bank = bank.filter((x) => x.id !== d.id);
            renderBank();
          } catch {
            alert("Couldn't delete it. Check the connection and try again.");
          }
        });
        row.append(edit, del);
        li.append(row);
      }
      return li;
    }));
    if (bankLoaded && bank.length && !shown.length) $("[data-mcq-bank-status]").textContent = "No questions match.";
    else if (bankLoaded && bank.length) $("[data-mcq-bank-status]").textContent = `${shown.length} of ${bank.length} questions`;
  }
  $("[data-mcq-bank-filter]").addEventListener("input", renderBank, { signal });
  $("[data-mcq-mine]").addEventListener("change", renderBank, { signal });

  // ---- add / edit ----
  const form = $<HTMLFormElement>("[data-mcq-form]");
  const formMsg = $("[data-mcq-form-msg]");
  let editing: BankItem | null = null;
  function openForm(d: BankItem | null) {
    editing = d;
    form.reset();
    say(formMsg, "");
    $("[data-mcq-form-title]").textContent = d ? "Edit your question" : "Add a question";
    const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
    if (d) {
      el("q").value = d.q;
      d.options.forEach((o, i) => el(`o${i}`) && (el(`o${i}`).value = o));
      (form.querySelector<HTMLInputElement>(`input[name=answer][value="${d.answer}"]`)!).checked = true;
      el("explain").value = d.explain;
      el("lid").value = d.lid;
    }
    form.hidden = false;
    el("q").focus();
  }
  $("[data-mcq-add]").addEventListener("click", () => openForm(null), { signal });
  $("[data-mcq-cancel]").addEventListener("click", () => (form.hidden = true), { signal });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = currentUser();
    if (!user) return say(formMsg, "Sign in again to add questions.");
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
    const options = [0, 1, 2, 3].map((i) => v(`o${i}`).trim());
    const draft = { q: v("q").trim(), options, answer: Number((form.querySelector<HTMLInputElement>("input[name=answer]:checked"))?.value ?? -1), explain: v("explain").trim(), lid: v("lid") };
    const problem = checkDraft(draft);
    if (problem) return say(formMsg, problem);
    const now = Date.now();
    const doc: McqDoc = {
      q: draft.q, options: options.filter(Boolean), answer: draft.answer, explain: draft.explain, lid: draft.lid,
      author: user.uid, authorName: user.name, created: editing?.created ?? now, updated: now,
    };
    const btn = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    btn.disabled = true;
    try {
      const id = await (await accountBackend()).saveMcq(editing?.id ?? null, doc);
      bank = [{ ...doc, id }, ...bank.filter((x) => x.id !== id)];
      form.hidden = true;
      renderBank();
      $("[data-mcq-friends-n]").textContent = `(${bank.length})`;
    } catch (err) {
      console.warn(err);
      say(formMsg, "Couldn't save it. Check the connection and try again.");
    } finally {
      btn.disabled = false;
    }
  }, { signal });

  // ---- the test ----
  let questions: Mcq[] = [];
  let answers: Record<string, number> = {};
  const flagged = new Set<string>();
  let at = 0, startedAt = 0, topicName = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  signal.addEventListener("abort", () => clearInterval(timer));

  function renderMap() {
    const map = $("[data-mcq-map]");
    map.replaceChildren(...questions.map((q, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(i + 1);
      b.dataset.state = flagged.has(q.id) ? "flagged" : q.id in answers ? "answered" : "";
      if (i === at) b.setAttribute("aria-current", "true");
      b.setAttribute("aria-label", `Question ${i + 1}${q.id in answers ? ", answered" : ""}${flagged.has(q.id) ? ", flagged" : ""}`);
      b.addEventListener("click", () => show(i));
      li.append(b);
      return li;
    }));
    $("[data-mcq-answered]").textContent = `(${Object.keys(answers).length} of ${questions.length} answered)`;
  }

  function show(i: number) {
    at = i;
    const q = questions[i];
    $("[data-mcq-n]").textContent = `Question ${i + 1} of ${questions.length}`;
    $("[data-mcq-where]").textContent = q.by ? `From ${q.by}${q.l ? ` · ${q.l}` : ""}` : `${q.l} · ${q.d}`;
    $("[data-mcq-bar]").style.width = `${(Object.keys(answers).length / questions.length) * 100}%`;
    $("[data-mcq-q]").innerHTML = q.q;
    const box = $("[data-mcq-options]");
    const practiceDone = mode === "practice" && q.id in answers;
    box.replaceChildren(...q.o.map((o, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiz__opt";
      b.setAttribute("aria-pressed", String(answers[q.id] === k));
      const letter = document.createElement("span");
      letter.className = "quiz__letter";
      letter.textContent = "ABCDEFGH"[k];
      const text = document.createElement("span");
      text.innerHTML = o;
      b.append(letter, text);
      if (practiceDone) {
        b.disabled = true;
        b.dataset.state = k === q.a ? "right" : k === answers[q.id] ? "wrong" : "";
      }
      b.addEventListener("click", () => answer(k));
      return b;
    }));
    const fb = $("[data-mcq-feedback]");
    fb.hidden = !practiceDone;
    if (practiceDone) {
      const ok = answers[q.id] === q.a;
      $("[data-mcq-verdict]").textContent = ok ? "✓ Correct." : `✗ Not quite. The answer is ${"ABCDEFGH"[q.a]}.`;
      $("[data-mcq-explain]").innerHTML = q.e;
    }
    $<HTMLButtonElement>("[data-mcq-prev]").disabled = i === 0;
    $<HTMLButtonElement>("[data-mcq-next]").disabled = i === questions.length - 1;
    $("[data-mcq-flag]").setAttribute("aria-pressed", String(flagged.has(q.id)));
    $("[data-mcq-flag]").hidden = mode === "practice";
    renderMap();
  }

  function answer(k: number) {
    const q = questions[at];
    if (mode === "practice" && q.id in answers) return;
    answers[q.id] = k;
    show(at);
    if (mode === "practice") $("[data-mcq-feedback]").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function start() {
    say(msg, "");
    let course: Mcq[];
    try {
      course = await loadCourse(root.dataset.src!);
    } catch {
      return say(msg, "Couldn't load the questions. Check the connection and try again.");
    }
    const topic = $<HTMLSelectElement>("[data-mcq-topic]").value;
    const withFriends = $<HTMLInputElement>("[data-mcq-friends]").checked || topic === "friends";
    const friends = withFriends ? bank.map((d) => fromBank(d, lessonLabel)) : [];
    const done = new Set(completedIds());
    let pool: Mcq[];
    if (topic === "friends") pool = friends;
    else if (topic === "done") pool = [...course, ...friends].filter((q) => q.lid && done.has(q.lid));
    else if (topic) pool = [...course.filter((q) => q.s === topic), ...friends.filter((q) => course.some((c) => c.lid === q.lid && c.s === topic))];
    else pool = [...course, ...friends];
    if (!pool.length) {
      return say(msg, topic === "done" ? "You haven't completed any lessons yet. Pick a topic instead." : topic === "friends" ? "Nobody has added a question yet." : "No questions for that choice.");
    }
    const wrong = new Set(Object.entries(quizResults()).filter(([, r]) => r.last === "wrong").map(([id]) => id));
    questions = buildTest(pool, count, wrong);
    answers = {};
    flagged.clear();
    finished = false;
    topicName = $<HTMLSelectElement>("[data-mcq-topic]").selectedOptions[0]?.textContent?.replace(/\s*\(\d+( questions)?\)$/, "") ?? "Whole course";
    startedAt = Date.now();
    setup.hidden = true;
    result.hidden = true;
    run.hidden = false;
    // the clock (exam mode)
    clearInterval(timer);
    const t = $("[data-mcq-timer]");
    t.hidden = mode !== "exam";
    if (mode === "exam") {
      const end = startedAt + questions.length * SECS_PER_QUESTION * 1000;
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        t.textContent = clock(left);
        t.dataset.state = left <= 60 ? "low" : "";
        if (!left) void finish(true);
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    show(0);
    $("[data-mcq-q]").focus();
  }

  function finish(timeUp = false) {
    if (finished) return;
    const unanswered = questions.length - Object.keys(answers).length;
    if (!timeUp && unanswered && !confirm(`${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered and will count as wrong. Finish anyway?`)) return;
    finished = true;
    clearInterval(timer);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const m = mark(questions, answers);
    // course questions count like lesson quiz answers: wrong ones go to the Mistakes page and come back later
    for (const q of questions) if (!q.id.startsWith("bank-") && q.id in answers) saveQuizAnswer(q.id, answers[q.id] === q.a);
    saveMcqTest({ at: startedAt, mode, topic: topicName, total: m.total, right: m.right, secs });

    run.hidden = true;
    $("[data-mcq-score]").textContent = `${m.percent}%`;
    const pass = $("[data-mcq-pass]");
    pass.textContent = m.passed ? "Pass" : "Not yet";
    pass.className = `pill ${m.passed ? "pill--green" : "pill--amber"}`;
    $("[data-mcq-right]").textContent = `${m.right} of ${m.total} right (${PASS}% to pass)`;
    $("[data-mcq-time]").textContent = `${timeUp ? "Time ran out · " : ""}${clock(secs)} · ${mode === "exam" ? "Exam" : "Practice"} · ${topicName}`;
    $("[data-mcq-sections]").replaceChildren(...m.sections.map((s) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${s.title}: ${s.right}/${s.total}`;
      const bar = document.createElement("span");
      bar.className = "progress";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.width = `${s.percent}%`;
      bar.append(fill);
      li.append(label, bar);
      return li;
    }));
    renderReview();
    result.hidden = false;
    result.focus();
    renderHistory();
  }

  function renderReview() {
    const all = $<HTMLInputElement>("[data-mcq-show-all]").checked;
    $("[data-mcq-review]").replaceChildren(...questions.flatMap((q, i) => {
      const ok = answers[q.id] === q.a;
      if (ok && !all) return [];
      const li = document.createElement("li");
      li.value = i + 1;
      li.dataset.ok = String(ok);
      const head = document.createElement("p");
      head.className = "mcq-review__q";
      head.innerHTML = q.q;
      const yours = document.createElement("p");
      yours.className = "small";
      const picked = answers[q.id];
      yours.innerHTML = `${ok ? "✓" : "✗"} Your answer: ${picked == null ? "<i>none</i>" : `${"ABCDEFGH"[picked]}. ${q.o[picked]}`}${ok ? "" : `<br>Right answer: ${"ABCDEFGH"[q.a]}. ${q.o[q.a]}`}`;
      li.append(head, yours);
      if (q.e) {
        const ex = document.createElement("p");
        ex.className = "small muted";
        ex.innerHTML = q.e;
        li.append(ex);
      }
      if (q.href) {
        const a = document.createElement("a");
        a.className = "small";
        a.href = q.href;
        a.textContent = `Revise ${q.l}`;
        li.append(a);
      }
      return [li];
    }));
    if (!$("[data-mcq-review]").childElementCount) $("[data-mcq-review]").innerHTML = `<li class="empty">All right. Nothing to review.</li>`;
  }
  $("[data-mcq-show-all]").addEventListener("change", renderReview, { signal });

  function renderHistory() {
    const list = mcqTests();
    $("[data-mcq-history-empty]").hidden = list.length > 0;
    $("[data-mcq-history-wrap]").hidden = !list.length;
    $("[data-mcq-history]").replaceChildren(...list.slice(0, 20).map((t) => {
      const tr = document.createElement("tr");
      const pct = t.total ? Math.round((t.right / t.total) * 100) : 0;
      for (const text of [timeAgo(t.at), t.mode === "exam" ? "Exam" : "Practice", t.topic, `${pct}% (${t.right}/${t.total})`, pct >= PASS ? "Pass" : "Not yet", clock(t.secs)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }));
  }
  renderHistory();
  window.addEventListener("mls:store", (e) => {
    const key = (e as CustomEvent<{ key: string }>).detail?.key;
    if (key === "*" || key === "mls.mcqTests") renderHistory();
  }, { signal });

  $("[data-mcq-start]").addEventListener("click", () => void start(), { signal });
  $("[data-mcq-prev]").addEventListener("click", () => at > 0 && show(at - 1), { signal });
  $("[data-mcq-next]").addEventListener("click", () => at < questions.length - 1 && show(at + 1), { signal });
  $("[data-mcq-flag]").addEventListener("click", () => {
    const id = questions[at].id;
    if (flagged.has(id)) flagged.delete(id);
    else flagged.add(id);
    show(at);
  }, { signal });
  $("[data-mcq-submit]").addEventListener("click", () => finish(), { signal });
  $("[data-mcq-again]").addEventListener("click", () => {
    result.hidden = true;
    setup.hidden = false;
    setup.scrollIntoView({ block: "start" });
  }, { signal });
  // keys: 1–4 or A–D pick an answer, ← → move
  document.addEventListener("keydown", (e) => {
    if (run.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (k >= 0 && k < (questions[at]?.o.length ?? 0)) answer(k);
    else if (e.key === "ArrowRight" && at < questions.length - 1) show(at + 1);
    else if (e.key === "ArrowLeft" && at > 0) show(at - 1);
  }, { signal });

  void loadBank();
}
