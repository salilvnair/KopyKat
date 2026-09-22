(() => {
  const POLL_INTERVAL_MS = 2500; // safety net behind the instant push from inject.js
  let settings = null;
  let lastSeen = {}; // key -> last raw value seen, to detect changes and avoid echo loops
  let applying = new Set(); // keys currently being written by an incoming apply

  const ORIGIN = window.location.origin;

  function matches(list) {
    return (list || []).some((p) => {
      if (p === ORIGIN) return true;
      if (!p || !p.includes("*")) return false;
      const rx = new RegExp(
        "^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
      );
      return rx.test(ORIGIN);
    });
  }
  const froms = () => (settings?.mappings || []).map((m) => m.from);
  const tos = () => (settings?.mappings || []).flatMap((m) => m.to || []);
  const canSource = () => !!settings?.enabled && matches(froms());
  const canDest = () => !!settings?.enabled && matches(tos());

  function writeValue(key, value) {
    const current = sessionStorage.getItem(key);
    if (current === value) return;
    applying.add(key);
    try {
      if (value === null || value === undefined) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
      lastSeen[key] = value;
    } finally {
      applying.delete(key);
    }
  }

  function report(key, value) {
    if (!canSource()) return;
    if (!settings.syncKeys.includes(key)) return;
    if (applying.has(key)) return;
    if (value === lastSeen[key]) return;
    lastSeen[key] = value;
    chrome.runtime.sendMessage({ type: "TOKEN_REPORT", origin: ORIGIN, key, value });
  }

  chrome.storage.local.get(
    { enabled: false, syncKeys: ["currentUser"], mappings: [] },
    (res) => {
      settings = res;
      for (const key of settings.syncKeys) {
        lastSeen[key] = sessionStorage.getItem(key);
      }
      // As a source: report whatever is already in storage so a value set before
      // sync was enabled still propagates.
      if (canSource()) {
        for (const key of settings.syncKeys) {
          const raw = sessionStorage.getItem(key);
          if (raw !== null) chrome.runtime.sendMessage({ type: "TOKEN_REPORT", origin: ORIGIN, key, value: raw });
        }
      }
      // As a destination: pull the latest known value and fill in anything missing,
      // so a tab opened after the source already had the value gets synced immediately.
      if (canDest()) {
        chrome.runtime.sendMessage({ type: "REQUEST_SYNC", origin: ORIGIN }, (resp) => {
          const values = resp?.values || {};
          for (const key of Object.keys(values)) writeValue(key, values[key]);
        });
      }
      setInterval(poll, POLL_INTERVAL_MS);
    }
  );

  // Instant push: inject.js (MAIN world) fires this the moment the page writes.
  window.addEventListener("kk-session-write", (e) => {
    if (!settings) return;
    const detail = e.detail || {};
    if (detail.key === null) {
      for (const key of settings.syncKeys) report(key, sessionStorage.getItem(key));
      return;
    }
    report(detail.key, detail.value);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !settings) return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.syncKeys) settings.syncKeys = changes.syncKeys.newValue;
    if (changes.mappings) settings.mappings = changes.mappings.newValue;
  });

  function poll() {
    if (!canSource()) return;
    for (const key of settings.syncKeys) {
      if (applying.has(key)) continue;
      const raw = sessionStorage.getItem(key);
      if (raw === lastSeen[key]) continue;
      lastSeen[key] = raw;
      chrome.runtime.sendMessage({ type: "TOKEN_REPORT", origin: ORIGIN, key, value: raw });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "TOKEN_APPLY") return;
    if (!canDest()) return;
    if (!settings.syncKeys.includes(message.key)) return;
    writeValue(message.key, message.value);
  });
})();
