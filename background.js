importScripts("common.js");

// In-memory plaintext cache of the last value per synced key. The persisted copy
// is encrypted (see below); plaintext is never written to disk.
let lastValues = {};

/* ---------------------------------------------------------------------------
   Encryption at rest (AES-GCM). The key lives in chrome.storage.session, which
   is memory-only and cleared on browser restart, so a disk/profile dump has
   neither the plaintext nor the key. If the browser restarts the key is gone
   and the stale encrypted cache simply fails to decrypt (harmless).
--------------------------------------------------------------------------- */
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function getKey() {
  const { ekey } = await chrome.storage.session.get("ekey");
  if (ekey) return crypto.subtle.importKey("raw", unb64(ekey), "AES-GCM", true, ["encrypt", "decrypt"]);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  await chrome.storage.session.set({ ekey: b64(raw) });
  return key;
}
async function encrypt(value) {
  if (value === null || value === undefined) return null;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(String(value))));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decrypt(blob) {
  if (!blob) return null;
  try {
    const key = await getKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
async function loadLastValues() {
  const { lastValuesEnc = {} } = await chrome.storage.local.get({ lastValuesEnc: {} });
  const out = {};
  for (const k in lastValuesEnc) out[k] = await decrypt(lastValuesEnc[k]);
  lastValues = out;
}
async function persistLastValues() {
  const enc = {};
  for (const k in lastValues) enc[k] = await encrypt(lastValues[k]);
  await chrome.storage.local.set({ lastValuesEnc: enc });
}
loadLastValues();

/* ---------------------------------------------------------------------------
   Toolbar badge — reflects engine state, and flashes the delivered count
   after each successful sync.
--------------------------------------------------------------------------- */
const COLOR_ON = "#2f9e63";
const COLOR_WARN = "#d99a2b";

function setActionIcon(enabled) {
  const s = enabled ? "" : "-off";
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${s}.png`,
      48: `icons/icon48${s}.png`,
      128: `icons/icon128${s}.png`
    }
  }).catch(() => {});
}

async function refreshBadge() {
  const { enabled, allowedOrigins, fromOrigins, toOrigins } = await getSettings();
  setActionIcon(enabled); // terracotta when the engine is on, gray when off
  if (!enabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  // Nothing can flow without a gate plus a from and a to.
  if (!allowedOrigins?.length || !fromOrigins?.length || !toOrigins?.length) {
    await chrome.action.setBadgeBackgroundColor({ color: COLOR_WARN });
    await chrome.action.setBadgeText({ text: "!" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: COLOR_ON });
  await chrome.action.setBadgeText({ text: "•" }); // • idle-but-armed dot
}

let badgeRevert;
async function flashBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: COLOR_ON });
  await chrome.action.setBadgeText({ text: String(count) });
  clearTimeout(badgeRevert);
  badgeRevert = setTimeout(refreshBadge, 3000);
}

chrome.runtime.onStartup.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(async (details) => {
  await refreshBadge();
  if (details.reason === "install") {
    // First-run onboarding: open Options with a welcome walkthrough.
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html?welcome=1") });
  }
  if (details.reason === "install" || details.reason === "update") {
    await maybeAutoReloadTabs();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.allowedOrigins || changes.fromOrigins || changes.toOrigins) refreshBadge();
});

// Also correct badge + icon whenever the service worker spins up.
refreshBadge();

/* ---------------------------------------------------------------------------
   Auto-reload allow-listed tabs so their content scripts re-attach after an
   extension (re)install/update. Also exposed as a manual popup action.
--------------------------------------------------------------------------- */
async function reloadAllowedTabs() {
  const { allowedOrigins } = await getSettings();
  if (!allowedOrigins?.length) return 0;
  const tabs = await chrome.tabs.query({});
  let reloaded = 0;
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    if (isOriginAllowed(origin, allowedOrigins)) {
      chrome.tabs.reload(tab.id);
      reloaded++;
    }
  }
  return reloaded;
}

async function maybeAutoReloadTabs() {
  const { autoReloadOnUpdate } = await getSettings();
  if (autoReloadOnUpdate) await reloadAllowedTabs();
}

/* ---------------------------------------------------------------------------
   Keyboard shortcut — toggle the engine.
--------------------------------------------------------------------------- */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-engine") return;
  const { enabled } = await getSettings();
  await chrome.storage.local.set({ enabled: !enabled });
  refreshBadge();
});

/* ---------------------------------------------------------------------------
   Messaging.
--------------------------------------------------------------------------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOKEN_REPORT") {
    handleTokenReport(message, sender);
    return false;
  }
  if (message?.type === "GET_STATUS") {
    chrome.storage.local.get({ auditLog: [] }).then((res) => {
      sendResponse({ lastValues, lastEntry: res.auditLog[0] ?? null });
    });
    return true;
  }
  if (message?.type === "GET_AUDIT") {
    chrome.storage.local.get({ auditLog: [] }).then((res) => {
      sendResponse({ auditLog: res.auditLog });
    });
    return true;
  }
  if (message?.type === "RELOAD_ALLOWED_TABS") {
    reloadAllowedTabs().then((count) => sendResponse({ ok: true, count }));
    return true;
  }
  if (message?.type === "CLEAR_ALL_TABS") {
    clearAllTabs().then((res) => sendResponse(res));
    return true;
  }
  if (message?.type === "CLEAR_AUDIT") {
    // Also reset the dedupe cache, otherwise an unchanged value reported again
    // (e.g. after a tab reload) gets silently skipped and never re-synced.
    lastValues = {};
    chrome.storage.local.set({ auditLog: [], lastValuesEnc: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Panic button: remove every synced key from every participating tab
// (allow-listed AND listed under "from" or "to").
async function clearAllTabs() {
  const settings = await getSettings();
  const { syncKeys } = settings;
  const tabs = await chrome.tabs.query({});
  const clearedOrigins = new Set();
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    if (!isSourceOrigin(origin, settings) && !isDestOrigin(origin, settings)) continue;
    for (const key of syncKeys) {
      const ok = await chrome.tabs
        .sendMessage(tab.id, { type: "TOKEN_APPLY", key, value: null })
        .then(() => true)
        .catch(() => false);
      if (ok) clearedOrigins.add(origin);
    }
  }
  lastValues = {};
  await chrome.storage.local.set({ lastValuesEnc: {} });
  await appendAudit({
    ts: Date.now(),
    key: "(all keys)",
    fromOrigin: "KopyKat · clear all",
    toOrigins: [...clearedOrigins],
    unreachableOrigins: [],
    valuePreview: "(cleared everywhere)"
  });
  return { ok: true, cleared: clearedOrigins.size };
}

async function handleTokenReport(message, sender) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  // Only accept a report from an origin that is allowed AND a "from" (source).
  if (!isSourceOrigin(message.origin, settings)) return;

  const { key, value } = message;
  // No dedupe here: the content script already only reports on a real change
  // or initial page load, so every report is a meaningful sync attempt - this
  // lets a value get retried once a previously-closed target tab is opened.
  lastValues[key] = value ?? null;
  await persistLastValues();

  const toOrigins = await broadcastValue(key, value, sender.tab?.id, settings);
  await appendAudit({
    ts: Date.now(),
    key,
    fromOrigin: message.origin,
    toOrigins: toOrigins.delivered,
    unreachableOrigins: toOrigins.unreachable,
    valuePreview: maskValue(value)
  });
  flashBadge(toOrigins.delivered.length);
}

async function broadcastValue(key, value, sourceTabId, settings) {
  const tabs = await chrome.tabs.query({});
  const delivered = [];
  const unreachable = [];
  for (const tab of tabs) {
    if (!tab.id || tab.id === sourceTabId || !tab.url) continue;
    let origin;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    // Only write to origins that are allowed AND a "to" (destination).
    if (!isDestOrigin(origin, settings)) continue;

    const sent = await chrome.tabs
      .sendMessage(tab.id, { type: "TOKEN_APPLY", key, value })
      .then(() => true)
      .catch(() => false); // tab may not have the content script yet - needs a reload

    if (sent) delivered.push(origin);
    else unreachable.push(origin);
  }
  return { delivered, unreachable };
}

async function appendAudit(entry) {
  const { auditLog = [] } = await chrome.storage.local.get({ auditLog: [] });
  auditLog.unshift(entry);
  auditLog.length = Math.min(auditLog.length, MAX_AUDIT_ENTRIES);
  await chrome.storage.local.set({ auditLog });
}
