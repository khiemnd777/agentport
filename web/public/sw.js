const defaultUrl = "/";

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/agent-port-icon.svg",
      badge: "/agent-port-icon.svg",
      data: {
        url: payload.url || defaultUrl
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || defaultUrl, self.location.origin).href;
  event.waitUntil(focusOrOpenClient(targetUrl));
});

function readPushPayload(event) {
  if (!event.data) {
    return fallbackPayload();
  }
  try {
    return {
      ...fallbackPayload(),
      ...event.data.json()
    };
  } catch {
    return fallbackPayload();
  }
}

function fallbackPayload() {
  return {
    title: "Agent Port",
    body: "A task needs attention.",
    tag: "agent-port-task",
    url: defaultUrl
  };
}

async function focusOrOpenClient(targetUrl) {
  const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientList) {
    if ("focus" in client && new URL(client.url).origin === self.location.origin) {
      await client.focus();
      if ("navigate" in client) {
        await client.navigate(targetUrl);
      }
      return;
    }
  }
  if (clients.openWindow) {
    await clients.openWindow(targetUrl);
  }
}
