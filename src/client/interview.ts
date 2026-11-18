/**
 * Mock interview (src/pages/interview.astro): picks questions (src/lib/interview.ts), times each answer, optionally
 * records it so you can listen back (the recording never leaves the device), shows the model answer and records your
 * self-rating. Finished sessions are saved (synced to your account) and missed questions come due in the flashcards.
 */
import { lastRatings, pickQuestions, scoreOf, verdict } from "../lib/interview";
import { schedule } from "../lib/srs";
import type { RenderedCard } from "../lib/cardsHtml";
import { pageSignal } from "./page";
import { completedIds, interviewScore, interviews, saveCardState, saveInterview, srsStates, timeAgo, type InterviewSession } from "./store";
import { clock } from "./videos";
import { fetchSealedJson } from "./seal";

let cardsP: Promise<RenderedCard[]> | null = null;
const loadCards = (src: string) => (cardsP ??= fetchSealedJson<RenderedCard[]>(src).catch((e) => {
  cardsP = null;
  throw e;
}));

const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export function setupInterview() {
  const found = document.querySelector<HTMLElement>("[data-interview]");
  if (!found) return;
  const root: HTMLElement = found;
  const signal = pageSignal();
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const setup = $("[data-iv-setup]"), live = $("[data-iv-live]"), summary = $("[data-iv-summary]");
  const setupMsg = $("[data-iv-setup-msg]");

  // choices
  let count = 10, perAnswer = 120;
  const pick = (attr: string, set: (v: number) => void) => {
    for (const b of root.querySelectorAll<HTMLButtonElement>(`[${attr}]`)) {
      b.addEventListener("click", () => {
        for (const o of root.querySelectorAll(`[${attr}]`)) o.setAttribute("aria-pressed", String(o === b));
        set(Number(b.getAttribute(attr)));
      }, { signal });
    }
  };
  pick("data-iv-count", (v) => (count = v));
  pick("data-iv-time", (v) => (perAnswer = v));
  if (canRecord()) $("[data-iv-rec-option]").hidden = false;
  // speed up loading: fetch the questions while you choose
  void loadCards(root.dataset.src!).catch(() => {});

  // the running interview
  let questions: RenderedCard[] = [];
  let ratings: Record<string, 0 | 1 | 2> = {};
  let at = 0, startedAt = 0, topicName = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let clipUrl = "";
  const stopTimer = () => clearInterval(timer);

  const stopRecording = () => new Promise<void>((done) => {
    if (!recorder || recorder.state === "inactive") return done();
    recorder.addEventListener("stop", () => done(), { once: true });
    recorder.stop();
  });
  const releaseMic = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = "";
  };
  signal.addEventListener("abort", () => {
    stopTimer();
    void stopRecording().then(releaseMic);
  });

  async function startRecording() {
    if (!$<HTMLInputElement>("[data-iv-record]").checked || !canRecord()) return;
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (e) => e.data.size && chunks.push(e.data));
      recorder.addEventListener("stop", () => {
        if (clipUrl) URL.revokeObjectURL(clipUrl);
        clipUrl = chunks.length ? URL.createObjectURL(new Blob(chunks, { type: recorder?.mimeType || "audio/webm" })) : "";
      });
      recorder.start();
      $("[data-iv-rec]").hidden = false;
    } catch {
      $<HTMLInputElement>("[data-iv-record]").checked = false;
      $("[data-iv-rec]").hidden = true;
      setupMsg.hidden = false;
      setupMsg.dataset.kind = "error";
      setupMsg.textContent = "The microphone isn't available, so answers aren't being recorded.";
    }
  }

  function show(i: number) {
    at = i;
    const q = questions[i];
    $("[data-iv-n]").textContent = `Question ${i + 1} of ${questions.length}`;
    $("[data-iv-where]").textContent = `${q.l} · ${q.d}`;
    $("[data-iv-bar]").style.width = `${(i / questions.length) * 100}%`;
    $("[data-iv-q]").innerHTML = q.q;
    $<HTMLTextAreaElement>("[data-iv-notes]").value = "";
    $("[data-iv-answer]").hidden = true;
    $("[data-iv-ask]").hidden = false;
    $<HTMLAudioElement>("[data-iv-playback]").hidden = true;
    $("[data-iv-q]").focus();
    // the clock
    stopTimer();
    const t = $("[data-iv-timer]");
    t.hidden = !perAnswer;
    t.dataset.state = "";
    if (perAnswer) {
      const end = Date.now() + perAnswer * 1000;
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        t.textContent = left ? clock(left) : "Time's up";
        t.dataset.state = left <= 15 ? (left ? "low" : "over") : "";
        if (!left) stopTimer();
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    void startRecording();
  }

  async function reveal() {
    stopTimer();
    await stopRecording();
    $("[data-iv-rec]").hidden = true;
    const q = questions[at];
    $("[data-iv-a]").innerHTML = q.a;
    const from = $<HTMLElement>("[data-iv-from]");
    from.innerHTML = "";
    const link = document.createElement("a");
    link.href = q.href;
    link.textContent = `from ${q.l}`;
    from.append("(", link, ")");
    const audio = $<HTMLAudioElement>("[data-iv-playback]");
    audio.hidden = !clipUrl;
    if (clipUrl) audio.src = clipUrl;
    $("[data-iv-ask]").hidden = true;
    $("[data-iv-answer]").hidden = false;
    root.querySelector<HTMLButtonElement>("[data-iv-rate='2']")?.focus({ preventScroll: true });
    $("[data-iv-answer]").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function rate(r: 0 | 1 | 2) {
    ratings[questions[at].id] = r;
    if (at + 1 < questions.length) show(at + 1);
    else void finish();
  }

  async function finish() {
    stopTimer();
    await stopRecording();
    releaseMic();
    const asked = questions.filter((q) => q.id in ratings);
    live.hidden = true;
    if (!asked.length) {
      setup.hidden = false;
      return;
    }
    const session: InterviewSession = { at: startedAt, secs: Math.round((Date.now() - startedAt) / 1000), topic: topicName, ratings };
    saveInterview(session);
    // missed questions come back in the flashcards straight away
    const states = srsStates();
    for (const q of asked) if (ratings[q.id] === 0) saveCardState(q.id, schedule(states[q.id], "again"));

    const sc = scoreOf(asked.map((q) => ratings[q.id]));
    $("[data-iv-score]").textContent = `${sc.percent}%`;
    $("[data-iv-breakdown]").textContent = `${sc.nailed} nailed, ${sc.partly} partly, ${sc.missed} missed · ${clock(session.secs)}`;
    $("[data-iv-verdict]").textContent = verdict(sc.percent);
    const list = $("[data-iv-results]");
    list.replaceChildren(...asked.map((q) => {
      const li = document.createElement("li");
      const r = ratings[q.id];
      li.dataset.rating = String(r);
      const tag = document.createElement("span");
      tag.className = "iv-tag";
      tag.textContent = r === 2 ? "Nailed" : r === 1 ? "Partly" : "Missed";
      const a = document.createElement("a");
      a.href = q.href;
      a.innerHTML = q.q;
      li.append(tag, a);
      return li;
    }));
    $("[data-iv-retry]").hidden = !sc.missed;
    summary.hidden = false;
    summary.focus();
    renderHistory();
  }

  async function start(only?: RenderedCard[]) {
    setupMsg.hidden = true;
    let all: RenderedCard[];
    try {
      all = await loadCards(root.dataset.src!);
    } catch {
      setupMsg.hidden = false;
      setupMsg.dataset.kind = "error";
      setupMsg.textContent = "Couldn't load the questions. Check the connection and try again.";
      return;
    }
    const sel = $<HTMLSelectElement>("[data-iv-topic]");
    const topic = sel.value;
    let pool = only ?? (topic === "done" ? all.filter((c) => completedIds().includes(c.lid)) : topic ? all.filter((c) => c.s === topic) : all);
    if (!pool.length) {
      setupMsg.hidden = false;
      setupMsg.dataset.kind = "error";
      setupMsg.textContent = topic === "done" ? "You haven't completed any lessons with interview questions yet. Pick a topic instead." : "No questions for that choice.";
      return;
    }
    topicName = only ? "Missed questions" : sel.selectedOptions[0]?.textContent?.replace(/\s*\(\d+( questions)?\)$/, "") ?? "Whole course";
    pool = only ?? pool;
    questions = only ?? pickQuestions(pool, count, lastRatings(interviews()), $<HTMLInputElement>("[data-iv-focus]").checked);
    ratings = {};
    startedAt = Date.now();
    setup.hidden = true;
    summary.hidden = true;
    live.hidden = false;
    show(0);
  }

  function renderHistory() {
    const list = interviews();
    $("[data-iv-history-empty]").hidden = list.length > 0;
    $("[data-iv-history-wrap]").hidden = !list.length;
    $("[data-iv-history]").replaceChildren(...list.slice(0, 20).map((s) => {
      const tr = document.createElement("tr");
      for (const text of [timeAgo(s.at), s.topic || "Whole course", String(Object.keys(s.ratings).length), `${interviewScore(s)}%`, clock(s.secs)]) {
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
    if (key === "*" || key === "mls.interviews") renderHistory();
  }, { signal });

  $("[data-iv-start]").addEventListener("click", () => void start(), { signal });
  $("[data-iv-reveal]").addEventListener("click", () => void reveal(), { signal });
  $("[data-iv-end]").addEventListener("click", () => void finish(), { signal });
  for (const b of root.querySelectorAll<HTMLButtonElement>("[data-iv-rate]")) b.addEventListener("click", () => rate(Number(b.dataset.ivRate) as 0 | 1 | 2), { signal });
  $("[data-iv-again]").addEventListener("click", () => {
    summary.hidden = true;
    setup.hidden = false;
    setup.scrollIntoView({ block: "start" });
  }, { signal });
  $("[data-iv-retry]").addEventListener("click", () => {
    const missed = questions.filter((q) => ratings[q.id] === 0);
    if (missed.length) void start(missed);
  }, { signal });
}
