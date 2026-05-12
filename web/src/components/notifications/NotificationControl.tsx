import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Check, Loader2, Send, X } from "lucide-react";
import {
  deletePushSubscription,
  getNotificationStatus,
  savePushSubscription,
  sendTestNotification,
  type BrowserPushSubscriptionJson,
  type NotificationEventKind,
  type NotificationStatus
} from "../../api/notificationsApi";

const notificationEvents: Array<{ id: NotificationEventKind; label: string }> = [
  { id: "task_completed", label: "Completed" },
  { id: "task_failed", label: "Failed" },
  { id: "user_input_requested", label: "Needs input" }
];

interface Props {
  onError: (message: string) => void;
}

export default function NotificationControl({ onError }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(null);
  const [enabledEvents, setEnabledEvents] = useState<NotificationEventKind[]>(
    notificationEvents.map((event) => event.id)
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);

  const browserPushAvailable = useMemo(() => supportsBrowserPush(), []);
  const enabled = browserPushAvailable && permission === "granted" && Boolean(subscriptionEndpoint);
  const unavailableReason = availabilityMessage(browserPushAvailable, status, standalone);

  useEffect(() => {
    setStandalone(isStandaloneApp());
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
    void refreshStatus();
    void refreshBrowserSubscription();
  }, []);

  async function refreshStatus() {
    try {
      const result = await getNotificationStatus();
      setStatus(result);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function refreshBrowserSubscription() {
    if (!supportsBrowserPush()) {
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    setSubscriptionEndpoint(subscription?.endpoint ?? null);
  }

  async function handleEnable() {
    if (!status?.publicKey) {
      setMessage("Server push keys are not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const ready = await navigator.serviceWorker.ready;
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setMessage("Notifications are blocked for this device.");
        return;
      }
      const existing = await ready.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(status.publicKey)
        }));
      await savePushSubscription(serializeSubscription(subscription), enabledEvents);
      setSubscriptionEndpoint(subscription.endpoint);
      setMessage("Notifications enabled on this device.");
      await refreshStatus();
    } catch (err) {
      const text = (err as Error).message;
      setMessage(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint ?? subscriptionEndpoint;
      if (subscription) {
        await subscription.unsubscribe();
      }
      if (endpoint) {
        await deletePushSubscription(endpoint);
      }
      setSubscriptionEndpoint(null);
      setMessage("Notifications disabled on this device.");
      await refreshStatus();
    } catch (err) {
      const text = (err as Error).message;
      setMessage(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage(null);
    try {
      const endpoint = await currentPushEndpoint();
      if (!endpoint) {
        setMessage("No device subscription was found.");
        return;
      }
      const result = await sendTestNotification(endpoint);
      setMessage(result.sent > 0 ? "Test notification sent." : "No matching device subscription was found.");
    } catch (err) {
      const text = (err as Error).message;
      setMessage(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }

  async function handleEventToggle(event: NotificationEventKind, checked: boolean) {
    const next = checked
      ? [...new Set([...enabledEvents, event])]
      : enabledEvents.filter((item) => item !== event);
    if (!next.length) {
      return;
    }
    setEnabledEvents(next);
    const subscription = await currentPushSubscription();
    if (!subscription) {
      return;
    }
    try {
      await savePushSubscription(serializeSubscription(subscription), next);
      setMessage("Notification events updated.");
      await refreshStatus();
    } catch (err) {
      const text = (err as Error).message;
      setMessage(text);
      onError(text);
    }
  }

  return (
    <div className="notification-control">
      <button
        className={`icon-button notification-trigger ${enabled ? "active" : ""}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
      >
        {enabled ? <BellRing size={17} /> : <Bell size={17} />}
      </button>
      {open ? (
        <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-popover-header">
            <div>
              <strong>Notifications</strong>
              <span>{enabled ? "Enabled on this device" : "Not enabled"}</span>
            </div>
            <button className="icon-button compact" type="button" onClick={() => setOpen(false)} title="Close">
              <X size={16} />
            </button>
          </div>

          {unavailableReason ? <div className="notification-state warning-banner">{unavailableReason}</div> : null}

          <div className="notification-event-list">
            <span className="panel-heading">Task alerts</span>
            {notificationEvents.map((event) => (
              <label className="notification-event-row" key={event.id}>
                <input
                  type="checkbox"
                  checked={enabledEvents.includes(event.id)}
                  disabled={busy || (enabledEvents.length === 1 && enabledEvents.includes(event.id))}
                  onChange={(changeEvent) => void handleEventToggle(event.id, changeEvent.target.checked)}
                />
                <span>{event.label}</span>
              </label>
            ))}
          </div>

          <div className="notification-actions">
            {enabled ? (
              <button className="icon-text-button secondary" type="button" disabled={busy} onClick={handleDisable}>
                {busy ? <Loader2 size={16} className="spin" /> : <X size={16} />} Disable
              </button>
            ) : (
              <button
                className="icon-text-button primary"
                type="button"
                disabled={busy || Boolean(unavailableReason)}
                onClick={handleEnable}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <Bell size={16} />} Enable
              </button>
            )}
            <button
              className="icon-text-button secondary"
              type="button"
              disabled={busy || !enabled}
              onClick={handleTest}
            >
              <Send size={16} /> Test
            </button>
          </div>

          <div className="notification-context">
            <Check size={15} />
            <span>Alerts come from the separate Agent Port Codex CLI session running on your Mac.</span>
          </div>
          {message ? <div className="notification-message">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!supportsBrowserPush()) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function currentPushEndpoint(): Promise<string | null> {
  return (await currentPushSubscription())?.endpoint ?? null;
}

function supportsBrowserPush(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function availabilityMessage(
  browserPushAvailable: boolean,
  status: NotificationStatus | null,
  standalone: boolean
): string | null {
  if (!browserPushAvailable) {
    return "Requires HTTPS and a browser with Web Push support.";
  }
  if (status && !status.configured) {
    return "Server push keys are missing.";
  }
  if (isLikelyIos() && !standalone) {
    return "On iPhone and iPad, open Agent Port from the Home Screen.";
  }
  return null;
}

function isStandaloneApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isLikelyIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function serializeSubscription(subscription: PushSubscription): BrowserPushSubscriptionJson {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime,
    keys: {
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth
    }
  };
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return buffer;
}
