// Minimal service worker so Windows/Android can install the portal as an app.
// It does not cache anything: every page and record always comes fresh from the server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// 3.99.335: WEB PUSH: an alert even when the portal is closed (sent by www.emonoverruns.online/api/push); a tap opens the portal
self.addEventListener("push", (e) => {
  e.waitUntil(self.registration.showNotification("EMON OVERRUNS E-PORTAL", {
    body: "You have a new notification or message. Tap to open.", icon: "brand/icon-192.png", badge: "brand/icon-192.png", tag: "eo-push", renotify: true
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => "focus" in c); if (w) return w.focus();
    return self.clients.openWindow("./");
  }));
});
