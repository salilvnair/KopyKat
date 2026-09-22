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
   Toolbar badge — reflects engine state, flashes delivered count after a sync.
--------------------------------------------------------------------------- */
const COLOR_ON = "#2f9e63";
const COLOR_WARN = "#d99a2b";

function setActionIcon(enabled) {
  const s = enabled ? "" : "-off";
  chrome.action.setIcon({
    path: { 16: `icons/icon16${s}.png`, 48: `icons/icon48${s}.png`, 128: `icons/icon128${s}.png` }
  }).catch(() => {});
}

async function refreshBadge() {
  const settings = await getSettings();
  setActionIcon(settings.enabled);
  if (!settings.enabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (!hasUsableFlow(settings)) {
    await chrome.action.setBadgeBackgroundColor({ color: COLOR_WARN });
    await chrome.action.setBadgeText({ text: "!" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: COLOR_ON });
  await chrome.action.setBadgeText({ text: "•" });
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
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html?welcome=1") });
  }
  if (details.reason === "install" || details.reason === "update") {
    await maybeAutoReloadTabs();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.mappings) refreshBadge();
});
refreshBadge();

/* ---------------------------------------------------------------------------
   Reload / clear helpers operate on every origin referenced in the sync map.
--------------------------------------------------------------------------- */
async function tabsMatching(patterns) {
  const tabs = await chrome.tabs.query({});
  const out = [];
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin;
    try { origin = new URL(tab.url).origin; } catch { continue; }
    if (matchesAny(origin, patterns)) out.push({ id: tab.id, origin });
  }
  return out;
}

async function reloadMappedTabs() {
  const settings = await getSettings();
  const targets = await tabsMatching(allMappedOrigins(settings));
  for (const t of targets) chrome.tabs.reload(t.id);
  return targets.length;
}
async function maybeAutoReloadTabs() {
  const { autoReloadOnUpdate } = await getSettings();
  if (autoReloadOnUpdate) await reloadMappedTabs();
}

async function clearAllTabs() {
  const settings = await getSettings();
  const { syncKeys } = settings;
  const targets = await tabsMatching(allMappedOrigins(settings));
  const clearedOrigins = new Set();
  for (const t of targets) {
    for (const key of syncKeys) {
      const ok = await chrome.tabs.sendMessage(t.id, { type: "TOKEN_APPLY", key, value: null })
        .then(() => true).catch(() => false);
      if (ok) clearedOrigins.add(t.origin);
    }
  }
  lastValues = {};
  await chrome.storage.local.set({ lastValuesEnc: {} });
  if (clearedOrigins.size) {
    await appendAudit({
      ts: Date.now(),
      key: "(all keys)",
      fromOrigin: "KopyKat · clear all",
      toOrigins: [...clearedOrigins],
      valuePreview: "(cleared everywhere)"
    });
  }
  return { ok: true, cleared: clearedOrigins.size };
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
  if (message?.type === "REQUEST_SYNC") {
    handleRequestSync(message).then(sendResponse);
    return true;
  }
  if (message?.type === "GET_STATUS") {
    chrome.storage.local.get({ auditLog: [] }).then((res) => {
      sendResponse({ lastValues, lastEntry: res.auditLog[0] ?? null });
    });
    return true;
  }
  if (message?.type === "GET_AUDIT") {
    chrome.storage.local.get({ auditLog: [] }).then((res) => sendResponse({ auditLog: res.auditLog }));
    return true;
  }
  if (message?.type === "RELOAD_MAPPED_TABS") {
    reloadMappedTabs().then((count) => sendResponse({ ok: true, count }));
    return true;
  }
  if (message?.type === "CLEAR_ALL_TABS") {
    clearAllTabs().then(sendResponse);
    return true;
  }
  if (message?.type === "CLEAR_AUDIT") {
    lastValues = {};
    chrome.storage.local.set({ auditLog: [], lastValuesEnc: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// A destination tab just loaded — hand it the current value for each synced key so
// it can fill in anything missing or stale (content.js applies only what differs).
async function handleRequestSync(message) {
  const settings = await getSettings();
  if (!settings.enabled) return { values: {} };
  if (!isDestOrigin(message.origin, settings)) return { values: {} };
  const values = {};
  for (const key of settings.syncKeys) {
    if (key in lastValues) values[key] = lastValues[key];
  }
  return { values };
}

async function handleTokenReport(message, sender) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!isSourceOrigin(message.origin, settings)) return;

  const { key, value } = message;
  if (!settings.syncKeys.includes(key)) return;

  lastValues[key] = value ?? null;
  await persistLastValues();

  const destPatterns = destinationPatternsFor(message.origin, settings);
  const delivered = await broadcastValue(key, value, sender.tab?.id, destPatterns);

  // Only record real deliveries — no "no tab open / unreachable" noise.
  if (delivered.length) {
    await appendAudit({
      ts: Date.now(),
      key,
      fromOrigin: message.origin,
      toOrigins: delivered,
      valuePreview: maskValue(value)
    });
    flashBadge(delivered.length);
  }
}

async function broadcastValue(key, value, sourceTabId, destPatterns) {
  if (!destPatterns.length) return [];
  const tabs = await chrome.tabs.query({});
  const delivered = [];
  for (const tab of tabs) {
    if (!tab.id || tab.id === sourceTabId || !tab.url) continue;
    let origin;
    try { origin = new URL(tab.url).origin; } catch { continue; }
    if (!matchesAny(origin, destPatterns)) continue;
    const sent = await chrome.tabs.sendMessage(tab.id, { type: "TOKEN_APPLY", key, value })
      .then(() => true).catch(() => false);
    if (sent) delivered.push(origin);
  }
  return delivered;
}

async function appendAudit(entry) {
  const { auditLog = [] } = await chrome.storage.local.get({ auditLog: [] });
  auditLog.unshift(entry);
  auditLog.length = Math.min(auditLog.length, MAX_AUDIT_ENTRIES);
  await chrome.storage.local.set({ auditLog });
}
