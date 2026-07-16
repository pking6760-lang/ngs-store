/* Firebase Cloud Messaging service worker — handles Web Push in the browser
   when the site (ngsstore.in) is in the background. Registered at its own scope
   so it never clashes with the offline app-shell worker (/sw.js). */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCx-acSJpaU3UT4lpgyZx69-vwhYbjAlE8",
  authDomain: "ngs1-bd645.firebaseapp.com",
  projectId: "ngs1-bd645",
  messagingSenderId: "749325788073",
  appId: "1:749325788073:web:56a9c51f2e1cea12aa5ab8",
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const link = (payload.fcmOptions && payload.fcmOptions.link) || "https://ngsstore.in/";
  self.registration.showNotification(n.title || "NGS Store", {
    body: n.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: link },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "https://ngsstore.in/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
