// The site moved from /mule-learning-web/ to the root of developerashok99.github.io. Browsers that visited the old
// address still have its offline worker; when they check it for an update they get this one, which removes itself and
// reloads open pages, so they reach the redirect to the new address. (Its old caches are removed by the new worker,
// which deletes every cache it doesn't use; deleting them here could also remove the new worker's.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
  })());
});
