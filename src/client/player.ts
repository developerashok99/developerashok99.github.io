/**
 * Global audio podcast player (one <audio> element for the whole site, kept across page navigations).
 * Page buttons only need `data-play-episode="<id>"`; progress bars `data-episode-progress="<id>"`.
 */
import { formatClock } from "../lib/duration";
import { KEYS, mediaProgress, prefs, read, saveMediaProgress, write } from "./store";
import { afterEnd, REPEATS, shuffled, stepIndex, type Repeat } from "../lib/mulebeats";

export interface EpisodeInfo {
  id: string;
  title: string;
  src: string;
  /** size of the audio file in bytes, when known */
  bytes: number | null;
  href: string;
  duration: number | null;
  lessons: { id: string; label: string; href: string }[];
  test: boolean;
  /** MuleBeats songs ("song") play in playlists; podcast episodes have no kind */
  kind?: "song";
  genre?: string;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const root = document.querySelector<HTMLElement>("[data-player]")!;
const audio = root.querySelector<HTMLAudioElement>("[data-audio]")!;
const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
const titleEl = $<HTMLAnchorElement>("[data-title]");
const statusEl = $<HTMLElement>("[data-status]");
const seek = $<HTMLInputElement>("[data-seek]");
const elapsedEl = $<HTMLElement>("[data-elapsed]");
const totalEl = $<HTMLElement>("[data-total]");
const toggleBtn = $<HTMLButtonElement>('[data-act="toggle"]');
const speedBtn = $<HTMLButtonElement>('[data-act="speed"]');

let episodes: EpisodeInfo[] = [];
try {
  episodes = JSON.parse(root.querySelector("[data-episodes]")?.textContent || "[]");
} catch {
  episodes = [];
}
let current: EpisodeInfo | null = null;
let seeking = false;
let lastSave = 0;

export const getEpisode = (id: string) => episodes.find((e) => e.id === id) ?? null;
/** podcast episodes, in course order: the previous / next order when no playlist is playing */
const podcastList = () => episodes.filter((e) => e.kind !== "song");

// ---- the play queue (MuleBeats playlists) ----
interface Queue {
  /** the playlist's own order, and the order it plays in (shuffled or not) */
  ids: string[];
  order: string[];
  name: string;
}
const saved = read<{ queue?: Queue; shuffle?: boolean; repeat?: Repeat }>(KEYS.player, {});
let queue: Queue | null = saved.queue && Array.isArray(saved.queue.ids) && Array.isArray(saved.queue.order) ? saved.queue : null;
let shuffleOn = saved.shuffle === true;
let repeat: Repeat = REPEATS.includes(saved.repeat as Repeat) ? (saved.repeat as Repeat) : "off";
/** a playlist is playing: the current song is in the queue */
const inQueue = () => !!queue && !!current && queue.order.includes(current.id);

function persistQueue() {
  write(KEYS.player, { ...read(KEYS.player, {}), queue, shuffle: shuffleOn, repeat });
}
/** For the MuleBeats page: what's playing and what comes next. */
export function queueInfo() {
  return { name: queue?.name ?? "", order: inQueue() ? [...queue!.order] : [], current: current?.id ?? null, shuffle: shuffleOn, repeat, playing: isPlaying() };
}
function queueChanged() {
  renderQueueControls();
  document.dispatchEvent(new CustomEvent("mls:queue"));
}

/** Plays a playlist from `startId` (or from the start; shuffled order starts at a random song when shuffle is on). */
export function playQueue(ids: string[], startId: string | null, name: string, opts: { shuffle?: boolean } = {}) {
  const list = ids.filter((id) => getEpisode(id));
  if (!list.length) return;
  if (opts.shuffle != null) shuffleOn = opts.shuffle;
  const start = startId && list.includes(startId) ? startId : shuffleOn ? list[Math.floor(Math.random() * list.length)] : list[0];
  queue = { ids: list, order: shuffleOn ? shuffled(list, start) : list, name };
  persistQueue();
  if (current?.id === start) void play();
  else load(start, true);
  queueChanged();
}
export function setShuffle(on: boolean) {
  shuffleOn = on;
  if (queue) queue = { ...queue, order: on ? shuffled(queue.ids, current?.id ?? null) : queue.ids };
  persistQueue();
  queueChanged();
}
export function cycleRepeat() {
  repeat = REPEATS[(REPEATS.indexOf(repeat) + 1) % REPEATS.length];
  persistQueue();
  queueChanged();
}

function renderQueueControls() {
  const on = inQueue();
  root.querySelectorAll<HTMLElement>("[data-queue-only]").forEach((b) => (b.hidden = !on));
  const sh = root.querySelector<HTMLButtonElement>('[data-act="shuffle"]');
  sh?.setAttribute("aria-pressed", String(shuffleOn));
  sh?.setAttribute("aria-label", shuffleOn ? "Shuffle: on" : "Shuffle: off");
  const rp = root.querySelector<HTMLButtonElement>('[data-act="repeat"]');
  if (rp) {
    rp.dataset.repeat = repeat;
    rp.setAttribute("aria-label", `Repeat: ${repeat === "one" ? "this song" : repeat === "all" ? "the playlist" : "off"}`);
  }
  const song = current?.kind === "song";
  root.querySelector('[data-act="prev"]')?.setAttribute("aria-label", song ? "Previous song" : "Previous episode");
  root.querySelector('[data-act="next"]')?.setAttribute("aria-label", song ? "Next song" : "Next episode");
  root.dataset.kind = song ? "song" : "podcast";
}
export const allEpisodes = () => episodes;

/** Where an episode's audio comes from; the app swaps in the downloaded file (src/client/downloads.ts). */
let resolveSrc: (ep: EpisodeInfo) => string | null = () => null;
export function setSourceResolver(fn: (ep: EpisodeInfo) => string | null) {
  resolveSrc = fn;
}
const srcOf = (ep: EpisodeInfo) => resolveSrc(ep) ?? ep.src;
export const currentId = () => current?.id ?? null;
export const isPlaying = () => !!current && !audio.paused && !audio.ended;

function setStatus(text: string, kind: "info" | "error" = "info") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function duration(): number {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current?.duration ?? 0;
}

function renderTime() {
  const d = duration();
  const t = audio.currentTime || 0;
  if (!seeking) seek.value = String(Math.floor(t));
  seek.max = String(Math.floor(d));
  elapsedEl.textContent = formatClock(t);
  totalEl.textContent = d ? formatClock(d) : "--:--";
  seek.setAttribute("aria-valuetext", `${formatClock(t)} of ${d ? formatClock(d) : "unknown"}`);
  seek.style.setProperty("--pct", d ? `${(t / d) * 100}%` : "0%");
  root.style.setProperty("--pct", d ? `${(t / d) * 100}%` : "0%");
}

function renderRate() {
  const r = audio.playbackRate;
  speedBtn.textContent = `${r}×`;
  speedBtn.setAttribute("aria-label", `Playback speed ${r}x. Change speed`);
}

/** Updates every play button and progress bar on the current page. */
export function syncPage() {
  const playing = isPlaying();
  document.querySelectorAll<HTMLButtonElement>("[data-play-episode]").forEach((btn) => {
    const id = btn.dataset.playEpisode!;
    const on = playing && current?.id === id;
    btn.dataset.playing = String(on);
    const name = btn.dataset.label || getEpisode(id)?.title || "episode";
    btn.setAttribute("aria-label", `${on ? "Pause" : "Play"} audio: ${name}`);
  });
  document.querySelectorAll<HTMLElement>("[data-episode-progress]").forEach((el) => {
    const id = el.dataset.episodeProgress!;
    let pct = 0;
    if (current?.id === id && duration()) pct = audio.currentTime / duration();
    else {
      const p = mediaProgress("audio", id);
      if (p?.done && !p.pos) pct = 1;
      else if (p && p.dur) pct = p.pos / p.dur;
    }
    const bar = el.querySelector<HTMLElement>("span");
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
    el.hidden = pct === 0;
    el.setAttribute("aria-label", `${Math.round(pct * 100)}% listened`);
  });
}

function renderState() {
  const playing = isPlaying();
  toggleBtn.dataset.playing = String(playing);
  toggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  syncPage();
}

function save(force = false) {
  if (!current) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  saveMediaProgress("audio", current.id, audio.currentTime, duration());
}

function showPlayer(show: boolean) {
  root.hidden = !show;
  document.body.classList.toggle("has-player", show);
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !current) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.lessons.map((l) => l.label).join(", ") || "MuleSoft course",
      album: "Mule Learning Hub — summary podcasts",
    });
  } catch {
    /* MediaMetadata unsupported */
  }
}

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration();
  if (!d || !Number.isFinite(audio.currentTime)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate });
  } catch {
    /* ignore invalid states during loading */
  }
}

/** Loads an episode into the player. Resumes from the saved position. */
export function load(id: string, autoplay: boolean): boolean {
  const ep = getEpisode(id);
  if (!ep) return false;
  if (current?.id === ep.id) {
    if (autoplay) void play();
    return true;
  }
  save(true);
  current = ep;
  if (queue && !queue.order.includes(ep.id)) {
    queue = null;
    persistQueue();
  }
  titleEl.textContent = ep.title;
  titleEl.href = ep.href;
  audio.src = srcOf(ep);
  // a song starts from the top each time; an episode resumes where you stopped
  const startAt = ep.kind === "song" ? 0 : mediaProgress("audio", ep.id)?.pos ?? 0;
  const applyStart = () => {
    if (startAt > 0 && startAt < duration() - 2) audio.currentTime = startAt;
    renderTime();
  };
  audio.addEventListener("loadedmetadata", applyStart, { once: true });
  audio.playbackRate = read<{ rate?: number }>(KEYS.player, {}).rate ?? 1;
  renderRate();
  write(KEYS.player, { ...read(KEYS.player, {}), id: ep.id, closed: false });
  showPlayer(true);
  setStatus(startAt > 0 ? `Resumes at ${formatClock(startAt)}` : "");
  renderTime();
  updateMediaSession();
  if (autoplay) void play();
  renderState();
  queueChanged();
  return true;
}

/** Re-points the loaded episode at its current source (e.g. once it is downloaded), keeping the position. */
export function refreshSource() {
  if (!current) return;
  const want = srcOf(current);
  if (audio.src === want || audio.currentSrc === want) return;
  const at = audio.currentTime || mediaProgress("audio", current.id)?.pos || 0;
  const wasPlaying = !audio.paused;
  audio.src = want;
  audio.addEventListener("loadedmetadata", () => {
    if (at > 0) audio.currentTime = at;
    renderTime();
    if (wasPlaying) void play();
  }, { once: true });
}

async function play() {
  try {
    await audio.play();
  } catch (err) {
    // NotAllowedError = autoplay blocked; the user can press Play. Other errors are reported by the error event.
    if ((err as DOMException)?.name === "NotAllowedError") setStatus("Press play to start");
  }
}

export function toggle(id?: string) {
  if (id && current?.id !== id) {
    load(id, true);
    return;
  }
  if (!current) return;
  if (audio.paused || audio.ended) void play();
  else audio.pause();
}

function step(dir: 1 | -1) {
  if (!current) return;
  if (inQueue()) {
    const order = queue!.order;
    const j = stepIndex(order.indexOf(current.id), order.length, dir, repeat);
    if (j != null) load(order[j], !audio.paused || audio.ended);
    return;
  }
  const list = podcastList();
  const i = list.findIndex((e) => e.id === current!.id);
  const target = list[i + dir];
  if (target) load(target.id, !audio.paused);
}

function skip(seconds: number) {
  if (!current) return;
  const d = duration();
  audio.currentTime = Math.max(0, Math.min(d || Infinity, audio.currentTime + seconds));
  renderTime();
}

/** Phones: the slim player (title, play / pause) opens to show every control. */
function expand(open: boolean) {
  root.classList.toggle("is-open", open);
  document.body.classList.toggle("has-player-open", open);
  const b = root.querySelector<HTMLButtonElement>('[data-act="expand"]');
  b?.setAttribute("aria-expanded", String(open));
  b?.setAttribute("aria-label", open ? "Show fewer player controls" : "Show all player controls");
}

function close() {
  save(true);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  current = null;
  write(KEYS.player, { ...read(KEYS.player, {}), closed: true });
  showPlayer(false);
  expand(false);
  renderState();
}

// ---- wiring (runs once; the player element persists across navigations) ----
root.addEventListener("click", (e) => {
  const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "toggle") toggle();
  else if (act === "back") skip(-10);
  else if (act === "fwd") skip(30);
  else if (act === "prev") step(-1);
  else if (act === "next") step(1);
  else if (act === "close") close();
  else if (act === "shuffle") setShuffle(!shuffleOn);
  else if (act === "repeat") cycleRepeat();
  else if (act === "expand") expand(!root.classList.contains("is-open"));
  else if (act === "speed") {
    const i = SPEEDS.indexOf(audio.playbackRate);
    audio.playbackRate = SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
    write(KEYS.player, { ...read(KEYS.player, {}), rate: audio.playbackRate });
    renderRate();
  }
});
seek.addEventListener("input", () => {
  seeking = true;
  elapsedEl.textContent = formatClock(+seek.value);
});
seek.addEventListener("change", () => {
  audio.currentTime = +seek.value;
  seeking = false;
  save(true);
});

// When an episode is restored paused, keep its "Resumes at …" note instead of showing "Loading…".
audio.addEventListener("loadstart", () => current && !audio.paused && setStatus("Loading…"));
audio.addEventListener("waiting", () => setStatus("Buffering…"));
audio.addEventListener("canplay", () => statusEl.textContent?.match(/Loading|Buffering/) && setStatus(""));
audio.addEventListener("playing", () => {
  setStatus("");
  renderState();
});
audio.addEventListener("pause", () => {
  save(true);
  renderState();
});
audio.addEventListener("timeupdate", () => {
  renderTime();
  save();
  updatePositionState();
  syncPage();
});
audio.addEventListener("durationchange", renderTime);
audio.addEventListener("ratechange", updatePositionState);
/** The episode to play after `from`: the next real one in course order. Offline, only a downloaded one can
 * play, so it skips ahead to the next episode that is on this device. */
function nextEpisode(from: EpisodeInfo): EpisodeInfo | null {
  if (from.test) return null; // the browser-test fixture never leads into the real course
  const offline = navigator.onLine === false;
  const i = episodes.findIndex((e) => e.id === from.id);
  return episodes.slice(i + 1).find((e) => !e.test && e.kind !== "song" && (!offline || resolveSrc(e) != null)) ?? null;
}

audio.addEventListener("ended", () => {
  save(true);
  // a playlist: the next song, the same one again (repeat one), back to the start (repeat all), or the end
  if (inQueue()) {
    const order = queue!.order;
    const j = afterEnd(order.indexOf(current!.id), order.length, repeat);
    if (j == null) {
      setStatus("End of playlist");
      renderState();
    } else if (order[j] === current!.id) {
      audio.currentTime = 0;
      void play();
    } else load(order[j], true);
    return;
  }
  const next = current && prefs().podcastAutoplay !== false ? nextEpisode(current) : null;
  if (next) {
    load(next.id, true);
    setStatus(`Playing the next episode`);
    return;
  }
  setStatus("Finished");
  renderState();
});
audio.addEventListener("error", () => {
  if (!current) return;
  const code = audio.error?.code;
  const local = srcOf(current) !== current.src;
  const why = !local && navigator.onLine === false
    ? "you're offline and this episode isn't downloaded"
    : code === 4 ? "the file was not found or its format isn't supported" : code === 2 ? "a network error occurred" : "it could not be decoded";
  setStatus(`Can't play: ${why}`, "error");
  renderState();
  document.dispatchEvent(new CustomEvent("mls:player-error", { detail: { id: current.id } }));
});

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => void play()],
    ["pause", () => audio.pause()],
    ["seekbackward", (d) => skip(-(d.seekOffset || 10))],
    ["seekforward", (d) => skip(d.seekOffset || 30)],
    ["previoustrack", () => step(-1)],
    ["nexttrack", () => step(1)],
    ["seekto", (d) => d.seekTime != null && (audio.currentTime = d.seekTime)],
  ];
  for (const [action, fn] of handlers) {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported on this browser */
    }
  }
}

/** For the app's lock-screen / notification controls (src/client/native.ts). */
export const controls = {
  play: () => void play(),
  pause: () => audio.pause(),
  skip,
  step,
  seekTo: (t: number) => (audio.currentTime = t),
  audio,
  current: () => current,
};

// Page play buttons (delegated: works for pages loaded later by client-side navigation).
document.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>("[data-play-episode]");
  if (!btn || btn.disabled) return;
  toggle(btn.dataset.playEpisode);
});
window.addEventListener("pagehide", () => save(true));
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save(true));
document.addEventListener("mls:page-ready", () => {
  document.body.classList.toggle("has-player", !root.hidden);
  syncPage();
});

// Restore the last episode (paused) after a full page load, unless the player was closed.
const last = read<{ id?: string; closed?: boolean }>(KEYS.player, {});
if (last.id && !last.closed) load(last.id, false);
renderRate();
