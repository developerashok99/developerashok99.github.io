/**
 * Videos tab: Previous / Next / playlist clicks start the chosen video straight away, the next video
 * plays when one ends (unless switched off), Shift+N / Shift+P move through the list, and /videos/
 * offers to continue the last video opened.
 */
import { pageSignal } from "./page";
import { activeYouTube } from "./media";
import { isBookmarked, isCompleted, lectureProgress, prefs, saveLectureProgress, setBookmarked, setCompleted, setPrefs, type LectureProgress } from "./store";

/** Set when the user picks a video, so the next page starts playing without a second click. */
const PLAY_FLAG = "mls.videoPlay";

function flag(on?: boolean): boolean {
  try {
    if (on === undefined) {
      const v = sessionStorage.getItem(PLAY_FLAG) === "1";
      sessionStorage.removeItem(PLAY_FLAG);
      return v;
    }
    sessionStorage.setItem(PLAY_FLAG, "1");
  } catch {
    /* storage blocked: the user just presses play */
  }
  return false;
}

/** Start the next Videos page's player without a click (used when watch together follows the other side). */
export const requestVideoAutoplay = () => void flag(true);

export function setupVideos() {
  const page = document.querySelector<HTMLElement>("[data-video-page]");
  if (!page) return;
  const id = page.dataset.videoPage!;
  const signal = pageSignal();
  const isIndex = !!page.querySelector("[data-video-resume]");

  // continue where you left off (only on /videos/, and only if it isn't the video already shown)
  const last = prefs().lastVideo;
  const resume = page.querySelector<HTMLElement>("[data-video-resume]");
  const lastLink = last && last !== id ? page.querySelector<HTMLAnchorElement>(`.video-list a[href$="/videos/${last}/"]`) : null;
  if (resume && lastLink) {
    const a = resume.querySelector("a")!;
    a.href = lastLink.href;
    a.textContent = lastLink.querySelector(".video-list__text")?.textContent?.trim() || last || "";
    resume.hidden = false;
  }
  if (!isIndex) setPrefs({ lastVideo: id });

  // keep the current video visible inside the playlist (scroll the list, not the page)
  const list = page.querySelector<HTMLElement>("[data-video-list]");
  const cur = list?.querySelector<HTMLElement>('[aria-current="page"]');
  if (list && cur) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 3;

  page.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-video-go]")) flag(true);
  }, { signal });

  // study actions: the same completion / bookmark as the lesson page
  const doneBtn = page.querySelector<HTMLButtonElement>("[data-video-done]");
  const markBtn = page.querySelector<HTMLButtonElement>("[data-video-bookmark]");
  const render = () => {
    const done = isCompleted(id);
    const on = isBookmarked(id);
    doneBtn?.setAttribute("aria-pressed", String(done));
    markBtn?.setAttribute("aria-pressed", String(on));
    const t1 = doneBtn?.querySelector("[data-text]");
    const t2 = markBtn?.querySelector("[data-text]");
    if (t1) t1.textContent = done ? "Completed" : "Mark complete";
    if (t2) t2.textContent = on ? "Bookmarked" : "Bookmark";
  };
  doneBtn?.addEventListener("click", () => { setCompleted(id, !isCompleted(id)); render(); }, { signal });
  markBtn?.addEventListener("click", () => { setBookmarked(id, !isBookmarked(id)); render(); }, { signal });
  render();

  const auto = page.querySelector<HTMLInputElement>("[data-video-autoplay]");
  if (auto) {
    auto.checked = prefs().videoAutoplay !== false;
    auto.addEventListener("change", () => setPrefs({ videoAutoplay: auto.checked }), { signal });
  }
  const go = (dir: "next" | "prev") => page.querySelector<HTMLAnchorElement>(`a[data-video-go="${dir}"]`)?.click();
  document.addEventListener("mls:lecture-ended", () => auto?.checked && go("next"), { signal });
  document.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (e.key === "N") go("next");
    else if (e.key === "P") go("prev");
  }, { signal });

  setupLectureProgress(page, id, render);
  if (flag()) page.querySelector<HTMLButtonElement>("button[data-yt]")?.click();
}

/** 1:05:09 / 4:07 */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
const percent = (p: LectureProgress) => (p.dur ? Math.min(100, Math.round((p.max / p.dur) * 100)) : 0);

/**
 * Lecture progress: where you stopped (the video starts there next time), how much you've watched (bars in the playlist),
 * and watching 90% marks the lesson complete. Saved every few seconds while playing, and synced to your account.
 */
function setupLectureProgress(page: HTMLElement, id: string, renderActions: () => void) {
  const signal = pageSignal();
  const facade = page.querySelector<HTMLButtonElement>("button[data-yt]");
  const saved = lectureProgress()[id];
  // resume where you stopped, unless it's near the start or already finished
  if (facade && saved && !saved.done && saved.pos > 15) {
    facade.dataset.start = String(Math.max(Number(facade.dataset.start || 0), saved.pos));
    const small = facade.querySelector("small");
    if (small) small.textContent = `Resume at ${clock(saved.pos)} · ${percent(saved)}% watched`;
  } else if (facade && saved?.done) {
    const small = facade.querySelector("small");
    if (small) small.textContent = "Watched ✓ · click to watch again";
  }

  const renderList = () => {
    const all = lectureProgress();
    for (const a of page.querySelectorAll<HTMLAnchorElement>(".video-list a[href]")) {
      const vid = a.getAttribute("href")!.match(/videos\/([^/]+)\/$/)?.[1];
      const p = vid ? all[vid] : undefined;
      let bar = a.querySelector<HTMLElement>(".video-list__watched");
      if (!p || !p.max) {
        bar?.remove();
        continue;
      }
      if (!bar) {
        bar = document.createElement("span");
        bar.className = "video-list__watched";
        bar.setAttribute("aria-hidden", "true");
        bar.append(document.createElement("span"));
        a.querySelector(".video-list__text")?.append(bar);
      }
      bar.dataset.done = String(!!p.done);
      bar.title = p.done ? "Watched" : `${percent(p)}% watched`;
      (bar.firstElementChild as HTMLElement).style.width = `${p.done ? 100 : percent(p)}%`;
    }
  };
  renderList();

  const save = () => {
    const a = activeYouTube();
    if (!a || a.id !== facade?.dataset.yt) return;
    const pos = a.player.getCurrentTime?.() || 0;
    const dur = a.player.getDuration?.() || 0;
    if (pos < 1 || !dur) return;
    if (saveLectureProgress(id, pos, dur) && !isCompleted(id)) {
      setCompleted(id, true);
      renderActions();
    }
    renderList();
  };
  const timer = setInterval(() => {
    const a = activeYouTube();
    if (a && a.player.getPlayerState?.() === 1) save();
  }, 5000);
  signal.addEventListener("abort", () => {
    save();
    clearInterval(timer);
  });
  // paused, ended or buffering: save now (YouTube states 0 ended, 2 paused)
  document.addEventListener("mls:yt-state", (e) => {
    const st = (e as CustomEvent<{ state: number }>).detail.state;
    if (st === 0 || st === 2) save();
  }, { signal });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save(), { signal });
}
