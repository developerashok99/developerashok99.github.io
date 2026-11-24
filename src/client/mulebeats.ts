/**
 * The MuleBeats page (src/pages/mulebeats.astro): pick a playlist, play a song or the whole playlist (in order or
 * shuffled), and see what's playing in the "Now playing" panel with previous / play / next. Playback is the site's
 * one audio player (src/client/player.ts), as a queue. Lyric videos open in a dialog that steps through the
 * playlist's videos and plays the next one when a video ends.
 */
import { controls, currentId, cycleRepeat, getEpisode, isPlaying, playQueue, queueInfo, setShuffle, toggle } from "./player";
import { pageSignal } from "./page";
import { prefs, setPrefs } from "./store";
import { formatClock } from "../lib/duration";

export function setupMuleBeats() {
  const root = document.querySelector<HTMLElement>("[data-mulebeats]");
  if (!root || root.querySelector("[data-mb-empty]")) return;
  const signal = pageSignal();
  const lists = [...root.querySelectorAll<HTMLElement>("[data-mb-playlist]")];
  /** the songs of a playlist in the language chosen (all of them when "All") */
  const idsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("[data-mb-track]")].filter((li) => !li.hidden).map((li) => li.dataset.mbTrack!);
  const shownList = () => lists.find((l) => !l.hidden) ?? lists[0];
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  // the language switch: remembered on this device
  const setLang = (lang: string) => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-mb-lang]")) b.setAttribute("aria-pressed", String(b.dataset.mbLang === lang));
    for (const li of root.querySelectorAll<HTMLElement>("[data-mb-track]")) li.hidden = !!lang && li.dataset.lang !== lang;
    for (const l of lists) {
      const n = l.querySelectorAll("[data-mb-track]:not([hidden])").length;
      l.querySelector<HTMLElement>("[data-mb-none]")!.hidden = n > 0;
      l.querySelectorAll<HTMLButtonElement>("[data-mb-play-all], [data-mb-shuffle-all]").forEach((b) => (b.disabled = n === 0));
    }
    for (const c of root.querySelectorAll<HTMLElement>("[data-mb-count]")) {
      const n = Number(c.dataset[lang === "en" ? "nEn" : lang === "te" ? "nTe" : "nAll"]) || 0;
      c.textContent = `${n} song${n === 1 ? "" : "s"}`;
    }
  };
  /** songs whose audio failed this visit */
  const failed = new Set<string>();

  const pick = (id: string) => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-mb-pick]")) b.setAttribute("aria-pressed", String(b.dataset.mbPick === id));
    for (const l of lists) l.hidden = l.dataset.mbPlaylist !== id;
  };

  // ---- the Now playing panel ----
  const now = q<HTMLElement>("[data-mb-now]")!;
  const nowVideoBtn = q<HTMLButtonElement>("[data-mb-now-video]")!;
  /** the video button of a song on this page, if it has a video */
  const videoBtnOf = (id: string) => root.querySelector<HTMLElement>(`[data-mb-video-id="${CSS.escape(id)}"]`);
  const renderTime = () => {
    const a = controls.audio;
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : controls.current()?.duration ?? 0;
    const t = a.currentTime || 0;
    q<HTMLElement>("[data-mb-now-fill]")!.style.width = d ? `${Math.min(100, (t / d) * 100)}%` : "0%";
    q<HTMLElement>("[data-mb-now-elapsed]")!.textContent = formatClock(t);
    q<HTMLElement>("[data-mb-now-total]")!.textContent = d ? formatClock(d) : "--:--";
  };

  const render = () => {
    const info = queueInfo();
    const cur = currentId();
    const playing = isPlaying();
    for (const li of root.querySelectorAll<HTMLElement>("[data-mb-track]")) {
      const id = li.dataset.mbTrack!;
      const on = id === cur;
      li.dataset.current = String(on);
      li.dataset.playing = String(on && playing);
      const btn = li.querySelector<HTMLButtonElement>("[data-mb-play]")!;
      btn.dataset.playing = String(on && playing);
      btn.setAttribute("aria-label", `${on && playing ? "Pause" : "Play"} ${getEpisode(id)?.title ?? id}`);
      li.querySelector<HTMLElement>("[data-mb-error]")!.hidden = !failed.has(id);
    }
    // Now playing: only for a song (a podcast playing elsewhere isn't shown here)
    const ep = cur ? getEpisode(cur) : null;
    now.hidden = !ep || ep.kind !== "song";
    if (now.hidden || !ep) return;
    q<HTMLElement>("[data-mb-now-title]")!.textContent = ep.title;
    const lesson = q<HTMLAnchorElement>("[data-mb-now-lesson]")!;
    lesson.textContent = ep.lessons[0] ? `Open the ${ep.lessons[0].label} lesson` : "";
    lesson.href = ep.lessons[0]?.href ?? "#";
    q<HTMLElement>("[data-mb-queue-about]")!.textContent = info.order.length
      ? `· ${info.name}${info.shuffle ? " · shuffled" : ""}${info.repeat === "one" ? " · repeating this song" : info.repeat === "all" ? " · repeating the playlist" : ""}`
      : "";
    const playBtn = q<HTMLButtonElement>('[data-mb-now-act="toggle"]')!;
    playBtn.dataset.playing = String(playing);
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    const sh = q<HTMLButtonElement>('[data-mb-now-act="shuffle"]')!;
    sh.setAttribute("aria-pressed", String(info.shuffle));
    sh.setAttribute("aria-label", info.shuffle ? "Shuffle: on" : "Shuffle: off");
    const rp = q<HTMLButtonElement>('[data-mb-now-act="repeat"]')!;
    rp.dataset.repeat = info.repeat;
    rp.setAttribute("aria-label", `Repeat: ${info.repeat === "one" ? "this song" : info.repeat === "all" ? "the playlist" : "off"}`);
    // previous / next: at either end of a playlist without repeat there's nowhere to go
    const at = info.order.indexOf(cur ?? "");
    const wraps = info.repeat === "all";
    q<HTMLButtonElement>('[data-mb-now-act="prev"]')!.disabled = !info.order.length || (at <= 0 && !wraps);
    q<HTMLButtonElement>('[data-mb-now-act="next"]')!.disabled = !info.order.length || (at >= info.order.length - 1 && !wraps);
    nowVideoBtn.hidden = !videoBtnOf(ep.id);
    renderTime();

    // up next: the rest of the queue after the current song
    const next = [...info.order.slice(at + 1), ...(wraps ? info.order.slice(0, at) : [])];
    q<HTMLElement>("[data-mb-queue-count]")!.textContent = next.length ? `(${next.length})` : "";
    const ol = q<HTMLElement>("[data-mb-queue-list]")!;
    ol.replaceChildren(...next.map((id) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mb-queue__item";
      b.textContent = getEpisode(id)?.title ?? id;
      b.addEventListener("click", () => playQueue(info.order, id, info.name));
      li.append(b);
      return li;
    }));
    if (!next.length) ol.append(Object.assign(document.createElement("li"), { className: "small muted", textContent: info.repeat === "one" ? "This song repeats." : info.order.length ? "Nothing after this song." : "Play a playlist to see what's next." }));
  };

  // ---- the lyric video: one player in a dialog, stepping through the shown playlist's videos ----
  const dialog = q<HTMLDialogElement>("[data-mb-video-dialog]");
  const video = q<HTMLVideoElement>("[data-mb-video-player]");
  let videoId: string | null = null;
  /** the videos to step through: the shown playlist's songs that have one, in list order */
  const videoOrder = () => [...shownList().querySelectorAll<HTMLElement>("[data-mb-track]:not([hidden]) [data-mb-video-id]")];
  const openVideo = (btn: HTMLElement) => {
    if (!dialog || !video) return;
    controls.pause();
    videoId = btn.dataset.mbVideoId ?? null;
    q<HTMLElement>("[data-mb-video-title]")!.textContent = btn.dataset.title ?? "Lyric video";
    video.src = btn.dataset.mbVideo!;
    if (!dialog.open) dialog.showModal();
    void video.play().catch(() => {});
    renderVideoNav();
  };
  const renderVideoNav = () => {
    const order = videoOrder();
    const i = order.findIndex((b) => b.dataset.mbVideoId === videoId);
    const prev = i > 0 ? order[i - 1] : null;
    const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
    q<HTMLButtonElement>("[data-mb-video-prev]")!.disabled = !prev;
    q<HTMLButtonElement>("[data-mb-video-next]")!.disabled = !next;
    q<HTMLElement>("[data-mb-video-upnext]")!.textContent = next ? `Up next: ${next.dataset.title}` : "This is the last video in the playlist.";
  };
  const stepVideo = (dir: 1 | -1) => {
    const order = videoOrder();
    const target = order[order.findIndex((b) => b.dataset.mbVideoId === videoId) + dir];
    if (target) openVideo(target);
  };
  const closeVideo = () => {
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    videoId = null;
  };
  dialog?.addEventListener("close", closeVideo, { signal });
  dialog?.querySelector("[data-mb-video-close]")?.addEventListener("click", () => dialog.close(), { signal });
  dialog?.querySelector("[data-mb-video-prev]")?.addEventListener("click", () => stepVideo(-1), { signal });
  dialog?.querySelector("[data-mb-video-next]")?.addEventListener("click", () => stepVideo(1), { signal });
  // watching straight through: the next video starts when one ends
  video?.addEventListener("ended", () => stepVideo(1), { signal });

  root.addEventListener("click", (e) => {
    const el = e.target as Element;
    const vid = el.closest<HTMLElement>("[data-mb-video]");
    if (vid) return openVideo(vid);
    if (el.closest("[data-mb-now-video]")) {
      const b = videoBtnOf(currentId() ?? "");
      if (b) openVideo(b);
      return;
    }
    const act = el.closest<HTMLElement>("[data-mb-now-act]")?.dataset.mbNowAct;
    if (act) {
      if (act === "toggle") toggle();
      else if (act === "prev") controls.step(-1);
      else if (act === "next") controls.step(1);
      else if (act === "shuffle") setShuffle(!queueInfo().shuffle);
      else if (act === "repeat") cycleRepeat();
      return;
    }
    const langBtn = el.closest<HTMLElement>("[data-mb-lang]");
    if (langBtn) {
      setLang(langBtn.dataset.mbLang ?? "");
      setPrefs({ beatsLang: langBtn.dataset.mbLang ?? "" });
      return;
    }
    const pickBtn = el.closest<HTMLElement>("[data-mb-pick]");
    if (pickBtn) return pick(pickBtn.dataset.mbPick!);
    const list = el.closest<HTMLElement>("[data-mb-playlist]");
    if (!list) return;
    const name = list.dataset.title ?? "Playlist";
    const play = el.closest<HTMLElement>("[data-mb-play]");
    if (play) {
      const id = play.dataset.mbPlay!;
      // the song that's playing: pause / resume; another: play the playlist from there
      if (id === currentId() && queueInfo().order.length) toggle();
      else playQueue(idsOf(list), id, name);
      return;
    }
    if (el.closest("[data-mb-play-all]")) playQueue(idsOf(list), null, name, { shuffle: false });
    else if (el.closest("[data-mb-shuffle-all]")) playQueue(idsOf(list), null, name, { shuffle: true });
  }, { signal });

  document.addEventListener("mls:queue", render, { signal });
  document.addEventListener("mls:player-error", (e) => {
    failed.add((e as CustomEvent<{ id: string }>).detail.id);
    render();
  }, { signal });
  const audio = controls.audio;
  for (const ev of ["play", "pause", "playing", "ended", "loadedmetadata"]) audio.addEventListener(ev, render, { signal });
  audio.addEventListener("timeupdate", () => !now.hidden && renderTime(), { signal });

  const saved = prefs().beatsLang ?? "";
  if (root.querySelector(`[data-mb-lang="${saved}"]`)) setLang(saved);
  else setLang("");
  // opened from a song link (mulebeats/#beat-…): show the first playlist that has it
  const hash = decodeURIComponent(location.hash.slice(1));
  const withSong = hash && lists.find((l) => idsOf(l).includes(hash));
  if (withSong) pick(withSong.dataset.mbPlaylist!);
  render();
}
