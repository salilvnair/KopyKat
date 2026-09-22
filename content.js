(() => {
  // Poll is now only a safety net behind the instant push from inject.js, so it
  // can run less aggressively.
  const POLL_INTERVAL_MS = 2500;
  let settings = null;
  let lastSeen = {}; // key -> last raw value seen, to detect changes and avoid echo loops
  let applying = new Set(); // keys currently being written by an incoming TOKEN_APPLY

  function matches(list) {
    const origin = window.location.origin;
    return (list || []).some((p) => {
      if (p === origin) return true;
      if (!p.includes("*")) return false;
      const rx = new RegExp(
        "^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
      );
      return rx.test(origin);
    });
  }

  const allowed = () => matches(settings?.allowedOrigins);
  // Source: we READ/report changes here. Destination: we WRITE incoming values here.
  const canSource = () => !!settings?.enabled && allowed() && matches(settings?.fromOrigins);
  const canDest = () => !!settings?.enabled && allowed() && matches(settings?.toOrigins);

  function report(key, value) {
    if (!canSource()) return;
    if (!settings.syncKeys.includes(key)) return;
    if (applying.has(key)) return;
    if (value === lastSeen[key]) return;
    lastSeen[key] = value;
    chrome.runtime.sendMessage({
      type: "TOKEN_REPORT",
      origin: window.location.origin,
      key,
      value
    });
  }

  chrome.storage.local.get(
    { enabled: false, syncKeys: ["currentUserTokenState"], allowedOrigins: [], fromOrigins: [], toOrigins: [] },
    (res) => {
      settings = res;
      const active = canSource();
      for (const key of settings.syncKeys) {
        const raw = sessionStorage.getItem(key);
        lastSeen[key] = raw;
        // Report whatever is already sitting in storage so a tab that had the
        // value before sync was turned on still gets picked up immediately.
        if (active && raw !== null) {
          chrome.runtime.sendMessage({ type: "TOKEN_REPORT", origin: window.location.origin, key, value: raw });
        }
      }
      setInterval(poll, POLL_INTERVAL_MS);
    }
  );

  // Instant push: inject.js (MAIN world) fires this the moment the page writes.
  window.addEventListener("kk-session-write", (e) => {
    if (!settings) return;
    const detail = e.detail || {};
    if (detail.key === null) {
      // sessionStorage.clear() - re-evaluate every synced key.
      for (const key of settings.syncKeys) report(key, sessionStorage.getItem(key));
      return;
    }
    report(detail.key, detail.value);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!settings) return; // initial load hasn't populated settings yet
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.syncKeys) settings.syncKeys = changes.syncKeys.newValue;
    if (changes.allowedOrigins) settings.allowedOrigins = changes.allowedOrigins.newValue;
    if (changes.fromOrigins) settings.fromOrigins = changes.fromOrigins.newValue;
    if (changes.toOrigins) settings.toOrigins = changes.toOrigins.newValue;
  });

  function poll() {
    if (!canSource()) return;
    for (const key of settings.syncKeys) {
      if (applying.has(key)) continue;
      const raw = sessionStorage.getItem(key);
      if (raw === lastSeen[key]) continue;
      lastSeen[key] = raw;
      chrome.runtime.sendMessage({
        type: "TOKEN_REPORT",
        origin: window.location.origin,
        key,
        value: raw
      });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "TOKEN_APPLY") return;
    if (!canDest()) return;
    if (!settings.syncKeys.includes(message.key)) return;

    const current = sessionStorage.getItem(message.key);
    if (current === message.value) return;

    applying.add(message.key);
    try {
      if (message.value === null || message.value === undefined) {
        sessionStorage.removeItem(message.key);
      } else {
        sessionStorage.setItem(message.key, message.value);
      }
      lastSeen[message.key] = message.value;
    } finally {
      applying.delete(message.key);
    }
  });
})();
