// Minimal service worker so Windows/Android can install the portal as an app.
// It does not cache anything: every page and record always comes fresh from the server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));


// 3.99.335: WEB PUSH: an alert even when the portal is closed (sent by www.emonoverruns.online/api/push); a tap opens the portal
self.addEventListener("push", (e) => {
  e.waitUntil(self.registration.showNotification("EMON OVERRUNS E-PORTAL", {
    body: "You have a new notification or message. Tap to open.", icon: "brand/icon-192.png", badge: "brand/icon-192.png", tag: "eo-push", renotify: true
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = new URL("./#chat", self.registration.scope);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const portal = windows.find((client) => {
      const open = new URL(client.url);
      return open.origin === url.origin && open.pathname === url.pathname;
    });
    if (!portal) return self.clients.openWindow(url.href);
    await portal.focus();
    portal.postMessage({ type: "open-messages" });
  })());
});
