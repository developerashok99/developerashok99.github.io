/**
 * The MuleBeats page (src/pages/mulebeats.astro): pick a playlist, play a song or the whole playlist (in order or
 * shuffled), and see what's up next. Playback is the site's one audio player (src/client/player.ts), as a queue.
 */
import { currentId, getEpisode, isPlaying, playQueue, queueInfo, toggle } from "./player";
import { pageSignal } from "./page";

export function setupMuleBeats() {
  const root = document.querySelector<HTMLElement>("[data-mulebeats]");
  if (!root || root.querySelector("[data-mb-empty]")) return;
  const signal = pageSignal();
  const lists = [...root.querySelectorAll<HTMLElement>("[data-mb-playlist]")];
  const idsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>("[data-mb-track]")].map((li) => li.dataset.mbTrack!);
  /** songs whose audio failed this visit */
  const failed = new Set<string>();

  const pick = (id: string) => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-mb-pick]")) b.setAttribute("aria-pressed", String(b.dataset.mbPick === id));
    for (const l of lists) l.hidden = l.dataset.mbPlaylist !== id;
  };

  const render = () => {
    const q = queueInfo();
    const now = currentId();
    const playing = isPlaying();
    for (const li of root.querySelectorAll<HTMLElement>("[data-mb-track]")) {
      const id = li.dataset.mbTrack!;
      const on = id === now;
      li.dataset.current = String(on);
      const btn = li.querySelector<HTMLButtonElement>("[data-mb-play]")!;
      btn.dataset.playing = String(on && playing);
      const title = getEpisode(id)?.title ?? id;
      btn.setAttribute("aria-label", `${on && playing ? "Pause" : "Play"} ${title}`);
      li.querySelector<HTMLElement>("[data-mb-error]")!.hidden = !failed.has(id);
    }
    // up next: the rest of the queue after the current song
    const box = root.querySelector<HTMLElement>("[data-mb-queue]")!;
    box.hidden = !q.order.length;
    if (!q.order.length) return;
    const at = q.order.indexOf(q.current ?? "");
    const next = [...q.order.slice(at + 1), ...(q.repeat === "all" ? q.order.slice(0, at) : [])];
    root.querySelector<HTMLElement>("[data-mb-queue-about]")!.textContent =
      `${q.name}${q.shuffle ? " · shuffled" : ""}${q.repeat === "one" ? " · repeating this song" : q.repeat === "all" ? " · repeating the playlist" : ""}`;
    const ol = root.querySelector<HTMLElement>("[data-mb-queue-list]")!;
    ol.replaceChildren(...(next.length ? next : []).map((id) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mb-queue__item";
      b.textContent = getEpisode(id)?.title ?? id;
      b.addEventListener("click", () => playQueue(q.order, id, q.name));
      li.append(b);
      return li;
    }));
    if (!next.length) ol.append(Object.assign(document.createElement("li"), { className: "small muted", textContent: q.repeat === "one" ? "This song repeats." : "Nothing after this song." }));
  };

  root.addEventListener("click", (e) => {
    const el = e.target as Element;
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
  const audio = document.querySelector<HTMLAudioElement>("[data-audio]");
  for (const ev of ["play", "pause", "playing", "ended"]) audio?.addEventListener(ev, render, { signal });

  // opened from a song link (mulebeats/#beat-…): show the playlist that has it
  const hash = decodeURIComponent(location.hash.slice(1));
  const withSong = hash && lists.find((l) => idsOf(l).includes(hash));
  if (withSong) pick(withSong.dataset.mbPlaylist!);
  render();
}
