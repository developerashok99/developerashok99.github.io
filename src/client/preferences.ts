/** Preferences page: theme, notes text size and width, video autoplay. Everything is saved with setPrefs. */
import { pageSignal } from "./page";
import { dailyGoal, prefs, setPrefs } from "./store";
import { rerenderMermaid } from "./mermaid";

export function setupPreferences() {
  const page = document.querySelector<HTMLElement>("[data-preferences]");
  if (!page) return;
  const root = document.documentElement;
  const signal = pageSignal();
  const press = (sel: string, match: (b: HTMLElement) => boolean) =>
    page.querySelectorAll<HTMLElement>(sel).forEach((b) => b.setAttribute("aria-pressed", String(match(b))));

  const render = () => {
    const p = prefs();
    press("[data-pref-theme]", (b) => (b.dataset.prefTheme || undefined) === p.theme);
    press("[data-pref-scale]", (b) => Number(b.dataset.prefScale) === (p.scale ?? 1));
    press("[data-pref-width]", (b) => b.dataset.prefWidth === (p.width === "wide" ? "wide" : "normal"));
    page.querySelector("[data-pref-autoplay]")?.setAttribute("aria-checked", String(p.videoAutoplay !== false));
    page.querySelector("[data-pref-podautoplay]")?.setAttribute("aria-checked", String(p.podcastAutoplay !== false));
    page.querySelector("[data-pref-ytcontrols]")?.setAttribute("aria-checked", String(p.playerControls === "youtube"));
    press("[data-pref-new]", (b) => Number(b.dataset.prefNew) === (p.newPerDay ?? 15));
    press("[data-pref-goal]", (b) => Number(b.dataset.prefGoal) === dailyGoal());
    page.querySelector("[data-pref-remind]")?.setAttribute("aria-checked", String(!!p.reminder));
    const time = page.querySelector<HTMLInputElement>("[data-pref-remind-time]");
    if (time && document.activeElement !== time) time.value = p.reminderTime ?? "19:00";
  };

  page.querySelectorAll<HTMLElement>("[data-pref-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      const theme = (b.dataset.prefTheme || undefined) as "light" | "dark" | undefined;
      setPrefs({ theme });
      root.dataset.theme = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      rerenderMermaid();
      render();
    }, { signal }));
  page.querySelectorAll<HTMLElement>("[data-pref-scale]").forEach((b) =>
    b.addEventListener("click", () => {
      const scale = Number(b.dataset.prefScale);
      root.style.setProperty("--read-scale", String(scale));
      setPrefs({ scale });
      render();
    }, { signal }));
  page.querySelectorAll<HTMLElement>("[data-pref-width]").forEach((b) =>
    b.addEventListener("click", () => {
      const width = b.dataset.prefWidth === "wide" ? "wide" : "normal";
      root.dataset.width = width;
      setPrefs({ width });
      render();
    }, { signal }));
  page.querySelectorAll<HTMLElement>("[data-pref-new]").forEach((b) =>
    b.addEventListener("click", () => {
      setPrefs({ newPerDay: Number(b.dataset.prefNew) });
      render();
    }, { signal }));
  page.querySelector("[data-pref-ytcontrols]")?.addEventListener("click", () => {
    setPrefs({ playerControls: prefs().playerControls === "youtube" ? "simple" : "youtube" });
    render();
  }, { signal: pageSignal() });
  page.querySelectorAll<HTMLElement>("[data-pref-goal]").forEach((b) =>
    b.addEventListener("click", () => {
      setPrefs({ dailyGoal: Number(b.dataset.prefGoal) });
      render();
    }, { signal }));
  page.querySelector("[data-pref-remind]")?.addEventListener("click", async () => {
    const on = !prefs().reminder;
    // Android asks for permission to show notifications the first time
    if (on && !(await window.mlsReminders?.enable())) {
      const help = page.querySelector<HTMLElement>("[data-pref-remind-help]");
      if (help) help.textContent = "Notifications are turned off for this app. Allow them in Android Settings → Apps → Mule Learning Hub → Notifications, then try again.";
      return;
    }
    setPrefs({ reminder: on });
    render();
  }, { signal });
  page.querySelector<HTMLInputElement>("[data-pref-remind-time]")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (/^\d{2}:\d{2}$/.test(v)) setPrefs({ reminderTime: v });
  }, { signal });
  page.querySelector("[data-pref-podautoplay]")?.addEventListener("click", () => {
    setPrefs({ podcastAutoplay: prefs().podcastAutoplay === false });
    render();
  }, { signal });
  page.querySelector("[data-pref-autoplay]")?.addEventListener("click", () => {
    setPrefs({ videoAutoplay: prefs().videoAutoplay === false });
    render();
  }, { signal });

  // facts about this device
  const motion = page.querySelector("[data-pref-motion]");
  if (motion) motion.textContent = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "Your device asks for reduced motion, so animations are switched off."
    : "Follows your device's setting (currently full motion).";
  const offline = page.querySelector("[data-pref-offline]");
  if (offline && "serviceWorker" in navigator && navigator.serviceWorker.controller) offline.textContent = "Active: pages you have opened keep working without a connection.";

  // the theme button in the top bar changes the same setting
  window.addEventListener("mls:store", render, { signal });
  render();
}
