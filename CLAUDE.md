# CLAUDE.md: Mule Learning Hub (repo developerashok99.github.io, formerly mule-learning-web)

A personal MuleSoft (Mule 4) study platform: a website plus an Android app built from the same code.

- **Repo:** https://github.com/developerashok99/developerashok99.github.io (branch `main`; pushing deploys)
- **Live site:** https://developerashok99.github.io/ (site root; base "/" in `astro.config.mjs`)
- **Moved in Nov 2026** from repo `mule-learning-web` (site under `/mule-learning-web/`). Old addresses land on the 404 page, and an inline script in `Base.astro` redirects them to the same page at the root. `public/mule-learning-web/sw.js` retires the old offline worker. Old profiles may still have `lastHref` starting `/mule-learning-web/`; `account.ts` strips it. The local folder is still named `mule-learning-web`.
- **Notes source:** https://github.com/developerashok99/green-c-mule-notes, pulled in read-only at build time by `npm run sync` into `.notes/` (gitignored). Never copy the notes into this repo.
- Other docs here: `README.md` (adding media), `MOBILE.md` (Android app), `DESIGN.md` (tokens, colours, accessibility).

## Commands

```bash
npm run dev            # sync notes + astro dev
npm run check          # astro check (0 errors expected; one known deprecation warning in native.ts)
npm test               # vitest unit tests (184)
npm run build:test     # site build WITH the test-fixture podcast episode; e2e tests need this build
npm run test:e2e       # Playwright, 5 projects: phone-360, phone-390, tablet-768, tablet-1024, desktop-1440 (~730 tests)
npm run verify         # everything: check, unit, sync, build:test, links, e2e, build:site
npm run build          # production build (no fixture). Running e2e after this fails the fixture tests; that's expected
npm run app:apk        # build:app (dist-app/, base "/") + cap sync + gradlew assembleDebug
```

The e2e tests run against `astro preview` of `dist/`, so **rebuild before running e2e** after any source change, or the tests run against old code.

## Stack and layout

- Astro 7 static site with ClientRouter (client-side navigation). The page setup functions run on `astro:page-load` in `src/client/app.ts`, and each one uses `pageSignal()` (from `src/client/page.ts`) to remove its listeners when the page changes.
- Search is Pagefind. The service worker is `src/pages/sw.js.ts`.
- `config/media.json` holds every media link:
  - `lectures.<id>.youtube`
  - `podcasts[]`: `videoUrl`, `audioUrl`, `animatedVideoUrl`
  - the playlists
- Tests must read IDs from `config/media.json` and never hard-code them.
- `src/client/store.ts` holds the preferences in `localStorage` key `mls.prefs`. Fields: theme, width, nav, videoPlaylist, videoNotes, captions, captionsLast, playerControls.
- An inline script in `src/layouts/Base.astro` applies these to `<html>` before first paint: `data-theme`, `data-width`, `data-nav`, `data-playlist`. `data-app="android"` is set in the app build (`APP_BUILD`).
- CSS is all in `src/styles/global.css`. The breakpoint is **800px**: at or below it is the phone layout (bottom tabs, `.hide-phone` / `.show-phone`); above it the left sidebar shows.

### Video player (our own controls over the YouTube IFrame API)

- `src/client/media.ts`:
  - `createPlayer` and `switchPlayerControls(mode)`, which chooses between our controls ("simple") and YouTube's own ("youtube").
  - The `players` list. `activeYouTube()` returns the player on screen.
  - It fires events `mls:yt-ready`, `mls:yt-state`, `mls:yt-api` and `mls:controls-mode`. The API load timeout is 30 s.
- `src/client/ytcontrols.ts`, function `attachControls`:
  - A clear shield covers the iframe, so YouTube never sees the mouse.
  - Big play button, on-screen messages (OSD), a control bar (play, ±10 s, mute/volume hidden on phones, time, CC, gear, fullscreen), and a settings menu with speed, captions and quality.
  - The controls auto-hide after 1 s.
  - Quick ±10 s presses add up (`lastSeek`).
  - Fullscreen turns the screen to landscape through `window.mlsOrientation` (in the app) or `screen.orientation.lock`.
- `src/lib/player.ts` has the pure helpers: `SPEEDS`, `keyAction` (YouTube's keys plus `c` for captions), `captionChoices`, `captionTrack`, and others.
- **Captions** are Telugu (`data-cc="te"`) with English auto-translation, set through `loadModule`, `unloadModule` and `setOption("captions","track",…)`. They're off by default, even if YouTube switches them on. When captions are on, the frame gets class `yt-cc-on`, which removes the crop.
- **Quality (720p/1080p):** the IFrame API ignores quality requests. Choosing "720p, 1080p…" switches to YouTube's own controls (controls=1) at the same second, because only their gear menu can change quality. This is remembered in prefs and can be turned back off with a switch on the page and on the Preferences page.

### Videos page and podcast pages

- `src/components/VideoWatch.astro` (Videos tab, `/videos/<id>/`) and `src/pages/podcasts/[id].astro` share the same layout:
  - a wide player
  - actions under it (Watch together, Hide playlist)
  - the notes below (`LessonNotes.astro`)
  - a playlist beside it that can be hidden
- `src/client/videopage.ts`:
  - notes load on demand from the notes pages, with the duplicate h1 removed and Mermaid rendered
  - the notes level is remembered
  - a small corner player appears while you read the notes on wide screens
  - the playlist can be hidden
  - the controls-mode switch
- Podcast episodes switch between Animated, Slides and Audio formats (event `mls:pod-view`). Episodes with no animated video yet: Day 1, and Days 3–5 until the user uploads them.

### Watch together (YouTube in sync with a friend)

- `src/lib/together.ts` holds the pure logic (room codes, message validation, `shareUrl`, `matchAction`). `src/client/together.ts` does the syncing. `TogetherInvite.astro` and `TogetherPanel.astro` are the UI.
- It uses PeerJS WebRTC through the public broker, with peer ID `mls-watch-<code>`. The host is the hub.
- Message types: play, pause, seek, state, nav, view, ask, bye, people.
- Rooms are keyed by page: `video:<id>` or `podcast:<id>` (from `[data-watch-page]`).
- Opening a `?room=` link joins automatically, and the friend just presses play.
- Joining and following use a hold/goal/steer mechanism, so a joiner's late autoplay doesn't pull the host back. A seek is repeated until YouTube applies it, because YouTube ignores seeks sent right at "ready". The expected echo of your own action is swallowed.
- Inside the app, `siteRoot()` builds share links against the public website.
- `window.__mlsTogetherLog` is a debug log. The tests use a BroadcastChannel transport instead of PeerJS.

### Account and sync (Firebase)

- Project `mule-learning-web` (config in `src/lib/firebase-config.ts`; public by design). Email/password only; sign-up is off, so the owner adds the 4 users in the Firebase console.
- Firestore (lite SDK): `progress/{uid}` (each synced key as a JSON string plus per-key change times; owner-only) and `profiles/{uid}` (counts for the Friends page; readable by any signed-in user). The rules are in the Firebase console.
- `src/lib/sync.ts` is the pure logic (`reconcile`: newest change per key wins; a device's first sync merges instead; a cleared key syncs as null). `src/client/account.ts` does the syncing, the sidebar profile corner and the Account page (`/account/`). `src/client/firebase.ts` loads only when someone is signed in or on the Account page.
- `store.write()` records change times in `mls.syncAt`, but only while signed in (`mls.account`).
- **Members only.** An inline script in `Base.astro` sends anyone without a sign-in from the last 30 days (`mls.account` + `mls.authAt`) to `/account/?next=…`; `setupAccount()` repeats the check after client-side navigation. The sign-in page shows alone (`html[data-locked]`). This is a front door only: the site and both repos are public.
- The e2e tests import `test` from `tests/e2e/test.ts`, which signs every test in to the fake account server `tests/e2e/fake-account.ts` (window `__mlsAccountBackend`), never the real project. Tests about signing in use `test.use({ signedIn: false })`.
- **Protected content:** after every build, `scripts/protect.mjs` encrypts each page's `<main>` (plus its title and description), `interview.json`, `glossary.json`, `mcq.json` and the Pagefind index/fragment files (AES-256-GCM, deflated first). Only `account/` and `404.html` stay readable. The key is 32 bytes base64: env `SITE_KEY` (GitHub secret, used by both workflows), else the gitignored `.site-key`; `build:test` uses a fixed test key. Signed-in users get it from Firestore `config/site` (field `key`) and keep it in `mls.siteKey` (removed on sign-out/expiry). `src/client/seal.ts` decrypts before the page code runs (`app.ts` awaits it, then fires `mls:page-ready`), before client-side swaps (`astro:before-preparation`), in `fetchSealedJson`, and for Pagefind through a `fetch` wrapper. `scripts/check-links.mjs` decrypts pages to check them. Slide images in `notes-assets/` are not encrypted.
- **MCQ tests:** `/mcq/` (`src/pages/mcq.astro`, `src/client/mcq.ts`, pure logic `src/lib/mcq.ts`) uses the 726 lesson MCQs from `mcq.json` plus the shared bank in Firestore `mcqs` (anyone signed in reads; only the author edits or deletes). Exam mode is 2 min per question with 70% to pass; practice mode shows the answer at once. History goes in `mls.mcqTests` (synced). Course answers are also saved in `mls.quiz`, so they show on the Mistakes page.
- **Friends online and invites:** `src/client/friends.ts`. Each signed-in device writes Firestore `presence/{uid}` (name, last seen, away, app or web, page and title relative to the site root, and its watch-together room) when it starts, on page changes, on room changes, every 60 s and on hide. Live listeners (the full `firebase/firestore` SDK, `onSnapshot`) drive: the menu's "N online" list (`[data-side-online]`), online/last seen plus a **Join** button on the Account page Friends rows (`.friend[data-uid]`), and the "Invite" list in TogetherPanel (`[data-together-friends]`). Invites go in Firestore `invites` ({from, to, code, href, title, created, status}). The receiver gets a pop-up (`[data-invite-pop]` in Base.astro); Join opens `href?room=code`; the sender gets a toast. Invites expire after 10 min, and the sender deletes their own after 1 h. `together.ts` exports `currentRoom()` and `ensureRoom()` and fires `mls:together-room`; `account.ts` fires `mls:signed-in` / `mls:signed-out`. In tests, presence and invites go through `window.__fakeShared` (an exposed function backed by the per-test `db` fixture), so two browser contexts see each other.
- **Lecture progress:** `mls.lectures` (synced). `videos.ts` saves the position every 5 s while playing and on pause; it resumes there; watching 90% marks the lesson complete; the playlist shows bars.
- **Mock interview:** `/interview/` (`src/pages/interview.astro`, `src/client/interview.ts`, pure logic `src/lib/interview.ts`). Questions come from `interview.json` (the same rendered cards as Revision, `src/lib/cardsHtml.ts`). Sessions go in `mls.interviews` (synced). Missed questions are rescheduled "again" in the flashcards. Recording uses MediaRecorder and stays on the device (the app has RECORD_AUDIO).

### Daily habit, mastery, league, quiz battle, reminders (app 1.14)

- **Activity log** `mls.activity` (synced): per day, per device counts `{c cards, q questions, r right, x practice, i interview, l lessons, s seconds listened, g goal}`. Pure logic in `src/lib/activity.ts` (points, streak with one freeze a week, week points). Each device only adds to its own counts, so `sync.ts` always merges this key (`ALWAYS_MERGE`) instead of newest-wins. `store.ts` `logActivity()` is called from saveCardState (not for interview misses), saveQuizAnswer, saveDwResult, saveFlowResult, setCompleted, saveInterview, and media/lecture progress (`listened`). It fires `mls:activity`.
- **Daily goal** (`prefs.dailyGoal`, default 30) and streak: `GoalCard.astro` + `src/client/goal.ts` (Home and Today). Goal reached → toast.
- **Today's session** `/today/` (`src/lib/today.ts` plan, `src/client/today.ts`): due cards + up to 3 new, old mistakes, weakest-lesson questions, interleaved. `?topic=<exam topic id>` drills one topic.
- **Mastery** `/mastery/` (`src/lib/mastery.ts`, `src/client/mastery.ts`): lesson mastery from quiz answers (`quiz-<lesson>:…`) and card intervals; `EXAM_TOPICS` maps lessons to MCD Level 1 topics; readiness. `mcq/?preset=exam60` opens a 60-question exam. Lesson data comes from `src/lib/studyIndex.ts`.
- **Weekly league**: profiles carry `streak`, `weekPoints`, `week`, `todayPoints` (from `summarize`). `src/client/league.ts` renders `[data-league]` (Account page) and `[data-league-line]` (Home).
- **Quiz battle** `/battle/` (`src/lib/battle.ts` scoring + message checks, `src/client/battle.ts`): host runs the game over the shared room connection `src/client/rooms.ts` (`makeTransport("quiz")`, peer ids `mls-quiz-<code>`; watch together uses `makeTransport("watch")`). Invites and presence reuse friends.ts (room href `battle/`). Test transport is a BroadcastChannel, which can't cross browser contexts, so the game test uses two tabs of one context.
- **Reminders** (app only): `@capacitor/local-notifications`; `src/lib/reminder.ts` plans the next few days; `native.ts` schedules them, re-plans on activity, prefs change and pause, and opens `today/` on tap. Preferences has the switch and time (`prefs.reminder`, `reminderTime`); `window.mlsReminders.enable()` asks for permission.
- **Podcast auto-play**: the next episode plays when one ends (offline in the app: the next downloaded one). `prefs.podcastAutoplay`. The test fixture episode never leads into the course.

### MuleBeats (study songs; Stage 1, not yet released)

- Manifest: `config/media.json` → `mulebeats` {tracks, playlists}, parsed by `src/lib/mulebeats.ts` `parseBeats` (called from `parseMedia`; mistakes stop the build). Only `status: "approved"` songs with `audioUrl` and `duration` are published (`publish`); `test: true` songs only in test builds. `planStyle` picks genre/length from objective and complexity. Days 5–10 have 16 planned songs and no audio yet, so the live page shows the empty state.
- Page `/mulebeats/` (`src/pages/mulebeats.astro`, `src/client/mulebeats.ts`). Songs join the shared audio player's list (`AudioPlayer.astro`, `kind: "song"`) and play as a queue: `player.ts` `playQueue`, `setShuffle`, `cycleRepeat`, `queueInfo`, event `mls:queue`, `mls:player-error`. Pure queue helpers `stepIndex`, `afterEnd`, `shuffled`. Podcasts never step into songs; playing a podcast ends the queue. Songs start from the top (no resume). Lock-screen next/previous use the same `step()`.
- Tests: `tests/unit/mulebeats.test.ts`, `tests/e2e/mulebeats.spec.ts` (empty-state test runs only with `MULEBEATS_EMPTY=1` against a production build).

### Menu toggle (`setupNavToggle` in app.ts)

- **Wide screens:** the button collapses the sidebar to icons (`data-nav="collapsed"`, remembered).
- **Phones and the app (≤800px):** the same button opens the sidebar as a drawer (`html[data-drawer="open"]`, not remembered). It has an × inside (`[data-nav-close]`) because the drawer covers the button. It closes on a link, a tap on the backdrop (`[data-nav-backdrop]`) or Escape. Added in commit `6d2116a`, app 1.7.

## Tests

- Unit tests are in `tests/unit/`, e.g. `player.test.ts` and `together.test.ts`.
- E2E tests are in `tests/e2e/`. `fake-yt.ts` is a fake YouTube IFrame API that `useFakeYouTube(page)` swaps in for the real script. It has knobs for automatic captions, autoplay delay, ignored seeks and a slow script. `player.spec.ts` covers the player, the Videos page, the podcast page and the drawer. `together.spec.ts` covers watch together, including the reported bug and a slow connection.
- axe accessibility checks run on the main screens, and they must report no violations.
- **Known flake:** `together.spec.ts` "the reported case…" failed once under load on phone-360 (the clock hit the fake video's end) and then passed 25 out of 25 times. Rerun it before treating it as a real failure.
- CI fonts are wider than the local ones, so a 360px overflow check can fail only on CI. Use `min-width: 0` on grid children.

## Deploy (GitHub Actions)

- `gh` has two accounts (`developerashok99` owns this repo; `kumarnaidukarri` cannot push here). Push with the owner's token without switching: `git -c credential.helper= -c 'credential.helper=!f(){ echo username=developerashok99; echo "password=$(gh auth token --user developerashok99)"; }; f' push origin main`, and prefix `gh run …` with `GH_TOKEN=$(gh auth token --user developerashok99)`.

- `.github/workflows/deploy.yml` runs "Build, test and deploy" on every push to main (and daily). It runs the tests, and if they fail nothing is deployed. It deploys to GitHub Pages.
- `.github/workflows/android.yml` runs "Android APK": it builds the debug APK and uploads it as the run artifact `mule-learning-hub-debug-apk` (kept for 30 days).
- Check the latest run with `gh run list --limit 3`. Re-running an old failed run uses that commit's old code.

## Android app (Capacitor 8)

- The appId is `io.github.developerashok99.mulelearning`. The app bundles `dist-app/` (built with `APP_BUILD=1`), so everything except media works offline.
- **Every web UI change reaches the app** after `npm run app:apk`. To check the app isn't stale, compare `dist-app/` with `android/app/src/main/assets/public/`. Only build timestamps, pagefind hashes and the `sw.js` version should differ.
- Native code is in `src/client/native.ts`:
  - downloads (Filesystem)
  - `window.mlsOrientation` (`@capacitor/screen-orientation`), needed because the WebView doesn't support `screen.orientation.lock`
  - the media session
- `MainActivity` serves a folder's index.html itself.
- The version is set in `android/app/build.gradle`. It is now **versionCode 15 / versionName "1.15"**. Bump both for every app release.
- **Build environment:**
  - `export JAVA_HOME=~/.jdks/jdk-21.0.12.1+1 ANDROID_HOME=~/Android/Sdk` (the system Java is a JRE only)
  - The root disk is nearly full. Free only rebuildable caches, never user data.
- **Emulator:**
  - The AVD is `mule`: `~/Android/Sdk/emulator/emulator -avd mule -no-window -no-audio -no-boot-anim -no-snapshot-save`. The Android 15 image needs about 7.4 GB free; if space is short, run the AVD from `/dev/shm`.
  - Install with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, then start it with `adb shell am start -n io.github.developerashok99.mulelearning/.MainActivity`.
  - Drive the WebView with Playwright's `_android` API: `(await _android.devices())[0].webView({pkg})`, then `.page()`. Use `click()`, not `tap()`; `connectOverCDP` doesn't work.
  - Screenshots don't work in the headless emulator (`dev.screenshot` is black and `page.screenshot` hangs), so check state with `evaluate` and `isVisible` instead.
  - Stop it with `adb emu kill`.
- **Releases:**
  - GitHub Releases are named `app-vX.Y`. The latest published one is **app-v1.15** (1.5–1.11 were skipped).
  - Publish with (as `developerashok99`; this worked for 1.12):
    ```bash
    cp android/app/build/outputs/apk/debug/app-debug.apk mule-learning-hub-X.Y.apk
    GH_TOKEN=$(gh auth token --user developerashok99) gh release create app-vX.Y mule-learning-hub-X.Y.apk --repo developerashok99/developerashok99.github.io \
      --title "Mule Learning Hub app X.Y (Android, debug build)" --notes "…" --target main --latest
    rm mule-learning-hub-X.Y.apk
    ```
  - Use the full SHA or `main` for `--target`; a short SHA fails.

## How the user wants to work

- **Implementing:** once a plan or request is clear, implement it end to end without pausing: verify (tests, a live check, the emulator for app changes), then commit, push and deploy. Report honestly at the end, including flaky or failed tests.
- **App parity:** web UI changes must also reach the Android app. Rebuild the APK, bump the version, and test on the emulator.
- **Holding back:** if the user says "keep it local / don't push", don't push until they say so.
- **Commits:** end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writing:** keep user-facing text, labels and test names plain English. The existing code style is small functions with short comments that explain *why*.
- **Typing:** the user types fast with typos. Read for intent.

## Related projects (outside this repo)

- `/home/ashok/Downloads/job-pilot/mule-project-notes` is GitHub repo `developerashok99/mule-project-session`. It holds the mentor's "Project Part 1": a Molson Coors → CargoWise booking integration (EDI 300 over SFTP → X12 Read → DataWeave → CargoWise UniversalShipment XML → eAdaptor HTTPS). It contains the transcript, slides, super-detailed notes, the practice/reference DataWeave files, the audio lesson, the cartoon video, and `tools/` (Whisper, Kokoro TTS, and the cartoon video renderer `render_cartoon.py` + `tools/cartoon/scenes.js`).
  - Still uncommitted there: the cartoon renderer files, plus edits to `audio/README.md`, the audio script and `tools/PIPELINE.md`. The old `audio/part1-project-video.mp4` is deleted locally. Ask before pushing.
- `green-c-mule-notes` (local `/home/ashok/Downloads/job-pilot/green-c-mule-notes`) holds the course notes, podcasts, and the cartoon "animated podcast/" videos. Never overwrite or delete the old text-only videos there.
- The YouTube playlist scripts are in `youtube-playlist/` (in the job-pilot folder). Video podcasts are in playlist PLdYfFuuCJATo; animated podcasts are in PLLUMsgplckUY. The YouTube API can only reorder a playlist when its sort is set to Manual.
